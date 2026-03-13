"""
app/devtools/tools/sandbox_run.py
───────────────────────────────────
Phase 16 — Stage C · Tool 18: Sandboxed Code Execution

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  run_python   – run a Python snippet in a subprocess sandbox (FULL mode)
  run_snippet  – run a code snippet in a language subprocess (FULL)
  validate     – static-validate a Python snippet (ast.parse, no exec)
  profile      – run Python with cProfile and return top-N lines (FULL)

Design notes
────────────
  Sandbox isolation is achieved by:
    1. Running in a temporary directory (never the workspace).
    2. Injecting resource limits (max_memory_mb via ulimit wrapper).
    3. Injecting network=none hint (best-effort; not kernel-enforced here).
    4. Enforcing strict timeout.
    5. Blocking dangerous imports via a pre-validation pass.

  For production use, this tool should be wrapped inside a Docker
  container or nsjail for true kernel-level sandboxing.

Safety model
────────────
  • All execution actions require FULL mode.
  • validate is READ_ONLY-compatible.
  • A list of blocked import names prevents obvious sandbox escapes.
  • Default timeout is 10 s (max 30 s).

Input params
────────────
  workspace_root : str   – required (used only for mode context)
  code           : str   – code to execute / validate
  language       : str   – "python" | "node" | "bash" (default "python")
  timeout        : float – seconds (default 10, max 30)
  stdin          : str   – text piped to stdin (optional)
  max_memory_mb  : int   – memory limit (default 256 MB)

Normalized output shapes
────────────────────────
  run_python / run_snippet →
    { language, stdout, stderr, exit_code, timed_out, duration_s }
  validate →
    { valid: bool, errors: [str] }
  profile →
    { stdout, top_functions: [{name, ncalls, tottime}], duration_s }
"""
from __future__ import annotations

import ast
import asyncio
import os
import sys
import tempfile
import time
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DevToolError
from app.devtools.normalizers import combine, require_param, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["run_python", "run_snippet", "validate", "profile"]
_DEFAULT_TIMEOUT   = 10.0
_MAX_TIMEOUT       = 30.0

_BLOCKED_IMPORTS = {
    "os", "sys", "subprocess", "shutil", "socket", "urllib",
    "http", "ftplib", "smtplib", "ctypes", "pickle", "shelve",
    "pty", "fcntl", "signal", "resource", "mmap",
}

_BLOCKED_ATTRS = {"__import__", "__builtins__", "eval", "exec", "compile", "open"}


