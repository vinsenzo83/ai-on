"""
app/devtools/tools/git_tool.py
──────────────────────────────
Phase 16 — Stage A · Tool 6: Git Operations

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  status    – git status (read-only)
  diff      – git diff (read-only; staged, unstaged, or vs. commit)
  log       – git log (read-only)
  add       – git add path(s)  (SAFE_WRITE)
  commit    – git commit -m "message"  (SAFE_WRITE)
  push      – git push  (FULL mode required)
  checkout  – git checkout branch/file  (SAFE_WRITE)
  branch    – list, create, or delete branches  (mixed modes)

Safety model
────────────
  • All git operations run inside workspace_root.
  • Push requires FULL mode (external network write).
  • Add/commit/checkout/branch create require SAFE_WRITE.
  • Status/diff/log are READ_ONLY-compatible.
  • Branch deletion requires FULL mode.

Input params
────────────
  workspace_root : str       – repo root (required)
  paths          : list[str] – paths for add / checkout (optional)
  message        : str       – commit message (commit)
  remote         : str       – remote name (push, default "origin")
  branch         : str       – branch name (checkout, branch create/delete)
  target         : str       – "HEAD", ref, or file path (diff)
  staged         : bool      – diff staged changes (diff, default False)
  max_commits    : int       – log limit (log, default 20)
  action_detail  : str       – "list"|"create"|"delete" for branch action
  timeout        : float     – subprocess timeout (default 30 s)

Normalized output shapes
────────────────────────
  status   → { branch, staged: [str], unstaged: [str], untracked: [str] }
  diff     → { diff: str, files_changed: int, additions: int, removals: int }
  log      → { commits: [{hash, author, date, message}], total }
  add      → { paths_added: [str] }
  commit   → { hash, message, branch }
  push     → { remote, branch, output }
  checkout → { branch_or_file, output }
  branch   → { branches: [str] } | { created: str } | { deleted: str }
"""
from __future__ import annotations

import asyncio
import os
import re
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

_SUPPORTED_ACTIONS = [
    "status", "diff", "log", "add", "commit",
    "push", "checkout", "branch",
]

# Mode requirements per action
_ACTION_MODES: dict[str, str] = {
    "status":   DevToolMode.READ_ONLY,
    "diff":     DevToolMode.READ_ONLY,
    "log":      DevToolMode.READ_ONLY,
    "add":      DevToolMode.SAFE_WRITE,
    "commit":   DevToolMode.SAFE_WRITE,
    "checkout": DevToolMode.SAFE_WRITE,
    "branch":   DevToolMode.READ_ONLY,  # per action_detail for create/delete
    "push":     DevToolMode.FULL,
}

_MODE_RANK = {DevToolMode.READ_ONLY: 0, DevToolMode.SAFE_WRITE: 1, DevToolMode.FULL: 2}


