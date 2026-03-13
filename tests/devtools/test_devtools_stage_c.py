"""
tests/devtools/test_devtools_stage_c.py
─────────────────────────────────────────
Phase 16 — Stage C tests: Advanced Developer Mode Tools

Tools covered
─────────────
  PreviewTool      (start, stop, status, get_url, open)
  WorkflowTool     (run_workflow, list_workflows, validate_workflow, run_steps)
  DeployHelperTool (validate, preflight, package, deploy, status)
  DocExportTool    (generate_readme, export_markdown, generate_report, export_pdf)
  SandboxRunTool   (run_python, run_snippet, validate, profile)

For each tool:
  • Contract test (name, actions)
  • Validation test (mode guards, missing params)
  • At least one happy-path test via executor
  • Normalizer test
  • JSON-serialisability test
"""
from __future__ import annotations

import json
import os
import textwrap
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.devtools.executor               import DevToolExecutor
from app.devtools.registry               import DevToolRegistry
from app.devtools.tools.preview          import PreviewTool
from app.devtools.tools.workflow         import WorkflowTool
from app.devtools.tools.deploy_helper    import DeployHelperTool
from app.devtools.tools.doc_export       import DocExportTool
from app.devtools.tools.sandbox_run      import SandboxRunTool
from app.devtools.types                  import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
)


def _make_executor(*tools):
    reg = DevToolRegistry()
    for t in tools:
        reg.register(t)
    return DevToolExecutor(registry=reg)


def _inp(tool_name, action, params, mode=DevToolMode.READ_ONLY):
    return DevToolInput(tool_name=tool_name, action=action, params=params, mode=mode)


# ══════════════════════════════════════════════════════════════════════════════
# PreviewTool
# ══════════════════════════════════════════════════════════════════════════════

class TestPreviewContract:
    def test_name(self):
        assert PreviewTool().name == "preview"

    def test_actions(self):
        assert set(PreviewTool().get_actions()) == {
            "start", "stop", "status", "get_url", "open"
        }


