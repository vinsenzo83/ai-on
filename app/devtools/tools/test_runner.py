"""
app/devtools/tools/test_runner.py
───────────────────────────────────
Phase 16 — Stage A · Tool 5: Test Runner

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  run_tests    – run the full test suite (or a subset by path/keyword)
  run_file     – run tests in a single file
  list_tests   – discover and list test IDs without running

Safety model
────────────
  • Execution actions require DevToolMode.FULL.
  • The runner always executes inside workspace_root.
  • Max timeout defaults to 120 s (configurable up to 600 s).

Input params
────────────
  workspace_root : str   – absolute workspace root (required)
  runner         : str   – "pytest" | "unittest" (default "pytest")
  path           : str   – file/dir relative to workspace_root (optional)
  keyword        : str   – test keyword filter (-k expression for pytest)
  markers        : str   – marker expression (-m for pytest)
  timeout        : float – seconds (default 120, max 600)
  extra_args     : list  – additional CLI args passed to the runner
  verbose        : bool  – pass -v to the runner (default False)

Normalized output shapes
────────────────────────
  run_tests / run_file →
    { runner, passed, failed, errors, skipped, total, duration_s,
      output, exit_code, timed_out }
  list_tests →
    { runner, test_ids: [str], total }
"""
from __future__ import annotations

import asyncio
import os
import re
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

_SUPPORTED_ACTIONS = ["run_tests", "run_file", "list_tests"]
_DEFAULT_TIMEOUT   = 120.0
_MAX_TIMEOUT       = 600.0

# Patterns to extract summary from pytest output
_PYTEST_SUMMARY_RE = re.compile(
    r"(\d+) passed|(\d+) failed|(\d+) error|(\d+) warning|(\d+) skipped",
    re.IGNORECASE,
)


class TestRunnerTool(BaseDevTool):
    """Run pytest / unittest inside a workspace root."""

    @property
    def name(self) -> str:
        return "test_runner"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "runner":         {"type": "string",  "required": False, "default": "pytest"},
            "path":           {"type": "string",  "required": False},
            "keyword":        {"type": "string",  "required": False},
            "markers":        {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 120.0},
            "extra_args":     {"type": "array",   "required": False},
            "verbose":        {"type": "boolean", "required": False, "default": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "runner":     "str",
            "passed":     "int",
            "failed":     "int",
            "errors":     "int",
            "skipped":    "int",
            "total":      "int",
            "duration_s": "float",
            "output":     "str",
            "exit_code":  "int",
            "timed_out":  "bool",
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base = [require_param(p, "workspace_root", param_type=str)]

        if action in ("run_tests", "run_file", "list_tests"):
            if tool_input.mode != DevToolMode.FULL:
                base.append(DevToolValidationResult.fail(
                    f"TestRunnerTool requires mode=FULL; got {tool_input.mode!r}"
                ))

        if action == "run_file":
            base.append(require_param(p, "path", param_type=str))

        runner = p.get("runner", "pytest")
        if runner not in ("pytest", "unittest"):
            base.append(DevToolValidationResult.fail(
                f"runner must be 'pytest' or 'unittest'; got {runner!r}"
            ))

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
        runner = p.get("runner", "pytest")
        timeout = min(float(p.get("timeout", _DEFAULT_TIMEOUT)), _MAX_TIMEOUT)

        logger.info("test_runner_tool.execute", action=action, runner=runner)

        cmd = self._build_command(runner, action, p)
        return await self._run(cmd, root, timeout, runner=runner, action=action)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", max_chars=50_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _build_command(
        self, runner: str, action: str, params: dict
    ) -> list[str]:
        path     = params.get("path", "")
        keyword  = params.get("keyword", "")
        markers  = params.get("markers", "")
        verbose  = bool(params.get("verbose", False))
        extra    = list(params.get("extra_args") or [])

        if runner == "pytest":
            cmd = ["python", "-m", "pytest"]
            if verbose:
                cmd.append("-v")
            if action == "list_tests":
                cmd += ["--collect-only", "-q"]
            if keyword:
                cmd += ["-k", keyword]
            if markers:
                cmd += ["-m", markers]
            if path:
                cmd.append(path)
            cmd.extend(extra)
        else:  # unittest
            cmd = ["python", "-m", "unittest"]
            if verbose:
                cmd.append("-v")
            if action == "list_tests":
                cmd += ["discover", "-v"]
            elif path:
                cmd += ["discover", "--start-directory", path]
            cmd.extend(extra)
        return cmd

    async def _run(
        self, cmd: list[str], cwd: str, timeout: float,
        runner: str, action: str,
    ) -> dict[str, Any]:
        import time
        timed_out = False
        t0 = time.monotonic()

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
            )
            try:
                stdout_b, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                timed_out = True
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                stdout_b = b""
                await proc.wait()
        except FileNotFoundError as exc:
            raise DevToolError(
                f"Runner binary not found: {exc}",
                error_code=DevToolErrorCode.DEPENDENCY_ERROR,
            ) from exc

        duration_s = time.monotonic() - t0
        output     = stdout_b.decode("utf-8", errors="replace")
        exit_code  = proc.returncode if not timed_out else -1

        if action == "list_tests":
            test_ids = self._extract_test_ids(output)
            return {
                "runner":   runner,
                "test_ids": test_ids,
                "total":    len(test_ids),
                "output":   output,
                "timed_out": timed_out,
            }

        # Parse summary from pytest output
        passed = failed = errors = skipped = 0
        for m in _PYTEST_SUMMARY_RE.finditer(output):
            if m.group(1):
                passed  = int(m.group(1))
            if m.group(2):
                failed  = int(m.group(2))
            if m.group(3):
                errors  = int(m.group(3))
            if m.group(5):
                skipped = int(m.group(5))

        return {
            "runner":     runner,
            "passed":     passed,
            "failed":     failed,
            "errors":     errors,
            "skipped":    skipped,
            "total":      passed + failed + errors + skipped,
            "duration_s": round(duration_s, 3),
            "output":     output,
            "exit_code":  exit_code,
            "timed_out":  timed_out,
        }

    def _extract_test_ids(self, output: str) -> list[str]:
        """Extract test IDs from pytest --collect-only -q output."""
        ids = []
        for line in output.splitlines():
            line = line.strip()
            if "::" in line and not line.startswith("<"):
                ids.append(line)
        return ids
