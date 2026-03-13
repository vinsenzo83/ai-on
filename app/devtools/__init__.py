"""
app/devtools/__init__.py
─────────────────────────
Phase 16 — Developer Assist Tooling Layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  Additions to __all__ are safe.                                 │
│  Renames / deletions require explicit approval.                 │
└─────────────────────────────────────────────────────────────────┘

Public surface for the Phase 16 developer-assist layer.

External callers should import from this module only:

    from app.devtools import get_registry, DevToolExecutor, DevToolInput, DevToolResult
"""
from app.devtools.registry    import DevToolRegistry, get_registry
from app.devtools.executor    import DevToolExecutor
from app.devtools.types       import (
    DevToolInput,
    DevToolResult,
    DevToolValidationResult,
    DevToolErrorCode,
    DevToolMode,
    DevToolOpType,
)

__all__ = [
    # Registry
    "DevToolRegistry",
    "get_registry",
    # Executor
    "DevToolExecutor",
    # Types
    "DevToolInput",
    "DevToolResult",
    "DevToolValidationResult",
    "DevToolErrorCode",
    "DevToolMode",
    "DevToolOpType",
]

# Build the default registry once at import time.
get_registry()
