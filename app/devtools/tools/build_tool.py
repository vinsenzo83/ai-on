"""
app/devtools/tools/build_tool.py
──────────────────────────────────
Phase 16 — Stage B · Tool 11: Build Tool

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  build   – run the build command (make / npm run build / python setup.py)
  clean   – remove build artefacts
  info    – show build system info (detected tool, config files)
  install – install project dependencies from lock file

Safety model
────────────
  • All actions require FULL mode (build executes arbitrary code).
  • build / install / clean are EXECUTE ops.
  • info is READ_ONLY-compatible but kept under FULL for consistency.

Input params
────────────
  workspace_root : str       – required
  builder        : str       – "auto" | "make" | "npm" | "python" | "cargo" | "gradle"
  target         : str       – specific build target / script (optional)
  timeout        : float     – seconds (default 120)
  env_extra      : dict      – extra environment variables
  extra_args     : list[str]

Normalized output shapes
────────────────────────
  build / install / clean →
    { builder, target, stdout, stderr, exit_code, success, duration_s }
  info →
    { builder, config_files: [str], detected_targets: [str] }
"""
from __future__ import annotations

import asyncio
import os
import time
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

_SUPPORTED_ACTIONS = ["build", "clean", "info", "install"]
_DEFAULT_TIMEOUT   = 120.0

# Builder detection heuristics: file pattern → builder name
_DETECT_MAP: list[tuple[str, str]] = [
    ("Makefile",        "make"),
    ("package.json",    "npm"),
    ("pyproject.toml",  "python"),
    ("setup.py",        "python"),
    ("Cargo.toml",      "cargo"),
    ("build.gradle",    "gradle"),
    ("pom.xml",         "maven"),
]


class BuildTool(BaseDevTool):
    """Run project builds (make, npm, python, cargo, gradle) inside workspace."""

    @property
    def name(self) -> str:
        return "build_tool"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.FULL

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "builder":        {"type": "string",  "required": False, "default": "auto"},
            "target":         {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 120.0},
            "env_extra":      {"type": "object",  "required": False},
            "extra_args":     {"type": "array",   "required": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "build":   {"builder": "str", "stdout": "str", "stderr": "str",
                        "exit_code": "int", "success": "bool"},
            "info":    {"builder": "str", "config_files": "list", "detected_targets": "list"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p    = tool_input.params
        base = [require_param(p, "workspace_root", param_type=str)]

        if tool_input.mode != DevToolMode.FULL:
            base.append(DevToolValidationResult.fail(
                "BuildTool requires FULL mode"
            ))
        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p        = tool_input.params
        action   = tool_input.action
        root     = p["workspace_root"]
        builder  = p.get("builder", "auto")
        target   = p.get("target", "")
        timeout  = float(p.get("timeout", _DEFAULT_TIMEOUT))
        extra    = list(p.get("extra_args") or [])
        env_extra = dict(p.get("env_extra") or {})

        if builder == "auto":
            builder = self._detect_builder(root)

        logger.info("build_tool.execute", action=action, builder=builder)

        if action == "info":
            return self._info(root, builder)

        cmd = self._build_cmd(builder, action, target, extra)
        return await self._run(cmd, root, timeout, env_extra, builder, target)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        for key in ("stdout", "stderr"):
            if key in norm:
                norm[key] = truncate(norm.get(key) or "", 20_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _detect_builder(self, root: str) -> str:
        for filename, builder in _DETECT_MAP:
            if os.path.exists(os.path.join(root, filename)):
                return builder
        return "make"

    def _build_cmd(self, builder: str, action: str, target: str,
                   extra: list[str]) -> list[str]:
        if builder == "make":
            cmd = ["make"]
            if action == "clean":
                cmd.append("clean")
            elif target:
                cmd.append(target)
            return cmd + extra
        if builder == "npm":
            if action == "install":
                return ["npm", "install"] + extra
            if action == "clean":
                return ["npm", "run", "clean"] + extra
            return ["npm", "run", target or "build"] + extra
        if builder == "python":
            if action == "install":
                return ["pip", "install", "-e", "."] + extra
            return ["python", "-m", "build"] + extra
        if builder == "cargo":
            if action == "clean":
                return ["cargo", "clean"] + extra
            return ["cargo", "build"] + extra
        if builder == "gradle":
            return ["./gradlew", target or "build"] + extra
        if builder == "maven":
            return ["mvn", "package"] + extra
        return [builder, target or "build"] + extra

    async def _run(self, cmd: list[str], cwd: str, timeout: float,
                   env_extra: dict, builder: str, target: str) -> dict:
        env = {**os.environ, **env_extra}
        t0  = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
        try:
            out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"builder": builder, "target": target,
                    "stdout": "", "stderr": "timed out",
                    "exit_code": -1, "success": False,
                    "duration_s": round(time.monotonic() - t0, 3)}

        duration = round(time.monotonic() - t0, 3)
        return {
            "builder":    builder,
            "target":     target,
            "stdout":     out_b.decode("utf-8", errors="replace"),
            "stderr":     err_b.decode("utf-8", errors="replace"),
            "exit_code":  proc.returncode,
            "success":    proc.returncode == 0,
            "duration_s": duration,
        }

    def _info(self, root: str, builder: str) -> dict:
        config_files = []
        for filename, b in _DETECT_MAP:
            if os.path.exists(os.path.join(root, filename)):
                config_files.append(filename)
        # Simple target discovery for Makefile
        detected = []
        makefile = os.path.join(root, "Makefile")
        if os.path.exists(makefile):
            import re
            with open(makefile, "r", errors="replace") as fh:
                for line in fh:
                    m = re.match(r"^([a-zA-Z_-]+)\s*:", line)
                    if m and not m.group(1).startswith("."):
                        detected.append(m.group(1))
        return {"builder": builder, "config_files": config_files,
                "detected_targets": detected}
