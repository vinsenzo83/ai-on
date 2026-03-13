"""tests/tools/test_tools_search.py – Phase 15 SearchTool tests."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.tools.tools.search import SearchTool
from app.tools.types        import ToolErrorCode, ToolInput


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_mock_client(json_data: dict, status_code: int = 200):
    """Return a mock async httpx client."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data
    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    return mock_client


_DDG_RESPONSE = {
    "RelatedTopics": [
        {"Text": "Snail Mucin serum K-Beauty product", "FirstURL": "https://example.com/1"},
        {"Text": "Korean skincare routine guide",      "FirstURL": "https://example.com/2"},
    ],
    "Abstract":     "",
    "AbstractURL":  "",
    "Heading":      "K-Beauty",
}


# ─────────────────────────────────────────────────────────────────────────────
# Identity & schema
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchToolContract:
    def test_name(self):
        assert SearchTool().name == "search"

    def test_actions(self):
        actions = SearchTool().get_actions()
        assert "query"        in actions
        assert "news"         in actions
        assert "image_search" in actions

    def test_can_handle(self):
        t = SearchTool()
        assert t.can_handle("query")   is True
        assert t.can_handle("unknown") is False

    def test_input_schema_keys(self):
        schema = SearchTool().get_input_schema()
        assert "query" in schema
        assert "limit" in schema

    def test_output_schema_keys(self):
        schema = SearchTool().get_output_schema()
        assert "results" in schema


# ─────────────────────────────────────────────────────────────────────────────
# Input validation
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchToolValidation:
    def test_valid_input(self):
        ti = ToolInput(tool_name="search", action="query", params={"query": "serum"})
        r  = SearchTool().validate_input(ti)
        assert r.passed

    def test_missing_query(self):
        ti = ToolInput(tool_name="search", action="query", params={})
        r  = SearchTool().validate_input(ti)
        assert not r.passed
        assert any("query" in e.lower() for e in r.errors)

    def test_empty_query(self):
        ti = ToolInput(tool_name="search", action="query", params={"query": ""})
        r  = SearchTool().validate_input(ti)
        assert not r.passed


# ─────────────────────────────────────────────────────────────────────────────
# Happy path
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchToolHappyPath:
    @pytest.mark.asyncio
    async def test_query_returns_results(self):
        tool = SearchTool(http_client=_make_mock_client(_DDG_RESPONSE))
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "k-beauty serum", "limit": 5},
        )
        raw = await tool.execute_action(ti)
        assert "results" in raw
        assert len(raw["results"]) == 2

    @pytest.mark.asyncio
    async def test_normalize_output_shape(self):
        tool = SearchTool(http_client=_make_mock_client(_DDG_RESPONSE))
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "snail cream"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        assert normalized["query"]            == "snail cream"
        assert isinstance(normalized["results"], list)
        assert isinstance(normalized["total"],   int)
        assert normalized["total"]            == len(normalized["results"])

    @pytest.mark.asyncio
    async def test_each_result_has_required_keys(self):
        tool = SearchTool(http_client=_make_mock_client(_DDG_RESPONSE))
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "toner"},
        )
        raw        = await tool.execute_action(ti)
        normalized = tool.normalize_output(raw)

        for item in normalized["results"]:
            assert "title"   in item
            assert "url"     in item
            assert "snippet" in item

    @pytest.mark.asyncio
    async def test_limit_respected(self):
        tool = SearchTool(http_client=_make_mock_client(_DDG_RESPONSE))
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "moisturizer", "limit": 1},
        )
        raw = await tool.execute_action(ti)
        assert len(raw["results"]) <= 1

    def test_validate_output_missing_results_fails(self):
        r = SearchTool().validate_output({"no_results": True})
        assert not r.passed

    def test_validate_output_valid(self):
        r = SearchTool().validate_output({"results": []})
        assert r.passed


# ─────────────────────────────────────────────────────────────────────────────
# Error handling
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchToolErrors:
    @pytest.mark.asyncio
    async def test_network_error_raises_tool_action_error(self):
        from app.tools.base import ToolActionError
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
        tool = SearchTool(http_client=mock_client)
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "test"},
        )
        with pytest.raises(ToolActionError):
            await tool.execute_action(ti)

    @pytest.mark.asyncio
    async def test_http_error_status(self):
        from app.tools.base import ToolActionError
        tool = SearchTool(http_client=_make_mock_client({}, status_code=503))
        ti   = ToolInput(
            tool_name = "search",
            action    = "query",
            params    = {"query": "test"},
        )
        with pytest.raises(ToolActionError):
            await tool.execute_action(ti)
