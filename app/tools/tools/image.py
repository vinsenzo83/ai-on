"""
app/tools/tools/image.py
────────────────────────
Phase 15 — Tool integration layer.

ImageTool: download, resize, convert, and describe images.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  download     – fetch an image from a URL and return bytes + metadata
  resize       – resize image bytes to a target width × height
  convert      – convert image bytes to a target format (JPEG, PNG, WEBP)
  describe     – return basic image metadata (size, mode, format)

Input params
────────────
  download:
    url    : str  – image URL (required)

  resize:
    content: bytes – raw image bytes (required)
    width  : int   – target width in pixels (required)
    height : int   – target height in pixels (required)

  convert:
    content: bytes – raw image bytes (required)
    format : str   – target format: "JPEG", "PNG", "WEBP" (required)

  describe:
    content: bytes – raw image bytes (required)

Normalized output shape
───────────────────────
  download:
    { "url": str, "content": bytes, "size_bytes": int,
      "content_type": str, "width": int, "height": int }

  resize:
    { "content": bytes, "width": int, "height": int,
      "original_width": int, "original_height": int, "format": str }

  convert:
    { "content": bytes, "format": str, "size_bytes": int }

  describe:
    { "width": int, "height": int, "mode": str, "format": str,
      "size_bytes": int }

Design notes
────────────
  • Uses Pillow (PIL) for image processing (lazy import).
  • Uses httpx for async downloads (lazy import).
  • http_client and image_processor can be injected for tests.
  • Production: pip install pillow httpx
"""
from __future__ import annotations

import io
from typing import Any, Callable

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_bytes, require_param, require_url

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS  = ["download", "resize", "convert", "describe"]
_ALLOWED_FORMATS    = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF"}


