"""
app/modules/integrations/tool_adapters.py
──────────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

FREEZE STATUS: OPEN (additions allowed; no modification of frozen files)

Adapters that convert ToolResult / DevToolResult into ModuleInput so that
the module layer can consume tool outputs through the approved
ModuleInput.raw_input (Any) extension point.

Design rules
────────────
• Never import from frozen internals; only use public surfaces:
    - app.modules.types      (ModuleInput, ExecutionResult)
    - app.tools.types        (ToolResult)
    - app.devtools.types     (DevToolResult)
• Never modify frozen files: modules/base.py, modules/types.py,
  modules/executor.py, tools/base.py, tools/types.py, tools/executor.py,
  devtools/base.py, devtools/types.py, devtools/executor.py.
• All adapters produce plain-Python structures (JSON-serialisable).
• Provenance metadata is always injected into ModuleInput.metadata.

Workflow support matrix
───────────────────────
Workflow              Tool(s) used          Module task_type
──────────────────────────────────────────────────────────────
Website analysis      browser / search      analysis / summarize / extract
Document / PDF        pdf / ocr             summarize / extract / document
Generic module task   (no tool)             any
Developer task        devtools              code / document / analysis
Browser-assisted      browser               analysis / extract / summarize
"""
from __future__ import annotations

import json
from typing import Any

import structlog

from app.modules.types import ExecutionResult, ModuleInput

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Sentinel for missing / empty content
# ---------------------------------------------------------------------------
_EMPTY = object()


class IntegrationError(Exception):
    """
    Raised when an adapter cannot produce a valid ModuleInput from the
    supplied tool result (e.g., the result indicates failure and
    raise_on_failure=True is set).
    """

    def __init__(self, message: str, *, tool_name: str = "", action: str = "") -> None:
        super().__init__(message)
        self.tool_name = tool_name
        self.action = action


# ---------------------------------------------------------------------------
# ToolResultAdapter
# ---------------------------------------------------------------------------

