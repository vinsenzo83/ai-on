"""
app/devtools/tools/doc_export.py
──────────────────────────────────
Phase 16 — Stage C · Tool 17: Documentation / Report Export

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  generate_readme  – generate a README.md from workspace introspection
  export_markdown  – export a file or directory as Markdown
  generate_report  – generate a structured JSON report of the workspace
  export_pdf       – export Markdown to PDF using weasyprint/pandoc (optional)

Safety model
────────────
  • generate_readme / export_markdown / generate_report require SAFE_WRITE.
  • export_pdf requires SAFE_WRITE + optional dependency.
  • All paths verified inside workspace_root.

Input params
────────────
  workspace_root : str  – required
  path           : str  – source path (export_markdown, export_pdf)
  output_path    : str  – output file path (required for export_* actions)
  title          : str  – report / readme title (optional)
  include_tree   : bool – include directory tree in readme (default True)

Normalized output shapes
────────────────────────
  generate_readme → { output_path, lines, success }
  export_markdown → { output_path, size_bytes, success }
  generate_report → { output_path, sections: [str], success }
  export_pdf      → { output_path, success, method }
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DevToolError, PathUnsafeError
from app.devtools.normalizers import combine, require_param
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["generate_readme", "export_markdown", "generate_report", "export_pdf"]


class DocExportTool(BaseDevTool):
    """Generate documentation and export reports for a workspace."""

    @property
    def name(self) -> str:
        return "doc_export"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXPORT

    def requires_mode(self) -> str:
        return DevToolMode.SAFE_WRITE

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "path":           {"type": "string",  "required": False},
            "output_path":    {"type": "string",  "required": False},
            "title":          {"type": "string",  "required": False},
            "include_tree":   {"type": "boolean", "required": False, "default": True},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "generate_readme": {"output_path": "str", "lines": "int", "success": "bool"},
            "export_markdown": {"output_path": "str", "size_bytes": "int", "success": "bool"},
            "generate_report": {"output_path": "str", "sections": "list", "success": "bool"},
            "export_pdf":      {"output_path": "str", "success": "bool", "method": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if tool_input.mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
            base.append(DevToolValidationResult.fail(
                "DocExportTool requires SAFE_WRITE or FULL mode"
            ))

        if action in ("export_markdown", "export_pdf"):
            base.append(require_param(p, "path",        param_type=str))
            base.append(require_param(p, "output_path", param_type=str))

        if action == "generate_report":
            base.append(require_param(p, "output_path", param_type=str))

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
        title  = p.get("title", os.path.basename(root) or "Project")

        logger.info("doc_export_tool.execute", action=action)

        if action == "generate_readme":
            out_path = p.get("output_path", os.path.join(root, "README.md"))
            return self._generate_readme(root, out_path, title,
                                         bool(p.get("include_tree", True)))

        if action == "export_markdown":
            src  = self._safe_resolve(root, p["path"])
            dest = self._safe_resolve(root, p["output_path"])
            return self._export_markdown(src, dest)

        if action == "generate_report":
            dest = self._safe_resolve(root, p["output_path"])
            return self._generate_report(root, dest, title)

        if action == "export_pdf":
            src  = self._safe_resolve(root, p["path"])
            dest = self._safe_resolve(root, p["output_path"])
            return await self._export_pdf(src, dest)

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

    def _build_tree(self, root: str, prefix: str = "", depth: int = 0,
                    max_depth: int = 3) -> list[str]:
        """Build a directory tree (max_depth levels deep)."""
        if depth > max_depth:
            return []
        lines = []
        try:
            entries = sorted(os.scandir(root), key=lambda e: (e.is_file(), e.name))
        except OSError:
            return []
        for entry in entries:
            if entry.name.startswith(".") or entry.name in (
                "__pycache__", "node_modules", "venv", ".venv", "dist"
            ):
                continue
            connector = "└── " if entry == entries[-1] else "├── "
            lines.append(f"{prefix}{connector}{entry.name}")
            if entry.is_dir(follow_symlinks=False):
                ext = "    " if entry == entries[-1] else "│   "
                lines.extend(
                    self._build_tree(entry.path, prefix + ext, depth + 1, max_depth)
                )
        return lines

    def _generate_readme(self, root: str, output_path: str, title: str,
                          include_tree: bool) -> dict:
        lines = [
            f"# {title}",
            "",
            f"> Auto-generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}.",
            "",
            "## Overview",
            "",
            "This README was generated by the Phase 16 DevTools layer.",
            "",
        ]
        if include_tree:
            tree = self._build_tree(root)
            if tree:
                lines += ["## Project Structure", "", "```", os.path.basename(root) + "/"]
                lines += tree
                lines += ["```", ""]

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w") as fh:
            fh.write("\n".join(lines) + "\n")

        return {"output_path": output_path, "lines": len(lines), "success": True}

    def _export_markdown(self, src: str, dest: str) -> dict:
        if os.path.isdir(src):
            content_parts = []
            for dirpath, _, filenames in os.walk(src):
                for fname in sorted(filenames):
                    if fname.endswith(".md"):
                        fpath = os.path.join(dirpath, fname)
                        with open(fpath, "r", errors="replace") as fh:
                            content_parts.append(fh.read())
            content = "\n\n---\n\n".join(content_parts)
        else:
            with open(src, "r", errors="replace") as fh:
                content = fh.read()

        os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
        with open(dest, "w") as fh:
            fh.write(content)
        return {"output_path": dest, "size_bytes": os.path.getsize(dest), "success": True}

    def _generate_report(self, root: str, output_path: str, title: str) -> dict:
        sections = []
        # Count files by extension
        ext_counts: dict[str, int] = {}
        total_files = 0
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames
                           if not d.startswith(".")
                           and d not in ("__pycache__", "node_modules", ".venv")]
            for f in filenames:
                ext = os.path.splitext(f)[1].lower() or "no_ext"
                ext_counts[ext] = ext_counts.get(ext, 0) + 1
                total_files += 1

        report = {
            "title":        title,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "workspace":    root,
            "total_files":  total_files,
            "by_extension": ext_counts,
        }
        sections.append("summary")
        sections.append("file_types")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w") as fh:
            json.dump(report, fh, indent=2)

        return {"output_path": output_path, "sections": sections, "success": True}

    async def _export_pdf(self, src: str, dest: str) -> dict:
        """Attempt to export Markdown → PDF via pandoc then weasyprint."""
        import asyncio
        method = "unsupported"
        # Try pandoc first
        proc = await asyncio.create_subprocess_exec(
            "pandoc", src, "-o", dest,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        if proc.returncode == 0:
            method = "pandoc"
        else:
            # Try weasyprint
            try:
                from weasyprint import HTML
                with open(src, "r") as fh:
                    content = fh.read()
                HTML(string=f"<pre>{content}</pre>").write_pdf(dest)
                method = "weasyprint"
            except ImportError:
                raise DevToolError(
                    "PDF export requires pandoc or weasyprint.",
                    error_code=DevToolErrorCode.DEPENDENCY_ERROR,
                )

        return {"output_path": dest, "success": True, "method": method}
