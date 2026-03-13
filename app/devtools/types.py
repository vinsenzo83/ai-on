"""
app/devtools/types.py
─────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  All devtools, tests, and integrations depend on these          │
│  type contracts. Field changes are breaking.                    │
│  See DEVTOOLS_STATUS_REPORT.md §freeze for rules.              │
└─────────────────────────────────────────────────────────────────┘

Shared type definitions for the Phase 16 developer-assist layer.

Developer tools are distinct from general tools (Phase 15):
  - General tools  → external I/O (search, PDF, OCR, email, image, browser)
  - Developer tools → repository-aware, filesystem, code, shell, CI/CD ops

These types are kept free of any ORM, DB, or Celery imports so they
can be used in tests without the full application stack.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Security / operation mode enum constants
# ─────────────────────────────────────────────────────────────────────────────

class DevToolMode:
    """Execution mode — controls what side-effects are permitted."""
    READ_ONLY  = "read_only"   # no filesystem/shell writes
    SAFE_WRITE = "safe_write"  # writes allowed, no shell execution
    FULL       = "full"        # all operations permitted


class DevToolOpType:
    """High-level operation category for auditing and safety routing."""
    READ       = "read"        # read-only file / repo / config ops
    WRITE      = "write"       # filesystem writes, patches
    EXECUTE    = "execute"     # shell, test, build, sandbox
    INSPECT    = "inspect"     # git, log, env, dependency inspection
    BROWSER    = "browser"     # Playwright / browser automation
    WORKFLOW   = "workflow"    # chained multi-step operations
    DEPLOY     = "deploy"      # deployment helper (restricted)
    EXPORT     = "export"      # doc / report export


# ─────────────────────────────────────────────────────────────────────────────
# Input envelope
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DevToolInput:
    """
    Structured input handed to a developer tool.

    Attributes
    ----------
    tool_name   : str            – registered tool name, e.g. "filesystem", "git"
    action      : str            – sub-action, e.g. "read_file", "status"
    params      : dict           – action-specific parameters
    request_id  : str            – correlation ID; auto-generated when absent
    mode        : str            – DevToolMode constant (default READ_ONLY)
    context     : dict           – optional caller context (workspace_root, etc.)
    metadata    : dict           – free-form caller metadata
    """

    tool_name:  str
    action:     str
    params:     dict[str, Any]   = field(default_factory=dict)
    request_id: str              = field(default_factory=lambda: str(uuid.uuid4()))
    mode:       str              = DevToolMode.READ_ONLY
    context:    dict[str, Any]   = field(default_factory=dict)
    metadata:   dict[str, Any]   = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Output / execution result envelope
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DevToolResult:
    """
    Standardised result returned by the DevToolExecutor.

    Attributes
    ----------
    request_id        : str        – threaded from DevToolInput
    tool_name         : str        – e.g. "filesystem", "git"
    action            : str        – sub-action executed
    success           : bool       – True when action completed
    raw_output        : Any        – verbatim output from the tool
    normalized_output : Any        – cleaned, structured output
    validation_passed : bool       – True when validate_output passed
    error_code        : str | None – machine-readable error token
    error_message     : str | None – human-readable description
    latency_ms        : int        – wall-clock milliseconds
    metadata          : dict       – tool-level metadata (exit_code, path, …)
    retryable         : bool       – hint: is this error transient?
    source_reference  : str | None – file path, URL, command that was operated on
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
    metadata:          dict[str, Any]    = field(default_factory=dict)
    retryable:         bool              = False
    source_reference:  str | None        = None

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
            "metadata":          self.metadata,
            "retryable":         self.retryable,
            "source_reference":  self.source_reference,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Validation result helper
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DevToolValidationResult:
    """
    Returned by BaseDevTool.validate_output() and validate_input().

    Attributes
    ----------
    passed  : bool       – overall pass/fail
    errors  : list[str]  – human-readable failure reasons
    """

    passed: bool
    errors: list[str] = field(default_factory=list)

    @classmethod
    def ok(cls) -> "DevToolValidationResult":
        return cls(passed=True)

    @classmethod
    def fail(cls, *reasons: str) -> "DevToolValidationResult":
        return cls(passed=False, errors=list(reasons))


# ─────────────────────────────────────────────────────────────────────────────
# Error codes
# ─────────────────────────────────────────────────────────────────────────────

class DevToolErrorCode:
    """Machine-readable error tokens used in DevToolResult.error_code."""

    # Input / routing
    UNSUPPORTED_TOOL    = "DEVTOOL_UNSUPPORTED_TOOL"
    UNSUPPORTED_ACTION  = "DEVTOOL_UNSUPPORTED_ACTION"
    INPUT_INVALID       = "DEVTOOL_INPUT_INVALID"

    # Execution
    ACTION_FAILED       = "DEVTOOL_ACTION_FAILED"
    PERMISSION_DENIED   = "DEVTOOL_PERMISSION_DENIED"
    TIMEOUT             = "DEVTOOL_TIMEOUT"
    DEPENDENCY_ERROR    = "DEVTOOL_DEPENDENCY_ERROR"

    # Output
    VALIDATION_FAILED   = "DEVTOOL_VALIDATION_FAILED"
    NORMALIZATION_ERROR = "DEVTOOL_NORMALIZATION_ERROR"
    EMPTY_OUTPUT        = "DEVTOOL_EMPTY_OUTPUT"

    # Filesystem / path
    PATH_NOT_FOUND      = "DEVTOOL_PATH_NOT_FOUND"
    PATH_UNSAFE         = "DEVTOOL_PATH_UNSAFE"
    FILE_TOO_LARGE      = "DEVTOOL_FILE_TOO_LARGE"

    # Shell / process
    COMMAND_BLOCKED     = "DEVTOOL_COMMAND_BLOCKED"
    NONZERO_EXIT        = "DEVTOOL_NONZERO_EXIT"

    # Mode / safety
    WRITE_BLOCKED       = "DEVTOOL_WRITE_BLOCKED"
    EXECUTE_BLOCKED     = "DEVTOOL_EXECUTE_BLOCKED"
    DEPLOY_BLOCKED      = "DEVTOOL_DEPLOY_BLOCKED"

    # Unknown
    UNKNOWN             = "DEVTOOL_UNKNOWN_ERROR"