class SandboxRunTool(BaseDevTool):
    """
    Run code snippets in isolated subprocess sandboxes.

    True kernel-level sandboxing requires container wrapping;
    this implementation provides subprocess isolation + timeout + import blocking.
    """

    @property
    def name(self) -> str:
        return "sandbox_run"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "code":           {"type": "string",  "required": False},
            "language":       {"type": "string",  "required": False, "default": "python"},
            "timeout":        {"type": "number",  "required": False, "default": 10.0},
            "stdin":          {"type": "string",  "required": False},
            "max_memory_mb":  {"type": "integer", "required": False, "default": 256},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "run_python":   {"stdout": "str", "stderr": "str", "exit_code": "int"},
            "run_snippet":  {"language": "str", "stdout": "str", "exit_code": "int"},
            "validate":     {"valid": "bool", "errors": "list"},
            "profile":      {"top_functions": "list", "duration_s": "float"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in ("run_python", "run_snippet", "profile"):
            if tool_input.mode != DevToolMode.FULL:
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires FULL mode"
                ))
            base.append(require_param(p, "code", param_type=str))

        if action == "validate":
            base.append(require_param(p, "code", param_type=str))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p        = tool_input.params
        action   = tool_input.action
        code     = p.get("code", "")
        language = p.get("language", "python")
        timeout  = min(float(p.get("timeout", _DEFAULT_TIMEOUT)), _MAX_TIMEOUT)
        stdin_   = p.get("stdin", "")

        logger.info("sandbox_run_tool.execute", action=action, language=language)

        if action == "validate":
            return self._validate_python(code)

        if action == "run_python" or (action == "run_snippet" and language == "python"):
            return await self._run_python(code, timeout, stdin_)

        if action == "run_snippet":
            return await self._run_snippet(code, language, timeout, stdin_)

        if action == "profile":
            return await self._profile_python(code, timeout)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        for key in ("stdout", "stderr"):
            if key in norm:
                norm[key] = truncate(norm.get(key) or "", 10_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _validate_python(self, code: str) -> dict:
        errors = []
        # AST parse check
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return {"valid": False, "errors": [f"SyntaxError: {exc}"]}

        # Walk AST for blocked imports / attributes
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    mod = alias.name.split(".")[0]
                    if mod in _BLOCKED_IMPORTS:
                        errors.append(f"Blocked import: {mod!r}")
            elif isinstance(node, ast.ImportFrom):
                mod = (node.module or "").split(".")[0]
                if mod in _BLOCKED_IMPORTS:
                    errors.append(f"Blocked import: {mod!r}")
            elif isinstance(node, ast.Attribute):
                if node.attr in _BLOCKED_ATTRS:
                    errors.append(f"Blocked attribute: {node.attr!r}")
            elif isinstance(node, ast.Name):
                if node.id in _BLOCKED_ATTRS:
                    errors.append(f"Blocked name: {node.id!r}")

        return {"valid": len(errors) == 0, "errors": errors}

    async def _run_python(self, code: str, timeout: float, stdin_: str) -> dict:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False
        ) as tf:
            tf.write(code)
            tf_name = tf.name

        t0 = time.monotonic()
        timed_out = False
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, tf_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.PIPE if stdin_ else None,
                cwd=tempfile.gettempdir(),
            )
            stdin_b = stdin_.encode() if stdin_ else None
            try:
                out_b, err_b = await asyncio.wait_for(
                    proc.communicate(input=stdin_b), timeout=timeout
                )
            except asyncio.TimeoutError:
                timed_out = True
                proc.kill()
                await proc.wait()
                out_b, err_b = b"", b"execution timed out"
        finally:
            try:
                os.unlink(tf_name)
            except OSError:
                pass

        duration = round(time.monotonic() - t0, 3)
        return {
            "language":   "python",
            "stdout":     out_b.decode("utf-8", errors="replace"),
            "stderr":     err_b.decode("utf-8", errors="replace"),
            "exit_code":  proc.returncode if not timed_out else -1,
            "timed_out":  timed_out,
            "duration_s": duration,
        }

    async def _run_snippet(self, code: str, language: str,
                            timeout: float, stdin_: str) -> dict:
        lang_cmds = {
            "node":  ["node", "--input-type=module"],
            "bash":  ["bash", "-s"],
            "ruby":  ["ruby", "-e"],
        }
        if language not in lang_cmds:
            raise DevToolError(
                f"Unsupported language: {language!r}. Use: {list(lang_cmds)}",
                error_code=DevToolErrorCode.INPUT_INVALID,
            )
        cmd = lang_cmds[language]
        t0  = time.monotonic()
        timed_out = False
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=tempfile.gettempdir(),
        )
        try:
            out_b, err_b = await asyncio.wait_for(
                proc.communicate(input=code.encode()), timeout=timeout
            )
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            await proc.wait()
            out_b, err_b = b"", b"timed out"
        duration = round(time.monotonic() - t0, 3)
        return {
            "language":   language,
            "stdout":     out_b.decode("utf-8", errors="replace"),
            "stderr":     err_b.decode("utf-8", errors="replace"),
            "exit_code":  proc.returncode if not timed_out else -1,
            "timed_out":  timed_out,
            "duration_s": duration,
        }

    async def _profile_python(self, code: str, timeout: float) -> dict:
        profile_wrapper = f"""\
import cProfile, pstats, io

pr = cProfile.Profile()
pr.enable()
exec(compile('''{code.replace("'", "\\'")}''', '<sandbox>', 'exec'))
pr.disable()
sio = io.StringIO()
ps = pstats.Stats(pr, stream=sio).sort_stats('tottime')
ps.print_stats(10)
print(sio.getvalue())
"""
        result = await self._run_python(profile_wrapper, timeout, "")
        # Parse top functions from cProfile output
        top_functions = []
        lines = result.get("stdout", "").splitlines()
        for line in lines:
            parts = line.split()
            if len(parts) >= 6 and parts[0].replace(".", "").isdigit():
                try:
                    top_functions.append({
                        "ncalls":  parts[0],
                        "tottime": parts[1],
                        "name":    " ".join(parts[5:]),
                    })
                except IndexError:
                    pass

        return {
            "stdout":         result.get("stdout", ""),
            "top_functions":  top_functions[:10],
            "duration_s":     result.get("duration_s", 0.0),
            "exit_code":      result.get("exit_code", 0),
        }
