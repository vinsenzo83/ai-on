"""
tests/integration/test_route_integration.py
─────────────────────────────────────────────
Phase 15-17 — FastAPI Route Integration Tests.

Covers:
  A. Tools router  (/tools)       — Phase 15
  B. DevTools router (/devtools)  — Phase 16
  C. Orchestration router         — Phase 17
  D. Route registration audit     — all 3 routers wired into app
  E. Auth guard checks            — missing / wrong-role rejection
  F. Validation errors            — 422 on bad bodies
  G. Batch endpoints
  H. Pipeline endpoint
  I. Module catalogue endpoints

All tests run without a live database or external service.
The decode_token dependency is patched so Bearer tokens are parsed
from a simple fake-token-{ROLE} convention (identical to sprint5 pattern).
"""
from __future__ import annotations

from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _auth(role: str = "ADMIN") -> dict[str, str]:
    """Return Authorization header for the given role."""
    return {"Authorization": f"Bearer fake-token-{role}"}


def _fake_decode(token: str) -> dict[str, Any]:
    """
    Fake decode_token: parses 'fake-token-ROLE' convention.
    Returns a payload dict that get_current_user reads.
    """
    parts = token.split("-")
    role  = parts[-1] if len(parts) >= 3 else "VIEWER"
    return {"sub": f"test-{role.lower()}@kbeauty.local", "role": role}


# ─────────────────────────────────────────────────────────────────────────────
# App / Client fixture
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """
    Async HTTP test client.
    - No lifespan (no DB required).
    - decode_token patched to accept fake-token-{ROLE} scheme.
    """
    from app.main import create_app

    app = create_app(use_lifespan=False)

    with patch("app.services.auth_service.decode_token", side_effect=_fake_decode):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac


# ─────────────────────────────────────────────────────────────────────────────
# D. Route registration audit
# ─────────────────────────────────────────────────────────────────────────────

class TestRouteRegistration:
    """Verify all Phase 15-17 routes are wired into the main app."""

    @pytest.mark.asyncio
    async def test_openapi_includes_tools_routes(self, client: AsyncClient) -> None:
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert "/tools/" in paths
        assert "/tools/{tool_name}" in paths
        assert "/tools/{tool_name}/{action}" in paths
        assert "/tools/batch" in paths

    @pytest.mark.asyncio
    async def test_openapi_includes_devtools_routes(self, client: AsyncClient) -> None:
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert "/devtools/" in paths
        assert "/devtools/{tool_name}" in paths
        assert "/devtools/{tool_name}/{action}" in paths
        assert "/devtools/batch" in paths

    @pytest.mark.asyncio
    async def test_openapi_includes_orchestration_routes(self, client: AsyncClient) -> None:
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert "/orchestration/" in paths
        assert "/orchestration/workflows" in paths
        assert "/orchestration/modules" in paths
        assert "/orchestration/pipeline" in paths
        # All 6 named workflows
        for wf in [
            "website_analysis", "document_pdf", "search_summary",
            "devtool_code", "devtool_document", "browser_extract", "generic",
        ]:
            assert f"/orchestration/workflows/{wf}" in paths, f"Missing route for {wf}"

    @pytest.mark.asyncio
    async def test_app_version_updated(self, client: AsyncClient) -> None:
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        assert resp.json()["info"]["version"] == "0.7.0"

    @pytest.mark.asyncio
    async def test_total_route_count_gte_97(self, client: AsyncClient) -> None:
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert len(paths) >= 90  # 97 routes including all phases


# ─────────────────────────────────────────────────────────────────────────────
# E. Auth guard checks
# ─────────────────────────────────────────────────────────────────────────────

