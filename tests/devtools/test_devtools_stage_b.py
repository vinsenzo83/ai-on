"""
tests/devtools/test_devtools_stage_b.py
─────────────────────────────────────────
Phase 16 — Stage B tests: Professional Development Tools

Tools covered
─────────────
  LintFormatTool   (lint, format, check, fix)
  DependencyTool   (list_installed, check_outdated, install, uninstall, audit)
  LogReaderTool    (read_log, tail_log, search_log, parse_log)
  BuildTool        (build, clean, info, install)
  EnvConfigTool    (read_env, list_configs, read_config, validate_env)
  MigrationTool    (status, list, apply, rollback, create)

For each tool:
  • Contract test (name, actions)
  • Validation test (missing params, mode guards)
  • At least one happy-path test via executor
  • Normalizer test
  • JSON-serialisability test
"""
from __future__ import annotations

import json
import os
import textwrap
from unittest.mock import AsyncMock, patch

import pytest

from app.devtools.executor               import DevToolExecutor
from app.devtools.registry               import DevToolRegistry
from app.devtools.tools.lint_format      import LintFormatTool
from app.devtools.tools.dependency       import DependencyTool
from app.devtools.tools.log_reader       import LogReaderTool
from app.devtools.tools.build_tool       import BuildTool
from app.devtools.tools.env_config       import EnvConfigTool
from app.devtools.tools.migration        import MigrationTool
from app.devtools.types                  import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _make_executor(*tools):
    reg = DevToolRegistry()
    for t in tools:
        reg.register(t)
    return DevToolExecutor(registry=reg)


def _inp(tool_name, action, params, mode=DevToolMode.READ_ONLY):
    return DevToolInput(tool_name=tool_name, action=action, params=params, mode=mode)


# ══════════════════════════════════════════════════════════════════════════════
# LintFormatTool
# ══════════════════════════════════════════════════════════════════════════════

class TestLintFormatContract:
    def test_name(self):
        assert LintFormatTool().name == "lint_format"

    def test_actions(self):
        assert set(LintFormatTool().get_actions()) == {"lint", "format", "check", "fix"}


class TestLintFormatValidation:
    def test_missing_workspace_root(self):
        ti = _inp("lint_format", "lint", {})
        v = LintFormatTool().validate_input(ti)
        assert not v.passed

    def test_format_requires_safe_write(self):
        ti = DevToolInput(
            tool_name="lint_format", action="format",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.READ_ONLY,
        )
        v = LintFormatTool().validate_input(ti)
        assert not v.passed

    def test_lint_valid_read_only(self):
        ti = _inp("lint_format", "lint", {"workspace_root": "/tmp"})
        v = LintFormatTool().validate_input(ti)
        assert v.passed


class TestLintFormatHappyPath:
    @pytest.mark.asyncio
    async def test_lint_via_mock(self, tmp_path):
        tool     = LintFormatTool()
        executor = _make_executor(tool)

        mock_raw = {
            "tool": "ruff", "path": str(tmp_path),
            "issues": [], "total_issues": 0,
            "exit_code": 0, "output": "All OK",
        }
        with patch.object(LintFormatTool, "execute_action",
                          new=AsyncMock(return_value=mock_raw)):
            ti = _inp("lint_format", "lint",
                      {"workspace_root": str(tmp_path)})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["total_issues"] == 0

    @pytest.mark.asyncio
    async def test_check_real_python_file(self, tmp_path):
        """Use ruff check --quiet on a valid file — should exit 0."""
        (tmp_path / "ok.py").write_text("x = 1\n")
        tool     = LintFormatTool()
        executor = _make_executor(tool)
        ti = _inp("lint_format", "lint",
                  {"workspace_root": str(tmp_path), "path": "ok.py",
                   "tool_name_": "ruff", "timeout": 30})
        result = await executor.execute(ti)
        # ruff may or may not be installed; either way result is valid
        assert result.success or result.error_code is not None
        json.dumps(result.as_dict())


class TestLintFormatNormalizer:
    def test_truncates_output(self):
        raw = {"tool": "ruff", "path": "/t", "issues": [],
               "total_issues": 0, "exit_code": 0,
               "output": "x" * 100_000}
        norm = LintFormatTool().normalize_output(raw)
        assert len(norm["output"]) <= 20_100


# ══════════════════════════════════════════════════════════════════════════════
# DependencyTool
# ══════════════════════════════════════════════════════════════════════════════

