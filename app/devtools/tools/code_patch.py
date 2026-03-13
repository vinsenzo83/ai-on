"""
app/devtools/tools/code_patch.py
──────────────────────────────────
Phase 16 — Stage A · Tool 3: Code Patching

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  apply_patch    – apply a unified-diff patch to a file
  view_diff      – compute a unified diff between two text blobs
  create_file    – create a new file (fails if exists unless overwrite=True)
  insert_lines   – insert lines at a given 1-based line number
  replace_lines  – replace a line range with new content

Safety model
────────────
  • All paths verified inside workspace_root.
  • All write actions require mode >= SAFE_WRITE.
  • apply_patch works on a copy-on-write basis; backup is kept
    with suffix .bak alongside the patched file (optional).

Input params
────────────
  workspace_root : str        – absolute workspace root (required for all)
  path           : str        – relative or absolute path of target file
  patch          : str        – unified-diff patch text (apply_patch)
  original       : str        – original text blob (view_diff)
  modified       : str        – modified text blob (view_diff)
  content        : str        – file content (create_file)
  overwrite      : bool       – allow overwrite on create_file (default False)
  start_line     : int        – 1-based insertion/replacement start
  end_line       : int        – 1-based replacement end (replace_lines only)
  lines          : list[str]  – new lines to insert or replace with
  keep_backup    : bool       – keep .bak file after apply_patch (default False)

Normalized output shapes
────────────────────────
  apply_patch   → { path, applied, hunks, backup_path }
  view_diff     → { diff: str, additions: int, removals: int }
  create_file   → { path, created, bytes_written }
  insert_lines  → { path, inserted_at, lines_added }
  replace_lines → { path, start_line, end_line, lines_replaced }
"""
from __future__ import annotations

import difflib
import os
import shutil
import textwrap
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import (
    DevToolError,
    PathNotFoundError,
    PathUnsafeError,
    PermissionError_,
)
from app.devtools.normalizers import combine, require_param, require_str
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = [
    "apply_patch",
    "view_diff",
    "create_file",
    "insert_lines",
    "replace_lines",
]

_WRITE_ACTIONS = {"apply_patch", "create_file", "insert_lines", "replace_lines"}


