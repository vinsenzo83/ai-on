"""
app/devtools/tools/lint_format.py
───────────────────────────────────
Phase 16 — Stage B · Tool 8: Lint / Format

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  lint    – run a linter on a file or directory (ruff / flake8 / pylint)
  format  – format a file / directory in-place (ruff format / black)
  check   – format check without modification (read-only)
  fix     – auto-fix lint errors where possible (ruff --fix)

Safety model
────────────
  • lint / check are READ_ONLY-compatible.
  • format / fix require SAFE_WRITE mode.
  • All paths verified inside workspace_root.
  • Tool selection falls back gracefully: ruff → flake8 → pylint.

Input params
────────────
  workspace_root : str         – absolute workspace root (required)
  path           : str         – relative file or directory to lint (default ".")
  tool_name_     : str         – "ruff" | "flake8" | "pylint" | "black" (optional)
  timeout        : float       – seconds (default 30)
  extra_args     : list[str]   – additional CLI args

Normalized output shapes
────────────────────────
  lint / check → { tool, path, issues: [{file, line, col, code, message}],
                   total_issues, exit_code, output }
  format / fix → { tool, path, files_changed, output, exit_code }
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

_SUPPORTED_ACTIONS = ["lint", "format", "check", "fix"]
_WRITE_ACTIONS     = {"format", "fix"}
_DEFAULT_TIMEOUT   = 30.0


class LintFormatTool(BaseDevTool):
    """Lint and auto-format code using ruff, flake8, pylint, or black."""

    @property
    def name(self) -> str:
        return "lint_format"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.WRITE

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY  # per-action check in validate_input

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": False, "default": "."},
            "tool_name_":     {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 30.0},
            "extra_args":     {"type": "array",   "required": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "lint":   {"tool": "str", "path": "str", "issues": "list", "total_issues": "int"},
            "format": {"tool": "str", "path": "str", "files_changed": "int", "output": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in _WRITE_ACTIONS:
            if tool_input.mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires SAFE_WRITE or FULL mode"
                ))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p       = tool_input.params
        action  = tool_input.action
        root    = p["workspace_root"]
        path    = p.get("path", ".")
        timeout = float(p.get("timeout", _DEFAULT_TIMEOUT))
        extra   = list(p.get("extra_args") or [])
        target  = os.path.normpath(os.path.join(root, path))

        tool_choice = p.get("tool_name_") or await self._detect_tool(root)
        logger.info("lint_format_tool.execute", action=action,
                    tool=tool_choice, target=target)

        cmd = self._build_cmd(tool_choice, action, target, extra)
        stdout, stderr, rc = await self._run(cmd, root, timeout)
        output = (stdout + stderr).strip()

        if action in ("lint", "check"):
            issues = self._parse_issues(output)
            return {
                "tool":         tool_choice,
                "path":         target,
                "issues":       issues,
                "total_issues": len(issues),
                "exit_code":    rc,
                "output":       output,
            }
        # format / fix
        files_changed = self._count_changed(output)
        return {
            "tool":          tool_choice,
            "path":          target,
            "files_changed": files_changed,
            "output":        output,
            "exit_code":     rc,
        }

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", 20_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _detect_tool(self, cwd: str) -> str:
        for candidate in ("ruff", "flake8", "pylint"):
            proc = await asyncio.create_subprocess_shell(
                f"which {candidate}",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=cwd,
            )
            await proc.wait()
            if proc.returncode == 0:
                return candidate
        return "ruff"

    def _build_cmd(self, tool: str, action: str, target: str,
                   extra: list[str]) -> list[str]:
        if tool == "ruff":
            if action == "lint":
                return ["ruff", "check", target] + extra
            if action == "check":
                return ["ruff", "format", "--check", target] + extra
            if action == "format":
                return ["ruff", "format", target] + extra
            if action == "fix":
                return ["ruff", "check", "--fix", target] + extra
        if tool == "black":
            if action in ("format", "fix"):
                return ["black", target] + extra
            return ["black", "--check", target] + extra
        if tool == "flake8":
            return ["flake8", target] + extra
        if tool == "pylint":
            return ["pylint", target] + extra
        return [tool, target] + extra

    async def _run(self, cmd: list[str], cwd: str,
                   timeout: float) -> tuple[str, str, int]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ("", "timeout", -1)
        return (
            out_b.decode("utf-8", errors="replace"),
            err_b.decode("utf-8", errors="replace"),
            proc.returncode,
        )

    def _parse_issues(self, output: str) -> list[dict]:
        """Parse ruff/flake8 output into structured issue dicts."""
        issues = []
        # ruff/flake8 pattern: path:line:col: CODE message
        pattern = re.compile(
            r"^(.+?):(\d+):(\d+):\s+([A-Z]\w+\d*)\s+(.+)$", re.MULTILINE
        )
        for m in pattern.finditer(output):
            issues.append({
                "file":    m.group(1),
                "line":    int(m.group(2)),
                "col":     int(m.group(3)),
                "code":    m.group(4),
                "message": m.group(5).strip(),
            })
        return issues

    def _count_changed(self, output: str) -> int:
        """Count how many files ruff/black reports as changed."""
        m = re.search(r"(\d+)\s+file[s]?\s+(?:reformatted|changed)", output, re.IGNORECASE)
        return int(m.group(1)) if m else 0
