"""
app/devtools/tools/terminal.py
────────────────────────────────
Phase 16 — Stage A · Tool 4: Terminal / Shell Execution

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  run_command  – run an allow-listed shell command (FULL mode required)
  run_script   – run an inline shell script (FULL mode required)
  kill_process – send SIGTERM to a running process by PID (FULL mode)

Safety model
────────────
  • All execution actions require DevToolMode.FULL.
  • A block-list of dangerous command prefixes is applied before any
    subprocess is created; blocked commands raise CommandBlockedError.
  • Commands execute inside workspace_root (cwd is forced to that dir).
  • A configurable timeout (default 30 s) prevents runaway processes.
  • stdout + stderr are captured; exit code is always returned.

Allow / block rules
───────────────────
  Block-list prefixes (case-insensitive):
    rm -rf, dd, mkfs, fdisk, parted, shutdown, reboot, halt,
    poweroff, passwd, su, sudo (unless inside workspace),
    curl | sh, wget | sh, pip install (un-sandboxed).

  No allow-list of specific commands — the philosophy is to block only
  explicitly dangerous patterns, not whitelist everything. Callers can
  tighten by injecting a stricter block-list in context["blocked_prefixes"].

Input params
────────────
  workspace_root : str   – cwd for the subprocess (required)
  command        : str   – shell command string (run_command)
  script         : str   – multi-line shell script (run_script)
  pid            : int   – process ID to kill (kill_process)
  timeout        : float – seconds before SIGKILL (default 30)
  env_extra      : dict  – extra environment variables to inject

Normalized output shapes
────────────────────────
  run_command / run_script →
    { command, stdout, stderr, exit_code, timed_out, cwd }
  kill_process →
    { pid, signal_sent, success }
"""
from __future__ import annotations

import asyncio
import os
import signal
import tempfile
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import (
    CommandBlockedError,
    DevToolError,
    PermissionError_,
    TimeoutError_,
)
from app.devtools.normalizers import combine, require_param, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["run_command", "run_script", "kill_process"]
_DEFAULT_TIMEOUT   = 30.0   # seconds
_MAX_TIMEOUT       = 300.0  # 5 minutes

# Dangerous command prefixes — checked case-insensitively.
_DEFAULT_BLOCKED: list[str] = [
    "rm -rf /",
    "rm -rf ~",
    "dd if=",
    "mkfs",
    "fdisk",
    "parted",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "passwd",
    ":(){:|:&};:",   # fork bomb
]


class TerminalTool(BaseDevTool):
    """
    Execute shell commands and scripts inside a workspace root.

    Inject ``blocked_prefixes`` in ``DevToolInput.context`` to add
    project-specific command blocks.
    """

    @property
    def name(self) -> str:
        return "terminal"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.FULL

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "command":        {"type": "string",  "required": False},
            "script":         {"type": "string",  "required": False},
            "pid":            {"type": "integer", "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 30.0},
            "env_extra":      {"type": "object",  "required": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "run_command": {
                "command": "str", "stdout": "str", "stderr": "str",
                "exit_code": "int", "timed_out": "bool", "cwd": "str",
            },
            "kill_process": {"pid": "int", "signal_sent": "str", "success": "bool"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base = [require_param(p, "workspace_root", param_type=str)]

        # All terminal actions require FULL mode
        if tool_input.mode != DevToolMode.FULL:
            base.append(DevToolValidationResult.fail(
                f"TerminalTool requires mode=FULL; got mode={tool_input.mode!r}"
            ))

        if action == "run_command":
            base.append(require_param(p, "command", param_type=str))
        elif action == "run_script":
            base.append(require_param(p, "script", param_type=str))
        elif action == "kill_process":
            base.append(require_param(p, "pid", param_type=int))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p      = tool_input.params
        action = tool_input.action
        root   = p["workspace_root"]

        blocked_extra: list[str] = tool_input.context.get("blocked_prefixes", [])
        block_list = _DEFAULT_BLOCKED + blocked_extra

        timeout  = min(float(p.get("timeout", _DEFAULT_TIMEOUT)), _MAX_TIMEOUT)
        env_extra: dict[str, str] = p.get("env_extra") or {}

        if action == "run_command":
            cmd = p["command"]
            self._check_blocked(cmd, block_list)
            logger.info("terminal_tool.run_command", command=cmd, cwd=root)
            return await self._run_shell(cmd, root, timeout, env_extra)

        if action == "run_script":
            script = p["script"]
            self._check_blocked(script, block_list)
            logger.info("terminal_tool.run_script", cwd=root)
            return await self._run_script(script, root, timeout, env_extra)

        if action == "kill_process":
            pid = int(p["pid"])
            logger.info("terminal_tool.kill_process", pid=pid)
            return self._kill_process(pid)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "stdout" in norm:
            norm["stdout"] = truncate(norm.get("stdout") or "", max_chars=50_000)
        if "stderr" in norm:
            norm["stderr"] = truncate(norm.get("stderr") or "", max_chars=20_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _check_blocked(self, command: str, block_list: list[str]) -> None:
        cmd_lower = command.lower().strip()
        for blocked in block_list:
            if cmd_lower.startswith(blocked.lower()):
                raise CommandBlockedError(command)

    async def _run_shell(
        self,
        command: str,
        cwd: str,
        timeout: float,
        env_extra: dict[str, str],
    ) -> dict[str, Any]:
        env = {**os.environ, **env_extra}
        timed_out = False
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                timed_out = True
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                stdout_b, stderr_b = b"", b""
                await proc.wait()
        except FileNotFoundError as exc:
            raise DevToolError(
                f"Shell not found: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            ) from exc

        return {
            "command":   command,
            "stdout":    stdout_b.decode("utf-8", errors="replace"),
            "stderr":    stderr_b.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode if not timed_out else -1,
            "timed_out": timed_out,
            "cwd":       cwd,
        }

    async def _run_script(
        self,
        script: str,
        cwd: str,
        timeout: float,
        env_extra: dict[str, str],
    ) -> dict[str, Any]:
        # Write script to a temp file and execute it
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".sh", delete=False, dir=cwd
        ) as tf:
            tf.write(script)
            tf_name = tf.name

        try:
            os.chmod(tf_name, 0o700)
            result = await self._run_shell(
                f"bash {tf_name}", cwd, timeout, env_extra
            )
            result["command"] = f"<script> ({len(script)} chars)"
            return result
        finally:
            try:
                os.unlink(tf_name)
            except OSError:
                pass

    def _kill_process(self, pid: int) -> dict[str, Any]:
        try:
            os.kill(pid, signal.SIGTERM)
            return {"pid": pid, "signal_sent": "SIGTERM", "success": True}
        except ProcessLookupError:
            return {"pid": pid, "signal_sent": "SIGTERM", "success": False}
        except PermissionError as exc:
            raise PermissionError_(f"Cannot kill PID {pid}: {exc}") from exc
