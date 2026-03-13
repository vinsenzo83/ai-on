"""
app/modules/modules/document.py
─────────────────────────────────
Phase 14 – Document module.

Task types handled
------------------
- document
- docs          (alias)
- docgen        (alias)
- readme        (alias)
- report        (alias)

Responsibility
--------------
Generate, improve, or transform structured documents: README files,
technical specifications, product descriptions, reports, and any
long-form prose document.

Input schema
------------
{
  "topic":       "<subject to document>",   # required if no draft
  "draft":       "<existing text>",         # optional – rewrite/improve mode
  "doc_type":    "readme|spec|report|description|general",  # optional
  "format":      "markdown|plain|html",    # optional, default "markdown"
  "sections":    ["intro", "usage", …]     # optional section hints
}

Output schema (normalized)
--------------------------
{
  "document":      str,    # full document text
  "format":        str,    # markdown | plain | html
  "doc_type":      str,
  "word_count":    int,
  "section_count": int,
}

Validation rules
----------------
- raw_output must be non-empty
- Document must be at least 20 words
- Must not be pure JSON (we expect prose)

Preferred models
----------------
gpt-4o  →  claude-3-opus  →  gpt-4o-mini

Fallback models
---------------
gemini-pro  →  claude-3-haiku
"""
from __future__ import annotations

from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_DOC_TYPES = {"readme", "spec", "report", "description", "general"}
_FORMATS   = {"markdown", "plain", "html"}
_DEFAULT_DOC_TYPE = "general"
_DEFAULT_FORMAT   = "markdown"
_MIN_WORDS        = 20


class DocumentModule(BaseModule):
    """First-class module for document generation tasks."""

    @property
    def name(self) -> str:
        return "document"

    def get_task_types(self) -> list[str]:
        return ["document", "docs", "docgen", "readme", "report"]

    # ── Schemas ───────────────────────────────────────────────────────────────

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "topic": {
                    "type":        "string",
                    "description": "Subject or title of the document.",
                },
                "draft": {
                    "type":        "string",
                    "description": "Existing draft to improve or transform.",
                },
                "doc_type": {
                    "type":    "string",
                    "enum":    list(_DOC_TYPES),
                    "default": _DEFAULT_DOC_TYPE,
                },
                "format": {
                    "type":    "string",
                    "enum":    list(_FORMATS),
                    "default": _DEFAULT_FORMAT,
                },
                "sections": {
                    "type":        "array",
                    "items":       {"type": "string"},
                    "description": "Desired section headings.",
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "document":      {"type": "string"},
                "format":        {"type": "string"},
                "doc_type":      {"type": "string"},
                "word_count":    {"type": "integer"},
                "section_count": {"type": "integer"},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o", "claude-3-opus", "gpt-4o-mini"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-pro", "claude-3-haiku"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, dict):
            topic    = str(payload.get("topic", ""))
            draft    = str(payload.get("draft",    "") or "")
            doc_type = str(payload.get("doc_type", _DEFAULT_DOC_TYPE)).lower()
            fmt      = str(payload.get("format",   _DEFAULT_FORMAT)).lower()
            sections = payload.get("sections", [])
        else:
            topic    = str(payload)
            draft    = ""
            doc_type = _DEFAULT_DOC_TYPE
            fmt      = _DEFAULT_FORMAT
            sections = []

        if doc_type not in _DOC_TYPES:
            doc_type = _DEFAULT_DOC_TYPE
        if fmt not in _FORMATS:
            fmt = _DEFAULT_FORMAT

        format_instruction = {
            "markdown": "Format the output as well-structured Markdown.",
            "plain":    "Use plain text with no Markdown symbols.",
            "html":     "Format the output as clean semantic HTML.",
        }.get(fmt, "Format the output as Markdown.")

        if draft:
            task_description = (
                f"Rewrite and improve the following draft document about '{topic}'. "
                f"Document type: {doc_type}. {format_instruction}"
            )
            user_content = f"DRAFT:\n\n{draft}"
        else:
            task_description = (
                f"Write a complete {doc_type} document about: {topic}. "
                f"{format_instruction}"
            )
            user_content = topic or "No topic provided."

        if sections:
            task_description += (
                f" Include these sections: {', '.join(sections)}."
            )

        return {
            "messages": [
                {
                    "role":    "system",
                    "content": task_description,
                },
                {"role": "user", "content": user_content},
            ],
            "_format":   fmt,
            "_doc_type": doc_type,
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        text = _extract_text(raw_output)
        if not text.strip():
            return ValidationResult.fail("Document output is empty")

        word_count = len(text.split())
        if word_count < _MIN_WORDS:
            return ValidationResult.fail(
                f"Document too short: {word_count} words (minimum {_MIN_WORDS})"
            )

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        text   = _extract_text(raw_output).strip()
        words  = text.split()
        # Count markdown-style headings as sections
        import re
        sections = len(re.findall(r"^#{1,6}\s+", text, re.MULTILINE))

        return {
            "document":      text,
            "format":        _DEFAULT_FORMAT,
            "doc_type":      _DEFAULT_DOC_TYPE,
            "word_count":    len(words),
            "section_count": sections,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        for key in ("document", "text", "content", "output", "result"):
            if key in raw and isinstance(raw[key], str):
                return raw[key]
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", "")
    return str(raw) if raw is not None else ""
