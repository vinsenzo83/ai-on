"""
tests/integration/test_tool_adapters.py
─────────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

Tests for app/modules/integrations/tool_adapters.py

Coverage
────────
A.  ToolResultAdapter.to_module_input — generic adapter
B.  ToolResultAdapter.to_module_text  — text extraction adapter
C.  ToolResultAdapter.to_module_for_pdf   — PDF specialised adapter
D.  ToolResultAdapter.to_module_for_browser — browser specialised adapter
E.  ToolResultAdapter.to_module_for_search  — search specialised adapter
F.  ToolResultAdapter.to_module_for_devtool — devtool specialised adapter
G.  ToolBackedModuleInput factory methods
H.  ModuleOutputComposer.compose_single
I.  ModuleOutputComposer.compose_workflow
J.  ModuleOutputComposer.compose_failure
K.  IntegrationError semantics
L.  Provenance metadata injected correctly
M.  raise_on_failure contract
N.  JSON-serialisability of all adapter outputs
O.  Text extraction edge cases (dict/str/html/fallback)
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.modules.integrations import (
    IntegrationError,
    ModuleOutputComposer,
    ToolBackedModuleInput,
    ToolResultAdapter,
)
from app.modules.types import ExecutionResult, ModuleInput


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures — fake ToolResult / DevToolResult (duck-typed)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FakeToolResult:
    tool_name:        str              = "search"
    action:           str              = "query"
    success:          bool             = True
    raw_output:       Any              = None
    normalized_output: Any             = None
    validation_passed: bool            = True
    error_code:       str | None       = None
    error_message:    str | None       = None
    latency_ms:       int              = 42
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
    latency_ms:       int              = 15
    source_url:       str | None       = None
    source_reference: str | None       = "app/main.py"
    request_id:       str              = field(default_factory=lambda: str(uuid.uuid4()))
    metadata:         dict             = field(default_factory=dict)


def _make_execution_result(
    *,
    success: bool = True,
    module_name: str = "summarize",
    task_type: str = "summarize",
    normalized_output: Any = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> ExecutionResult:
    return ExecutionResult(
        request_id        = str(uuid.uuid4()),
        module_name       = module_name,
        task_type         = task_type,
        selected_provider = "mock",
        selected_model    = "mock-model",
        success           = success,
        normalized_output = normalized_output or {"summary": "test", "word_count": 5},
        validation_passed = success,
        error_code        = error_code,
        error_message     = error_message,
        latency_ms        = 20,
    )


# ─────────────────────────────────────────────────────────────────────────────
# A. to_module_input — generic adapter
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleInputGeneric:

    def test_returns_module_input(self):
        tr = FakeToolResult(normalized_output={"text": "hello"})
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert isinstance(mi, ModuleInput)

    def test_task_type_set(self):
        tr = FakeToolResult()
        mi = ToolResultAdapter.to_module_input(tr, task_type="analysis")
        assert mi.task_type == "analysis"

    def test_raw_input_uses_normalized_output_first(self):
        norm = {"text": "normalized content"}
        tr   = FakeToolResult(normalized_output=norm, raw_output="raw")
        mi   = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.raw_input == norm

    def test_raw_input_falls_back_to_raw_output(self):
        tr = FakeToolResult(normalized_output=None, raw_output="raw content")
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.raw_input == "raw content"

    def test_raw_input_empty_dict_when_no_output(self):
        tr = FakeToolResult(normalized_output=None, raw_output=None)
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.raw_input == {}

    def test_extra_params_merged_into_dict_raw_input(self):
        tr = FakeToolResult(normalized_output={"text": "hello"})
        mi = ToolResultAdapter.to_module_input(
            tr, task_type="summarize", extra_params={"max_words": 100}
        )
        assert mi.raw_input["max_words"] == 100
        assert mi.raw_input["text"] == "hello"

    def test_extra_params_wrapped_when_raw_input_is_string(self):
        tr = FakeToolResult(normalized_output=None, raw_output="plain text")
        mi = ToolResultAdapter.to_module_input(
            tr, task_type="summarize", extra_params={"style": "brief"}
        )
        assert isinstance(mi.raw_input, dict)
        assert mi.raw_input["content"] == "plain text"
        assert mi.raw_input["style"] == "brief"

    def test_request_id_threaded_from_tool_result(self):
        rid = "fixed-req-id-001"
        tr  = FakeToolResult(request_id=rid)
        mi  = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.request_id == rid

    def test_provenance_metadata_injected(self):
        tr = FakeToolResult(tool_name="pdf", action="extract_text", latency_ms=88)
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.metadata["tool_name"]       == "pdf"
        assert mi.metadata["tool_action"]     == "extract_text"
        assert mi.metadata["tool_latency_ms"] == 88
        assert mi.metadata["tool_success"]    is True

    def test_failed_tool_result_does_not_raise_by_default(self):
        tr = FakeToolResult(success=False, error_message="timeout")
        # Should not raise
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.metadata["tool_success"] is False

    def test_raise_on_failure_raises_integration_error(self):
        tr = FakeToolResult(success=False, error_message="network error")
        with pytest.raises(IntegrationError):
            ToolResultAdapter.to_module_input(
                tr, task_type="summarize", raise_on_failure=True
            )


# ─────────────────────────────────────────────────────────────────────────────
# B. to_module_text — text extraction adapter
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleText:

    def test_extracts_text_key_from_dict(self):
        tr = FakeToolResult(normalized_output={"text": "extracted page content"})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert mi.raw_input["text"] == "extracted page content"

    def test_uses_custom_text_key(self):
        tr = FakeToolResult(normalized_output={"text": "some content"})
        mi = ToolResultAdapter.to_module_text(
            tr, task_type="summarize", text_key="content"
        )
        assert "content" in mi.raw_input
        assert mi.raw_input["content"] == "some content"

    def test_extracts_from_string_output(self):
        tr = FakeToolResult(normalized_output=None, raw_output="plain string output")
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert mi.raw_input["text"] == "plain string output"

    def test_extracts_from_html_field(self):
        tr = FakeToolResult(normalized_output={
            "html":  "<h1>Title</h1><p>Body text here.</p>",
            "title": "My Page",
        })
        mi = ToolResultAdapter.to_module_text(tr, task_type="analysis")
        text = mi.raw_input["text"]
        assert "Title" in text or "Body text" in text

    def test_extra_params_merged(self):
        tr = FakeToolResult(normalized_output={"text": "hello world"})
        mi = ToolResultAdapter.to_module_text(
            tr, task_type="summarize", extra_params={"max_words": 50}
        )
        assert mi.raw_input["max_words"] == 50

    def test_raise_on_failure_raises(self):
        tr = FakeToolResult(success=False, error_message="failed")
        with pytest.raises(IntegrationError):
            ToolResultAdapter.to_module_text(
                tr, task_type="summarize", raise_on_failure=True
            )

    def test_fallback_to_json_for_unknown_dict(self):
        tr = FakeToolResult(normalized_output={"page_count": 5, "metadata": {}})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        # Should produce some string, not crash
        assert isinstance(mi.raw_input["text"], str)
        assert len(mi.raw_input["text"]) > 0

    def test_stdout_field_extracted(self):
        tr = FakeToolResult(normalized_output={"stdout": "test output here", "exit_code": 0})
        mi = ToolResultAdapter.to_module_text(tr, task_type="analysis")
        assert mi.raw_input["text"] == "test output here"


# ─────────────────────────────────────────────────────────────────────────────
# C. to_module_for_pdf
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleForPdf:

    def test_task_type_defaults_to_summarize(self):
        tr = FakeToolResult(
            tool_name="pdf",
            action="extract_text",
            normalized_output={"text": "PDF content here", "page_count": 3},
        )
        mi = ToolResultAdapter.to_module_for_pdf(tr)
        assert mi.task_type == "summarize"

    def test_custom_task_type_respected(self):
        tr = FakeToolResult(
            tool_name="pdf",
            normalized_output={"text": "pdf text"},
        )
        mi = ToolResultAdapter.to_module_for_pdf(tr, task_type="extract")
        assert mi.task_type == "extract"

    def test_text_extracted_from_pdf_normalized_output(self):
        tr = FakeToolResult(
            tool_name="pdf",
            normalized_output={"text": "First page content.", "page_count": 1},
        )
        mi = ToolResultAdapter.to_module_for_pdf(tr)
        assert mi.raw_input["text"] == "First page content."

    def test_extra_params_style_merged(self):
        tr = FakeToolResult(
            tool_name="pdf",
            normalized_output={"text": "content"},
        )
        mi = ToolResultAdapter.to_module_for_pdf(tr, extra_params={"style": "brief"})
        assert mi.raw_input.get("style") == "brief"

    def test_tool_name_in_metadata(self):
        tr = FakeToolResult(tool_name="pdf", normalized_output={"text": "x"})
        mi = ToolResultAdapter.to_module_for_pdf(tr)
        assert mi.metadata["tool_name"] == "pdf"


# ─────────────────────────────────────────────────────────────────────────────
# D. to_module_for_browser
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleForBrowser:

    def test_task_type_defaults_to_analysis(self):
        tr = FakeToolResult(
            tool_name="browser",
            action="extract_text",
            normalized_output={"text": "page text", "word_count": 100},
        )
        mi = ToolResultAdapter.to_module_for_browser(tr)
        assert mi.task_type == "analysis"

    def test_custom_task_type(self):
        tr = FakeToolResult(
            tool_name="browser",
            normalized_output={"text": "page text"},
        )
        mi = ToolResultAdapter.to_module_for_browser(tr, task_type="summarize")
        assert mi.task_type == "summarize"

    def test_page_text_extracted(self):
        tr = FakeToolResult(
            tool_name="browser",
            normalized_output={"text": "Website main content", "word_count": 3},
        )
        mi = ToolResultAdapter.to_module_for_browser(tr)
        assert mi.raw_input["text"] == "Website main content"

    def test_html_fields_extracted(self):
        tr = FakeToolResult(
            tool_name="browser",
            action="fetch",
            normalized_output={
                "url": "https://example.com",
                "html": "<html><body><p>Hello World</p></body></html>",
                "title": "Example Domain",
            },
        )
        mi = ToolResultAdapter.to_module_for_browser(tr)
        text = mi.raw_input["text"]
        assert "Hello World" in text or "Example" in text

    def test_metadata_source_url(self):
        tr = FakeToolResult(
            tool_name="browser",
            normalized_output={"text": "content"},
            source_url="https://example.com",
        )
        mi = ToolResultAdapter.to_module_for_browser(tr)
        assert mi.metadata["tool_source_url"] == "https://example.com"


# ─────────────────────────────────────────────────────────────────────────────
# E. to_module_for_search
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleForSearch:

    def test_task_type_defaults_to_summarize(self):
        tr = FakeToolResult(
            tool_name="search",
            action="query",
            normalized_output={
                "results": [
                    {"title": "Result 1", "snippet": "Some snippet", "url": "http://a.com"},
                ],
                "total": 1,
            },
        )
        mi = ToolResultAdapter.to_module_for_search(tr)
        assert mi.task_type == "summarize"

    def test_results_serialised_as_text(self):
        tr = FakeToolResult(
            tool_name="search",
            normalized_output={
                "results": [
                    {"title": "K-beauty Trends", "snippet": "Top skincare trends for 2026", "url": "http://kb.com"},
                    {"title": "Best Serums", "snippet": "Hyaluronic acid dominates", "url": "http://s.com"},
                ],
                "total": 2,
            },
        )
        mi = ToolResultAdapter.to_module_for_search(tr)
        text = mi.raw_input["text"]
        assert "K-beauty" in text or "skincare" in text

    def test_empty_results_produces_string(self):
        tr = FakeToolResult(
            tool_name="search",
            normalized_output={"results": [], "total": 0},
        )
        mi = ToolResultAdapter.to_module_for_search(tr)
        assert isinstance(mi.raw_input["text"], str)

    def test_extra_max_words_merged(self):
        tr = FakeToolResult(
            tool_name="search",
            normalized_output={"results": [{"title": "t", "snippet": "s", "url": "u"}]},
        )
        mi = ToolResultAdapter.to_module_for_search(tr, extra_params={"max_words": 200})
        assert mi.raw_input.get("max_words") == 200

    def test_failed_search_does_not_raise_by_default(self):
        tr = FakeToolResult(success=False, tool_name="search")
        mi = ToolResultAdapter.to_module_for_search(tr)
        assert mi.metadata["tool_success"] is False

    def test_raise_on_failure_raises(self):
        tr = FakeToolResult(success=False, tool_name="search")
        with pytest.raises(IntegrationError):
            ToolResultAdapter.to_module_for_search(tr, raise_on_failure=True)


# ─────────────────────────────────────────────────────────────────────────────
# F. to_module_for_devtool
# ─────────────────────────────────────────────────────────────────────────────

class TestToModuleForDevtool:

    def test_task_type_defaults_to_code(self):
        dr = FakeDevToolResult(normalized_output={"content": "print('hello')"})
        mi = ToolResultAdapter.to_module_for_devtool(dr)
        assert mi.task_type == "code"

    def test_custom_task_type(self):
        dr = FakeDevToolResult(normalized_output={"content": "some output"})
        mi = ToolResultAdapter.to_module_for_devtool(dr, task_type="document")
        assert mi.task_type == "document"

    def test_normalized_output_as_raw_input(self):
        norm = {"content": "def foo(): pass", "language": "python"}
        dr   = FakeDevToolResult(normalized_output=norm)
        mi   = ToolResultAdapter.to_module_for_devtool(dr)
        assert mi.raw_input == norm

    def test_extra_params_merged(self):
        dr = FakeDevToolResult(normalized_output={"content": "code"})
        mi = ToolResultAdapter.to_module_for_devtool(
            dr, extra_params={"language": "python"}
        )
        assert mi.raw_input["language"] == "python"

    def test_devtool_provenance_metadata_injected(self):
        dr = FakeDevToolResult(
            tool_name="git",
            action="diff",
            source_reference="app/main.py",
            latency_ms=30,
        )
        mi = ToolResultAdapter.to_module_for_devtool(dr)
        assert mi.metadata["tool_name"]               == "git"
        assert mi.metadata["devtool_source_reference"] == "app/main.py"
        assert mi.metadata["tool_latency_ms"]          == 30

    def test_failed_devtool_does_not_raise_by_default(self):
        dr = FakeDevToolResult(success=False, error_message="git not found")
        mi = ToolResultAdapter.to_module_for_devtool(dr)
        assert mi.metadata["tool_success"] is False

    def test_raise_on_failure_raises(self):
        dr = FakeDevToolResult(success=False, error_message="git error")
        with pytest.raises(IntegrationError):
            ToolResultAdapter.to_module_for_devtool(dr, raise_on_failure=True)


# ─────────────────────────────────────────────────────────────────────────────
# G. ToolBackedModuleInput factory
# ─────────────────────────────────────────────────────────────────────────────

class TestToolBackedModuleInput:

    def test_website_analysis_task_type(self):
        tr = FakeToolResult(normalized_output={"text": "page content"})
        mi = ToolBackedModuleInput.website_analysis(tr)
        assert mi.task_type == "analysis"

    def test_website_analysis_injects_analysis_type(self):
        tr = FakeToolResult(normalized_output={"text": "page content"})
        mi = ToolBackedModuleInput.website_analysis(tr, analysis_type="sentiment")
        assert mi.raw_input.get("analysis_type") == "sentiment"

    def test_document_pdf_task_type(self):
        tr = FakeToolResult(normalized_output={"text": "document text"})
        mi = ToolBackedModuleInput.document_pdf(tr)
        assert mi.task_type == "summarize"

    def test_document_pdf_style_merged(self):
        tr = FakeToolResult(normalized_output={"text": "document text"})
        mi = ToolBackedModuleInput.document_pdf(tr, style="detailed")
        assert mi.raw_input.get("style") == "detailed"

    def test_search_summary_task_type(self):
        tr = FakeToolResult(
            normalized_output={"results": [{"title": "t", "snippet": "s", "url": "u"}]}
        )
        mi = ToolBackedModuleInput.search_summary(tr)
        assert mi.task_type == "summarize"

    def test_search_summary_max_words(self):
        tr = FakeToolResult(
            normalized_output={"results": [{"title": "t", "snippet": "s", "url": "u"}]}
        )
        mi = ToolBackedModuleInput.search_summary(tr, max_words=300)
        assert mi.raw_input.get("max_words") == 300

    def test_devtool_code_task_type(self):
        dr = FakeDevToolResult(normalized_output={"content": "code"})
        mi = ToolBackedModuleInput.devtool_code(dr)
        assert mi.task_type == "code"

    def test_devtool_code_language_merged(self):
        dr = FakeDevToolResult(normalized_output={"content": "code"})
        mi = ToolBackedModuleInput.devtool_code(dr, language="javascript")
        assert mi.raw_input.get("language") == "javascript"

    def test_devtool_document_task_type(self):
        dr = FakeDevToolResult(normalized_output={"content": "readme content"})
        mi = ToolBackedModuleInput.devtool_document(dr)
        assert mi.task_type == "document"

    def test_devtool_document_doc_type(self):
        dr = FakeDevToolResult(normalized_output={"content": "content"})
        mi = ToolBackedModuleInput.devtool_document(dr, doc_type="readme")
        assert mi.raw_input.get("doc_type") == "readme"


# ─────────────────────────────────────────────────────────────────────────────
# H. ModuleOutputComposer.compose_single
# ─────────────────────────────────────────────────────────────────────────────

class TestComposeSingle:

    def test_success_result_composed(self):
        r = _make_execution_result(
            success=True,
            module_name="summarize",
            normalized_output={"summary": "test", "word_count": 5},
        )
        d = ModuleOutputComposer.compose_single(r)
        assert d["success"]        is True
        assert d["module"]         == "summarize"
        assert d["output"]["summary"] == "test"
        assert "request_id"        in d

    def test_failure_result_composed(self):
        r = _make_execution_result(
            success=False,
            error_code="MODULE_VALIDATION_FAILED",
            error_message="output too short",
        )
        d = ModuleOutputComposer.compose_single(r)
        assert d["success"]       is False
        assert d["error_code"]    == "MODULE_VALIDATION_FAILED"
        assert d["error_message"] == "output too short"

    def test_no_raw_output_by_default(self):
        r = _make_execution_result()
        d = ModuleOutputComposer.compose_single(r)
        assert "raw_output" not in d

    def test_raw_output_included_when_requested(self):
        r = _make_execution_result()
        d = ModuleOutputComposer.compose_single(r, include_raw=True)
        assert "raw_output" in d

    def test_all_required_fields_present(self):
        r = _make_execution_result()
        d = ModuleOutputComposer.compose_single(r)
        for key in (
            "request_id", "module", "task_type", "success", "output",
            "validation_passed", "latency_ms", "model", "provider", "fallback_used",
        ):
            assert key in d, f"Missing key: {key}"

    def test_json_serialisable(self):
        r = _make_execution_result(normalized_output={"summary": "text", "word_count": 10})
        d = ModuleOutputComposer.compose_single(r)
        serialised = json.dumps(d, default=str)
        parsed = json.loads(serialised)
        assert parsed["success"] is True


# ─────────────────────────────────────────────────────────────────────────────
# I. ModuleOutputComposer.compose_workflow
# ─────────────────────────────────────────────────────────────────────────────

class TestComposeWorkflow:

    def test_all_steps_succeed(self):
        steps = [
            {"step_name": "s1", "result": _make_execution_result(success=True)},
            {"step_name": "s2", "result": _make_execution_result(success=True)},
        ]
        d = ModuleOutputComposer.compose_workflow(steps, workflow_name="test_workflow")
        assert d["success"]      is True
        assert d["steps_passed"] == 2
        assert d["steps_failed"] == 0
        assert d["workflow"]     == "test_workflow"
        assert len(d["steps"])   == 2

    def test_one_step_fails_marks_workflow_failed(self):
        steps = [
            {"step_name": "ok",   "result": _make_execution_result(success=True)},
            {"step_name": "fail", "result": _make_execution_result(success=False)},
        ]
        d = ModuleOutputComposer.compose_workflow(steps)
        assert d["success"]      is False
        assert d["steps_failed"] == 1

    def test_step_without_result_handled(self):
        steps = [{"step_name": "no_result", "result": None}]
        d     = ModuleOutputComposer.compose_workflow(steps)
        assert d["success"]          is False
        assert d["steps"][0]["success"] is False

    def test_step_names_preserved(self):
        steps = [
            {"step_name": "alpha", "result": _make_execution_result(success=True)},
            {"step_name": "beta",  "result": _make_execution_result(success=True)},
        ]
        d = ModuleOutputComposer.compose_workflow(steps)
        names = [s["step_name"] for s in d["steps"]]
        assert names == ["alpha", "beta"]

    def test_json_serialisable(self):
        steps = [{"step_name": "step", "result": _make_execution_result()}]
        d     = ModuleOutputComposer.compose_workflow(steps, workflow_name="wf")
        json.dumps(d, default=str)  # must not raise


# ─────────────────────────────────────────────────────────────────────────────
# J. ModuleOutputComposer.compose_failure
# ─────────────────────────────────────────────────────────────────────────────

class TestComposeFailure:

    def test_failure_dict_shape(self):
        d = ModuleOutputComposer.compose_failure(
            request_id   = "req-001",
            task_type    = "summarize",
            error_code   = "TOOL_TIMEOUT",
            error_message= "browser timed out",
        )
        assert d["success"]       is False
        assert d["error_code"]    == "TOOL_TIMEOUT"
        assert d["request_id"]    == "req-001"
        assert d["task_type"]     == "summarize"
        assert d["output"]        is None

    def test_json_serialisable(self):
        d = ModuleOutputComposer.compose_failure(
            request_id="r", task_type="t",
            error_code="EC", error_message="msg",
        )
        json.dumps(d, default=str)  # must not raise


# ─────────────────────────────────────────────────────────────────────────────
# K. IntegrationError
# ─────────────────────────────────────────────────────────────────────────────

class TestIntegrationError:

    def test_message_and_attributes(self):
        err = IntegrationError("bad result", tool_name="pdf", action="extract_text")
        assert str(err)     == "bad result"
        assert err.tool_name == "pdf"
        assert err.action    == "extract_text"

    def test_is_exception(self):
        err = IntegrationError("oops")
        assert isinstance(err, Exception)

    def test_default_attributes(self):
        err = IntegrationError("minimal")
        assert err.tool_name == ""
        assert err.action    == ""


# ─────────────────────────────────────────────────────────────────────────────
# L. Provenance metadata completeness
# ─────────────────────────────────────────────────────────────────────────────

class TestProvenanceMetadata:

    def test_all_provenance_keys_present(self):
        tr = FakeToolResult(
            tool_name="browser", action="fetch",
            latency_ms=99, source_url="https://example.com",
        )
        mi = ToolResultAdapter.to_module_input(tr, task_type="analysis")
        for key in (
            "tool_name", "tool_action", "tool_success",
            "tool_latency_ms", "tool_source_url",
            "tool_error_code", "tool_request_id",
        ):
            assert key in mi.metadata, f"Missing provenance key: {key}"

    def test_devtool_extra_provenance_keys(self):
        dr = FakeDevToolResult(
            tool_name="git",
            action="status",
            source_reference="HEAD",
        )
        mi = ToolResultAdapter.to_module_for_devtool(dr)
        assert "devtool_source_reference" in mi.metadata

    def test_failed_tool_provenance_error_code(self):
        tr = FakeToolResult(
            success=False,
            error_code="TOOL_TIMEOUT",
            error_message="timed out",
        )
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.metadata["tool_error_code"]  == "TOOL_TIMEOUT"
        assert mi.metadata["tool_success"]     is False


# ─────────────────────────────────────────────────────────────────────────────
# M. raise_on_failure in all adapters
# ─────────────────────────────────────────────────────────────────────────────

class TestRaiseOnFailure:

    ADAPTERS = [
        ("to_module_input",       lambda tr: ToolResultAdapter.to_module_input(tr, task_type="summarize", raise_on_failure=True)),
        ("to_module_text",        lambda tr: ToolResultAdapter.to_module_text(tr, task_type="summarize", raise_on_failure=True)),
        ("to_module_for_pdf",     lambda tr: ToolResultAdapter.to_module_for_pdf(tr, raise_on_failure=True)),
        ("to_module_for_browser", lambda tr: ToolResultAdapter.to_module_for_browser(tr, raise_on_failure=True)),
        ("to_module_for_search",  lambda tr: ToolResultAdapter.to_module_for_search(tr, raise_on_failure=True)),
    ]

    @pytest.mark.parametrize("name,adapter_fn", ADAPTERS)
    def test_raises_on_failed_tool_result(self, name, adapter_fn):
        tr = FakeToolResult(success=False, error_message="network failure")
        with pytest.raises(IntegrationError):
            adapter_fn(tr)

    @pytest.mark.parametrize("name,adapter_fn", ADAPTERS)
    def test_does_not_raise_on_success(self, name, adapter_fn):
        tr = FakeToolResult(
            success=True,
            normalized_output={"text": "ok", "results": [{"title": "t", "snippet": "s", "url": "u"}]}
        )
        mi = adapter_fn(tr)
        assert isinstance(mi, ModuleInput)


# ─────────────────────────────────────────────────────────────────────────────
# N. JSON-serialisability
# ─────────────────────────────────────────────────────────────────────────────

class TestJsonSerialisability:

    def test_module_input_metadata_json_serialisable(self):
        tr = FakeToolResult(
            tool_name="browser",
            action="fetch",
            normalized_output={"text": "hello", "status_code": 200},
            latency_ms=55,
            source_url="https://test.com",
        )
        mi = ToolResultAdapter.to_module_for_browser(tr)
        json.dumps(mi.metadata, default=str)  # must not raise

    def test_full_adapter_output_json_serialisable(self):
        tr = FakeToolResult(
            normalized_output={"text": "content", "results": []}
        )
        for adapter in (
            lambda: ToolResultAdapter.to_module_input(tr, task_type="summarize"),
            lambda: ToolResultAdapter.to_module_text(tr, task_type="summarize"),
            lambda: ToolResultAdapter.to_module_for_browser(tr),
            lambda: ToolResultAdapter.to_module_for_search(tr),
            lambda: ToolResultAdapter.to_module_for_pdf(tr),
        ):
            mi = adapter()
            raw_input_json = json.dumps(mi.raw_input, default=str)
            metadata_json  = json.dumps(mi.metadata, default=str)
            assert raw_input_json is not None
            assert metadata_json  is not None

    def test_devtool_adapter_json_serialisable(self):
        dr = FakeDevToolResult(
            normalized_output={"content": "code here", "exit_code": 0},
            source_reference="app/main.py",
        )
        mi = ToolResultAdapter.to_module_for_devtool(dr)
        json.dumps(mi.raw_input,  default=str)
        json.dumps(mi.metadata,   default=str)


# ─────────────────────────────────────────────────────────────────────────────
# O. Text extraction edge cases
# ─────────────────────────────────────────────────────────────────────────────

class TestTextExtractionEdgeCases:

    def test_content_key_extracted(self):
        tr = FakeToolResult(normalized_output={"content": "from content key"})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert mi.raw_input["text"] == "from content key"

    def test_output_key_extracted(self):
        tr = FakeToolResult(normalized_output={"output": "from output key"})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert mi.raw_input["text"] == "from output key"

    def test_document_key_extracted(self):
        tr = FakeToolResult(normalized_output={"document": "# README\n\nContent here"})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert mi.raw_input["text"] == "# README\n\nContent here"

    def test_empty_string_normalized_output(self):
        tr = FakeToolResult(normalized_output="")
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        # Falls back to raw_output (None) → {}  → JSON serialised
        assert isinstance(mi.raw_input["text"], str)

    def test_none_outputs_produce_empty_dict_content(self):
        tr = FakeToolResult(normalized_output=None, raw_output=None)
        mi = ToolResultAdapter.to_module_input(tr, task_type="summarize")
        assert mi.raw_input == {}

    def test_nested_dict_serialised(self):
        tr = FakeToolResult(normalized_output={"nested": {"a": 1}, "other": "val"})
        mi = ToolResultAdapter.to_module_text(tr, task_type="summarize")
        assert isinstance(mi.raw_input["text"], str)
        assert len(mi.raw_input["text"]) > 0
