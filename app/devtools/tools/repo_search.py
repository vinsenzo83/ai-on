"""
app/devtools/tools/repo_search.py
──────────────────────────────────
Phase 16 — Stage A · Tool 1: Repository / File Search

Supported actions
─────────────────
  search_files    – find files by name pattern (glob)
  search_content  – grep files for a text / regex pattern
  search_symbols  – find function/class definitions by name

Input params (all actions)
──────────────────────────
  workspace_root : str  – absolute path to search root (required)
  query          : str  – filename glob OR content pattern (required)
  path           : str  – sub-path to restrict search (optional, default ".")
  max_results    : int  – max matches to return (default 50, max 200)
  case_sensitive : bool – case-sensitive search (default False)
  include_hidden : bool – include dot-files/dirs (default False)

Normalized output
─────────────────
  {
    "query":   str,
    "action":  str,
    "matches": [{"path": str, "line": int|None, "snippet": str}],
    "total":   int
  }
"""
from __future__ import annotations

import fnmatch
import os
import re
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import PathNotFoundError
from app.devtools.normalizers import combine, require_param, require_safe_path, require_str
from app.devtools.types       import (
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["search_files", "search_content", "search_symbols"]
_DEFAULT_MAX       = 50
_MAX_RESULTS       = 200
_SYMBOL_RE         = re.compile(
    r"^\s*(?:def|class|async def)\s+(\w+)", re.MULTILINE
)


class RepoSearchTool(BaseDevTool):
    """Repository / file search tool."""

    @property
    def name(self) -> str:
        return "repo_search"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.READ

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "query":          {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": False, "default": "."},
            "max_results":    {"type": "integer", "required": False, "default": 50},
            "case_sensitive": {"type": "boolean", "required": False, "default": False},
            "include_hidden": {"type": "boolean", "required": False, "default": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "query":   "str",
            "action":  "str",
            "matches": [{"path": "str", "line": "int|None", "snippet": "str"}],
            "total":   "int",
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p = tool_input.params
        checks = [
            require_param(p, "workspace_root", param_type=str),
            require_param(p, "query",          param_type=str),
            require_str(p.get("query", ""),          "query"),
            require_str(p.get("workspace_root", ""), "workspace_root"),
        ]
        return combine(*checks)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        if "matches" not in raw:
            return DevToolValidationResult.fail("missing 'matches' key")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p              = tool_input.params
        workspace_root = p["workspace_root"]
        query          = p["query"]
        sub_path       = p.get("path", ".")
        max_results    = min(int(p.get("max_results", _DEFAULT_MAX)), _MAX_RESULTS)
        case_sensitive = bool(p.get("case_sensitive", False))
        include_hidden = bool(p.get("include_hidden", False))
        action         = tool_input.action

        search_root = os.path.normpath(os.path.join(workspace_root, sub_path))
        if not os.path.exists(search_root):
            raise PathNotFoundError(search_root)

        logger.info(
            "repo_search.execute",
            action     = action,
            query      = query,
            root       = search_root,
        )

        if action == "search_files":
            matches = self._search_files(
                search_root, query, max_results, include_hidden, case_sensitive
            )
        elif action == "search_content":
            matches = self._search_content(
                search_root, query, max_results, include_hidden, case_sensitive
            )
        elif action == "search_symbols":
            matches = self._search_symbols(
                search_root, query, max_results, include_hidden, case_sensitive
            )
        else:
            matches = []

        return {
            "action":  action,
            "query":   query,
            "matches": matches,
        }

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        matches = raw.get("matches", [])
        return {
            "query":   raw.get("query",  ""),
            "action":  raw.get("action", ""),
            "matches": [
                {
                    "path":    str(m.get("path",    "")),
                    "line":    m.get("line"),
                    "snippet": str(m.get("snippet", ""))[:300],
                }
                for m in matches
            ],
            "total": len(matches),
        }

    # ── Internal search methods ───────────────────────────────────────────────

    def _walk(
        self, root: str, include_hidden: bool
    ):
        """Yield (dirpath, filenames) filtering hidden entries if needed."""
        for dirpath, dirnames, filenames in os.walk(root):
            if not include_hidden:
                dirnames[:] = [d for d in dirnames if not d.startswith(".")]
                filenames   = [f for f in filenames if not f.startswith(".")]
            yield dirpath, filenames

    def _search_files(
        self,
        root:           str,
        pattern:        str,
        max_results:    int,
        include_hidden: bool,
        case_sensitive: bool,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        if not case_sensitive:
            pattern = pattern.lower()

        for dirpath, filenames in self._walk(root, include_hidden):
            for fname in filenames:
                cmp = fname if case_sensitive else fname.lower()
                if fnmatch.fnmatch(cmp, pattern):
                    rel = os.path.relpath(
                        os.path.join(dirpath, fname), root
                    )
                    matches.append({"path": rel, "line": None, "snippet": fname})
                    if len(matches) >= max_results:
                        return matches
        return matches

    def _search_content(
        self,
        root:           str,
        pattern:        str,
        max_results:    int,
        include_hidden: bool,
        case_sensitive: bool,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            rx = re.compile(pattern, flags)
        except re.error:
            # Fall back to literal search
            escaped = re.escape(pattern)
            rx = re.compile(escaped, flags)

        for dirpath, filenames in self._walk(root, include_hidden):
            for fname in filenames:
                fpath = os.path.join(dirpath, fname)
                try:
                    with open(fpath, "r", errors="replace") as fh:
                        for lineno, line in enumerate(fh, 1):
                            if rx.search(line):
                                rel = os.path.relpath(fpath, root)
                                matches.append({
                                    "path":    rel,
                                    "line":    lineno,
                                    "snippet": line.rstrip()[:200],
                                })
                                if len(matches) >= max_results:
                                    return matches
                except (OSError, PermissionError):
                    continue
        return matches

    def _search_symbols(
        self,
        root:           str,
        query:          str,
        max_results:    int,
        include_hidden: bool,
        case_sensitive: bool,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            sym_rx = re.compile(query, flags)
        except re.error:
            sym_rx = re.compile(re.escape(query), flags)

        for dirpath, filenames in self._walk(root, include_hidden):
            for fname in filenames:
                if not fname.endswith(".py"):
                    continue
                fpath = os.path.join(dirpath, fname)
                try:
                    with open(fpath, "r", errors="replace") as fh:
                        for lineno, line in enumerate(fh, 1):
                            m = _SYMBOL_RE.match(line)
                            if m and sym_rx.search(m.group(1)):
                                rel = os.path.relpath(fpath, root)
                                matches.append({
                                    "path":    rel,
                                    "line":    lineno,
                                    "snippet": line.rstrip()[:200],
                                })
                                if len(matches) >= max_results:
                                    return matches
                except (OSError, PermissionError):
                    continue
        return matches
