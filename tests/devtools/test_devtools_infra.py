"""
tests/devtools/test_devtools_infra.py
───────────────────────────────────────
Phase 16 — Infrastructure tests: types, registry, executor, normalizers

Coverage
────────
  DevToolInput   : defaults, custom fields
  DevToolResult  : as_dict() shape, JSON-serialisable
  DevToolValidationResult : ok/fail factories
  DevToolErrorCode        : constants exist
  DevToolRegistry         : register, resolve, deregister, duplicate guard
  DevToolExecutor         : unsupported tool, unsupported action, mode gate,
                            input validation failure, action exception,
                            output validation failure, normalization failure,
                            full happy path
  normalizers    : require_str, require_param, require_safe_path,
                   require_mode, require_positive_int, truncate, split_lines
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.devtools.base      import BaseDevTool
from app.devtools.errors    import DevToolError
from app.devtools.executor  import DevToolExecutor
from app.devtools.normalizers import (
    combine,
    require_mode,
    require_param,
    require_positive_int,
    require_safe_path,
    require_str,
    split_lines,
    truncate,
)
from app.devtools.registry  import DevToolRegistry
from app.devtools.types     import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolResult,
    DevToolValidationResult,
)


# ─────────────────────────────────────────────────────────────────────────────
# Minimal stub tool for executor tests
# ─────────────────────────────────────────────────────────────────────────────

class _StubTool(BaseDevTool):
    """Configurable stub DevTool for executor tests."""

    def __init__(
        self,
        *,
        name_: str = "stub",
        actions: list[str] | None = None,
        op_type: str = DevToolOpType.READ,
        input_valid: bool = True,
        output_valid: bool = True,
        raise_on_execute: Exception | None = None,
        raw_output: object = {"result": "ok"},
    ):
        self._name           = name_
        self._actions        = actions or ["run"]
        self._op_type        = op_type
        self._input_valid    = input_valid
        self._output_valid   = output_valid
        self._raise          = raise_on_execute
        self._raw_output     = raw_output

    @property
    def name(self) -> str:
        return self._name

    def get_actions(self):
        return list(self._actions)

    def get_op_type(self):
        return self._op_type

    def get_input_schema(self):
        return {}

    def get_output_schema(self):
        return {"result": "str"}

    def validate_input(self, ti):
        if self._input_valid:
            return DevToolValidationResult.ok()
        return DevToolValidationResult.fail("stub input invalid")

    async def execute_action(self, ti):
        if self._raise:
            raise self._raise
        return self._raw_output

    def validate_output(self, raw):
        if self._output_valid:
            return DevToolValidationResult.ok()
        return DevToolValidationResult.fail("stub output invalid")

    def normalize_output(self, raw):
        return dict(raw) if isinstance(raw, dict) else {"value": raw}


# ─────────────────────────────────────────────────────────────────────────────
# Types tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDevToolInputDefaults:
    def test_request_id_auto_generated(self):
        ti = DevToolInput(tool_name="t", action="a")
        assert len(ti.request_id) == 36  # UUID format

    def test_default_mode_is_read_only(self):
        ti = DevToolInput(tool_name="t", action="a")
        assert ti.mode == DevToolMode.READ_ONLY

    def test_custom_fields(self):
        ti = DevToolInput(
            tool_name="t", action="a",
            params={"k": "v"},
            mode=DevToolMode.FULL,
            context={"workspace": "/tmp"},
            metadata={"caller": "test"},
        )
        assert ti.params["k"] == "v"
        assert ti.context["workspace"] == "/tmp"


class TestDevToolResult:
    def test_as_dict_shape(self):
        r = DevToolResult(
            request_id="r1", tool_name="t", action="a",
            success=True, normalized_output={"x": 1},
        )
        d = r.as_dict()
        assert d["request_id"]        == "r1"
        assert d["success"]           is True
        assert d["normalized_output"] == {"x": 1}

    def test_as_dict_json_serialisable(self):
        r = DevToolResult(
            request_id="r1", tool_name="t", action="a",
            success=False, error_code="ERR", error_message="boom",
        )
        json.dumps(r.as_dict())


class TestDevToolValidationResult:
    def test_ok(self):
        v = DevToolValidationResult.ok()
        assert v.passed
        assert v.errors == []

    def test_fail(self):
        v = DevToolValidationResult.fail("reason1", "reason2")
        assert not v.passed
        assert "reason1" in v.errors

    def test_combine_all_ok(self):
        result = combine(
            DevToolValidationResult.ok(),
            DevToolValidationResult.ok(),
        )
        assert result.passed

    def test_combine_one_fails(self):
        result = combine(
            DevToolValidationResult.ok(),
            DevToolValidationResult.fail("bad"),
        )
        assert not result.passed
        assert "bad" in result.errors


class TestDevToolErrorCodes:
    def test_key_constants_exist(self):
        assert DevToolErrorCode.UNSUPPORTED_TOOL
        assert DevToolErrorCode.INPUT_INVALID
        assert DevToolErrorCode.ACTION_FAILED
        assert DevToolErrorCode.PERMISSION_DENIED
        assert DevToolErrorCode.PATH_NOT_FOUND
        assert DevToolErrorCode.COMMAND_BLOCKED
        assert DevToolErrorCode.TIMEOUT


# ─────────────────────────────────────────────────────────────────────────────
# Registry tests
# ─────────────────────────────────────────────────────────────────────────────

class TestDevToolRegistry:
    def test_register_and_resolve(self):
        reg  = DevToolRegistry()
        tool = _StubTool(name_="alpha")
        reg.register(tool)
        assert reg.resolve("alpha") is tool

    def test_resolve_unknown_raises(self):
        reg = DevToolRegistry()
        with pytest.raises(KeyError):
            reg.resolve("unknown")

    def test_resolve_or_none(self):
        reg = DevToolRegistry()
        assert reg.resolve_or_none("nope") is None

    def test_duplicate_registration_raises(self):
        reg  = DevToolRegistry()
        tool = _StubTool(name_="dup")
        reg.register(tool)
        with pytest.raises(ValueError, match="already registered"):
            reg.register(tool)

    def test_deregister(self):
        reg  = DevToolRegistry()
        tool = _StubTool(name_="temp")
        reg.register(tool)
        reg.deregister("temp")
        assert reg.resolve_or_none("temp") is None

    def test_list_tools(self):
        reg = DevToolRegistry()
        reg.register(_StubTool(name_="b"))
        reg.register(_StubTool(name_="a"))
        assert reg.list_tools() == ["a", "b"]

    def test_list_actions(self):
        reg = DevToolRegistry()
        reg.register(_StubTool(name_="t", actions=["go", "stop"]))
        assert set(reg.list_actions()["t"]) == {"go", "stop"}

    def test_tool_count(self):
        reg = DevToolRegistry()
        assert reg.tool_count() == 0
        reg.register(_StubTool(name_="x"))
        assert reg.tool_count() == 1


# ─────────────────────────────────────────────────────────────────────────────
# Executor tests
# ─────────────────────────────────────────────────────────────────────────────

def _make_executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


class TestDevToolExecutor:
    @pytest.mark.asyncio
    async def test_unsupported_tool(self):
        executor = DevToolExecutor(registry=DevToolRegistry())
        ti = DevToolInput(tool_name="nope", action="a")
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.UNSUPPORTED_TOOL

    @pytest.mark.asyncio
    async def test_unsupported_action(self):
        executor = _make_executor(_StubTool(name_="t", actions=["run"]))
        ti = DevToolInput(tool_name="t", action="fly")
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.UNSUPPORTED_ACTION

    @pytest.mark.asyncio
    async def test_mode_gate_blocks(self):
        tool = _StubTool(name_="t", op_type=DevToolOpType.EXECUTE)
        # op_type EXECUTE → requires_mode FULL
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run",
                          mode=DevToolMode.READ_ONLY)
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_input_validation_failure(self):
        tool     = _StubTool(name_="t", input_valid=False)
        executor = _make_executor(tool)
        ti       = DevToolInput(tool_name="t", action="run")
        result   = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.INPUT_INVALID

    @pytest.mark.asyncio
    async def test_execute_action_devtool_error(self):
        err  = DevToolError("boom", error_code=DevToolErrorCode.ACTION_FAILED)
        tool = _StubTool(name_="t", raise_on_execute=err)
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run")
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.ACTION_FAILED

    @pytest.mark.asyncio
    async def test_execute_action_generic_exception(self):
        tool = _StubTool(name_="t", raise_on_execute=RuntimeError("oops"))
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run")
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.ACTION_FAILED

    @pytest.mark.asyncio
    async def test_output_validation_failure(self):
        tool = _StubTool(name_="t", output_valid=False)
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run")
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.VALIDATION_FAILED

    @pytest.mark.asyncio
    async def test_full_happy_path(self):
        tool = _StubTool(name_="t", raw_output={"result": "success"})
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run")
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["result"] == "success"
        assert result.latency_ms >= 0

    @pytest.mark.asyncio
    async def test_execute_many(self):
        tool = _StubTool(name_="t")
        executor = _make_executor(tool)
        inputs = [
            DevToolInput(tool_name="t", action="run"),
            DevToolInput(tool_name="t", action="run"),
        ]
        results = await executor.execute_many(inputs)
        assert len(results) == 2
        assert all(r.success for r in results)

    @pytest.mark.asyncio
    async def test_result_is_json_serialisable(self):
        tool = _StubTool(name_="t")
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run")
        result = await executor.execute(ti)
        json.dumps(result.as_dict())

    @pytest.mark.asyncio
    async def test_source_reference_extracted_from_params(self):
        tool = _StubTool(name_="t", raw_output={"result": "ok"})
        executor = _make_executor(tool)
        ti = DevToolInput(tool_name="t", action="run",
                          params={"path": "/some/file.py"})
        result = await executor.execute(ti)
        assert result.source_reference == "/some/file.py"


# ─────────────────────────────────────────────────────────────────────────────
# Normalizer tests
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalizers:
    # require_str
    def test_require_str_ok(self):
        assert require_str("hello", "f").passed

    def test_require_str_empty_fails(self):
        assert not require_str("", "f").passed

    def test_require_str_wrong_type_fails(self):
        assert not require_str(123, "f").passed

    # require_param
    def test_require_param_present(self):
        assert require_param({"k": "v"}, "k").passed

    def test_require_param_missing_fails(self):
        assert not require_param({}, "k").passed

    def test_require_param_wrong_type_fails(self):
        assert not require_param({"k": 1}, "k", param_type=str).passed

    # require_safe_path
    def test_require_safe_path_ok(self, tmp_path):
        result = require_safe_path("subdir/file.txt", str(tmp_path))
        assert result.passed

    def test_require_safe_path_traversal_fails(self, tmp_path):
        result = require_safe_path("../../etc/passwd", str(tmp_path))
        assert not result.passed

    def test_require_safe_path_empty_fails(self, tmp_path):
        result = require_safe_path("", str(tmp_path))
        assert not result.passed

    # require_mode
    def test_require_mode_ok(self):
        assert require_mode(DevToolMode.FULL, DevToolMode.SAFE_WRITE).passed
        assert require_mode(DevToolMode.SAFE_WRITE, DevToolMode.SAFE_WRITE).passed
        assert require_mode(DevToolMode.READ_ONLY, DevToolMode.READ_ONLY).passed

    def test_require_mode_fail(self):
        assert not require_mode(DevToolMode.READ_ONLY, DevToolMode.FULL).passed
        assert not require_mode(DevToolMode.SAFE_WRITE, DevToolMode.FULL).passed

    # require_positive_int
    def test_positive_int_ok(self):
        assert require_positive_int(5, "n").passed

    def test_positive_int_zero_fails(self):
        assert not require_positive_int(0, "n").passed

    def test_positive_int_negative_fails(self):
        assert not require_positive_int(-1, "n").passed

    def test_positive_int_non_int_fails(self):
        assert not require_positive_int("5", "n").passed

    # truncate
    def test_truncate_short_text(self):
        assert truncate("hello", 100) == "hello"

    def test_truncate_long_text(self):
        result = truncate("x" * 200, 100)
        assert len(result) > 100  # includes marker
        assert "truncated" in result

    # split_lines
    def test_split_lines(self):
        # splitlines() on "a\nb\n\nc\n" produces ["a","b","","c"] (no trailing empty)
        result = split_lines("a\nb\n\nc\n")
        assert "a" in result
        assert "b" in result
        assert "" in result   # blank line preserved
        assert "c" in result
