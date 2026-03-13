"""
app/routers/tools.py
─────────────────────
Phase 15 — General Tool HTTP API layer.

Routes
──────
GET  /tools/                         registry health + tool list
GET  /tools/{tool_name}              tool schema (actions, input/output)
POST /tools/{tool_name}/{action}     execute a tool action
POST /tools/batch                    execute multiple actions in one call

Auth
────
All routes require a valid Bearer JWT (VIEWER minimum).
Batch execution requires OPERATOR minimum.

Design rules
────────────
• Router is a pure HTTP adapter — all logic lives in ToolExecutor.
• No direct DB calls; tools perform their own I/O.
• ToolResult is always returned, success=False on any error.
• Large file payloads (PDF, images) accepted as base64-encoded bytes
  in the JSON body; keep under MAX_PAYLOAD_BYTES.
• Content-Type header is always application/json.
"""
from __future__ import annotations

import base64
import json
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.auth_service import CurrentUser, get_current_user, require_role
from app.tools.executor import ToolExecutor
from app.tools.registry import get_registry
from app.tools.types import ToolInput, ToolResult

logger = structlog.get_logger(__name__)
router = APIRouter()

# Maximum JSON body size for tool payloads (10 MB)
_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class ToolActionRequest(BaseModel):
    """Request body for POST /tools/{tool_name}/{action}."""

    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Action-specific parameters. Binary content (PDF, image bytes) "
                    "must be base64-encoded under the key 'content_b64'.",
    )
    request_id: str | None = Field(
        None,
        description="Caller-supplied correlation ID. Auto-generated when absent.",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional caller metadata (source, trace context, …).",
    )

    @field_validator("params")
    @classmethod
    def decode_binary_content(cls, v: dict[str, Any]) -> dict[str, Any]:
        """
        If params contains 'content_b64', decode it to bytes and store
        as 'content', removing the base64 key.
        """
        if "content_b64" in v:
            try:
                v["content"] = base64.b64decode(v.pop("content_b64"))
            except Exception as exc:
                raise ValueError(f"Invalid base64 in content_b64: {exc}") from exc
        return v


class BatchActionItem(BaseModel):
    """Single item in a batch request."""

    tool_name: str
    action: str
    params: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("params")
    @classmethod
    def decode_binary_content(cls, v: dict[str, Any]) -> dict[str, Any]:
        if "content_b64" in v:
            try:
                v["content"] = base64.b64decode(v.pop("content_b64"))
            except Exception as exc:
                raise ValueError(f"Invalid base64 in content_b64: {exc}") from exc
        return v


class BatchActionRequest(BaseModel):
    """Request body for POST /tools/batch."""

    actions: list[BatchActionItem] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="List of tool actions to execute sequentially (max 20).",
    )


def _safe_result_dict(result: ToolResult) -> dict[str, Any]:
    """
    Serialise ToolResult to a JSON-safe dict.
    Binary fields (raw_output bytes) are base64-encoded.
    """
    d = result.as_dict()
    # Encode any bytes fields in raw_output / normalized_output
    for key in ("raw_output", "normalized_output"):
        val = d.get(key)
        if isinstance(val, (bytes, bytearray)):
            d[key] = base64.b64encode(val).decode()
        elif isinstance(val, dict):
            # Recurse one level for nested bytes
            for k2, v2 in val.items():
                if isinstance(v2, (bytes, bytearray)):
                    val[k2] = base64.b64encode(v2).decode()
    return d


def _make_executor() -> ToolExecutor:
    """FastAPI dependency: returns ToolExecutor backed by singleton registry."""
    return ToolExecutor(registry=get_registry())


