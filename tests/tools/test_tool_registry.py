"""tests/tools/test_tool_registry.py – Phase 15 registry tests."""
from __future__ import annotations

import pytest

from app.tools.base     import BaseTool, ToolActionError
from app.tools.registry import ToolRegistry, get_registry, reset_registry
from app.tools.types    import ToolInput, ToolValidationResult


# ─────────────────────────────────────────────────────────────────────────────
# Stub tool for testing
# ─────────────────────────────────────────────────────────────────────────────

class _StubTool(BaseTool):
    def __init__(self, tool_name: str, actions: list[str] | None = None):
        self._name    = tool_name
        self._actions = actions or ["do_thing"]

    @property
    def name(self) -> str:
        return self._name

    def get_actions(self)               -> list:      return list(self._actions)
    def get_input_schema(self)          -> dict:      return {}
    def get_output_schema(self)         -> dict:      return {}
    def validate_input(self, ti)        -> ToolValidationResult: return ToolValidationResult.ok()
    async def execute_action(self, ti)  -> dict:      return {"ok": True}
    def validate_output(self, raw)      -> ToolValidationResult: return ToolValidationResult.ok()
    def normalize_output(self, raw)     -> dict:      return raw


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestToolRegistry:
    def setup_method(self):
        self.registry = ToolRegistry()

    def test_register_and_resolve(self):
        self.registry.register(_StubTool("stub"))
        tool = self.registry.resolve("stub")
        assert tool.name == "stub"

    def test_resolve_unknown_raises(self):
        with pytest.raises(KeyError, match="No tool registered"):
            self.registry.resolve("nonexistent")

    def test_resolve_or_none_returns_none(self):
        assert self.registry.resolve_or_none("missing") is None

    def test_duplicate_registration_raises(self):
        self.registry.register(_StubTool("dup"))
        with pytest.raises(ValueError, match="already registered"):
            self.registry.register(_StubTool("dup"))

    def test_deregister(self):
        self.registry.register(_StubTool("temp"))
        self.registry.deregister("temp")
        assert self.registry.resolve_or_none("temp") is None

    def test_list_tools(self):
        self.registry.register(_StubTool("alpha"))
        self.registry.register(_StubTool("beta"))
        names = self.registry.list_tools()
        assert "alpha" in names
        assert "beta"  in names
        assert names == sorted(names), "list_tools should be sorted"

    def test_list_actions(self):
        self.registry.register(_StubTool("t1", ["a", "b"]))
        actions = self.registry.list_actions()
        assert "t1"     in actions
        assert actions["t1"] == ["a", "b"]

    def test_tool_count(self):
        assert self.registry.tool_count() == 0
        self.registry.register(_StubTool("x"))
        assert self.registry.tool_count() == 1


class TestDefaultRegistry:
    def setup_method(self):
        reset_registry()

    def teardown_method(self):
        reset_registry()

    def test_get_registry_returns_singleton(self):
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2

    def test_default_tools_registered(self):
        reg   = get_registry()
        names = reg.list_tools()
        expected = ["browser", "email", "image", "ocr", "pdf", "search"]
        for name in expected:
            assert name in names, f"Expected tool {name!r} in registry"

    def test_all_six_tools(self):
        reg = get_registry()
        assert reg.tool_count() == 6

    def test_reset_clears_singleton(self):
        r1 = get_registry()
        reset_registry()
        r2 = get_registry()
        assert r1 is not r2

    def test_can_handle_valid_action(self):
        reg  = get_registry()
        tool = reg.resolve("search")
        assert tool.can_handle("query")       is True
        assert tool.can_handle("nonexistent") is False
