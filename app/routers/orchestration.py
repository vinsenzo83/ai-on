"""
app/routers/orchestration.py
──────────────────────────────
Phase 17 — Workflow Orchestration HTTP API layer.

Routes
──────
GET  /orchestration/                         health + supported workflow list
GET  /orchestration/workflows                full workflow catalogue with schemas
POST /orchestration/workflows/{workflow}     execute a named workflow
POST /orchestration/pipeline                 execute an ad-hoc multi-step pipeline
GET  /orchestration/modules                  module registry snapshot (task types)

Auth
────
All routes require a valid Bearer JWT (VIEWER minimum).
Pipeline and multi-step workflows require OPERATOR minimum.

Design rules
────────────
• Router is a pure HTTP adapter — all logic lives in WorkflowOrchestrator.
• Tool execution results are mocked at the router boundary (ToolResult shim)
  so callers submit raw data; the router builds synthetic ToolResult objects
  that the WorkflowOrchestrator can consume.
• WorkflowResult is always returned as a plain dict — success=False on error.
• No direct DB calls in this router.
• Frozen files (modules/types.py, tools/types.py, etc.) are never imported
  or modified here — only public integration surfaces are used.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.modules.registry import get_registry as get_module_registry
from app.services.auth_service import CurrentUser, get_current_user, require_role
from app.tools.integrations.module_bridge import WorkflowOrchestrator, WorkflowResult

logger = structlog.get_logger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Supported workflow catalogue
# ─────────────────────────────────────────────────────────────────────────────

_WORKFLOW_CATALOGUE: dict[str, dict[str, Any]] = {
    "website_analysis": {
        "description": "Browser page fetch → AnalysisModule (general content analysis).",
        "input_fields": {
            "url":           "string — page URL to analyse",
            "text":          "string — pre-fetched page text (alternative to url)",
            "analysis_type": "string — 'general' | 'sentiment' | 'summary' (default: general)",
        },
        "required":     ["url or text"],
        "module_task":  "analysis",
        "min_role":     "VIEWER",
    },
    "document_pdf": {
        "description": "PDF text extraction → SummarizeModule.",
        "input_fields": {
            "text":  "string — extracted PDF text",
            "style": "string — summarisation style (default: standard)",
        },
        "required":    ["text"],
        "module_task": "summarize",
        "min_role":    "VIEWER",
    },
    "search_summary": {
        "description": "Search result text → SummarizeModule.",
        "input_fields": {
            "query":     "string — original search query",
            "text":      "string — search results content",
            "max_words": "integer — maximum output word count (default: 150)",
        },
        "required":    ["text"],
        "module_task": "summarize",
        "min_role":    "VIEWER",
    },
    "devtool_code": {
        "description": "DevTool output (filesystem / git / test_runner / …) → CodeModule.",
        "input_fields": {
            "text":     "string — devtool output text",
            "language": "string — programming language hint (default: python)",
        },
        "required":    ["text"],
        "module_task": "code",
        "min_role":    "VIEWER",
    },
    "devtool_document": {
        "description": "DevTool output → DocumentModule (README / spec generation).",
        "input_fields": {
            "text":     "string — devtool output text",
            "doc_type": "string — 'general' | 'readme' | 'spec' (default: general)",
        },
        "required":    ["text"],
        "module_task": "document",
        "min_role":    "VIEWER",
    },
    "browser_extract": {
        "description": "Browser page text → ExtractModule (NER / key-value extraction).",
        "input_fields": {
            "url":    "string — source URL",
            "text":   "string — page text",
            "fields": "list[string] — field names to extract (optional)",
        },
        "required":    ["text"],
        "module_task": "extract",
        "min_role":    "VIEWER",
    },
    "generic": {
        "description": "Any text content → any registered module task type.",
        "input_fields": {
            "text":          "string — input text",
            "task_type":     "string — any registered module task type",
            "workflow_name": "string — custom name for this workflow run",
            "extra_params":  "dict — additional parameters",
        },
        "required":    ["text", "task_type"],
        "module_task": "(dynamic — set by task_type)",
        "min_role":    "VIEWER",
    },
    "pipeline": {
        "description": "Execute multiple workflow steps sequentially in one request.",
        "input_fields": {
            "steps": "list[dict] — each step has: step_name, text, task_type, extra_params",
        },
        "required":    ["steps"],
        "module_task": "(per step)",
        "min_role":    "OPERATOR",
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class WebsiteAnalysisRequest(BaseModel):
    """POST /orchestration/workflows/website_analysis"""
    url:           str | None = Field(None, description="Source URL (informational).")
    text:          str        = Field(...,  description="Page text to analyse.")
    analysis_type: str        = Field("general", description="Analysis type hint.")
    request_id:    str | None = None
    metadata:      dict[str, Any] = Field(default_factory=dict)


class DocumentPdfRequest(BaseModel):
    """POST /orchestration/workflows/document_pdf"""
    text:       str       = Field(...,   description="Extracted PDF text.")
    style:      str       = Field("standard", description="Summarisation style.")
    request_id: str | None = None
    metadata:   dict[str, Any] = Field(default_factory=dict)


class SearchSummaryRequest(BaseModel):
    """POST /orchestration/workflows/search_summary"""
    query:      str       = Field("",  description="Original search query.")
    text:       str       = Field(..., description="Search result text.")
    max_words:  int       = Field(150, ge=10, le=1000)
    request_id: str | None = None
    metadata:   dict[str, Any] = Field(default_factory=dict)


class DevtoolCodeRequest(BaseModel):
    """POST /orchestration/workflows/devtool_code"""
    text:       str       = Field(..., description="DevTool output text.")
    language:   str       = Field("python", description="Programming language hint.")
    tool_name:  str       = Field("devtool", description="Source devtool name.")
    request_id: str | None = None
    metadata:   dict[str, Any] = Field(default_factory=dict)


class DevtoolDocumentRequest(BaseModel):
    """POST /orchestration/workflows/devtool_document"""
    text:       str       = Field(..., description="DevTool output text.")
    doc_type:   str       = Field("general", description="Documentation type.")
    tool_name:  str       = Field("devtool", description="Source devtool name.")
    request_id: str | None = None
    metadata:   dict[str, Any] = Field(default_factory=dict)


class BrowserExtractRequest(BaseModel):
    """POST /orchestration/workflows/browser_extract"""
    url:        str | None = Field(None, description="Source URL.")
    text:       str        = Field(...,  description="Page text to extract from.")
    fields:     list[str]  = Field(default_factory=list, description="Fields to extract.")
    request_id: str | None = None
    metadata:   dict[str, Any] = Field(default_factory=dict)


class GenericWorkflowRequest(BaseModel):
    """POST /orchestration/workflows/generic"""
    text:          str            = Field(..., description="Input text.")
    task_type:     str            = Field(..., description="Registered module task type.")
    workflow_name: str            = Field("generic", description="Workflow label.")
    extra_params:  dict[str, Any] = Field(default_factory=dict)
    request_id:    str | None     = None
    metadata:      dict[str, Any] = Field(default_factory=dict)


class PipelineStep(BaseModel):
    """Single step in a pipeline request."""
    step_name:    str             = Field(..., description="Step label.")
    text:         str             = Field(..., description="Input text for this step.")
    task_type:    str             = Field(..., description="Module task type for this step.")
    extra_params: dict[str, Any]  = Field(default_factory=dict)


class PipelineRequest(BaseModel):
    """POST /orchestration/pipeline"""
    steps:         list[PipelineStep] = Field(..., min_length=1, max_length=10)
    workflow_name: str                = Field("pipeline", description="Pipeline label.")
    request_id:    str | None         = None
    metadata:      dict[str, Any]     = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic ToolResult shim
# ─────────────────────────────────────────────────────────────────────────────

class _SyntheticToolResult:
    """
    Lightweight shim that mimics a ToolResult / DevToolResult so that the
    WorkflowOrchestrator adapters can process plain-text input submitted
    via the HTTP API.

    Attributes map exactly to the fields the ToolResultAdapter reads via
    getattr (duck-typing), so no frozen types are imported here.
    """

    def __init__(
        self,
        *,
        tool_name:         str,
        action:            str,
        success:           bool            = True,
        normalized_output: Any             = None,
        raw_output:        Any             = None,
        source_url:        str | None      = None,
        request_id:        str | None      = None,
        metadata:          dict[str, Any] | None = None,
        latency_ms:        int             = 0,
    ) -> None:
        self.tool_name         = tool_name
        self.action            = action
        self.success           = success
        self.normalized_output = normalized_output
        self.raw_output        = raw_output or normalized_output
        self.source_url        = source_url
        self.request_id        = request_id or str(uuid.uuid4())
        self.metadata          = metadata or {}
        self.latency_ms        = latency_ms
        # DevToolResult compat
        self.validation_passed = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "tool_name":         self.tool_name,
            "action":            self.action,
            "success":           self.success,
            "normalized_output": self.normalized_output,
            "source_url":        self.source_url,
            "request_id":        self.request_id,
            "latency_ms":        self.latency_ms,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Dependency helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_orchestrator() -> WorkflowOrchestrator:
    """FastAPI dependency: returns a WorkflowOrchestrator (default executor)."""
    return WorkflowOrchestrator()


def _auto_id() -> str:
    return str(uuid.uuid4())


def _wf_dict(result: WorkflowResult) -> dict[str, Any]:
    return result.as_dict()


# ─────────────────────────────────────────────────────────────────────────────
# GET /orchestration/  — health
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/",
    summary="Orchestration layer health — supported workflows and module registry",
    tags=["orchestration"],
    dependencies=[Depends(get_current_user)],
)
async def orchestration_health() -> dict[str, Any]:
    """
    Returns:
    - Supported workflow names
    - Module registry summary (task types)
    - Layer version
    """
    registry     = get_module_registry()
    task_types   = sorted(registry.known_task_types())
    wf_names     = list(_WORKFLOW_CATALOGUE.keys())

    return {
        "layer":            "Phase 17 — Workflow Orchestration",
        "workflow_count":   len(wf_names),
        "workflows":        wf_names,
        "module_task_types": task_types,
        "module_count":     len(registry.all_modules()),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /orchestration/workflows  — catalogue
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/workflows",
    summary="List all supported workflows with input schemas",
    tags=["orchestration"],
    dependencies=[Depends(get_current_user)],
)
async def list_workflows() -> dict[str, Any]:
    """
    Returns the full workflow catalogue including input field descriptions,
    required fields, module task mappings, and minimum role requirements.
    """
    return {
        "workflow_count": len(_WORKFLOW_CATALOGUE),
        "workflows":      _WORKFLOW_CATALOGUE,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /orchestration/modules  — module registry snapshot
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/modules",
    summary="Module registry snapshot — task types and module names",
    tags=["orchestration"],
    dependencies=[Depends(get_current_user)],
)
async def list_modules() -> dict[str, Any]:
    """
    Returns the module registry: all registered task types grouped by module.
    Useful for discovering valid task_type values for the generic workflow.
    """
    registry = get_module_registry()
    modules_info: dict[str, list[str]] = {}

    for task_type in registry.known_task_types():
        mod = registry.resolve_or_none(task_type)
        if mod is not None:
            name = mod.name
            if name not in modules_info:
                modules_info[name] = []
            modules_info[name].append(task_type)

    return {
        "module_count":  len(modules_info),
        "task_type_count": len(registry.known_task_types()),
        "modules":       modules_info,
        "all_task_types": sorted(registry.known_task_types()),
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /orchestration/workflows/{workflow}  — named workflow dispatch
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/workflows/website_analysis",
    summary="Website Analysis: page text → AnalysisModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_website_analysis(
    body:         WebsiteAnalysisRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the website_analysis workflow.

    Submit extracted page text (and optionally the source URL).
    The orchestrator passes the text through the AnalysisModule.
    """
    shim = _SyntheticToolResult(
        tool_name         = "browser",
        action            = "extract_text",
        success           = True,
        normalized_output = {"text": body.text, "url": body.url},
        source_url        = body.url,
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.website_analysis",
        url=body.url,
        analysis_type=body.analysis_type,
        request_id=body.request_id,
    )

    result = await orchestrator.website_analysis(
        shim,
        analysis_type=body.analysis_type,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/document_pdf",
    summary="Document PDF: extracted text → SummarizeModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_document_pdf(
    body:         DocumentPdfRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the document_pdf workflow.

    Submit pre-extracted PDF text. The orchestrator passes it through
    the SummarizeModule.
    """
    shim = _SyntheticToolResult(
        tool_name         = "pdf",
        action            = "extract_text",
        success           = True,
        normalized_output = {"text": body.text},
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.document_pdf",
        style=body.style,
        request_id=body.request_id,
    )

    result = await orchestrator.document_pdf(
        shim,
        style=body.style,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/search_summary",
    summary="Search Summary: search results text → SummarizeModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_search_summary(
    body:         SearchSummaryRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the search_summary workflow.

    Submit search result text (and optionally the query). The orchestrator
    passes it through the SummarizeModule with max_words constraint.
    """
    shim = _SyntheticToolResult(
        tool_name         = "search",
        action            = "query",
        success           = True,
        normalized_output = {"results": [{"snippet": body.text}], "query": body.query},
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.search_summary",
        max_words=body.max_words,
        request_id=body.request_id,
    )

    result = await orchestrator.search_summary(
        shim,
        max_words=body.max_words,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/devtool_code",
    summary="DevTool Code: devtool output → CodeModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_devtool_code(
    body:         DevtoolCodeRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the devtool_code workflow.

    Submit developer tool output text. The orchestrator passes it through
    the CodeModule for analysis / review / generation.
    """
    shim = _SyntheticToolResult(
        tool_name         = body.tool_name,
        action            = "read_file",
        success           = True,
        normalized_output = {"output": body.text, "language": body.language},
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.devtool_code",
        tool_name=body.tool_name,
        language=body.language,
        request_id=body.request_id,
    )

    result = await orchestrator.devtool_code(
        shim,
        language=body.language,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/devtool_document",
    summary="DevTool Document: devtool output → DocumentModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_devtool_document(
    body:         DevtoolDocumentRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the devtool_document workflow.

    Submit developer tool output text. The orchestrator generates
    documentation (README / spec) via the DocumentModule.
    """
    shim = _SyntheticToolResult(
        tool_name         = body.tool_name,
        action            = "list_dir",
        success           = True,
        normalized_output = {"output": body.text},
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.devtool_document",
        tool_name=body.tool_name,
        doc_type=body.doc_type,
        request_id=body.request_id,
    )

    result = await orchestrator.devtool_document(
        shim,
        doc_type=body.doc_type,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/browser_extract",
    summary="Browser Extract: page text → ExtractModule",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_browser_extract(
    body:         BrowserExtractRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the browser_extract workflow.

    Submit page text (and optionally field names). The orchestrator
    passes it through the ExtractModule for NER / key-value extraction.
    """
    shim = _SyntheticToolResult(
        tool_name         = "browser",
        action            = "extract_text",
        success           = True,
        normalized_output = {"text": body.text},
        source_url        = body.url,
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.browser_extract",
        url=body.url,
        fields=body.fields,
        request_id=body.request_id,
    )

    result = await orchestrator.browser_extract(
        shim,
        fields=body.fields or None,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


@router.post(
    "/workflows/generic",
    summary="Generic: any text → any registered module task type",
    tags=["orchestration"],
    dependencies=[Depends(require_role("VIEWER"))],
)
async def run_generic_workflow(
    body:         GenericWorkflowRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Run the generic workflow.

    Accepts any text and any registered module task_type.
    Use GET /orchestration/modules to discover valid task types.
    """
    # Validate task_type exists
    registry = get_module_registry()
    if not registry.has_task_type(body.task_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown task_type '{body.task_type}'. "
                f"Valid types: {sorted(registry.known_task_types())}"
            ),
        )

    shim = _SyntheticToolResult(
        tool_name         = "generic",
        action            = "process",
        success           = True,
        normalized_output = {"text": body.text, **body.extra_params},
        request_id        = body.request_id,
        metadata          = body.metadata,
    )

    logger.info(
        "orchestration.generic",
        task_type=body.task_type,
        workflow_name=body.workflow_name,
        request_id=body.request_id,
    )

    result = await orchestrator.generic(
        shim,
        task_type=body.task_type,
        workflow_name=body.workflow_name,
        extra_params=body.extra_params or None,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)


# ─────────────────────────────────────────────────────────────────────────────
# POST /orchestration/pipeline  — ad-hoc multi-step pipeline
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/pipeline",
    summary="Pipeline: execute multiple workflow steps sequentially (max 10)",
    tags=["orchestration"],
    dependencies=[Depends(require_role("OPERATOR"))],
)
async def run_pipeline(
    body:         PipelineRequest,
    orchestrator: WorkflowOrchestrator = Depends(_make_orchestrator),
) -> dict[str, Any]:
    """
    Execute up to 10 workflow steps in a single request.

    Each step provides its own text input and module task_type.
    Steps are executed sequentially; individual failures do not abort
    the pipeline — each step carries its own success flag.

    Requires OPERATOR role.
    """
    # Validate all task_types up-front
    registry = get_module_registry()
    invalid: list[str] = [
        s.task_type
        for s in body.steps
        if not registry.has_task_type(s.task_type)
    ]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown task_type(s): {invalid}. "
                f"Valid types: {sorted(registry.known_task_types())}"
            ),
        )

    # Build synthetic tool_result for each step
    pipeline_steps: list[dict[str, Any]] = []
    for step in body.steps:
        shim = _SyntheticToolResult(
            tool_name         = "pipeline",
            action            = step.task_type,
            success           = True,
            normalized_output = {"text": step.text, **step.extra_params},
        )
        pipeline_steps.append({
            "step_name":    step.step_name,
            "tool_result":  shim,
            "task_type":    step.task_type,
            "extra_params": step.extra_params or None,
        })

    logger.info(
        "orchestration.pipeline",
        step_count=len(pipeline_steps),
        workflow_name=body.workflow_name,
        request_id=body.request_id,
    )

    result = await orchestrator.pipeline(
        pipeline_steps,
        workflow_name=body.workflow_name,
        request_id=body.request_id or _auto_id(),
    )
    return _wf_dict(result)
