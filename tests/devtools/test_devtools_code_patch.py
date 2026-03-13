"""
tests/devtools/test_devtools_code_patch.py
────────────────────────────────────────────
Phase 16 — Stage A tests: CodePatchTool

Coverage
────────
  Happy paths : view_diff, create_file, insert_lines, replace_lines, apply_patch
  Validation  : mode guards, missing params
  Failure     : file-not-found, overwrite guard, path traversal
  Normalizer  : normalize_output pass-through
  JSON-serial : as_dict() roundtrip
"""
from __future__ import annotations

import json
import os

import pytest

from app.devtools.executor          import DevToolExecutor
from app.devtools.registry          import DevToolRegistry
from app.devtools.tools.code_patch  import CodePatchTool
from app.devtools.types             import DevToolInput, DevToolMode, DevToolErrorCode


@pytest.fixture
def workspace(tmp_path):
    (tmp_path / "main.py").write_text("def hello():\n    print('hi')\n")
    (tmp_path / "sub").mkdir()
    return tmp_path


@pytest.fixture
def tool():
    return CodePatchTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action, params, mode=DevToolMode.SAFE_WRITE):
    return DevToolInput(tool_name="code_patch", action=action, params=params, mode=mode)


# ── Contract ──────────────────────────────────────────────────────────────────

class TestCodePatchContract:
    def test_name(self, tool):
        assert tool.name == "code_patch"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {
            "apply_patch", "view_diff", "create_file",
            "insert_lines", "replace_lines",
        }

    def test_can_handle(self, tool):
        assert tool.can_handle("view_diff")
        assert not tool.can_handle("nope")


# ── Validation ────────────────────────────────────────────────────────────────

class TestCodePatchValidation:
    def test_write_action_blocks_read_only_mode(self, tool, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="create_file",
            params={"workspace_root": str(workspace), "path": "x.py", "content": "x"},
            mode=DevToolMode.READ_ONLY,
        )
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("SAFE_WRITE" in e for e in v.errors)

    def test_view_diff_requires_original_and_modified(self, tool, workspace):
        ti = _inp("view_diff", {"workspace_root": str(workspace), "original": "foo"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_insert_lines_requires_start_line(self, tool, workspace):
        ti = _inp("insert_lines", {
            "workspace_root": str(workspace), "path": "main.py", "lines": ["x"]
        })
        v = tool.validate_input(ti)
        assert not v.passed

    def test_replace_lines_requires_end_line(self, tool, workspace):
        ti = _inp("replace_lines", {
            "workspace_root": str(workspace), "path": "main.py",
            "start_line": 1, "lines": ["x"],
        })
        v = tool.validate_input(ti)
        assert not v.passed

    def test_valid_view_diff_passes(self, tool, workspace):
        ti = _inp("view_diff", {
            "workspace_root": str(workspace),
            "original": "a\nb\n",
            "modified": "a\nb\nc\n",
        }, mode=DevToolMode.READ_ONLY)
        v = tool.validate_input(ti)
        assert v.passed


# ── Happy paths ───────────────────────────────────────────────────────────────

class TestCodePatchHappyPaths:
    @pytest.mark.asyncio
    async def test_view_diff(self, tool, workspace):
        ti = _inp("view_diff", {
            "workspace_root": str(workspace),
            "original": "line1\nline2\n",
            "modified": "line1\nline2\nline3\n",
        }, mode=DevToolMode.READ_ONLY)
        raw = await tool.execute_action(ti)
        assert raw["additions"] == 1
        assert raw["removals"] == 0
        assert "line3" in raw["diff"]

    @pytest.mark.asyncio
    async def test_view_diff_no_change(self, tool, workspace):
        ti = _inp("view_diff", {
            "workspace_root": str(workspace),
            "original": "same\n",
            "modified": "same\n",
        }, mode=DevToolMode.READ_ONLY)
        raw = await tool.execute_action(ti)
        assert raw["additions"] == 0
        assert raw["removals"] == 0

    @pytest.mark.asyncio
    async def test_create_file(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="create_file",
            params={
                "workspace_root": str(workspace),
                "path": "new_module.py",
                "content": "x = 1\n",
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert (workspace / "new_module.py").read_text() == "x = 1\n"
        assert result.normalized_output["created"] is True

    @pytest.mark.asyncio
    async def test_create_file_overwrite(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="create_file",
            params={
                "workspace_root": str(workspace),
                "path": "main.py",
                "content": "# overwritten\n",
                "overwrite": True,
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "overwritten" in (workspace / "main.py").read_text()

    @pytest.mark.asyncio
    async def test_insert_lines(self, executor, workspace):
        original = (workspace / "main.py").read_text()
        ti = DevToolInput(
            tool_name="code_patch", action="insert_lines",
            params={
                "workspace_root": str(workspace),
                "path": "main.py",
                "start_line": 1,
                "lines": ["# inserted at top"],
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        content = (workspace / "main.py").read_text()
        assert content.startswith("# inserted at top")
        assert "def hello" in content

    @pytest.mark.asyncio
    async def test_replace_lines(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="replace_lines",
            params={
                "workspace_root": str(workspace),
                "path": "main.py",
                "start_line": 1,
                "end_line": 1,
                "lines": ["def greet():"],
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        content = (workspace / "main.py").read_text()
        assert "def greet():" in content
        assert "def hello" not in content

    @pytest.mark.asyncio
    async def test_apply_patch(self, executor, workspace):
        patch = (
            "--- main.py\n"
            "+++ main.py\n"
            "@@ -1,2 +1,3 @@\n"
            " def hello():\n"
            "     print('hi')\n"
            "+    print('patched')\n"
        )
        ti = DevToolInput(
            tool_name="code_patch", action="apply_patch",
            params={
                "workspace_root": str(workspace),
                "path": "main.py",
                "patch": patch,
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        content = (workspace / "main.py").read_text()
        assert "patched" in content


# ── Failure paths ─────────────────────────────────────────────────────────────

class TestCodePatchFailurePaths:
    @pytest.mark.asyncio
    async def test_create_file_no_overwrite(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="create_file",
            params={
                "workspace_root": str(workspace),
                "path": "main.py",
                "content": "boom",
                "overwrite": False,
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert not result.success

    @pytest.mark.asyncio
    async def test_insert_lines_file_not_found(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="insert_lines",
            params={
                "workspace_root": str(workspace),
                "path": "ghost.py",
                "start_line": 1,
                "lines": ["x"],
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_NOT_FOUND

    @pytest.mark.asyncio
    async def test_path_traversal_blocked(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="create_file",
            params={
                "workspace_root": str(workspace),
                "path": "../../evil.py",
                "content": "x",
            },
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_UNSAFE


# ── Normalizer ────────────────────────────────────────────────────────────────

class TestCodePatchNormalizer:
    def test_normalize_dict(self, tool):
        raw = {"diff": "--- a\n+++ b\n", "additions": 1, "removals": 0}
        assert tool.normalize_output(raw) == raw


# ── JSON serialisability ──────────────────────────────────────────────────────

class TestCodePatchJSONSerial:
    @pytest.mark.asyncio
    async def test_json_serialisable(self, executor, workspace):
        ti = DevToolInput(
            tool_name="code_patch", action="view_diff",
            params={
                "workspace_root": str(workspace),
                "original": "a\n",
                "modified": "b\n",
            },
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        json.dumps(result.as_dict())
