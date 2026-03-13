"""
app/tools/integrations/module_bridge.py
────────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

FREEZE STATUS: OPEN (additions allowed; frozen files untouched)

The ModuleBridge sits between the tool layer (Phase 15) / devtools layer
(Phase 16) and the module layer (Phase 14).  It:

  1. Accepts a ToolResult or DevToolResult (duck-typed).
  2. Uses ToolResultAdapter (app.modules.integrations) to convert it into
     a ModuleInput through approved extension points.
  3. Delegates execution to a ModuleExecutor instance.
  4. Returns the ExecutionResult (or a composed workflow dict via
     WorkflowOrchestrator).

The WorkflowOrchestrator provides named workflow factories:
  - website_analysis(url)     : browser → analysis module
  - document_pdf(bytes)       : pdf → summarize module
  - search_summary(query)     : search → summarize module
  - devtool_code(devtool_res) : devtool → code module
  - browser_extract(url)      : browser → extract module
  - generic(tool_res, …)      : any tool → any module

Design rules
────────────
• All frozen file contracts respected (no modifications).
• All tool/module calls happen through approved executors.
• Validation and normalization enforced by existing executor pipelines.
• ModuleBridge is stateless per-workflow (executor injected for tests).
• WorkflowResult is a plain dataclass — always JSON-serialisable.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import structlog

from app.modules.executor import ModuleExecutor
from app.modules.integrations.tool_adapters import (
    IntegrationError,
    ModuleOutputComposer,
    ToolBackedModuleInput,
    ToolResultAdapter,
)
from app.modules.registry import get_registry as get_module_registry
from app.modules.types import ExecutionResult, ModuleInput

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# WorkflowResult — structured output of a chained workflow
# ---------------------------------------------------------------------------

@dataclass
class WorkflowResult:
    """
    Structured output of a ModuleBridge / WorkflowOrchestrator run.

    Always JSON-serialisable via as_dict().

    Attributes
    ----------
    workflow        : str            – named workflow identifier
    request_id      : str            – correlation ID
    success         : bool           – True when all steps succeeded
    steps           : list[dict]     – per-step composed results
    final_output    : Any            – normalized_output of the last module step
    error_code      : str | None     – set when success=False
    error_message   : str | None     – set when success=False
    latency_ms      : int            – total wall-clock time
    metadata        : dict           – workflow-level provenance
    """

    workflow:     str
    request_id:   str                     = field(default_factory=lambda: str(uuid.uuid4()))
    success:      bool                    = False
    steps:        list[dict[str, Any]]    = field(default_factory=list)
    final_output: Any                     = None
    error_code:   str | None              = None
    error_message: str | None             = None
    latency_ms:   int                     = 0
    metadata:     dict[str, Any]          = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict (JSON-serialisable)."""
        return {
            "workflow":      self.workflow,
            "request_id":    self.request_id,
            "success":       self.success,
            "steps":         self.steps,
            "final_output":  self.final_output,
            "error_code":    self.error_code,
            "error_message": self.error_message,
            "latency_ms":    self.latency_ms,
            "metadata":      self.metadata,
        }


# ---------------------------------------------------------------------------
# ModuleBridge — single tool result → module execution
# ---------------------------------------------------------------------------

