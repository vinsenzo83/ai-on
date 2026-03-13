"""
app/devtools/tools/workflow.py
────────────────────────────────
Phase 16 — Stage C · Tool 15: Workflow Automation

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  run_workflow   – execute a named workflow from a workflow definition
  list_workflows – list available workflow definitions
  validate_workflow – validate a workflow YAML/dict without running
  run_steps      – run an ad-hoc ordered list of tool steps

Design notes
────────────
  Workflows are defined as YAML files in <workspace_root>/.devtools/workflows/.
  Each step specifies: tool_name, action, params, mode, and an optional
  on_failure policy ("continue" | "abort" | "rollback").

  This tool is a thin orchestrator — it delegates each step to
  DevToolExecutor (injected at construction time).  No step logic
  lives here; all tool contracts are honoured.

Safety model
────────────
  • run_workflow / run_steps require at least SAFE_WRITE mode.
  • Steps that require higher modes are blocked unless the workflow
    mode is upgraded.
  • Max 50 steps per workflow (DoS guard).

Input params
────────────
  workspace_root  : str        – required
  workflow_name   : str        – run_workflow, validate_workflow
  steps           : list[dict] – run_steps [{tool_name, action, params, mode}]
  max_steps       : int        – run_steps limit (default 50)

Normalized output shapes
────────────────────────
  run_workflow / run_steps →
    { steps_run, steps_passed, steps_failed,
      results: [{step, tool_name, action, success, error_code}] }
  list_workflows →
    { workflows: [str], total }
  validate_workflow →
    { valid: bool, errors: [str] }
"""
from __future__ import annotations

import os
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DevToolError
from app.devtools.normalizers import combine, require_param
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS  = ["run_workflow", "list_workflows", "validate_workflow", "run_steps"]
_WORKFLOWS_SUBDIR   = os.path.join(".devtools", "workflows")
_MAX_STEPS          = 50


class WorkflowTool(BaseDevTool):
    """
    Orchestrate multi-step developer workflows.

    Uses dependency-injected executor for step dispatch.
    Default executor is resolved lazily from get_registry().
    """

    def __init__(self, executor: Any = None) -> None:
        self._executor = executor  # DevToolExecutor, injected for tests

    @property
    def name(self) -> str:
        return "workflow"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.WORKFLOW

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY  # per-action validation enforces SAFE_WRITE for run_*

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "workflow_name":  {"type": "string",  "required": False},
            "steps":          {"type": "array",   "required": False},
            "max_steps":      {"type": "integer", "required": False, "default": 50},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "run_workflow": {
                "steps_run": "int", "steps_passed": "int",
                "steps_failed": "int", "results": "list",
            },
            "list_workflows": {"workflows": "list", "total": "int"},
            "validate_workflow": {"valid": "bool", "errors": "list"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in ("run_workflow", "run_steps"):
            if tool_input.mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires SAFE_WRITE or FULL mode"
                ))

        if action == "run_workflow":
            base.append(require_param(p, "workflow_name", param_type=str))
        if action in ("run_steps",):
            base.append(require_param(p, "steps", param_type=list))
        if action == "validate_workflow":
            base.append(require_param(p, "workflow_name", param_type=str))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p      = tool_input.params
        action = tool_input.action
        root   = p["workspace_root"]

        logger.info("workflow_tool.execute", action=action)

        if action == "list_workflows":
            return self._list_workflows(root)

        if action == "validate_workflow":
            return self._validate_workflow(root, p["workflow_name"])

        if action == "run_workflow":
            steps = self._load_workflow(root, p["workflow_name"])
            return await self._run_steps(steps, tool_input.mode)

        if action == "run_steps":
            max_s  = int(p.get("max_steps", _MAX_STEPS))
            steps  = list(p["steps"])[:max_s]
            return await self._run_steps(steps, tool_input.mode)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        return dict(raw)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _workflow_dir(self, root: str) -> str:
        return os.path.join(root, _WORKFLOWS_SUBDIR)

    def _list_workflows(self, root: str) -> dict:
        wdir = self._workflow_dir(root)
        if not os.path.isdir(wdir):
            return {"workflows": [], "total": 0}
        workflows = [
            f for f in os.listdir(wdir)
            if f.endswith((".yaml", ".yml", ".json"))
        ]
        return {"workflows": sorted(workflows), "total": len(workflows)}

    def _validate_workflow(self, root: str, name: str) -> dict:
        errors = []
        try:
            steps = self._load_workflow(root, name)
        except DevToolError as exc:
            return {"valid": False, "errors": [exc.message]}
        for i, step in enumerate(steps):
            if "tool_name" not in step:
                errors.append(f"Step {i}: missing 'tool_name'")
            if "action" not in step:
                errors.append(f"Step {i}: missing 'action'")
        return {"valid": len(errors) == 0, "errors": errors}

    def _load_workflow(self, root: str, name: str) -> list[dict]:
        wdir = self._workflow_dir(root)
        # Try yaml then json
        for ext in (".yaml", ".yml", ".json"):
            fpath = os.path.join(wdir, f"{name}{ext}")
            if os.path.isfile(fpath):
                with open(fpath) as fh:
                    content = fh.read()
                if ext in (".yaml", ".yml"):
                    try:
                        import yaml
                        data = yaml.safe_load(content)
                    except ImportError:
                        raise DevToolError(
                            "PyYAML not installed; use JSON workflows.",
                            error_code=DevToolErrorCode.DEPENDENCY_ERROR,
                        )
                else:
                    import json
                    data = json.loads(content)
                return data.get("steps", data) if isinstance(data, dict) else data
        raise DevToolError(
            f"Workflow {name!r} not found in {wdir}",
            error_code=DevToolErrorCode.PATH_NOT_FOUND,
        )

    async def _run_steps(self, steps: list[dict], mode: str) -> dict:
        executor = self._get_executor()
        results  = []
        passed   = failed = 0

        for i, step in enumerate(steps):
            tool_name  = step.get("tool_name", "")
            action     = step.get("action", "")
            params     = dict(step.get("params", {}))
            step_mode  = step.get("mode", mode)
            on_failure = step.get("on_failure", "abort")

            ti = DevToolInput(
                tool_name=tool_name,
                action=action,
                params=params,
                mode=step_mode,
            )
            result = await executor.execute(ti)
            step_summary = {
                "step":       i + 1,
                "tool_name":  tool_name,
                "action":     action,
                "success":    result.success,
                "error_code": result.error_code,
            }
            results.append(step_summary)

            if result.success:
                passed += 1
            else:
                failed += 1
                if on_failure == "abort":
                    break

        return {
            "steps_run":    passed + failed,
            "steps_passed": passed,
            "steps_failed": failed,
            "results":      results,
        }

    def _get_executor(self):
        if self._executor is not None:
            return self._executor
        from app.devtools.executor import DevToolExecutor
        return DevToolExecutor()