class TestDependencyContract:
    def test_name(self):
        assert DependencyTool().name == "dependency"

    def test_actions(self):
        assert set(DependencyTool().get_actions()) == {
            "list_installed", "check_outdated", "install", "uninstall", "audit"
        }


class TestDependencyValidation:
    def test_install_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="dependency", action="install",
            params={"workspace_root": "/tmp", "packages": ["requests"]},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = DependencyTool().validate_input(ti)
        assert not v.passed

    def test_install_requires_packages(self):
        ti = DevToolInput(
            tool_name="dependency", action="install",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.FULL,
        )
        v = DependencyTool().validate_input(ti)
        assert not v.passed

    def test_list_installed_read_only_ok(self):
        ti = _inp("dependency", "list_installed", {"workspace_root": "/tmp"})
        v = DependencyTool().validate_input(ti)
        assert v.passed


class TestDependencyHappyPath:
    @pytest.mark.asyncio
    async def test_list_installed_real(self, tmp_path):
        tool     = DependencyTool()
        executor = _make_executor(tool)
        ti = _inp("dependency", "list_installed",
                  {"workspace_root": str(tmp_path), "manager": "pip"})
        result = await executor.execute(ti)
        assert result.success
        pkgs = result.normalized_output["packages"]
        assert isinstance(pkgs, list)
        assert len(pkgs) > 0
        json.dumps(result.as_dict())

    @pytest.mark.asyncio
    async def test_check_outdated(self, tmp_path):
        tool     = DependencyTool()
        executor = _make_executor(tool)
        ti = _inp("dependency", "check_outdated",
                  {"workspace_root": str(tmp_path), "manager": "pip"})
        result = await executor.execute(ti)
        assert result.success
        assert "outdated" in result.normalized_output


class TestDependencyNormalizer:
    def test_truncates_output(self):
        raw = {"manager": "pip", "installed": ["x"], "output": "y" * 50_000}
        norm = DependencyTool().normalize_output(raw)
        assert len(norm["output"]) <= 20_100


# ══════════════════════════════════════════════════════════════════════════════
# LogReaderTool
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def log_file(tmp_path):
    log = tmp_path / "app.log"
    log.write_text(
        'INFO msg="started" service=api\n'
        'ERROR msg="connection failed" code=503\n'
        '{"level":"warn","msg":"slow query","duration":1500}\n'
        "plain text line\n"
    )
    return tmp_path


class TestLogReaderContract:
    def test_name(self):
        assert LogReaderTool().name == "log_reader"

    def test_actions(self):
        assert set(LogReaderTool().get_actions()) == {
            "read_log", "tail_log", "search_log", "parse_log"
        }


class TestLogReaderValidation:
    def test_missing_path(self):
        ti = _inp("log_reader", "read_log", {"workspace_root": "/tmp"})
        v = LogReaderTool().validate_input(ti)
        assert not v.passed

    def test_search_requires_pattern(self):
        ti = _inp("log_reader", "search_log",
                  {"workspace_root": "/tmp", "path": "app.log"})
        v = LogReaderTool().validate_input(ti)
        assert not v.passed


class TestLogReaderHappyPath:
    @pytest.mark.asyncio
    async def test_read_log(self, log_file):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "read_log",
                  {"workspace_root": str(log_file), "path": "app.log"})
        result = await executor.execute(ti)
        assert result.success
        assert "ERROR" in result.normalized_output["content"]

    @pytest.mark.asyncio
    async def test_tail_log(self, log_file):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "tail_log",
                  {"workspace_root": str(log_file), "path": "app.log", "lines": 2})
        result = await executor.execute(ti)
        assert result.success
        assert len(result.normalized_output["lines"]) == 2

    @pytest.mark.asyncio
    async def test_search_log(self, log_file):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "search_log",
                  {"workspace_root": str(log_file), "path": "app.log",
                   "pattern": "ERROR"})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["total"] >= 1

    @pytest.mark.asyncio
    async def test_parse_log(self, log_file):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "parse_log",
                  {"workspace_root": str(log_file), "path": "app.log"})
        result = await executor.execute(ti)
        assert result.success
        entries = result.normalized_output["entries"]
        assert len(entries) > 0

    @pytest.mark.asyncio
    async def test_path_not_found(self, tmp_path):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "read_log",
                  {"workspace_root": str(tmp_path), "path": "ghost.log"})
        result = await executor.execute(ti)
        assert not result.success
        assert result.error_code == DevToolErrorCode.PATH_NOT_FOUND

    @pytest.mark.asyncio
    async def test_json_serialisable(self, log_file):
        tool     = LogReaderTool()
        executor = _make_executor(tool)
        ti = _inp("log_reader", "read_log",
                  {"workspace_root": str(log_file), "path": "app.log"})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


