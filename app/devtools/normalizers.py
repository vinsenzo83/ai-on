"""
app/devtools/normalizers.py
────────────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  Additions (new helpers) are safe.                              │
│  Renames / deletions require explicit approval.                 │
└─────────────────────────────────────────────────────────────────┘

Shared normalizer and validator helpers for BaseDevTool implementations.

All helpers are pure functions — no side effects, no imports of
application-layer modules.
"""
from __future__ import annotations

import os
from typing import Any

from app.devtools.types import DevToolValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# Composition
# ─────────────────────────────────────────────────────────────────────────────

def combine(*results: DevToolValidationResult) -> DevToolValidationResult:
    """Merge multiple DevToolValidationResults; fails if any failed."""
    errors: list[str] = []
    for r in results:
        if not r.passed:
            errors.extend(r.errors)
    return DevToolValidationResult(passed=len(errors) == 0, errors=errors)


# ─────────────────────────────────────────────────────────────────────────────
# String validators
# ─────────────────────────────────────────────────────────────────────────────

def require_str(
    value: Any,
    field_name: str = "value",
    *,
    min_len: int = 1,
) -> DevToolValidationResult:
    """Fail when value is not a non-empty string."""
    if not isinstance(value, str):
        return DevToolValidationResult.fail(
            f"{field_name} must be a string, got {type(value).__name__}"
        )
    if len(value.strip()) < min_len:
        return DevToolValidationResult.fail(
            f"{field_name} must have at least {min_len} character(s)"
        )
    return DevToolValidationResult.ok()


def require_param(
    params: dict[str, Any],
    key: str,
    *,
    param_type: type | None = None,
) -> DevToolValidationResult:
    """Fail when key is absent from params, or wrong type."""
    if key not in params:
        return DevToolValidationResult.fail(f"Missing required param: {key!r}")
    if param_type is not None and not isinstance(params[key], param_type):
        return DevToolValidationResult.fail(
            f"Param {key!r} must be {param_type.__name__}, "
            f"got {type(params[key]).__name__}"
        )
    return DevToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Path safety validators
# ─────────────────────────────────────────────────────────────────────────────

def require_safe_path(
    path: str,
    workspace_root: str,
    field_name: str = "path",
) -> DevToolValidationResult:
    """
    Fail when ``path`` escapes ``workspace_root`` (path traversal guard).

    Both paths are resolved to absolute before comparison.
    """
    if not path:
        return DevToolValidationResult.fail(f"{field_name} must not be empty")
    try:
        abs_path = os.path.realpath(os.path.join(workspace_root, path))
        abs_root = os.path.realpath(workspace_root)
    except Exception as exc:
        return DevToolValidationResult.fail(f"Path resolution error: {exc}")

    if not abs_path.startswith(abs_root + os.sep) and abs_path != abs_root:
        return DevToolValidationResult.fail(
            f"{field_name}={path!r} escapes workspace root {workspace_root!r}"
        )
    return DevToolValidationResult.ok()


def require_absolute_path(
    path: str, field_name: str = "path"
) -> DevToolValidationResult:
    """Fail when path is not absolute."""
    if not os.path.isabs(path):
        return DevToolValidationResult.fail(
            f"{field_name} must be an absolute path, got {path!r}"
        )
    return DevToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Mode / safety validators
# ─────────────────────────────────────────────────────────────────────────────

def require_mode(
    actual_mode: str,
    required_mode: str,
) -> DevToolValidationResult:
    """
    Fail when actual_mode does not satisfy required_mode.

    Hierarchy: READ_ONLY < SAFE_WRITE < FULL
    """
    from app.devtools.types import DevToolMode
    _ORDER = {
        DevToolMode.READ_ONLY:  0,
        DevToolMode.SAFE_WRITE: 1,
        DevToolMode.FULL:       2,
    }
    actual_rank   = _ORDER.get(actual_mode,   -1)
    required_rank = _ORDER.get(required_mode, -1)

    if actual_rank < required_rank:
        return DevToolValidationResult.fail(
            f"Operation requires mode={required_mode!r}, "
            f"but input has mode={actual_mode!r}"
        )
    return DevToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Numeric validators
# ─────────────────────────────────────────────────────────────────────────────

def require_positive_int(
    value: Any, field_name: str = "value"
) -> DevToolValidationResult:
    """Fail when value is not a positive integer."""
    if not isinstance(value, int) or value <= 0:
        return DevToolValidationResult.fail(
            f"{field_name} must be a positive integer, got {value!r}"
        )
    return DevToolValidationResult.ok()


# ─────────────────────────────────────────────────────────────────────────────
# Output normalization helpers
# ─────────────────────────────────────────────────────────────────────────────

def normalize_exit_code(exit_code: Any) -> int:
    """Coerce exit_code to int, defaulting to -1 on failure."""
    try:
        return int(exit_code)
    except (TypeError, ValueError):
        return -1


def truncate(text: str, max_chars: int = 50_000) -> str:
    """Truncate long text and append a marker."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n... [truncated at {max_chars} chars]"


def split_lines(text: str) -> list[str]:
    """Split text into non-empty stripped lines."""
    return [ln.rstrip() for ln in text.splitlines()]
