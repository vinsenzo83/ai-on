"""
app/tools/tools/browser.py
──────────────────────────
Phase 15 — Tool integration layer.

BrowserTool: fetch web pages, extract text/links, take screenshots.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  fetch          – fetch a URL and return HTML + metadata
  extract_text   – fetch a URL and return clean text (strips tags)
  extract_links  – fetch a URL and return all hyperlinks
  screenshot     – take a screenshot of a page (returns PNG bytes)

Input params
────────────
  All actions:
    url     : str   – page URL (required)
    timeout : int   – request timeout in seconds (default 15)
    headers : dict  – additional HTTP headers (optional)

  screenshot (headless browser mode):
    width   : int   – viewport width  (default 1280)
    height  : int   – viewport height (default 800)

Normalized output shape
───────────────────────
  fetch:
    { "url": str, "status_code": int, "html": str,
      "title": str, "content_type": str, "size_bytes": int }

  extract_text:
    { "url": str, "text": str, "word_count": int, "title": str }

  extract_links:
    { "url": str, "links": [{"text": str, "href": str, "abs_url": str}],
      "total": int }

  screenshot:
    { "url": str, "content": bytes, "width": int,
      "height": int, "format": "PNG" }

Design notes
────────────
  • fetch / extract_text / extract_links use httpx + html.parser.
  • screenshot uses playwright (optional; lazy import).
  • All network calls are injected via ``http_client`` for tests.
  • Production deps: pip install httpx playwright
    then: playwright install chromium
"""
from __future__ import annotations

import html
import io
import re
import urllib.parse
from html.parser import HTMLParser
from typing import Any, Callable

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_param, require_url

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["fetch", "extract_text", "extract_links", "screenshot"]
_DEFAULT_TIMEOUT   = 15
_DEFAULT_WIDTH     = 1280
_DEFAULT_HEIGHT    = 800


# ─────────────────────────────────────────────────────────────────────────────
# Minimal HTML parser helpers
# ─────────────────────────────────────────────────────────────────────────────