class ToolResultAdapter:
    """
    Converts ToolResult or DevToolResult into a ModuleInput.

    All class methods are *stateless* helpers — no instance state is required.

    Extension point: ModuleInput.raw_input (Any) and ModuleInput.metadata (dict)
    are both approved extension points per the Phase 14 / 15 / 16 freeze rules.
    """

    # ── Generic ──────────────────────────────────────────────────────────────

    @classmethod
    def to_module_input(
        cls,
        tool_result: Any,
        *,
        task_type: str,
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Generic adapter: converts any ToolResult or DevToolResult into a
        ModuleInput, routing the normalized_output (or raw_output on missing
        normalised data) as raw_input.

        Parameters
        ----------
        tool_result      : ToolResult | DevToolResult (duck-typed)
        task_type        : module task type string, e.g. "summarize"
        extra_params     : additional fields merged into raw_input dict
        raise_on_failure : if True, raise IntegrationError when tool failed
        """
        tool_name = getattr(tool_result, "tool_name", "unknown")
        action    = getattr(tool_result, "action", "unknown")
        success   = getattr(tool_result, "success", False)

        if raise_on_failure and not success:
            raise IntegrationError(
                f"Tool {tool_name!r} action {action!r} failed: "
                f"{getattr(tool_result, 'error_message', 'unknown error')}",
                tool_name=tool_name,
                action=action,
            )

        raw_input = cls._extract_content(tool_result)
        if extra_params:
            if isinstance(raw_input, dict):
                raw_input = {**raw_input, **extra_params}
            else:
                raw_input = {"content": raw_input, **extra_params}

        metadata = cls._build_provenance(tool_result)

        logger.debug(
            "tool_adapter.to_module_input",
            tool_name=tool_name,
            action=action,
            task_type=task_type,
            success=success,
        )

        return ModuleInput(
            task_type=task_type,
            raw_input=raw_input,
            request_id=getattr(tool_result, "request_id", None) or _auto_id(),
            metadata=metadata,
        )

    # ── Specialised converters ────────────────────────────────────────────────

    @classmethod
    def to_module_text(
        cls,
        tool_result: Any,
        *,
        task_type: str,
        text_key: str = "text",
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Adapter that extracts a plain text string from a tool result and
        places it in ``{text_key: <text>}`` inside raw_input.

        Ideal for feeding BrowserTool.extract_text or PdfTool.extract_text
        outputs into SummarizeModule, AnalysisModule, or ExtractModule.

        Parameters
        ----------
        text_key    : the dict key for the extracted text (default "text")
        """
        tool_name = getattr(tool_result, "tool_name", "unknown")
        action    = getattr(tool_result, "action", "unknown")
        success   = getattr(tool_result, "success", False)

        if raise_on_failure and not success:
            raise IntegrationError(
                f"Tool {tool_name!r} action {action!r} failed: "
                f"{getattr(tool_result, 'error_message', 'unknown error')}",
                tool_name=tool_name,
                action=action,
            )

        text = cls._extract_text_str(tool_result)
        raw_input: dict[str, Any] = {text_key: text}
        if extra_params:
            raw_input.update(extra_params)

        metadata = cls._build_provenance(tool_result)

        return ModuleInput(
            task_type=task_type,
            raw_input=raw_input,
            request_id=getattr(tool_result, "request_id", None) or _auto_id(),
            metadata=metadata,
        )

    @classmethod
    def to_module_for_pdf(
        cls,
        pdf_tool_result: Any,
        *,
        task_type: str = "summarize",
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Specialised adapter for PdfTool.extract_text output.

        Extracts ``text`` from the normalised PDF output and merges optional
        style / language params for use with SummarizeModule or DocumentModule.
        """
        return cls.to_module_text(
            pdf_tool_result,
            task_type=task_type,
            text_key="text",
            extra_params=extra_params,
            raise_on_failure=raise_on_failure,
        )

    @classmethod
    def to_module_for_browser(
        cls,
        browser_tool_result: Any,
        *,
        task_type: str = "analysis",
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Specialised adapter for BrowserTool.extract_text or BrowserTool.fetch.

        Extracts page text (or HTML title + body text) and creates a ModuleInput
        suitable for AnalysisModule, SummarizeModule, or ExtractModule.
        """
        return cls.to_module_text(
            browser_tool_result,
            task_type=task_type,
            text_key="text",
            extra_params=extra_params,
            raise_on_failure=raise_on_failure,
        )

    @classmethod
    def to_module_for_search(
        cls,
        search_tool_result: Any,
        *,
        task_type: str = "summarize",
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Specialised adapter for SearchTool results.

        Serialises search result snippets into a ``text`` field for downstream
        module processing (typically SummarizeModule or AnalysisModule).
        """
        tool_name = getattr(search_tool_result, "tool_name", "search")
        action    = getattr(search_tool_result, "action", "query")
        success   = getattr(search_tool_result, "success", False)

        if raise_on_failure and not success:
            raise IntegrationError(
                f"Tool {tool_name!r} action {action!r} failed: "
                f"{getattr(search_tool_result, 'error_message', 'unknown error')}",
                tool_name=tool_name,
                action=action,
            )

        text = cls._extract_search_text(search_tool_result)
        raw_input: dict[str, Any] = {"text": text}
        if extra_params:
            raw_input.update(extra_params)

        metadata = cls._build_provenance(search_tool_result)

        return ModuleInput(
            task_type=task_type,
            raw_input=raw_input,
            request_id=getattr(search_tool_result, "request_id", None) or _auto_id(),
            metadata=metadata,
        )

    @classmethod
    def to_module_for_devtool(
        cls,
        devtool_result: Any,
        *,
        task_type: str = "code",
        extra_params: dict[str, Any] | None = None,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """
        Specialised adapter for DevToolResult (Phase 16).

        Converts developer-tool output (filesystem reads, git diffs, test
        runner output, etc.) into a ModuleInput for downstream module
        processing (CodeModule, DocumentModule, AnalysisModule, etc.).

        Provenance includes DevTool-specific fields: source_reference,
        devtool_latency_ms, devtool_success, and mode.
        """
        tool_name = getattr(devtool_result, "tool_name", "unknown")
        action    = getattr(devtool_result, "action", "unknown")
        success   = getattr(devtool_result, "success", False)

        if raise_on_failure and not success:
            raise IntegrationError(
                f"DevTool {tool_name!r} action {action!r} failed: "
                f"{getattr(devtool_result, 'error_message', 'unknown error')}",
                tool_name=tool_name,
                action=action,
            )

        raw_input = cls._extract_content(devtool_result)
        if extra_params:
            if isinstance(raw_input, dict):
                raw_input = {**raw_input, **extra_params}
            else:
                raw_input = {"content": raw_input, **extra_params}

        metadata = cls._build_devtool_provenance(devtool_result)

        return ModuleInput(
            task_type=task_type,
            raw_input=raw_input,
            request_id=getattr(devtool_result, "request_id", None) or _auto_id(),
            metadata=metadata,
        )

    # ── Internal extraction helpers ───────────────────────────────────────────

    @classmethod
    def _extract_content(cls, tool_result: Any) -> Any:
        """
        Extract the best available content from a tool/devtool result.

        Priority: normalized_output > raw_output > empty dict
        """
        norm = getattr(tool_result, "normalized_output", _EMPTY)
        if norm is not _EMPTY and norm is not None:
            return norm

        raw = getattr(tool_result, "raw_output", _EMPTY)
        if raw is not _EMPTY and raw is not None:
            return raw

        return {}

    @classmethod
    def _extract_text_str(cls, tool_result: Any) -> str:
        """
        Extract a plain text string from a tool result for text-based modules.

        Handles multiple normalised output shapes:
        - dict with "text" key
        - dict with "html" key (browser fetch)
        - dict with "content" key
        - plain string
        - fallback: JSON serialisation
        """
        content = cls._extract_content(tool_result)

        if isinstance(content, dict):
            # Prefer explicit "text" field
            if "text" in content and isinstance(content["text"], str):
                return content["text"]
            # Browser fetch: use title + html summary
            if "html" in content:
                title = content.get("title", "")
                html  = content.get("html", "")
                # Strip HTML tags crudely for plain text
                import re
                plain = re.sub(r"<[^>]+>", " ", html)
                plain = re.sub(r"\s+", " ", plain).strip()
                return f"{title}\n\n{plain}" if title else plain
            # Other text-like keys
            for key in ("content", "output", "stdout", "document"):
                if key in content and isinstance(content[key], str):
                    return content[key]
            # Serialise the whole dict as context
            try:
                return json.dumps(content, default=str)
            except Exception:
                return str(content)

        if isinstance(content, str):
            return content

        try:
            return json.dumps(content, default=str)
        except Exception:
            return str(content)

    @classmethod
    def _extract_search_text(cls, tool_result: Any) -> str:
        """
        Serialise SearchTool results (list of {title, url, snippet}) as text.
        """
        content = cls._extract_content(tool_result)

        if isinstance(content, dict):
            results = content.get("results", [])
            if results:
                parts = []
                for item in results:
                    title   = item.get("title", "")
                    snippet = item.get("snippet", "")
                    url     = item.get("url", "")
                    if title or snippet:
                        parts.append(
                            f"{title}\n{snippet}\n{url}".strip()
                        )
                return "\n\n".join(parts) if parts else str(content)
            # Fallback: use any "text" field
            if "text" in content:
                return str(content["text"])

        if isinstance(content, str):
            return content

        try:
            return json.dumps(content, default=str)
        except Exception:
            return str(content)

    @classmethod
    def _build_provenance(cls, tool_result: Any) -> dict[str, Any]:
        """Build standard provenance metadata from a ToolResult."""
        return {
            "tool_name":        getattr(tool_result, "tool_name", None),
            "tool_action":      getattr(tool_result, "action", None),
            "tool_success":     getattr(tool_result, "success", False),
            "tool_latency_ms":  getattr(tool_result, "latency_ms", 0),
            "tool_source_url":  getattr(tool_result, "source_url", None),
            "tool_error_code":  getattr(tool_result, "error_code", None),
            "tool_request_id":  getattr(tool_result, "request_id", None),
        }

    @classmethod
    def _build_devtool_provenance(cls, devtool_result: Any) -> dict[str, Any]:
        """Build provenance metadata from a DevToolResult (Phase 16)."""
        base = cls._build_provenance(devtool_result)
        base.update({
            "devtool_source_reference": getattr(devtool_result, "source_reference", None),
            "devtool_mode":             getattr(devtool_result, "metadata", {}).get("mode"),
        })
        return base


# ---------------------------------------------------------------------------
# ToolBackedModuleInput  — factory helper
# ---------------------------------------------------------------------------

class ToolBackedModuleInput:
    """
    Convenience factory for the five supported workflow types.

    Each class method encapsulates the correct adapter call for a named
    workflow, reducing boilerplate at the call site.

    Supported workflows
    ───────────────────
    website_analysis   – BrowserTool → AnalysisModule
    document_pdf       – PdfTool     → SummarizeModule / DocumentModule
    search_summary     – SearchTool  → SummarizeModule
    devtool_code       – DevTool     → CodeModule
    devtool_document   – DevTool     → DocumentModule
    """

    @staticmethod
    def website_analysis(
        browser_result: Any,
        *,
        analysis_type: str = "general",
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """BrowserTool result → AnalysisModule ModuleInput."""
        return ToolResultAdapter.to_module_for_browser(
            browser_result,
            task_type="analysis",
            extra_params={"analysis_type": analysis_type},
            raise_on_failure=raise_on_failure,
        )

    @staticmethod
    def document_pdf(
        pdf_result: Any,
        *,
        style: str = "standard",
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """PdfTool result → SummarizeModule ModuleInput."""
        return ToolResultAdapter.to_module_for_pdf(
            pdf_result,
            task_type="summarize",
            extra_params={"style": style},
            raise_on_failure=raise_on_failure,
        )

    @staticmethod
    def search_summary(
        search_result: Any,
        *,
        max_words: int = 150,
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """SearchTool result → SummarizeModule ModuleInput."""
        return ToolResultAdapter.to_module_for_search(
            search_result,
            task_type="summarize",
            extra_params={"max_words": max_words},
            raise_on_failure=raise_on_failure,
        )

    @staticmethod
    def devtool_code(
        devtool_result: Any,
        *,
        language: str = "python",
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """DevTool result → CodeModule ModuleInput."""
        return ToolResultAdapter.to_module_for_devtool(
            devtool_result,
            task_type="code",
            extra_params={"language": language},
            raise_on_failure=raise_on_failure,
        )

    @staticmethod
    def devtool_document(
        devtool_result: Any,
        *,
        doc_type: str = "general",
        raise_on_failure: bool = False,
    ) -> ModuleInput:
        """DevTool result → DocumentModule ModuleInput."""
        return ToolResultAdapter.to_module_for_devtool(
            devtool_result,
            task_type="document",
            extra_params={"doc_type": doc_type},
            raise_on_failure=raise_on_failure,
        )


# ---------------------------------------------------------------------------
# ModuleOutputComposer
# ---------------------------------------------------------------------------

class ModuleOutputComposer:
    """
    Assembles final structured output from one or more ExecutionResults.

    Composes the results of a multi-step workflow (tool → module) into a
    single, JSON-serialisable response dict.  This is the output surface
    consumed by the API layer or the engine orchestrator.

    Design
    ──────
    • Operates on ExecutionResult objects from app.modules.types.
    • Does not call any provider, tool, or devtool.
    • Always returns a plain Python dict (JSON-serialisable).
    """

    @staticmethod
    def compose_single(
        result: ExecutionResult,
        *,
        include_raw: bool = False,
        include_provenance: bool = True,
    ) -> dict[str, Any]:
        """
        Compose a single ExecutionResult into a structured response dict.

        Parameters
        ----------
        result             : ExecutionResult from ModuleExecutor
        include_raw        : include raw_output in the response (default False)
        include_provenance : include tool-provenance metadata (default True)
        """
        composed: dict[str, Any] = {
            "request_id":       result.request_id,
            "module":           result.module_name,
            "task_type":        result.task_type,
            "success":          result.success,
            "output":           result.normalized_output,
            "validation_passed": result.validation_passed,
            "latency_ms":       result.latency_ms,
            "model":            result.selected_model,
            "provider":         result.selected_provider,
            "fallback_used":    result.fallback_used,
        }

        if not result.success:
            composed["error_code"]    = result.error_code
            composed["error_message"] = result.error_message

        if include_raw:
            composed["raw_output"] = result.raw_output

        return composed

    @staticmethod
    def compose_workflow(
        steps: list[dict[str, Any]],
        *,
        workflow_name: str = "unnamed",
        include_raw: bool = False,
    ) -> dict[str, Any]:
        """
        Compose a multi-step workflow result.

        Parameters
        ----------
        steps         : list of step dicts, each with keys:
                          "step_name" (str), "result" (ExecutionResult)
        workflow_name : label for the composed workflow
        include_raw   : include raw_output per step (default False)
        """
        composed_steps = []
        all_success = True

        for step in steps:
            step_name   = step.get("step_name", "unknown")
            step_result = step.get("result")

            if step_result is None:
                all_success = False
                composed_steps.append({
                    "step_name": step_name,
                    "success":   False,
                    "output":    None,
                    "error_message": "No result provided",
                })
                continue

            step_composed = ModuleOutputComposer.compose_single(
                step_result,
                include_raw=include_raw,
            )
            step_composed["step_name"] = step_name
            composed_steps.append(step_composed)

            if not step_result.success:
                all_success = False

        return {
            "workflow":      workflow_name,
            "success":       all_success,
            "steps":         composed_steps,
            "step_count":    len(steps),
            "steps_passed":  sum(1 for s in composed_steps if s.get("success")),
            "steps_failed":  sum(1 for s in composed_steps if not s.get("success")),
        }

    @staticmethod
    def compose_failure(
        *,
        request_id: str,
        task_type: str,
        error_code: str,
        error_message: str,
        module_name: str = "unknown",
        latency_ms: int = 0,
    ) -> dict[str, Any]:
        """
        Compose a failure response without a full ExecutionResult.

        Used when a tool step fails before the module can run.
        """
        return {
            "request_id":       request_id,
            "module":           module_name,
            "task_type":        task_type,
            "success":          False,
            "output":           None,
            "validation_passed": False,
            "latency_ms":       latency_ms,
            "error_code":       error_code,
            "error_message":    error_message,
        }


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _auto_id() -> str:
    import uuid
    return str(uuid.uuid4())
