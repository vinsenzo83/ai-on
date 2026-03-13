"""tests/tools/test_tools_image.py – Phase 15 ImageTool tests."""
from __future__ import annotations

import io
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.tools.tools.image import ImageTool
from app.tools.types       import ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Minimal valid PNG bytes (1×1 pixel, generated inline)
# ─────────────────────────────────────────────────────────────────────────────

def _tiny_png() -> bytes:
    """Return a minimal valid PNG image as bytes."""
    import struct, zlib
    def chunk(name: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + name + data
        return c + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1 RGB
    ihdr      = chunk(b"IHDR", ihdr_data)
    idat_data = zlib.compress(b"\x00\xFF\xFF\xFF")             # white pixel
    idat      = chunk(b"IDAT", idat_data)
    iend      = chunk(b"IEND", b"")
    return signature + ihdr + idat + iend


_PNG_BYTES = _tiny_png()


# ─────────────────────────────────────────────────────────────────────────────
# Processor stub that bypasses Pillow
# ─────────────────────────────────────────────────────────────────────────────

def _image_processor(content: bytes, action: str, **kwargs) -> dict:
    """Return a predictable dict for Pillow-dependent actions."""
    if action == "resize":
        return {
            "action":          "resize",
            "content":         content,
            "width":           kwargs.get("width",  100),
            "height":          kwargs.get("height", 100),
            "original_width":  50,
            "original_height": 50,
            "format":          "PNG",
        }
    elif action == "convert":
        return {
            "action":  "convert",
            "content": content,
            "format":  kwargs.get("format", "JPEG"),
        }
    elif action == "describe":
        return {
            "action":     "describe",
            "width":      100,
            "height":     100,
            "mode":       "RGB",
            "format":     "PNG",
            "size_bytes": len(content),
        }
    return {"action": action}


# ─────────────────────────────────────────────────────────────────────────────
# Mock HTTP client for download
# ─────────────────────────────────────────────────────────────────────────────

def _make_http_client(content: bytes, status_code: int = 200, content_type: str = "image/png"):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.content     = content
    mock_resp.headers     = {"content-type": content_type}
    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    return mock_client


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestImageToolContract:
    def test_name(self):
        assert ImageTool().name == "image"

    def test_actions(self):
        actions = ImageTool().get_actions()
        assert "download" in actions
        assert "resize"   in actions
        assert "convert"  in actions
        assert "describe" in actions

    def test_can_handle(self):
        t = ImageTool()
        assert t.can_handle("download") is True
        assert t.can_handle("unknown")  is False


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestImageToolValidation:
    def test_download_valid(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "download",
            params    = {"url": "https://cdn.example.com/product.jpg"},
        )
        assert ImageTool().validate_input(ti).passed

    def test_download_bad_url(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "download",
            params    = {"url": "not-a-url"},
        )
        assert not ImageTool().validate_input(ti).passed

    def test_resize_valid(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "resize",
            params    = {"content": _PNG_BYTES, "width": 200, "height": 200},
        )
        assert ImageTool().validate_input(ti).passed

    def test_resize_missing_width(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "resize",
            params    = {"content": _PNG_BYTES, "height": 200},
        )
        assert not ImageTool().validate_input(ti).passed

    def test_convert_invalid_format(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "convert",
            params    = {"content": _PNG_BYTES, "format": "XYZ"},
        )
        assert not ImageTool().validate_input(ti).passed

    def test_convert_valid_format(self):
        ti = ToolInput(
            tool_name = "image",
            action    = "convert",
            params    = {"content": _PNG_BYTES, "format": "JPEG"},
        )
        assert ImageTool().validate_input(ti).passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestImageToolHappyPath:
    @pytest.mark.asyncio
    async def test_download(self):
        client = _make_http_client(_PNG_BYTES)
        tool   = ImageTool(http_client=client, image_processor=_image_processor)
        ti     = ToolInput(
            tool_name = "image",
            action    = "download",
            params    = {"url": "https://cdn.example.com/img.png"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["url"]          == "https://cdn.example.com/img.png"
        assert len(normalized["content"])  > 0
        assert normalized["size_bytes"]   > 0

    @pytest.mark.asyncio
    async def test_resize(self):
        tool = ImageTool(image_processor=_image_processor)
        ti   = ToolInput(
            tool_name = "image",
            action    = "resize",
            params    = {"content": _PNG_BYTES, "width": 200, "height": 150},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["width"]           == 200
        assert normalized["height"]          == 150
        assert normalized["original_width"]  == 50
        assert normalized["original_height"] == 50

    @pytest.mark.asyncio
    async def test_convert(self):
        tool = ImageTool(image_processor=_image_processor)
        ti   = ToolInput(
            tool_name = "image",
            action    = "convert",
            params    = {"content": _PNG_BYTES, "format": "JPEG"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["format"]     == "JPEG"
        assert normalized["size_bytes"] > 0

    @pytest.mark.asyncio
    async def test_describe(self):
        tool = ImageTool(image_processor=_image_processor)
        ti   = ToolInput(
            tool_name = "image",
            action    = "describe",
            params    = {"content": _PNG_BYTES},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert "width"      in normalized
        assert "height"     in normalized
        assert "mode"       in normalized
        assert "format"     in normalized
        assert "size_bytes" in normalized


# ─────────────────────────────────────────────────────────────────────────────
# Error handling
# ─────────────────────────────────────────────────────────────────────────────

class TestImageToolErrors:
    @pytest.mark.asyncio
    async def test_download_404(self):
        from app.tools.base import ToolActionError
        client = _make_http_client(b"", status_code=404)
        tool   = ImageTool(http_client=client)
        ti     = ToolInput(
            tool_name = "image",
            action    = "download",
            params    = {"url": "https://cdn.example.com/notfound.png"},
        )
        with pytest.raises(ToolActionError):
            await tool.execute_action(ti)

    def test_validate_output_missing_action(self):
        r = ImageTool().validate_output({"content": b""})
        assert not r.passed

    def test_validate_output_valid(self):
        r = ImageTool().validate_output({"action": "describe", "width": 100})
        assert r.passed
