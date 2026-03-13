"""
app/tools/__init__.py
─────────────────────
Phase 15 — Tool integration layer.

┌─────────────────────────────────────────────────────────────────┐
│  FREEZE STATUS: SOFT-FROZEN                                     │
│  Additions to __all__ are safe.                                 │
│  Renames / deletions require explicit approval.                 │
│  See TOOL_SYSTEM_STATUS_REPORT.md §freeze for rules.           │
└─────────────────────────────────────────────────────────────────┘

Public surface for the Phase 15 tool execution layer.

External callers should import from this module only:

    from app.tools import get_registry, ToolExecutor, ToolResult, ToolInput

Direct imports from sub-modules (e.g. app.tools.tools.search) are
internal implementation details and may change.
"""
from app.tools.registry import ToolRegistry, get_registry
from app.tools.executor import ToolExecutor
from app.tools.types    import ToolInput, ToolResult, ToolValidationResult, ToolErrorCode

__all__ = [
    # Registry
    "ToolRegistry",
    "get_registry",
    # Executor
    "ToolExecutor",
    # Types
    "ToolInput",
    "ToolResult",
    "ToolValidationResult",
    "ToolErrorCode",
]

# Build the default registry once at import time.
# This ensures all tools are registered before any request arrives.
get_registry()
