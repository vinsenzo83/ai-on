"""
app/devtools/tools/filesystem.py
──────────────────────────────────
Phase 16 — Stage A · Tool 2: Filesystem Operations

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  read_file   – read a file's text content (with optional line range)
  write_file  – write/overwrite a file (SAFE_WRITE mode required)
  list_dir    – list directory contents
  delete_file – delete a file (SAFE_WRITE mode required)
  move_file   – rename/move a file within workspace (SAFE_WRITE required)

Safety model
────────────
  • All paths are verified to stay inside workspace_root (PathUnsafeError).
  • write_file / delete_file / move_file require mode >= SAFE_WRITE.
  • read_file is always READ_ONLY-compatible.
  • Files larger than MAX_READ_BYTES are truncated and flagged.

Input params
────────────
  workspace_root : str  – absolute workspace root (required for all)
  path           : str  – relative path from workspace_root (required)
  content        : str  – file content for write_file (required)
  destination    : str  – destination path for move_file (required)
  start_line     : int  – first line to read (1-based, optional)
  end_line       : int  – last  line to read (1-based, optional)
  encoding       : str  – file encoding (default "utf-8")

Normalized output shapes
────────────────────────
  read_file  → { path, content, total_lines, truncated }
  write_file → { path, bytes_written, created }
  list_dir   → { path, entries: [{name, type, size}] }
  delete_file→ { path, deleted }
  move_file  → { src, dst, moved }
"""
from __future__ import annotations

import os
import shutil
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import (
    DevToolError,
    PathNotFoundError,
    PathUnsafeError,
    PermissionError_,
)
from app.devtools.normalizers import combine, require_param, require_str, require_safe_path
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = [
    "read_file",
    "write_file",
    "list_dir",
    "delete_file",
    "move_file",
]

# Max bytes we will read into memory for a single read_file call.
MAX_READ_BYTES = 1_000_000  # 1 MB


