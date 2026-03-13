"""
tests/devtools/test_devtools_git.py
────────────────────────────────────
Phase 16 — Stage A tests: GitTool

Coverage
────────
  Contract    : name, actions, op_type
  Validation  : mode guards, missing params
  Happy paths : status, diff, log, add, commit (in a real tmp git repo)
  Failure     : commit without staged files, push to nonexistent remote
  Normalizer  : diff truncation
  JSON-serial : as_dict() roundtrip
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess

import pytest

from app.devtools.executor      import DevToolExecutor
from app.devtools.registry      import DevToolRegistry
from app.devtools.tools.git_tool import GitTool
from app.devtools.types         import DevToolInput, DevToolMode, DevToolErrorCode


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def git_repo(tmp_path):
    """Create a minimal git repo for testing."""
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=str(tmp_path), check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=str(tmp_path), check=True, capture_output=True,
    )
    (tmp_path / "README.md").write_text("# Test Repo\n")
    subprocess.run(
        ["git", "add", "."], cwd=str(tmp_path), check=True, capture_output=True
    )
    subprocess.run(
        ["git", "commit", "-m", "initial"],
        cwd=str(tmp_path), check=True, capture_output=True,
    )
    return tmp_path


@pytest.fixture
def tool():
    return GitTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action, params, mode=DevToolMode.SAFE_WRITE):
    return DevToolInput(tool_name="git", action=action, params=params, mode=mode)


# ── Contract ──────────────────────────────────────────────────────────────────

class TestGitContract:
    def test_name(self, tool):
        assert tool.name == "git"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {
            "status", "diff", "log", "add", "commit",
            "push", "checkout", "branch",
        }

    def test_can_handle(self, tool):
        assert tool.can_handle("status")
        assert not tool.can_handle("stash")


# ── Validation ────────────────────────────────────────────────────────────────

class TestGitValidation:
    def test_missing_workspace_root(self, tool):
        ti = _inp("status", {})
        v  = tool.validate_input(ti)
        assert not v.passed

    def test_commit_requires_message(self, tool, git_repo):
        ti = _inp("commit", {"workspace_root": str(git_repo)})
        v  = tool.validate_input(ti)
        assert not v.passed

    def test_push_requires_full_mode(self, tool, git_repo):
        ti = DevToolInput(
            tool_name="git", action="push",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = tool.validate_input(ti)
        assert not v.passed
        # error message contains either "FULL" or "full"
        assert any("full" in e.lower() for e in v.errors)

    def test_status_read_only_is_ok(self, tool, git_repo):
        ti = DevToolInput(
            tool_name="git", action="status",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.READ_ONLY,
        )
        v = tool.validate_input(ti)
        assert v.passed


# ── Happy paths ───────────────────────────────────────────────────────────────

class TestGitHappyPaths:
    @pytest.mark.asyncio
    async def test_status_clean_repo(self, executor, git_repo):
        ti = DevToolInput(
            tool_name="git", action="status",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert "branch" in out
        assert isinstance(out["staged"],    list)
        assert isinstance(out["unstaged"],  list)
        assert isinstance(out["untracked"], list)

    @pytest.mark.asyncio
    async def test_status_with_unstaged_file(self, executor, git_repo):
        (git_repo / "new.txt").write_text("new")
        ti = DevToolInput(
            tool_name="git", action="status",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        assert any("new.txt" in u for u in result.normalized_output["untracked"])

    @pytest.mark.asyncio
    async def test_diff_no_changes(self, executor, git_repo):
        ti = DevToolInput(
            tool_name="git", action="diff",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success

    @pytest.mark.asyncio
    async def test_log_shows_initial_commit(self, executor, git_repo):
        ti = DevToolInput(
            tool_name="git", action="log",
            params={"workspace_root": str(git_repo), "max_commits": 5},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        commits = result.normalized_output["commits"]
        assert len(commits) >= 1
        assert commits[0]["message"] == "initial"

    @pytest.mark.asyncio
    async def test_add_and_commit(self, executor, git_repo):
        (git_repo / "feature.py").write_text("x = 1\n")

        # git add
        add_ti = DevToolInput(
            tool_name="git", action="add",
            params={"workspace_root": str(git_repo), "paths": ["feature.py"]},
            mode=DevToolMode.SAFE_WRITE,
        )
        add_result = await executor.execute(add_ti)
        assert add_result.success

        # git commit
        commit_ti = DevToolInput(
            tool_name="git", action="commit",
            params={"workspace_root": str(git_repo), "message": "add feature"},
            mode=DevToolMode.SAFE_WRITE,
        )
        commit_result = await executor.execute(commit_ti)
        assert commit_result.success
        assert commit_result.normalized_output["message"] == "add feature"

    @pytest.mark.asyncio
    async def test_branch_list(self, executor, git_repo):
        ti = DevToolInput(
            tool_name="git", action="branch",
            params={"workspace_root": str(git_repo), "action_detail": "list"},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        assert isinstance(result.normalized_output["branches"], list)
        assert len(result.normalized_output["branches"]) >= 1


# ── Failure paths ─────────────────────────────────────────────────────────────

class TestGitFailurePaths:
    @pytest.mark.asyncio
    async def test_commit_nothing_staged_fails(self, executor, git_repo):
        """git commit with nothing staged returns nonzero exit → DevToolError."""
        ti = DevToolInput(
            tool_name="git", action="commit",
            params={"workspace_root": str(git_repo), "message": "empty"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        # Nothing to commit → git exits 1
        assert not result.success

    @pytest.mark.asyncio
    async def test_push_to_no_remote_fails(self, executor, git_repo):
        """Push to nonexistent remote fails gracefully."""
        ti = DevToolInput(
            tool_name="git", action="push",
            params={"workspace_root": str(git_repo), "remote": "no_such_remote"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert not result.success


# ── Normalizer ────────────────────────────────────────────────────────────────

class TestGitNormalizer:
    def test_truncates_long_diff(self, tool):
        raw = {"diff": "x" * 200_000, "files_changed": 1, "additions": 1, "removals": 0}
        norm = tool.normalize_output(raw)
        assert len(norm["diff"]) <= 50_100

    def test_pass_through_status(self, tool):
        raw = {"branch": "main", "staged": [], "unstaged": [], "untracked": []}
        norm = tool.normalize_output(raw)
        assert norm == raw


# ── JSON serialisability ──────────────────────────────────────────────────────

class TestGitJSONSerial:
    @pytest.mark.asyncio
    async def test_json_serialisable(self, executor, git_repo):
        ti = DevToolInput(
            tool_name="git", action="status",
            params={"workspace_root": str(git_repo)},
            mode=DevToolMode.READ_ONLY,
        )
        result = await executor.execute(ti)
        assert result.success
        json.dumps(result.as_dict())
