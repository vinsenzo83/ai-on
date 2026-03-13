"""
app/modules/integrations/__init__.py
──────────────────────────────────────
Phase 17 — Module/Tool Integration Layer.

Public surface of the module-side integration package.

Exports
-------
ToolResultAdapter        – converts ToolResult / DevToolResult → ModuleInput
ModuleOutputComposer     – assembles final structured output from module results
ToolBackedModuleInput    – factory for pre-populated ModuleInputs from tool output
IntegrationError         – raised when adapter contract is violated
"""
from app.modules.integrations.tool_adapters import (
    IntegrationError,
    ModuleOutputComposer,
    ToolBackedModuleInput,
    ToolResultAdapter,
)

__all__ = [
    "IntegrationError",
    "ModuleOutputComposer",
    "ToolBackedModuleInput",
    "ToolResultAdapter",
]
