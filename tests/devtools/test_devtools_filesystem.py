"""
tests/devtools/test_devtools_filesystem.py
────────────────────────────────────────────
Phase 16 — Stage A tests: FilesystemTool

Coverage
────────
  Happy paths : read_file, write_file, list_dir, delete_file, move_file
  Validation  : missing params, mode guards, path traversal
  Executor    : round-trip via DevToolExecutor
  Normalizer  : normalize_output is pass-through dict
  Failure     : file-not-found, directory passed to delete_file
  JSON-serial : as_dict() on DevToolResult contains no un-serialisable types
"""
from __future__ import annotations

import json
import os
import tempfile

import pytest

from app.devtools.executor  import DevToolExecutor
from app.devtools.registry  import DevToolRegistry
from app.devtools.tools.filesystem import FilesystemTool
from app.devtools.types     import DevToolInput, DevToolMode, DevToolErrorCode


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def workspace(tmp_path):
    """Provide a temporary workspace directory with some files."""
    (tmp_path / "hello.txt").write_text("Hello world\nLine 2\n")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "inner.py").write_text("def foo(): pass\n")
    return tmp_path


@pytest.fixture
def tool():
    return FilesystemTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action: str, params: dict, mode=DevToolMode.SAFE_WRITE) -> DevToolInput:
    return DevToolInput(tool_name="filesystem", action=action, params=params, mode=mode)


# ─────────────────────────────────────────────────────────────────────────────
# Identity / contract
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemContract:
    def test_name(self, tool):
        assert tool.name == "filesystem"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {
            "read_file", "write_file", "list_dir", "delete_file", "move_file"
        }

    def test_input_schema_keys(self, tool):
        schema = tool.get_input_schema()
        assert "workspace_root" in schema
        assert "path" in schema

    def test_output_schema(self, tool):
        schema = tool.get_output_schema()
        assert "read_file" in schema

    def test_can_handle(self, tool):
        assert tool.can_handle("read_file")
        assert not tool.can_handle("nonexistent")


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemValidation:
    def test_missing_workspace_root(self, tool):
        ti = _inp("read_file", {"path": "hello.txt"})
        v  = tool.validate_input(ti)
        assert not v.passed

    def test_missing_path(self, tool, workspace):
        ti = _inp("read_file", {"workspace_root": str(workspace)})
        v  = tool.validate_input(ti)
        assert not v.passed

    def test_write_file_mode_guard(self, tool, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="write_file",
            params={"workspace_root": str(workspace), "path": "x.txt", "content": "hi"},
            mode=DevToolMode.READ_ONLY,
        )
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("SAFE_WRITE" in e for e in v.errors)

    def test_delete_mode_guard(self, tool, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="delete_file",
            params={"workspace_root": str(workspace), "path": "hello.txt"},
            mode=DevToolMode.READ_ONLY,
        )
        v = tool.validate_input(ti)
        assert not v.passed

    def test_write_file_missing_content(self, tool, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="write_file",
            params={"workspace_root": str(workspace), "path": "x.txt"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = tool.validate_input(ti)
        assert not v.passed

    def test_valid_read_file_passes(self, tool, workspace):
        ti = _inp("read_file", {
            "workspace_root": str(workspace), "path": "hello.txt"
        }, mode=DevToolMode.READ_ONLY)
        v = tool.validate_input(ti)
        assert v.passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy paths
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemHappyPaths:
    @pytest.mark.asyncio
    async def test_read_file(self, tool, workspace):
        ti = _inp("read_file", {
            "workspace_root": str(workspace), "path": "hello.txt"
        }, mode=DevToolMode.READ_ONLY)
        raw = await tool.execute_action(ti)
        assert "Hello world" in raw["content"]
        assert raw["total_lines"] == 2
        assert raw["truncated"] is False

    @pytest.mark.asyncio
    async def test_read_file_line_range(self, tool, workspace):
        ti = _inp("read_file", {
            "workspace_root": str(workspace), "path": "hello.txt",
            "start_line": 2, "end_line": 2,
        }, mode=DevToolMode.READ_ONLY)
        raw = await tool.execute_action(ti)
        assert "Line 2" in raw["content"]
        assert "Hello world" not in raw["content"]

    @pytest.mark.asyncio
    async def test_write_file_creates(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="write_file",
            params={
                "workspace_root": str(workspace),
                "path": "new_file.txt",
                "content": "brand new content\n",
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert (workspace / "new_file.txt").read_text() == "brand new content\n"
        assert result.normalized_output["created"] is True

    @pytest.mark.asyncio
    async def test_write_file_overwrites(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="write_file",
            params={
                "workspace_root": str(workspace),
                "path": "hello.txt",
                "content": "overwritten",
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert (workspace / "hello.txt").read_text() == "overwritten"

    @pytest.mark.asyncio
    async def test_list_dir(self, tool, workspace):
        ti = _inp("list_dir", {
            "workspace_root": str(workspace), "path": ".",
        }, mode=DevToolMode.READ_ONLY)
        raw = await tool.execute_action(ti)
        names = [e["name"] for e in raw["entries"]]
        assert "hello.txt" in names
        assert "sub" in names

    @pytest.mark.asyncio
    async def test_delete_file(self, executor, workspace):
        (workspace / "to_delete.txt").write_text("bye")
        ti = DevToolInput(
            tool_name="filesystem", action="delete_file",
            params={"workspace_root": str(workspace), "path": "to_delete.txt"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert not (workspace / "to_delete.txt").exists()

    @pytest.mark.asyncio
    async def test_move_file(self, executor, workspace):
        (workspace / "src.txt").write_text("move me")
        ti = DevToolInput(
            tool_name="filesystem", action="move_file",
            params={
                "workspace_root": str(workspace),
                "path": "src.txt",
                "destination": "dst.txt",
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert not (workspace / "src.txt").exists()
        assert (workspace / "dst.txt").read_text() == "move me"


# ─────────────────────────────────────────────────────────────────────────────
# Failure paths
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemFailurePaths:
    @pytest.mark.asyncio
    async def test_read_file_not_found(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="read_file",
            params={"workspace_root": str(workspace), "path": "ghost.txt"},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_NOT_FOUND

    @pytest.mark.asyncio
    async def test_path_traversal_blocked(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="read_file",
            params={"workspace_root": str(workspace), "path": "../../etc/passwd"},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_UNSAFE

    @pytest.mark.asyncio
    async def test_delete_directory_blocked(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="delete_file",
            params={"workspace_root": str(workspace), "path": "sub"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert not result.success

    @pytest.mark.asyncio
    async def test_delete_not_found(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="delete_file",
            params={"workspace_root": str(workspace), "path": "nope.txt"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_NOT_FOUND


# ─────────────────────────────────────────────────────────────────────────────
# Normalizer
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemNormalizer:
    def test_normalize_read_output(self, tool):
        raw = {"path": "/f", "content": "hi", "total_lines": 1, "truncated": False}
        norm = tool.normalize_output(raw)
        assert norm == raw

    def test_normalize_is_dict(self, tool):
        raw = {"path": "/f", "entries": []}
        assert isinstance(tool.normalize_output(raw), dict)


# ─────────────────────────────────────────────────────────────────────────────
# JSON serialisability
# ─────────────────────────────────────────────────────────────────────────────

class TestFilesystemJSONSerial:
    @pytest.mark.asyncio
    async def test_result_json_serialisable(self, executor, workspace):
        ti = DevToolInput(
            tool_name="filesystem", action="read_file",
            params={"workspace_root": str(workspace), "path": "hello.txt"},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        # Should not raise
        json.dumps(result.as_dict())
