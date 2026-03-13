"""
app/tools/types.py
──────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  All tools, tests, and the module bridge depend on these        │
│  type contracts.  Field changes are breaking.                   │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

Shared type definitions for the tool execution layer.

Tools are distinct from modules:
  - Modules  → shape LLM prompts, validate LLM outputs
  - Tools    → perform external I/O (search, PDF, OCR, email, …)

These types cross tool boundaries and are kept free of any ORM,
DB, or Celery imports so they can be used in tests without
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
class ToolInput:
    """
    Structured input handed to a tool.

    Attributes
    ----------
    tool_name   : str  – registered tool name, e.g. "search", "pdf", "ocr"
    action      : str  – sub-action within the tool, e.g. "query", "extract_text"
    params      : dict – action-specific parameters (URL, query string, file bytes…)
    request_id  : str  – correlation ID; auto-generated when not supplied
    metadata    : dict – optional caller-supplied context
    """

    tool_name:  str
    action:     str
    params:     dict[str, Any] = field(default_factory=dict)
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    metadata:   dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Output / execution result envelope
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ToolResult:
    """
    Standardised result returned by the tool executor.

    Attributes
    ----------
    request_id        : str   – correlation ID threaded from ToolInput
    tool_name         : str   – e.g. "search", "pdf", "ocr"
    action            : str   – sub-action that was executed
    success           : bool  – True when the action completed without error
    raw_output        : Any   – verbatim output from the external service
    normalized_output : Any   – post-normalization result
    validation_passed : bool  – True when validate_output returned True
    error_code        : str | None  – machine-readable error token
    error_message     : str | None  – human-readable description
    latency_ms        : int   – wall-clock time in milliseconds
    source_url        : str | None  – source URL/path used (when applicable)
    """

    request_id:        str
    tool_name:         str
    action:            str
    success:           bool              = False
    raw_output:        Any               = None
    normalized_output: Any               = None
    validation_passed: bool              = False
    error_code:        str | None        = None
    error_message:     str | None        = None
    latency_ms:        int               = 0
    source_url:        str | None        = None

    # ── helpers ──────────────────────────────────────────────────────────────

    def as_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict (suitable for JSON responses / logs)."""
        return {
            "request_id":        self.request_id,
            "tool_name":         self.tool_name,
            "action":            self.action,
            "success":           self.success,
            "raw_output":        self.raw_output,
            "normalized_output": self.normalized_output,
            "validation_passed": self.validation_passed,
            "error_code":        self.error_code,
            "error_message":     self.error_message,
            "latency_ms":        self.latency_ms,
            "source_url":        self.source_url,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Validation result helper (mirrors modules layer)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ToolValidationResult:
    """
    Returned by BaseTool.validate_output().

    Attributes
    ----------
    passed  : bool       – overall pass/fail
    errors  : list[str]  – human-readable failure reasons (empty on pass)
    """

    passed: bool
    errors: list[str] = field(default_factory=list)

    @classmethod
    def ok(cls) -> "ToolValidationResult":
        return cls(passed=True)

    @classmethod
    def fail(cls, *reasons: str) -> "ToolValidationResult":
        return cls(passed=False, errors=list(reasons))


# ─────────────────────────────────────────────────────────────────────────────
# Error codes (shared constants)
# ─────────────────────────────────────────────────────────────────────────────

class ToolErrorCode:
    """Machine-readable error tokens used in ToolResult.error_code."""

    VALIDATION_FAILED   = "TOOL_VALIDATION_FAILED"
    EMPTY_OUTPUT        = "TOOL_EMPTY_OUTPUT"
    ACTION_FAILED       = "TOOL_ACTION_FAILED"
    INPUT_INVALID       = "TOOL_INPUT_INVALID"
    UNSUPPORTED_ACTION  = "TOOL_UNSUPPORTED_ACTION"
    UNSUPPORTED_TOOL    = "TOOL_UNSUPPORTED_TOOL"
    NORMALIZATION_ERROR = "TOOL_NORMALIZATION_ERROR"
    NETWORK_ERROR       = "TOOL_NETWORK_ERROR"
    TIMEOUT_ERROR       = "TOOL_TIMEOUT_ERROR"
    DEPENDENCY_ERROR    = "TOOL_DEPENDENCY_ERROR"
    UNKNOWN             = "TOOL_UNKNOWN_ERROR"
