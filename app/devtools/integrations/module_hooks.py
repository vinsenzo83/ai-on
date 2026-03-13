"""
app/devtools/integrations/module_hooks.py
──────────────────────────────────────────
Phase 16 — Developer Assist Tooling Layer.

Safe integration hooks that connect developer tools to the frozen
module layer (Phase 14) WITHOUT modifying any frozen files.

This file implements the on_pre_execute / on_post_execute lifecycle
hooks described in MODULE_SYSTEM_STATUS_REPORT.md §10.

Usage example
─────────────
    from app.devtools.integrations.module_hooks import DevToolModuleHook

    # Attach to a module subclass that wraps a dev tool
    class CodeGenModule(BaseModule):
        def on_pre_execute(self, module_input):
            DevToolModuleHook.log_pre(module_input)

        def on_post_execute(self, raw_output, success):
            DevToolModuleHook.log_post(raw_output, success)

Design rule
───────────
  • This file imports from app.modules (public surface only).
  • It does NOT import from frozen module internals.
  • It does NOT modify any frozen module file.
"""
from __future__ import annotations

from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class DevToolModuleHook:
    """
    Stateless helper that can be called from on_pre_execute /
    on_post_execute hooks in module subclasses that coordinate with
    developer tools.
    """

    @staticmethod
    def log_pre(module_input: Any) -> None:
        """Log that a module is about to execute a developer-tool-driven task."""
        logger.info(
            "devtool_module_hook.pre_execute",
            task_type  = getattr(module_input, "task_type",  "unknown"),
            request_id = getattr(module_input, "request_id", "unknown"),
        )

    @staticmethod
    def log_post(raw_output: Any, success: bool) -> None:
        """Log the outcome of a module execution."""
        logger.info(
            "devtool_module_hook.post_execute",
            success    = success,
            output_len = len(str(raw_output)) if raw_output is not None else 0,
        )

    @staticmethod
    def enrich_metadata(module_input: Any, devtool_result: Any) -> None:
        """
        Inject DevToolResult metadata into ModuleInput.metadata so the
        module layer can surface tool provenance in ExecutionResult.

        Parameters
        ----------
        module_input  : ModuleInput from app.modules.types
        devtool_result: DevToolResult from app.devtools.types
        """
        if not hasattr(module_input, "metadata"):
            return
        module_input.metadata["devtool_source"] = getattr(
            devtool_result, "source_reference", None
        )
        module_input.metadata["devtool_latency_ms"] = getattr(
            devtool_result, "latency_ms", 0
        )
        module_input.metadata["devtool_success"] = getattr(
            devtool_result, "success", False
        )