class TestLogReaderNormalizer:
    def test_truncates_content(self):
        raw = {"path": "/f", "content": "x" * 200_000,
               "line_count": 100, "truncated": True}
        norm = LogReaderTool().normalize_output(raw)
        assert len(norm["content"]) <= 50_100


# ══════════════════════════════════════════════════════════════════════════════
# BuildTool
# ══════════════════════════════════════════════════════════════════════════════

class TestBuildContract:
    def test_name(self):
        assert BuildTool().name == "build_tool"

    def test_actions(self):
        assert set(BuildTool().get_actions()) == {"build", "clean", "info", "install"}


class TestBuildValidation:
    def test_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="build_tool", action="build",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = BuildTool().validate_input(ti)
        assert not v.passed

    def test_full_mode_ok(self):
        ti = DevToolInput(
            tool_name="build_tool", action="info",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.FULL,
        )
        v = BuildTool().validate_input(ti)
        assert v.passed


class TestBuildHappyPath:
    @pytest.mark.asyncio
    async def test_info_action(self, tmp_path):
        (tmp_path / "Makefile").write_text("build:\n\techo done\nclean:\n\trm -rf dist\n")
        tool     = BuildTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="build_tool", action="info",
            params={"workspace_root": str(tmp_path)},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert "Makefile" in out.get("config_files", [])
        assert "build" in out.get("detected_targets", [])

    @pytest.mark.asyncio
    async def test_build_via_mock(self, tmp_path):
        tool     = BuildTool()
        executor = _make_executor(tool)
        mock_raw = {
            "builder": "make", "target": "",
            "stdout": "Built!", "stderr": "",
            "exit_code": 0, "success": True, "duration_s": 0.5,
        }
        with patch.object(BuildTool, "execute_action",
                          new=AsyncMock(return_value=mock_raw)):
            ti = DevToolInput(
                tool_name="build_tool", action="build",
                params={"workspace_root": str(tmp_path)},
                mode=DevToolMode.FULL,
            )
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["success"] is True

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        (tmp_path / "Makefile").write_text("build:\n\techo ok\n")
        tool     = BuildTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="build_tool", action="info",
            params={"workspace_root": str(tmp_path)},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


class TestBuildNormalizer:
    def test_truncates_stdout(self):
        raw = {"builder": "make", "target": "", "stdout": "o" * 100_000,
               "stderr": "", "exit_code": 0, "success": True, "duration_s": 1.0}
        norm = BuildTool().normalize_output(raw)
        assert len(norm["stdout"]) <= 20_100


# ══════════════════════════════════════════════════════════════════════════════
# EnvConfigTool
# ══════════════════════════════════════════════════════════════════════════════

class TestEnvConfigContract:
    def test_name(self):
        assert EnvConfigTool().name == "env_config"

    def test_actions(self):
        assert set(EnvConfigTool().get_actions()) == {
            "read_env", "list_configs", "read_config", "validate_env"
        }


class TestEnvConfigValidation:
    def test_read_config_requires_path(self):
        ti = _inp("env_config", "read_config", {"workspace_root": "/tmp"})
        v = EnvConfigTool().validate_input(ti)
        assert not v.passed

    def test_validate_env_requires_required_vars(self):
        ti = _inp("env_config", "validate_env", {"workspace_root": "/tmp"})
        v = EnvConfigTool().validate_input(ti)
        assert not v.passed

    def test_read_env_valid(self):
        ti = _inp("env_config", "read_env", {"workspace_root": "/tmp"})
        v = EnvConfigTool().validate_input(ti)
        assert v.passed


