"""
app/devtools/tools/migration.py
──────────────────────────────────
Phase 16 — Stage B · Tool 13: Database Migration Tool

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  status     – show current migration status (read-only)
  list       – list all available migrations
  apply      – apply pending migrations (FULL mode required)
  rollback   – roll back the last N migrations (FULL mode required)
  create     – create a new blank migration file (SAFE_WRITE)

Safety model
────────────
  • status / list are READ_ONLY-compatible.
  • apply / rollback require FULL mode.
  • create requires SAFE_WRITE mode.
  • Tool auto-detects: Alembic (alembic.ini) → Django (manage.py) → Flyway.

Input params
────────────
  workspace_root : str   – required
  framework      : str   – "auto" | "alembic" | "django" | "flyway"
  steps          : int   – rollback steps (rollback, default 1)
  name           : str   – migration name (create)
  timeout        : float – seconds (default 60)

Normalized output shapes
────────────────────────
  status   → { framework, current_revision, pending: [str], output }
  list     → { framework, migrations: [str], total }
  apply    → { framework, applied: int, output, success }
  rollback → { framework, rolled_back: int, output, success }
  create   → { framework, file_path, name }
"""
from __future__ import annotations

import asyncio
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

_SUPPORTED_ACTIONS = ["status", "list", "apply", "rollback", "create"]
_FULL_ACTIONS      = {"apply", "rollback"}
_WRITE_ACTIONS     = {"create"}