class _TextExtractor(HTMLParser):
    """Strip HTML tags and return plain text."""

    # Tags whose content (including nested tags) should be skipped entirely.
    # Only include paired (non-void) tags here so skip_depth stays balanced.
    _SKIP_TAGS  = {"script", "style", "noscript", "head"}
    # Void elements to silently ignore (they have no closing tag)
    _VOID_TAGS  = {"meta", "link", "br", "hr", "img", "input", "area",
                   "base", "col", "embed", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__()
        self._parts:     list[str] = []
        self._skip_depth: int      = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self._parts.append(stripped)

    def get_text(self) -> str:
        return " ".join(self._parts)


class _LinkExtractor(HTMLParser):
    """Extract all <a href="…"> links from HTML."""

    def __init__(self, base_url: str) -> None:
        super().__init__()
        self._base    = base_url
        self._links:  list[dict[str, str]] = []
        self._current_text: str            = ""
        self._in_a:  bool                  = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag.lower() == "a":
            self._in_a        = True
            self._current_text = ""
            href = dict(attrs).get("href", "")
            abs_url = urllib.parse.urljoin(self._base, href)
            self._links.append({"text": "", "href": href, "abs_url": abs_url})

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._in_a:
            self._in_a = False
            if self._links:
                self._links[-1]["text"] = self._current_text.strip()

    def handle_data(self, data: str) -> None:
        if self._in_a:
            self._current_text += data

    def get_links(self) -> list[dict[str, str]]:
        return self._links


def _extract_title(html_str: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html_str, re.IGNORECASE | re.DOTALL)
    return html.unescape(m.group(1).strip()) if m else ""


# ─────────────────────────────────────────────────────────────────────────────
# BrowserTool
# ─────────────────────────────────────────────────────────────────────────────

class BrowserTool(BaseTool):
    """Web page fetch, text extraction, link extraction, and screenshot tool."""

    def __init__(
        self,
        http_client:    Any             = None,
        screenshot_fn:  Callable | None = None,
    ) -> None:
        """
        Parameters
        ----------
        http_client   : optional async httpx.AsyncClient or compatible mock.
        screenshot_fn : optional async callable(url, width, height) → bytes.
                        When None, playwright is used for screenshot action.
        """
        self._http_client  = http_client
        self._screenshot_fn = screenshot_fn

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "browser"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "url":     {"type": "string",  "required": True},
            "timeout": {"type": "integer", "required": False, "default": 15},
            "headers": {"type": "dict",    "required": False},
            "width":   {"type": "integer", "required": False, "default": 1280,
                        "description": "screenshot only"},
            "height":  {"type": "integer", "required": False, "default": 800,
                        "description": "screenshot only"},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "fetch":         {"url": "str", "status_code": "int", "html": "str",
                              "title": "str", "content_type": "str", "size_bytes": "int"},
            "extract_text":  {"url": "str", "text": "str", "word_count": "int", "title": "str"},
            "extract_links": {"url": "str", "links": "list", "total": "int"},
            "screenshot":    {"url": "str", "content": "bytes", "width": "int",
                              "height": "int", "format": "str"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p = tool_input.params
        return combine(
            require_param(p, "url", param_type=str),
            require_url(p.get("url", ""), "url"),
        )

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "action" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'action' key")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        action  = tool_input.action
        url     = tool_input.params["url"]
        timeout = int(tool_input.params.get("timeout", _DEFAULT_TIMEOUT))
        headers = tool_input.params.get("headers") or {}

        logger.info("browser_tool.execute", action=action, url=url)

        if action == "screenshot":
            return await self._screenshot(
                url    = url,
                width  = int(tool_input.params.get("width",  _DEFAULT_WIDTH)),
                height = int(tool_input.params.get("height", _DEFAULT_HEIGHT)),
            )

        # All other actions need the HTML
        html_str, status_code, content_type = await self._fetch_html(
            url, timeout=timeout, headers=headers
        )

        if action == "fetch":
            return {
                "action":       action,
                "url":          url,
                "status_code":  status_code,
                "html":         html_str,
                "title":        _extract_title(html_str),
                "content_type": content_type,
                "size_bytes":   len(html_str.encode("utf-8", errors="replace")),
            }
        elif action == "extract_text":
            extractor = _TextExtractor()
            extractor.feed(html_str)
            text  = extractor.get_text()
            words = [w for w in text.split() if w]
            return {
                "action":     action,
                "url":        url,
                "text":       text,
                "word_count": len(words),
                "title":      _extract_title(html_str),
            }
        elif action == "extract_links":
            extractor = _LinkExtractor(url)
            extractor.feed(html_str)
            links = extractor.get_links()
            return {
                "action": action,
                "url":    url,
                "links":  links,
            }
        else:
            raise ToolActionError(
                f"Unsupported action: {action}",
                error_code=ToolErrorCode.UNSUPPORTED_ACTION,
            )

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        action = raw_output.get("action", "")

        if action == "fetch":
            return {
                "url":          raw_output.get("url",          ""),
                "status_code":  raw_output.get("status_code",  0),
                "html":         raw_output.get("html",         ""),
                "title":        raw_output.get("title",        ""),
                "content_type": raw_output.get("content_type", ""),
                "size_bytes":   raw_output.get("size_bytes",   0),
            }
        elif action == "extract_text":
            text  = raw_output.get("text", "")
            words = [w for w in text.split() if w]
            return {
                "url":        raw_output.get("url",   ""),
                "text":       text,
                "word_count": len(words),
                "title":      raw_output.get("title", ""),
            }
        elif action == "extract_links":
            links = raw_output.get("links", [])
            # deduplicate by abs_url
            seen: set[str] = set()
            unique: list[dict[str, str]] = []
            for lnk in links:
                if lnk.get("abs_url", "") not in seen:
                    seen.add(lnk.get("abs_url", ""))
                    unique.append(
                        {
                            "text":    lnk.get("text",    ""),
                            "href":    lnk.get("href",    ""),
                            "abs_url": lnk.get("abs_url", ""),
                        }
                    )
            return {
                "url":   raw_output.get("url", ""),
                "links": unique,
                "total": len(unique),
            }
        elif action == "screenshot":
            content = raw_output.get("content", b"")
            return {
                "url":     raw_output.get("url",    ""),
                "content": content,
                "width":   raw_output.get("width",  0),
                "height":  raw_output.get("height", 0),
                "format":  "PNG",
            }
        return raw_output

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _fetch_html(
        self,
        url:     str,
        *,
        timeout: int,
        headers: dict,
    ) -> tuple[str, int, str]:
        """Fetch URL and return (html_str, status_code, content_type)."""
        try:
            import httpx
        except ImportError:
            raise ToolActionError(
                "httpx is not installed. Run: pip install httpx",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )

        default_headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; kbeauty-bot/1.0; "
                "+https://kbeauty.local)"
            ),
            **headers,
        }

        try:
            if self._http_client is not None:
                resp = await self._http_client.get(
                    url, headers=default_headers
                )
            else:
                async with httpx.AsyncClient(
                    timeout    = float(timeout),
                    follow_redirects = True,
                ) as client:
                    resp = await client.get(url, headers=default_headers)
        except Exception as exc:
            raise ToolActionError(
                f"HTTP fetch failed: {exc}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            ) from exc

        if resp.status_code >= 400:
            raise ToolActionError(
                f"HTTP {resp.status_code} fetching {url}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            )

        content_type = resp.headers.get("content-type", "text/html").split(";")[0]
        html_str     = resp.text

        return html_str, resp.status_code, content_type

    async def _screenshot(
        self,
        url:    str,
        width:  int,
        height: int,
    ) -> dict[str, Any]:
        """Take a screenshot using playwright or injected screenshot_fn."""
        if self._screenshot_fn is not None:
            import inspect
            if inspect.iscoroutinefunction(self._screenshot_fn):
                content = await self._screenshot_fn(url, width, height)
            else:
                content = self._screenshot_fn(url, width, height)
            return {
                "action":  "screenshot",
                "url":     url,
                "content": content,
                "width":   width,
                "height":  height,
            }

        try:
            from playwright.async_api import async_playwright  # lazy import
        except ImportError:
            raise ToolActionError(
                "playwright is not installed. "
                "Run: pip install playwright && playwright install chromium",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                page    = await browser.new_page(
                    viewport={"width": width, "height": height}
                )
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                screenshot_bytes = await page.screenshot(type="png")
                await browser.close()
        except Exception as exc:
            raise ToolActionError(
                f"Screenshot failed: {exc}",
                error_code=ToolErrorCode.ACTION_FAILED,
            ) from exc

        return {
            "action":  "screenshot",
            "url":     url,
            "content": screenshot_bytes,
            "width":   width,
            "height":  height,
        }
