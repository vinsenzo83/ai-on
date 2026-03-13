"""tests/tools/test_tools_pdf.py – Phase 15 PdfTool tests."""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.tools.tools.pdf import PdfTool
from app.tools.types     import ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Mock PdfReader factory
# ─────────────────────────────────────────────────────────────────────────────

def _make_mock_page(text: str):
    page = MagicMock()
    page.extract_text.return_value = text
    return page


def _make_mock_reader(pages_text: list[str], metadata: dict | None = None):
    pages  = [_make_mock_page(t) for t in pages_text]
    reader = MagicMock()
    reader.pages    = pages
    reader.metadata = metadata or {"/Title": "Test Doc", "/Author": "Test Author"}
    return reader


def _reader_factory(pages_text: list[str], metadata: dict | None = None):
    def factory(content: bytes):
        return _make_mock_reader(pages_text, metadata)
    return factory


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestPdfToolContract:
    def test_name(self):
        assert PdfTool().name == "pdf"

    def test_actions(self):
        actions = PdfTool().get_actions()
        assert "extract_text"     in actions
        assert "extract_metadata" in actions
        assert "extract_page"     in actions

    def test_can_handle(self):
        t = PdfTool()
        assert t.can_handle("extract_text") is True
        assert t.can_handle("unknown")      is False


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestPdfToolValidation:
    def test_valid_extract_text(self):
        ti = ToolInput(
            tool_name = "pdf",
            action    = "extract_text",
            params    = {"content": b"%PDF-fake"},
        )
        r = PdfTool().validate_input(ti)
        assert r.passed

    def test_missing_content_fails(self):
        ti = ToolInput(tool_name="pdf", action="extract_text", params={})
        r  = PdfTool().validate_input(ti)
        assert not r.passed

    def test_non_bytes_content_fails(self):
        ti = ToolInput(
            tool_name = "pdf",
            action    = "extract_text",
            params    = {"content": "not bytes"},
        )
        r = PdfTool().validate_input(ti)
        assert not r.passed

    def test_extract_page_missing_page(self):
        ti = ToolInput(
            tool_name = "pdf",
            action    = "extract_page",
            params    = {"content": b"%PDF"},
        )
        r = PdfTool().validate_input(ti)
        assert not r.passed
        assert any("page" in e.lower() for e in r.errors)

    def test_extract_page_zero_page_fails(self):
        ti = ToolInput(
            tool_name = "pdf",
            action    = "extract_page",
            params    = {"content": b"%PDF", "page": 0},
        )
        r = PdfTool().validate_input(ti)
        assert not r.passed

    def test_extract_page_valid(self):
        ti = ToolInput(
            tool_name = "pdf",
            action    = "extract_page",
            params    = {"content": b"%PDF", "page": 2},
        )
        r = PdfTool().validate_input(ti)
        assert r.passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestPdfToolHappyPath:
    @pytest.mark.asyncio
    async def test_extract_text(self):
        factory = _reader_factory(["Hello world", "Page two content"])
        tool    = PdfTool(pdf_reader_factory=factory)
        ti      = ToolInput(
            tool_name = "pdf",
            action    = "extract_text",
            params    = {"content": b"%PDF"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert "Hello world"     in normalized["text"]
        assert "Page two content" in normalized["text"]
        assert normalized["page_count"] == 2
        assert normalized["char_count"] > 0

    @pytest.mark.asyncio
    async def test_extract_metadata(self):
        meta    = {"/Title": "K-Beauty Guide", "/Author": "Admin", "/Producer": "TestPDF"}
        factory = _reader_factory(["page1"], metadata=meta)
        tool    = PdfTool(pdf_reader_factory=factory)
        ti      = ToolInput(
            tool_name = "pdf",
            action    = "extract_metadata",
            params    = {"content": b"%PDF"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["title"]    == "K-Beauty Guide"
        assert normalized["author"]   == "Admin"
        assert normalized["page_count"] == 1

    @pytest.mark.asyncio
    async def test_extract_page(self):
        factory = _reader_factory(["page one text", "page two text"])
        tool    = PdfTool(pdf_reader_factory=factory)
        ti      = ToolInput(
            tool_name = "pdf",
            action    = "extract_page",
            params    = {"content": b"%PDF", "page": 2},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["page"]      == 2
        assert "page two text"         in normalized["text"]
        assert normalized["char_count"] > 0


# ─────────────────────────────────────────────────────────────────────────────
# Error handling
# ─────────────────────────────────────────────────────────────────────────────

class TestPdfToolErrors:
    @pytest.mark.asyncio
    async def test_page_out_of_range(self):
        from app.tools.base import ToolActionError
        factory = _reader_factory(["only one page"])
        tool    = PdfTool(pdf_reader_factory=factory)
        ti      = ToolInput(
            tool_name = "pdf",
            action    = "extract_page",
            params    = {"content": b"%PDF", "page": 99},
        )
        with pytest.raises(ToolActionError):
            await tool.execute_action(ti)

    def test_validate_output_missing_action(self):
        r = PdfTool().validate_output({"text": "hello"})
        assert not r.passed

    def test_validate_output_valid(self):
        r = PdfTool().validate_output({"action": "extract_text", "text": "hello"})
        assert r.passed
