"""
tests/modules/test_module_types.py
────────────────────────────────────
Unit tests for app/modules/types.py

Coverage
--------
1. ModuleInput – default request_id generated, fields accessible
2. ExecutionResult – as_dict serialises all fields correctly
3. ValidationResult – ok() / fail() constructors
4. ModuleErrorCode – constants defined and are strings
"""
from __future__ import annotations

import uuid

import pytest

from app.modules.types import (
    ExecutionResult,
    ModuleErrorCode,
    ModuleInput,
    ValidationResult,
)


# ─────────────────────────────────────────────────────────────────────────────
# ModuleInput
# ─────────────────────────────────────────────────────────────────────────────

class TestModuleInput:
    def test_auto_request_id(self):
        mi = ModuleInput(task_type="classify", raw_input="hello")
        assert mi.request_id
        # Should be a valid UUID4 string
        parsed = uuid.UUID(mi.request_id)
        assert parsed.version == 4

    def test_explicit_request_id(self):
        rid = "my-custom-id"
        mi  = ModuleInput(task_type="summarize", raw_input="text", request_id=rid)
        assert mi.request_id == rid

    def test_metadata_defaults_empty(self):
        mi = ModuleInput(task_type="translate", raw_input={})
        assert mi.metadata == {}

    def test_metadata_stored(self):
        mi = ModuleInput(
            task_type = "classify",
            raw_input = "x",
            metadata  = {"source_lang": "en", "target_lang": "ko"},
        )
        assert mi.metadata["target_lang"] == "ko"

    def test_two_instances_get_different_request_ids(self):
        a = ModuleInput(task_type="code", raw_input="a")
        b = ModuleInput(task_type="code", raw_input="b")
        assert a.request_id != b.request_id


# ─────────────────────────────────────────────────────────────────────────────
# ExecutionResult
# ─────────────────────────────────────────────────────────────────────────────

class TestExecutionResult:
    def _make(self, **overrides) -> ExecutionResult:
        defaults = dict(
            request_id   = "rid-001",
            module_name  = "classify",
            task_type    = "classify",
            success      = True,
            latency_ms   = 42,
        )
        defaults.update(overrides)
        return ExecutionResult(**defaults)

    def test_as_dict_contains_all_keys(self):
        result = self._make()
        d = result.as_dict()
        expected_keys = {
            "request_id", "module_name", "task_type",
            "selected_provider", "selected_model", "fallback_used",
            "success", "raw_output", "normalized_output",
            "validation_passed", "error_code", "error_message",
            "latency_ms", "estimated_cost",
        }
        assert expected_keys == set(d.keys())

    def test_as_dict_values_match_fields(self):
        result = self._make(
            selected_provider = "openai",
            selected_model    = "gpt-4o-mini",
            fallback_used     = True,
            success           = True,
            latency_ms        = 99,
            estimated_cost    = 0.002,
        )
        d = result.as_dict()
        assert d["selected_provider"] == "openai"
        assert d["selected_model"]    == "gpt-4o-mini"
        assert d["fallback_used"]     is True
        assert d["latency_ms"]        == 99
        assert d["estimated_cost"]    == pytest.approx(0.002)

    def test_defaults(self):
        result = ExecutionResult(
            request_id  = "r",
            module_name = "code",
            task_type   = "code",
        )
        assert result.selected_provider == "unknown"
        assert result.selected_model    == "unknown"
        assert result.fallback_used     is False
        assert result.success           is False
        assert result.validation_passed is False
        assert result.error_code        is None
        assert result.estimated_cost    is None


# ─────────────────────────────────────────────────────────────────────────────
# ValidationResult
# ─────────────────────────────────────────────────────────────────────────────

class TestValidationResult:
    def test_ok(self):
        vr = ValidationResult.ok()
        assert vr.passed is True
        assert vr.errors == []

    def test_fail_single_reason(self):
        vr = ValidationResult.fail("something went wrong")
        assert vr.passed is False
        assert "something went wrong" in vr.errors

    def test_fail_multiple_reasons(self):
        vr = ValidationResult.fail("reason A", "reason B", "reason C")
        assert vr.passed is False
        assert len(vr.errors) == 3

    def test_fail_empty_reason_list(self):
        vr = ValidationResult(passed=False, errors=[])
        assert vr.passed is False
        assert vr.errors == []


# ─────────────────────────────────────────────────────────────────────────────
# ModuleErrorCode
# ─────────────────────────────────────────────────────────────────────────────

class TestModuleErrorCode:
    def test_all_codes_are_strings(self):
        codes = [
            ModuleErrorCode.VALIDATION_FAILED,
            ModuleErrorCode.EMPTY_OUTPUT,
            ModuleErrorCode.PROVIDER_ERROR,
            ModuleErrorCode.INPUT_INVALID,
            ModuleErrorCode.UNSUPPORTED_TASK,
            ModuleErrorCode.NORMALIZATION_ERROR,
            ModuleErrorCode.UNKNOWN,
        ]
        for code in codes:
            assert isinstance(code, str), f"{code!r} should be a string"
            assert code.startswith("MODULE_"), f"{code!r} should start with 'MODULE_'"
