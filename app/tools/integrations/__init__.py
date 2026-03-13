"""
app/tools/integrations/__init__.py
────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

Public surface of the tool-side integration package.

Exports
-------
ModuleBridge          – feeds ToolResult/DevToolResult into module executor
WorkflowOrchestrator  – chains tool + module steps for named workflow types
WorkflowResult        – structured result of a chained workflow
"""
from app.tools.integrations.module_bridge import (
    ModuleBridge,
    WorkflowOrchestrator,
    WorkflowResult,
)

__all__ = [
    "ModuleBridge",
    "WorkflowOrchestrator",
    "WorkflowResult",
]
