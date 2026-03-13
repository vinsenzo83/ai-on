"""
app/modules/base.py
────────────────────
Phase 14 – Abstract base class for all first-class modules.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify this file without explicit approval.             │
│  All 7 first-class modules inherit from BaseModule.  Adding a   │
│  new abstract method forces every module to be updated.         │
│  Removing a method breaks every caller.                         │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

Every module MUST inherit from BaseModule and implement the abstract
methods.  The concrete implementations live in app/modules/modules/.

Contract
--------
- canHandle(task_type)       → bool
- get_task_types()           → list[str]
- get_input_schema()         → dict   (JSON-Schema-style descriptor)
- get_output_schema()        → dict   (JSON-Schema-style descriptor)
- get_preferred_models()     → list[str]
- get_fallback_models()      → list[str]
- build_prompt(module_input) → str | dict   (shapes provider input)
- validate_output(raw)       → ValidationResult
- normalize_output(raw)      → Any

Design notes
------------
* No ORM imports here – keeps the base usable in unit tests without DB.
* Engine responsibilities (routing, retries, provider selection) stay in
  the engine layer.  Modules only shape, validate, and normalise.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.modules.types import ModuleInput, ValidationResult


class BaseModule(ABC):
    """
    Abstract base for all Phase-14 execution modules.

    Subclasses must implement every abstract method.  The optional hooks
    (``on_pre_execute``, ``on_post_execute``) may be overridden for
    module-specific side-effects (metrics, audit logging, etc.) without
    touching the base flow.
    """

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique module identifier, e.g. "classify"."""

    # ── Task routing ──────────────────────────────────────────────────────────

    @abstractmethod
    def get_task_types(self) -> list[str]:
        """
        Return every task-type string this module handles.

        Example: ["classify", "categorise"]
        """

    def can_handle(self, task_type: str) -> bool:
        """Return True if this module handles the given task_type."""
        return task_type.lower() in [t.lower() for t in self.get_task_types()]

    # ── Schema descriptors ────────────────────────────────────────────────────

    @abstractmethod
    def get_input_schema(self) -> dict[str, Any]:
        """
        JSON-Schema-compatible description of accepted input.

        Consumers (admin dashboard, tool layer) use this for documentation
        and basic type validation before calling the module.
        """

    @abstractmethod
    def get_output_schema(self) -> dict[str, Any]:
        """
        JSON-Schema-compatible description of the normalised output structure.
        """

    # ── Model preferences ─────────────────────────────────────────────────────

    @abstractmethod
    def get_preferred_models(self) -> list[str]:
        """
        Ordered list of model IDs to try first.

        The engine selects from this list subject to availability,
        circuit-breaker state, and disabled-model policy.
        """

    @abstractmethod
    def get_fallback_models(self) -> list[str]:
        """
        Ordered list of model IDs to use when preferred models are exhausted.
        """

    # ── Prompt / input shaping ────────────────────────────────────────────────

    @abstractmethod
    def build_prompt(self, module_input: ModuleInput) -> str | dict[str, Any]:
        """
        Transform a ModuleInput into a provider-ready prompt or message dict.

        The engine hands the return value to the selected provider.
        Modules must NOT make provider API calls here.
        """

    # ── Validation ────────────────────────────────────────────────────────────

    @abstractmethod
    def validate_output(self, raw_output: Any) -> ValidationResult:
        """
        Validate the raw provider output against module-specific rules.

        Returns ValidationResult.ok() on success or
        ValidationResult.fail(reason…) on failure.

        This is called by the ModuleExecutor BEFORE normalization.
        """

    # ── Normalization ─────────────────────────────────────────────────────────

    @abstractmethod
    def normalize_output(self, raw_output: Any) -> Any:
        """
        Transform raw provider output into the module's canonical output shape.

        Only called when validate_output passes.
        Must return a plain Python structure (dict / list / str).
        """

    # ── Optional lifecycle hooks ──────────────────────────────────────────────

    def on_pre_execute(self, module_input: ModuleInput) -> None:
        """Called by ModuleExecutor just before provider execution."""

    def on_post_execute(self, raw_output: Any, success: bool) -> None:
        """Called by ModuleExecutor immediately after provider execution."""

    # ── String representation ─────────────────────────────────────────────────

    def __repr__(self) -> str:
        return f"<Module:{self.name} tasks={self.get_task_types()}>"
