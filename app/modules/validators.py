"""
app/modules/validators.py
──────────────────────────
Phase 14 – Shared validation utilities for module implementations.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  Adding new helpers is safe.                                    │
│  Renaming or removing existing helpers requires a search across │
│  all module implementations before merging.                     │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

These helpers are used inside BaseModule subclasses and can be reused
by the tool layer (Phase 15) without coupling to any specific module.

All functions are pure (no side-effects, no I/O).
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.modules.types import ValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# JSON helpers
# ─────────────────────────────────────────────────────────────────────────────

def parse_json_output(raw: Any) -> dict | list | None:
    """
    Attempt to parse *raw* as JSON.

    Strips markdown code fences that models sometimes add.
    Returns None if parsing fails.
    """
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        clean = re.sub(
            r"^```(?:json)?\s*|```\s*$", "", raw.strip(), flags=re.MULTILINE
        )
        try:
            return json.loads(clean)
        except (json.JSONDecodeError, ValueError):
            pass
    return None


def require_json_dict(raw: Any, required_keys: list[str]) -> ValidationResult:
    """
    Assert that *raw* parses as a JSON object and contains *required_keys*.

    Returns ValidationResult.ok() or a descriptive failure.
    """
    if raw is None:
        return ValidationResult.fail("output is None")

    parsed = parse_json_output(raw)
    if not isinstance(parsed, dict):
        return ValidationResult.fail("output is not a JSON object")

    missing = [k for k in required_keys if k not in parsed]
    if missing:
        return ValidationResult.fail(
            f"output missing required keys: {missing}"
        )

    return ValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Text helpers
# ─────────────────────────────────────────────────────────────────────────────

def require_non_empty_string(raw: Any, field_name: str = "output") -> ValidationResult:
    """Assert that *raw* is a non-empty string (or dict with a text field)."""
    if raw is None:
        return ValidationResult.fail(f"{field_name} is None")

    text = _coerce_to_text(raw)
    if not text.strip():
        return ValidationResult.fail(f"{field_name} is empty")

    return ValidationResult.ok()


def require_min_word_count(
    raw: Any, min_words: int, field_name: str = "output"
) -> ValidationResult:
    """Assert that the text in *raw* contains at least *min_words* words."""
    text = _coerce_to_text(raw)
    wc   = len(text.split())
    if wc < min_words:
        return ValidationResult.fail(
            f"{field_name} has {wc} words; minimum is {min_words}"
        )
    return ValidationResult.ok()


def require_max_word_count(
    raw: Any, max_words: int, field_name: str = "output"
) -> ValidationResult:
    """Assert that the text in *raw* does not exceed *max_words* words."""
    text = _coerce_to_text(raw)
    wc   = len(text.split())
    if wc > max_words:
        return ValidationResult.fail(
            f"{field_name} has {wc} words; maximum is {max_words}"
        )
    return ValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Numeric helpers
# ─────────────────────────────────────────────────────────────────────────────

def require_float_in_range(
    value: Any,
    lo: float,
    hi: float,
    field_name: str = "value",
) -> ValidationResult:
    """Assert that *value* is a float within [lo, hi]."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return ValidationResult.fail(
            f"{field_name}={value!r} is not a valid number"
        )
    if not (lo <= f <= hi):
        return ValidationResult.fail(
            f"{field_name}={f} out of expected range [{lo}, {hi}]"
        )
    return ValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Composite validators
# ─────────────────────────────────────────────────────────────────────────────

def combine(*results: ValidationResult) -> ValidationResult:
    """
    Merge multiple ValidationResults into one.

    Passes only when every sub-result passes.
    All failure reasons are aggregated.
    """
    all_errors: list[str] = []
    for vr in results:
        if not vr.passed:
            all_errors.extend(vr.errors)

    if all_errors:
        return ValidationResult(passed=False, errors=all_errors)
    return ValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _coerce_to_text(raw: Any) -> str:
    """Best-effort coercion of a provider response to a plain string."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        for key in ("text", "content", "summary", "output", "result", "translated_text",
                    "document", "code"):
            val = raw.get(key)
            if isinstance(val, str):
                return val
        # OpenAI chat-completion
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            return choices[0].get("message", {}).get("content", "")
    return str(raw) if raw is not None else ""
