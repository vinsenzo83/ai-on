"""
app/tools/tools/ocr.py
──────────────────────
Phase 15 — Tool integration layer.

OcrTool: extract text from images using OCR.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  extract_text   – extract all text from an image
  detect_lang    – extract text and detect primary language
  extract_table  – attempt to extract table-like structures

Input params
────────────
  content : bytes  – raw image bytes (PNG, JPEG, TIFF, …) (required)
  lang    : str    – tesseract language hint, e.g. "eng", "kor" (default "eng")

Normalized output shape
───────────────────────
  extract_text:
    { "text": str, "word_count": int, "confidence": float | None }

  detect_lang:
    { "text": str, "detected_lang": str, "confidence": float | None }

  extract_table:
    { "text": str, "rows": list[list[str]], "row_count": int }

Design notes
────────────
  • Uses pytesseract (wrapper around Tesseract OCR).
  • pytesseract + Pillow are lazy imports.
  • Production: pip install pytesseract pillow  (+ Tesseract binary).
  • Tests can inject ``ocr_engine`` to bypass Tesseract entirely.
"""
from __future__ import annotations

import io
from typing import Any, Callable

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_bytes, require_param

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["extract_text", "detect_lang", "extract_table"]
_DEFAULT_LANG      = "eng"


class OcrTool(BaseTool):
    """Image OCR text extraction tool."""

    def __init__(self, ocr_engine: Callable | None = None) -> None:
        """
        Parameters
        ----------
        ocr_engine : optional callable(image_bytes, lang) -> str
                     When None, pytesseract is used.
        """
        self._ocr_engine = ocr_engine

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "ocr"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "content": {"type": "bytes",  "required": True,  "description": "Raw image bytes"},
            "lang":    {"type": "string", "required": False, "default": "eng",
                        "description": "Tesseract language code"},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "extract_text":  {"text": "str", "word_count": "int", "confidence": "float|None"},
            "detect_lang":   {"text": "str", "detected_lang": "str", "confidence": "float|None"},
            "extract_table": {"text": "str", "rows": "list[list[str]]", "row_count": "int"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p = tool_input.params
        return combine(
            require_param(p, "content", param_type=bytes),
            require_bytes(p.get("content", b""), "content"),
        )

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "text" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'text' key")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        content = tool_input.params["content"]
        lang    = tool_input.params.get("lang", _DEFAULT_LANG)
        action  = tool_input.action

        logger.info(
            "ocr_tool.execute",
            action      = action,
            lang        = lang,
            size_bytes  = len(content),
        )

        text = self._run_ocr(content, lang)

        if action == "extract_text":
            return {"action": action, "text": text}

        elif action == "detect_lang":
            detected = self._detect_lang(text)
            return {"action": action, "text": text, "detected_lang": detected}

        elif action == "extract_table":
            rows = self._parse_table(text)
            return {"action": action, "text": text, "rows": rows}

        else:
            raise ToolActionError(
                f"Unsupported action: {action}",
                error_code=ToolErrorCode.UNSUPPORTED_ACTION,
            )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        action = raw_output.get("action", "")
        text   = raw_output.get("text", "").strip()
        words  = [w for w in text.split() if w]

        if action == "extract_text":
            return {
                "text":       text,
                "word_count": len(words),
                "confidence": raw_output.get("confidence"),
            }
        elif action == "detect_lang":
            return {
                "text":          text,
                "detected_lang": raw_output.get("detected_lang", "unknown"),
                "confidence":    raw_output.get("confidence"),
            }
        elif action == "extract_table":
            rows = raw_output.get("rows", [])
            return {
                "text":      text,
                "rows":      rows,
                "row_count": len(rows),
            }
        return {"text": text, "word_count": len(words), "confidence": None}

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _run_ocr(self, content: bytes, lang: str) -> str:
        """Run OCR on image bytes and return extracted text string."""
        if self._ocr_engine is not None:
            return self._ocr_engine(content, lang)

        try:
            import pytesseract  # lazy import
            from PIL import Image
        except ImportError:
            raise ToolActionError(
                "pytesseract and Pillow are not installed. "
                "Run: pip install pytesseract pillow",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )

        try:
            image = Image.open(io.BytesIO(content))
            text  = pytesseract.image_to_string(image, lang=lang)
        except Exception as exc:
            raise ToolActionError(
                f"OCR failed: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

        return text

    def _detect_lang(self, text: str) -> str:
        """
        Naive language detection based on character ranges.
        Production: replace with langdetect or fasttext.
        """
        if not text.strip():
            return "unknown"
        # Count Korean characters
        korean = sum(1 for c in text if "\uAC00" <= c <= "\uD7A3")
        # Count CJK characters
        cjk    = sum(1 for c in text if "\u4E00" <= c <= "\u9FFF")
        total  = len([c for c in text if c.isalpha()])

        if total == 0:
            return "unknown"
        if korean / max(total, 1) > 0.3:
            return "ko"
        if cjk / max(total, 1) > 0.3:
            return "zh"
        return "en"

    def _parse_table(self, text: str) -> list[list[str]]:
        """
        Parse newline/tab-delimited text into a list of row lists.
        """
        rows: list[list[str]] = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped:
                cells = [c.strip() for c in stripped.split("\t") if c.strip()]
                if cells:
                    rows.append(cells)
        return rows