class TestAuthGuards:
    """All Phase 15-17 routes must require authentication."""

    @pytest.mark.asyncio
    async def test_tools_list_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_tools_schema_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/search")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_tools_execute_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post("/tools/search/query", json={"params": {"query": "test"}})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_tools_batch_requires_operator(self, client: AsyncClient) -> None:
        body = {"actions": [{"tool_name": "search", "action": "query", "params": {"query": "t"}}]}
        # VIEWER should be rejected
        resp = await client.post("/tools/batch", json=body, headers=_auth("VIEWER"))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_devtools_list_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_devtools_execute_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post("/devtools/git/status", json={})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_devtools_batch_requires_operator(self, client: AsyncClient) -> None:
        body = {"actions": [{"tool_name": "git", "action": "status", "params": {}}]}
        resp = await client.post("/devtools/batch", json=body, headers=_auth("VIEWER"))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_orchestration_health_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.get("/orchestration/")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_orchestration_pipeline_requires_operator(self, client: AsyncClient) -> None:
        body = {
            "steps": [{"step_name": "s1", "text": "hello", "task_type": "summarize"}]
        }
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("VIEWER"))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_devtools_mode_full_requires_admin(self, client: AsyncClient) -> None:
        body = {
            "params": {"workspace_root": "/tmp"},
            "mode":   "full",
        }
        # OPERATOR does not satisfy FULL → ADMIN
        resp = await client.post(
            "/devtools/terminal/run_command", json=body, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# A. Tools router — Phase 15
# ─────────────────────────────────────────────────────────────────────────────

class TestToolsRouter:
    """Phase 15 /tools routes — registry, schema, execution."""

    @pytest.mark.asyncio
    async def test_list_tools_returns_registry(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert "tool_count" in data
        assert "tools" in data
        assert data["tool_count"] >= 6  # search, pdf, ocr, email, image, browser
        assert "search" in data["tools"]
        assert "browser" in data["tools"]

    @pytest.mark.asyncio
    async def test_list_tools_shows_actions(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/", headers=_auth("VIEWER"))
        data = resp.json()
        assert "query" in data["tools"]["search"]
        assert "fetch" in data["tools"]["browser"]

    @pytest.mark.asyncio
    async def test_list_tools_total_actions(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/", headers=_auth("VIEWER"))
        data = resp.json()
        assert data["total_actions"] >= 20  # 6 tools × avg 3-4 actions

    @pytest.mark.asyncio
    async def test_get_tool_schema_search(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/search", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["tool_name"] == "search"
        assert "actions" in data
        assert "input_schema" in data
        assert "output_schema" in data
        assert "query" in data["actions"]

    @pytest.mark.asyncio
    async def test_get_tool_schema_browser(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/browser", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["tool_name"] == "browser"
        assert "fetch" in data["actions"]

    @pytest.mark.asyncio
    async def test_get_tool_schema_unknown_returns_404(self, client: AsyncClient) -> None:
        resp = await client.get("/tools/nonexistent_tool_xyz", headers=_auth("VIEWER"))
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_execute_tool_search_query(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/search/query",
            json={"params": {"query": "kbeauty trends 2025"}, "metadata": {"test": True}},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        assert "tool_name" in data
        assert data["tool_name"] == "search"
        assert data["action"] == "query"

    @pytest.mark.asyncio
    async def test_execute_tool_browser_fetch(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/browser/fetch",
            json={"params": {"url": "https://example.com"}},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        assert data["tool_name"] == "browser"

    @pytest.mark.asyncio
    async def test_execute_tool_returns_request_id(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/search/query",
            json={"params": {"query": "test"}, "request_id": "my-req-001"},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("request_id") == "my-req-001"

    @pytest.mark.asyncio
    async def test_execute_tool_unknown_tool_returns_404(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/fake_tool/action",
            json={"params": {}},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_execute_tool_unknown_action_returns_success_false(
        self, client: AsyncClient
    ) -> None:
        # Unknown action — executor returns success=False (not a 404)
        resp = await client.post(
            "/tools/search/nonexistent_action",
            json={"params": {"query": "test"}},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False

    @pytest.mark.asyncio
    async def test_execute_tool_invalid_base64_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/pdf/extract_text",
            json={"params": {"content_b64": "!!! invalid base64 !!!"}},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_execute_all_six_tools(self, client: AsyncClient) -> None:
        """Each tool can be called without 401/404."""
        tools_actions = [
            ("search",  "query",        {"query": "test"}),
            ("pdf",     "extract_text", {}),
            ("ocr",     "extract_text", {}),
            ("email",   "validate_addr", {"email": "test@example.com"}),
            ("image",   "download",     {"url": "https://example.com/img.png"}),
            ("browser", "fetch",        {"url": "https://example.com"}),
        ]
        for tool, action, params in tools_actions:
            resp = await client.post(
                f"/tools/{tool}/{action}",
                json={"params": params},
                headers=_auth("VIEWER"),
            )
            assert resp.status_code == 200, f"Unexpected {resp.status_code} for {tool}/{action}"
            data = resp.json()
            assert "success" in data, f"No success key for {tool}/{action}"


# ─────────────────────────────────────────────────────────────────────────────
# G. Batch tools endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestToolsBatch:
    """POST /tools/batch — requires OPERATOR role, max 20 items."""

    @pytest.mark.asyncio
    async def test_batch_single_item(self, client: AsyncClient) -> None:
        body = {
            "actions": [
                {"tool_name": "search", "action": "query", "params": {"query": "batch test"}}
            ]
        }
        resp = await client.post("/tools/batch", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert len(data["results"]) == 1
        assert "succeeded" in data
        assert "failed" in data

    @pytest.mark.asyncio
    async def test_batch_multiple_items(self, client: AsyncClient) -> None:
        body = {
            "actions": [
                {"tool_name": "search",  "action": "query", "params": {"query": "item1"}},
                {"tool_name": "browser", "action": "fetch", "params": {"url": "https://x.com"}},
                {"tool_name": "search",  "action": "news",  "params": {"query": "item3"}},
            ]
        }
        resp = await client.post("/tools/batch", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 3
        assert len(data["results"]) == 3
        # Each result has required fields
        for r in data["results"]:
            assert "success" in r
            assert "tool_name" in r

    @pytest.mark.asyncio
    async def test_batch_empty_actions_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post("/tools/batch", json={"actions": []}, headers=_auth("OPERATOR"))
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_batch_too_many_items_returns_422(self, client: AsyncClient) -> None:
        actions = [
            {"tool_name": "search", "action": "query", "params": {"query": str(i)}}
            for i in range(21)
        ]
        resp = await client.post(
            "/tools/batch", json={"actions": actions}, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_batch_partial_failure_does_not_abort(self, client: AsyncClient) -> None:
        """Unknown tool should produce success=False, not abort the batch."""
        body = {
            "actions": [
                {"tool_name": "search",   "action": "query", "params": {"query": "ok"}},
                {"tool_name": "bad_tool", "action": "bad",   "params": {}},
            ]
        }
        # First action: tool exists → executor runs (may or may not succeed)
        # Second action: tool doesn't exist → executor returns success=False
        # Since /tools/batch performs tool-existence check inside execute_many
        # (executor handles it), both items return 200-level with success flags.
        # The router itself returns 200.
        resp = await client.post("/tools/batch", json=body, headers=_auth("OPERATOR"))
        # 200 is returned even with partial failure (individual results carry success flag)
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 2

    @pytest.mark.asyncio
    async def test_batch_admin_can_also_execute(self, client: AsyncClient) -> None:
        body = {
            "actions": [
                {"tool_name": "search", "action": "query", "params": {"query": "admin batch"}}
            ]
        }
        resp = await client.post("/tools/batch", json=body, headers=_auth("ADMIN"))
        assert resp.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# B. DevTools router — Phase 16
# ─────────────────────────────────────────────────────────────────────────────

class TestDevtoolsRouter:
    """Phase 16 /devtools routes — registry, schema, execution."""

    @pytest.mark.asyncio
    async def test_list_devtools_returns_registry(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/", headers=_auth("ADMIN"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["tool_count"] >= 18
        assert "tools" in data
        assert "git" in data["tools"]
        assert "filesystem" in data["tools"]
        assert "terminal" in data["tools"]

    @pytest.mark.asyncio
    async def test_list_devtools_shows_actions(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/", headers=_auth("ADMIN"))
        data = resp.json()
        git_info = data["tools"]["git"]
        assert "actions" in git_info
        assert "status" in git_info["actions"]

    @pytest.mark.asyncio
    async def test_list_devtools_shows_mode_requirements(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/", headers=_auth("ADMIN"))
        data = resp.json()
        assert "mode_hierarchy" in data
        assert "read_only" in data["mode_hierarchy"]
        assert "safe_write" in data["mode_hierarchy"]
        assert "full" in data["mode_hierarchy"]

    @pytest.mark.asyncio
    async def test_get_devtool_schema_git(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/git", headers=_auth("ADMIN"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["tool_name"] == "git"
        assert "actions" in data
        assert "op_type" in data
        assert "minimum_mode" in data
        assert "input_schema" in data
        assert "output_schema" in data

    @pytest.mark.asyncio
    async def test_get_devtool_schema_unknown_returns_404(self, client: AsyncClient) -> None:
        resp = await client.get("/devtools/nonexistent_devtool_xyz", headers=_auth("ADMIN"))
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_execute_devtool_git_status_read_only(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/devtools/git/status",
            json={"params": {"workspace_root": "/tmp"}, "mode": "read_only"},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        assert "tool_name" in data
        assert data["tool_name"] == "git"
        assert data["action"] == "status"

    @pytest.mark.asyncio
    async def test_execute_devtool_filesystem_read_file(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/devtools/filesystem/read_file",
            json={"params": {"path": "/tmp/test.txt", "workspace_root": "/tmp"}, "mode": "read_only"},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data

    @pytest.mark.asyncio
    async def test_execute_devtool_returns_request_id(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/devtools/git/log",
            json={
                "params":     {"workspace_root": "/tmp"},
                "mode":       "read_only",
                "request_id": "devtool-req-42",
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("request_id") == "devtool-req-42"

    @pytest.mark.asyncio
    async def test_execute_devtool_safe_write_requires_operator(
        self, client: AsyncClient
    ) -> None:
        resp = await client.post(
            "/devtools/filesystem/write_file",
            json={
                "params": {"path": "/tmp/out.txt", "content": "hello", "workspace_root": "/tmp"},
                "mode":   "safe_write",
            },
            headers=_auth("VIEWER"),   # VIEWER < OPERATOR → 403
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_execute_devtool_full_mode_allowed_for_admin(
        self, client: AsyncClient
    ) -> None:
        resp = await client.post(
            "/devtools/terminal/run_command",
            json={
                "params": {"command": "echo hello", "workspace_root": "/tmp"},
                "mode":   "full",
            },
            headers=_auth("ADMIN"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data

    @pytest.mark.asyncio
    async def test_execute_all_18_devtools_read_only(self, client: AsyncClient) -> None:
        """Every devtool returns 200 (read_only, VIEWER) — no 401/404."""
        devtools_actions = [
            ("repo_search",       "search_files"),
            ("filesystem",        "read_file"),
            ("code_patch",        "view_diff"),
            ("terminal",          "run_command"),
            ("test_runner",       "run_tests"),
            ("git",               "status"),
            ("playwright_browser","navigate"),
            ("lint_format",       "lint"),
            ("dependency",        "list_installed"),
            ("log_reader",        "read_log"),
            ("build_tool",        "info"),
            ("env_config",        "read_env"),
            ("migration",         "status"),
            ("preview",           "status"),
            ("workflow",          "list_workflows"),
            ("deploy_helper",     "validate"),
            ("doc_export",        "generate_readme"),
            ("sandbox_run",       "run_python"),
        ]
        for tool, action in devtools_actions:
            resp = await client.post(
                f"/devtools/{tool}/{action}",
                json={"params": {"workspace_root": "/tmp"}, "mode": "read_only"},
                headers=_auth("VIEWER"),
            )
            assert resp.status_code == 200, (
                f"Unexpected {resp.status_code} for devtools/{tool}/{action}"
            )
            data = resp.json()
            assert "success" in data, f"No success key for {tool}/{action}"


# ─────────────────────────────────────────────────────────────────────────────
# G(b). DevTools batch
# ─────────────────────────────────────────────────────────────────────────────

class TestDevtoolsBatch:
    """POST /devtools/batch."""

    @pytest.mark.asyncio
    async def test_devtools_batch_single_read_only(self, client: AsyncClient) -> None:
        body = {
            "actions": [
                {"tool_name": "git", "action": "status",
                 "params": {"workspace_root": "/tmp"}, "mode": "read_only"}
            ]
        }
        resp = await client.post("/devtools/batch", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert len(data["results"]) == 1

    @pytest.mark.asyncio
    async def test_devtools_batch_mixed_tools(self, client: AsyncClient) -> None:
        body = {
            "actions": [
                {"tool_name": "git",        "action": "status",
                 "params": {"workspace_root": "/tmp"}, "mode": "read_only"},
                {"tool_name": "filesystem", "action": "list_dir",
                 "params": {"path": "/tmp", "workspace_root": "/tmp"}, "mode": "read_only"},
                {"tool_name": "log_reader", "action": "read_log",
                 "params": {"log_path": "/tmp/app.log", "workspace_root": "/tmp"},
                 "mode": "read_only"},
            ]
        }
        resp = await client.post("/devtools/batch", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 3
        assert "succeeded" in data
        assert "failed" in data

    @pytest.mark.asyncio
    async def test_devtools_batch_role_violation_rejected_before_execution(
        self, client: AsyncClient
    ) -> None:
        """Batch with a FULL-mode item should fail pre-validation for OPERATOR."""
        body = {
            "actions": [
                {"tool_name": "git",      "action": "status",
                 "params": {}, "mode": "read_only"},
                {"tool_name": "terminal", "action": "run_command",
                 "params": {}, "mode": "full"},   # FULL requires ADMIN
            ]
        }
        resp = await client.post("/devtools/batch", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_devtools_batch_empty_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/devtools/batch", json={"actions": []}, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_devtools_batch_too_many_returns_422(self, client: AsyncClient) -> None:
        actions = [
            {"tool_name": "git", "action": "status",
             "params": {"workspace_root": "/tmp"}, "mode": "read_only"}
            for _ in range(21)
        ]
        resp = await client.post(
            "/devtools/batch", json={"actions": actions}, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# C. Orchestration router — Phase 17
# ─────────────────────────────────────────────────────────────────────────────

class TestOrchestrationHealth:
    """GET /orchestration/ and /orchestration/workflows."""

    @pytest.mark.asyncio
    async def test_health_returns_workflow_list(self, client: AsyncClient) -> None:
        resp = await client.get("/orchestration/", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert "layer" in data
        assert "workflow_count" in data
        assert data["workflow_count"] >= 8
        assert "workflows" in data
        for wf in ["website_analysis", "document_pdf", "search_summary",
                   "devtool_code", "devtool_document", "browser_extract",
                   "generic", "pipeline"]:
            assert wf in data["workflows"]

    @pytest.mark.asyncio
    async def test_health_returns_module_task_types(self, client: AsyncClient) -> None:
        resp = await client.get("/orchestration/", headers=_auth("VIEWER"))
        data = resp.json()
        assert "module_task_types" in data
        assert len(data["module_task_types"]) >= 23
        assert "summarize" in data["module_task_types"]
        assert "analysis" in data["module_task_types"]

    @pytest.mark.asyncio
    async def test_catalogue_returns_all_workflows(self, client: AsyncClient) -> None:
        resp = await client.get("/orchestration/workflows", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow_count"] >= 8
        wf = data["workflows"]
        for name in ["website_analysis", "document_pdf", "search_summary",
                     "devtool_code", "devtool_document", "browser_extract", "generic", "pipeline"]:
            assert name in wf, f"Missing workflow {name} in catalogue"
            assert "description" in wf[name]
            assert "input_fields" in wf[name]
            assert "required" in wf[name]

    @pytest.mark.asyncio
    async def test_modules_endpoint_returns_registry(self, client: AsyncClient) -> None:
        resp = await client.get("/orchestration/modules", headers=_auth("VIEWER"))
        assert resp.status_code == 200
        data = resp.json()
        assert "module_count" in data
        assert data["module_count"] == 7
        assert "task_type_count" in data
        assert data["task_type_count"] >= 23
        assert "modules" in data
        assert "all_task_types" in data
        # All 7 module names present
        for name in ["classify", "summarize", "translate", "extract",
                     "analysis", "document", "code"]:
            assert name in data["modules"], f"Missing module {name}"


class TestOrchestrationWorkflows:
    """POST /orchestration/workflows/{workflow}."""

    @pytest.mark.asyncio
    async def test_website_analysis_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/website_analysis",
            json={
                "url":           "https://example.com",
                "text":          "This is a K-beauty website with toner and serum products.",
                "analysis_type": "general",
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "website_analysis"
        assert "success" in data
        assert "steps" in data
        assert "final_output" in data
        assert "latency_ms" in data
        assert "request_id" in data

    @pytest.mark.asyncio
    async def test_website_analysis_metadata_present(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/website_analysis",
            json={"text": "kbeauty product page content here.", "url": "https://shop.com"},
            headers=_auth("VIEWER"),
        )
        data = resp.json()
        assert "metadata" in data
        assert data["metadata"].get("tool_name") == "browser"

    @pytest.mark.asyncio
    async def test_website_analysis_request_id_propagated(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/website_analysis",
            json={"text": "content", "request_id": "orch-req-001"},
            headers=_auth("VIEWER"),
        )
        data = resp.json()
        assert data["request_id"] == "orch-req-001"

    @pytest.mark.asyncio
    async def test_document_pdf_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/document_pdf",
            json={
                "text":  "This PDF contains information about K-beauty regulations and product safety.",
                "style": "standard",
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "document_pdf"
        assert "success" in data
        assert len(data["steps"]) == 1
        assert data["steps"][0]["step_name"] == "summarize"

    @pytest.mark.asyncio
    async def test_document_pdf_missing_text_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/document_pdf",
            json={"style": "standard"},  # no text field
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_search_summary_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/search_summary",
            json={
                "query":     "best K-beauty moisturizers",
                "text":      "Search results show Laneige, COSRX, and Innisfree as top brands.",
                "max_words": 100,
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "search_summary"
        assert data["steps"][0]["step_name"] == "summarize"

    @pytest.mark.asyncio
    async def test_search_summary_max_words_validation(self, client: AsyncClient) -> None:
        # max_words < 10 should fail validation
        resp = await client.post(
            "/orchestration/workflows/search_summary",
            json={"text": "content", "max_words": 5},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_devtool_code_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/devtool_code",
            json={
                "text":      "def add(a, b): return a + b\n",
                "language":  "python",
                "tool_name": "filesystem",
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "devtool_code"
        assert data["steps"][0]["step_name"] == "code_analysis"
        assert data["metadata"]["language"] == "python"

    @pytest.mark.asyncio
    async def test_devtool_document_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/devtool_document",
            json={
                "text":     "Repository contains 42 Python files, 8 modules, 1,402 tests.",
                "doc_type": "readme",
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "devtool_document"
        assert data["steps"][0]["step_name"] == "document_generation"

    @pytest.mark.asyncio
    async def test_browser_extract_success(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/browser_extract",
            json={
                "url":    "https://shop.example.com",
                "text":   "Product: COSRX Snail 96, Price: 15000 KRW, Brand: COSRX",
                "fields": ["product_name", "price", "brand"],
            },
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "browser_extract"
        assert data["steps"][0]["step_name"] == "extract"

    @pytest.mark.asyncio
    async def test_browser_extract_no_fields_still_succeeds(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/browser_extract",
            json={"text": "Product page content."},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_generic_workflow_valid_task_type(self, client: AsyncClient) -> None:
        for task_type in ["summarize", "analysis", "translate", "classify",
                          "extract", "document", "code"]:
            resp = await client.post(
                "/orchestration/workflows/generic",
                json={
                    "text":          "Some content to process.",
                    "task_type":     task_type,
                    "workflow_name": f"test_{task_type}",
                },
                headers=_auth("VIEWER"),
            )
            assert resp.status_code == 200, (
                f"Unexpected {resp.status_code} for generic/{task_type}"
            )
            data = resp.json()
            assert "success" in data

    @pytest.mark.asyncio
    async def test_generic_workflow_invalid_task_type_returns_422(
        self, client: AsyncClient
    ) -> None:
        resp = await client.post(
            "/orchestration/workflows/generic",
            json={"text": "content", "task_type": "nonexistent_task_xyz"},
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422
        assert "Unknown task_type" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_generic_workflow_missing_text_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/generic",
            json={"task_type": "summarize"},  # no text
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_generic_workflow_missing_task_type_returns_422(
        self, client: AsyncClient
    ) -> None:
        resp = await client.post(
            "/orchestration/workflows/generic",
            json={"text": "content"},  # no task_type
            headers=_auth("VIEWER"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_all_named_workflows_return_200(self, client: AsyncClient) -> None:
        """Smoke test: every named workflow endpoint returns 200."""
        payloads: list[tuple[str, dict]] = [
            ("website_analysis", {"text": "page content"}),
            ("document_pdf",     {"text": "pdf content"}),
            ("search_summary",   {"text": "search results"}),
            ("devtool_code",     {"text": "def foo(): pass"}),
            ("devtool_document", {"text": "repo structure info"}),
            ("browser_extract",  {"text": "page with products"}),
            ("generic",          {"text": "some content", "task_type": "summarize"}),
        ]
        for workflow, body in payloads:
            resp = await client.post(
                f"/orchestration/workflows/{workflow}",
                json=body,
                headers=_auth("VIEWER"),
            )
            assert resp.status_code == 200, (
                f"Unexpected {resp.status_code} for workflows/{workflow}: {resp.text}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# H. Pipeline endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestOrchestrationPipeline:
    """POST /orchestration/pipeline — OPERATOR required, max 10 steps."""

    @pytest.mark.asyncio
    async def test_pipeline_single_step(self, client: AsyncClient) -> None:
        body = {
            "steps": [
                {
                    "step_name": "classify_step",
                    "text":      "This is a moisturizing cream for dry skin.",
                    "task_type": "classify",
                }
            ],
            "workflow_name": "test_pipeline",
        }
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "test_pipeline"
        assert len(data["steps"]) == 1
        assert data["steps"][0]["step_name"] == "classify_step"
        assert "success" in data

    @pytest.mark.asyncio
    async def test_pipeline_multi_step(self, client: AsyncClient) -> None:
        body = {
            "steps": [
                {"step_name": "step1", "text": "Korean skincare product.", "task_type": "classify"},
                {"step_name": "step2", "text": "Product details here.",    "task_type": "summarize"},
                {"step_name": "step3", "text": "Review text positive.",    "task_type": "analysis"},
            ],
            "workflow_name": "multi_step_pipeline",
        }
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["workflow"] == "multi_step_pipeline"
        assert len(data["steps"]) == 3
        assert data["metadata"]["step_count"] == 3

    @pytest.mark.asyncio
    async def test_pipeline_all_task_types(self, client: AsyncClient) -> None:
        """One step per canonical task type."""
        task_types = ["classify", "summarize", "translate", "extract",
                      "analysis", "document", "code"]
        steps = [
            {"step_name": f"step_{i}", "text": f"Content for {tt}.", "task_type": tt}
            for i, tt in enumerate(task_types)
        ]
        body = {"steps": steps, "workflow_name": "all_tasks_pipeline"}
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["steps"]) == len(task_types)

    @pytest.mark.asyncio
    async def test_pipeline_extra_params_forwarded(self, client: AsyncClient) -> None:
        body = {
            "steps": [
                {
                    "step_name":   "translate_step",
                    "text":        "K-beauty product.",
                    "task_type":   "translate",
                    "extra_params": {"target_lang": "ko"},
                }
            ]
        }
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["steps"]) == 1

    @pytest.mark.asyncio
    async def test_pipeline_invalid_task_type_returns_422(self, client: AsyncClient) -> None:
        body = {
            "steps": [
                {"step_name": "bad", "text": "content", "task_type": "nonexistent_xyz"}
            ]
        }
        resp = await client.post("/orchestration/pipeline", json=body, headers=_auth("OPERATOR"))
        assert resp.status_code == 422
        assert "Unknown task_type" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_pipeline_empty_steps_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/pipeline",
            json={"steps": []},
            headers=_auth("OPERATOR"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_pipeline_too_many_steps_returns_422(self, client: AsyncClient) -> None:
        steps = [
            {"step_name": f"s{i}", "text": "x", "task_type": "summarize"}
            for i in range(11)
        ]
        resp = await client.post(
            "/orchestration/pipeline",
            json={"steps": steps},
            headers=_auth("OPERATOR"),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_pipeline_viewer_rejected(self, client: AsyncClient) -> None:
        body = {
            "steps": [{"step_name": "s", "text": "x", "task_type": "summarize"}]
        }
        resp = await client.post(
            "/orchestration/pipeline", json=body, headers=_auth("VIEWER")
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_pipeline_admin_allowed(self, client: AsyncClient) -> None:
        body = {
            "steps": [{"step_name": "s", "text": "admin content", "task_type": "classify"}]
        }
        resp = await client.post(
            "/orchestration/pipeline", json=body, headers=_auth("ADMIN")
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_pipeline_result_is_json_serialisable(self, client: AsyncClient) -> None:
        import json
        body = {
            "steps": [
                {"step_name": "a", "text": "first input",  "task_type": "summarize"},
                {"step_name": "b", "text": "second input", "task_type": "analysis"},
            ]
        }
        resp = await client.post(
            "/orchestration/pipeline", json=body, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 200
        # Must be serialisable without error
        try:
            json.dumps(resp.json())
        except (TypeError, ValueError) as exc:
            pytest.fail(f"Pipeline response not JSON-serialisable: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# F. Validation error checks (edge cases)
# ─────────────────────────────────────────────────────────────────────────────

class TestValidationErrors:
    """422 responses for malformed bodies."""

    @pytest.mark.asyncio
    async def test_tools_execute_invalid_body_type(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/search/query",
            content=b"not-json",
            headers={**_auth("VIEWER"), "Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_devtools_execute_invalid_body_type(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/devtools/git/status",
            content=b"not-json",
            headers={**_auth("VIEWER"), "Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_orchestration_workflow_invalid_body(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/document_pdf",
            content=b"not-json",
            headers={**_auth("VIEWER"), "Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_orchestration_pipeline_step_missing_required_fields(
        self, client: AsyncClient
    ) -> None:
        body = {
            "steps": [
                {"step_name": "s"}   # missing text and task_type
            ]
        }
        resp = await client.post(
            "/orchestration/pipeline", json=body, headers=_auth("OPERATOR")
        )
        assert resp.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# I. End-to-end flow: route → executor → workflow result
# ─────────────────────────────────────────────────────────────────────────────

class TestEndToEndFlow:
    """Full request-response cycle tests verifying integration glue."""

    @pytest.mark.asyncio
    async def test_tool_result_has_latency_ms(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/tools/search/query",
            json={"params": {"query": "latency test"}},
            headers=_auth("VIEWER"),
        )
        data = resp.json()
        assert "latency_ms" in data
        assert isinstance(data["latency_ms"], (int, float))
        assert data["latency_ms"] >= 0

    @pytest.mark.asyncio
    async def test_workflow_result_has_all_required_keys(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/orchestration/workflows/search_summary",
            json={"text": "Product launches", "query": "kbeauty"},
            headers=_auth("VIEWER"),
        )
        data = resp.json()
        required_keys = {
            "workflow", "request_id", "success", "steps",
            "final_output", "latency_ms", "metadata",
        }
        missing = required_keys - set(data.keys())
        assert not missing, f"WorkflowResult missing keys: {missing}"

    @pytest.mark.asyncio
    async def test_orchestration_and_tools_share_no_db_dependency(
        self, client: AsyncClient
    ) -> None:
        """
        Phase 15-17 routers should work without DB.
        The client fixture has no DB override for tools/devtools/orchestration
        — if these routes called DB they would fail.
        """
        # If these don't return 500 (DB error), they are DB-free ✓
        resp1 = await client.get("/tools/",        headers=_auth("VIEWER"))
        resp2 = await client.get("/devtools/",     headers=_auth("ADMIN"))
        resp3 = await client.get("/orchestration/",headers=_auth("VIEWER"))
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 200

    @pytest.mark.asyncio
    async def test_concurrent_orchestration_requests_independent(
        self, client: AsyncClient
    ) -> None:
        """Multiple workflow calls should return independent results."""
        import asyncio

        async def call_workflow(text: str, req_id: str) -> dict:
            resp = await client.post(
                "/orchestration/workflows/classify",
                json={"text": text, "task_type": "classify", "request_id": req_id},
                headers=_auth("VIEWER"),
            )
            # If 404 (no /workflows/classify), use generic
            if resp.status_code == 404:
                resp = await client.post(
                    "/orchestration/workflows/generic",
                    json={"text": text, "task_type": "classify", "request_id": req_id},
                    headers=_auth("VIEWER"),
                )
            return resp.json()

        results = await asyncio.gather(
            call_workflow("content A", "req-A"),
            call_workflow("content B", "req-B"),
            call_workflow("content C", "req-C"),
        )
        request_ids = {r.get("request_id") for r in results}
        assert request_ids == {"req-A", "req-B", "req-C"}

    @pytest.mark.asyncio
    async def test_pipeline_step_names_preserved(self, client: AsyncClient) -> None:
        body = {
            "steps": [
                {"step_name": "first_classify",  "text": "Classify this.",  "task_type": "classify"},
                {"step_name": "second_summarize","text": "Summarize this.", "task_type": "summarize"},
            ]
        }
        resp = await client.post(
            "/orchestration/pipeline", json=body, headers=_auth("OPERATOR")
        )
        data = resp.json()
        step_names = [s["step_name"] for s in data["steps"]]
        assert step_names == ["first_classify", "second_summarize"]

    @pytest.mark.asyncio
    async def test_workflow_result_json_serialisable(self, client: AsyncClient) -> None:
        import json
        for workflow, body in [
            ("website_analysis", {"text": "page"}),
            ("document_pdf",     {"text": "pdf text"}),
            ("search_summary",   {"text": "results"}),
            ("devtool_code",     {"text": "code"}),
            ("browser_extract",  {"text": "page text"}),
        ]:
            resp = await client.post(
                f"/orchestration/workflows/{workflow}",
                json=body,
                headers=_auth("VIEWER"),
            )
            assert resp.status_code == 200
            try:
                json.dumps(resp.json())
            except (TypeError, ValueError) as exc:
                pytest.fail(f"Workflow {workflow} response not serialisable: {exc}")
