"""
app/modules/modules/analysis.py
─────────────────────────────────
Phase 14 – Analysis module.

Task types handled
------------------
- analysis
- analyse     (British alias)
- analyze     (American alias)
- sentiment   (sub-type alias)

Responsibility
--------------
Deep analytical processing of text: sentiment analysis, opinion mining,
topic modelling, competitive analysis, trend analysis, and general
free-form analytical tasks.

Input schema
------------
{
  "text":         "<text to analyse>",     # required
  "analysis_type": "sentiment|topic|competitive|general",  # optional, default "general"
  "dimensions":   ["tone", "intent", …]    # optional extra dimensions to report
}

Output schema (normalized)
--------------------------
{
  "analysis_type":   str,
  "summary":         str,
  "sentiment":       {"label": str, "score": float},   # present for sentiment tasks
  "topics":          [str],                             # present for topic tasks
  "insights":        [str],                             # key findings
  "dimensions":      {"dim_name": <value>, …},
  "confidence":      float,
}

Validation rules
----------------
- raw_output must be non-empty string or parseable dict
- Must contain at least a "summary" or "insights" key after parsing

Preferred models
----------------
gpt-4o  →  claude-3-sonnet  →  gpt-4o-mini

Fallback models
---------------
gemini-pro  →  mixtral-8x7b
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.modules.base import BaseModule
from app.modules.types import ModuleInput, ValidationResult

_ANALYSIS_TYPES = {"sentiment", "topic", "competitive", "general"}
_DEFAULT_TYPE   = "general"

_SYSTEM_PROMPT = (
    "You are a senior analytical intelligence engine. "
    "Perform a deep analysis of the provided text and return ONLY valid JSON:\n"
    "{\n"
    '  "analysis_type": "<type>",\n'
    '  "summary": "<one-paragraph synthesis>",\n'
    '  "sentiment": {"label": "<positive|negative|neutral|mixed>", "score": <0.0-1.0>},\n'
    '  "topics": ["<topic1>", "<topic2>"],\n'
    '  "insights": ["<key finding 1>", "<key finding 2>"],\n'
    '  "dimensions": {},\n'
    '  "confidence": <0.0-1.0>\n'
    "}\n"
    "Omit keys that are not applicable. No markdown, no prose."
)


class AnalysisModule(BaseModule):
    """First-class module for deep text analysis tasks."""

    @property
    def name(self) -> str:
        return "analysis"

    def get_task_types(self) -> list[str]:
        return ["analysis", "analyse", "analyze", "sentiment"]

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
                "analysis_type": {
                    "type":    "string",
                    "enum":    list(_ANALYSIS_TYPES),
                    "default": _DEFAULT_TYPE,
                },
                "dimensions": {
                    "type":        "array",
                    "items":       {"type": "string"},
                    "description": "Extra analytical dimensions to report.",
                },
            },
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "analysis_type": {"type": "string"},
                "summary":       {"type": "string"},
                "sentiment": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "score": {"type": "number"},
                    },
                },
                "topics":     {"type": "array",  "items": {"type": "string"}},
                "insights":   {"type": "array",  "items": {"type": "string"}},
                "dimensions": {"type": "object"},
                "confidence": {"type": "number"},
            },
        }

    # ── Model preferences ─────────────────────────────────────────────────────

    def get_preferred_models(self) -> list[str]:
        return ["gpt-4o", "claude-3-sonnet", "gpt-4o-mini"]

    def get_fallback_models(self) -> list[str]:
        return ["gemini-pro", "mixtral-8x7b"]

    # ── Prompt building ───────────────────────────────────────────────────────

    def build_prompt(self, module_input: ModuleInput) -> dict[str, Any]:
        payload = module_input.raw_input
        if isinstance(payload, dict):
            text          = str(payload.get("text", ""))
            analysis_type = str(payload.get("analysis_type", _DEFAULT_TYPE)).lower()
            dimensions    = payload.get("dimensions", [])
        else:
            text          = str(payload)
            analysis_type = _DEFAULT_TYPE
            dimensions    = []

        if analysis_type not in _ANALYSIS_TYPES:
            analysis_type = _DEFAULT_TYPE

        user_msg = (
            f"Analysis type requested: {analysis_type}\n\n"
            f"Text to analyse:\n\n{text}"
        )
        if dimensions:
            user_msg += f"\n\nAlso report these extra dimensions: {', '.join(dimensions)}"

        return {
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            "_analysis_type": analysis_type,
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_output(self, raw_output: Any) -> ValidationResult:
        if raw_output is None:
            return ValidationResult.fail("raw_output is None")

        if isinstance(raw_output, str) and not raw_output.strip():
            return ValidationResult.fail("raw_output is empty string")

        parsed = _try_parse_json(raw_output)
        if parsed is None:
            # Accept plain-text analysis too
            return ValidationResult.ok()

        summary  = parsed.get("summary",  "")
        insights = parsed.get("insights", [])
        if not summary and not insights:
            return ValidationResult.fail(
                "Analysis output missing both 'summary' and 'insights'"
            )

        confidence = parsed.get("confidence")
        if confidence is not None:
            try:
                c = float(confidence)
                if not (0.0 <= c <= 1.0):
                    return ValidationResult.fail(
                        f"'confidence' {c} out of range [0,1]"
                    )
            except (TypeError, ValueError):
                return ValidationResult.fail("'confidence' must be a number")

        return ValidationResult.ok()

    # ── Normalisation ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        parsed = _try_parse_json(raw_output)

        if parsed is None:
            # Plain-text fallback
            text = str(raw_output).strip()
            return {
                "analysis_type": _DEFAULT_TYPE,
                "summary":       text,
                "sentiment":     {"label": "unknown", "score": 0.0},
                "topics":        [],
                "insights":      [text] if text else [],
                "dimensions":    {},
                "confidence":    0.0,
            }

        sentiment_raw = parsed.get("sentiment", {})
        if isinstance(sentiment_raw, dict):
            sentiment = {
                "label": str(sentiment_raw.get("label", "unknown")),
                "score": _safe_float(sentiment_raw.get("score"), 0.0),
            }
        else:
            sentiment = {"label": "unknown", "score": 0.0}

        return {
            "analysis_type": str(parsed.get("analysis_type", _DEFAULT_TYPE)),
            "summary":       str(parsed.get("summary",       "")),
            "sentiment":     sentiment,
            "topics":        [str(t) for t in parsed.get("topics",   [])],
            "insights":      [str(i) for i in parsed.get("insights", [])],
            "dimensions":    dict(parsed.get("dimensions", {})),
            "confidence":    _safe_float(parsed.get("confidence"), 0.0),
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


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
