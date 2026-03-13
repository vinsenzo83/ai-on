"""
app/devtools/tools/dependency.py
──────────────────────────────────
Phase 16 — Stage B · Tool 9: Dependency Management

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  list_installed  – list installed packages (pip list / npm list)
  check_outdated  – find outdated packages
  install         – pip/npm install package(s) (FULL mode required)
  uninstall       – pip/npm uninstall package(s) (FULL mode required)
  audit           – security audit (pip-audit / npm audit)

Safety model
────────────
  • install / uninstall require FULL mode.
  • list_installed / check_outdated / audit are READ_ONLY-compatible.
  • Package manager is auto-detected from workspace (pyproject.toml /
    requirements.txt → pip; package.json → npm).

Input params
────────────
  workspace_root : str       – required
  manager        : str       – "pip" | "npm" (optional, auto-detected)
  packages       : list[str] – for install / uninstall
  timeout        : float     – seconds (default 60)
  extra_args     : list[str]

Normalized output shapes
────────────────────────
  list_installed  → { manager, packages: [{name, version}], total }
  check_outdated  → { manager, outdated: [{name, current, latest}], total }
  install         → { manager, installed: [str], output }
  uninstall       → { manager, uninstalled: [str], output }
  audit           → { manager, vulnerabilities: int, output }
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DevToolError
from app.devtools.normalizers import combine, require_param, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["list_installed", "check_outdated", "install", "uninstall", "audit"]
_WRITE_ACTIONS     = {"install", "uninstall"}


class DependencyTool(BaseDevTool):
    """Dependency management for pip and npm projects."""

    @property
    def name(self) -> str:
        return "dependency"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "manager":        {"type": "string",  "required": False},
            "packages":       {"type": "array",   "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 60.0},
            "extra_args":     {"type": "array",   "required": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "list_installed": {"manager": "str", "packages": "list", "total": "int"},
            "check_outdated": {"manager": "str", "outdated": "list", "total": "int"},
            "install":        {"manager": "str", "installed": "list", "output": "str"},
            "uninstall":      {"manager": "str", "uninstalled": "list", "output": "str"},
            "audit":          {"manager": "str", "vulnerabilities": "int", "output": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in _WRITE_ACTIONS:
            if tool_input.mode != DevToolMode.FULL:
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires FULL mode"
                ))
            if not p.get("packages"):
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires 'packages' list"
                ))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p       = tool_input.params
        action  = tool_input.action
        root    = p["workspace_root"]
        timeout = float(p.get("timeout", 60.0))
        extra   = list(p.get("extra_args") or [])
        mgr     = p.get("manager") or self._detect_manager(root)

        logger.info("dependency_tool.execute", action=action, manager=mgr)

        if action == "list_installed":
            return await self._list_installed(mgr, root, timeout)
        if action == "check_outdated":
            return await self._check_outdated(mgr, root, timeout)
        if action == "install":
            return await self._install(mgr, root, list(p["packages"]), timeout, extra)
        if action == "uninstall":
            return await self._uninstall(mgr, root, list(p["packages"]), timeout, extra)
        if action == "audit":
            return await self._audit(mgr, root, timeout)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", 20_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _detect_manager(self, root: str) -> str:
        if os.path.exists(os.path.join(root, "package.json")):
            return "npm"
        return "pip"

    async def _run(self, cmd: list[str], cwd: str,
                   timeout: float) -> tuple[str, str, int]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ("", "timeout", -1)
        return (
            out_b.decode("utf-8", errors="replace"),
            err_b.decode("utf-8", errors="replace"),
            proc.returncode,
        )

    async def _list_installed(self, mgr: str, cwd: str, timeout: float) -> dict:
        if mgr == "pip":
            out, _, _ = await self._run(
                ["pip", "list", "--format=json"], cwd, timeout
            )
            try:
                raw = json.loads(out)
                packages = [{"name": p["name"], "version": p["version"]} for p in raw]
            except Exception:
                packages = self._parse_pip_list(out)
        else:
            out, _, _ = await self._run(["npm", "list", "--depth=0"], cwd, timeout)
            packages = self._parse_npm_list(out)
        return {"manager": mgr, "packages": packages, "total": len(packages)}

    async def _check_outdated(self, mgr: str, cwd: str, timeout: float) -> dict:
        if mgr == "pip":
            out, _, _ = await self._run(
                ["pip", "list", "--outdated", "--format=json"], cwd, timeout
            )
            try:
                raw = json.loads(out)
                outdated = [
                    {"name": p["name"], "current": p["version"], "latest": p["latest_version"]}
                    for p in raw
                ]
            except Exception:
                outdated = []
        else:
            out, _, _ = await self._run(["npm", "outdated", "--json"], cwd, timeout)
            try:
                raw = json.loads(out)
                outdated = [
                    {"name": k, "current": v.get("current", "?"),
                     "latest": v.get("latest", "?")}
                    for k, v in raw.items()
                ]
            except Exception:
                outdated = []
        return {"manager": mgr, "outdated": outdated, "total": len(outdated)}

    async def _install(self, mgr: str, cwd: str, packages: list[str],
                       timeout: float, extra: list[str]) -> dict:
        cmd = (["pip", "install"] if mgr == "pip" else ["npm", "install"])
        cmd += packages + extra
        out, err, _ = await self._run(cmd, cwd, timeout)
        return {"manager": mgr, "installed": packages, "output": (out + err).strip()}

    async def _uninstall(self, mgr: str, cwd: str, packages: list[str],
                          timeout: float, extra: list[str]) -> dict:
        if mgr == "pip":
            cmd = ["pip", "uninstall", "-y"] + packages + extra
        else:
            cmd = ["npm", "uninstall"] + packages + extra
        out, err, _ = await self._run(cmd, cwd, timeout)
        return {"manager": mgr, "uninstalled": packages, "output": (out + err).strip()}

    async def _audit(self, mgr: str, cwd: str, timeout: float) -> dict:
        if mgr == "pip":
            out, err, _ = await self._run(["pip-audit"], cwd, timeout)
        else:
            out, err, _ = await self._run(["npm", "audit"], cwd, timeout)
        combined = (out + err).strip()
        # heuristic vuln count
        count = len(re.findall(r"vulnerabilit", combined, re.IGNORECASE))
        return {"manager": mgr, "vulnerabilities": count, "output": combined}

    def _parse_pip_list(self, text: str) -> list[dict]:
        result = []
        for line in text.splitlines()[2:]:  # skip header lines
            parts = line.split()
            if len(parts) >= 2:
                result.append({"name": parts[0], "version": parts[1]})
        return result

    def _parse_npm_list(self, text: str) -> list[dict]:
        result = []
        for line in text.splitlines():
            m = re.search(r"─+\s+(.+?)@([\d.]+)", line)
            if m:
                result.append({"name": m.group(1), "version": m.group(2)})
        return result
