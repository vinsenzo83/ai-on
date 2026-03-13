"""tests/tools/test_tool_types.py – Phase 15 tool type contracts."""
from __future__ import annotations

import pytest

from app.tools.types import (
    ToolErrorCode,
    ToolInput,
    ToolResult,
    ToolValidationResult,
)


# ─────────────────────────────────────────────────────────────────────────────
# ToolInput
# ─────────────────────────────────────────────────────────────────────────────

class TestToolInput:
    def test_required_fields(self):
        ti = ToolInput(tool_name="search", action="query")
        assert ti.tool_name == "search"
        assert ti.action == "query"
        assert ti.params == {}
        assert ti.metadata == {}

    def test_auto_request_id(self):
        a = ToolInput(tool_name="pdf", action="extract_text")
        b = ToolInput(tool_name="pdf", action="extract_text")
        assert a.request_id != b.request_id

    def test_custom_request_id(self):
        ti = ToolInput(tool_name="ocr", action="extract_text", request_id="abc-123")
        assert ti.request_id == "abc-123"

    def test_params_and_metadata(self):
        ti = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "k-beauty"},
            metadata  = {"source": "test"},
        )
        assert ti.params["query"] == "k-beauty"
        assert ti.metadata["source"] == "test"


# ─────────────────────────────────────────────────────────────────────────────
# ToolResult
# ─────────────────────────────────────────────────────────────────────────────

class TestToolResult:
    def test_defaults(self):
        r = ToolResult(request_id="r1", tool_name="search", action="query")
        assert r.success is False
        assert r.validation_passed is False
        assert r.error_code is None
        assert r.latency_ms == 0

    def test_as_dict_keys(self):
        r = ToolResult(
            request_id        = "r1",
            tool_name         = "search",
            action            = "query",
            success           = True,
            raw_output        = {"results": []},
            normalized_output = {"results": [], "total": 0},
            validation_passed = True,
            latency_ms        = 42,
        )
        d = r.as_dict()
        expected_keys = {
            "request_id", "tool_name", "action", "success",
            "raw_output", "normalized_output", "validation_passed",
            "error_code", "error_message", "latency_ms", "source_url",
        }
        assert set(d.keys()) == expected_keys

    def test_as_dict_values(self):
        r = ToolResult(
            request_id = "r2",
            tool_name  = "pdf",
            action     = "extract_text",
            success    = True,
            latency_ms = 100,
        )
        d = r.as_dict()
        assert d["request_id"] == "r2"
        assert d["tool_name"]  == "pdf"
        assert d["latency_ms"] == 100

    def test_source_url_defaults_none(self):
        r = ToolResult(request_id="x", tool_name="ocr", action="extract_text")
        assert r.source_url is None


# ─────────────────────────────────────────────────────────────────────────────
# ToolValidationResult
# ─────────────────────────────────────────────────────────────────────────────

class TestToolValidationResult:
    def test_ok(self):
        v = ToolValidationResult.ok()
        assert v.passed is True
        assert v.errors == []

    def test_fail_single(self):
        v = ToolValidationResult.fail("missing query param")
        assert v.passed is False
        assert "missing query param" in v.errors

    def test_fail_multiple(self):
        v = ToolValidationResult.fail("err1", "err2", "err3")
        assert len(v.errors) == 3

    def test_direct_constructor(self):
        v = ToolValidationResult(passed=False, errors=["bad input"])
        assert not v.passed


# ─────────────────────────────────────────────────────────────────────────────
# ToolErrorCode
# ─────────────────────────────────────────────────────────────────────────────

class TestToolErrorCode:
    def test_constants_are_strings(self):
        for attr in dir(ToolErrorCode):
            if not attr.startswith("_"):
                val = getattr(ToolErrorCode, attr)
                assert isinstance(val, str), f"{attr} should be a string"

    def test_unique_values(self):
        codes = [
            getattr(ToolErrorCode, a)
            for a in dir(ToolErrorCode)
            if not a.startswith("_")
        ]
        assert len(codes) == len(set(codes)), "ToolErrorCode values must be unique"
