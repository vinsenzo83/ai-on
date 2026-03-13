"""
app/modules/modules/classify.py
────────────────────────────────
Phase 14 – Classify module.

Task types handled
------------------
- classify
- categorise  (alias)

Responsibility
--------------
Given a block of text (product description, query, article snippet, etc.)
the classify module shapes a prompt that instructs the model to return a
single category label plus a confidence score.

Input schema
------------
{
  "text": "<string to classify>",        # required
  "candidate_labels": ["a", "b", …]      # optional – constrain output
}

Output schema (normalized)
--------------------------
{
  "label":       str,                     # top predicted category
  "confidence":  float,                   # 0.0 – 1.0
  "all_labels":  [{"label": str, "score": float}, …]  # full ranking
}

Validation rules
----------------
- raw_output must be non-empty string or dict
- Must contain at least one label after normalisation

Preferred models
----------------
gpt-4o-mini  →  gpt-4o  →  claude-3-haiku

Fallback models
---------------
gemini-flash  →  mixtral-8x7b
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult


_SYSTEM_PROMPT = (
    "You are a text classification engine. "
    "Analyse the provided text and return ONLY valid JSON in this exact format:\n"
    '{"label": "<top_category>", "confidence": <0.0-1.0>, '
    '"all_labels": [{"label": "<cat>", "score": <0.0-1.0>}]}\n'
    "No markdown, no prose, just the JSON object."
)


class ClassifyModule(BaseModule):
    """First-class module for text classification tasks."""

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "classify"

    # ── Task routing ──────────────────────────────────────────────────────────

    def get_task_types(self) -> list[str]:
        return ["classify", "categorise"]

    # ── Schemas ───────────────────────────────────────────────────────────────

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": {
                    "type":        "string",
                    "description": "The text to classify.",
                    "minLength":   1,
                },
                "candidate_labels": {
                    "type":        "array",
                    "items":       {"type": "string"},
                    "description": "Optional list of allowed category labels.",
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "label": {
                    "type":        "string",
                    "description": "Top predicted category label.",
                },
                "confidence": {
                    "type":        "number",
                    "minimum":     0.0,
                    "maximum":     1.0,
                },
                "all_labels": {
                    "type":  "array",
                    "items": {
                        "type":       "object",
                        "properties": {
                            "label": {"type": "string"},
                            "score": {"type": "number"},
                        },
                    },
                },
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o-mini", "gpt-4o", "claude-3-haiku"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-flash", "mixtral-8x7b"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, str):
            text             = payload
            candidate_labels = []
        elif isinstance(payload, dict):
            text             = str(payload.get("text", ""))
            candidate_labels = payload.get("candidate_labels", [])
        else:
            text             = str(payload)
            candidate_labels = []

        user_msg = f"Text to classify:\n\n{text}"
        if candidate_labels:
            label_list = ", ".join(f'"{lb}"' for lb in candidate_labels)
            user_msg += (
                f"\n\nConstrain your answer to one of these labels: [{label_list}]"
            )

        return {
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ]
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")
        if isinstance(raw_output, str) and not raw_output.strip():
            return ValidationResult.fail("raw_output is empty string")

        parsed = _try_parse_json(raw_output)
        if parsed is None:
            return ValidationResult.fail(
                "raw_output is not valid JSON or a recognisable dict"
            )

        if "label" not in parsed:
            return ValidationResult.fail(
                "normalized output missing required key 'label'"
            )

        label = parsed.get("label", "")
        if not isinstance(label, str) or not label.strip():
            return ValidationResult.fail("'label' must be a non-empty string")

        confidence = parsed.get("confidence")
        if confidence is not None:
            try:
                c = float(confidence)
            except (TypeError, ValueError):
                return ValidationResult.fail("'confidence' must be a number")
            if not (0.0 <= c <= 1.0):
                return ValidationResult.fail("'confidence' must be between 0.0 and 1.0")

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        parsed = _try_parse_json(raw_output) or {}
        label      = str(parsed.get("label", "unknown")).strip()
        confidence = _safe_float(parsed.get("confidence"), default=0.0)
        all_labels = parsed.get("all_labels", [])

        if not all_labels:
            all_labels = [{"label": label, "score": confidence}]

        # Normalise each entry in all_labels
        normalised_all = []
        for entry in all_labels:
            if isinstance(entry, dict):
                normalised_all.append({
                    "label": str(entry.get("label", "")).strip(),
                    "score": _safe_float(entry.get("score"), default=0.0),
                })

        return {
            "label":      label,
            "confidence": confidence,
            "all_labels": normalised_all,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers (module-private)
# ─────────────────────────────────────────────────────────────────────────────

def _try_parse_json(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        # Strip markdown code fences that some models add
        clean = re.sub(r"^```(?:json)?\s*|```\s*$", "", value.strip(), flags=re.MULTILINE)
        try:
            parsed = json.loads(clean)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
