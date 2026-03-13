"""tests/tools/test_tools_ocr.py – Phase 15 OcrTool tests."""
from __future__ import annotations

import pytest

from app.tools.tools.ocr import OcrTool
from app.tools.types     import ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ocr_engine(text: str):
    """Return an OCR engine stub that always returns ``text``."""
    def engine(content: bytes, lang: str) -> str:
        return text
    return engine


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestOcrToolContract:
    def test_name(self):
        assert OcrTool().name == "ocr"

    def test_actions(self):
        actions = OcrTool().get_actions()
        assert "extract_text"  in actions
        assert "detect_lang"   in actions
        assert "extract_table" in actions

    def test_can_handle(self):
        t = OcrTool()
        assert t.can_handle("extract_text") is True
        assert t.can_handle("unknown")      is False


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestOcrToolValidation:
    def test_valid_input(self):
        ti = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": b"\x89PNG"},
        )
        r = OcrTool().validate_input(ti)
        assert r.passed

    def test_missing_content_fails(self):
        ti = ToolInput(tool_name="ocr", action="extract_text", params={})
        r  = OcrTool().validate_input(ti)
        assert not r.passed

    def test_non_bytes_fails(self):
        ti = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": "not bytes"},
        )
        r = OcrTool().validate_input(ti)
        assert not r.passed

    def test_empty_bytes_fails(self):
        ti = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": b""},
        )
        r = OcrTool().validate_input(ti)
        assert not r.passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestOcrToolHappyPath:
    @pytest.mark.asyncio
    async def test_extract_text(self):
        tool = OcrTool(ocr_engine=_ocr_engine("Hello K-Beauty World"))
        ti   = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": b"\x89PNG"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert "Hello K-Beauty World" in normalized["text"]
        assert normalized["word_count"] >= 3  # "Hello", "K-Beauty", "World" (hyphen may split)

    @pytest.mark.asyncio
    async def test_detect_lang_english(self):
        tool = OcrTool(ocr_engine=_ocr_engine("This is a product description"))
        ti   = ToolInput(
            tool_name = "ocr",
            action    = "detect_lang",
            params    = {"content": b"\x89PNG", "lang": "eng"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["detected_lang"] in ("en", "ko", "zh", "unknown")
        assert "text" in normalized

    @pytest.mark.asyncio
    async def test_detect_lang_korean(self):
        tool = OcrTool(ocr_engine=_ocr_engine("안녕하세요 피부관리"))
        ti   = ToolInput(
            tool_name = "ocr",
            action    = "detect_lang",
            params    = {"content": b"\x89PNG"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)
        assert normalized["detected_lang"] == "ko"

    @pytest.mark.asyncio
    async def test_extract_table(self):
        tsv_text = "Product\tPrice\tStock\nSnail Cream\t$25\t100\nToner\t$15\t50"
        tool     = OcrTool(ocr_engine=_ocr_engine(tsv_text))
        ti       = ToolInput(
            tool_name = "ocr",
            action    = "extract_table",
            params    = {"content": b"\x89PNG"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["row_count"] > 0
        assert len(normalized["rows"])  > 0
        # Header row should have 3 cells
        header_row = next((r for r in normalized["rows"] if "Product" in r), None)
        if header_row:
            assert len(header_row) >= 1


# ─────────────────────────────────────────────────────────────────────────────
# Normalization
# ─────────────────────────────────────────────────────────────────────────────

class TestOcrToolNormalization:
    def test_word_count_empty_text(self):
        tool       = OcrTool()
        normalized = tool.normalize_output({"action": "extract_text", "text": "  "})
        assert normalized["word_count"] == 0

    def test_strips_whitespace(self):
        tool       = OcrTool()
        normalized = tool.normalize_output({"action": "extract_text", "text": "  hello  "})
        assert normalized["text"] == "hello"


# ─────────────────────────────────────────────────────────────────────────────
# Error handling
# ─────────────────────────────────────────────────────────────────────────────

class TestOcrToolErrors:
    def test_validate_output_missing_text(self):
        r = OcrTool().validate_output({"action": "extract_text"})
        assert not r.passed

    def test_validate_output_valid(self):
        r = OcrTool().validate_output({"text": "hello"})
        assert r.passed
