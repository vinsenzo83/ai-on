"""
tests/tools/test_tool_integration.py
──────────────────────────────────────
Phase 15 — Tool integration layer.

Integration tests that wire ToolRegistry + ToolExecutor + real tool
implementations together (no live network calls; all external I/O
is stubbed at the HTTP/processor boundary).

Coverage
--------
- Default registry contains all 6 tools.
- ToolExecutor produces structured ToolResult for each tool.
- request_id threads through from ToolInput to ToolResult.
- Batch execution returns one ToolResult per input.
- validate_input failure surfaces via executor (not an exception).
- as_dict() output is JSON-serialisable.
- Unsupported tool → ToolErrorCode.UNSUPPORTED_TOOL.
- Unsupported action → ToolErrorCode.UNSUPPORTED_ACTION.
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.tools.executor import ToolExecutor
from app.tools.registry import ToolRegistry, get_registry, reset_registry
from app.tools.types    import ToolErrorCode, ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Shared fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_tool_registry():
    """Each integration test starts with a fresh registry."""
    reset_registry()
    yield
    reset_registry()


def _mock_search_client():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "RelatedTopics": [
            {"Text": "Snail Mucin Serum",    "FirstURL": "https://example.com/1"},
            {"Text": "Korean Beauty Routine", "FirstURL": "https://example.com/2"},
        ],
        "Abstract": "", "AbstractURL": "", "Heading": "",
    }
    client = MagicMock()
    client.get = AsyncMock(return_value=mock_resp)
    return client


def _mock_browser_client(html: str = "<html><title>Test</title><body>Hello world</body></html>"):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text        = html
    mock_resp.headers     = {"content-type": "text/html"}
    client = MagicMock()
    client.get = AsyncMock(return_value=mock_resp)
    return client


def _mock_image_client(content: bytes):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content     = content
    mock_resp.headers     = {"content-type": "image/png"}
    client = MagicMock()
    client.get = AsyncMock(return_value=mock_resp)
    return client


def _pdf_reader_factory(pages_text: list[str]):
    from unittest.mock import MagicMock
    def factory(content: bytes):
        pages  = [MagicMock(**{"extract_text.return_value": t}) for t in pages_text]
        reader = MagicMock()
        reader.pages    = pages
        reader.metadata = {"/Title": "Integration Test PDF"}
        return reader
    return factory


def _ocr_engine_factory(text: str):
    def engine(content: bytes, lang: str) -> str:
        return text
    return engine


def _image_processor_factory():
    def processor(content: bytes, action: str, **kwargs):
        if action == "describe":
            return {"action": "describe", "width": 100, "height": 100,
                    "mode": "RGB", "format": "PNG", "size_bytes": len(content)}
        return {"action": action, "content": content, "format": "PNG",
                "width": 100, "height": 100, "original_width": 50,
                "original_height": 50, "size_bytes": len(content)}
    return processor


async def _mock_smtp_sender(msg: dict) -> str:
    return "<integration-test-msg-id@test.local>"


# ─────────────────────────────────────────────────────────────────────────────
# Registry integrity
# ─────────────────────────────────────────────────────────────────────────────

class TestRegistryIntegrity:
    def test_default_registry_has_six_tools(self):
        reg = get_registry()
        assert reg.tool_count() == 6

    def test_all_tool_names_present(self):
        reg   = get_registry()
        names = reg.list_tools()
        for expected in ["browser", "email", "image", "ocr", "pdf", "search"]:
            assert expected in names

    def test_each_tool_has_actions(self):
        reg     = get_registry()
        actions = reg.list_actions()
        for name, acts in actions.items():
            assert len(acts) >= 1, f"{name} has no actions"

    def test_all_tools_have_schemas(self):
        reg = get_registry()
        for name in reg.list_tools():
            tool = reg.resolve(name)
            assert isinstance(tool.get_input_schema(),  dict)
            assert isinstance(tool.get_output_schema(), dict)


# ─────────────────────────────────────────────────────────────────────────────
# Per-tool executor integration
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchToolIntegration:
    @pytest.mark.asyncio
    async def test_search_query_happy_path(self):
        from app.tools.tools.search import SearchTool
        reg = ToolRegistry()
        reg.register(SearchTool(http_client=_mock_search_client()))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "search",
            action     = "query",
            params     = {"query": "k-beauty serum"},
            request_id = "int-search-001",
        )
        r = await exe.execute(ti)

        assert r.success              is True
        assert r.validation_passed    is True
        assert r.request_id           == "int-search-001"
        assert r.tool_name            == "search"
        assert r.action               == "query"
        assert isinstance(r.normalized_output["results"], list)
        assert r.normalized_output["total"] >= 0

    @pytest.mark.asyncio
    async def test_search_missing_query_validation_failure(self):
        from app.tools.tools.search import SearchTool
        reg = ToolRegistry()
        reg.register(SearchTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(tool_name="search", action="query", params={})
        r  = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID


class TestPdfToolIntegration:
    @pytest.mark.asyncio
    async def test_pdf_extract_text_happy_path(self):
        from app.tools.tools.pdf import PdfTool
        reg = ToolRegistry()
        reg.register(PdfTool(pdf_reader_factory=_pdf_reader_factory(["Hello PDF World"])))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "pdf",
            action     = "extract_text",
            params     = {"content": b"%PDF-1.4 test"},
            request_id = "int-pdf-001",
        )
        r = await exe.execute(ti)

        assert r.success                   is True
        assert "Hello PDF World"           in r.normalized_output["text"]
        assert r.normalized_output["page_count"] == 1

    @pytest.mark.asyncio
    async def test_pdf_missing_content_validation_failure(self):
        from app.tools.tools.pdf import PdfTool
        reg = ToolRegistry()
        reg.register(PdfTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(tool_name="pdf", action="extract_text", params={})
        r  = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID


class TestOcrToolIntegration:
    @pytest.mark.asyncio
    async def test_ocr_extract_text_happy_path(self):
        from app.tools.tools.ocr import OcrTool
        reg = ToolRegistry()
        reg.register(OcrTool(ocr_engine=_ocr_engine_factory("Product: Snail Cream 50ml")))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "ocr",
            action     = "extract_text",
            params     = {"content": b"\x89PNG"},
            request_id = "int-ocr-001",
        )
        r = await exe.execute(ti)

        assert r.success is True
        assert "Snail Cream" in r.normalized_output["text"]

    @pytest.mark.asyncio
    async def test_ocr_empty_content_validation_failure(self):
        from app.tools.tools.ocr import OcrTool
        reg = ToolRegistry()
        reg.register(OcrTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": b""},
        )
        r = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID


class TestEmailToolIntegration:
    @pytest.mark.asyncio
    async def test_email_send_happy_path(self):
        from app.tools.tools.email import EmailTool
        reg = ToolRegistry()
        reg.register(EmailTool(smtp_sender=_mock_smtp_sender))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "email",
            action     = "send",
            params     = {
                "to":      "customer@example.com",
                "subject": "Order Confirmation",
                "body":    "Your order #12345 is confirmed.",
            },
            request_id = "int-email-001",
        )
        r = await exe.execute(ti)

        assert r.success                              is True
        assert r.normalized_output["sent"]            is True
        assert "customer@example.com"                 in r.normalized_output["to"]

    @pytest.mark.asyncio
    async def test_email_validate_addr_happy_path(self):
        from app.tools.tools.email import EmailTool
        reg = ToolRegistry()
        reg.register(EmailTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name = "email",
            action    = "validate_addr",
            params    = {"address": "admin@kbeauty.local"},
        )
        r = await exe.execute(ti)

        assert r.success                         is True
        assert r.normalized_output["valid"]      is True


class TestImageToolIntegration:
    def _make_tiny_png(self) -> bytes:
        import struct, zlib
        def chunk(name, data):
            c = struct.pack(">I", len(data)) + name + data
            return c + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
        sig  = b"\x89PNG\r\n\x1a\n"
        ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        idat = chunk(b"IDAT", zlib.compress(b"\x00\xFF\xFF\xFF"))
        iend = chunk(b"IEND", b"")
        return sig + ihdr + idat + iend

    @pytest.mark.asyncio
    async def test_image_describe_happy_path(self):
        from app.tools.tools.image import ImageTool
        png = self._make_tiny_png()
        reg = ToolRegistry()
        reg.register(ImageTool(image_processor=_image_processor_factory()))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "image",
            action     = "describe",
            params     = {"content": png},
            request_id = "int-image-001",
        )
        r = await exe.execute(ti)

        assert r.success is True
        assert r.normalized_output["width"]  == 100
        assert r.normalized_output["height"] == 100

    @pytest.mark.asyncio
    async def test_image_bad_url_validation_failure(self):
        from app.tools.tools.image import ImageTool
        reg = ToolRegistry()
        reg.register(ImageTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name = "image",
            action    = "download",
            params    = {"url": "not-a-valid-url"},
        )
        r = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID


class TestBrowserToolIntegration:
    @pytest.mark.asyncio
    async def test_browser_fetch_happy_path(self):
        from app.tools.tools.browser import BrowserTool
        html = "<html><head><title>StyleKorean</title></head><body>Best K-Beauty</body></html>"
        reg  = ToolRegistry()
        reg.register(BrowserTool(http_client=_mock_browser_client(html)))
        exe  = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name  = "browser",
            action     = "fetch",
            params     = {"url": "https://www.stylekorean.com"},
            request_id = "int-browser-001",
        )
        r = await exe.execute(ti)

        assert r.success is True
        assert "StyleKorean"       in r.normalized_output["title"]
        assert r.source_url        == "https://www.stylekorean.com"

    @pytest.mark.asyncio
    async def test_browser_extract_text(self):
        from app.tools.tools.browser import BrowserTool
        html = "<html><title>Test</title><body><p>Moisturizer sale today!</p></body></html>"
        reg  = ToolRegistry()
        reg.register(BrowserTool(http_client=_mock_browser_client(html)))
        exe  = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name = "browser",
            action    = "extract_text",
            params    = {"url": "https://www.example.com"},
        )
        r = await exe.execute(ti)

        assert r.success is True
        assert "Moisturizer" in r.normalized_output["text"]

    @pytest.mark.asyncio
    async def test_browser_missing_url_validation_failure(self):
        from app.tools.tools.browser import BrowserTool
        reg = ToolRegistry()
        reg.register(BrowserTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(tool_name="browser", action="fetch", params={})
        r  = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.INPUT_INVALID


# ─────────────────────────────────────────────────────────────────────────────
# Cross-cutting concerns
# ─────────────────────────────────────────────────────────────────────────────

class TestCrossCuttingIntegration:
    @pytest.mark.asyncio
    async def test_result_is_json_serialisable(self):
        """ToolResult.as_dict() must be JSON-serialisable (bytes excluded)."""
        from app.tools.tools.ocr import OcrTool
        reg = ToolRegistry()
        reg.register(OcrTool(ocr_engine=_ocr_engine_factory("hello world")))
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(
            tool_name = "ocr",
            action    = "extract_text",
            params    = {"content": b"\x89PNG\r\n\x1a\n"},
        )
        r = await exe.execute(ti)

        d = r.as_dict()
        # Replace bytes with str for JSON serialisation test
        d["raw_output"]        = str(d.get("raw_output",        ""))
        d["normalized_output"] = str(d.get("normalized_output", ""))
        json.dumps(d)  # must not raise

    @pytest.mark.asyncio
    async def test_request_id_threads_through(self):
        from app.tools.tools.email import EmailTool
        reg = ToolRegistry()
        reg.register(EmailTool())
        exe = ToolExecutor(registry=reg)

        ri = "cross-cutting-req-id-xyz"
        ti = ToolInput(
            tool_name  = "email",
            action     = "validate_addr",
            params     = {"address": "test@test.com"},
            request_id = ri,
        )
        r = await exe.execute(ti)
        assert r.request_id == ri

    @pytest.mark.asyncio
    async def test_unsupported_tool_error(self):
        reg = ToolRegistry()
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(tool_name="does_not_exist", action="do")
        r  = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.UNSUPPORTED_TOOL

    @pytest.mark.asyncio
    async def test_unsupported_action_error(self):
        from app.tools.tools.search import SearchTool
        reg = ToolRegistry()
        reg.register(SearchTool())
        exe = ToolExecutor(registry=reg)

        ti = ToolInput(tool_name="search", action="fly_to_moon", params={"query": "x"})
        r  = await exe.execute(ti)

        assert r.success    is False
        assert r.error_code == ToolErrorCode.UNSUPPORTED_ACTION

    @pytest.mark.asyncio
    async def test_batch_execution_all_succeed(self):
        from app.tools.tools.email import EmailTool
        reg = ToolRegistry()
        reg.register(EmailTool())
        exe = ToolExecutor(registry=reg)

        inputs = [
            ToolInput(
                tool_name  = "email",
                action     = "validate_addr",
                params     = {"address": f"user{i}@example.com"},
                request_id = f"batch-{i}",
            )
            for i in range(5)
        ]
        results = await exe.execute_many(inputs)

        assert len(results) == 5
        assert all(r.success for r in results)
        assert [r.request_id for r in results] == [f"batch-{i}" for i in range(5)]
