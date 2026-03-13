"""
app/modules/executor.py
────────────────────────
Phase 14 – Module executor (engine bridge).

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify this file without explicit approval.             │
│  ModuleExecutor is the sole integration point between engine    │
│  and module layer.  Changing execution order (validate before   │
│  normalise, hooks) breaks test contracts across the suite.      │
│  ProviderRunner protocol is the engine’s injection point —      │
│  changing it breaks every engine adapter.                       │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

The executor is the single integration point between the frozen engine
core and the module layer.  It:

1. Resolves the correct module for a task_type.
2. Calls module.build_prompt() to shape provider input.
3. Delegates actual provider execution to the injected ProviderRunner.
4. Calls module.validate_output() on the raw result.
5. Calls module.normalize_output() when validation passes.
6. Wraps everything in an ExecutionResult envelope.

Engine responsibilities NOT handled here
-----------------------------------------
- Provider selection         (ProviderRunner / router)
- Fallback / retry logic     (ProviderRunner)
- Cache persistence          (ProviderRunner / engine)
- Circuit breaker            (ProviderRunner / engine)
- Request logging            (ProviderRunner / engine)

ProviderRunner protocol
-----------------------
The executor accepts any callable / object that implements:

    async run(prompt, *, model, request_id, **kwargs)
        → ProviderResponse(
              raw_output,
              selected_provider,
              selected_model,
              fallback_used,
              estimated_cost,
          )

A lightweight ``MockProviderRunner`` is shipped in this file for
tests and local development without live API keys.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import structlog

from app.modules.base import BaseModule
from app.modules.registry import ModuleRegistry, get_registry
from app.modules.types import (
    ExecutionResult,
    ModuleErrorCode,
    ModuleInput,
    ValidationResult,
)

logger = structlog.get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# ProviderResponse – thin wrapper around whatever the engine runner returns
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ProviderResponse:
    """
    Minimal response envelope expected from the ProviderRunner.

    The engine's real runner must return an object that satisfies this
    dataclass's fields (duck-typed – no strict isinstance check).
    """

    raw_output:        Any
    selected_provider: str   = "unknown"
    selected_model:    str   = "unknown"
    fallback_used:     bool  = False
    estimated_cost:    float | None = None
    error:             str | None   = None   # set on provider-level failure


# ─────────────────────────────────────────────────────────────────────────────
# ProviderRunner protocol (structural subtyping)
# ─────────────────────────────────────────────────────────────────────────────

@runtime_checkable
class ProviderRunner(Protocol):
    """
    Structural protocol for the engine's provider execution layer.

    Any object with a matching ``run`` async method satisfies this protocol.
    """

    async def run(
        self,
        prompt: str | dict[str, Any],
        *,
        model: str,
        request_id: str,
        **kwargs: Any,
    ) -> ProviderResponse:
        ...


# ─────────────────────────────────────────────────────────────────────────────
# Mock runner – used in tests / local dev without real API keys
# ─────────────────────────────────────────────────────────────────────────────

class MockProviderRunner:
    """
    Deterministic stub runner for unit tests.

    Returns a configurable ``raw_output`` without touching any external
    service.  Tests construct this with the payload they want to exercise.

    Parameters
    ----------
    raw_output       : Any  – The raw provider response to return.
    provider         : str  – Reported provider name.
    model            : str  – Reported model name.
    should_fail      : bool – When True, sets error field (simulates failure).
    error_message    : str  – Error message when should_fail=True.
    estimated_cost   : float | None
    """

    def __init__(
        self,
        raw_output:     Any           = None,
        provider:       str           = "mock",
        model:          str           = "mock-model",
        should_fail:    bool          = False,
        error_message:  str           = "mock provider error",
        estimated_cost: float | None  = None,
    ) -> None:
        self._raw_output      = raw_output
        self._provider        = provider
        self._model           = model
        self._should_fail     = should_fail
        self._error_message   = error_message
        self._estimated_cost  = estimated_cost
        # Introspection helpers for tests
        self.call_count       = 0
        self.last_prompt: Any = None
        self.last_model:  str = ""

    async def run(
        self,
        prompt: str | dict[str, Any],
        *,
        model: str,
        request_id: str,
        **kwargs: Any,
    ) -> ProviderResponse:
        self.call_count   += 1
        self.last_prompt   = prompt
        self.last_model    = model

        if self._should_fail:
            return ProviderResponse(
                raw_output        = None,
                selected_provider = self._provider,
                selected_model    = model,
                fallback_used     = False,
                estimated_cost    = None,
                error             = self._error_message,
            )

        return ProviderResponse(
            raw_output        = self._raw_output,
            selected_provider = self._provider,
            selected_model    = model,
            fallback_used     = False,
            estimated_cost    = self._estimated_cost,
            error             = None,
        )


# ─────────────────────────────────────────────────────────────────────────────
# ModuleExecutor
# ─────────────────────────────────────────────────────────────────────────────

class ModuleExecutor:
    """
    Orchestrates the module execution flow on behalf of the engine.

    Parameters
    ----------
    runner   : ProviderRunner – engine's provider runner (or MockProviderRunner)
    registry : ModuleRegistry – defaults to the application singleton
    """

    def __init__(
        self,
        runner:   Any,                    # ProviderRunner or compatible
        registry: ModuleRegistry | None = None,
    ) -> None:
        self._runner   = runner
        self._registry = registry or get_registry()

    # ── Public API ────────────────────────────────────────────────────────────

    async def execute(self, module_input: ModuleInput) -> ExecutionResult:
        """
        Execute a module task end-to-end.

        Flow
        ----
        1. Resolve module from registry.
        2. Fire on_pre_execute hook.
        3. Build provider prompt via module.build_prompt().
        4. Pick preferred model (first from preferred list).
        5. Call runner.run().
        6. On runner success → validate → normalize.
        7. Fire on_post_execute hook.
        8. Return ExecutionResult.

        All exceptions are caught and surface as an ExecutionResult with
        success=False so the caller always gets a structured response.
        """
        start_ms = _now_ms()

        # ── 1. Resolve module ────────────────────────────────────────────────
        module = self._registry.resolve_or_none(module_input.task_type)
        if module is None:
            return _error_result(
                module_input,
                module_name  = "unknown",
                error_code   = ModuleErrorCode.UNSUPPORTED_TASK,
                error_message= (
                    f"No module registered for task_type="
                    f"{module_input.task_type!r}"
                ),
                latency_ms   = _elapsed(start_ms),
            )

        log = logger.bind(
            request_id = module_input.request_id,
            module     = module.name,
            task_type  = module_input.task_type,
        )
        log.info("module_executor.start")

        # ── 2. Pre-execute hook ──────────────────────────────────────────────
        try:
            module.on_pre_execute(module_input)
        except Exception as exc:  # pragma: no cover
            log.warning("module_executor.pre_execute_hook_failed", exc=str(exc))

        # ── 3. Build prompt ───────────────────────────────────────────────────
        try:
            prompt = module.build_prompt(module_input)
        except Exception as exc:
            log.error("module_executor.build_prompt_failed", exc=str(exc))
            return _error_result(
                module_input,
                module_name   = module.name,
                error_code    = ModuleErrorCode.INPUT_INVALID,
                error_message = f"build_prompt failed: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        # ── 4. Select model ───────────────────────────────────────────────────
        preferred = module.get_preferred_models()
        model     = preferred[0] if preferred else "unknown"

        # ── 5. Call runner ────────────────────────────────────────────────────
        try:
            provider_resp: ProviderResponse = await self._runner.run(
                prompt,
                model       = model,
                request_id  = module_input.request_id,
            )
        except Exception as exc:
            log.error("module_executor.runner_exception", exc=str(exc))
            return _error_result(
                module_input,
                module_name   = module.name,
                error_code    = ModuleErrorCode.PROVIDER_ERROR,
                error_message = f"Provider runner raised: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        # ── Provider-level failure (runner returned an error, didn't raise) ──
        if provider_resp.error:
            log.warning(
                "module_executor.provider_error",
                error = provider_resp.error,
            )
            module.on_post_execute(None, success=False)
            return ExecutionResult(
                request_id        = module_input.request_id,
                module_name       = module.name,
                task_type         = module_input.task_type,
                selected_provider = provider_resp.selected_provider,
                selected_model    = provider_resp.selected_model,
                fallback_used     = provider_resp.fallback_used,
                success           = False,
                raw_output        = None,
                normalized_output = None,
                validation_passed = False,
                error_code        = ModuleErrorCode.PROVIDER_ERROR,
                error_message     = provider_resp.error,
                latency_ms        = _elapsed(start_ms),
                estimated_cost    = None,
            )

        raw = provider_resp.raw_output

        # ── 6a. Validate ──────────────────────────────────────────────────────
        try:
            vr: ValidationResult = module.validate_output(raw)
        except Exception as exc:
            log.error("module_executor.validate_exception", exc=str(exc))
            module.on_post_execute(raw, success=False)
            return ExecutionResult(
                request_id        = module_input.request_id,
                module_name       = module.name,
                task_type         = module_input.task_type,
                selected_provider = provider_resp.selected_provider,
                selected_model    = provider_resp.selected_model,
                fallback_used     = provider_resp.fallback_used,
                success           = False,
                raw_output        = raw,
                normalized_output = None,
                validation_passed = False,
                error_code        = ModuleErrorCode.VALIDATION_FAILED,
                error_message     = f"validate_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
                estimated_cost    = provider_resp.estimated_cost,
            )

        if not vr.passed:
            log.warning(
                "module_executor.validation_failed",
                errors = vr.errors,
            )
            module.on_post_execute(raw, success=False)
            return ExecutionResult(
                request_id        = module_input.request_id,
                module_name       = module.name,
                task_type         = module_input.task_type,
                selected_provider = provider_resp.selected_provider,
                selected_model    = provider_resp.selected_model,
                fallback_used     = provider_resp.fallback_used,
                success           = False,
                raw_output        = raw,
                normalized_output = None,
                validation_passed = False,
                error_code        = ModuleErrorCode.VALIDATION_FAILED,
                error_message     = "; ".join(vr.errors),
                latency_ms        = _elapsed(start_ms),
                estimated_cost    = provider_resp.estimated_cost,
            )

        # ── 6b. Normalize ─────────────────────────────────────────────────────
        try:
            normalized = module.normalize_output(raw)
        except Exception as exc:
            log.error("module_executor.normalize_exception", exc=str(exc))
            module.on_post_execute(raw, success=False)
            return ExecutionResult(
                request_id        = module_input.request_id,
                module_name       = module.name,
                task_type         = module_input.task_type,
                selected_provider = provider_resp.selected_provider,
                selected_model    = provider_resp.selected_model,
                fallback_used     = provider_resp.fallback_used,
                success           = False,
                raw_output        = raw,
                normalized_output = None,
                validation_passed = True,
                error_code        = ModuleErrorCode.NORMALIZATION_ERROR,
                error_message     = f"normalize_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
                estimated_cost    = provider_resp.estimated_cost,
            )

        # ── 7. Post-execute hook ──────────────────────────────────────────────
        try:
            module.on_post_execute(raw, success=True)
        except Exception as exc:  # pragma: no cover
            log.warning("module_executor.post_execute_hook_failed", exc=str(exc))

        latency = _elapsed(start_ms)
        log.info(
            "module_executor.success",
            latency_ms     = latency,
            fallback_used  = provider_resp.fallback_used,
            estimated_cost = provider_resp.estimated_cost,
        )

        # ── 8. Return result ──────────────────────────────────────────────────
        return ExecutionResult(
            request_id        = module_input.request_id,
            module_name       = module.name,
            task_type         = module_input.task_type,
            selected_provider = provider_resp.selected_provider,
            selected_model    = provider_resp.selected_model,
            fallback_used     = provider_resp.fallback_used,
            success           = True,
            raw_output        = raw,
            normalized_output = normalized,
            validation_passed = True,
            error_code        = None,
            error_message     = None,
            latency_ms        = latency,
            estimated_cost    = provider_resp.estimated_cost,
        )

    # ── Convenience: batch execution ─────────────────────────────────────────

    async def execute_many(
        self, inputs: list[ModuleInput]
    ) -> list[ExecutionResult]:
        """Execute a list of ModuleInputs sequentially, returning all results."""
        results = []
        for mi in inputs:
            results.append(await self.execute(mi))
        return results


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.monotonic() * 1000)


def _elapsed(start_ms: int) -> int:
    return _now_ms() - start_ms


def _error_result(
    module_input:  ModuleInput,
    module_name:   str,
    error_code:    str,
    error_message: str,
    latency_ms:    int,
) -> ExecutionResult:
    return ExecutionResult(
        request_id        = module_input.request_id,
        module_name       = module_name,
        task_type         = module_input.task_type,
        success           = False,
        validation_passed = False,
        error_code        = error_code,
        error_message     = error_message,
        latency_ms        = latency_ms,
    )
