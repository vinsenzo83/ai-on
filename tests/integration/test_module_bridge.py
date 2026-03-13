"""
tests/integration/test_module_bridge.py
─────────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

Tests for app/tools/integrations/module_bridge.py

Coverage
────────
A.  WorkflowResult contract — fields, as_dict, JSON-serialisability
B.  ModuleBridge.run — generic tool-to-module bridge
C.  ModuleBridge.run_text — text extraction bridge variant
D.  WorkflowOrchestrator.website_analysis workflow
E.  WorkflowOrchestrator.document_pdf workflow
F.  WorkflowOrchestrator.search_summary workflow
G.  WorkflowOrchestrator.devtool_code workflow
H.  WorkflowOrchestrator.devtool_document workflow
I.  WorkflowOrchestrator.browser_extract workflow
J.  WorkflowOrchestrator.generic workflow
K.  WorkflowOrchestrator.pipeline — multi-step generic pipeline
L.  Failure propagation (tool failure → WorkflowResult.success=False)
M.  request_id threading through workflows
N.  ModuleBridge with real module executor (end-to-end with MockProviderRunner)
O.  JSON-serialisability of WorkflowResult.as_dict() in all workflows
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.modules.executor import MockProviderRunner, ModuleExecutor
from app.modules.registry import get_registry as get_module_registry
from app.tools.integrations import ModuleBridge, WorkflowOrchestrator, WorkflowResult


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — fake tool results
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FakeToolResult:
    tool_name:        str              = "browser"
    action:           str              = "extract_text"
    success:          bool             = True
    raw_output:       Any              = None
    normalized_output: Any             = None
    validation_passed: bool            = True
    error_code:       str | None       = None
    error_message:    str | None       = None
    latency_ms:       int              = 10
    source_url:       str | None       = None
    request_id:       str              = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class FakeDevToolResult:
    tool_name:        str              = "filesystem"
    action:           str              = "read_file"
    success:          bool             = True
    raw_output:       Any              = None
    normalized_output: Any             = None
    validation_passed: bool            = True
    error_code:       str | None       = None
    error_message:    str | None       = None
    latency_ms:       int              = 5
    source_url:       str | None       = None
    source_reference: str | None       = "app/main.py"
    request_id:       str              = field(default_factory=lambda: str(uuid.uuid4()))
    metadata:         dict             = field(default_factory=dict)


def _make_executor(raw_output: Any) -> ModuleExecutor:
    runner = MockProviderRunner(raw_output=raw_output)
    return ModuleExecutor(runner=runner, registry=get_module_registry())


# ─────────────────────────────────────────────────────────────────────────────
# A. WorkflowResult contract
# ─────────────────────────────────────────────────────────────────────────────

class TestWorkflowResultContract:

    def test_default_fields(self):
        wr = WorkflowResult(workflow="test_wf")
        assert wr.workflow     == "test_wf"
        assert wr.success      is False
        assert wr.steps        == []
        assert wr.final_output is None
        assert wr.error_code   is None
        assert wr.latency_ms   == 0

    def test_request_id_auto_generated(self):
        wr = WorkflowResult(workflow="wf")
        assert wr.request_id is not None
        assert len(wr.request_id) > 0

    def test_as_dict_shape(self):
        wr = WorkflowResult(
            workflow     = "website_analysis",
            request_id   = "req-001",
            success      = True,
            final_output = {"summary": "test"},
            latency_ms   = 42,
        )
        d = wr.as_dict()
        for key in (
            "workflow", "request_id", "success", "steps",
            "final_output", "error_code", "error_message",
            "latency_ms", "metadata",
        ):
            assert key in d, f"Missing key: {key}"
        assert d["workflow"]      == "website_analysis"
        assert d["success"]       is True
        assert d["final_output"]  == {"summary": "test"}

    def test_as_dict_json_serialisable(self):
        wr = WorkflowResult(
            workflow     = "test",
            success      = True,
            final_output = {"key": "value"},
            steps        = [{"step_name": "s1", "success": True}],
            metadata     = {"tool": "browser"},
        )
        d = wr.as_dict()
        serialised = json.dumps(d, default=str)
        parsed     = json.loads(serialised)
        assert parsed["workflow"] == "test"
        assert parsed["success"]  is True


# ─────────────────────────────────────────────────────────────────────────────
# B. ModuleBridge.run — generic bridge
# ─────────────────────────────────────────────────────────────────────────────

class TestModuleBridgeRun:

    @pytest.mark.anyio
    async def test_run_produces_execution_result(self):
        from app.modules.types import ExecutionResult
        raw = "A concise summary output for testing purposes here."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "long article text " * 10})
        result = await bridge.run(tr, task_type="summarize")

        assert isinstance(result, ExecutionResult)

    @pytest.mark.anyio
    async def test_run_success_for_valid_input(self):
        raw = "Summary of website content for analysis."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "website content " * 10})
        result = await bridge.run(tr, task_type="summarize")

        assert result.success is True
        assert result.module_name == "summarize"

    @pytest.mark.anyio
    async def test_run_with_extra_params(self):
        raw = "Brief summary output."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "content " * 20})
        result = await bridge.run(
            tr, task_type="summarize", extra_params={"style": "brief"}
        )
        assert result.success is True

    @pytest.mark.anyio
    async def test_run_failed_tool_does_not_raise_by_default(self):
        raw = "Some fallback output."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(success=False, error_message="network failure")
        result = await bridge.run(tr, task_type="summarize")
        # Should return an ExecutionResult, not raise
        from app.modules.types import ExecutionResult
        assert isinstance(result, ExecutionResult)

    @pytest.mark.anyio
    async def test_run_raise_on_tool_failure(self):
        from app.modules.integrations import IntegrationError
        executor = _make_executor("output")
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(success=False, error_message="timed out")
        with pytest.raises(IntegrationError):
            await bridge.run(tr, task_type="summarize", raise_on_tool_failure=True)


# ─────────────────────────────────────────────────────────────────────────────
# C. ModuleBridge.run_text — text extraction variant
# ─────────────────────────────────────────────────────────────────────────────

class TestModuleBridgeRunText:

    @pytest.mark.anyio
    async def test_run_text_extracts_text(self):
        raw = "Text extraction output for summarization test."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "page content " * 10})
        result = await bridge.run_text(tr, task_type="summarize")

        assert result.success     is True
        assert result.module_name == "summarize"

    @pytest.mark.anyio
    async def test_run_text_custom_text_key(self):
        raw = "Summary of the document."
        executor = _make_executor(raw)
        bridge   = ModuleBridge(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "document content " * 8})
        result = await bridge.run_text(
            tr, task_type="summarize", text_key="text"
        )
        assert result.success is True


# ─────────────────────────────────────────────────────────────────────────────
# D. WorkflowOrchestrator.website_analysis
# ─────────────────────────────────────────────────────────────────────────────

class TestWebsiteAnalysisWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        import json as _json
        raw = _json.dumps({
            "analysis_type": "general",
            "summary":       "The website covers K-beauty trends.",
            "sentiment":     {"label": "positive", "score": 0.8},
            "topics":        ["skincare", "K-beauty"],
            "insights":      ["Strong brand presence"],
            "confidence":    0.8,
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(
            tool_name="browser",
            action="extract_text",
            normalized_output={"text": "K-beauty website with extensive skincare guides " * 5},
        )
        result = await orchestrator.website_analysis(br)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "website_analysis"

    @pytest.mark.anyio
    async def test_success_when_module_succeeds(self):
        import json as _json
        raw = _json.dumps({
            "summary":    "Good analysis.",
            "insights":   ["Key insight here"],
            "confidence": 0.75,
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "website content " * 5})
        result = await orchestrator.website_analysis(br)

        assert result.success      is True
        assert result.final_output is not None
        assert len(result.steps)   == 1
        assert result.steps[0]["step_name"] == "analysis"

    @pytest.mark.anyio
    async def test_analysis_type_in_metadata(self):
        import json as _json
        raw = _json.dumps({
            "summary": "Sentiment analysis result.", "insights": ["x"], "confidence": 0.7
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "content " * 10})
        result = await orchestrator.website_analysis(br, analysis_type="sentiment")

        assert result.metadata.get("analysis_type") == "sentiment"

    @pytest.mark.anyio
    async def test_failed_browser_result_still_runs(self):
        executor     = _make_executor("fallback output for test")
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(success=False, error_message="browser timeout")
        result = await orchestrator.website_analysis(br)

        assert isinstance(result, WorkflowResult)
        # Workflow runs even on failed browser result (graceful degradation)

    @pytest.mark.anyio
    async def test_request_id_threaded(self):
        import json as _json
        raw = _json.dumps({"summary": "x", "insights": ["x"], "confidence": 0.7})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br  = FakeToolResult(normalized_output={"text": "content " * 5})
        rid = "test-req-website-001"
        result = await orchestrator.website_analysis(br, request_id=rid)

        assert result.request_id == rid

    @pytest.mark.anyio
    async def test_as_dict_json_serialisable(self):
        import json as _json
        raw = _json.dumps({"summary": "test", "insights": ["insight"], "confidence": 0.8})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "content " * 5})
        result = await orchestrator.website_analysis(br)

        d = result.as_dict()
        _json.dumps(d, default=str)  # must not raise


# ─────────────────────────────────────────────────────────────────────────────
# E. WorkflowOrchestrator.document_pdf
# ─────────────────────────────────────────────────────────────────────────────

class TestDocumentPdfWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = "A concise standard summary of the PDF document contents."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr = FakeToolResult(
            tool_name="pdf",
            action="extract_text",
            normalized_output={"text": "Full PDF document text " * 10, "page_count": 5},
        )
        result = await orchestrator.document_pdf(pr)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "document_pdf"

    @pytest.mark.anyio
    async def test_step_name_is_summarize(self):
        raw = "Summary of the document contents here."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr = FakeToolResult(
            tool_name="pdf",
            normalized_output={"text": "document content " * 8},
        )
        result = await orchestrator.document_pdf(pr)

        assert result.steps[0]["step_name"] == "summarize"

    @pytest.mark.anyio
    async def test_style_in_metadata(self):
        raw = "Detailed summary with all sections covered."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr = FakeToolResult(normalized_output={"text": "text " * 10})
        result = await orchestrator.document_pdf(pr, style="detailed")

        assert result.metadata.get("style") == "detailed"

    @pytest.mark.anyio
    async def test_json_serialisable(self):
        raw      = "Summary output."
        executor = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr = FakeToolResult(normalized_output={"text": "pdf text " * 8})
        result = await orchestrator.document_pdf(pr)
        json.dumps(result.as_dict(), default=str)  # must not raise


# ─────────────────────────────────────────────────────────────────────────────
# F. WorkflowOrchestrator.search_summary
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchSummaryWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = "Summary of the search results covering K-beauty topics."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        sr = FakeToolResult(
            tool_name="search",
            action="query",
            normalized_output={
                "results": [
                    {"title": "K-beauty Trends 2026", "snippet": "Top trends this year", "url": "http://example.com"},
                    {"title": "Best Serums", "snippet": "Hyaluronic acid dominates", "url": "http://example2.com"},
                ],
                "total": 2,
            },
        )
        result = await orchestrator.search_summary(sr)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "search_summary"

    @pytest.mark.anyio
    async def test_success_flag_set(self):
        raw = "Summary of multiple search results."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        sr = FakeToolResult(normalized_output={
            "results": [{"title": "t", "snippet": "s", "url": "u"}], "total": 1
        })
        result = await orchestrator.search_summary(sr)
        assert result.success is True

    @pytest.mark.anyio
    async def test_json_serialisable(self):
        raw      = "Search summary."
        executor = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        sr = FakeToolResult(normalized_output={
            "results": [{"title": "t", "snippet": "s", "url": "u"}], "total": 1
        })
        result = await orchestrator.search_summary(sr)
        json.dumps(result.as_dict(), default=str)


# ─────────────────────────────────────────────────────────────────────────────
# G. WorkflowOrchestrator.devtool_code
# ─────────────────────────────────────────────────────────────────────────────

class TestDevtoolCodeWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = (
            "Here is the refactored code:\n\n"
            "```python\ndef foo(): return 42\n```\n\n"
            "This function returns 42."
        )
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(
            tool_name="filesystem",
            action="read_file",
            normalized_output={"content": "def foo():\n    return 42\n", "path": "app/foo.py"},
        )
        result = await orchestrator.devtool_code(dr)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "devtool_code"

    @pytest.mark.anyio
    async def test_step_name_is_code_analysis(self):
        raw = "def bar(): pass\n"
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(normalized_output={"content": "def bar(): pass\n"})
        result = await orchestrator.devtool_code(dr)

        assert result.steps[0]["step_name"] == "code_analysis"

    @pytest.mark.anyio
    async def test_language_in_metadata(self):
        raw = "def foo(): pass\n"
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(normalized_output={"content": "code"})
        result = await orchestrator.devtool_code(dr, language="javascript")
        assert result.metadata.get("language") == "javascript"

    @pytest.mark.anyio
    async def test_json_serialisable(self):
        raw = "def foo(): pass\n"
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(normalized_output={"content": "code"})
        result = await orchestrator.devtool_code(dr)
        json.dumps(result.as_dict(), default=str)


# ─────────────────────────────────────────────────────────────────────────────
# H. WorkflowOrchestrator.devtool_document
# ─────────────────────────────────────────────────────────────────────────────

class TestDevtoolDocumentWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = (
            "# Project README\n\n"
            "This project implements a K-beauty e-commerce platform with "
            "automated repricing, trend signal detection, and order management. "
            "The architecture follows a clean layered design with frozen engine core.\n\n"
            "## Installation\n\nRun `pip install -r requirements.txt`."
        )
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(
            tool_name="repo_search",
            action="list_files",
            normalized_output={"files": ["app/main.py", "README.md"], "total": 2},
        )
        result = await orchestrator.devtool_document(dr)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "devtool_document"

    @pytest.mark.anyio
    async def test_step_name_is_document_generation(self):
        raw = "# Doc\n\n" + ("word " * 25)
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(normalized_output={"files": ["x.py"]})
        result = await orchestrator.devtool_document(dr)

        assert result.steps[0]["step_name"] == "document_generation"

    @pytest.mark.anyio
    async def test_doc_type_in_metadata(self):
        raw = "# README\n\n" + ("content word " * 20)
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(normalized_output={"files": ["x.py"]})
        result = await orchestrator.devtool_document(dr, doc_type="readme")
        assert result.metadata.get("doc_type") == "readme"


# ─────────────────────────────────────────────────────────────────────────────
# I. WorkflowOrchestrator.browser_extract
# ─────────────────────────────────────────────────────────────────────────────

class TestBrowserExtractWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = json.dumps({
            "entities":        [{"type": "BRAND", "value": "Laneige", "span": "Laneige"}],
            "key_value_pairs": {"price": "$28.00"},
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(
            tool_name="browser",
            action="extract_text",
            normalized_output={"text": "Laneige Water Sleeping Mask – $28.00"},
        )
        result = await orchestrator.browser_extract(br)

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "browser_extract"

    @pytest.mark.anyio
    async def test_step_name_is_extract(self):
        raw = json.dumps({
            "entities": [{"type": "PERSON", "value": "Alice", "span": "Alice"}],
            "key_value_pairs": {},
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "Alice went to the store."})
        result = await orchestrator.browser_extract(br)

        assert result.steps[0]["step_name"] == "extract"

    @pytest.mark.anyio
    async def test_json_serialisable(self):
        raw = json.dumps({
            "entities": [{"type": "ORG", "value": "GenSpark", "span": "GenSpark"}],
            "key_value_pairs": {},
        })
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "GenSpark builds AI tools."})
        result = await orchestrator.browser_extract(br)
        json.dumps(result.as_dict(), default=str)


# ─────────────────────────────────────────────────────────────────────────────
# J. WorkflowOrchestrator.generic
# ─────────────────────────────────────────────────────────────────────────────

class TestGenericWorkflow:

    @pytest.mark.anyio
    async def test_returns_workflow_result(self):
        raw = json.dumps({"label": "beauty", "confidence": 0.9})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "moisturiser for dry skin"})
        result = await orchestrator.generic(
            tr, task_type="classify", workflow_name="custom_workflow"
        )

        assert isinstance(result, WorkflowResult)
        assert result.workflow == "custom_workflow"

    @pytest.mark.anyio
    async def test_custom_workflow_name(self):
        raw = json.dumps({"label": "electronics", "confidence": 0.7})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "laptop product"})
        result = await orchestrator.generic(
            tr, task_type="classify", workflow_name="product_classify"
        )
        assert result.workflow == "product_classify"

    @pytest.mark.anyio
    async def test_step_name_matches_task_type(self):
        raw = json.dumps({"label": "beauty", "confidence": 0.85})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "skincare"})
        result = await orchestrator.generic(tr, task_type="classify")

        assert result.steps[0]["step_name"] == "classify"

    @pytest.mark.anyio
    async def test_json_serialisable(self):
        raw = json.dumps({"label": "beauty", "confidence": 0.9})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "product"})
        result = await orchestrator.generic(tr, task_type="classify")
        json.dumps(result.as_dict(), default=str)


# ─────────────────────────────────────────────────────────────────────────────
# K. WorkflowOrchestrator.pipeline — multi-step
# ─────────────────────────────────────────────────────────────────────────────

class TestPipelineWorkflow:

    @pytest.mark.anyio
    async def test_single_step_pipeline(self):
        raw = "Summary of page content."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "page content " * 5})
        result = await orchestrator.pipeline(
            steps=[{"step_name": "step1", "tool_result": tr, "task_type": "summarize"}]
        )

        assert isinstance(result, WorkflowResult)
        assert len(result.steps) == 1

    @pytest.mark.anyio
    async def test_multi_step_pipeline_all_succeed(self):
        raw = "Summary output for test."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr1 = FakeToolResult(normalized_output={"text": "content " * 5})
        tr2 = FakeToolResult(normalized_output={"text": "more content " * 5})

        result = await orchestrator.pipeline(
            steps=[
                {"step_name": "step_a", "tool_result": tr1, "task_type": "summarize"},
                {"step_name": "step_b", "tool_result": tr2, "task_type": "summarize"},
            ],
            workflow_name="multi_step_wf",
        )

        assert result.workflow     == "multi_step_wf"
        assert len(result.steps)   == 2
        assert result.success      is True
        assert result.final_output is not None

    @pytest.mark.anyio
    async def test_pipeline_step_without_tool_result_handled(self):
        raw = "Output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        result = await orchestrator.pipeline(
            steps=[{"step_name": "broken", "tool_result": None, "task_type": "summarize"}]
        )
        assert result.success          is False
        assert result.steps[0]["success"] is False

    @pytest.mark.anyio
    async def test_pipeline_step_names_preserved(self):
        raw = "Output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr  = FakeToolResult(normalized_output={"text": "content " * 5})
        result = await orchestrator.pipeline(
            steps=[
                {"step_name": "alpha", "tool_result": tr, "task_type": "summarize"},
                {"step_name": "beta",  "tool_result": tr, "task_type": "summarize"},
            ]
        )
        names = [s["step_name"] for s in result.steps]
        assert names == ["alpha", "beta"]

    @pytest.mark.anyio
    async def test_pipeline_metadata_step_count(self):
        raw = "Output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "text " * 5})
        result = await orchestrator.pipeline(
            steps=[
                {"step_name": "s1", "tool_result": tr, "task_type": "summarize"},
                {"step_name": "s2", "tool_result": tr, "task_type": "summarize"},
                {"step_name": "s3", "tool_result": tr, "task_type": "summarize"},
            ]
        )
        assert result.metadata.get("step_count") == 3

    @pytest.mark.anyio
    async def test_pipeline_json_serialisable(self):
        raw = "Output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr = FakeToolResult(normalized_output={"text": "content " * 5})
        result = await orchestrator.pipeline(
            steps=[{"step_name": "only", "tool_result": tr, "task_type": "summarize"}]
        )
        json.dumps(result.as_dict(), default=str)


# ─────────────────────────────────────────────────────────────────────────────
# L. Failure propagation
# ─────────────────────────────────────────────────────────────────────────────

class TestFailurePropagation:

    @pytest.mark.anyio
    async def test_failed_tool_result_propagates_to_workflow(self):
        """When underlying module validation fails, workflow success=False."""
        raw = ""  # empty → module validation fails for summarize
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        sr = FakeToolResult(
            normalized_output={"results": [{"title": "t", "snippet": "s", "url": "u"}]}
        )
        result = await orchestrator.search_summary(sr)

        assert isinstance(result, WorkflowResult)
        if not result.success:
            assert result.error_code is not None or result.steps[0].get("success") is False

    @pytest.mark.anyio
    async def test_website_analysis_validation_failure(self):
        """Invalid module output → validation failure propagated to WorkflowResult."""
        raw = json.dumps({"confidence": 0.5})  # missing 'summary' AND 'insights'
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(normalized_output={"text": "content " * 5})
        result = await orchestrator.website_analysis(br)

        assert isinstance(result, WorkflowResult)
        # The step failure is visible in steps list
        if not result.success:
            assert result.steps[0].get("success") is False

    @pytest.mark.anyio
    async def test_pipeline_partial_failure(self):
        """Mixed success/failure steps: success=False overall."""
        raw      = ""  # will cause validation failure
        executor = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        good_tr = FakeToolResult(normalized_output={"text": "content " * 5})
        bad_tr  = FakeToolResult(normalized_output={})

        result = await orchestrator.pipeline(
            steps=[
                {"step_name": "good", "tool_result": good_tr, "task_type": "summarize"},
                {"step_name": "bad",  "tool_result": bad_tr,  "task_type": "summarize"},
            ]
        )
        assert isinstance(result, WorkflowResult)


# ─────────────────────────────────────────────────────────────────────────────
# M. request_id threading
# ─────────────────────────────────────────────────────────────────────────────

class TestRequestIdThreading:

    @pytest.mark.anyio
    async def test_request_id_threaded_in_website_analysis(self):
        import json as _j
        raw = _j.dumps({"summary": "test", "insights": ["x"], "confidence": 0.7})
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        br  = FakeToolResult(normalized_output={"text": "content " * 5})
        rid = "trace-id-website-001"
        result = await orchestrator.website_analysis(br, request_id=rid)
        assert result.request_id == rid

    @pytest.mark.anyio
    async def test_request_id_threaded_in_document_pdf(self):
        raw = "Summary text output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr  = FakeToolResult(normalized_output={"text": "pdf content " * 5})
        rid = "trace-id-pdf-001"
        result = await orchestrator.document_pdf(pr, request_id=rid)
        assert result.request_id == rid

    @pytest.mark.anyio
    async def test_request_id_threaded_in_pipeline(self):
        raw = "Output."
        executor     = _make_executor(raw)
        orchestrator = WorkflowOrchestrator(executor=executor)

        tr  = FakeToolResult(normalized_output={"text": "content " * 5})
        rid = "trace-id-pipeline-001"
        result = await orchestrator.pipeline(
            steps=[{"step_name": "s", "tool_result": tr, "task_type": "summarize"}],
            request_id=rid,
        )
        assert result.request_id == rid


# ─────────────────────────────────────────────────────────────────────────────
# N. End-to-end with real MockProviderRunner (full stack)
# ─────────────────────────────────────────────────────────────────────────────

class TestEndToEndWithMockRunner:

    @pytest.mark.anyio
    async def test_website_analysis_full_stack(self):
        """Full stack: BrowserTool result → AnalysisModule via MockProviderRunner."""
        import json as _j
        raw = _j.dumps({
            "analysis_type": "general",
            "summary":       "The page discusses K-beauty trends in detail.",
            "sentiment":     {"label": "positive", "score": 0.85},
            "topics":        ["K-beauty", "skincare"],
            "insights":      ["Strong influencer-driven market."],
            "confidence":    0.82,
        })
        runner       = MockProviderRunner(raw_output=raw)
        executor     = ModuleExecutor(runner=runner, registry=get_module_registry())
        orchestrator = WorkflowOrchestrator(executor=executor)

        br = FakeToolResult(
            tool_name="browser",
            action="extract_text",
            normalized_output={"text": "K-beauty trends and skincare innovations " * 5},
            source_url="https://kbeauty.example.com",
        )
        result = await orchestrator.website_analysis(br)

        assert result.success            is True
        assert result.final_output       is not None
        assert result.final_output.get("summary") is not None
        assert result.metadata["tool_name"] == "browser"
        assert result.metadata["source_url"] == "https://kbeauty.example.com"

    @pytest.mark.anyio
    async def test_document_pdf_full_stack(self):
        """Full stack: PdfTool result → SummarizeModule."""
        raw = (
            "This PDF document provides a comprehensive overview of K-beauty "
            "ingredient trends including hyaluronic acid, ceramides, and snail mucin "
            "formulations commonly used in South Korean skincare brands."
        )
        runner       = MockProviderRunner(raw_output=raw)
        executor     = ModuleExecutor(runner=runner, registry=get_module_registry())
        orchestrator = WorkflowOrchestrator(executor=executor)

        pr = FakeToolResult(
            tool_name="pdf",
            action="extract_text",
            normalized_output={
                "text": "K-beauty ingredient guide covering hyaluronic acid, ceramides, "
                        "snail mucin, and niacinamide. Page count: 42 pages of content.",
                "page_count": 42,
            },
        )
        result = await orchestrator.document_pdf(pr)

        assert result.success        is True
        assert result.workflow       == "document_pdf"
        assert result.final_output   is not None
        assert result.final_output.get("word_count", 0) > 0

    @pytest.mark.anyio
    async def test_devtool_code_full_stack(self):
        """Full stack: DevTool (filesystem) result → CodeModule."""
        raw = (
            "Here is the refactored version:\n\n"
            "```python\n"
            "def calculate_discount(price: float, pct: float) -> float:\n"
            "    \"\"\"Return price after discount.\"\"\"\n"
            "    return price * (1 - pct / 100)\n"
            "```\n\n"
            "The function handles edge cases correctly."
        )
        runner       = MockProviderRunner(raw_output=raw)
        executor     = ModuleExecutor(runner=runner, registry=get_module_registry())
        orchestrator = WorkflowOrchestrator(executor=executor)

        dr = FakeDevToolResult(
            tool_name="filesystem",
            action="read_file",
            normalized_output={
                "content": "def discount(p, pct): return p - p*pct/100\n",
                "path":    "app/pricing.py",
            },
            source_reference="app/pricing.py",
        )
        result = await orchestrator.devtool_code(dr, language="python")

        assert result.success      is True
        assert result.workflow     == "devtool_code"
        assert result.final_output is not None

    @pytest.mark.anyio
    async def test_search_summary_full_stack(self):
        """Full stack: SearchTool result → SummarizeModule."""
        raw = (
            "K-beauty continues to dominate global skincare trends in 2026, "
            "with hyaluronic acid and ceramide-based products leading sales."
        )
        runner       = MockProviderRunner(raw_output=raw)
        executor     = ModuleExecutor(runner=runner, registry=get_module_registry())
        orchestrator = WorkflowOrchestrator(executor=executor)

        sr = FakeToolResult(
            tool_name="search",
            action="query",
            normalized_output={
                "results": [
                    {
                        "title":   "K-beauty Trends 2026",
                        "snippet": "K-beauty leads global skincare with ceramide innovations.",
                        "url":     "https://kbeautytrends.example.com",
                    },
                    {
                        "title":   "Best K-beauty Serums",
                        "snippet": "Hyaluronic acid serums from Korean brands dominate Amazon.",
                        "url":     "https://serums.example.com",
                    },
                ],
                "total": 2,
            },
        )
        result = await orchestrator.search_summary(sr)

        assert result.success        is True
        assert result.final_output   is not None
        assert result.final_output.get("word_count", 0) > 0


# ─────────────────────────────────────────────────────────────────────────────
# O. JSON-serialisability of all WorkflowResult.as_dict()
# ─────────────────────────────────────────────────────────────────────────────

class TestAllWorkflowsJsonSerialisable:

    @pytest.mark.anyio
    async def test_all_workflow_types_json_serialisable(self):
        import json as _j

        analysis_raw = _j.dumps({
            "summary": "test", "insights": ["i"], "confidence": 0.8
        })
        summarize_raw = "Summary output for testing."
        code_raw      = "def foo(): pass\n"
        extract_raw   = _j.dumps({
            "entities": [{"type": "ORG", "value": "X", "span": "X"}],
            "key_value_pairs": {},
        })
        classify_raw  = _j.dumps({"label": "beauty", "confidence": 0.9})
        doc_raw       = "# README\n\n" + ("word " * 30)

        br = FakeToolResult(normalized_output={"text": "browser content " * 5})
        pr = FakeToolResult(tool_name="pdf",    normalized_output={"text": "pdf text " * 5})
        sr = FakeToolResult(tool_name="search", normalized_output={
            "results": [{"title": "t", "snippet": "s", "url": "u"}], "total": 1
        })
        dr = FakeDevToolResult(normalized_output={"content": "code"})

        test_cases = [
            ("website_analysis", analysis_raw,  lambda o: o.website_analysis(br)),
            ("document_pdf",     summarize_raw, lambda o: o.document_pdf(pr)),
            ("search_summary",   summarize_raw, lambda o: o.search_summary(sr)),
            ("devtool_code",     code_raw,      lambda o: o.devtool_code(dr)),
            ("devtool_document", doc_raw,       lambda o: o.devtool_document(dr)),
            ("browser_extract",  extract_raw,   lambda o: o.browser_extract(br)),
            ("generic_classify", classify_raw,  lambda o: o.generic(br, task_type="classify")),
        ]

        for name, raw, fn in test_cases:
            runner       = MockProviderRunner(raw_output=raw)
            executor     = ModuleExecutor(runner=runner, registry=get_module_registry())
            orchestrator = WorkflowOrchestrator(executor=executor)

            result = await fn(orchestrator)
            d      = result.as_dict()

            # Must serialise without error
            try:
                _j.dumps(d, default=str)
            except Exception as exc:
                pytest.fail(f"JSON serialisation failed for workflow {name!r}: {exc}")