# ─────────────────────────────────────────────────────────────────────────────
# GET /tools/  — registry health
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/",
    summary="Tool registry — list all registered tools and actions",
    tags=["tools"],
    dependencies=[Depends(get_current_user)],
)
async def list_tools() -> dict[str, Any]:
    """
    Returns the full tool registry snapshot:
    - tool names and supported actions
    - total tool count and action count
    """
    registry = get_registry()
    actions_map: dict[str, list[str]] = registry.list_actions()
    total_actions = sum(len(v) for v in actions_map.values())

    return {
        "tool_count":    registry.tool_count(),
        "total_actions": total_actions,
        "tools":         actions_map,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /tools/{tool_name}  — tool schema
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{tool_name}",
    summary="Get tool schema — actions, input schema, output schema",
    tags=["tools"],
    dependencies=[Depends(get_current_user)],
)
async def get_tool_schema(tool_name: str) -> dict[str, Any]:
    """
    Returns the full schema for a registered tool:
    - supported actions
    - input schema (JSON-Schema-style)
    - output schema per action
    """
    registry = get_registry()
    tool = registry.resolve_or_none(tool_name)
    if tool is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tool '{tool_name}' not found. "
                   f"Available: {registry.list_tools()}",
        )
    return {
        "tool_name":     tool.name,
        "actions":       tool.get_actions(),
        "input_schema":  tool.get_input_schema(),
        "output_schema": tool.get_output_schema(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /tools/{tool_name}/{action}  — execute a tool action
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{tool_name}/{action}",
    summary="Execute a tool action",
    tags=["tools"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def execute_tool(
    tool_name: str,
    action:    str,
    body:      ToolActionRequest,
    executor:  ToolExecutor = Depends(_make_executor),
) -> dict[str, Any]:
    """
    Execute a single tool action.

    **Params encoding**
    - Most params are plain JSON values.
    - Binary content (PDF bytes, image bytes) must be base64-encoded
      and passed under the key `content_b64`.  The API decodes it to
      `bytes` before forwarding to the tool.

    **Response**
    Always returns a ToolResult dict.  Check `success` field for outcome.
    On tool error `success=false` with `error_code` and `error_message`.
    """
    # Validate tool exists before building ToolInput (cheaper 404)
    registry = get_registry()
    if registry.resolve_or_none(tool_name) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tool '{tool_name}' not found. "
                   f"Available: {registry.list_tools()}",
        )

    tool_input = ToolInput(
        tool_name  = tool_name,
        action     = action,
        params     = body.params,
        request_id = body.request_id or _auto_id(),
        metadata   = body.metadata,
    )

    logger.info(
        "tools_router.execute",
        tool_name=tool_name,
        action=action,
        request_id=tool_input.request_id,
    )

    result = await executor.execute(tool_input)
    return _safe_result_dict(result)


# ─────────────────────────────────────────────────────────────────────────────
# POST /tools/batch  — batch tool execution
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/batch",
    summary="Execute multiple tool actions in a single request (max 20)",
    tags=["tools"],
    dependencies=[Depends(require_role("OPERATOR"))],
)
async def execute_tools_batch(
    body:     BatchActionRequest,
    executor: ToolExecutor = Depends(_make_executor),
) -> dict[str, Any]:
    """
    Execute up to 20 tool actions sequentially.

    Returns a list of ToolResult dicts in the same order as the input.
    Individual failures do not abort the batch; each result carries its
    own `success` flag.
    """
    inputs = [
        ToolInput(
            tool_name  = item.tool_name,
            action     = item.action,
            params     = item.params,
            request_id = item.request_id or _auto_id(),
            metadata   = item.metadata,
        )
        for item in body.actions
    ]

    logger.info(
        "tools_router.batch",
        count=len(inputs),
        tools=[i.tool_name for i in inputs],
    )

    results = await executor.execute_many(inputs)
    return {
        "count":    len(results),
        "results":  [_safe_result_dict(r) for r in results],
        "succeeded": sum(1 for r in results if r.success),
        "failed":    sum(1 for r in results if not r.success),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────────────────

def _auto_id() -> str:
    import uuid
    return str(uuid.uuid4())
