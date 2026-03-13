"""
app/devtools/executor.py
─────────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  DevToolExecutor is the sole orchestration point.               │
│  See DEVTOOLS_STATUS_REPORT.md §freeze for rules.              │
└─────────────────────────────────────────────────────────────────┘

Orchestrates the full developer-tool execution lifecycle:

  1. Resolve tool from registry.
  2. Check action is supported.
  3. Mode-gate: block WRITE/EXECUTE ops when mode is too low.
  4. Validate input params.
  5. Fire on_pre_execute hook.
  6. Call tool.execute_action() → raw_output.
  7. Validate raw output.
  8. Normalize output.
  9. Fire on_post_execute hook.
 10. Return DevToolResult.

All exceptions are caught and surfaced as DevToolResult(success=False).
"""
from __future__ import annotations

import time
from typing import Any

import structlog

from app.devtools.base       import BaseDevTool
from app.devtools.errors     import DevToolError
from app.devtools.normalizers import require_mode
from app.devtools.registry   import DevToolRegistry, get_registry
from app.devtools.types      import (
    DevToolErrorCode,
    DevToolInput,
    DevToolResult,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)


class DevToolExecutor:
    """
    Orchestrates developer tool execution.

    Parameters
    ----------
    registry : DevToolRegistry – defaults to application singleton
    """

    def __init__(self, registry: DevToolRegistry | None = None) -> None:
        self._registry = registry or get_registry()

    # ── Public API ────────────────────────────────────────────────────────────

    async def execute(self, tool_input: DevToolInput) -> DevToolResult:
        """
        Execute a developer tool action end-to-end.

        Always returns a DevToolResult — never raises to the caller.
        """
        start_ms = _now_ms()

        # ── 1. Resolve tool ──────────────────────────────────────────────────
        tool = self._registry.resolve_or_none(tool_input.tool_name)
        if tool is None:
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.UNSUPPORTED_TOOL,
                error_message = f"No devtool registered: {tool_input.tool_name!r}",
                latency_ms    = _elapsed(start_ms),
            )

        # ── 2. Check action ───────────────────────────────────────────────────
        if not tool.can_handle(tool_input.action):
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.UNSUPPORTED_ACTION,
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
            mode       = tool_input.mode,
        )
        log.info("devtool_executor.start")

        # ── 3. Mode gate ──────────────────────────────────────────────────────
        mode_check = require_mode(tool_input.mode, tool.requires_mode())
        if not mode_check.passed:
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.PERMISSION_DENIED,
                error_message = "; ".join(mode_check.errors),
                latency_ms    = _elapsed(start_ms),
            )

        # ── 4. Validate input ─────────────────────────────────────────────────
        try:
            iv: DevToolValidationResult = tool.validate_input(tool_input)
        except Exception as exc:
            log.error("devtool_executor.validate_input_exc", exc=str(exc))
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.INPUT_INVALID,
                error_message = f"validate_input raised: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        if not iv.passed:
            log.warning("devtool_executor.input_invalid", errors=iv.errors)
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.INPUT_INVALID,
                error_message = "; ".join(iv.errors),
                latency_ms    = _elapsed(start_ms),
            )

        # ── 5. Pre-execute hook ───────────────────────────────────────────────
        try:
            tool.on_pre_execute(tool_input)
        except Exception as exc:  # pragma: no cover
            log.warning("devtool_executor.pre_hook_failed", exc=str(exc))

        # ── 6. Execute action ─────────────────────────────────────────────────
        try:
            raw_output = await tool.execute_action(tool_input)
        except DevToolError as exc:
            log.error(
                "devtool_executor.tool_error",
                error_code = exc.error_code,
                exc        = exc.message,
            )
            tool.on_post_execute(None, success=False)
            return _err(
                tool_input,
                error_code    = exc.error_code,
                error_message = exc.message,
                latency_ms    = _elapsed(start_ms),
                retryable     = exc.retryable,
            )
        except Exception as exc:
            log.error("devtool_executor.action_exc", exc=str(exc))
            tool.on_post_execute(None, success=False)
            return _err(
                tool_input,
                error_code    = DevToolErrorCode.ACTION_FAILED,
                error_message = f"execute_action raised: {exc}",
                latency_ms    = _elapsed(start_ms),
            )

        # ── 7. Validate output ────────────────────────────────────────────────
        try:
            ov: DevToolValidationResult = tool.validate_output(raw_output)
        except Exception as exc:
            log.error("devtool_executor.validate_output_exc", exc=str(exc))
            tool.on_post_execute(raw_output, success=False)
            return DevToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                validation_passed = False,
                error_code        = DevToolErrorCode.VALIDATION_FAILED,
                error_message     = f"validate_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
            )

        if not ov.passed:
            log.warning("devtool_executor.output_invalid", errors=ov.errors)
            tool.on_post_execute(raw_output, success=False)
            return DevToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                validation_passed = False,
                error_code        = DevToolErrorCode.VALIDATION_FAILED,
                error_message     = "; ".join(ov.errors),
                latency_ms        = _elapsed(start_ms),
            )

        # ── 8. Normalize output ───────────────────────────────────────────────
        try:
            normalized = tool.normalize_output(raw_output)
        except Exception as exc:
            log.error("devtool_executor.normalize_exc", exc=str(exc))
            tool.on_post_execute(raw_output, success=False)
            return DevToolResult(
                request_id        = tool_input.request_id,
                tool_name         = tool_input.tool_name,
                action            = tool_input.action,
                success           = False,
                raw_output        = raw_output,
                validation_passed = True,
                error_code        = DevToolErrorCode.NORMALIZATION_ERROR,
                error_message     = f"normalize_output raised: {exc}",
                latency_ms        = _elapsed(start_ms),
            )

        # ── 9. Post-execute hook ──────────────────────────────────────────────
        try:
            tool.on_post_execute(raw_output, success=True)
        except Exception as exc:  # pragma: no cover
            log.warning("devtool_executor.post_hook_failed", exc=str(exc))

        latency = _elapsed(start_ms)
        log.info("devtool_executor.success", latency_ms=latency)

        # ── 10. Return result ─────────────────────────────────────────────────
        source_ref = (
            tool_input.params.get("path")
            or tool_input.params.get("url")
            or tool_input.params.get("command")
            or tool_input.params.get("query")
            or None
        )

        meta = dict(raw_output) if isinstance(raw_output, dict) else {}
        meta_keys = {"exit_code", "path", "branch", "command"}
        result_meta = {k: v for k, v in meta.items() if k in meta_keys}

        return DevToolResult(
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
            metadata          = result_meta,
            retryable         = False,
            source_reference  = source_ref,
        )

    # ── Batch ─────────────────────────────────────────────────────────────────

    async def execute_many(
        self, inputs: list[DevToolInput]
    ) -> list[DevToolResult]:
        """Execute a list of DevToolInputs sequentially."""
        results = []
        for ti in inputs:
            results.append(await self.execute(ti))
        return results


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.monotonic() * 1000)


def _elapsed(start_ms: int) -> int:
    return _now_ms() - start_ms


def _err(
    tool_input:    DevToolInput,
    error_code:    str,
    error_message: str,
    latency_ms:    int,
    retryable:     bool = False,
) -> DevToolResult:
    return DevToolResult(
        request_id        = tool_input.request_id,
        tool_name         = tool_input.tool_name,
        action            = tool_input.action,
        success           = False,
        validation_passed = False,
        error_code        = error_code,
        error_message     = error_message,
        latency_ms        = latency_ms,
        retryable         = retryable,
    )
