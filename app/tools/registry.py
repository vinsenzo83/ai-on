"""
app/tools/registry.py
──────────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  ToolRegistry is the single lookup table for all tools.         │
│  Changing resolve() semantics breaks every ToolExecutor caller. │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

Singleton registry that maps tool names to BaseTool instances.

Usage
─────
    from app.tools.registry import get_registry

    registry = get_registry()            # application singleton
    tool     = registry.resolve("pdf")   # raises if not found
    tool2    = registry.resolve_or_none("unknown")  # → None
"""
from __future__ import annotations

import structlog

from app.tools.base import BaseTool

logger = structlog.get_logger(__name__)


class ToolRegistry:
    """
    Maps tool_name → BaseTool instance.

    The registry is intentionally built once at import time and treated
    as immutable at runtime.  New tools are added only through
    ``_build_default_registry()`` in this file — never via runtime
    mutation after startup.
    """

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    # ── Registration ──────────────────────────────────────────────────────────

    def register(self, tool: BaseTool) -> None:
        """
        Register a tool instance under its ``name``.

        Raises
        ------
        ValueError
            If a tool with the same name is already registered.
        """
        if tool.name in self._tools:
            raise ValueError(
                f"Tool {tool.name!r} is already registered. "
                "Use a unique name or deregister the existing tool first."
            )
        self._tools[tool.name] = tool
        logger.debug("tool_registry.registered", tool=tool.name)

    def deregister(self, name: str) -> None:
        """Remove a tool by name (primarily for tests)."""
        self._tools.pop(name, None)

    # ── Lookup ────────────────────────────────────────────────────────────────

    def resolve(self, tool_name: str) -> BaseTool:
        """
        Return the BaseTool for ``tool_name``.

        Raises
        ------
        KeyError
            If no tool is registered under that name.
        """
        tool = self._tools.get(tool_name)
        if tool is None:
            raise KeyError(
                f"No tool registered for name={tool_name!r}. "
                f"Registered tools: {list(self._tools)}"
            )
        return tool

    def resolve_or_none(self, tool_name: str) -> BaseTool | None:
        """Return the BaseTool or None (no exception)."""
        return self._tools.get(tool_name)

    # ── Introspection ─────────────────────────────────────────────────────────

    def list_tools(self) -> list[str]:
        """Return sorted list of registered tool names."""
        return sorted(self._tools)

    def list_actions(self) -> dict[str, list[str]]:
        """Return mapping of tool_name → supported actions."""
        return {name: tool.get_actions() for name, tool in self._tools.items()}

    def tool_count(self) -> int:
        return len(self._tools)


# ─────────────────────────────────────────────────────────────────────────────
# Default registry singleton
# ─────────────────────────────────────────────────────────────────────────────

def _build_default_registry() -> ToolRegistry:
    """
    Build and return the application-wide default ToolRegistry.

    Concrete tools are imported lazily here to avoid circular imports.
    To add a new tool: import it and call registry.register(MyTool()).
    Core registry/executor files are NOT modified.
    """
    from app.tools.tools.search  import SearchTool   # noqa: PLC0415
    from app.tools.tools.pdf     import PdfTool       # noqa: PLC0415
    from app.tools.tools.ocr     import OcrTool       # noqa: PLC0415
    from app.tools.tools.email   import EmailTool     # noqa: PLC0415
    from app.tools.tools.image   import ImageTool     # noqa: PLC0415
    from app.tools.tools.browser import BrowserTool   # noqa: PLC0415

    registry = ToolRegistry()
    registry.register(SearchTool())
    registry.register(PdfTool())
    registry.register(OcrTool())
    registry.register(EmailTool())
    registry.register(ImageTool())
    registry.register(BrowserTool())
    return registry


_default_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    """
    Return the application-wide ToolRegistry singleton.

    Initialised lazily on first call.  Thread-safe enough for the
    async, single-process FastAPI / Celery worker pattern used here.
    """
    global _default_registry
    if _default_registry is None:
        _default_registry = _build_default_registry()
    return _default_registry


def reset_registry() -> None:
    """
    Reset the singleton (tests only).

    Allows each test to start with a fresh registry without
    cross-test pollution.
    """
    global _default_registry
    _default_registry = None
