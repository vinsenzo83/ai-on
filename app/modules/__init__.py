"""
app/modules
───────────
Phase 14 – Module execution layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  The public surface (__all__) should remain stable.             │
│  New exports may be added; existing exports must not be renamed  │
│  or removed without updating all callers.                       │
│  See MODULE_SYSTEM_STATUS_REPORT.md §7 for freeze rules.        │
└─────────────────────────────────────────────────────────────────┘

The module layer sits on top of the frozen engine core.
It provides reusable, task-typed execution contracts that structure
provider input, validate provider output, and normalize results into
a standard execution envelope.

Public surface
--------------
from app.modules import get_registry, ModuleExecutor, ExecutionResult

Registry is built once at import time and is immutable at runtime.
"""
from __future__ import annotations

from app.modules.registry import ModuleRegistry, get_registry
from app.modules.executor import ModuleExecutor
from app.modules.types import ExecutionResult, ModuleInput

__all__ = [
    "get_registry",
    "ModuleRegistry",
    "ModuleExecutor",
    "ExecutionResult",
    "ModuleInput",
]
