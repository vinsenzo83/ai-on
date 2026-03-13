"""
app/modules/registry.py
────────────────────────
Phase 14 – Module registry.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: HARD-FROZEN                                     │
│  Do NOT modify this file without explicit approval.             │
│  The singleton guarantees deterministic routing.  Changing      │
│  resolve() semantics or the lru_cache scope breaks all callers. │
│  To add a new module: add it to _build_default_registry() only. │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

Singleton that maps task_type strings → BaseModule instances.

Usage
-----
registry = get_registry()
module   = registry.resolve("classify")   # → ClassifyModule instance
all_mods = registry.all_modules()

The registry is populated once at startup via _build_default_registry().
It is intentionally immutable at runtime (no dynamic registration after
boot) to keep routing deterministic.

Adding a new module
-------------------
1. Implement a class in app/modules/modules/<name>.py
2. Import it in _build_default_registry() below
3. Add an instance to the returned list
"""
from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

import structlog

from app.modules.types import ModuleErrorCode

if TYPE_CHECKING:
    from app.modules.base import BaseModule

logger = structlog.get_logger(__name__)


class ModuleRegistry:
    """
    Immutable registry of module instances keyed by task_type.

    Parameters
    ----------
    modules : list[BaseModule]
        All module instances to register.  If two modules claim the same
        task_type the later one wins and a warning is emitted.
    """

    def __init__(self, modules: "list[BaseModule]") -> None:
        self._by_task: dict[str, "BaseModule"] = {}
        self._by_name: dict[str, "BaseModule"] = {}

        for mod in modules:
            # Register by name
            if mod.name in self._by_name:
                logger.warning(
                    "module_registry.duplicate_name",
                    name=mod.name,
                )
            self._by_name[mod.name] = mod

            # Register by every task_type
            for task_type in mod.get_task_types():
                key = task_type.lower()
                if key in self._by_task:
                    logger.warning(
                        "module_registry.duplicate_task_type",
                        task_type=task_type,
                        existing=self._by_task[key].name,
                        replacing=mod.name,
                    )
                self._by_task[key] = mod

        logger.info(
            "module_registry.built",
            module_count=len(self._by_name),
            task_type_count=len(self._by_task),
        )

    # ── Lookup ────────────────────────────────────────────────────────────────

    def resolve(self, task_type: str) -> "BaseModule":
        """
        Return the module that handles *task_type*.

        Raises
        ------
        KeyError
            When no module is registered for the given task_type.
        """
        key = task_type.lower()
        module = self._by_task.get(key)
        if module is None:
            raise KeyError(
                f"No module registered for task_type={task_type!r}. "
                f"Known types: {sorted(self._by_task)}"
            )
        return module

    def resolve_or_none(self, task_type: str) -> "BaseModule | None":
        """Return the module or None (never raises)."""
        return self._by_task.get(task_type.lower())

    def resolve_by_name(self, name: str) -> "BaseModule":
        """Return a module by its unique name (not task_type)."""
        module = self._by_name.get(name)
        if module is None:
            raise KeyError(
                f"No module named {name!r}. Known names: {sorted(self._by_name)}"
            )
        return module

    # ── Introspection ─────────────────────────────────────────────────────────

    def all_modules(self) -> "list[BaseModule]":
        """Return all registered module instances (deduplicated)."""
        return list(self._by_name.values())

    def known_task_types(self) -> list[str]:
        """Return every registered task_type string."""
        return sorted(self._by_task.keys())

    def has_task_type(self, task_type: str) -> bool:
        return task_type.lower() in self._by_task

    def __repr__(self) -> str:
        return (
            f"<ModuleRegistry modules={list(self._by_name)} "
            f"task_types={list(self._by_task)}>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Default registry factory
# ─────────────────────────────────────────────────────────────────────────────

def _build_default_registry() -> ModuleRegistry:
    """
    Instantiate all first-class modules and return a populated registry.

    Import order here is the canonical registration order; it does NOT
    affect routing priority (that is determined by each module's preferred
    model list).
    """
    from app.modules.modules.classify  import ClassifyModule
    from app.modules.modules.summarize import SummarizeModule
    from app.modules.modules.translate import TranslateModule
    from app.modules.modules.extract   import ExtractModule
    from app.modules.modules.analysis  import AnalysisModule
    from app.modules.modules.document  import DocumentModule
    from app.modules.modules.code      import CodeModule

    return ModuleRegistry([
        ClassifyModule(),
        SummarizeModule(),
        TranslateModule(),
        ExtractModule(),
        AnalysisModule(),
        DocumentModule(),
        CodeModule(),
    ])


@lru_cache(maxsize=1)
def get_registry() -> ModuleRegistry:
    """
    Return the application-wide singleton registry.

    Uses lru_cache so the registry is built exactly once per process.
    Tests that need a custom registry should construct one directly:

        registry = ModuleRegistry([MyTestModule()])
    """
    return _build_default_registry()
