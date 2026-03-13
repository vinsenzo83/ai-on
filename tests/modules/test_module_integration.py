"""
tests/modules/test_module_integration.py
──────────────────────────────────────────
Integration-style tests: engine (executor) + module layer end-to-end.

These tests use MockProviderRunner so no live API keys are required,
but the full stack is exercised:
  ModuleInput → ModuleExecutor → registry.resolve() → module.build_prompt()
              → MockProviderRunner.run() → module.validate_output()
              → module.normalize_output() → ExecutionResult

Coverage
--------
A. One happy-path integration test per module (7 total)
B. End-to-end validation failure integration (executor surfaces error)
C. Unknown task type handled gracefully by executor
D. Module registry correctly routes aliases via executor
E. execute_many returns correct count and all succeed
F. ExecutionResult.as_dict() is JSON-serialisable (admin-ready)
G. request_id threaded through from input to result
H. Batch of mixed task types executed correctly
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from app.modules import ExecutionResult, ModuleExecutor, ModuleInput, get_registry
from app.modules.executor import MockProviderRunner, ProviderResponse
from app.modules.types import ModuleErrorCode


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_executor(raw_output: Any = "default output") -> ModuleExecutor:
    runner = MockProviderRunner(raw_output=raw_output)
    return ModuleExecutor(runner=runner, registry=get_registry())


# ─────────────────────────────────────────────────────────────────────────────
# A. Happy-path integration per module
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_classify_happy_path():
    raw_output = json.dumps({
        "label":      "beauty",
        "confidence": 0.91,
        "all_labels": [{"label": "beauty", "score": 0.91}],
    })
    executor = _make_executor(raw_output)
    mi       = ModuleInput(
        task_type = "classify",
        raw_input = {"text": "This moisturiser is amazing for dry skin."},
    )
    result = await executor.execute(mi)

    assert result.success           is True
    assert result.module_name       == "classify"
    assert result.validation_passed is True
    assert result.normalized_output["label"] == "beauty"


@pytest.mark.anyio
async def test_integration_summarize_happy_path():
    raw_output = "A concise summary of the original article content covering key points."
    executor   = _make_executor(raw_output)
    mi         = ModuleInput(
        task_type = "summarize",
        raw_input = {"text": "Very long article text…" * 20, "style": "brief"},
    )
    result = await executor.execute(mi)

    assert result.success           is True
    assert result.module_name       == "summarize"
    assert result.normalized_output["word_count"] > 0


@pytest.mark.anyio
async def test_integration_translate_happy_path():
    raw_output = "안녕하세요, 세계!"
    executor   = _make_executor(raw_output)
    mi         = ModuleInput(
        task_type = "translate",
        raw_input = {"text": "Hello, World!", "target_lang": "ko"},
    )
    result = await executor.execute(mi)

    assert result.success is True
    assert result.module_name == "translate"
    assert result.normalized_output["translated_text"] == "안녕하세요, 세계!"
    assert result.normalized_output["char_count"]      > 0


@pytest.mark.anyio
async def test_integration_extract_happy_path():
    raw_output = json.dumps({
        "entities":       [{"type": "BRAND", "value": "Laneige", "span": "Laneige"}],
        "key_value_pairs": {"price": "$28.00"},
    })
    executor = _make_executor(raw_output)
    mi       = ModuleInput(
        task_type = "extract",
        raw_input = {"text": "Laneige Water Sleeping Mask 70ml – $28.00"},
    )
    result = await executor.execute(mi)

    assert result.success is True
    assert result.module_name == "extract"
    assert len(result.normalized_output["entities"]) == 1
    assert result.normalized_output["key_value_pairs"]["price"] == "$28.00"


@pytest.mark.anyio
async def test_integration_analysis_happy_path():
    raw_output = json.dumps({
        "analysis_type": "general",
        "summary":       "The product has strong positive reception.",
        "sentiment":     {"label": "positive", "score": 0.87},
        "topics":        ["skincare", "moisturiser"],
        "insights":      ["Customers praise the hydration formula."],
        "confidence":    0.85,
    })
    executor = _make_executor(raw_output)
    mi       = ModuleInput(
        task_type = "analysis",
        raw_input = {"text": "Customers love the product's moisturising effect."},
    )
    result = await executor.execute(mi)

    assert result.success                        is True
    assert result.module_name                    == "analysis"
    assert result.normalized_output["summary"]   != ""
    assert result.normalized_output["confidence"] == pytest.approx(0.85)


@pytest.mark.anyio
async def test_integration_document_happy_path():
    raw_output = (
        "# Module System\n\n"
        "This document describes the module execution layer built on top of the "
        "frozen engine core. It covers architecture, design decisions, and usage "
        "patterns for all first-class modules including classify, summarize, "
        "translate, extract, analysis, document, and code modules.\n\n"
        "## Architecture\n\nThe system follows a clean separation of concerns."
    )
    executor = _make_executor(raw_output)
    mi       = ModuleInput(
        task_type = "document",
        raw_input = {"topic": "Module System", "doc_type": "readme"},
    )
    result = await executor.execute(mi)

    assert result.success                           is True
    assert result.module_name                       == "document"
    assert result.normalized_output["word_count"]   > 20
    assert result.normalized_output["section_count"] >= 1


@pytest.mark.anyio
async def test_integration_code_happy_path():
    raw_output = (
        "Here is the function:\n\n"
        "```python\n"
        "def greet(name: str) -> str:\n"
        "    return f'Hello, {name}!'\n"
        "```\n\n"
        "This function returns a greeting string."
    )
    executor = _make_executor(raw_output)
    mi       = ModuleInput(
        task_type = "code",
        raw_input = {"instruction": "Write a greet function in Python"},
    )
    result = await executor.execute(mi)

    assert result.success is True
    assert result.module_name == "code"
    assert "def greet" in result.normalized_output["code"]
    assert result.normalized_output["line_count"] >= 1


# ─────────────────────────────────────────────────────────────────────────────
# B. End-to-end validation failure
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_classify_validation_failure():
    """Executor returns validation error when module output has no 'label'."""
    raw_output = json.dumps({"confidence": 0.5})   # missing 'label'
    executor   = _make_executor(raw_output)
    mi         = ModuleInput(task_type="classify", raw_input="some text")

    result = await executor.execute(mi)

    assert result.success           is False
    assert result.validation_passed is False
    assert result.error_code        == ModuleErrorCode.VALIDATION_FAILED
    assert result.raw_output        == raw_output


@pytest.mark.anyio
async def test_integration_summarize_validation_failure_empty():
    executor = _make_executor("")   # empty output
    mi       = ModuleInput(task_type="summarize", raw_input="some article text")
    result   = await executor.execute(mi)

    assert result.success           is False
    assert result.error_code        == ModuleErrorCode.VALIDATION_FAILED


@pytest.mark.anyio
async def test_integration_document_validation_failure_too_short():
    executor = _make_executor("Too short.")   # < 20 words
    mi       = ModuleInput(task_type="document", raw_input={"topic": "test"})
    result   = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.VALIDATION_FAILED


# ─────────────────────────────────────────────────────────────────────────────
# C. Unknown task type
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_unknown_task_type():
    executor = _make_executor("some output")
    mi       = ModuleInput(task_type="completely_unknown_xyz", raw_input="x")
    result   = await executor.execute(mi)

    assert result.success    is False
    assert result.error_code == ModuleErrorCode.UNSUPPORTED_TASK


# ─────────────────────────────────────────────────────────────────────────────
# D. Alias routing via executor
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_alias_categorise_routes_to_classify():
    raw = json.dumps({"label": "electronics", "confidence": 0.8})
    executor = _make_executor(raw)
    mi       = ModuleInput(task_type="categorise", raw_input="a phone product")

    result = await executor.execute(mi)

    assert result.success      is True
    assert result.module_name  == "classify"


@pytest.mark.anyio
async def test_integration_alias_ner_routes_to_extract():
    raw = json.dumps({
        "entities": [{"type": "PERSON", "value": "Alice", "span": "Alice"}],
        "key_value_pairs": {},
    })
    executor = _make_executor(raw)
    mi       = ModuleInput(task_type="ner", raw_input="Alice went to the store.")

    result = await executor.execute(mi)

    assert result.success     is True
    assert result.module_name == "extract"


@pytest.mark.anyio
async def test_integration_alias_sentiment_routes_to_analysis():
    raw = json.dumps({
        "summary":  "Positive sentiment detected.",
        "sentiment": {"label": "positive", "score": 0.9},
        "insights": ["Strong positive language used."],
        "confidence": 0.88,
    })
    executor = _make_executor(raw)
    mi       = ModuleInput(task_type="sentiment", raw_input="I absolutely love this!")

    result = await executor.execute(mi)

    assert result.success     is True
    assert result.module_name == "analysis"


# ─────────────────────────────────────────────────────────────────────────────
# E. execute_many
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_execute_many_all_succeed():
    raw     = json.dumps({"label": "test", "confidence": 0.5})
    runner  = MockProviderRunner(raw_output=raw)
    executor = ModuleExecutor(runner=runner, registry=get_registry())

    inputs = [
        ModuleInput(task_type="classify", raw_input=f"text {i}")
        for i in range(5)
    ]
    results = await executor.execute_many(inputs)

    assert len(results) == 5
    assert all(r.success for r in results)
    assert all(r.module_name == "classify" for r in results)


# ─────────────────────────────────────────────────────────────────────────────
# F. as_dict JSON serialisable
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_result_as_dict_json_serialisable():
    raw = json.dumps({"label": "skincare", "confidence": 0.75})
    executor = _make_executor(raw)
    mi       = ModuleInput(task_type="classify", raw_input="nice cream")

    result = await executor.execute(mi)
    d      = result.as_dict()

    # Must not raise
    serialised = json.dumps(d, default=str)
    parsed     = json.loads(serialised)
    assert parsed["module_name"] == "classify"
    assert parsed["success"]     is True


# ─────────────────────────────────────────────────────────────────────────────
# G. request_id threaded through
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_request_id_threaded():
    raw      = "A short translated text response from provider."
    executor = _make_executor(raw)
    mi       = ModuleInput(
        task_type  = "translate",
        raw_input  = {"text": "hello", "target_lang": "ko"},
        request_id = "my-trace-id-999",
    )
    result = await executor.execute(mi)

    assert result.request_id == "my-trace-id-999"


# ─────────────────────────────────────────────────────────────────────────────
# H. Batch of mixed task types
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_integration_mixed_batch():
    """Execute a batch with 4 different task types; all should succeed."""

    responses_by_type = {
        "classify":  json.dumps({"label": "beauty", "confidence": 0.9}),
        "translate": "번역된 텍스트입니다.",
        "code":      "def foo(): return 42\n",
        "document":  "# Doc\n\n" + ("word " * 25),
    }

    results: dict[str, ExecutionResult] = {}

    for task_type, raw in responses_by_type.items():
        runner   = MockProviderRunner(raw_output=raw)
        executor = ModuleExecutor(runner=runner, registry=get_registry())
        mi       = ModuleInput(task_type=task_type, raw_input={"text": "test", "target_lang": "ko",
                                                                 "instruction": "write", "topic": "x"})
        results[task_type] = await executor.execute(mi)

    assert all(r.success for r in results.values()), {
        k: r.error_message for k, r in results.items() if not r.success
    }