class MigrationTool(BaseDevTool):
    """Manage database migrations for Alembic, Django, and Flyway projects."""

    @property
    def name(self) -> str:
        return "migration"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "framework":      {"type": "string",  "required": False, "default": "auto"},
            "steps":          {"type": "integer", "required": False, "default": 1},
            "name":           {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 60.0},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "status":   {"framework": "str", "current_revision": "str", "pending": "list"},
            "list":     {"framework": "str", "migrations": "list", "total": "int"},
            "apply":    {"framework": "str", "applied": "int", "success": "bool"},
            "rollback": {"framework": "str", "rolled_back": "int", "success": "bool"},
            "create":   {"framework": "str", "file_path": "str", "name": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in _FULL_ACTIONS and tool_input.mode != DevToolMode.FULL:
            base.append(DevToolValidationResult.fail(
                f"Action {action!r} requires FULL mode"
            ))
        if action in _WRITE_ACTIONS and tool_input.mode not in (
            DevToolMode.SAFE_WRITE, DevToolMode.FULL
        ):
            base.append(DevToolValidationResult.fail(
                f"Action {action!r} requires SAFE_WRITE or FULL mode"
            ))
        if action == "create":
            base.append(require_param(p, "name", param_type=str))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p         = tool_input.params
        action    = tool_input.action
        root      = p["workspace_root"]
        framework = p.get("framework", "auto")
        timeout   = float(p.get("timeout", 60.0))

        if framework == "auto":
            framework = self._detect_framework(root)

        logger.info("migration_tool.execute", action=action, framework=framework)

        if action == "status":
            return await self._status(framework, root, timeout)
        if action == "list":
            return await self._list(framework, root, timeout)
        if action == "apply":
            return await self._apply(framework, root, timeout)
        if action == "rollback":
            steps = int(p.get("steps", 1))
            return await self._rollback(framework, root, steps, timeout)
        if action == "create":
            return await self._create(framework, root, p["name"])

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", 10_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _detect_framework(self, root: str) -> str:
        if os.path.exists(os.path.join(root, "alembic.ini")):
            return "alembic"
        if os.path.exists(os.path.join(root, "manage.py")):
            return "django"
        if os.path.exists(os.path.join(root, "flyway.conf")):
            return "flyway"
        return "alembic"  # default

    async def _run(self, cmd: list[str], cwd: str, timeout: float) -> tuple[str, int]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )
        try:
            out_b, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ("timed out", -1)
        return (out_b.decode("utf-8", errors="replace"), proc.returncode)

    def _cmd(self, framework: str, *args: str) -> list[str]:
        if framework == "alembic":
            return ["alembic"] + list(args)
        if framework == "django":
            return ["python", "manage.py"] + list(args)
        if framework == "flyway":
            return ["flyway"] + list(args)
        return ["alembic"] + list(args)

    async def _status(self, framework: str, root: str, timeout: float) -> dict:
        if framework == "alembic":
            out, rc = await self._run(self._cmd(framework, "current"), root, timeout)
            revision = out.strip().split("\n")[0] if out.strip() else "unknown"
            head_out, _ = await self._run(self._cmd(framework, "heads"), root, timeout)
            pending = [l.strip() for l in head_out.splitlines() if l.strip()]
        elif framework == "django":
            out, rc = await self._run(
                self._cmd(framework, "showmigrations", "--list"), root, timeout
            )
            revision = "see output"
            pending = [l.strip() for l in out.splitlines() if "[ ]" in l]
        else:
            out, rc = await self._run(self._cmd(framework, "info"), root, timeout)
            revision = "see output"
            pending = []
        return {
            "framework":        framework,
            "current_revision": revision,
            "pending":          pending,
            "output":           out,
        }

    async def _list(self, framework: str, root: str, timeout: float) -> dict:
        if framework == "alembic":
            out, _ = await self._run(self._cmd(framework, "history", "--verbose"), root, timeout)
        elif framework == "django":
            out, _ = await self._run(
                self._cmd(framework, "showmigrations"), root, timeout
            )
        else:
            out, _ = await self._run(self._cmd(framework, "info"), root, timeout)
        migrations = [l.strip() for l in out.splitlines() if l.strip()]
        return {"framework": framework, "migrations": migrations, "total": len(migrations)}

    async def _apply(self, framework: str, root: str, timeout: float) -> dict:
        if framework == "alembic":
            out, rc = await self._run(self._cmd(framework, "upgrade", "head"), root, timeout)
        elif framework == "django":
            out, rc = await self._run(self._cmd(framework, "migrate"), root, timeout)
        else:
            out, rc = await self._run(self._cmd(framework, "migrate"), root, timeout)
        applied = len(re.findall(r"applying|Applying|Running", out))
        return {"framework": framework, "applied": applied,
                "output": out, "success": rc == 0}

    async def _rollback(self, framework: str, root: str, steps: int,
                         timeout: float) -> dict:
        if framework == "alembic":
            target = f"-{steps}"
            out, rc = await self._run(self._cmd(framework, "downgrade", target), root, timeout)
        elif framework == "django":
            out, rc = await self._run(
                self._cmd(framework, "migrate", "--fake", "zero"), root, timeout
            )
        else:
            out, rc = await self._run(self._cmd(framework, "undo"), root, timeout)
        return {"framework": framework, "rolled_back": steps,
                "output": out, "success": rc == 0}

    async def _create(self, framework: str, root: str, name: str) -> dict:
        import time, datetime
        if framework == "alembic":
            out, rc = await asyncio.create_subprocess_exec(
                "alembic", "revision", "--autogenerate", "-m", name,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                cwd=root,
            )
            out_b, _ = await out.communicate()  # type: ignore[attr-defined]
            output   = out_b.decode("utf-8", errors="replace")
            # parse file path from output
            m = re.search(r"(versions/[^\s]+\.py)", output)
            file_path = m.group(1) if m else f"versions/{name}.py"
        elif framework == "django":
            proc = await asyncio.create_subprocess_exec(
                "python", "manage.py", "makemigrations", "--name", name,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                cwd=root,
            )
            out_b, _ = await proc.communicate()
            file_path = f"migrations/{name}.py"
        else:
            file_path = f"sql/V{int(time.time())}__{name}.sql"
        return {"framework": framework, "file_path": file_path, "name": name}
