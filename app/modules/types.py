"""
app/modules/types.py
────────────────────
Phase 14 — Module execution layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify this file without explicit approval.             │
│  Every module, every test, and the tool layer (Phase 15)        │
│  depend on these type contracts.  Field changes are breaking.   │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

Shared type definitions for the module execution layer.

These types cross module boundaries.  They are intentionally kept
free of any ORM or DB imports so they can be used in tests without
standing up the full application stack.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Input envelope
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ModuleInput:
    """
    Structured input handed from the engine to a module.

    The engine sets ``task_type``, ``request_id``, and ``raw_input``.
    The module uses ``raw_input`` to build the prompt / structured payload
    it hands back to the provider executor.

    Attributes
    ----------
    task_type   : str  – e.g. "classify", "summarize", "translate", …
    raw_input   : Any  – payload from the caller (dict, str, bytes, …)
    request_id  : str  – correlation ID; auto-generated when not supplied
    metadata    : dict – optional caller-supplied context (source_lang, etc.)
    """

    task_type: str
    raw_input: Any
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Output / execution result envelope
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExecutionResult:
    """
    Standardised result returned by the module executor.

    Matches the output contract specified in the Phase 14 requirements.

    Attributes
    ----------
    request_id          : str   – correlation ID threaded from ModuleInput
    module_name         : str   – e.g. "classify", "summarize", …
    task_type           : str   – same as ModuleInput.task_type
    selected_provider   : str   – provider used (e.g. "openai")
    selected_model      : str   – model used (e.g. "gpt-4o-mini")
    fallback_used       : bool  – True when the primary model was not used
    success             : bool  – True when provider call + validation passed
    raw_output          : Any   – verbatim provider response
    normalized_output   : Any   – post-normalization result from the module
    validation_passed   : bool  – True when module.validateOutput returned True
    error_code          : str | None  – machine-readable error token
    error_message       : str | None  – human-readable description
    latency_ms          : int   – wall-clock time in milliseconds
    estimated_cost      : float | None  – USD estimate (provider-supplied or None)
    """

    request_id:         str
    module_name:        str
    task_type:          str
    selected_provider:  str                  = "unknown"
    selected_model:     str                  = "unknown"
    fallback_used:      bool                 = False
    success:            bool                 = False
    raw_output:         Any                  = None
    normalized_output:  Any                  = None
    validation_passed:  bool                 = False
    error_code:         str | None           = None
    error_message:      str | None           = None
    latency_ms:         int                  = 0
    estimated_cost:     float | None         = None

    # ── helpers ──────────────────────────────────────────────────────────────

    def as_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict (suitable for JSON responses / logs)."""
        return {
            "request_id":        self.request_id,
            "module_name":       self.module_name,
            "task_type":         self.task_type,
            "selected_provider": self.selected_provider,
            "selected_model":    self.selected_model,
            "fallback_used":     self.fallback_used,
            "success":           self.success,
            "raw_output":        self.raw_output,
            "normalized_output": self.normalized_output,
            "validation_passed": self.validation_passed,
            "error_code":        self.error_code,
            "error_message":     self.error_message,
            "latency_ms":        self.latency_ms,
            "estimated_cost":    self.estimated_cost,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Validation result helper
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ValidationResult:
    """
    Returned by BaseModule.validate_output().

    Attributes
    ----------
    passed  : bool       – overall pass/fail
    errors  : list[str]  – human-readable failure reasons (empty on pass)
    """

    passed: bool
    errors: list[str] = field(default_factory=list)

    @classmethod
    def ok(cls) -> "ValidationResult":
        return cls(passed=True)

    @classmethod
    def fail(cls, *reasons: str) -> "ValidationResult":
        return cls(passed=False, errors=list(reasons))


# ─────────────────────────────────────────────────────────────────────────────
# Error codes (shared constants)
# ─────────────────────────────────────────────────────────────────────────────

class ModuleErrorCode:
    """Machine-readable error tokens used in ExecutionResult.error_code."""

    VALIDATION_FAILED   = "MODULE_VALIDATION_FAILED"
    EMPTY_OUTPUT        = "MODULE_EMPTY_OUTPUT"
    PROVIDER_ERROR      = "MODULE_PROVIDER_ERROR"
    INPUT_INVALID       = "MODULE_INPUT_INVALID"
    UNSUPPORTED_TASK    = "MODULE_UNSUPPORTED_TASK"
    NORMALIZATION_ERROR = "MODULE_NORMALIZATION_ERROR"
    UNKNOWN             = "MODULE_UNKNOWN_ERROR"
