"""
app/tools/executor.py
──────────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  ToolExecutor is the sole orchestration point for all tools.    │
│  Changing execution order (validate → execute → validate →      │
│  normalize → hooks) breaks test contracts.                      │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

The executor orchestrates the full tool execution lifecycle:

  1. Resolve the tool from the registry.
  2. Validate the input (params check).
  3. Fire on_pre_execute hook.
  4. Call tool.execute_action() (external I/O).
  5. Validate raw output.
  6. Normalize output.
  7. Fire on_post_execute hook.
  8. Return ToolResult.

All exceptions are caught and surfaced as a ToolResult with
success=False so the caller always gets a structured response.

What this executor does NOT do
──────────────────────────────
  - Provider / model routing     → engine
  - Prompt shaping               → module layer
  - DB / cache / Celery          → application layer
"""
from __future__ import annotations

import time
from typing import Any

import structlog

from app.tools.base     import BaseTool, ToolActionError
from app.tools.registry import ToolRegistry, get_registry
from app.tools.types    import ToolErrorCode, ToolInput, ToolResult, ToolValidationResult

logger = structlog.get_logger(__name__)


class ToolExecutor:
    """
    Orchestrates the tool execution flow.

    Parameters
    ----------
    registry : ToolRegistry – defaults to the application singleton
    """

    def __init__(self, registry: ToolRegistry | None = None) -> None:
        self._registry = registry or get_registry()

    # ── Public API ────────────────────────────────────────────────────────────

    async def execute(self, tool_input: ToolInput) -> ToolResult:
        """
        Execute a tool action end-to-end.

        Flow
        ----
        1. Resolve tool from registry.
        2. Validate input params.
        3. Fire on_pre_execute hook.
        4. Call tool.execute_action() → raw_output.
        5. Validate raw output.
        6. Normalize output.
        7. Fire on_post_execute hook.
        8. Return ToolResult.

        All exceptions are caught and returned as a failed ToolResult.
        """
        start_ms = _now_ms()

        # ── 1. Resolve tool ──────────────────────────────────────────────────
        tool = self._registry.resolve_or_none(tool_input.tool_name)
        if tool is None:
            return _error_result(
                tool_input,
                error_code    = ToolErrorCode.UNSUPPORTED_TOOL,
                error_message = (
                    f"No tool registered for name={tool_input.tool_name!r}"
                ),
                latency_ms    = _elapsed(start_ms),
            )

        # ── Check action is supported ────────────────────────────────────────
        if not tool.can_handle(tool_input.action):
            return _error_result(
                tool_input,
                error_code    = ToolErrorCode.UNSUPPORTED_ACTION,
                error_message = (
                    f"Tool {tool_input.tool_name!r} does not support "
                    f"action={tool_input.action!r}. "
                    f"Supported: {tool.get_actions()}"
                ),
                latency_ms    = _elapsed(start_ms),
            )

        log = logger.bind(
            request_id = tool_input.request_id,
            tool       = tool_input.tool_name,
            action     = tool_input.action,
        )
        log.info("tool_executor.start")

        # ── 2. Validate input ────────────────────────────────────────────────
        try:
            iv: ToolValidationResult = tool.validate_input(tool_input)
        except Exception as exc:
            log.error("tool_executor.validate_input_exception", exc=str(exc))
            return _error_result(
                tool_input,
                error_code    = ToolErrorCode.INPUT_INVALID,
                error_message = f"validate_input raised: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        if not iv.passed:
            log.warning("tool_executor.input_invalid", errors=iv.errors)
            return _error_result(
                tool_input,
                error_code    = ToolErrorCode.INPUT_INVALID,
                error_message = "; ".join(iv.errors),
                latency_ms    = _elapsed(start_ms),
            )

        # ── 3. Pre-execute hook ──────────────────────────────────────────────
        try:
            tool.on_pre_execute(tool_input)
        except Exception as exc:  # pragma: no cover
            log.warning("tool_executor.pre_hook_failed", exc=str(exc))

        # ── 4. Execute action ────────────────────────────────────────────────
        try:
            raw_output = await tool.execute_action(tool_input)
        except ToolActionError as exc:
            log.error(
                "tool_executor.action_error",
                error_code = exc.error_code,
                exc        = exc.message,
            )
            tool.on_post_execute(None, success=False)
            return _error_result(
                tool_input,
                error_code    = exc.error_code,
                error_message = exc.message,
                latency_ms    = _elapsed(start_ms),
            )
        except Exception as exc:
            log.error("tool_executor.action_exception", exc=str(exc))
            tool.on_post_execute(None, success=False)
            return _error_result(
                tool_input,
                error_code    = ToolErrorCode.ACTION_FAILED,
                error_message = f"execute_action raised: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        # ── 5. Validate output ───────────────────────────────────────────────
        try:
            ov: ToolValidationResult = tool.validate_output(raw_output)
        except Exception as exc:
            log.error("tool_executor.validate_output_exception", exc=str(exc))
            tool.on_post_execute(raw_output, success=False)
            return ToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                normalized_output = None,
                validation_passed = False,
                error_code        = ToolErrorCode.VALIDATION_FAILED,
                error_message     = f"validate_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
            )

        if not ov.passed:
            log.warning("tool_executor.output_invalid", errors=ov.errors)
            tool.on_post_execute(raw_output, success=False)
            return ToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                normalized_output = None,
                validation_passed = False,
                error_code        = ToolErrorCode.VALIDATION_FAILED,
                error_message     = "; ".join(ov.errors),
                latency_ms        = _elapsed(start_ms),
            )

        # ── 6. Normalize output ──────────────────────────────────────────────
        try:
            normalized = tool.normalize_output(raw_output)
        except Exception as exc:
            log.error("tool_executor.normalize_exception", exc=str(exc))
            tool.on_post_execute(raw_output, success=False)
            return ToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                normalized_output = None,
                validation_passed = True,
                error_code        = ToolErrorCode.NORMALIZATION_ERROR,
                error_message     = f"normalize_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
            )

        # ── 7. Post-execute hook ─────────────────────────────────────────────
        try:
            tool.on_post_execute(raw_output, success=True)
        except Exception as exc:  # pragma: no cover
            log.warning("tool_executor.post_hook_failed", exc=str(exc))

        latency = _elapsed(start_ms)
        log.info("tool_executor.success", latency_ms=latency)

        # ── 8. Return result ─────────────────────────────────────────────────
        source_url = (
            tool_input.params.get("url")
            or tool_input.params.get("query")
            or None
        )

        return ToolResult(
            request_id        = tool_input.request_id,
            tool_name         = tool_input.tool_name,
            action            = tool_input.action,
            success           = True,
            raw_output        = raw_output,
            normalized_output = normalized,
            validation_passed = True,
            error_code        = None,
            error_message     = None,
            latency_ms        = latency,
            source_url        = source_url,
        )

    # ── Batch execution ───────────────────────────────────────────────────────

    async def execute_many(
        self, inputs: list[ToolInput]
    ) -> list[ToolResult]:
        """Execute a list of ToolInputs sequentially, returning all results."""
        results = []
        for ti in inputs:
            results.append(await self.execute(ti))
        return results


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.monotonic() * 1000)


def _elapsed(start_ms: int) -> int:
    return _now_ms() - start_ms


def _error_result(
    tool_input:    ToolInput,
    error_code:    str,
    error_message: str,
    latency_ms:    int,
) -> ToolResult:
    return ToolResult(
        request_id        = tool_input.request_id,
        tool_name         = tool_input.tool_name,
        action            = tool_input.action,
        success           = False,
        validation_passed = False,
        error_code        = error_code,
        error_message     = error_message,
        latency_ms        = latency_ms,
    )