class ModuleBridge:
    """
    Feeds a single ToolResult / DevToolResult into the module layer.

    Parameters
    ----------
    executor : ModuleExecutor – injected for tests; defaults to a
               MockProviderRunner-backed executor if not supplied
    """

    def __init__(self, executor: ModuleExecutor | None = None) -> None:
        self._executor = executor or _default_executor()

    async def run(
        self,
        tool_result: Any,
        *,
        task_type: str,
        extra_params: dict[str, Any] | None = None,
        raise_on_tool_failure: bool = False,
    ) -> ExecutionResult:
        """
        Convert tool_result → ModuleInput → ExecutionResult.

        Parameters
        ----------
        tool_result           : ToolResult | DevToolResult
        task_type             : module task type, e.g. "summarize"
        extra_params          : extra fields merged into raw_input
        raise_on_tool_failure : raise IntegrationError if tool failed
        """
        module_input = ToolResultAdapter.to_module_input(
            tool_result,
            task_type=task_type,
            extra_params=extra_params,
            raise_on_failure=raise_on_tool_failure,
        )
        logger.debug(
            "module_bridge.run",
            tool_name=getattr(tool_result, "tool_name", "?"),
            task_type=task_type,
            request_id=module_input.request_id,
        )
        return await self._executor.execute(module_input)

    async def run_text(
        self,
        tool_result: Any,
        *,
        task_type: str,
        text_key: str = "text",
        extra_params: dict[str, Any] | None = None,
        raise_on_tool_failure: bool = False,
    ) -> ExecutionResult:
        """
        Text-extraction variant: extracts plain text from tool_result first.
        """
        module_input = ToolResultAdapter.to_module_text(
            tool_result,
            task_type=task_type,
            text_key=text_key,
            extra_params=extra_params,
            raise_on_failure=raise_on_tool_failure,
        )
        return await self._executor.execute(module_input)


# ---------------------------------------------------------------------------
# WorkflowOrchestrator — named multi-step workflow factories
# ---------------------------------------------------------------------------

