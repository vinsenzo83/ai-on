"""
app/devtools/tools/env_config.py
──────────────────────────────────
Phase 16 — Stage B · Tool 12: Environment / Config Inspection

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  read_env    – read environment variables (with redaction of secrets)
  list_configs – list config files found in workspace
  read_config  – read a specific config file (JSON / YAML / TOML / .env)
  validate_env – check that required env vars are set

Safety model
────────────
  • All actions are READ_ONLY-compatible.
  • Sensitive key patterns (PASSWORD, SECRET, TOKEN, KEY, API_KEY, AUTH)
    have their values redacted to "***REDACTED***".
  • Path must stay inside workspace_root.

Input params
────────────
  workspace_root  : str       – required
  path            : str       – relative config file path (read_config)
  required_vars   : list[str] – env vars to check (validate_env)
  include_redacted: bool      – include redacted secrets in output (default False)

Normalized output shapes
────────────────────────
  read_env    → { vars: {key: value|"***REDACTED***"}, total, redacted_count }
  list_configs → { config_files: [{path, type}], total }
  read_config  → { path, type, data: dict, raw: str }
  validate_env → { missing: [str], present: [str], all_present: bool }
"""
from __future__ import annotations

import os
import re
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import PathNotFoundError, PathUnsafeError, DevToolError
from app.devtools.normalizers import combine, require_param
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["read_env", "list_configs", "read_config", "validate_env"]

_SENSITIVE_RE = re.compile(
    r"(PASSWORD|SECRET|TOKEN|KEY|API_KEY|AUTH|CRED|PRIVATE|PASSWD)",
    re.IGNORECASE,
)

_CONFIG_EXTENSIONS = {
    ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".env": "dotenv", ".cfg": "ini",
    ".ini": "ini", ".conf": "text",
}

_CONFIG_FILENAMES = {
    ".env", ".env.local", ".env.production", ".env.development",
    "config.json", "config.yaml", "config.yml",
    "settings.json", "settings.yaml",
    "pyproject.toml", "setup.cfg",
}


class EnvConfigTool(BaseDevTool):
    """Inspect environment variables and configuration files."""

    @property
    def name(self) -> str:
        return "env_config"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.READ

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root":   {"type": "string",  "required": True},
            "path":             {"type": "string",  "required": False},
            "required_vars":    {"type": "array",   "required": False},
            "include_redacted": {"type": "boolean", "required": False, "default": False},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "read_env":     {"vars": "dict", "total": "int", "redacted_count": "int"},
            "list_configs": {"config_files": "list", "total": "int"},
            "read_config":  {"path": "str", "type": "str", "data": "dict", "raw": "str"},
            "validate_env": {"missing": "list", "present": "list", "all_present": "bool"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p    = tool_input.params
        base = [require_param(p, "workspace_root", param_type=str)]
        if tool_input.action == "read_config":
            base.append(require_param(p, "path", param_type=str))
        if tool_input.action == "validate_env":
            base.append(require_param(p, "required_vars", param_type=list))
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

        logger.info("env_config_tool.execute", action=action)

        if action == "read_env":
            include = bool(p.get("include_redacted", False))
            return self._read_env(include)

        if action == "list_configs":
            return self._list_configs(root)

        if action == "read_config":
            abs_path = self._safe_resolve(root, p["path"])
            return self._read_config(abs_path)

        if action == "validate_env":
            return self._validate_env(list(p["required_vars"]))

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        return dict(raw)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _safe_resolve(self, root: str, path: str) -> str:
        if os.path.isabs(path):
            abs_path = os.path.realpath(path)
        else:
            abs_path = os.path.realpath(os.path.join(root, path))
        abs_root = os.path.realpath(root)
        if not (abs_path == abs_root or abs_path.startswith(abs_root + os.sep)):
            raise PathUnsafeError(path)
        return abs_path

    def _redact(self, key: str, value: str) -> str:
        if _SENSITIVE_RE.search(key):
            return "***REDACTED***"
        return value

    def _read_env(self, include_redacted: bool) -> dict:
        env = os.environ.copy()
        result: dict[str, str] = {}
        redacted = 0
        for k, v in sorted(env.items()):
            rv = self._redact(k, v)
            if rv != v:
                redacted += 1
                if not include_redacted:
                    rv = "***REDACTED***"
            result[k] = rv
        return {"vars": result, "total": len(result), "redacted_count": redacted}

    def _list_configs(self, root: str) -> dict:
        found = []
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden dirs and common non-config dirs
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith(".")
                and d not in ("node_modules", "__pycache__", ".git", "venv", ".venv")
            ]
            for fname in filenames:
                ext  = os.path.splitext(fname)[1].lower()
                typ  = _CONFIG_EXTENSIONS.get(ext)
                name = fname.lower()
                if typ or name in _CONFIG_FILENAMES or name.startswith(".env"):
                    rel = os.path.relpath(os.path.join(dirpath, fname), root)
                    found.append({
                        "path": rel,
                        "type": typ or "text",
                    })
        return {"config_files": found, "total": len(found)}

    def _read_config(self, abs_path: str) -> dict:
        if not os.path.isfile(abs_path):
            raise PathNotFoundError(abs_path)
        ext = os.path.splitext(abs_path)[1].lower()
        with open(abs_path, "r", errors="replace") as fh:
            raw = fh.read()

        data: dict = {}
        cfg_type = _CONFIG_EXTENSIONS.get(ext, "text")

        try:
            if cfg_type == "json":
                import json
                data = json.loads(raw)
            elif cfg_type == "yaml":
                try:
                    import yaml
                    data = yaml.safe_load(raw) or {}
                except ImportError:
                    data = {}
            elif cfg_type == "toml":
                try:
                    import tomllib
                    data = tomllib.loads(raw)
                except ImportError:
                    try:
                        import tomli
                        data = tomli.loads(raw)
                    except ImportError:
                        data = {}
            elif cfg_type == "dotenv":
                data = {}
                for line in raw.splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        data[k.strip()] = self._redact(k.strip(), v.strip().strip('"\''))
        except Exception as exc:
            logger.warning("env_config_tool.parse_error", path=abs_path, exc=str(exc))
            data = {}

        return {"path": abs_path, "type": cfg_type, "data": data, "raw": raw[:5_000]}

    def _validate_env(self, required_vars: list[str]) -> dict:
        missing = [v for v in required_vars if v not in os.environ]
        present = [v for v in required_vars if v in os.environ]
        return {
            "missing":     missing,
            "present":     present,
            "all_present": len(missing) == 0,
        }
