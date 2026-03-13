"""
tests/devtools/test_devtools_test_runner.py
─────────────────────────────────────────────
Phase 16 — Stage A tests: TestRunnerTool

Coverage
────────
  Contract    : name, actions, op_type
  Validation  : mode guard, runner validation, missing params
  Happy paths : list_tests (real pytest), run_tests (real pytest on tmp project)
  Normalizer  : output truncation, pass-through fields
  JSON-serial : as_dict() roundtrip
"""
from __future__ import annotations

import json
import os
import textwrap

import pytest

from app.devtools.executor              import DevToolExecutor
from app.devtools.registry              import DevToolRegistry
from app.devtools.tools.test_runner     import TestRunnerTool
from app.devtools.types                 import DevToolInput, DevToolMode, DevToolErrorCode


@pytest.fixture
def workspace(tmp_path):
    """A minimal pytest-discoverable project."""
    (tmp_path / "mymodule.py").write_text("def add(a, b): return a + b\n")
    (tmp_path / "test_mymodule.py").write_text(
        textwrap.dedent("""\
            from mymodule import add

            def test_add():
                assert add(1, 2) == 3

            def test_add_negative():
                assert add(-1, -1) == -2
        """)
    )
    return tmp_path


@pytest.fixture
def tool():
    return TestRunnerTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action, params, mode=DevToolMode.FULL):
    return DevToolInput(tool_name="test_runner", action=action, params=params, mode=mode)


# ── Contract ──────────────────────────────────────────────────────────────────

class TestRunnerContract:
    def test_name(self, tool):
        assert tool.name == "test_runner"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {"run_tests", "run_file", "list_tests"}

    def test_op_type(self, tool):
        from app.devtools.types import DevToolOpType
        assert tool.get_op_type() == DevToolOpType.EXECUTE


# ── Validation ────────────────────────────────────────────────────────────────

class TestRunnerValidation:
    def test_wrong_mode_blocked(self, tool, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="run_tests",
            params={"workspace_root": str(workspace)},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("FULL" in e for e in v.errors)

    def test_invalid_runner(self, tool, workspace):
        ti = _inp("run_tests", {
            "workspace_root": str(workspace), "runner": "nose"
        })
        v = tool.validate_input(ti)
        assert not v.passed

    def test_run_file_requires_path(self, tool, workspace):
        ti = _inp("run_file", {"workspace_root": str(workspace)})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_valid_run_tests_passes(self, tool, workspace):
        ti = _inp("run_tests", {"workspace_root": str(workspace)})
        v = tool.validate_input(ti)
        assert v.passed


# ── Happy paths ───────────────────────────────────────────────────────────────

class TestRunnerHappyPaths:
    @pytest.mark.asyncio
    async def test_run_tests_passes(self, executor, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="run_tests",
            params={"workspace_root": str(workspace), "timeout": 60.0},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert out["passed"] >= 2
        assert out["failed"] == 0
        assert out["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_run_file(self, executor, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="run_file",
            params={
                "workspace_root": str(workspace),
                "path": "test_mymodule.py",
                "timeout": 60.0,
            },
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["passed"] >= 2

    @pytest.mark.asyncio
    async def test_list_tests(self, executor, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="list_tests",
            params={"workspace_root": str(workspace), "timeout": 60.0},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        ids = result.normalized_output.get("test_ids", [])
        assert any("test_add" in tid for tid in ids)

    @pytest.mark.asyncio
    async def test_run_tests_keyword_filter(self, executor, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="run_tests",
            params={
                "workspace_root": str(workspace),
                "keyword": "test_add_negative",
                "timeout": 60.0,
            },
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        # Only 1 test matched
        assert result.normalized_output["passed"] == 1


# ── Normalizer ────────────────────────────────────────────────────────────────

class TestRunnerNormalizer:
    def test_truncates_output(self, tool):
        raw = {
            "runner": "pytest", "passed": 1, "failed": 0,
            "errors": 0, "skipped": 0, "total": 1,
            "duration_s": 0.1, "output": "x" * 200_000,
            "exit_code": 0, "timed_out": False,
        }
        norm = tool.normalize_output(raw)
        assert len(norm["output"]) <= 50_100

    def test_passthrough_fields(self, tool):
        raw = {
            "runner": "pytest", "passed": 5, "failed": 0,
            "errors": 0, "skipped": 0, "total": 5,
            "duration_s": 1.2, "output": "ok",
            "exit_code": 0, "timed_out": False,
        }
        norm = tool.normalize_output(raw)
        assert norm["passed"] == 5


# ── JSON serialisability ──────────────────────────────────────────────────────

class TestRunnerJSONSerial:
    @pytest.mark.asyncio
    async def test_json_serialisable(self, executor, workspace):
        ti = DevToolInput(
            tool_name="test_runner", action="run_tests",
            params={"workspace_root": str(workspace), "timeout": 60.0},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        json.dumps(result.as_dict())