class WorkflowOrchestrator:
    """
    Named workflow factories that chain tool execution results into module
    processing steps and compose the final output.

    All methods accept already-executed tool results (ToolResult /
    DevToolResult) — the orchestrator does NOT execute tools directly,
    keeping tool and module execution decoupled.

    Parameters
    ----------
    executor : ModuleExecutor – injected for tests
    """

    def __init__(self, executor: ModuleExecutor | None = None) -> None:
        self._executor = executor or _default_executor()
        self._bridge   = ModuleBridge(executor=self._executor)

    # ── Website analysis workflow ─────────────────────────────────────────────

    async def website_analysis(
        self,
        browser_result: Any,
        *,
        analysis_type: str = "general",
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: BrowserTool result → AnalysisModule.

        browser_result should be the output of BrowserTool.extract_text
        or BrowserTool.fetch.
        """
        req_id    = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolBackedModuleInput.website_analysis(
                browser_result,
                analysis_type=analysis_type,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "analysis"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "website_analysis",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name":    getattr(browser_result, "tool_name", "browser"),
                    "analysis_type": analysis_type,
                    "source_url":   getattr(browser_result, "source_url", None),
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "website_analysis",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Document / PDF workflow ───────────────────────────────────────────────

    async def document_pdf(
        self,
        pdf_result: Any,
        *,
        style: str = "standard",
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: PdfTool.extract_text result → SummarizeModule.
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolBackedModuleInput.document_pdf(
                pdf_result,
                style=style,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "summarize"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "document_pdf",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name": getattr(pdf_result, "tool_name", "pdf"),
                    "style":     style,
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "document_pdf",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Search summary workflow ───────────────────────────────────────────────

    async def search_summary(
        self,
        search_result: Any,
        *,
        max_words: int = 150,
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: SearchTool result → SummarizeModule.
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolBackedModuleInput.search_summary(
                search_result,
                max_words=max_words,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "summarize"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "search_summary",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {"tool_name": getattr(search_result, "tool_name", "search")},
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "search_summary",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Developer task workflows ──────────────────────────────────────────────

    async def devtool_code(
        self,
        devtool_result: Any,
        *,
        language: str = "python",
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: DevTool result (filesystem/git/test_runner/…) → CodeModule.
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolBackedModuleInput.devtool_code(
                devtool_result,
                language=language,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "code_analysis"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "devtool_code",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name": getattr(devtool_result, "tool_name", "devtool"),
                    "language":  language,
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "devtool_code",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    async def devtool_document(
        self,
        devtool_result: Any,
        *,
        doc_type: str = "general",
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: DevTool result → DocumentModule.

        Useful for auto-generating README / spec from devtool outputs
        (e.g., repo_search scan results, filesystem directory listings).
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolBackedModuleInput.devtool_document(
                devtool_result,
                doc_type=doc_type,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "document_generation"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "devtool_document",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name": getattr(devtool_result, "tool_name", "devtool"),
                    "doc_type":  doc_type,
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "devtool_document",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Browser-assisted extraction workflow ──────────────────────────────────

    async def browser_extract(
        self,
        browser_result: Any,
        *,
        fields: list[str] | None = None,
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Workflow: BrowserTool result → ExtractModule (NER / key-value extraction).
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        extra: dict[str, Any] = {}
        if fields:
            extra["fields"] = fields

        try:
            module_input = ToolResultAdapter.to_module_for_browser(
                browser_result,
                task_type="extract",
                extra_params=extra if extra else None,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = "extract"
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "browser_extract",
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name":  getattr(browser_result, "tool_name", "browser"),
                    "source_url": getattr(browser_result, "source_url", None),
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = "browser_extract",
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Generic workflow ──────────────────────────────────────────────────────

    async def generic(
        self,
        tool_result: Any,
        *,
        task_type: str,
        workflow_name: str = "generic",
        extra_params: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Generic workflow: any tool result → any module task type.
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        steps: list[dict[str, Any]] = []

        try:
            module_input = ToolResultAdapter.to_module_input(
                tool_result,
                task_type=task_type,
                extra_params=extra_params,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = task_type
            steps.append(step_dict)

            latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = workflow_name,
                request_id   = req_id,
                success      = result.success,
                steps        = steps,
                final_output = result.normalized_output,
                error_code   = result.error_code,
                error_message= result.error_message,
                latency_ms   = latency,
                metadata     = {
                    "tool_name": getattr(tool_result, "tool_name", "unknown"),
                    "task_type": task_type,
                },
            )

        except IntegrationError as exc:
            import time; latency = int(time.monotonic() * 1000) - t0
            return WorkflowResult(
                workflow     = workflow_name,
                request_id   = req_id,
                success      = False,
                steps        = steps,
                error_code   = "INTEGRATION_ERROR",
                error_message= str(exc),
                latency_ms   = latency,
            )

    # ── Multi-step workflow (generic pipeline) ────────────────────────────────

    async def pipeline(
        self,
        steps: list[dict[str, Any]],
        *,
        workflow_name: str = "pipeline",
        request_id: str | None = None,
    ) -> WorkflowResult:
        """
        Execute a list of steps sequentially.

        Each step dict must contain:
          "step_name"  : str
          "tool_result": ToolResult | DevToolResult
          "task_type"  : str
          "extra_params": dict (optional)

        Steps are executed in order; on failure the workflow marks
        success=False but continues remaining steps (no short-circuit).
        """
        req_id = request_id or str(uuid.uuid4())
        import time; t0 = int(time.monotonic() * 1000)
        composed_steps: list[dict[str, Any]] = []

        for step_def in steps:
            step_name   = step_def.get("step_name", "unknown")
            tool_result = step_def.get("tool_result")
            task_type   = step_def.get("task_type", "summarize")
            extra       = step_def.get("extra_params")

            if tool_result is None:
                composed_steps.append({
                    "step_name":     step_name,
                    "success":       False,
                    "output":        None,
                    "error_message": "No tool_result provided",
                })
                continue

            module_input = ToolResultAdapter.to_module_input(
                tool_result,
                task_type=task_type,
                extra_params=extra,
                raise_on_failure=False,
            )
            module_input.request_id = req_id

            result = await self._executor.execute(module_input)

            step_dict = ModuleOutputComposer.compose_single(result)
            step_dict["step_name"] = step_name
            composed_steps.append(step_dict)

        all_success = all(s.get("success") for s in composed_steps)
        final_output = (
            composed_steps[-1].get("output") if composed_steps else None
        )

        latency = int(time.monotonic() * 1000) - t0
        return WorkflowResult(
            workflow      = workflow_name,
            request_id    = req_id,
            success       = all_success,
            steps         = composed_steps,
            final_output  = final_output,
            latency_ms    = latency,
            metadata      = {"step_count": len(steps)},
        )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _default_executor() -> ModuleExecutor:
    """
    Return a ModuleExecutor backed by MockProviderRunner for use
    in tests and offline development.

    In production, callers should inject a real executor with a live
    ProviderRunner.
    """
    from app.modules.executor import MockProviderRunner
    runner = MockProviderRunner(raw_output="Integration layer default output.")
    return ModuleExecutor(runner=runner, registry=get_module_registry())
