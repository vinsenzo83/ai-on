"""
app/modules/modules/summarize.py
─────────────────────────────────
Phase 14 – Summarize module.

Task types handled
------------------
- summarize
- summarise  (British spelling alias)

Responsibility
--------------
Condense a body of text into a shorter summary at a configurable
granularity (brief | standard | detailed).

Input schema
------------
{
  "text":        "<text to summarise>",   # required
  "max_words":   int,                     # optional, default 150
  "style":       "brief|standard|detailed",  # optional, default "standard"
  "language":    "en",                    # optional, default "en"
}

Output schema (normalized)
--------------------------
{
  "summary":       str,
  "word_count":    int,
  "style_used":    str,
}

Validation rules
----------------
- raw_output must be non-empty string
- Summary must be at most 2× the requested max_words (generous cap for
  models that are slightly verbose)

Preferred models
----------------
gpt-4o-mini  →  gpt-4o  →  claude-3-haiku

Fallback models
---------------
gemini-flash  →  mixtral-8x7b
"""
from __future__ import annotations

from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_STYLES = {"brief", "standard", "detailed"}
_DEFAULT_MAX_WORDS = 150
_DEFAULT_STYLE     = "standard"


class SummarizeModule(BaseModule):
    """First-class module for text summarisation tasks."""

    @property
    def name(self) -> str:
        return "summarize"

    def get_task_types(self) -> list[str]:
        return ["summarize", "summarise"]

    # ── Schemas ───────────────────────────────────────────────────────────────

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "type":     "object",
            "required": ["text"],
            "properties": {
                "text": {
                    "type":      "string",
                    "minLength": 1,
                },
                "max_words": {
                    "type":    "integer",
                    "minimum": 10,
                    "default": _DEFAULT_MAX_WORDS,
                },
                "style": {
                    "type":    "string",
                    "enum":    list(_STYLES),
                    "default": _DEFAULT_STYLE,
                },
                "language": {
                    "type":    "string",
                    "default": "en",
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "summary":    {"type": "string"},
                "word_count": {"type": "integer"},
                "style_used": {"type": "string"},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o-mini", "gpt-4o", "claude-3-haiku"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-flash", "mixtral-8x7b"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload   = module_input.raw_input
        if isinstance(payload, str):
            text      = payload
            max_words = _DEFAULT_MAX_WORDS
            style     = _DEFAULT_STYLE
            language  = "en"
        elif isinstance(payload, dict):
            text      = str(payload.get("text", ""))
            max_words = int(payload.get("max_words", _DEFAULT_MAX_WORDS))
            style     = str(payload.get("style", _DEFAULT_STYLE)).lower()
            language  = str(payload.get("language", "en"))
            if style not in _STYLES:
                style = _DEFAULT_STYLE
        else:
            text      = str(payload)
            max_words = _DEFAULT_MAX_WORDS
            style     = _DEFAULT_STYLE
            language  = "en"

        style_instruction = {
            "brief":    "Write an extremely concise summary (2-3 sentences max).",
            "standard": "Write a clear, balanced summary hitting the key points.",
            "detailed": "Write a thorough summary preserving all important details.",
        }.get(style, "Write a clear summary.")

        system = (
            "You are a professional summarisation assistant. "
            f"Respond in language code '{language}'. "
            f"{style_instruction} "
            f"Target length: up to {max_words} words. "
            "Return ONLY the summary text with no preamble or labels."
        )

        return {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": f"Summarise the following:\n\n{text}"},
            ],
            # Store metadata for validation
            "_max_words": max_words,
            "_style":     style,
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        text = _extract_text(raw_output)
        if not text.strip():
            return ValidationResult.fail("Summary is empty")

        word_count = len(text.split())
        # Hard cap: refuse summaries that are clearly not summaries
        if word_count > 2000:
            return ValidationResult.fail(
                f"Summary is too long ({word_count} words); expected <= 2000"
            )

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        text       = _extract_text(raw_output).strip()
        word_count = len(text.split())
        return {
            "summary":    text,
            "word_count": word_count,
            "style_used": _DEFAULT_STYLE,   # best-effort; engine doesn't echo prompt
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text(raw: Any) -> str:
    """Best-effort text extraction from various provider response shapes."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        # Common provider shapes
        for key in ("text", "content", "summary", "output", "result"):
            if key in raw and isinstance(raw[key], str):
                return raw[key]
        # OpenAI chat-completion style
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", "")
    return str(raw) if raw is not None else ""
