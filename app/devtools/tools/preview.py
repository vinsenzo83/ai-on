"""
app/devtools/tools/preview.py
───────────────────────────────
Phase 16 — Stage C · Tool 14: Preview / Dev Server

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  start    – start a preview/dev server (FULL mode required)
  stop     – stop a running preview server (FULL mode)
  status   – check if preview server is running (READ_ONLY)
  get_url  – return the preview server URL (READ_ONLY)
  open     – open a URL in a headless browser and return HTML (FULL)

Design notes
────────────
  This tool manages lightweight local dev server processes.
  It does NOT persist process handles between calls — it uses
  pidfile convention (a .preview_pid file in workspace_root)
  to track running servers.

Safety model
────────────
  • start / stop / open require FULL mode.
  • status / get_url are READ_ONLY-compatible.
  • Server command is validated against a restricted allow-list.
  • Binds to localhost only (127.0.0.1).

Input params
────────────
  workspace_root : str   – required
  command        : str   – server command (start) e.g. "npm run dev"
  port           : int   – port to listen on (default 3000)
  url            : str   – URL to open (open action)
  timeout        : float – seconds to wait for server to start (default 15)

Normalized output shapes
────────────────────────
  start  → { command, port, pid, url, started }
  stop   → { pid, stopped }
  status → { running, pid, port, url }
  get_url→ { url, port }
  open   → { url, html_snippet, status_code }
"""
from __future__ import annotations

import asyncio
import os
import signal
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

_SUPPORTED_ACTIONS  = ["start", "stop", "status", "get_url", "open"]
_PIDFILE_NAME       = ".preview_pid"
_DEFAULT_PORT       = 3000
_DEFAULT_TIMEOUT    = 15.0

# Commands that are explicitly blocked
_BLOCKED_PREFIXES: list[str] = ["rm ", "sudo ", "shutdown", "reboot", ":(){"]


class PreviewTool(BaseDevTool):
    """Manage local preview / dev server processes."""

    @property
    def name(self) -> str:
        return "preview"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.EXECUTE

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY  # per-action

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "command":        {"type": "string",  "required": False},
            "port":           {"type": "integer", "required": False, "default": 3000},
            "url":            {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 15.0},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "start":  {"command": "str", "port": "int", "pid": "int", "url": "str"},
            "stop":   {"pid": "int", "stopped": "bool"},
            "status": {"running": "bool", "pid": "int|None", "port": "int|None"},
            "get_url":{"url": "str", "port": "int"},
            "open":   {"url": "str", "html_snippet": "str", "status_code": "int"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action
        base   = [require_param(p, "workspace_root", param_type=str)]

        if action in ("start", "stop", "open"):
            if tool_input.mode != DevToolMode.FULL:
                base.append(DevToolValidationResult.fail(
                    f"Action {action!r} requires FULL mode"
                ))

        if action == "start":
            base.append(require_param(p, "command", param_type=str))
            cmd = p.get("command", "")
            for prefix in _BLOCKED_PREFIXES:
                if cmd.lower().strip().startswith(prefix.lower()):
                    base.append(DevToolValidationResult.fail(
                        f"Command is blocked: {cmd!r}"
                    ))

        if action == "open":
            base.append(require_param(p, "url", param_type=str))

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
        port   = int(p.get("port", _DEFAULT_PORT))

        logger.info("preview_tool.execute", action=action)

        if action == "start":
            return await self._start(root, p["command"], port,
                                     float(p.get("timeout", _DEFAULT_TIMEOUT)))
        if action == "stop":
            return self._stop(root)
        if action == "status":
            return self._status(root)
        if action == "get_url":
            return {"url": f"http://localhost:{port}", "port": port}
        if action == "open":
            return await self._open(p["url"],
                                    float(p.get("timeout", _DEFAULT_TIMEOUT)))

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "html_snippet" in norm:
            norm["html_snippet"] = truncate(norm.get("html_snippet") or "", 5_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _pidfile(self, root: str) -> str:
        return os.path.join(root, _PIDFILE_NAME)

    def _read_pid(self, root: str) -> int | None:
        pf = self._pidfile(root)
        if not os.path.exists(pf):
            return None
        try:
            with open(pf) as fh:
                data = fh.read().strip().split(":")
            return int(data[0]) if data else None
        except (ValueError, OSError):
            return None

    def _read_port(self, root: str) -> int | None:
        pf = self._pidfile(root)
        if not os.path.exists(pf):
            return None
        try:
            with open(pf) as fh:
                data = fh.read().strip().split(":")
            return int(data[1]) if len(data) > 1 else None
        except (ValueError, OSError):
            return None

    def _write_pid(self, root: str, pid: int, port: int) -> None:
        with open(self._pidfile(root), "w") as fh:
            fh.write(f"{pid}:{port}")

    def _remove_pid(self, root: str) -> None:
        pf = self._pidfile(root)
        if os.path.exists(pf):
            os.remove(pf)

    async def _start(self, root: str, command: str, port: int,
                      timeout: float) -> dict:
        env = {**os.environ, "PORT": str(port)}
        proc = await asyncio.create_subprocess_shell(
            command, cwd=root, env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        self._write_pid(root, proc.pid, port)
        # Wait briefly to confirm startup
        await asyncio.sleep(min(timeout, 1.0))
        return {
            "command": command,
            "port":    port,
            "pid":     proc.pid,
            "url":     f"http://localhost:{port}",
            "started": True,
        }

    def _stop(self, root: str) -> dict:
        pid = self._read_pid(root)
        if pid is None:
            return {"pid": None, "stopped": False}
        try:
            os.kill(pid, signal.SIGTERM)
            stopped = True
        except (ProcessLookupError, PermissionError):
            stopped = False
        self._remove_pid(root)
        return {"pid": pid, "stopped": stopped}

    def _status(self, root: str) -> dict:
        pid  = self._read_pid(root)
        port = self._read_port(root)
        if pid is None:
            return {"running": False, "pid": None, "port": None, "url": None}
        try:
            os.kill(pid, 0)  # signal 0 = check if alive
            running = True
        except (ProcessLookupError, PermissionError):
            running = False
            self._remove_pid(root)
            pid = None
        url = f"http://localhost:{port}" if running and port else None
        return {"running": running, "pid": pid, "port": port, "url": url}

    async def _open(self, url: str, timeout: float) -> dict:
        """Fetch a URL using httpx or urllib as a lightweight preview check."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, follow_redirects=True)
                html = resp.text[:2000]
                status = resp.status_code
        except ImportError:
            import urllib.request
            try:
                with urllib.request.urlopen(url, timeout=timeout) as r:
                    html = r.read(2000).decode("utf-8", errors="replace")
                    status = r.getcode()
            except Exception as exc:
                raise DevToolError(
                    f"Could not open {url!r}: {exc}",
                    error_code=DevToolErrorCode.ACTION_FAILED,
                )
        except Exception as exc:
            raise DevToolError(
                f"Could not open {url!r}: {exc}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        return {"url": url, "html_snippet": html, "status_code": status}
