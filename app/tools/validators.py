"""
app/tools/validators.py
────────────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  Additions are safe (new helper functions).                     │
│  Renames / deletions require explicit approval.                 │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

Shared validation helper functions for BaseTool implementations.

These are standalone functions (not tied to any specific tool) that
concrete tools can compose in their ``validate_input`` and
``validate_output`` methods.
"""
from __future__ import annotations

from typing import Any

from app.tools.types import ToolValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# Composition helper
# ─────────────────────────────────────────────────────────────────────────────

def combine(*results: ToolValidationResult) -> ToolValidationResult:
    """
    Merge multiple ToolValidationResults into one.

    Returns ok() only when all inputs passed.
    All error messages are collected.
    """
    errors: list[str] = []
    for r in results:
        if not r.passed:
            errors.extend(r.errors)
    return ToolValidationResult(passed=len(errors) == 0, errors=errors)


# ─────────────────────────────────────────────────────────────────────────────
# String validators
# ─────────────────────────────────────────────────────────────────────────────

def require_non_empty_string(
    value: Any,
    field_name: str = "value",
    *,
    min_length: int = 1,
) -> ToolValidationResult:
    """Fail when ``value`` is not a non-empty string."""
    if not isinstance(value, str):
        return ToolValidationResult.fail(
            f"{field_name} must be a string, got {type(value).__name__}"
        )
    if len(value.strip()) < min_length:
        return ToolValidationResult.fail(
            f"{field_name} must have at least {min_length} character(s); "
            f"got {len(value.strip())!r}"
        )
    return ToolValidationResult.ok()


def require_url(value: Any, field_name: str = "url") -> ToolValidationResult:
    """Fail when ``value`` is not a string starting with http:// or https://."""
    check = require_non_empty_string(value, field_name)
    if not check.passed:
        return check
    if not (value.startswith("http://") or value.startswith("https://")):
        return ToolValidationResult.fail(
            f"{field_name} must start with http:// or https://, got {value!r}"
        )
    return ToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Dict / structure validators
# ─────────────────────────────────────────────────────────────────────────────

def require_dict(value: Any, field_name: str = "output") -> ToolValidationResult:
    """Fail when ``value`` is not a dict."""
    if not isinstance(value, dict):
        return ToolValidationResult.fail(
            f"{field_name} must be a dict, got {type(value).__name__}"
        )
    return ToolValidationResult.ok()


def require_list(
    value: Any,
    field_name: str = "output",
    *,
    min_items: int = 0,
) -> ToolValidationResult:
    """Fail when ``value`` is not a list, or has fewer than min_items items."""
    if not isinstance(value, list):
        return ToolValidationResult.fail(
            f"{field_name} must be a list, got {type(value).__name__}"
        )
    if len(value) < min_items:
        return ToolValidationResult.fail(
            f"{field_name} must have at least {min_items} item(s), got {len(value)}"
        )
    return ToolValidationResult.ok()


def require_keys(
    value: dict[str, Any],
    keys: list[str],
    field_name: str = "output",
) -> ToolValidationResult:
    """Fail when any of ``keys`` is missing from ``value`` dict."""
    missing = [k for k in keys if k not in value]
    if missing:
        return ToolValidationResult.fail(
            f"{field_name} missing required keys: {missing}"
        )
    return ToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Numeric validators
# ─────────────────────────────────────────────────────────────────────────────

def require_int_in_range(
    value: Any,
    lo: int,
    hi: int,
    field_name: str = "value",
) -> ToolValidationResult:
    """Fail when ``value`` is not an int in [lo, hi]."""
    if not isinstance(value, int):
        return ToolValidationResult.fail(
            f"{field_name} must be an int, got {type(value).__name__}"
        )
    if not (lo <= value <= hi):
        return ToolValidationResult.fail(
            f"{field_name} must be between {lo} and {hi}, got {value}"
        )
    return ToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Bytes / binary validators
# ─────────────────────────────────────────────────────────────────────────────

def require_bytes(
    value: Any,
    field_name: str = "content",
    *,
    min_size: int = 1,
) -> ToolValidationResult:
    """Fail when ``value`` is not bytes, or is smaller than min_size."""
    if not isinstance(value, (bytes, bytearray)):
        return ToolValidationResult.fail(
            f"{field_name} must be bytes, got {type(value).__name__}"
        )
    if len(value) < min_size:
        return ToolValidationResult.fail(
            f"{field_name} must have at least {min_size} byte(s)"
        )
    return ToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Param-level helper (used in validate_input implementations)
# ─────────────────────────────────────────────────────────────────────────────

def require_param(
    params: dict[str, Any],
    key: str,
    *,
    param_type: type | None = None,
) -> ToolValidationResult:
    """
    Fail when ``key`` is absent from ``params``, or optionally when its
    value is not an instance of ``param_type``.
    """
    if key not in params:
        return ToolValidationResult.fail(f"Missing required param: {key!r}")
    if param_type is not None and not isinstance(params[key], param_type):
        return ToolValidationResult.fail(
            f"Param {key!r} must be {param_type.__name__}, "
            f"got {type(params[key]).__name__}"
        )
    return ToolValidationResult.ok()
