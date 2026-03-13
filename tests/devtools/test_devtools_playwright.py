"""
tests/devtools/test_devtools_playwright.py
────────────────────────────────────────────
Phase 16 — Stage A tests: PlaywrightBrowserTool

Coverage
────────
  Contract    : name, actions, op_type
  Validation  : mode guard, URL format, missing params
  Dependency  : graceful DependencyError when playwright not installed
  Mock paths  : patch execute_action directly to avoid real browser
  Normalizer  : text/html truncation
  JSON-serial : result as_dict() roundtrip
  Failure     : wrong mode, bad URL
"""
from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.devtools.executor                    import DevToolExecutor
from app.devtools.registry                    import DevToolRegistry
from app.devtools.tools.playwright_browser    import PlaywrightBrowserTool
from app.devtools.types                       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
)


@pytest.fixture
def tool():
    return PlaywrightBrowserTool()


@pytest.fixture
def executor(tool):
    reg = DevToolRegistry()
    reg.register(tool)
    return DevToolExecutor(registry=reg)


def _inp(action, params, mode=DevToolMode.FULL):
    return DevToolInput(tool_name="playwright_browser", action=action,
                        params=params, mode=mode)


# ── Contract ──────────────────────────────────────────────────────────────────

class TestPlaywrightContract:
    def test_name(self, tool):
        assert tool.name == "playwright_browser"

    def test_actions(self, tool):
        assert set(tool.get_actions()) == {
            "navigate", "screenshot", "click",
            "fill", "extract_text", "get_html",
        }

    def test_op_type(self, tool):
        from app.devtools.types import DevToolOpType
        assert tool.get_op_type() == DevToolOpType.BROWSER

    def test_requires_full_mode(self, tool):
        assert tool.requires_mode() == DevToolMode.FULL


# ── Validation ────────────────────────────────────────────────────────────────

class TestPlaywrightValidation:
    def test_wrong_mode_blocked(self, tool):
        ti = _inp("navigate",
                  {"url": "https://example.com"},
                  mode=DevToolMode.SAFE_WRITE)
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("FULL" in e for e in v.errors)

    def test_missing_url(self, tool):
        ti = _inp("navigate", {})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_non_http_url_blocked(self, tool):
        ti = _inp("navigate", {"url": "ftp://example.com"})
        v = tool.validate_input(ti)
        assert not v.passed
        assert any("http" in e.lower() for e in v.errors)

    def test_click_requires_selector(self, tool):
        ti = _inp("click", {"url": "https://example.com"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_fill_requires_value(self, tool):
        ti = _inp("fill", {"url": "https://example.com", "selector": "#q"})
        v = tool.validate_input(ti)
        assert not v.passed

    def test_valid_navigate_passes(self, tool):
        ti = _inp("navigate", {"url": "https://example.com"})
        v = tool.validate_input(ti)
        assert v.passed

    def test_valid_fill_passes(self, tool):
        ti = _inp("fill", {
            "url": "https://example.com",
            "selector": "#q",
            "value": "hello",
        })
        v = tool.validate_input(ti)
        assert v.passed


# ── Dependency error ──────────────────────────────────────────────────────────

class TestPlaywrightDependencyError:
    @pytest.mark.asyncio
    async def test_dependency_error_when_no_playwright(self, executor):
        """When playwright is not importable, tool returns DependencyError result."""
        import builtins
        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name.startswith("playwright"):
                raise ImportError("no playwright")
            return real_import(name, *args, **kwargs)

        ti = _inp("navigate", {"url": "https://example.com"})

        with patch("builtins.__import__", side_effect=fake_import):
            result = await executor.execute(ti)

        assert not result.success
        assert result.error_code == DevToolErrorCode.DEPENDENCY_ERROR


# ── Mock-based happy paths ────────────────────────────────────────────────────

class TestPlaywrightMockHappyPaths:
    """
    We mock execute_action directly — no real browser launched.
    Tests verify executor pipeline and normalizer.
    """

    @pytest.mark.asyncio
    async def test_navigate_via_mock(self, executor):
        expected = {
            "url": "https://example.com",
            "title": "Example Domain",
            "status_code": 200,
            "html_snippet": "<html>...</html>",
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("navigate", {"url": "https://example.com"})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["title"] == "Example Domain"

    @pytest.mark.asyncio
    async def test_screenshot_via_mock(self, executor):
        png_b64 = base64.b64encode(b"\x89PNG\r\n").decode()
        expected = {
            "url": "https://example.com",
            "image_b64": png_b64,
            "width": 1280,
            "height": 720,
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("screenshot", {"url": "https://example.com"})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["width"] == 1280

    @pytest.mark.asyncio
    async def test_extract_text_via_mock(self, executor):
        expected = {
            "url": "https://example.com",
            "text": "Snail Mucin Serum is amazing",
            "word_count": 5,
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("extract_text", {"url": "https://example.com"})
            result = await executor.execute(ti)

        assert result.success
        assert "Snail" in result.normalized_output["text"]
        assert result.normalized_output["word_count"] == 5

    @pytest.mark.asyncio
    async def test_click_via_mock(self, executor):
        expected = {"url": "https://example.com", "selector": "#btn", "clicked": True}
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("click", {"url": "https://example.com", "selector": "#btn"})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["clicked"] is True

    @pytest.mark.asyncio
    async def test_fill_via_mock(self, executor):
        expected = {
            "url": "https://example.com",
            "selector": "#q",
            "value": "snail",
            "filled": True,
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("fill", {"url": "https://example.com", "selector": "#q", "value": "snail"})
            result = await executor.execute(ti)

        assert result.success
        assert result.normalized_output["filled"] is True

    @pytest.mark.asyncio
    async def test_get_html_via_mock(self, executor):
        expected = {
            "url": "https://example.com",
            "html": "<div>Hello</div>",
            "selector": None,
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("get_html", {"url": "https://example.com"})
            result = await executor.execute(ti)

        assert result.success
        assert "Hello" in result.normalized_output["html"]


# ── Normalizer ────────────────────────────────────────────────────────────────

class TestPlaywrightNormalizer:
    def test_truncates_html(self, tool):
        raw = {"url": "x", "html": "a" * 200_000, "selector": None}
        norm = tool.normalize_output(raw)
        assert len(norm["html"]) <= 100_100

    def test_truncates_text(self, tool):
        raw = {"url": "x", "text": "w " * 100_000, "word_count": 100_000}
        norm = tool.normalize_output(raw)
        assert len(norm["text"]) <= 50_100

    def test_truncates_html_snippet(self, tool):
        raw = {"url": "x", "title": "T", "status_code": 200,
               "html_snippet": "s" * 10_000}
        norm = tool.normalize_output(raw)
        assert len(norm["html_snippet"]) <= 5_100


# ── JSON serialisability ──────────────────────────────────────────────────────

class TestPlaywrightJSONSerial:
    @pytest.mark.asyncio
    async def test_json_serialisable_on_success(self, executor):
        expected = {
            "url": "https://example.com",
            "title": "Test",
            "status_code": 200,
            "html_snippet": "<html/>",
        }
        with patch.object(PlaywrightBrowserTool, "execute_action",
                          new=AsyncMock(return_value=expected)):
            ti = _inp("navigate", {"url": "https://example.com"})
            result = await executor.execute(ti)

        json.dumps(result.as_dict())

    @pytest.mark.asyncio
    async def test_json_serialisable_on_failure(self, executor):
        ti = _inp("navigate",
                  {"url": "https://example.com"},
                  mode=DevToolMode.SAFE_WRITE)
        result = await executor.execute(ti)
        assert not result.success
        json.dumps(result.as_dict())
