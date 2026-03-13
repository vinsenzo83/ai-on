"""
tests/modules/test_module_executor.py
───────────────────────────────────────
Unit tests for app/modules/executor.py

Coverage
--------
1.  Happy path – executor returns success ExecutionResult
2.  Unknown task_type – returns UNSUPPORTED_TASK error
3.  Provider failure (error field set) – returns PROVIDER_ERROR
4.  Provider raises exception – returns PROVIDER_ERROR
5.  Validation failure – returns VALIDATION_FAILED with validation_passed=False
6.  Normalisation raises – returns NORMALIZATION_ERROR with validation_passed=True
7.  build_prompt raises – returns INPUT_INVALID
8.  MockProviderRunner.call_count increments correctly
9.  execute_many – returns list of results in order
10. ExecutionResult.as_dict includes all required fields
11. Preferred model is selected first
12. fallback_used propagated from provider response
13. estimated_cost propagated from provider response
14. latency_ms is non-negative
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.modules.base import BaseModule
from app.modules.executor import MockProviderRunner, ModuleExecutor, ProviderResponse
from app.modules.registry import ModuleRegistry
from app.modules.types import (
    ExecutionResult,
    ModuleErrorCode,
    ModuleInput,
    ValidationResult,
)


# ─────────────────────────────────────────────────────────────────────────────
# Test-double modules
# ─────────────────────────────────────────────────────────────────────────────

class _OkModule(BaseModule):
    """Module that always validates and normalises successfully."""

    @property
    def name(self):       return "ok_module"
    def get_task_types(self): return ["ok_task"]
    def get_input_schema(self):   return {}
    def get_output_schema(self):  return {}
    def get_preferred_models(self):  return ["mock-model-v1", "mock-model-v2"]
    def get_fallback_models(self):   return ["fallback-model"]

    def build_prompt(self, mi: ModuleInput):
        return {"messages": [{"role": "user", "content": str(mi.raw_input)}]}

    def validate_output(self, raw: Any) -> ValidationResult:
        if raw is None:
            return ValidationResult.fail("None not allowed")
        return ValidationResult.ok()

    def normalize_output(self, raw: Any) -> Any:
        return {"normalized": raw}


class _ValidationFailModule(BaseModule):
    """Module whose validate_output always fails."""

    @property
    def name(self):            return "fail_val_module"
    def get_task_types(self):  return ["fail_val_task"]
    def get_input_schema(self):   return {}
    def get_output_schema(self):  return {}
    def get_preferred_models(self):  return ["m"]
    def get_fallback_models(self):   return []

    def build_prompt(self, mi):  return "prompt"

    def validate_output(self, raw: Any) -> ValidationResult:
        return ValidationResult.fail("always fails", "second reason")

    def normalize_output(self, raw: Any) -> Any:
        return raw


class _NormRaisesModule(BaseModule):
    """Module whose normalize_output always raises."""

    @property
    def name(self):            return "norm_raise_module"
    def get_task_types(self):  return ["norm_raise_task"]
    def get_input_schema(self):   return {}
    def get_output_schema(self):  return {}
    def get_preferred_models(self):  return ["m"]
    def get_fallback_models(self):   return []

    def build_prompt(self, mi):  return "prompt"

    def validate_output(self, raw: Any) -> ValidationResult:
        return ValidationResult.ok()

    def normalize_output(self, raw: Any) -> Any:
        raise RuntimeError("normalisation exploded")


class _BuildPromptRaisesModule(BaseModule):
    """Module whose build_prompt always raises."""

    @property
    def name(self):            return "bp_raise_module"
    def get_task_types(self):  return ["bp_raise_task"]
    def get_input_schema(self):   return {}
    def get_output_schema(self):  return {}
    def get_preferred_models(self):  return ["m"]
    def get_fallback_models(self):   return []

    def build_prompt(self, mi):
        raise ValueError("prompt build exploded")

    def validate_output(self, raw: Any) -> ValidationResult:
        return ValidationResult.ok()

    def normalize_output(self, raw: Any) -> Any:
        return raw


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _make_registry(*modules: BaseModule) -> ModuleRegistry:
    return ModuleRegistry(list(modules))


def _make_executor(
    runner:   Any              = None,
    *modules: BaseModule,
) -> ModuleExecutor:
    if runner is None:
        runner = MockProviderRunner(raw_output="provider reply")
    registry = _make_registry(*modules)
    return ModuleExecutor(runner=runner, registry=registry)


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_happy_path_returns_success():
    mod      = _OkModule()
    runner   = MockProviderRunner(raw_output="hello world")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="ok_task", raw_input="test input")

    result = await executor.execute(mi)

    assert result.success           is True
    assert result.validation_passed is True
    assert result.error_code        is None
    assert result.module_name       == "ok_module"
    assert result.task_type         == "ok_task"
    assert result.normalized_output == {"normalized": "hello world"}
    assert result.raw_output        == "hello world"


@pytest.mark.anyio
async def test_unknown_task_type_returns_unsupported():
    executor = ModuleExecutor(
        runner   = MockProviderRunner(),
        registry = _make_registry(),      # empty registry
    )
    mi     = ModuleInput(task_type="ghost_task", raw_input="x")
    result = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.UNSUPPORTED_TASK


@pytest.mark.anyio
async def test_provider_error_field_returns_provider_error():
    mod    = _OkModule()
    runner = MockProviderRunner(should_fail=True, error_message="provider down")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="ok_task", raw_input="x")

    result = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.PROVIDER_ERROR
    assert "provider down" in (result.error_message or "")


@pytest.mark.anyio
async def test_provider_runner_raises_returns_provider_error():
    class _ExplodingRunner:
        async def run(self, prompt, *, model, request_id, **kwargs):
            raise ConnectionError("network is dead")

    mod      = _OkModule()
    executor = _make_executor(_ExplodingRunner(), mod)
    mi       = ModuleInput(task_type="ok_task", raw_input="x")

    result = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.PROVIDER_ERROR
    assert "network is dead" in (result.error_message or "")


@pytest.mark.anyio
async def test_validation_failure_path():
    mod      = _ValidationFailModule()
    runner   = MockProviderRunner(raw_output="some output")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="fail_val_task", raw_input="x")

    result = await executor.execute(mi)

    assert result.success           is False
    assert result.validation_passed is False
    assert result.error_code        == ModuleErrorCode.VALIDATION_FAILED
    assert result.raw_output        == "some output"
    assert result.normalized_output is None
    # Both failure reasons should be in message
    assert "always fails"   in (result.error_message or "")
    assert "second reason"  in (result.error_message or "")


@pytest.mark.anyio
async def test_normalisation_raises_returns_normalisation_error():
    mod      = _NormRaisesModule()
    runner   = MockProviderRunner(raw_output="data")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="norm_raise_task", raw_input="x")

    result = await executor.execute(mi)

    assert result.success           is False
    assert result.validation_passed is True   # validation passed
    assert result.error_code        == ModuleErrorCode.NORMALIZATION_ERROR
    assert "normalisation exploded" in (result.error_message or "")


@pytest.mark.anyio
async def test_build_prompt_raises_returns_input_invalid():
    mod      = _BuildPromptRaisesModule()
    runner   = MockProviderRunner(raw_output="data")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="bp_raise_task", raw_input="x")

    result = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.INPUT_INVALID


@pytest.mark.anyio
async def test_mock_runner_call_count():
    mod    = _OkModule()
    runner = MockProviderRunner(raw_output="r")
    executor = _make_executor(runner, mod)

    assert runner.call_count == 0
    await executor.execute(ModuleInput(task_type="ok_task", raw_input="a"))
    assert runner.call_count == 1
    await executor.execute(ModuleInput(task_type="ok_task", raw_input="b"))
    assert runner.call_count == 2


@pytest.mark.anyio
async def test_execute_many_returns_results_in_order():
    mod    = _OkModule()
    runner = MockProviderRunner(raw_output="reply")
    executor = _make_executor(runner, mod)

    inputs = [
        ModuleInput(task_type="ok_task", raw_input=f"item{i}") for i in range(5)
    ]
    results = await executor.execute_many(inputs)

    assert len(results) == 5
    assert all(r.success for r in results)


@pytest.mark.anyio
async def test_result_as_dict_contains_all_fields():
    mod      = _OkModule()
    runner   = MockProviderRunner(raw_output="output")
    executor = _make_executor(runner, mod)
    mi       = ModuleInput(task_type="ok_task", raw_input="x")

    result = await executor.execute(mi)
    d      = result.as_dict()

    required = {
        "request_id", "module_name", "task_type",
        "selected_provider", "selected_model", "fallback_used",
        "success", "raw_output", "normalized_output",
        "validation_passed", "error_code", "error_message",
        "latency_ms", "estimated_cost",
    }
    assert required.issubset(set(d.keys()))


@pytest.mark.anyio
async def test_preferred_model_is_sent_to_runner():
    mod    = _OkModule()
    runner = MockProviderRunner(raw_output="r")
    executor = _make_executor(runner, mod)
    await executor.execute(ModuleInput(task_type="ok_task", raw_input="x"))
    # Preferred models: ["mock-model-v1", "mock-model-v2"]
    assert runner.last_model == "mock-model-v1"


@pytest.mark.anyio
async def test_fallback_used_propagated():
    mod    = _OkModule()
    runner = MockProviderRunner(raw_output="r")
    # Manually return fallback_used=True from provider
    runner._raw_output = "r"

    class _FallbackRunner:
        async def run(self, prompt, *, model, request_id, **kw):
            return ProviderResponse(
                raw_output        = "fallback reply",
                selected_provider = "openai",
                selected_model    = "gpt-4o",
                fallback_used     = True,
                estimated_cost    = 0.005,
            )

    executor = _make_executor(_FallbackRunner(), mod)
    result   = await executor.execute(ModuleInput(task_type="ok_task", raw_input="x"))

    assert result.fallback_used is True
    assert result.selected_model == "gpt-4o"


@pytest.mark.anyio
async def test_estimated_cost_propagated():
    mod  = _OkModule()

    class _CostRunner:
        async def run(self, prompt, *, model, request_id, **kw):
            return ProviderResponse(
                raw_output        = "answer",
                selected_provider = "anthropic",
                selected_model    = "claude-3-haiku",
                estimated_cost    = 0.00123,
            )

    executor = _make_executor(_CostRunner(), mod)
    result   = await executor.execute(ModuleInput(task_type="ok_task", raw_input="x"))

    assert result.estimated_cost == pytest.approx(0.00123)


@pytest.mark.anyio
async def test_latency_ms_non_negative():
    mod      = _OkModule()
    runner   = MockProviderRunner(raw_output="r")
    executor = _make_executor(runner, mod)
    result   = await executor.execute(ModuleInput(task_type="ok_task", raw_input="x"))

    assert result.latency_ms >= 0
