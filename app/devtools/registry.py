"""
app/devtools/registry.py
─────────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify without explicit approval.                       │
│  DevToolRegistry is the sole lookup table for all devtools.     │
│  See DEVTOOLS_STATUS_REPORT.md §freeze for rules.              │
└─────────────────────────────────────────────────────────────────┘

Singleton registry mapping tool names to BaseDevTool instances.
"""
from __future__ import annotations

import structlog

from app.devtools.base import BaseDevTool

logger = structlog.get_logger(__name__)


class DevToolRegistry:
    """Maps tool_name → BaseDevTool instance."""

    def __init__(self) -> None:
        self._tools: dict[str, BaseDevTool] = {}

    # ── Registration ──────────────────────────────────────────────────────────

    def register(self, tool: BaseDevTool) -> None:
        if tool.name in self._tools:
            raise ValueError(
                f"DevTool {tool.name!r} is already registered."
            )
        self._tools[tool.name] = tool
        logger.debug("devtool_registry.registered", tool=tool.name)

    def deregister(self, name: str) -> None:
        """Remove a tool by name (primarily for tests)."""
        self._tools.pop(name, None)

    # ── Lookup ────────────────────────────────────────────────────────────────

    def resolve(self, tool_name: str) -> BaseDevTool:
        tool = self._tools.get(tool_name)
        if tool is None:
            raise KeyError(
                f"No devtool registered for name={tool_name!r}. "
                f"Registered: {list(self._tools)}"
            )
        return tool

    def resolve_or_none(self, tool_name: str) -> BaseDevTool | None:
        return self._tools.get(tool_name)

    # ── Introspection ─────────────────────────────────────────────────────────

    def list_tools(self) -> list[str]:
        return sorted(self._tools)

    def list_actions(self) -> dict[str, list[str]]:
        return {n: t.get_actions() for n, t in self._tools.items()}

    def list_op_types(self) -> dict[str, str]:
        return {n: t.get_op_type() for n, t in self._tools.items()}

    def tool_count(self) -> int:
        return len(self._tools)


# ─────────────────────────────────────────────────────────────────────────────
# Default registry singleton
# ─────────────────────────────────────────────────────────────────────────────

def _build_default_registry() -> DevToolRegistry:
    """
    Build the application-wide default DevToolRegistry.

    All tool imports are lazy and guarded with try/except so that
    partially-delivered stages do not break import of existing tools.
    To add a new tool: import it, call registry.register(MyTool()).
    Core files are NOT modified.
    """
    registry = DevToolRegistry()

    # ── Stage A — Core Developer Tools ───────────────────────────────────────
    _try_register(registry, "app.devtools.tools.repo_search",        "RepoSearchTool")
    _try_register(registry, "app.devtools.tools.filesystem",         "FilesystemTool")
    _try_register(registry, "app.devtools.tools.code_patch",         "CodePatchTool")
    _try_register(registry, "app.devtools.tools.terminal",           "TerminalTool")
    _try_register(registry, "app.devtools.tools.test_runner",        "TestRunnerTool")
    _try_register(registry, "app.devtools.tools.git_tool",           "GitTool")
    _try_register(registry, "app.devtools.tools.playwright_browser", "PlaywrightBrowserTool")

    # ── Stage B — Professional Development Tools ──────────────────────────────
    _try_register(registry, "app.devtools.tools.lint_format",  "LintFormatTool")
    _try_register(registry, "app.devtools.tools.dependency",   "DependencyTool")
    _try_register(registry, "app.devtools.tools.log_reader",   "LogReaderTool")
    _try_register(registry, "app.devtools.tools.build_tool",   "BuildTool")
    _try_register(registry, "app.devtools.tools.env_config",   "EnvConfigTool")
    _try_register(registry, "app.devtools.tools.migration",    "MigrationTool")

    # ── Stage C — Advanced Developer Mode ────────────────────────────────────
    _try_register(registry, "app.devtools.tools.preview",       "PreviewTool")
    _try_register(registry, "app.devtools.tools.workflow",      "WorkflowTool")
    _try_register(registry, "app.devtools.tools.deploy_helper", "DeployHelperTool")
    _try_register(registry, "app.devtools.tools.doc_export",    "DocExportTool")
    _try_register(registry, "app.devtools.tools.sandbox_run",   "SandboxRunTool")

    return registry


def _try_register(registry: "DevToolRegistry", module_path: str, class_name: str) -> None:
    """
    Attempt to import ``class_name`` from ``module_path`` and register it.

    Silently skips if the module does not yet exist (staged delivery).
    Logs a warning for any other import error.
    """
    import importlib
    try:
        mod  = importlib.import_module(module_path)
        cls  = getattr(mod, class_name)
        registry.register(cls())
    except ModuleNotFoundError:
        logger.debug(
            "devtool_registry.module_not_found",
            module=module_path,
            note="skipped – not yet delivered",
        )
    except Exception as exc:
        logger.warning(
            "devtool_registry.register_failed",
            module=module_path,
            cls=class_name,
            exc=str(exc),
        )


_default_registry: DevToolRegistry | None = None


def get_registry() -> DevToolRegistry:
    """Return the application-wide DevToolRegistry singleton (lazy init)."""
    global _default_registry
    if _default_registry is None:
        _default_registry = _build_default_registry()
    return _default_registry


def reset_registry() -> None:
    """Reset singleton — tests only."""
    global _default_registry
    _default_registry = None
