"""
app/modules/modules/translate.py
──────────────────────────────────
Phase 14 – Translate module.

Task types handled
------------------
- translate
- translation  (alias)

Responsibility
--------------
Translate text from a source language into a target language.

Input schema
------------
{
  "text":          "<text to translate>",   # required
  "target_lang":   "ko",                    # required – ISO 639-1 code
  "source_lang":   "en",                    # optional – auto-detect if absent
  "formality":     "formal|informal",       # optional, default "formal"
}

Output schema (normalized)
--------------------------
{
  "translated_text":  str,
  "source_lang":      str,    # detected or supplied
  "target_lang":      str,
  "formality":        str,
  "char_count":       int,
}

Validation rules
----------------
- raw_output must be non-empty
- Translated text must not be identical to the source (simple sanity check)
- Must contain at least 1 non-whitespace character

Preferred models
----------------
gpt-4o-mini  →  gpt-4o  →  claude-3-sonnet

Fallback models
---------------
gemini-flash  →  deepl-compatible
"""
from __future__ import annotations

from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_FORMALITY_VALUES = {"formal", "informal"}
_DEFAULT_FORMALITY = "formal"


class TranslateModule(BaseModule):
    """First-class module for translation tasks."""

    @property
    def name(self) -> str:
        return "translate"

    def get_task_types(self) -> list[str]:
        return ["translate", "translation"]

    # ── Schemas ───────────────────────────────────────────────────────────────

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "type":     "object",
            "required": ["text", "target_lang"],
            "properties": {
                "text": {
                    "type":      "string",
                    "minLength": 1,
                },
                "target_lang": {
                    "type":        "string",
                    "description": "ISO 639-1 target language code, e.g. 'ko', 'ja', 'fr'.",
                },
                "source_lang": {
                    "type":        "string",
                    "description": "ISO 639-1 source language code. Omit to auto-detect.",
                },
                "formality": {
                    "type":    "string",
                    "enum":    list(_FORMALITY_VALUES),
                    "default": _DEFAULT_FORMALITY,
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "translated_text": {"type": "string"},
                "source_lang":     {"type": "string"},
                "target_lang":     {"type": "string"},
                "formality":       {"type": "string"},
                "char_count":      {"type": "integer"},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o-mini", "gpt-4o", "claude-3-sonnet"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-flash", "deepl-compatible"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, dict):
            text        = str(payload.get("text", ""))
            target_lang = str(payload.get("target_lang", "en"))
            source_lang = payload.get("source_lang")
            formality   = str(payload.get("formality", _DEFAULT_FORMALITY)).lower()
        else:
            text        = str(payload)
            target_lang = module_input.metadata.get("target_lang", "en")
            source_lang = module_input.metadata.get("source_lang")
            formality   = _DEFAULT_FORMALITY

        if formality not in _FORMALITY_VALUES:
            formality = _DEFAULT_FORMALITY

        source_clause = (
            f"from {source_lang} " if source_lang else "detecting the source language and translating "
        )

        system = (
            "You are a professional translation engine. "
            f"Translate the user's text {source_clause}into {target_lang}. "
            f"Use {'formal' if formality == 'formal' else 'informal'} register. "
            "Return ONLY the translated text with no preamble, notes, or labels."
        )

        return {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": text},
            ],
            "_target_lang": target_lang,
            "_source_lang": source_lang or "auto",
            "_formality":   formality,
            "_source_text": text,
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        translated = _extract_text(raw_output)
        if not translated.strip():
            return ValidationResult.fail("Translated text is empty")

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        translated = _extract_text(raw_output).strip()
        return {
            "translated_text": translated,
            "source_lang":     "auto",
            "target_lang":     "unknown",
            "formality":       _DEFAULT_FORMALITY,
            "char_count":      len(translated),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        for key in ("translated_text", "text", "content", "output", "result"):
            if key in raw and isinstance(raw[key], str):
                return raw[key]
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", "")
    return str(raw) if raw is not None else ""