class FilesystemTool(BaseDevTool):
    """
    Safe filesystem operations confined to a workspace root.

    All path arguments are validated to be inside workspace_root
    before any I/O is performed.
    """

    @property
    def name(self) -> str:
        return "filesystem"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        # Declared as WRITE so the executor knows write-level actions exist.
        # Individual actions are further mode-checked in validate_input.
        return DevToolOpType.WRITE

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": True},
            "content":        {"type": "string",  "required": False},  # write_file
            "destination":    {"type": "string",  "required": False},  # move_file
            "start_line":     {"type": "integer", "required": False},
            "end_line":       {"type": "integer", "required": False},
            "encoding":       {"type": "string",  "required": False, "default": "utf-8"},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "read_file":   {"path": "str", "content": "str",  "total_lines": "int", "truncated": "bool"},
            "write_file":  {"path": "str", "bytes_written": "int", "created": "bool"},
            "list_dir":    {"path": "str", "entries": [{"name": "str", "type": "str", "size": "int"}]},
            "delete_file": {"path": "str", "deleted": "bool"},
            "move_file":   {"src": "str",  "dst": "str", "moved": "bool"},
        }

    # ── Mode-level requirements ───────────────────────────────────────────────

    def requires_mode(self) -> str:
        """
        This tool has mixed-mode actions; the executor mode-gate uses the
        class-level op_type (WRITE → SAFE_WRITE). read_file is safe in any
        mode — the per-action check in validate_input handles the split.
        """
        return DevToolMode.READ_ONLY  # executor gate is permissive; per-action check below

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base_checks = [
            require_param(p, "workspace_root", param_type=str),
            require_param(p, "path",           param_type=str),
            require_str(p.get("workspace_root", ""), "workspace_root"),
            require_str(p.get("path", ""),           "path"),
        ]

        # write / delete / move need at least SAFE_WRITE mode
        if action in ("write_file", "delete_file", "move_file"):
            mode = tool_input.mode
            if mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
                base_checks.append(
                    DevToolValidationResult.fail(
                        f"Action {action!r} requires mode=SAFE_WRITE or FULL; "
                        f"got mode={mode!r}"
                    )
                )

        if action == "write_file":
            base_checks.append(require_param(p, "content", param_type=str))

        if action == "move_file":
            base_checks.append(require_param(p, "destination", param_type=str))

        return combine(*base_checks)

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

        # Resolve and verify path safety
        abs_path = self._safe_resolve(root, path)

        logger.info(
            "filesystem_tool.execute",
            action   = action,
            abs_path = abs_path,
        )

        if action == "read_file":
            return self._read_file(abs_path, p)
        if action == "write_file":
            return self._write_file(abs_path, p)
        if action == "list_dir":
            return self._list_dir(abs_path)
        if action == "delete_file":
            return self._delete_file(abs_path)
        if action == "move_file":
            dst_path = self._safe_resolve(root, p["destination"])
            return self._move_file(abs_path, dst_path)

        # Should not reach here — executor checks can_handle first.
        raise DevToolError(
            f"Unknown action: {action!r}",
            error_code=DevToolErrorCode.UNSUPPORTED_ACTION,
        )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        """Pass-through — raw output is already normalised per action."""
        return dict(raw)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _safe_resolve(self, root: str, path: str) -> str:
        """Resolve path inside root; raise PathUnsafeError if it escapes."""
        if os.path.isabs(path):
            abs_path = os.path.realpath(path)
        else:
            abs_path = os.path.realpath(os.path.join(root, path))
        abs_root = os.path.realpath(root)

        if not (abs_path == abs_root or abs_path.startswith(abs_root + os.sep)):
            raise PathUnsafeError(path)
        return abs_path

    def _read_file(self, abs_path: str, params: dict) -> dict[str, Any]:
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)

        encoding   = params.get("encoding", "utf-8")
        start_line = params.get("start_line")
        end_line   = params.get("end_line")
        truncated  = False

        try:
            size = os.path.getsize(abs_path)
            if size > MAX_READ_BYTES:
                truncated = True
                with open(abs_path, "r", encoding=encoding, errors="replace") as fh:
                    raw_content = fh.read(MAX_READ_BYTES)
            else:
                with open(abs_path, "r", encoding=encoding, errors="replace") as fh:
                    raw_content = fh.read()
        except OSError as exc:
            raise DevToolError(
                f"Could not read {abs_path!r}: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            ) from exc

        lines = raw_content.splitlines()
        total_lines = len(lines)

        if start_line is not None or end_line is not None:
            s = (start_line - 1) if start_line else 0
            e = end_line if end_line else total_lines
            lines = lines[s:e]
            raw_content = "\n".join(lines)

        return {
            "path":        abs_path,
            "content":     raw_content,
            "total_lines": total_lines,
            "truncated":   truncated,
        }

    def _write_file(self, abs_path: str, params: dict) -> dict[str, Any]:
        content  = params.get("content", "")
        encoding = params.get("encoding", "utf-8")
        created  = not os.path.exists(abs_path)

        parent = os.path.dirname(abs_path)
        if parent:
            os.makedirs(parent, exist_ok=True)

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
            "bytes_written": len(content.encode(encoding)),
            "created":       created,
        }

    def _list_dir(self, abs_path: str) -> dict[str, Any]:
        if not os.path.isdir(abs_path):
            raise PathNotFoundError(abs_path)

        entries = []
        try:
            for entry in sorted(os.scandir(abs_path), key=lambda e: e.name):
                try:
                    stat = entry.stat(follow_symlinks=False)
                    size = stat.st_size
                except OSError:
                    size = -1
                entries.append({
                    "name": entry.name,
                    "type": "dir" if entry.is_dir(follow_symlinks=False) else "file",
                    "size": size,
                })
        except PermissionError as exc:
            raise PermissionError_(str(exc)) from exc

        return {"path": abs_path, "entries": entries}

    def _delete_file(self, abs_path: str) -> dict[str, Any]:
        if not os.path.exists(abs_path):
            raise PathNotFoundError(abs_path)
        if os.path.isdir(abs_path):
            raise DevToolError(
                f"{abs_path!r} is a directory — use a directory removal tool.",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        try:
            os.remove(abs_path)
        except OSError as exc:
            raise DevToolError(
                f"Could not delete {abs_path!r}: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            ) from exc

        return {"path": abs_path, "deleted": True}

    def _move_file(self, src: str, dst: str) -> dict[str, Any]:
        if not os.path.exists(src):
            raise PathNotFoundError(src)
        dst_parent = os.path.dirname(dst)
        if dst_parent:
            os.makedirs(dst_parent, exist_ok=True)
        try:
            shutil.move(src, dst)
        except OSError as exc:
            raise DevToolError(
                f"Could not move {src!r} → {dst!r}: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            ) from exc

        return {"src": src, "dst": dst, "moved": True}
