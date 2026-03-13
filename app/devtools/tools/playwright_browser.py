"""
app/devtools/tools/playwright_browser.py
──────────────────────────────────────────
Phase 16 — Stage A · Tool 7: Playwright Browser Automation

FREEZE STATUS: OPEN (safe to extend)

Supported actions
─────────────────
  navigate      – open a URL and return page title + HTML
  screenshot    – capture a page screenshot (base64 PNG)
  click         – click a CSS/XPath selector
  fill          – fill an input selector with text
  extract_text  – extract visible text from a page
  get_html      – get the full or partial HTML of a page

Design notes
────────────
  • This tool wraps playwright-python in async mode.
  • A single browser instance is created per-tool-call (stateless).
    For stateful multi-step workflows, use the WorkflowTool with
    a shared context — see Stage C.
  • When playwright is not installed, all actions raise DependencyError.
  • All actions require DevToolMode.FULL (browser = external I/O + EXECUTE).
  • A configurable timeout defaults to 30 s; max 120 s.
  • Screenshots are returned as base64-encoded PNG bytes.
  • DOM extraction strips <script>, <style>, and comments.

Input params (all actions)
──────────────────────────
  url           : str   – target URL (required for navigate/screenshot/
                          click/fill/extract_text/get_html)
  selector      : str   – CSS or XPath selector (click, fill, get_html)
  value         : str   – text to type (fill)
  timeout       : float – seconds (default 30, max 120)
  wait_for      : str   – "load" | "networkidle" | "domcontentloaded" (default "load")
  headless      : bool  – run browser headless (default True)
  viewport_width  : int – default 1280
  viewport_height : int – default 720

Normalized output shapes
────────────────────────
  navigate     → { url, title, status_code, html_snippet }
  screenshot   → { url, image_b64: str, width: int, height: int }
  click        → { url, selector, clicked: bool }
  fill         → { url, selector, value, filled: bool }
  extract_text → { url, text: str, word_count: int }
  get_html     → { url, html: str, selector }
"""
from __future__ import annotations

import base64
import html as html_lib
import os
import re
from typing import Any

import structlog

from app.devtools.base        import BaseDevTool
from app.devtools.errors      import DependencyError, DevToolError, PermissionError_
from app.devtools.normalizers import combine, require_param, truncate
from app.devtools.types       import (
    DevToolErrorCode,
    DevToolInput,
    DevToolMode,
    DevToolOpType,
    DevToolValidationResult,
)

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = [
    "navigate",
    "screenshot",
    "click",
    "fill",
    "extract_text",
    "get_html",
]

_DEFAULT_TIMEOUT = 30.0
_MAX_TIMEOUT     = 120.0
_URL_RE          = re.compile(r"^https?://", re.IGNORECASE)


