"""
tests/devtools/test_devtools_terminal.py
──────────────────────────────────────────
Phase 16 — Stage A tests: TerminalTool

Coverage
────────
  Contract    : name, actions, op_type
  Validation  : mode guard, missing params
  Happy paths : run_command (echo), run_script, kill_process stub
  Security    : blocked commands raise CommandBlockedError
  Failure     : nonzero exit recorded, timeout flag
  Normalizer  : stdout/stderr truncation
  JSON-serial : result as_dict()
"""
from __future__ import annotations

import json
import sys

import pytest

from app.devtools.executor         import DevToolExecutor
from app.devtools.registry         import DevToolRegistry
from app.devtools.tools.terminal   import TerminalTool
from app.devtools.types            import DevToolInput, DevToolMode, DevToolErrorCode


@pytest.fixture
def tool():
    return TerminalTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action, params, mode=DevToolMode.FULL):
    return DevToolInput(tool_name="terminal", action=action, params=params, mode=mode)


# ── Contract ──────────────────────────────────────────────────────────────────

class TestTerminalContract:
    def test_name(self, tool):
        assert tool.name == "terminal"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {"run_command", "run_script", "kill_process"}

    def test_op_type(self, tool):
        from app.devtools.types import DevToolOpType
        assert tool.get_op_type() == DevToolOpType.EXECUTE

    def test_requires_full_mode(self, tool):
        # TerminalTool op_type = EXECUTE → requires_mode() returns FULL
        assert tool.requires_mode() == DevToolMode.FULL
        # validate_input also enforces FULL
        ti = _inp("run_command", {"workspace_root": "/tmp", "command": "echo hi"},
                  mode=DevToolMode.SAFE_WRITE)
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("FULL" in e for e in v.errors)


# ── Validation ────────────────────────────────────────────────────────────────

class TestTerminalValidation:
    def test_missing_workspace_root(self, tool):
        ti = _inp("run_command", {"command": "echo hi"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_missing_command(self, tool):
        ti = _inp("run_command", {"workspace_root": "/tmp"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_missing_script(self, tool):
        ti = _inp("run_script", {"workspace_root": "/tmp"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_missing_pid(self, tool):
        ti = _inp("kill_process", {"workspace_root": "/tmp"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_valid_run_command_passes(self, tool):
        ti = _inp("run_command", {"workspace_root": "/tmp", "command": "echo hi"})
        v = tool.validate_input(ti)
        assert v.passed


# ── Happy paths ───────────────────────────────────────────────────────────────

class TestTerminalHappyPaths:
    @pytest.mark.asyncio
    async def test_run_command_echo(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={
                "workspace_root": str(tmp_path),
                "command": "echo 'hello devtools'",
            },
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "hello devtools" in result.normalized_output["stdout"]
        assert result.normalized_output["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_run_script(self, executor, tmp_path):
        script = "#!/bin/bash\necho 'script ran'\n"
        ti = DevToolInput(
            tool_name="terminal", action="run_script",
            params={"workspace_root": str(tmp_path), "script": script},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "script ran" in result.normalized_output["stdout"]

    @pytest.mark.asyncio
    async def test_run_command_exit_nonzero(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={"workspace_root": str(tmp_path), "command": "exit 42"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        # Tool still succeeds (returns result); exit_code is 42
        assert result.success
        assert result.normalized_output["exit_code"] == 42

    @pytest.mark.asyncio
    async def test_kill_process_nonexistent_pid(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="kill_process",
            params={"workspace_root": str(tmp_path), "pid": 9999999},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["success"] is False  # process not found


# ── Security ──────────────────────────────────────────────────────────────────

class TestTerminalSecurity:
    @pytest.mark.asyncio
    async def test_blocked_rm_rf(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={"workspace_root": str(tmp_path), "command": "rm -rf /"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.COMMAND_BLOCKED

    @pytest.mark.asyncio
    async def test_custom_blocked_prefix(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={"workspace_root": str(tmp_path), "command": "deploy --all"},
            mode=DevToolMode.FULL,
            context={"blocked_prefixes": ["deploy"]},
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.COMMAND_BLOCKED

    @pytest.mark.asyncio
    async def test_shutdown_blocked(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={"workspace_root": str(tmp_path), "command": "shutdown -h now"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.COMMAND_BLOCKED


# ── Normalizer ────────────────────────────────────────────────────────────────

class TestTerminalNormalizer:
    def test_truncates_long_stdout(self, tool):
        raw = {"command": "ls", "stdout": "x" * 200_000, "stderr": "", "exit_code": 0, "timed_out": False, "cwd": "/"}
        norm = tool.normalize_output(raw)
        assert len(norm["stdout"]) <= 50_100  # 50_000 + marker overhead

    def test_truncates_long_stderr(self, tool):
        raw = {"command": "ls", "stdout": "", "stderr": "e" * 100_000, "exit_code": 1, "timed_out": False, "cwd": "/"}
        norm = tool.normalize_output(raw)
        assert len(norm["stderr"]) <= 20_100


# ── JSON serialisability ──────────────────────────────────────────────────────

class TestTerminalJSONSerial:
    @pytest.mark.asyncio
    async def test_json_serialisable(self, executor, tmp_path):
        ti = DevToolInput(
            tool_name="terminal", action="run_command",
            params={"workspace_root": str(tmp_path), "command": "echo json_test"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        json.dumps(result.as_dict())
