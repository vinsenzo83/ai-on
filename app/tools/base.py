"""
app/tools/base.py
─────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  All concrete tools inherit from BaseTool.  Adding abstract     │
│  methods here forces changes across every tool implementation.  │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

Abstract base class for all tool implementations.

Responsibilities of a Tool
──────────────────────────
  • Declare supported actions (get_actions)
  • Declare input/output schemas (get_input_schema, get_output_schema)
  • Validate input parameters (validate_input)
  • Execute the action against an external service (execute_action)
  • Validate the raw output (validate_output)
  • Normalize the raw output into a clean structure (normalize_output)
  • Optional lifecycle hooks (on_pre_execute, on_post_execute)

What BaseTool does NOT do
─────────────────────────
  • Provider routing / fallback  → engine
  • Task prompt shaping           → module layer
  • DB / Redis / Celery           → application layer
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.tools.types import ToolInput, ToolResult, ToolValidationResult


class BaseTool(ABC):
    """
    Abstract base class for all Phase 15 tool implementations.

    Subclasses must implement every ``@abstractmethod`` below.
    Optional lifecycle hooks ``on_pre_execute`` / ``on_post_execute``
    have no-op defaults and may be overridden.
    """

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Unique tool identifier used for registry lookup.

        Examples: "search", "pdf", "ocr", "email", "image", "browser"
        """

    # ── Schema & capability declarations ─────────────────────────────────────

    @abstractmethod
    def get_actions(self) -> list[str]:
        """
        Return the list of action strings this tool supports.

        Example: ["query", "news", "image_search"]  for SearchTool
        """

    @abstractmethod
    def get_input_schema(self) -> dict[str, Any]:
        """
        Return a JSON-schema-style dict describing expected ``params`` keys.

        Used for documentation and optional runtime validation.
        """

    @abstractmethod
    def get_output_schema(self) -> dict[str, Any]:
        """
        Return a JSON-schema-style dict describing ``normalized_output`` shape.
        """

    # ── Core contract ─────────────────────────────────────────────────────────

    @abstractmethod
    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        """
        Validate ``tool_input.params`` before executing.

        Return ``ToolValidationResult.ok()`` if valid,
        or ``ToolValidationResult.fail(reason, ...)`` otherwise.
        """

    @abstractmethod
    async def execute_action(self, tool_input: ToolInput) -> Any:
        """
        Perform the external I/O action.

        Should raise ``ToolActionError`` (or any exception) on hard failure.
        Returns raw output – any type the normalizer can work with.
        """

    @abstractmethod
    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        """
        Validate the raw output returned by ``execute_action``.

        Called after a successful action to ensure the external service
        returned usable data.
        """

    @abstractmethod
    def normalize_output(self, raw_output: Any) -> Any:
        """
        Transform raw output into the clean, documented output shape.

        Only called when ``validate_output`` returns ``passed=True``.
        """

    # ── Convenience helper ────────────────────────────────────────────────────

    def can_handle(self, action: str) -> bool:
        """Return True if this tool supports the given action string."""
        return action in self.get_actions()

    # ── Lifecycle hooks (optional override) ───────────────────────────────────

    def on_pre_execute(self, tool_input: ToolInput) -> None:
        """
        Called by ToolExecutor immediately before ``execute_action``.

        Default: no-op.  Override to add logging, metrics, rate-limiting, …
        """

    def on_post_execute(self, raw_output: Any, *, success: bool) -> None:
        """
        Called by ToolExecutor immediately after the execute/validate/normalize
        pipeline (regardless of success/failure).

        Default: no-op.  Override to record metrics, flush buffers, …
        """


# ─────────────────────────────────────────────────────────────────────────────
# Custom exception
# ─────────────────────────────────────────────────────────────────────────────

class ToolActionError(Exception):
    """
    Raised by concrete tool ``execute_action`` implementations when a
    hard failure occurs (network error, bad status code, parse failure, …).

    Attributes
    ----------
    error_code : str – one of ToolErrorCode constants
    message    : str – human-readable description
    """

    def __init__(self, message: str, error_code: str = "TOOL_ACTION_FAILED") -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message    = message
