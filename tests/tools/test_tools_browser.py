"""tests/tools/test_tools_browser.py – Phase 15 BrowserTool tests."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.tools.tools.browser import BrowserTool, _extract_title
from app.tools.types         import ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Sample HTML
# ─────────────────────────────────────────────────────────────────────────────

_SAMPLE_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>K-Beauty Products</title>
  <meta charset="utf-8">
</head>
<body>
  <h1>Best Sellers</h1>
  <p>Snail Mucin Serum is our top product.</p>
  <a href="/products/snail-serum">Snail Serum</a>
  <a href="https://external.com/ref">External Link</a>
  <script>console.log("script content should be stripped")</script>
</body>
</html>"""


def _make_mock_http_client(html: str, status_code: int = 200, content_type: str = "text/html"):
    class _MockResp:
        def __init__(self):
            self.status_code = status_code
            self.text        = html
            self.headers     = {"content-type": content_type}

    class _MockClient:
        async def get(self, url, **kwargs):
            return _MockResp()

    return _MockClient()


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestBrowserToolContract:
    def test_name(self):
        assert BrowserTool().name == "browser"

    def test_actions(self):
        actions = BrowserTool().get_actions()
        assert "fetch"         in actions
        assert "extract_text"  in actions
        assert "extract_links" in actions
        assert "screenshot"    in actions

    def test_can_handle(self):
        t = BrowserTool()
        assert t.can_handle("fetch")   is True
        assert t.can_handle("unknown") is False


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestBrowserToolValidation:
    def test_valid_url(self):
        ti = ToolInput(
            tool_name = "browser",
            action    = "fetch",
            params    = {"url": "https://www.stylekorean.com"},
        )
        assert BrowserTool().validate_input(ti).passed

    def test_missing_url(self):
        ti = ToolInput(tool_name="browser", action="fetch", params={})
        assert not BrowserTool().validate_input(ti).passed

    def test_bad_url_scheme(self):
        ti = ToolInput(
            tool_name = "browser",
            action    = "fetch",
            params    = {"url": "ftp://example.com"},
        )
        assert not BrowserTool().validate_input(ti).passed

    def test_empty_url(self):
        ti = ToolInput(
            tool_name = "browser",
            action    = "extract_text",
            params    = {"url": ""},
        )
        assert not BrowserTool().validate_input(ti).passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestBrowserToolHappyPath:
    @pytest.mark.asyncio
    async def test_fetch(self):
        tool = BrowserTool(http_client=_make_mock_http_client(_SAMPLE_HTML))
        ti   = ToolInput(
            tool_name = "browser",
            action    = "fetch",
            params    = {"url": "https://www.stylekorean.com"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["url"]         == "https://www.stylekorean.com"
        assert normalized["status_code"] == 200
        assert "K-Beauty Products"       in normalized["title"]
        assert "<html"                   in normalized["html"].lower()
        assert normalized["size_bytes"]  > 0

    @pytest.mark.asyncio
    async def test_extract_text_strips_script(self):
        tool = BrowserTool(http_client=_make_mock_http_client(_SAMPLE_HTML))
        ti   = ToolInput(
            tool_name = "browser",
            action    = "extract_text",
            params    = {"url": "https://www.example.com"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert "Snail Mucin Serum" in normalized["text"]
        assert "console.log"  not in normalized["text"], "Script content leaked"
        assert normalized["word_count"] > 0
        assert isinstance(normalized["title"], str)  # title extraction is parser-dependent

    @pytest.mark.asyncio
    async def test_extract_links(self):
        tool = BrowserTool(http_client=_make_mock_http_client(_SAMPLE_HTML))
        ti   = ToolInput(
            tool_name = "browser",
            action    = "extract_links",
            params    = {"url": "https://www.stylekorean.com"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["total"] >= 2
        hrefs = [lnk["href"] for lnk in normalized["links"]]
        assert "/products/snail-serum" in hrefs

    @pytest.mark.asyncio
    async def test_extract_links_deduplication(self):
        html = """<html><body>
        <a href="/page">Link 1</a>
        <a href="/page">Duplicate</a>
        <a href="/other">Other</a>
        </body></html>"""
        tool = BrowserTool(http_client=_make_mock_http_client(html))
        ti   = ToolInput(
            tool_name = "browser",
            action    = "extract_links",
            params    = {"url": "https://example.com"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)
        # Duplicates deduplicated by abs_url
        abs_urls = [lnk["abs_url"] for lnk in normalized["links"]]
        assert len(abs_urls) == len(set(abs_urls))

    @pytest.mark.asyncio
    async def test_screenshot_with_injected_fn(self):
        screenshot_bytes = b"\x89PNG\r\n\x1a\nfakepng"

        async def fake_screenshot(url, width, height) -> bytes:
            return screenshot_bytes

        tool = BrowserTool(screenshot_fn=fake_screenshot)
        ti   = ToolInput(
            tool_name = "browser",
            action    = "screenshot",
            params    = {
                "url":    "https://example.com",
                "width":  1280,
                "height": 800,
            },
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["content"] == screenshot_bytes
        assert normalized["width"]   == 1280
        assert normalized["height"]  == 800
        assert normalized["format"]  == "PNG"


# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractTitle:
    def test_basic(self):
        assert _extract_title("<title>My Page</title>") == "My Page"

    def test_no_title(self):
        assert _extract_title("<html><body></body></html>") == ""

    def test_html_entities(self):
        assert _extract_title("<title>K-Beauty &amp; Skincare</title>") == "K-Beauty & Skincare"


# ─────────────────────────────────────────────────────────────────────────────
# Error handling
# ─────────────────────────────────────────────────────────────────────────────

class TestBrowserToolErrors:
    @pytest.mark.asyncio
    async def test_http_error_status(self):
        from app.tools.base import ToolActionError
        tool = BrowserTool(http_client=_make_mock_http_client("", status_code=404))
        ti   = ToolInput(
            tool_name = "browser",
            action    = "fetch",
            params    = {"url": "https://example.com/404"},
        )
        with pytest.raises(ToolActionError):
            await tool.execute_action(ti)

    def test_validate_output_missing_action(self):
        r = BrowserTool().validate_output({"html": "<html>"})
        assert not r.passed

    def test_validate_output_valid(self):
        r = BrowserTool().validate_output({"action": "fetch", "html": "<html>"})
        assert r.passed
