"""
app/routers/devtools.py
────────────────────────
Phase 16 — Developer Assist Tooling HTTP API layer.

Routes
──────
GET  /devtools/                          registry health + tool list
GET  /devtools/{tool_name}               tool schema (actions, op_type, mode req)
POST /devtools/{tool_name}/{action}      execute a devtool action
POST /devtools/batch                     execute multiple devtool actions

Auth & Mode gate
────────────────
• All routes require a valid Bearer JWT.
• Mode is supplied by the caller in the request body.
• READ_ONLY  → VIEWER  role minimum
• SAFE_WRITE → OPERATOR role minimum
• FULL       → ADMIN   role minimum

The DevToolExecutor enforces mode internally as well; the router adds a
coarse HTTP-level pre-check to return 403 before the execution pipeline.

Design rules
────────────
• Router is a pure HTTP adapter — execution delegates to DevToolExecutor.
• workspace_root is a required param for most tools; validated by each tool.
• DevToolResult is always returned; success=False on any error.
• No DB calls in this router.
"""
from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.devtools.executor import DevToolExecutor
from app.devtools.registry import get_registry
from app.devtools.types import DevToolInput, DevToolMode
from app.services.auth_service import CurrentUser, get_current_user, require_role

logger = structlog.get_logger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Mode → minimum role mapping
# ─────────────────────────────────────────────────────────────────────────────

_MODE_ROLE: dict[str, str] = {
    DevToolMode.READ_ONLY:  "VIEWER",
    DevToolMode.SAFE_WRITE: "OPERATOR",
    DevToolMode.FULL:       "ADMIN",
}
_ROLE_RANK: dict[str, int] = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}


def _check_mode_role(mode: str, user: CurrentUser) -> None:
    """Raise HTTP 403 if user's role is insufficient for the requested mode."""
    required = _MODE_ROLE.get(mode, "ADMIN")
    user_rank    = _ROLE_RANK.get(user.role, -1)
    required_rank = _ROLE_RANK.get(required, 99)
    if user_rank < required_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Mode '{mode}' requires role '{required}'; "
                f"your role is '{user.role}'."
            ),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class DevToolActionRequest(BaseModel):
    """Request body for POST /devtools/{tool_name}/{action}."""

    params: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Action-specific parameters. 'workspace_root' is required by most tools."
        ),
    )
    mode: str = Field(
        DevToolMode.READ_ONLY,
        description=(
            "Execution mode: 'read_only' | 'safe_write' | 'full'. "
            "Higher modes require higher role (OPERATOR / ADMIN)."
        ),
    )
    request_id: str | None = Field(
        None,
        description="Caller-supplied correlation ID. Auto-generated when absent.",
    )
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional execution context (e.g. repo metadata).",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional caller metadata.",
    )


class DevToolBatchItem(BaseModel):
    """Single item in a devtools batch request."""

    tool_name:  str
    action:     str
    params:     dict[str, Any]  = Field(default_factory=dict)
    mode:       str             = DevToolMode.READ_ONLY
    request_id: str | None      = None
    context:    dict[str, Any]  = Field(default_factory=dict)
    metadata:   dict[str, Any]  = Field(default_factory=dict)


class DevToolBatchRequest(BaseModel):
    """Request body for POST /devtools/batch."""

    actions: list[DevToolBatchItem] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="List of devtool actions to execute sequentially (max 20).",
    )


def _safe_devtool_dict(result: Any) -> dict[str, Any]:
    """Serialise DevToolResult to a JSON-safe dict."""
    if hasattr(result, "as_dict"):
        return result.as_dict()
    return {
        "request_id":        getattr(result, "request_id", None),
        "tool_name":         getattr(result, "tool_name", None),
        "action":            getattr(result, "action", None),
        "success":           getattr(result, "success", False),
        "normalized_output": getattr(result, "normalized_output", None),
        "error_code":        getattr(result, "error_code", None),
        "error_message":     getattr(result, "error_message", None),
        "latency_ms":        getattr(result, "latency_ms", 0),
    }


def _make_executor() -> DevToolExecutor:
    """FastAPI dependency: returns DevToolExecutor backed by singleton registry."""
    return DevToolExecutor(registry=get_registry())


