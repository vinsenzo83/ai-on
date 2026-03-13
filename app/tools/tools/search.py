"""
app/tools/tools/search.py
─────────────────────────
Phase 15 — Tool integration layer.

SearchTool: web and news search via configurable HTTP backend.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: OPEN (regular development)                      │
│  Follow BaseTool contract.  Do not modify base.py / types.py.  │
└─────────────────────────────────────────────────────────────────┘

Supported actions
─────────────────
  query         – general web search
  news          – news-focused search
  image_search  – image search

Input params
────────────
  query  : str           – search query string (required)
  limit  : int           – max results to return (default 5, max 20)
  lang   : str           – language code, e.g. "en" (default "en")

Normalized output shape
───────────────────────
  {
    "query":   str,
    "action":  str,
    "results": [
        {
            "title":   str,
            "url":     str,
            "snippet": str,
        },
        ...
    ],
    "total":   int
  }

Design notes
────────────
  • Uses httpx for async HTTP (stdlib-compatible mock-friendly).
  • Default backend: DuckDuckGo Instant Answer API (no key required).
  • Backend is injected via constructor for testability.
  • Production users can swap to SerpAPI / Bing by passing a custom
    ``http_client`` or subclassing and overriding ``_call_backend``.
"""
from __future__ import annotations

import json
from typing import Any

import structlog

from app.tools.base       import BaseTool, ToolActionError
from app.tools.types      import ToolErrorCode, ToolInput, ToolValidationResult
from app.tools.validators import combine, require_non_empty_string, require_param

logger = structlog.get_logger(__name__)

_SUPPORTED_ACTIONS = ["query", "news", "image_search"]
_DEFAULT_LIMIT     = 5
_MAX_LIMIT         = 20

# DuckDuckGo Instant Answer API endpoint (no key required)
_DDG_URL = "https://api.duckduckgo.com/"


class SearchTool(BaseTool):
    """Web / news / image search tool."""

    def __init__(self, http_client: Any = None) -> None:
        """
        Parameters
        ----------
        http_client : optional async httpx.AsyncClient or compatible mock.
                      When None the tool uses a fresh httpx.AsyncClient per
                      request (safe for tests that mock httpx).
        """
        self._http_client = http_client

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "search"

    # ── Schema & capability ───────────────────────────────────────────────────

    def get_actions(self) -> list[str]:
        return list(_SUPPORTED_ACTIONS)

    def get_input_schema(self) -> dict[str, Any]:
        return {
            "query": {"type": "string", "required": True,  "description": "Search query"},
            "limit": {"type": "integer","required": False, "default": 5,  "max": 20},
            "lang":  {"type": "string", "required": False, "default": "en"},
        }

    def get_output_schema(self) -> dict[str, Any]:
        return {
            "query":   {"type": "string"},
            "action":  {"type": "string"},
            "results": {
                "type":  "array",
                "items": {
                    "title":   {"type": "string"},
                    "url":     {"type": "string"},
                    "snippet": {"type": "string"},
                },
            },
            "total": {"type": "integer"},
        }

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_input(self, tool_input: ToolInput) -> ToolValidationResult:
        p = tool_input.params
        return combine(
            require_param(p, "query", param_type=str),
            require_non_empty_string(p.get("query", ""), "query"),
        )

    def validate_output(self, raw_output: Any) -> ToolValidationResult:
        if not isinstance(raw_output, dict):
            return ToolValidationResult.fail("raw_output must be a dict")
        if "results" not in raw_output:
            return ToolValidationResult.fail("raw_output missing 'results' key")
        if not isinstance(raw_output["results"], list):
            return ToolValidationResult.fail("raw_output['results'] must be a list")
        return ToolValidationResult.ok()

    # ── Execution ─────────────────────────────────────────────────────────────

    async def execute_action(self, tool_input: ToolInput) -> Any:
        query  = tool_input.params["query"]
        limit  = min(int(tool_input.params.get("limit", _DEFAULT_LIMIT)), _MAX_LIMIT)
        action = tool_input.action

        logger.info(
            "search_tool.execute",
            action = action,
            query  = query,
            limit  = limit,
        )

        try:
            results = await self._call_backend(query, action=action, limit=limit)
        except ToolActionError:
            raise
        except Exception as exc:
            raise ToolActionError(
                f"Search backend error: {exc}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            ) from exc

        return {"query": query, "action": action, "results": results}

    # ── Normalization ─────────────────────────────────────────────────────────

    def normalize_output(self, raw_output: Any) -> dict[str, Any]:
        results = raw_output.get("results", [])
        normalized_results = []
        for item in results:
            normalized_results.append(
                {
                    "title":   str(item.get("title",   "")),
                    "url":     str(item.get("url",     "")),
                    "snippet": str(item.get("snippet", "")),
                }
            )
        return {
            "query":   raw_output.get("query",  ""),
            "action":  raw_output.get("action", ""),
            "results": normalized_results,
            "total":   len(normalized_results),
        }

    # ── Backend (mockable) ────────────────────────────────────────────────────

    async def _call_backend(
        self,
        query: str,
        *,
        action: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """
        Call the search backend and return a list of result dicts.

        Default implementation uses the DuckDuckGo Instant Answer API.
        Override for SerpAPI, Bing, etc.
        """
        try:
            import httpx  # lazy import – avoids hard dep in tests
        except ImportError:
            raise ToolActionError(
                "httpx is not installed. Run: pip install httpx",
                error_code=ToolErrorCode.DEPENDENCY_ERROR,
            )

        params: dict[str, Any] = {
            "q":       query,
            "format":  "json",
            "no_html": "1",
            "skip_disambig": "1",
        }

        if self._http_client is not None:
            resp = await self._http_client.get(_DDG_URL, params=params)
        else:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(_DDG_URL, params=params)

        if resp.status_code != 200:
            raise ToolActionError(
                f"Search API returned HTTP {resp.status_code}",
                error_code=ToolErrorCode.NETWORK_ERROR,
            )

        data = resp.json()
        results: list[dict[str, Any]] = []

        # DuckDuckGo returns RelatedTopics as primary results
        for topic in data.get("RelatedTopics", []):
            if len(results) >= limit:
                break
            if isinstance(topic, dict) and "Text" in topic:
                results.append(
                    {
                        "title":   topic.get("Text", "")[:120],
                        "url":     topic.get("FirstURL", ""),
                        "snippet": topic.get("Text", ""),
                    }
                )

        # Fallback: use Abstract if no RelatedTopics
        if not results and data.get("Abstract"):
            results.append(
                {
                    "title":   data.get("Heading", query),
                    "url":     data.get("AbstractURL", ""),
                    "snippet": data.get("Abstract", ""),
                }
            )

        return results[:limit]