class GitTool(BaseDevTool):
    """Git workflow operations confined to a workspace root."""

    @property
    def name(self) -> str:
        return "git"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.INSPECT

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "workspace_root": {"type": "string",  "required": True},
            "paths":          {"type": "array",   "required": False},
            "message":        {"type": "string",  "required": False},
            "remote":         {"type": "string",  "required": False, "default": "origin"},
            "branch":         {"type": "string",  "required": False},
            "target":         {"type": "string",  "required": False},
            "staged":         {"type": "boolean", "required": False, "default": False},
            "max_commits":    {"type": "integer", "required": False, "default": 20},
            "action_detail":  {"type": "string",  "required": False},
            "timeout":        {"type": "number",  "required": False, "default": 30.0},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "status":   {"branch": "str", "staged": ["str"], "unstaged": ["str"], "untracked": ["str"]},
            "diff":     {"diff": "str", "files_changed": "int", "additions": "int", "removals": "int"},
            "log":      {"commits": [{"hash": "str", "author": "str", "date": "str", "message": "str"}], "total": "int"},
            "add":      {"paths_added": ["str"]},
            "commit":   {"hash": "str", "message": "str", "branch": "str"},
            "push":     {"remote": "str", "branch": "str", "output": "str"},
            "checkout": {"branch_or_file": "str", "output": "str"},
            "branch":   {"branches": ["str"]},
        }

    def requires_mode(self) -> str:
        return DevToolMode.READ_ONLY

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base = [require_param(p, "workspace_root", param_type=str)]

        required_mode = _ACTION_MODES.get(action, DevToolMode.READ_ONLY)

        # branch create/delete require elevated modes
        if action == "branch":
            detail = p.get("action_detail", "list")
            if detail == "create":
                required_mode = DevToolMode.SAFE_WRITE
            elif detail == "delete":
                required_mode = DevToolMode.FULL

        actual_rank   = _MODE_RANK.get(tool_input.mode,   -1)
        required_rank = _MODE_RANK.get(required_mode, 0)
        if actual_rank < required_rank:
            base.append(DevToolValidationResult.fail(
                f"Action {action!r} requires mode={required_mode!r}; got {tool_input.mode!r}"
            ))

        if action == "commit":
            base.append(require_param(p, "message", param_type=str))

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
        timeout = float(p.get("timeout", 30.0))

        logger.info("git_tool.execute", action=action, root=root)

        if action == "status":
            return await self._git_status(root, timeout)
        if action == "diff":
            return await self._git_diff(root, p, timeout)
        if action == "log":
            return await self._git_log(root, p, timeout)
        if action == "add":
            return await self._git_add(root, p, timeout)
        if action == "commit":
            return await self._git_commit(root, p, timeout)
        if action == "push":
            return await self._git_push(root, p, timeout)
        if action == "checkout":
            return await self._git_checkout(root, p, timeout)
        if action == "branch":
            return await self._git_branch(root, p, timeout)

        raise DevToolError(f"Unknown action: {action!r}",
                           error_code=DevToolErrorCode.UNSUPPORTED_ACTION)

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "diff" in norm:
            norm["diff"] = truncate(norm.get("diff") or "", max_chars=50_000)
        if "output" in norm:
            norm["output"] = truncate(norm.get("output") or "", max_chars=20_000)
        return norm

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _git(
        self, args: list[str], cwd: str, timeout: float
    ) -> tuple[str, str, int]:
        """Run a git sub-command; return (stdout, stderr, returncode)."""
        cmd = ["git"] + args
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            raise DevToolError(
                f"git {args[0]!r} timed out after {timeout}s",
                error_code=DevToolErrorCode.TIMEOUT,
                retryable=True,
            )
        except FileNotFoundError:
            raise DevToolError(
                "git binary not found. Install git.",
                error_code=DevToolErrorCode.DEPENDENCY_ERROR,
            )
        return (
            stdout_b.decode("utf-8", errors="replace"),
            stderr_b.decode("utf-8", errors="replace"),
            proc.returncode,
        )

    async def _git_status(self, root: str, timeout: float) -> dict:
        stdout, _, _ = await self._git(["status", "--porcelain", "-b"], root, timeout)
        lines = stdout.splitlines()
        branch = "unknown"
        staged: list[str] = []
        unstaged: list[str] = []
        untracked: list[str] = []

        for line in lines:
            if line.startswith("##"):
                branch = line[3:].split("...")[0].strip()
                continue
            if len(line) < 2:
                continue
            x, y = line[0], line[1]
            path_part = line[3:]
            if x != " " and x != "?":
                staged.append(f"{x} {path_part}")
            if y == "M" or y == "D":
                unstaged.append(f"{y} {path_part}")
            if x == "?" and y == "?":
                untracked.append(path_part)

        return {
            "branch":    branch,
            "staged":    staged,
            "unstaged":  unstaged,
            "untracked": untracked,
        }

    async def _git_diff(self, root: str, p: dict, timeout: float) -> dict:
        args = ["diff"]
        if p.get("staged"):
            args.append("--cached")
        target = p.get("target")
        if target:
            args.append(target)

        stdout, _, _ = await self._git(args + ["--stat"], root, timeout)
        diff_text, _, _ = await self._git(args, root, timeout)

        files_changed = stdout.count("\n") - 1 if stdout else 0
        additions = sum(
            int(m.group(1)) for m in re.finditer(r"\+(\d+)", stdout)
        )
        removals = sum(
            int(m.group(1)) for m in re.finditer(r"-(\d+)", stdout)
        )
        return {
            "diff":          diff_text,
            "files_changed": max(0, files_changed),
            "additions":     additions,
            "removals":      removals,
        }

    async def _git_log(self, root: str, p: dict, timeout: float) -> dict:
        n = int(p.get("max_commits", 20))
        fmt = "%H\x1f%an\x1f%ad\x1f%s"
        stdout, _, _ = await self._git(
            ["log", f"-{n}", f"--pretty=format:{fmt}", "--date=short"],
            root, timeout,
        )
        commits = []
        for line in stdout.splitlines():
            parts = line.split("\x1f")
            if len(parts) == 4:
                commits.append({
                    "hash":    parts[0][:12],
                    "author":  parts[1],
                    "date":    parts[2],
                    "message": parts[3],
                })
        return {"commits": commits, "total": len(commits)}

    async def _git_add(self, root: str, p: dict, timeout: float) -> dict:
        paths = list(p.get("paths") or ["."])
        await self._git(["add"] + paths, root, timeout)
        return {"paths_added": paths}

    async def _git_commit(self, root: str, p: dict, timeout: float) -> dict:
        message = p["message"]
        stdout, stderr, rc = await self._git(
            ["commit", "-m", message], root, timeout
        )
        if rc != 0:
            raise DevToolError(
                f"git commit failed (rc={rc}): {stderr.strip()}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        # Extract short hash from "master abc1234] ..."
        hash_match = re.search(r"\[.*? ([0-9a-f]+)\]", stdout)
        commit_hash = hash_match.group(1) if hash_match else "unknown"

        branch_out, _, _ = await self._git(
            ["rev-parse", "--abbrev-ref", "HEAD"], root, timeout
        )
        return {
            "hash":    commit_hash,
            "message": message,
            "branch":  branch_out.strip(),
        }

    async def _git_push(self, root: str, p: dict, timeout: float) -> dict:
        remote = p.get("remote", "origin")
        branch = p.get("branch", "")
        args   = ["push", remote]
        if branch:
            args.append(branch)
        stdout, stderr, rc = await self._git(args, root, timeout)
        if rc != 0:
            raise DevToolError(
                f"git push failed (rc={rc}): {stderr.strip()}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        return {"remote": remote, "branch": branch, "output": (stdout + stderr).strip()}

    async def _git_checkout(self, root: str, p: dict, timeout: float) -> dict:
        branch_or_file = p.get("branch") or p.get("paths", [""])[0]
        if not branch_or_file:
            raise DevToolError(
                "checkout requires 'branch' or 'paths'",
                error_code=DevToolErrorCode.INPUT_INVALID,
            )
        stdout, stderr, rc = await self._git(
            ["checkout", branch_or_file], root, timeout
        )
        if rc != 0:
            raise DevToolError(
                f"git checkout failed (rc={rc}): {stderr.strip()}",
                error_code=DevToolErrorCode.ACTION_FAILED,
            )
        return {"branch_or_file": branch_or_file, "output": (stdout + stderr).strip()}

    async def _git_branch(self, root: str, p: dict, timeout: float) -> dict:
        detail = p.get("action_detail", "list")

        if detail == "list":
            stdout, _, _ = await self._git(["branch", "-a"], root, timeout)
            branches = [b.strip().lstrip("* ") for b in stdout.splitlines() if b.strip()]
            return {"branches": branches}

        if detail == "create":
            branch = p.get("branch", "")
            if not branch:
                raise DevToolError("branch create requires 'branch' param",
                                   error_code=DevToolErrorCode.INPUT_INVALID)
            _, stderr, rc = await self._git(["checkout", "-b", branch], root, timeout)
            if rc != 0:
                raise DevToolError(f"branch create failed: {stderr.strip()}",
                                   error_code=DevToolErrorCode.ACTION_FAILED)
            return {"created": branch}

        if detail == "delete":
            branch = p.get("branch", "")
            if not branch:
                raise DevToolError("branch delete requires 'branch' param",
                                   error_code=DevToolErrorCode.INPUT_INVALID)
            _, stderr, rc = await self._git(["branch", "-d", branch], root, timeout)
            if rc != 0:
                raise DevToolError(f"branch delete failed: {stderr.strip()}",
                                   error_code=DevToolErrorCode.ACTION_FAILED)
            return {"deleted": branch}

        raise DevToolError(
            f"Unknown branch action_detail: {detail!r}",
            error_code=DevToolErrorCode.INPUT_INVALID,
        )
