"""
app/modules/modules/extract.py
────────────────────────────────
Phase 14 – Extract module.

Task types handled
------------------
- extract
- extraction  (alias)
- ner          (alias – Named Entity Recognition)

Responsibility
--------------
Extract structured information from unstructured text.
Supports entity extraction, key-value extraction, and custom field
extraction based on a user-supplied schema.

Input schema
------------
{
  "text":   "<source text>",                 # required
  "fields": ["price", "brand", "sku", …],   # optional – target field names
  "schema": { "field": "description", … }   # optional – hints per field
}

Output schema (normalized)
--------------------------
{
  "entities": [
    {"type": str, "value": str, "span": str},
    …
  ],
  "key_value_pairs": {"field_name": "extracted_value", …},
  "raw_extractions":  str | dict             # verbatim model output
}

Validation rules
----------------
- raw_output must be non-empty
- Output must contain at least one extraction (entity or key_value_pair)

Preferred models
----------------
gpt-4o-mini  →  gpt-4o  →  claude-3-sonnet

Fallback models
---------------
gemini-flash  →  mistral-medium
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_SYSTEM_PROMPT_BASE = (
    "You are a structured information extraction engine. "
    "Extract the requested fields from the provided text. "
    "Return ONLY valid JSON with the structure:\n"
    '{"entities": [{"type": "<entity_type>", "value": "<value>", "span": "<original_span>"}], '
    '"key_value_pairs": {"field_name": "extracted_value"}}\n'
    "If a field cannot be found, omit it. No prose, no markdown."
)


class ExtractModule(BaseModule):
    """First-class module for structured information extraction."""

    @property
    def name(self) -> str:
        return "extract"

    def get_task_types(self) -> list[str]:
        return ["extract", "extraction", "ner"]

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
                "fields": {
                    "type":        "array",
                    "items":       {"type": "string"},
                    "description": "List of field names to extract.",
                },
                "schema": {
                    "type":        "object",
                    "description": "Mapping of field name to human-readable description.",
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "entities": {
                    "type":  "array",
                    "items": {
                        "type":       "object",
                        "properties": {
                            "type":  {"type": "string"},
                            "value": {"type": "string"},
                            "span":  {"type": "string"},
                        },
                    },
                },
                "key_value_pairs": {
                    "type":                 "object",
                    "additionalProperties": {"type": "string"},
                },
                "raw_extractions": {},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o-mini", "gpt-4o", "claude-3-sonnet"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-flash", "mistral-medium"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, dict):
            text   = str(payload.get("text", ""))
            fields = payload.get("fields", [])
            schema = payload.get("schema", {})
        else:
            text   = str(payload)
            fields = []
            schema = {}

        user_msg = f"Source text:\n\n{text}"

        if fields:
            field_list = ", ".join(f'"{f}"' for f in fields)
            user_msg  += f"\n\nExtract these specific fields: [{field_list}]"

        if schema:
            hints = "; ".join(f"{k}: {v}" for k, v in schema.items())
            user_msg += f"\n\nField descriptions: {hints}"

        return {
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT_BASE},
                {"role": "user",   "content": user_msg},
            ],
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        if isinstance(raw_output, str) and not raw_output.strip():
            return ValidationResult.fail("raw_output is empty string")

        parsed = _try_parse_json(raw_output)
        if parsed is None:
            # Accept plain string outputs too (some models return CSV-style)
            return ValidationResult.ok()

        entities   = parsed.get("entities",        [])
        kv_pairs   = parsed.get("key_value_pairs", {})

        if not entities and not kv_pairs:
            return ValidationResult.fail(
                "Extraction produced no entities and no key_value_pairs"
            )

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        parsed = _try_parse_json(raw_output)

        if parsed is None:
            # Treat plain string as a single raw extraction
            return {
                "entities":       [],
                "key_value_pairs": {},
                "raw_extractions": str(raw_output),
            }

        entities_raw = parsed.get("entities", [])
        entities = []
        for e in entities_raw:
            if isinstance(e, dict):
                entities.append({
                    "type":  str(e.get("type",  "UNKNOWN")),
                    "value": str(e.get("value", "")),
                    "span":  str(e.get("span",  "")),
                })

        kv_raw = parsed.get("key_value_pairs", {})
        kv_pairs: dict[str, str] = {}
        if isinstance(kv_raw, dict):
            for k, v in kv_raw.items():
                kv_pairs[str(k)] = str(v)

        return {
            "entities":        entities,
            "key_value_pairs": kv_pairs,
            "raw_extractions": raw_output,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _try_parse_json(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        clean = re.sub(r"^```(?:json)?\s*|```\s*$", "", value.strip(), flags=re.MULTILINE)
        try:
            parsed = json.loads(clean)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return None
