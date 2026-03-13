"""
app/devtools/base.py
────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  All developer tools inherit from BaseDevTool.                  │
│  Adding abstract methods forces changes across all tools.       │
│  See DEVTOOLS_STATUS_REPORT.md §freeze for rules.              │
└─────────────────────────────────────────────────────────────────┘

Abstract base class for all Phase 16 developer tool implementations.

Responsibilities of a DevTool
──────────────────────────────
  • Declare supported actions          (get_actions)
  • Declare input/output schemas       (get_input_schema, get_output_schema)
  • Declare operation type             (get_op_type)
  • Validate input params              (validate_input)
  • Execute the developer action       (execute_action)
  • Validate raw output                (validate_output)
  • Normalize raw output               (normalize_output)
  • Declare error mapping              (get_error_mapping)
  • Optional lifecycle hooks           (on_pre_execute, on_post_execute)

What BaseDevTool does NOT do
─────────────────────────────
  • Provider routing / fallback    → engine
  • LLM prompt shaping             → module layer
  • Generic tool execution         → Phase 15 tool layer
  • DB / Redis / Celery            → application layer
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.devtools.types import (
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)


class BaseDevTool(ABC):
    """
    Abstract base for all Phase 16 developer tool implementations.

    Subclasses must implement every ``@abstractmethod`` below.
    Lifecycle hooks and ``can_handle`` have default implementations
    that may be overridden.
    """

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique tool identifier. E.g. 'filesystem', 'git', 'terminal'."""

    # ── Capability declarations ───────────────────────────────────────────────

    @abstractmethod
    def get_actions(self) -> list[str]:
        """List of action strings this tool supports."""

    @abstractmethod
    def get_op_type(self) -> str:
        """
        Return the primary DevToolOpType for this tool.

        Used by the executor for mode-gating (e.g. EXECUTE ops require
        DevToolMode.FULL; WRITE ops require at least SAFE_WRITE).
        """

    @abstractmethod
    def get_input_schema(self) -> dict[str, Any]:
        """JSON-schema-style dict describing expected ``params`` keys."""

    @abstractmethod
    def get_output_schema(self) -> dict[str, Any]:
        """JSON-schema-style dict describing ``normalized_output`` shape."""

    # ── Error mapping ─────────────────────────────────────────────────────────

    def get_error_mapping(self) -> dict[str, str]:
        """
        Return a dict mapping exception class names → DevToolErrorCode.

        Override to add tool-specific exception → error_code mappings.
        The executor uses this to enrich error_code in the result.
        """
        return {}

    # ── Core contract ─────────────────────────────────────────────────────────

    @abstractmethod
    def validate_input(
        self, tool_input: DevToolInput
    ) -> DevToolValidationResult:
        """
        Validate ``tool_input.params`` and ``tool_input.mode`` before executing.

        Safety mode checks should happen here.  Return
        ``DevToolValidationResult.fail(reason)`` to block the action.
        """

    @abstractmethod
    async def execute_action(self, tool_input: DevToolInput) -> Any:
        """
        Perform the developer operation.

        Raise ``DevToolError`` (or any subclass) on hard failure.
        Returns raw output — any type the normalizer can handle.
        """

    @abstractmethod
    def validate_output(self, raw_output: Any) -> DevToolValidationResult:
        """Validate the raw output returned by ``execute_action``."""

    @abstractmethod
    def normalize_output(self, raw_output: Any) -> Any:
        """Transform raw output into the documented output shape."""

    # ── Convenience ───────────────────────────────────────────────────────────

    def can_handle(self, action: str) -> bool:
        """Return True if this tool supports the given action string."""
        return action in self.get_actions()

    def requires_mode(self) -> str:
        """
        Return the minimum DevToolMode required for this tool's op type.

        EXECUTE / DEPLOY → FULL
        WRITE            → SAFE_WRITE
        All others       → READ_ONLY
        """
        op = self.get_op_type()
        if op in (DevToolOpType.EXECUTE, DevToolOpType.DEPLOY):
            return DevToolMode.FULL
        if op == DevToolOpType.WRITE:
            return DevToolMode.SAFE_WRITE
        return DevToolMode.READ_ONLY

    # ── Lifecycle hooks (optional override) ───────────────────────────────────

    def on_pre_execute(self, tool_input: DevToolInput) -> None:
        """Called immediately before ``execute_action``. Default: no-op."""

    def on_post_execute(self, raw_output: Any, *, success: bool) -> None:
        """Called after the execute/validate/normalize pipeline. Default: no-op."""