class TestPreviewValidation:
    def test_start_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="preview", action="start",
            params={"workspace_root": "/tmp", "command": "echo test"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = PreviewTool().validate_input(ti)
        assert not v.passed

    def test_start_requires_command(self):
        ti = DevToolInput(
            tool_name="preview", action="start",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.FULL,
        )
        v = PreviewTool().validate_input(ti)
        assert not v.passed

    def test_blocked_command(self):
        ti = DevToolInput(
            tool_name="preview", action="start",
            params={"workspace_root": "/tmp", "command": "rm -rf /"},
            mode=DevToolMode.FULL,
        )
        v = PreviewTool().validate_input(ti)
        assert not v.passed

    def test_status_read_only_ok(self):
        ti = _inp("preview", "status", {"workspace_root": "/tmp"})
        v = PreviewTool().validate_input(ti)
        assert v.passed


class TestPreviewHappyPath:
    @pytest.mark.asyncio
    async def test_get_url(self, tmp_path):
        tool     = PreviewTool()
        executor = _make_executor(tool)
        ti = _inp("preview", "get_url",
                  {"workspace_root": str(tmp_path), "port": 4000})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["url"] == "http://localhost:4000"

    @pytest.mark.asyncio
    async def test_status_not_running(self, tmp_path):
        tool     = PreviewTool()
        executor = _make_executor(tool)
        ti = _inp("preview", "status", {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["running"] is False

    @pytest.mark.asyncio
    async def test_stop_no_pidfile(self, tmp_path):
        tool     = PreviewTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="preview", action="stop",
            params={"workspace_root": str(tmp_path)},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["stopped"] is False

    @pytest.mark.asyncio
    async def test_open_via_mock(self, tmp_path):
        tool     = PreviewTool()
        executor = _make_executor(tool)
        mock_raw = {
            "url": "http://localhost:3000",
            "html_snippet": "<html><body>Hello</body></html>",
            "status_code": 200,
        }
        with patch.object(PreviewTool, "execute_action",
                          new=AsyncMock(return_value=mock_raw)):
            ti = DevToolInput(
                tool_name="preview", action="open",
                params={"workspace_root": str(tmp_path),
                        "url": "http://localhost:3000"},
                mode=DevToolMode.FULL,
            )
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["status_code"] == 200

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = PreviewTool()
        executor = _make_executor(tool)
        ti = _inp("preview", "status", {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


class TestPreviewNormalizer:
    def test_truncates_html_snippet(self):
        raw = {"url": "x", "html_snippet": "h" * 20_000, "status_code": 200}
        norm = PreviewTool().normalize_output(raw)
        assert len(norm["html_snippet"]) <= 5_100


# ══════════════════════════════════════════════════════════════════════════════
# WorkflowTool
# ══════════════════════════════════════════════════════════════════════════════

class TestWorkflowContract:
    def test_name(self):
        assert WorkflowTool().name == "workflow"

    def test_actions(self):
        assert set(WorkflowTool().get_actions()) == {
            "run_workflow", "list_workflows", "validate_workflow", "run_steps"
        }


class TestWorkflowValidation:
    def test_run_steps_requires_safe_write(self):
        ti = DevToolInput(
            tool_name="workflow", action="run_steps",
            params={"workspace_root": "/tmp", "steps": []},
            mode=DevToolMode.READ_ONLY,
        )
        v = WorkflowTool().validate_input(ti)
        assert not v.passed

    def test_run_workflow_requires_name(self):
        ti = DevToolInput(
            tool_name="workflow", action="run_workflow",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = WorkflowTool().validate_input(ti)
        assert not v.passed

    def test_list_workflows_read_only_ok(self):
        ti = _inp("workflow", "list_workflows", {"workspace_root": "/tmp"})
        v = WorkflowTool().validate_input(ti)
        assert v.passed


class TestWorkflowHappyPath:
    @pytest.mark.asyncio
    async def test_list_workflows_empty(self, tmp_path):
        tool     = WorkflowTool()
        executor = _make_executor(tool)
        ti = _inp("workflow", "list_workflows",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["total"] == 0

    @pytest.mark.asyncio
    async def test_list_workflows_with_files(self, tmp_path):
        wdir = tmp_path / ".devtools" / "workflows"
        wdir.mkdir(parents=True)
        (wdir / "my_workflow.yaml").write_text("steps:\n  - tool_name: git\n    action: status\n")
        tool     = WorkflowTool()
        executor = _make_executor(tool)
        ti = _inp("workflow", "list_workflows",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        assert "my_workflow.yaml" in result.normalized_output["workflows"]

    @pytest.mark.asyncio
    async def test_run_steps_with_mock_executor(self, tmp_path):
        # Build a mock inner executor
        from app.devtools.types import DevToolResult
        mock_exec = MagicMock()
        mock_result = DevToolResult(
            request_id="r1", tool_name="filesystem", action="read_file",
            success=True, normalized_output={"content": "hello"},
        )
        mock_exec.execute = AsyncMock(return_value=mock_result)

        tool     = WorkflowTool(executor=mock_exec)
        executor = _make_executor(tool)

        steps = [
            {"tool_name": "filesystem", "action": "read_file",
             "params": {"workspace_root": str(tmp_path), "path": "x"},
             "mode": DevToolMode.READ_ONLY},
        ]
        ti = DevToolInput(
            tool_name="workflow", action="run_steps",
            params={"workspace_root": str(tmp_path), "steps": steps},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert out["steps_run"] == 1
        assert out["steps_passed"] == 1
        assert out["steps_failed"] == 0

    @pytest.mark.asyncio
    async def test_run_steps_abort_on_failure(self, tmp_path):
        from app.devtools.types import DevToolResult
        mock_exec = MagicMock()
        fail_result = DevToolResult(
            request_id="r1", tool_name="x", action="a",
            success=False, error_code=DevToolErrorCode.ACTION_FAILED,
        )
        mock_exec.execute = AsyncMock(return_value=fail_result)

        tool = WorkflowTool(executor=mock_exec)
        executor = _make_executor(tool)

        steps = [
            {"tool_name": "x", "action": "a", "params": {}, "on_failure": "abort"},
            {"tool_name": "x", "action": "a", "params": {}},  # should not run
        ]
        ti = DevToolInput(
            tool_name="workflow", action="run_steps",
            params={"workspace_root": str(tmp_path), "steps": steps},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        # Aborted after first step
        assert out["steps_run"] == 1

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = WorkflowTool()
        executor = _make_executor(tool)
        ti = _inp("workflow", "list_workflows",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


# ══════════════════════════════════════════════════════════════════════════════
# DeployHelperTool
# ══════════════════════════════════════════════════════════════════════════════

class TestDeployHelperContract:
    def test_name(self):
        assert DeployHelperTool().name == "deploy_helper"

    def test_actions(self):
        assert set(DeployHelperTool().get_actions()) == {
            "validate", "preflight", "package", "deploy", "status"
        }


class TestDeployHelperValidation:
    def test_deploy_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="deploy_helper", action="deploy",
            params={"workspace_root": "/tmp", "confirm": True},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = DeployHelperTool().validate_input(ti)
        assert not v.passed

    def test_deploy_requires_confirm(self):
        ti = DevToolInput(
            tool_name="deploy_helper", action="deploy",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.FULL,
        )
        v = DeployHelperTool().validate_input(ti)
        assert not v.passed

    def test_validate_read_only_ok(self):
        ti = _inp("deploy_helper", "validate", {"workspace_root": "/tmp"})
        v = DeployHelperTool().validate_input(ti)
        assert v.passed


class TestDeployHelperHappyPath:
    @pytest.mark.asyncio
    async def test_validate(self, tmp_path):
        tool     = DeployHelperTool()
        executor = _make_executor(tool)
        ti = _inp("deploy_helper", "validate",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        out = result.normalized_output
        assert "checks" in out

    @pytest.mark.asyncio
    async def test_preflight(self, tmp_path):
        tool     = DeployHelperTool()
        executor = _make_executor(tool)
        ti = _inp("deploy_helper", "preflight",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success

    @pytest.mark.asyncio
    async def test_package(self, tmp_path):
        (tmp_path / "main.py").write_text("x = 1\n")
        tool     = DeployHelperTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="deploy_helper", action="package",
            params={"workspace_root": str(tmp_path),
                    "output_path": "dist/test.tar.gz"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["success"] is True
        assert os.path.exists(result.normalized_output["archive_path"])

    @pytest.mark.asyncio
    async def test_status_never_deployed(self, tmp_path):
        tool     = DeployHelperTool()
        executor = _make_executor(tool)
        ti = _inp("deploy_helper", "status",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["deployed"] is False
        assert result.normalized_output["last_deployed"] == "never"

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = DeployHelperTool()
        executor = _make_executor(tool)
        ti = _inp("deploy_helper", "validate",
                  {"workspace_root": str(tmp_path)})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


# ══════════════════════════════════════════════════════════════════════════════
# DocExportTool
# ══════════════════════════════════════════════════════════════════════════════

class TestDocExportContract:
    def test_name(self):
        assert DocExportTool().name == "doc_export"

    def test_actions(self):
        assert set(DocExportTool().get_actions()) == {
            "generate_readme", "export_markdown",
            "generate_report", "export_pdf",
        }


class TestDocExportValidation:
    def test_read_only_blocked(self):
        ti = DevToolInput(
            tool_name="doc_export", action="generate_readme",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.READ_ONLY,
        )
        v = DocExportTool().validate_input(ti)
        assert not v.passed

    def test_export_markdown_requires_path(self):
        ti = DevToolInput(
            tool_name="doc_export", action="export_markdown",
            params={"workspace_root": "/tmp", "output_path": "out.md"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = DocExportTool().validate_input(ti)
        assert not v.passed


class TestDocExportHappyPath:
    @pytest.mark.asyncio
    async def test_generate_readme(self, tmp_path):
        (tmp_path / "main.py").write_text("x = 1\n")
        tool     = DocExportTool()
        executor = _make_executor(tool)
        out_path = str(tmp_path / "README.md")
        ti = DevToolInput(
            tool_name="doc_export", action="generate_readme",
            params={"workspace_root": str(tmp_path),
                    "output_path": out_path,
                    "title": "My Test Project"},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert os.path.exists(out_path)
        content = open(out_path).read()
        assert "My Test Project" in content

    @pytest.mark.asyncio
    async def test_generate_report(self, tmp_path):
        (tmp_path / "a.py").write_text("x = 1\n")
        (tmp_path / "b.js").write_text("const x = 1;\n")
        tool     = DocExportTool()
        executor = _make_executor(tool)
        out_path = str(tmp_path / "report.json")
        ti = DevToolInput(
            tool_name="doc_export", action="generate_report",
            params={"workspace_root": str(tmp_path), "output_path": out_path},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        report = json.load(open(out_path))
        assert report["total_files"] >= 2

    @pytest.mark.asyncio
    async def test_export_markdown(self, tmp_path):
        src_md = tmp_path / "docs.md"
        src_md.write_text("# Hello\nThis is docs.\n")
        tool     = DocExportTool()
        executor = _make_executor(tool)
        out_path = str(tmp_path / "exported.md")
        ti = DevToolInput(
            tool_name="doc_export", action="export_markdown",
            params={"workspace_root": str(tmp_path),
                    "path": "docs.md",
                    "output_path": out_path},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "Hello" in open(out_path).read()

    @pytest.mark.asyncio
    async def test_json_serialisable(self, tmp_path):
        tool     = DocExportTool()
        executor = _make_executor(tool)
        out_path = str(tmp_path / "README.md")
        ti = DevToolInput(
            tool_name="doc_export", action="generate_readme",
            params={"workspace_root": str(tmp_path), "output_path": out_path},
            mode=DevToolMode.SAFE_WRITE,
        )
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


# ══════════════════════════════════════════════════════════════════════════════
# SandboxRunTool
# ══════════════════════════════════════════════════════════════════════════════

class TestSandboxContract:
    def test_name(self):
        assert SandboxRunTool().name == "sandbox_run"

    def test_actions(self):
        assert set(SandboxRunTool().get_actions()) == {
            "run_python", "run_snippet", "validate", "profile"
        }


class TestSandboxValidation:
    def test_run_python_requires_full_mode(self):
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={"workspace_root": "/tmp", "code": "print(1)"},
            mode=DevToolMode.SAFE_WRITE,
        )
        v = SandboxRunTool().validate_input(ti)
        assert not v.passed

    def test_validate_read_only_ok(self):
        ti = _inp("sandbox_run", "validate",
                  {"workspace_root": "/tmp", "code": "x = 1"})
        v = SandboxRunTool().validate_input(ti)
        assert v.passed

    def test_run_python_missing_code(self):
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={"workspace_root": "/tmp"},
            mode=DevToolMode.FULL,
        )
        v = SandboxRunTool().validate_input(ti)
        assert not v.passed


class TestSandboxHappyPath:
    @pytest.mark.asyncio
    async def test_validate_valid_code(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = _inp("sandbox_run", "validate",
                  {"workspace_root": "/tmp", "code": "x = 1 + 2\nprint(x)"})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["valid"] is True
        assert result.normalized_output["errors"] == []

    @pytest.mark.asyncio
    async def test_validate_syntax_error(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = _inp("sandbox_run", "validate",
                  {"workspace_root": "/tmp", "code": "def broken("})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["valid"] is False
        assert len(result.normalized_output["errors"]) > 0

    @pytest.mark.asyncio
    async def test_validate_blocked_import(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = _inp("sandbox_run", "validate",
                  {"workspace_root": "/tmp", "code": "import os\nprint(os.getcwd())"})
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["valid"] is False

    @pytest.mark.asyncio
    async def test_run_python_hello_world(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={"workspace_root": "/tmp",
                    "code": "print('hello from sandbox')"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "hello from sandbox" in result.normalized_output["stdout"]
        assert result.normalized_output["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_run_python_with_stdin(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={
                "workspace_root": "/tmp",
                "code": "import sys; print(sys.stdin.read().strip().upper())",
                "stdin": "hello",
            },
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert "HELLO" in result.normalized_output["stdout"]

    @pytest.mark.asyncio
    async def test_run_python_exit_code(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={"workspace_root": "/tmp",
                    "code": "raise SystemExit(42)"},
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["exit_code"] == 42

    @pytest.mark.asyncio
    async def test_run_python_timeout(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = DevToolInput(
            tool_name="sandbox_run", action="run_python",
            params={
                "workspace_root": "/tmp",
                "code": "import time; time.sleep(100)",
                "timeout": 1.0,
            },
            mode=DevToolMode.FULL,
        )
        result = await executor.execute(ti)
        assert result.success
        assert result.normalized_output["timed_out"] is True

    @pytest.mark.asyncio
    async def test_json_serialisable(self):
        tool     = SandboxRunTool()
        executor = _make_executor(tool)
        ti = _inp("sandbox_run", "validate",
                  {"workspace_root": "/tmp", "code": "x = 1"})
        result = await executor.execute(ti)
        json.dumps(result.as_dict())


class TestSandboxNormalizer:
    def test_truncates_stdout(self):
        raw = {"language": "python", "stdout": "x" * 100_000,
               "stderr": "", "exit_code": 0, "timed_out": False, "duration_s": 0.1}
        norm = SandboxRunTool().normalize_output(raw)
        assert len(norm["stdout"]) <= 10_100