# ─────────────────────────────────────────────────────────────────────────────
# GET /devtools/  — registry health
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/",
    summary="DevTool registry — list all registered tools, actions, and op types",
    tags=["devtools"],
    dependencies=[Depends(get_current_user)],
)
async def list_devtools() -> dict[str, Any]:
    """
    Returns the full devtool registry snapshot:
    - tool names, supported actions, operation types
    - total tool and action counts
    - mode requirements per op type
    """
    registry = get_registry()
    actions_map  = registry.list_actions()
    op_types_map = registry.list_op_types()
    total_actions = sum(len(v) for v in actions_map.values())

    # Annotate mode requirements
    from app.devtools.types import DevToolOpType
    _OP_MODE: dict[str, str] = {
        DevToolOpType.READ:     DevToolMode.READ_ONLY,
        DevToolOpType.INSPECT:  DevToolMode.READ_ONLY,
        DevToolOpType.EXPORT:   DevToolMode.SAFE_WRITE,
        DevToolOpType.WRITE:    DevToolMode.SAFE_WRITE,
        DevToolOpType.EXECUTE:  DevToolMode.FULL,
        DevToolOpType.BROWSER:  DevToolMode.FULL,
        DevToolOpType.WORKFLOW: DevToolMode.SAFE_WRITE,
        DevToolOpType.DEPLOY:   DevToolMode.FULL,
    }

    tools_info: dict[str, dict[str, Any]] = {}
    for name in registry.list_tools():
        op_type = op_types_map.get(name, "read")
        tools_info[name] = {
            "actions":       actions_map.get(name, []),
            "op_type":       op_type,
            "minimum_mode":  _OP_MODE.get(op_type, DevToolMode.READ_ONLY),
        }

    return {
        "tool_count":    registry.tool_count(),
        "total_actions": total_actions,
        "tools":         tools_info,
        "mode_hierarchy": [
            DevToolMode.READ_ONLY,
            DevToolMode.SAFE_WRITE,
            DevToolMode.FULL,
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /devtools/{tool_name}  — tool schema
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{tool_name}",
    summary="Get devtool schema — actions, op_type, input/output schema",
    tags=["devtools"],
    dependencies=[Depends(get_current_user)],
)
async def get_devtool_schema(tool_name: str) -> dict[str, Any]:
    """
    Returns the full schema for a registered developer tool:
    - supported actions
    - operation type and minimum required mode
    - input schema and output schema
    """
    registry = get_registry()
    tool = registry.resolve_or_none(tool_name)
    if tool is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DevTool '{tool_name}' not found. "
                   f"Available: {registry.list_tools()}",
        )

    from app.devtools.types import DevToolOpType
    _OP_MODE: dict[str, str] = {
        DevToolOpType.READ:     DevToolMode.READ_ONLY,
        DevToolOpType.INSPECT:  DevToolMode.READ_ONLY,
        DevToolOpType.EXPORT:   DevToolMode.SAFE_WRITE,
        DevToolOpType.WRITE:    DevToolMode.SAFE_WRITE,
        DevToolOpType.EXECUTE:  DevToolMode.FULL,
        DevToolOpType.BROWSER:  DevToolMode.FULL,
        DevToolOpType.WORKFLOW: DevToolMode.SAFE_WRITE,
        DevToolOpType.DEPLOY:   DevToolMode.FULL,
    }
    op_type = tool.get_op_type()
    return {
        "tool_name":      tool.name,
        "actions":        tool.get_actions(),
        "op_type":        op_type,
        "minimum_mode":   _OP_MODE.get(op_type, DevToolMode.READ_ONLY),
        "input_schema":   tool.get_input_schema(),
        "output_schema":  tool.get_output_schema(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /devtools/{tool_name}/{action}  — execute
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{tool_name}/{action}",
    summary="Execute a developer tool action",
    tags=["devtools"],
    dependencies=[Depends(get_current_user)],
)
async def execute_devtool(
    tool_name: str,
    action:    str,
    body:      DevToolActionRequest,
    user:      CurrentUser = Depends(get_current_user),
    executor:  DevToolExecutor = Depends(_make_executor),
) -> dict[str, Any]:
    """
    Execute a single developer tool action.

    **Mode**
    Supply `mode` in the request body:
    - `read_only`  → safe for inspection (VIEWER role)
    - `safe_write` → filesystem writes (OPERATOR role)
    - `full`       → shell execution, deploys, Playwright (ADMIN role)

    **workspace_root**
    Most tools require `params.workspace_root` — the absolute path of
    the repository/workspace the tool should operate on.

    **Response**
    Always returns a DevToolResult dict.  `success=false` on any error.
    """
    # Pre-check: tool exists
    registry = get_registry()
    if registry.resolve_or_none(tool_name) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DevTool '{tool_name}' not found. "
                   f"Available: {registry.list_tools()}",
        )

    # Pre-check: mode vs role
    _check_mode_role(body.mode, user)

    tool_input = DevToolInput(
        tool_name  = tool_name,
        action     = action,
        params     = body.params,
        mode       = body.mode,
        request_id = body.request_id or _auto_id(),
        context    = body.context,
        metadata   = body.metadata,
    )

    logger.info(
        "devtools_router.execute",
        tool_name=tool_name,
        action=action,
        mode=body.mode,
        request_id=tool_input.request_id,
    )

    result = await executor.execute(tool_input)
    return _safe_devtool_dict(result)


# ─────────────────────────────────────────────────────────────────────────────
# POST /devtools/batch  — batch execution
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/batch",
    summary="Execute multiple devtool actions in a single request (max 20)",
    tags=["devtools"],
    dependencies=[Depends(require_role("OPERATOR"))],
)
async def execute_devtools_batch(
    body:     DevToolBatchRequest,
    user:     CurrentUser = Depends(get_current_user),
    executor: DevToolExecutor = Depends(_make_executor),
) -> dict[str, Any]:
    """
    Execute up to 20 devtool actions sequentially.

    Each action carries its own `mode`; the router validates each mode
    against the caller's role before execution begins.
    Individual failures do not abort the batch.
    """
    # Pre-validate all mode/role constraints before any execution
    for item in body.actions:
        _check_mode_role(item.mode, user)

    inputs = [
        DevToolInput(
            tool_name  = item.tool_name,
            action     = item.action,
            params     = item.params,
            mode       = item.mode,
            request_id = item.request_id or _auto_id(),
            context    = item.context,
            metadata   = item.metadata,
        )
        for item in body.actions
    ]

    logger.info(
        "devtools_router.batch",
        count=len(inputs),
        tools=[i.tool_name for i in inputs],
    )

    results = await executor.execute_many(inputs)
    return {
        "count":     len(results),
        "results":   [_safe_devtool_dict(r) for r in results],
        "succeeded": sum(1 for r in results if r.success),
        "failed":    sum(1 for r in results if not r.success),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────────────────

def _auto_id() -> str:
    import uuid
    return str(uuid.uuid4())