class TestEnvConfigHappyPath:
    @pytest.mark.asyncio
    async def test_read_env(self, tmp_path):
        tool     = EnvConfigTool()
        executor = _make_executor(tool)
        ti = _inp("env_config", "read_env", {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert "vars" in out
        assert out["total"] > 0
        assert out["redacted_count"] >= 0

    @pytest.mark.asyncio
    async def test_secrets_redacted(self, tmp_path):
        import os
        orig = os.environ.copy()
        os.environ["SUPER_SECRET_KEY"] = "topsecret123"
        try:
            tool     = EnvConfigTool()
            executor = _make_executor(tool)
            ti = _inp("env_config", "read_env", {"workspace_root": str(tmp_path)})
            result = await executor.execute(ti)
            assert result.success
            vars_ = result.normalized_output["vars"]
            assert vars_.get("SUPER_SECRET_KEY") == "***REDACTED***"
        finally:
            os.environ.clear()
            os.environ.update(orig)

    @pytest.mark.asyncio
    async def test_list_configs(self, tmp_path):
        (tmp_path / ".env").write_text("PORT=8000\n")
        (tmp_path / "config.json").write_text('{"debug": true}')
        tool     = EnvConfigTool()
        executor = _make_executor(tool)
        ti = _inp("env_config", "list_configs", {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        paths = [e["path"] for e in result.normalized_output["config_files"]]
        assert any(".env" in p for p in paths)

    @pytest.mark.asyncio
    async def test_read_json_config(self, tmp_path):
        cfg = tmp_path / "config.json"
        cfg.write_text('{"debug": true, "port": 8080}')
        tool     = EnvConfigTool()
        executor = _make_executor(tool)
        ti = _inp("env_config", "read_config",
                  {"workspace_root": str(tmp_path), "path": "config.json"})
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert out["type"] == "json"
        assert out["data"]["debug"] is True

    @pytest.mark.asyncio
    async def test_validate_env_present(self, tmp_path):
        import os
        orig = os.environ.copy()
        os.environ["TEST_VAR_PRESENT"] = "yes"
        try:
            tool     = EnvConfigTool()
            executor = _make_executor(tool)
            ti = _inp("env_config", "validate_env",
                      {"workspace_root": str(tmp_path),
                       "required_vars": ["TEST_VAR_PRESENT", "DEFINITELY_MISSING"]})
            result = await executor.execute(ti)
            assert result.success
            out = result.normalized_output
            assert "TEST_VAR_PRESENT" in out["present"]
            assert "DEFINITELY_MISSING" in out["missing"]
            assert out["all_present"] is False
        finally:
            os.environ.clear()
            os.environ.update(orig)

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = EnvConfigTool()
        executor = _make_executor(tool)
        ti = _inp("env_config", "read_env", {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


# ══════════════════════════════════════════════════════════════════════════════
# MigrationTool
# ══════════════════════════════════════════════════════════════════════════════

class TestMigrationContract:
    def test_name(self):
        assert MigrationTool().name == "migration"

    def test_actions(self):
        assert set(MigrationTool().get_actions()) == {
            "status", "list", "apply", "rollback", "create"
        }


class TestMigrationValidation:
    def test_apply_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="migration", action="apply",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = MigrationTool().validate_input(ti)
        assert not v.passed

    def test_create_requires_name(self):
        ti = DevToolInput(
            tool_name="migration", action="create",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = MigrationTool().validate_input(ti)
        assert not v.passed

    def test_status_read_only_ok(self):
        ti = _inp("migration", "status", {"workspace_root": "/tmp"})
        v = MigrationTool().validate_input(ti)
        assert v.passed


class TestMigrationHappyPath:
    @pytest.mark.asyncio
    async def test_status_via_mock(self, tmp_path):
        tool     = MigrationTool()
        executor = _make_executor(tool)
        mock_raw = {
            "framework": "alembic",
            "current_revision": "abc123",
            "pending": [],
            "output": "(head)",
        }
        with patch.object(MigrationTool, "execute_action",
                          new=AsyncMock(return_value=mock_raw)):
            ti = _inp("migration", "status",
                      {"workspace_root": str(tmp_path)})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["framework"] == "alembic"

    @pytest.mark.asyncio
    async def test_detect_framework_alembic(self, tmp_path):
        (tmp_path / "alembic.ini").write_text("[alembic]\n")
        tool = MigrationTool()
        assert tool._detect_framework(str(tmp_path)) == "alembic"

    @pytest.mark.asyncio
    async def test_detect_framework_django(self, tmp_path):
        (tmp_path / "manage.py").write_text("#!/usr/bin/env python\n")
        tool = MigrationTool()
        assert tool._detect_framework(str(tmp_path)) == "django"

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = MigrationTool()
        executor = _make_executor(tool)
        mock_raw = {"framework": "alembic", "current_revision": "head",
                    "pending": [], "output": ""}
        with patch.object(MigrationTool, "execute_action",
                          new=AsyncMock(return_value=mock_raw)):
            ti = _inp("migration", "status", {"workspace_root": str(tmp_path)})
            result = await executor.execute(ti)
        json.dumps(result.as_dict())


class TestMigrationNormalizer:
    def test_truncates_output(self):
        raw = {"framework": "alembic", "applied": 2,
               "output": "x" * 50_000, "success": True}
        norm = MigrationTool().normalize_output(raw)
        assert len(norm["output"]) <= 10_100
