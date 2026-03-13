"""
app/tools/tools/pdf.py
──────────────────────
Phase 15 — Tool integration layer.

PdfTool: extract text, metadata, and page count from PDF files.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  extract_text     – extract all text from a PDF
  extract_metadata – extract title, author, page count, creation date
  extract_page     – extract text from a specific page number

Input params
────────────
  content : bytes  – raw PDF bytes (required for all actions)
  page    : int    – page number, 1-indexed (extract_page only)

Normalized output shape
───────────────────────
  extract_text:
    { "text": str, "page_count": int, "char_count": int }

  extract_metadata:
    { "title": str, "author": str, "page_count": int,
      "created": str, "modified": str, "producer": str }

  extract_page:
    { "page": int, "text": str, "char_count": int }

Design notes
────────────
  • Uses pypdf (pure Python, no system dependencies).
  • pypdf is a lazy import so the tool loads without it in test envs
    that pass pre-built raw_output via a mock ``pdf_reader_factory``.
  • Production: pip install pypdf
"""
from __future__ import annotations

import io
from typing import Any, Callable

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_bytes, require_param

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["extract_text", "extract_metadata", "extract_page"]


class PdfTool(BaseTool):
    """PDF text and metadata extraction tool."""

    def __init__(self, pdf_reader_factory: Callable | None = None) -> None:
        """
        Parameters
        ----------
        pdf_reader_factory : optional callable that accepts (bytes) and returns
                             a PdfReader-compatible object (for tests/mocking).
                             When None, pypdf.PdfReader is used.
        """
        self._reader_factory = pdf_reader_factory

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "pdf"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "content": {"type": "bytes",   "required": True,  "description": "Raw PDF bytes"},
            "page":    {"type": "integer", "required": False, "description": "1-indexed page (extract_page only)"},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "extract_text":     {"text": "str", "page_count": "int", "char_count": "int"},
            "extract_metadata": {"title": "str", "author": "str", "page_count": "int",
                                 "created": "str", "modified": "str", "producer": "str"},
            "extract_page":     {"page": "int", "text": "str", "char_count": "int"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p = tool_input.params
        base = combine(
            require_param(p, "content", param_type=bytes),
            require_bytes(p.get("content", b""), "content"),
        )
        if not base.passed:
            return base
        if tool_input.action == "extract_page":
            if "page" not in p:
                return ToolValidationResult.fail(
                    "Missing required param 'page' for extract_page action"
                )
            if not isinstance(p["page"], int) or p["page"] < 1:
                return ToolValidationResult.fail(
                    "'page' must be a positive integer (1-indexed)"
                )
        return ToolValidationResult.ok()

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "action" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'action' key")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        content = tool_input.params["content"]
        action  = tool_input.action

        logger.info("pdf_tool.execute", action=action, size_bytes=len(content))

        reader = self._get_reader(content)

        if action == "extract_text":
            return self._extract_text(reader, action)
        elif action == "extract_metadata":
            return self._extract_metadata(reader, action)
        elif action == "extract_page":
            page_num = tool_input.params["page"]
            return self._extract_page(reader, page_num, action)
        else:
            raise ToolActionError(
                f"Unsupported action: {action}",
                error_code=ToolErrorCode.UNSUPPORTED_ACTION,
            )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        action = raw_output.get("action", "")
        if action == "extract_text":
            return {
                "text":       raw_output.get("text", "").strip(),
                "page_count": raw_output.get("page_count", 0),
                "char_count": len(raw_output.get("text", "").strip()),
            }
        elif action == "extract_metadata":
            meta = raw_output.get("metadata", {})
            return {
                "title":      str(meta.get("/Title",    meta.get("title",    ""))),
                "author":     str(meta.get("/Author",   meta.get("author",   ""))),
                "page_count": raw_output.get("page_count", 0),
                "created":    str(meta.get("/CreationDate", "")),
                "modified":   str(meta.get("/ModDate",      "")),
                "producer":   str(meta.get("/Producer",     "")),
            }
        elif action == "extract_page":
            return {
                "page":       raw_output.get("page", 1),
                "text":       raw_output.get("text", "").strip(),
                "char_count": len(raw_output.get("text", "").strip()),
            }
        return raw_output

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _get_reader(self, content: bytes) -> Any:
        if self._reader_factory is not None:
            return self._reader_factory(content)
        try:
            import pypdf  # lazy import
        except ImportError:
            raise ToolActionError(
                "pypdf is not installed. Run: pip install pypdf",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )
        try:
            return pypdf.PdfReader(io.BytesIO(content))
        except Exception as exc:
            raise ToolActionError(
                f"Failed to parse PDF: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

    def _extract_text(self, reader: Any, action: str) -> dict[str, Any]:
        pages = reader.pages
        parts = []
        for page in pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                parts.append("")
        return {
            "action":     action,
            "text":       "\n".join(parts),
            "page_count": len(pages),
        }

    def _extract_metadata(self, reader: Any, action: str) -> dict[str, Any]:
        try:
            meta = dict(reader.metadata) if reader.metadata else {}
        except Exception:
            meta = {}
        return {
            "action":     action,
            "metadata":   meta,
            "page_count": len(reader.pages),
        }

    def _extract_page(
        self, reader: Any, page_num: int, action: str
    ) -> dict[str, Any]:
        pages = reader.pages
        if page_num > len(pages):
            raise ToolActionError(
                f"PDF has {len(pages)} page(s); requested page {page_num}",
                error_code=ToolErrorCode.INPUT_INVALID,
            )
        try:
            text = pages[page_num - 1].extract_text() or ""
        except Exception as exc:
            raise ToolActionError(
                f"Failed to extract page {page_num}: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc
        return {"action": action, "page": page_num, "text": text}