class CodePatchTool(BaseDevTool):
    """
    Apply / inspect code patches confined to a workspace root.

    Uses stdlib difflib — no external patch binary required.
    """

    @property
    def name(self) -> str:
        return "code_patch"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.WRITE

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": False},
            "patch":          {"type": "string",  "required": False},
            "original":       {"type": "string",  "required": False},
            "modified":       {"type": "string",  "required": False},
            "content":        {"type": "string",  "required": False},
            "overwrite":      {"type": "boolean", "required": False, "default": False},
            "start_line":     {"type": "integer", "required": False},
            "end_line":       {"type": "integer", "required": False},
            "lines":          {"type": "array",   "required": False},
            "keep_backup":    {"type": "boolean", "required": False, "default": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "apply_patch":   {"path": "str", "applied": "bool", "hunks": "int"},
            "view_diff":     {"diff": "str", "additions": "int", "removals": "int"},
            "create_file":   {"path": "str", "created": "bool", "bytes_written": "int"},
            "insert_lines":  {"path": "str", "inserted_at": "int", "lines_added": "int"},
            "replace_lines": {"path": "str", "start_line": "int", "end_line": "int", "lines_replaced": "int"},
        }

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY  # per-action check in validate_input

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base = [require_param(p, "workspace_root", param_type=str)]

        if action in _WRITE_ACTIONS:
            mode = tool_input.mode
            if mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires SAFE_WRITE or FULL mode; got {mode!r}"
                ))

        if action == "apply_patch":
            base += [
                require_param(p, "path",  param_type=str),
                require_param(p, "patch", param_type=str),
            ]
        elif action == "view_diff":
            base += [
                require_param(p, "original", param_type=str),
                require_param(p, "modified", param_type=str),
            ]
        elif action == "create_file":
            base += [
                require_param(p, "path",    param_type=str),
                require_param(p, "content", param_type=str),
            ]
        elif action in ("insert_lines", "replace_lines"):
            base += [
                require_param(p, "path",       param_type=str),
                require_param(p, "start_line", param_type=int),
                require_param(p, "lines",      param_type=list),
            ]
            if action == "replace_lines":
                base.append(require_param(p, "end_line", param_type=int))

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

        logger.info("code_patch_tool.execute", action=action)

        if action == "view_diff":
            return self._view_diff(p["original"], p["modified"],
                                   p.get("fromfile", "original"),
                                   p.get("tofile", "modified"))

        abs_path = self._safe_resolve(root, p["path"])

        if action == "apply_patch":
            return self._apply_patch(abs_path, p["patch"],
                                     bool(p.get("keep_backup", False)))
        if action == "create_file":
            return self._create_file(abs_path, p["content"],
                                     bool(p.get("overwrite", False)),
                                     p.get("encoding", "utf-8"))
        if action == "insert_lines":
            return self._insert_lines(abs_path, int(p["start_line"]),
                                      list(p["lines"]))
        if action == "replace_lines":
            return self._replace_lines(abs_path, int(p["start_line"]),
                                       int(p["end_line"]), list(p["lines"]))

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        return dict(raw)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _safe_resolve(self, root: str, path: str) -> str:
        if os.path.isabs(path):
            abs_path = os.path.realpath(path)
        else:
            abs_path = os.path.realpath(os.path.join(root, path))
        abs_root = os.path.realpath(root)
        if not (abs_path == abs_root or abs_path.startswith(abs_root + os.sep)):
            raise PathUnsafeError(path)
        return abs_path

    def _view_diff(self, original: str, modified: str,
                   fromfile: str, tofile: str) -> dict[str, Any]:
        orig_lines = original.splitlines(keepends=True)
        mod_lines  = modified.splitlines(keepends=True)
        diff_lines = list(
            difflib.unified_diff(orig_lines, mod_lines,
                                 fromfile=fromfile, tofile=tofile)
        )
        diff_text  = "".join(diff_lines)
        additions  = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
        removals   = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))
        return {"diff": diff_text, "additions": additions, "removals": removals}

    def _apply_patch(self, abs_path: str, patch_text: str,
                     keep_backup: bool) -> dict[str, Any]:
        """
        Apply a unified diff patch using difflib's SequenceMatcher.

        This is a minimal implementation that handles standard unified-diff
        output. For complex multi-file patches, callers should use the
        TerminalTool to invoke `patch` directly.
        """
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)

        with open(abs_path, "r", errors="replace") as fh:
            original_lines = fh.readlines()

        # Parse the patch into hunks
        hunks = self._parse_unified_diff(patch_text)
        if not hunks:
            return {"path": abs_path, "applied": False, "hunks": 0, "backup_path": None}

        # Apply hunks in reverse order (bottom-up) so line numbers stay valid
        patched = list(original_lines)
        for hunk in sorted(hunks, key=lambda h: h["orig_start"], reverse=True):
            orig_start = hunk["orig_start"] - 1   # convert to 0-based
            orig_count = hunk["orig_count"]
            new_lines  = hunk["new_lines"]
            # Replace the range
            patched[orig_start : orig_start + orig_count] = new_lines

        backup_path = None
        if keep_backup:
            backup_path = abs_path + ".bak"
            shutil.copy2(abs_path, backup_path)

        with open(abs_path, "w") as fh:
            fh.writelines(patched)

        return {
            "path":        abs_path,
            "applied":     True,
            "hunks":       len(hunks),
            "backup_path": backup_path,
        }

    def _parse_unified_diff(self, patch_text: str) -> list[dict]:
        """Parse unified diff hunks from patch_text."""
        hunks: list[dict] = []
        current: dict | None = None

        for line in patch_text.splitlines(keepends=True):
            if line.startswith("@@"):
                # @@ -orig_start,orig_count +new_start,new_count @@
                import re
                m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
                if m:
                    if current:
                        hunks.append(current)
                    current = {
                        "orig_start": int(m.group(1)),
                        "orig_count": int(m.group(2) or 1),
                        "new_start":  int(m.group(3)),
                        "new_count":  int(m.group(4) or 1),
                        "new_lines":  [],
                    }
            elif current is not None:
                if line.startswith("+") and not line.startswith("+++"):
                    current["new_lines"].append(line[1:])
                elif line.startswith(" "):
                    current["new_lines"].append(line[1:])
                # Lines starting with "-" are removed — not added to new_lines

        if current:
            hunks.append(current)
        return hunks

    def _create_file(self, abs_path: str, content: str,
                     overwrite: bool, encoding: str) -> dict[str, Any]:
        if os.path.exists(abs_path) and not overwrite:
            raise DevToolError(
                f"File already exists: {abs_path!r}. Use overwrite=True to replace.",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        parent = os.path.dirname(abs_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        created = not os.path.exists(abs_path)
        try:
            with open(abs_path, "w", encoding=encoding) as fh:
                fh.write(content)
        except OSError as exc:
            raise DevToolError(
                f"Could not write {abs_path!r}: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            ) from exc
        return {
            "path":          abs_path,
            "created":       created,
            "bytes_written": len(content.encode(encoding)),
        }

    def _insert_lines(self, abs_path: str, start_line: int,
                      new_lines: list[str]) -> dict[str, Any]:
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)
        with open(abs_path, "r", errors="replace") as fh:
            lines = fh.readlines()
        idx = max(0, start_line - 1)
        # Ensure each inserted line ends with \n
        to_insert = [
            (l if l.endswith("\n") else l + "\n") for l in new_lines
        ]
        lines[idx:idx] = to_insert
        with open(abs_path, "w") as fh:
            fh.writelines(lines)
        return {
            "path":        abs_path,
            "inserted_at": start_line,
            "lines_added": len(new_lines),
        }

    def _replace_lines(self, abs_path: str, start_line: int, end_line: int,
                        new_lines: list[str]) -> dict[str, Any]:
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)
        with open(abs_path, "r", errors="replace") as fh:
            lines = fh.readlines()
        s = max(0, start_line - 1)
        e = min(end_line, len(lines))
        replaced_count = e - s
        to_replace = [
            (l if l.endswith("\n") else l + "\n") for l in new_lines
        ]
        lines[s:e] = to_replace
        with open(abs_path, "w") as fh:
            fh.writelines(lines)
        return {
            "path":           abs_path,
            "start_line":     start_line,
            "end_line":       end_line,
            "lines_replaced": replaced_count,
        }
