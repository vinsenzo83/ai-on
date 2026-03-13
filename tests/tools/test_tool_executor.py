"""tests/tools/test_tool_executor.py – Phase 15 executor tests."""
from __future__ import annotations

import pytest

from app.tools.base     import BaseTool, ToolActionError
from app.tools.executor import ToolExecutor
from app.tools.registry import ToolRegistry
from app.tools.types    import ToolErrorCode, ToolInput, ToolValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# Configurable stub tool
# ─────────────────────────────────────────────────────────────────────────────

class _ConfigurableTool(BaseTool):
    """Flexible stub for executor tests."""

    def __init__(
        self,
        tool_name:            str = "stub",
        actions:              list[str] | None = None,
        raw_output:           object = None,
        input_valid:          bool   = True,
        output_valid:         bool   = True,
        raise_on_execute:     bool   = False,
        raise_tool_action:    bool   = False,
        normalize_raises:     bool   = False,
    ):
        self._name             = tool_name
        self._actions          = actions or ["do_thing"]
        self._raw_output       = raw_output or {"result": "ok"}
        self._input_valid      = input_valid
        self._output_valid     = output_valid
        self._raise_on_execute = raise_on_execute
        self._raise_tool_action = raise_tool_action
        self._normalize_raises = normalize_raises
        self.pre_hook_calls    = 0
        self.post_hook_calls   = 0

    @property
    def name(self) -> str:
        return self._name

    def get_actions(self)          -> list: return list(self._actions)
    def get_input_schema(self)     -> dict: return {}
    def get_output_schema(self)    -> dict: return {}

    def validate_input(self, ti)   -> ToolValidationResult:
        if self._input_valid:
            return ToolValidationResult.ok()
        return ToolValidationResult.fail("bad input")

    async def execute_action(self, ti):
        if self._raise_tool_action:
            raise ToolActionError("tool failure", error_code=ToolErrorCode.ACTION_FAILED)
        if self._raise_on_execute:
            raise RuntimeError("unexpected runtime error")
        return self._raw_output

    def validate_output(self, raw) -> ToolValidationResult:
        if self._output_valid:
            return ToolValidationResult.ok()
        return ToolValidationResult.fail("bad output")

    def normalize_output(self, raw):
        if self._normalize_raises:
            raise ValueError("norm fail")
        return {"normalized": True, **raw}

    def on_pre_execute(self, ti):
        self.pre_hook_calls += 1

    def on_post_execute(self, raw, *, success):
        self.post_hook_calls += 1


def _make_registry(*tools) -> ToolRegistry:
    reg = ToolRegistry()
    for t in tools:
        reg.register(t)
    return reg


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestToolExecutorHappyPath:
    @pytest.mark.asyncio
    async def test_success_result(self):
        tool = _ConfigurableTool(raw_output={"key": "val"})
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)

        assert r.success           is True
        assert r.validation_passed is True
        assert r.error_code        is None
        assert r.normalized_output == {"normalized": True, "key": "val"}
        assert r.latency_ms        >= 0
        assert r.tool_name         == "stub"
        assert r.action            == "do_thing"

    @pytest.mark.asyncio
    async def test_request_id_threaded(self):
        tool = _ConfigurableTool()
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing", request_id="req-xyz")
        r    = await exc.execute(ti)
        assert r.request_id == "req-xyz"

    @pytest.mark.asyncio
    async def test_hooks_called(self):
        tool = _ConfigurableTool()
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        await exc.execute(ti)
        assert tool.pre_hook_calls  == 1
        assert tool.post_hook_calls == 1

    @pytest.mark.asyncio
    async def test_source_url_from_url_param(self):
        tool = _ConfigurableTool(actions=["fetch"])
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(
            tool_name = "stub",
            action    = "fetch",
            params    = {"url": "https://example.com"},
        )
        r = await exc.execute(ti)
        assert r.source_url == "https://example.com"

    @pytest.mark.asyncio
    async def test_source_url_from_query_param(self):
        tool = _ConfigurableTool(actions=["query"])
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(
            tool_name = "stub",
            action    = "query",
            params    = {"query": "k-beauty serum"},
        )
        r = await exc.execute(ti)
        assert r.source_url == "k-beauty serum"


# ─────────────────────────────────────────────────────────────────────────────
# Failure cases
# ─────────────────────────────────────────────────────────────────────────────

class TestToolExecutorFailures:
    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        reg = ToolRegistry()
        exc = ToolExecutor(registry=reg)
        ti  = ToolInput(tool_name="nonexistent", action="something")
        r   = await exc.execute(ti)
        assert r.success     is False
        assert r.error_code  == ToolErrorCode.UNSUPPORTED_TOOL

    @pytest.mark.asyncio
    async def test_unsupported_action(self):
        tool = _ConfigurableTool(actions=["a"])
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="z")
        r    = await exc.execute(ti)
        assert r.success    is False
        assert r.error_code == ToolErrorCode.UNSUPPORTED_ACTION

    @pytest.mark.asyncio
    async def test_input_validation_failure(self):
        tool = _ConfigurableTool(input_valid=False)
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)
        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID
        assert "bad input"  in (r.error_message or "")

    @pytest.mark.asyncio
    async def test_output_validation_failure(self):
        tool = _ConfigurableTool(output_valid=False)
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)
        assert r.success           is False
        assert r.validation_passed is False
        assert r.error_code        == ToolErrorCode.VALIDATION_FAILED
        assert r.raw_output        is not None  # raw still present

    @pytest.mark.asyncio
    async def test_tool_action_error(self):
        tool = _ConfigurableTool(raise_tool_action=True)
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)
        assert r.success    is False
        assert r.error_code == ToolErrorCode.ACTION_FAILED

    @pytest.mark.asyncio
    async def test_unexpected_exception_in_execute(self):
        tool = _ConfigurableTool(raise_on_execute=True)
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)
        assert r.success    is False
        assert r.error_code == ToolErrorCode.ACTION_FAILED

    @pytest.mark.asyncio
    async def test_normalization_error(self):
        tool = _ConfigurableTool(normalize_raises=True)
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        ti   = ToolInput(tool_name="stub", action="do_thing")
        r    = await exc.execute(ti)
        assert r.success    is False
        assert r.error_code == ToolErrorCode.NORMALIZATION_ERROR


# ─────────────────────────────────────────────────────────────────────────────
# Batch execution
# ─────────────────────────────────────────────────────────────────────────────

class TestToolExecutorBatch:
    @pytest.mark.asyncio
    async def test_execute_many(self):
        tool = _ConfigurableTool()
        reg  = _make_registry(tool)
        exc  = ToolExecutor(registry=reg)
        inputs = [
            ToolInput(tool_name="stub", action="do_thing", request_id=f"r{i}")
            for i in range(4)
        ]
        results = await exc.execute_many(inputs)
        assert len(results) == 4
        assert all(r.success for r in results)

    @pytest.mark.asyncio
    async def test_execute_many_partial_failure(self):
        good = _ConfigurableTool(tool_name="good")
        bad  = _ConfigurableTool(tool_name="bad", input_valid=False)
        reg  = _make_registry(good, bad)
        exc  = ToolExecutor(registry=reg)
        inputs = [
            ToolInput(tool_name="good", action="do_thing"),
            ToolInput(tool_name="bad",  action="do_thing"),
        ]
        results = await exc.execute_many(inputs)
        assert results[0].success is True
        assert results[1].success is False

    @pytest.mark.asyncio
    async def test_execute_many_empty(self):
        reg = ToolRegistry()
        exc = ToolExecutor(registry=reg)
        assert await exc.execute_many([]) == []