class PlaywrightBrowserTool(BaseDevTool):
    """
    First-class Playwright browser automation tool.

    Each call launches an isolated browser context (stateless).
    For multi-step stateful workflows use WorkflowTool (Stage C).
    """

    @property
    def name(self) -> str:
        return "playwright_browser"

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_op_type(self) -> str:
        return DevToolOpType.BROWSER

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "url":             {"type": "string",  "required": True},
            "selector":        {"type": "string",  "required": False},
            "value":           {"type": "string",  "required": False},
            "timeout":         {"type": "number",  "required": False, "default": 30.0},
            "wait_for":        {"type": "string",  "required": False, "default": "load"},
            "headless":        {"type": "boolean", "required": False, "default": True},
            "viewport_width":  {"type": "integer", "required": False, "default": 1280},
            "viewport_height": {"type": "integer", "required": False, "default": 720},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "navigate":     {"url": "str", "title": "str", "status_code": "int", "html_snippet": "str"},
            "screenshot":   {"url": "str", "image_b64": "str", "width": "int", "height": "int"},
            "click":        {"url": "str", "selector": "str", "clicked": "bool"},
            "fill":         {"url": "str", "selector": "str", "value": "str", "filled": "bool"},
            "extract_text": {"url": "str", "text": "str", "word_count": "int"},
            "get_html":     {"url": "str", "html": "str", "selector": "str|None"},
        }

    def requires_mode(self) -> str:
        return DevToolMode.FULL

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: DevToolInput) -> DevToolValidationResult:
        p      = tool_input.params
        action = tool_input.action

        base = [require_param(p, "url", param_type=str)]

        if tool_input.mode != DevToolMode.FULL:
            base.append(DevToolValidationResult.fail(
                f"PlaywrightBrowserTool requires mode=FULL; got {tool_input.mode!r}"
            ))

        url = p.get("url", "")
        if url and not _URL_RE.match(url):
            base.append(DevToolValidationResult.fail(
                f"url must start with http:// or https://; got {url!r}"
            ))

        if action in ("click", "fill"):
            base.append(require_param(p, "selector", param_type=str))
        if action == "fill":
            base.append(require_param(p, "value", param_type=str))

        return combine(*base)

    def validate_output(self, raw: Any) -> DevToolValidationResult:
        if not isinstance(raw, dict):
            return DevToolValidationResult.fail("raw_output must be a dict")
        return DevToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: DevToolInput) -> Any:
        p      = tool_input.params
        action = tool_input.action

        # Lazy import — raises DependencyError when not installed
        try:
            from playwright.async_api import async_playwright, TimeoutError as PWTimeout
        except ImportError:
            raise DependencyError("playwright")

        url       = p["url"]
        timeout   = min(float(p.get("timeout", _DEFAULT_TIMEOUT)), _MAX_TIMEOUT) * 1000  # ms
        wait_for  = p.get("wait_for", "load")
        headless  = bool(p.get("headless", True))
        vw        = int(p.get("viewport_width",  1280))
        vh        = int(p.get("viewport_height", 720))

        logger.info("playwright_browser_tool.execute", action=action, url=url)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=headless)
            context = await browser.new_context(viewport={"width": vw, "height": vh})
            page    = await context.new_page()

            try:
                resp = await page.goto(url, wait_until=wait_for, timeout=timeout)
                status_code = resp.status if resp else 0

                if action == "navigate":
                    result = await self._navigate(page, url, status_code)

                elif action == "screenshot":
                    result = await self._screenshot(page, url, vw, vh)

                elif action == "click":
                    result = await self._click(page, url, p["selector"], timeout)

                elif action == "fill":
                    result = await self._fill(page, url, p["selector"],
                                              p["value"], timeout)

                elif action == "extract_text":
                    result = await self._extract_text(page, url)

                elif action == "get_html":
                    selector = p.get("selector")
                    result = await self._get_html(page, url, selector)

                else:
                    raise DevToolError(
                        f"Unknown action: {action!r}",
                        error_code=DevToolErrorCode.UNSUPPORTED_ACTION,
                    )

            except PWTimeout as exc:
                raise DevToolError(
                    f"Playwright timeout on {url!r}: {exc}",
                    error_code=DevToolErrorCode.TIMEOUT,
                    retryable=True,
                ) from exc
            except DevToolError:
                raise
            except Exception as exc:
                raise DevToolError(
                    f"Playwright error on {url!r}: {exc}",
                    error_code=DevToolErrorCode.ACTION_FAILED,
                ) from exc
            finally:
                await context.close()
                await browser.close()

        return result

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> dict[str, Any]:
        norm = dict(raw)
        if "html_snippet" in norm:
            norm["html_snippet"] = truncate(norm.get("html_snippet") or "", 5_000)
        if "html" in norm:
            norm["html"] = truncate(norm.get("html") or "", 100_000)
        if "text" in norm:
            norm["text"] = truncate(norm.get("text") or "", 50_000)
        return norm

    # ── Internal action handlers ──────────────────────────────────────────────

    async def _navigate(self, page: Any, url: str, status_code: int) -> dict:
        title       = await page.title()
        html_snippet = (await page.content())[:2000]
        return {
            "url":          url,
            "title":        title,
            "status_code":  status_code,
            "html_snippet": html_snippet,
        }

    async def _screenshot(self, page: Any, url: str, vw: int, vh: int) -> dict:
        png_bytes = await page.screenshot(full_page=False)
        image_b64 = base64.b64encode(png_bytes).decode("ascii")
        return {
            "url":       url,
            "image_b64": image_b64,
            "width":     vw,
            "height":    vh,
        }

    async def _click(self, page: Any, url: str,
                     selector: str, timeout: float) -> dict:
        await page.click(selector, timeout=timeout)
        return {"url": url, "selector": selector, "clicked": True}

    async def _fill(self, page: Any, url: str,
                    selector: str, value: str, timeout: float) -> dict:
        await page.fill(selector, value, timeout=timeout)
        return {"url": url, "selector": selector, "value": value, "filled": True}

    async def _extract_text(self, page: Any, url: str) -> dict:
        # Use innerText for clean, visible text
        text = await page.evaluate("() => document.body.innerText")
        text = (text or "").strip()
        word_count = len(text.split()) if text else 0
        return {"url": url, "text": text, "word_count": word_count}

    async def _get_html(
        self, page: Any, url: str, selector: str | None
    ) -> dict:
        if selector:
            element = await page.query_selector(selector)
            html = await element.inner_html() if element else ""
        else:
            html = await page.content()
        return {"url": url, "html": html, "selector": selector}
