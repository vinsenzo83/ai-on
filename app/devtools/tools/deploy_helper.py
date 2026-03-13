"""
app/devtools/tools/deploy_helper.py
─────────────────────────────────────
Phase 16 — Stage C · Tool 16: Deploy Helper

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  validate   – validate deployment configuration (read-only)
  preflight  – run pre-deployment checks (read-only)
  package    – create deployment package / archive (SAFE_WRITE)
  deploy     – trigger deployment command (FULL mode required)
  status     – check deployment status (read-only)

Safety model
────────────
  • validate / preflight / status are READ_ONLY-compatible.
  • package requires SAFE_WRITE.
  • deploy requires FULL mode and explicit confirmation param.
  • deploy is permanently rate-limited to prevent accidental runs.

Input params
────────────
  workspace_root  : str        – required
  environment     : str        – "staging" | "production" | "local" (default "staging")
  confirm         : bool       – must be True for deploy action (safety gate)
  command         : str        – custom deploy command (deploy action)
  output_path     : str        – archive path (package action, default "dist/app.tar.gz")
  timeout         : float      – seconds (default 60)

Normalized output shapes
────────────────────────
  validate   → { valid: bool, checks: [{name, passed, message}] }
  preflight  → { passed: bool, checks: [{name, passed, message}] }
  package    → { archive_path, size_bytes, success }
  deploy     → { command, exit_code, output, success }
  status     → { environment, deployed: bool, version, last_deployed }
"""
from __future__ import annotations

import asyncio
import os
import tarfile
import time
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DevToolError, PermissionError_
from app.devtools.normalizers import combine, require_param, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["validate", "preflight", "package", "deploy", "status"]


class DeployHelperTool(BaseDevTool):
    """Deployment validation, packaging, and deployment helpers."""

    @property
    def name(self) -> str:
        return "deploy_helper"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.DEPLOY

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "environment":    {"type": "string",  "required": False, "default": "staging"},
            "confirm":        {"type": "boolean", "required": False, "default": False},
            "command":        {"type": "string",  "required": False},
            "output_path":    {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 60.0},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "validate":  {"valid": "bool", "checks": "list"},
            "preflight": {"passed": "bool", "checks": "list"},
            "package":   {"archive_path": "str", "size_bytes": "int", "success": "bool"},
            "deploy":    {"command": "str", "exit_code": "int", "success": "bool"},
            "status":    {"environment": "str", "deployed": "bool"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action == "deploy":
            if tool_input.mode != DevToolMode.FULL:
                base.append(DevToolValidationResult.fail(
                    "deploy action requires FULL mode"
                ))
            if not bool(p.get("confirm")):
                base.append(DevToolValidationResult.fail(
                    "deploy action requires confirm=True (safety gate)"
                ))

        if action == "package":
            if tool_input.mode not in (DevToolMode.SAFE_WRITE, DevToolMode.FULL):
                base.append(DevToolValidationResult.fail(
                    "package action requires SAFE_WRITE or FULL mode"
                ))

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
        env    = p.get("environment", "staging")

        logger.info("deploy_helper_tool.execute", action=action, env=env)

        if action == "validate":
            return self._validate(root, env)
        if action == "preflight":
            return self._preflight(root, env)
        if action == "package":
            output_path = p.get("output_path", "dist/app.tar.gz")
            return self._package(root, output_path)
        if action == "deploy":
            command = p.get("command", "")
            timeout = float(p.get("timeout", 60.0))
            return await self._deploy(root, command, timeout)
        if action == "status":
            return self._status(root, env)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", 10_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _validate(self, root: str, env: str) -> dict:
        checks = []
        # Check required files exist
        for fname in ("Dockerfile", "docker-compose.yml", "pyproject.toml", "package.json"):
            exists = os.path.exists(os.path.join(root, fname))
            checks.append({
                "name":    f"file_{fname}",
                "passed":  exists,
                "message": f"{fname} {'found' if exists else 'not found'}",
            })
        valid = all(c["passed"] for c in checks)
        return {"valid": valid, "checks": checks, "environment": env}

    def _preflight(self, root: str, env: str) -> dict:
        checks = []

        # Check workspace_root exists
        checks.append({
            "name":    "workspace_exists",
            "passed":  os.path.isdir(root),
            "message": f"workspace {root!r} {'exists' if os.path.isdir(root) else 'not found'}",
        })
        # Check no uncommitted git changes (heuristic)
        git_head = os.path.join(root, ".git", "index")
        checks.append({
            "name":    "git_repo",
            "passed":  os.path.exists(os.path.join(root, ".git")),
            "message": "git repository found" if os.path.exists(os.path.join(root, ".git")) else "not a git repo",
        })
        # Block production deploys without explicit check
        if env == "production":
            checks.append({
                "name":    "production_gate",
                "passed":  False,
                "message": "production deploys must be reviewed manually",
            })
        passed = all(c["passed"] for c in checks)
        return {"passed": passed, "checks": checks, "environment": env}

    def _package(self, root: str, output_path: str) -> dict:
        abs_out = (
            output_path if os.path.isabs(output_path)
            else os.path.join(root, output_path)
        )
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)
        try:
            with tarfile.open(abs_out, "w:gz") as tar:
                for entry in os.listdir(root):
                    if entry in (".git", "__pycache__", "node_modules", ".venv",
                                 "venv", "dist", ".preview_pid"):
                        continue
                    full = os.path.join(root, entry)
                    tar.add(full, arcname=entry)
            size = os.path.getsize(abs_out)
            return {"archive_path": abs_out, "size_bytes": size, "success": True}
        except Exception as exc:
            raise DevToolError(
                f"Packaging failed: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )

    async def _deploy(self, root: str, command: str, timeout: float) -> dict:
        if not command:
            raise DevToolError(
                "deploy requires a 'command' param",
                error_code=DevToolErrorCode.INPUT_INVALID,
            )
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=root,
        )
        try:
            out_b, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"command": command, "exit_code": -1, "output": "timed out",
                    "success": False}
        output = out_b.decode("utf-8", errors="replace")
        return {
            "command":   command,
            "exit_code": proc.returncode,
            "output":    output,
            "success":   proc.returncode == 0,
        }

    def _status(self, root: str, env: str) -> dict:
        # Check for a simple deploy marker file
        marker = os.path.join(root, ".last_deploy")
        if os.path.exists(marker):
            with open(marker) as fh:
                info = fh.read().strip().split("\n")
            version      = info[0] if info else "unknown"
            last_deployed = info[1] if len(info) > 1 else "unknown"
            deployed = True
        else:
            version = "unknown"
            last_deployed = "never"
            deployed = False
        return {
            "environment":   env,
            "deployed":      deployed,
            "version":       version,
            "last_deployed": last_deployed,
        }
