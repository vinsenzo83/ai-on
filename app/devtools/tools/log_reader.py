"""
app/devtools/tools/log_reader.py
──────────────────────────────────
Phase 16 — Stage B · Tool 10: Log Reader

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  read_log    – read recent lines from a log file
  tail_log    – return last N lines (like tail -n)
  search_log  – grep a log file for a pattern
  parse_log   – parse structured logs (JSON-lines or key=value)

Safety model
────────────
  • All actions are READ_ONLY-compatible.
  • File size guard: reads at most MAX_READ_BYTES.
  • Path must be inside workspace_root.

Input params
────────────
  workspace_root : str   – required
  path           : str   – relative log file path (required)
  lines          : int   – number of lines for tail (default 100)
  pattern        : str   – regex pattern for search_log
  max_bytes      : int   – read limit (default 500_000)

Normalized output shapes
────────────────────────
  read_log   → { path, content, line_count, truncated }
  tail_log   → { path, lines: [str], line_count }
  search_log → { path, pattern, matches: [{line_no, content}], total }
  parse_log  → { path, entries: [dict], total, parse_errors }
"""
from __future__ import annotations

import os
import re
import json as _json
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import PathNotFoundError, PathUnsafeError, DevToolError
from app.devtools.normalizers import combine, require_param, require_str, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["read_log", "tail_log", "search_log", "parse_log"]
_DEFAULT_LINES     = 100
_MAX_READ_BYTES    = 500_000


class LogReaderTool(BaseDevTool):
    """Read, tail, search, and parse log files inside a workspace."""

    @property
    def name(self) -> str:
        return "log_reader"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.READ

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": True},
            "lines":          {"type": "integer", "required": False, "default": 100},
            "pattern":        {"type": "string",  "required": False},
            "max_bytes":      {"type": "integer", "required": False, "default": 500_000},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "read_log":   {"path": "str", "content": "str", "line_count": "int", "truncated": "bool"},
            "tail_log":   {"path": "str", "lines": ["str"], "line_count": "int"},
            "search_log": {"path": "str", "pattern": "str", "matches": "list", "total": "int"},
            "parse_log":  {"path": "str", "entries": "list", "total": "int", "parse_errors": "int"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p = tool_input.params
        base = [
            require_param(p, "workspace_root", param_type=str),
            require_param(p, "path",           param_type=str),
        ]
        if tool_input.action == "search_log":
            base.append(require_param(p, "pattern", param_type=str))
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
        path   = p["path"]

        abs_path  = self._safe_resolve(root, path)
        max_bytes = int(p.get("max_bytes", _MAX_READ_BYTES))

        logger.info("log_reader_tool.execute", action=action, path=abs_path)

        if action == "read_log":
            return self._read_log(abs_path, max_bytes)
        if action == "tail_log":
            n = int(p.get("lines", _DEFAULT_LINES))
            return self._tail_log(abs_path, n)
        if action == "search_log":
            return self._search_log(abs_path, p["pattern"], max_bytes)
        if action == "parse_log":
            return self._parse_log(abs_path, max_bytes)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "content" in norm:
            norm["content"] = truncate(norm.get("content") or "", 50_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _safe_resolve(self, root: str, path: str) -> str:
        if os.path.isabs(path):
            abs_path = os.path.realpath(path)
        else:
            abs_path = os.path.realpath(os.path.join(root, path))
        abs_root = os.path.realpath(root)
        if not (abs_path == abs_root or abs_path.startswith(abs_root + os.sep)):
            raise PathUnsafeError(path)
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)
        return abs_path

    def _read_log(self, path: str, max_bytes: int) -> dict:
        size      = os.path.getsize(path)
        truncated = size > max_bytes
        with open(path, "r", errors="replace") as fh:
            content = fh.read(max_bytes)
        line_count = content.count("\n")
        return {"path": path, "content": content,
                "line_count": line_count, "truncated": truncated}

    def _tail_log(self, path: str, n: int) -> dict:
        with open(path, "r", errors="replace") as fh:
            all_lines = fh.readlines()
        tail = [l.rstrip() for l in all_lines[-n:]]
        return {"path": path, "lines": tail, "line_count": len(tail)}

    def _search_log(self, path: str, pattern: str, max_bytes: int) -> dict:
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error:
            rx = re.compile(re.escape(pattern), re.IGNORECASE)

        matches = []
        with open(path, "r", errors="replace") as fh:
            for lineno, line in enumerate(fh, 1):
                if rx.search(line):
                    matches.append({"line_no": lineno, "content": line.rstrip()[:500]})

        return {"path": path, "pattern": pattern,
                "matches": matches, "total": len(matches)}

    def _parse_log(self, path: str, max_bytes: int) -> dict:
        entries = []
        errors  = 0
        with open(path, "r", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                # Try JSON-lines first
                if line.startswith("{"):
                    try:
                        entries.append(_json.loads(line))
                        continue
                    except _json.JSONDecodeError:
                        pass
                # Try key=value pairs
                kv_matches = re.findall(r'(\w+)=(?:"([^"]*?)"|(\S+))', line)
                if kv_matches:
                    kv = {k: (v1 if v1 else v2) for k, v1, v2 in kv_matches}
                    entries.append(kv)
                else:
                    errors += 1
        return {"path": path, "entries": entries,
                "total": len(entries), "parse_errors": errors}