class ImageTool(BaseTool):
    """Image download, resize, convert, and describe tool."""

    def __init__(
        self,
        http_client:     Any              = None,
        image_processor: Callable | None  = None,
    ) -> None:
        """
        Parameters
        ----------
        http_client     : optional async httpx.AsyncClient or compatible mock.
        image_processor : optional callable(content, action, **kwargs) → dict.
                          Used to stub Pillow in tests.
        """
        self._http_client     = http_client
        self._image_processor = image_processor

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "image"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "download": {"url":     {"type": "string", "required": True}},
            "resize":   {"content": {"type": "bytes",   "required": True},
                         "width":   {"type": "integer", "required": True},
                         "height":  {"type": "integer", "required": True}},
            "convert":  {"content": {"type": "bytes",   "required": True},
                         "format":  {"type": "string",  "required": True,
                                     "enum": list(_ALLOWED_FORMATS)}},
            "describe": {"content": {"type": "bytes",   "required": True}},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "download": {"url": "str", "content": "bytes", "size_bytes": "int",
                         "content_type": "str", "width": "int", "height": "int"},
            "resize":   {"content": "bytes", "width": "int", "height": "int",
                         "original_width": "int", "original_height": "int", "format": "str"},
            "convert":  {"content": "bytes", "format": "str", "size_bytes": "int"},
            "describe": {"width": "int", "height": "int", "mode": "str",
                         "format": "str", "size_bytes": "int"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        if action == "download":
            return combine(
                require_param(p, "url", param_type=str),
                require_url(p.get("url", ""), "url"),
            )
        elif action == "resize":
            return combine(
                require_param(p, "content", param_type=bytes),
                require_bytes(p.get("content", b""), "content"),
                require_param(p, "width",   param_type=int),
                require_param(p, "height",  param_type=int),
            )
        elif action == "convert":
            checks = combine(
                require_param(p, "content", param_type=bytes),
                require_bytes(p.get("content", b""), "content"),
                require_param(p, "format",  param_type=str),
            )
            if checks.passed:
                fmt = p["format"].upper()
                if fmt not in _ALLOWED_FORMATS:
                    return ToolValidationResult.fail(
                        f"format must be one of {sorted(_ALLOWED_FORMATS)}, got {p['format']!r}"
                    )
            return checks
        elif action == "describe":
            return combine(
                require_param(p, "content", param_type=bytes),
                require_bytes(p.get("content", b""), "content"),
            )
        return ToolValidationResult.fail(f"Unknown action: {action}")

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "action" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'action' key")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        action = tool_input.action
        p      = tool_input.params

        logger.info("image_tool.execute", action=action)

        if action == "download":
            return await self._download(p["url"])

        # All other actions use Pillow
        content = p["content"]

        if self._image_processor is not None:
            return self._image_processor(content, action, **{k: v for k, v in p.items() if k != 'content'})

        if action == "resize":
            return self._resize(content, p["width"], p["height"])
        elif action == "convert":
            return self._convert(content, p["format"].upper())
        elif action == "describe":
            return self._describe(content)
        else:
            raise ToolActionError(
                f"Unsupported action: {action}",
                error_code=ToolErrorCode.UNSUPPORTED_ACTION,
            )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        action = raw_output.get("action", "")

        if action == "download":
            content = raw_output.get("content", b"")
            return {
                "url":          raw_output.get("url", ""),
                "content":      content,
                "size_bytes":   len(content),
                "content_type": raw_output.get("content_type", "image/unknown"),
                "width":        raw_output.get("width",  0),
                "height":       raw_output.get("height", 0),
            }
        elif action == "resize":
            content = raw_output.get("content", b"")
            return {
                "content":         content,
                "width":           raw_output.get("width",           0),
                "height":          raw_output.get("height",          0),
                "original_width":  raw_output.get("original_width",  0),
                "original_height": raw_output.get("original_height", 0),
                "format":          raw_output.get("format",          "JPEG"),
            }
        elif action == "convert":
            content = raw_output.get("content", b"")
            return {
                "content":    content,
                "format":     raw_output.get("format",     "JPEG"),
                "size_bytes": len(content),
            }
        elif action == "describe":
            return {
                "width":      raw_output.get("width",      0),
                "height":     raw_output.get("height",     0),
                "mode":       raw_output.get("mode",       ""),
                "format":     raw_output.get("format",     ""),
                "size_bytes": raw_output.get("size_bytes", 0),
            }
        return raw_output

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _download(self, url: str) -> dict[str, Any]:
        try:
            import httpx
        except ImportError:
            raise ToolActionError(
                "httpx is not installed. Run: pip install httpx",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )

        try:
            if self._http_client is not None:
                resp = await self._http_client.get(url)
            else:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(url)
        except Exception as exc:
            raise ToolActionError(
                f"Image download failed: {exc}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            ) from exc

        if resp.status_code != 200:
            raise ToolActionError(
                f"Image URL returned HTTP {resp.status_code}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            )

        content      = resp.content
        content_type = resp.headers.get("content-type", "image/unknown").split(";")[0]
        width, height = self._get_dimensions(content)

        return {
            "action":       "download",
            "url":          url,
            "content":      content,
            "content_type": content_type,
            "width":        width,
            "height":       height,
        }

    def _get_dimensions(self, content: bytes) -> tuple[int, int]:
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            return img.width, img.height
        except Exception:
            return 0, 0

    def _resize(self, content: bytes, width: int, height: int) -> dict[str, Any]:
        try:
            from PIL import Image
        except ImportError:
            raise ToolActionError(
                "Pillow is not installed. Run: pip install pillow",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )
        try:
            img = Image.open(io.BytesIO(content))
            orig_w, orig_h = img.width, img.height
            fmt            = img.format or "JPEG"
            resized        = img.resize((width, height))
            buf            = io.BytesIO()
            resized.save(buf, format=fmt)
            return {
                "action":          "resize",
                "content":         buf.getvalue(),
                "width":           width,
                "height":          height,
                "original_width":  orig_w,
                "original_height": orig_h,
                "format":          fmt,
            }
        except ToolActionError:
            raise
        except Exception as exc:
            raise ToolActionError(
                f"Resize failed: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

    def _convert(self, content: bytes, fmt: str) -> dict[str, Any]:
        try:
            from PIL import Image
        except ImportError:
            raise ToolActionError(
                "Pillow is not installed. Run: pip install pillow",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )
        try:
            img = Image.open(io.BytesIO(content))
            if fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format=fmt)
            return {"action": "convert", "content": buf.getvalue(), "format": fmt}
        except ToolActionError:
            raise
        except Exception as exc:
            raise ToolActionError(
                f"Convert failed: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

    def _describe(self, content: bytes) -> dict[str, Any]:
        try:
            from PIL import Image
        except ImportError:
            raise ToolActionError(
                "Pillow is not installed. Run: pip install pillow",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )
        try:
            img = Image.open(io.BytesIO(content))
            return {
                "action":     "describe",
                "width":      img.width,
                "height":     img.height,
                "mode":       img.mode,
                "format":     img.format or "unknown",
                "size_bytes": len(content),
            }
        except Exception as exc:
            raise ToolActionError(
                f"Describe failed: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc
