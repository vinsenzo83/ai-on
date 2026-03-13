# Phase 16 — Developer Assist Tooling Layer: Status Report

**Status:** ✅ COMPLETE  
**Date:** 2026-03-12  
**Phase:** 16 (Developer Assist Tooling)  
**Prior phases frozen:** Engine (Phase 13.1), Module Layer (Phase 14), General Tools (Phase 15)

---

## Architecture Summary

```
Caller
  │
  ▼
DevToolInput (tool_name, action, params, mode, context, metadata, request_id)
  │
  ▼
DevToolExecutor.execute()
  │  1. Resolve tool from DevToolRegistry
  │  2. Check action supported (can_handle)
  │  3. Mode gate (require_mode)
  │  4. validate_input() → DevToolValidationResult
  │  5. on_pre_execute() hook
  │  6. execute_action() → raw_output
  │  7. validate_output() → DevToolValidationResult
  │  8. normalize_output() → normalized_output
  │  9. on_post_execute() hook
  │ 10. Return DevToolResult
  ▼
DevToolResult (request_id, tool_name, action, success, raw_output,
               normalized_output, validation_passed, error_code,
               error_message, latency_ms, metadata, retryable, source_reference)
```

### Layer Boundaries (STRICT — never cross)

| Layer | Responsibility | Must NOT do |
|-------|---------------|-------------|
| **Engine** | Provider routing, fallback, retry, cache, circuit-breaker | N/A (frozen) |
| **Module** | Task contracts, prompt shaping, LLM output validation | No direct tool calls |
| **General Tools** (Phase 15) | External I/O: search, PDF, OCR, email, image, browser | No LLM, no routing |
| **Dev Tools** (Phase 16) | Repo/file/code/shell/CI/CD/deploy ops | No LLM calls, no DB/Celery |

---

## Hard-Frozen Core Files

> Do NOT modify without explicit approval. All tools depend on these contracts.

| File | Purpose |
|------|---------|
| `app/devtools/types.py` | `DevToolInput`, `DevToolResult`, `DevToolValidationResult`, `DevToolErrorCode`, `DevToolMode`, `DevToolOpType` |
| `app/devtools/base.py` | `BaseDevTool` abstract class |
| `app/devtools/registry.py` | `DevToolRegistry` singleton |
| `app/devtools/executor.py` | `DevToolExecutor` orchestrator |

## Soft-Frozen Files

> Additions are safe; renames/deletions require approval.

| File | Purpose |
|------|---------|
| `app/devtools/normalizers.py` | Shared validator + normalizer helpers |
| `app/devtools/errors.py` | `DevToolError` subclass hierarchy |
| `app/devtools/__init__.py` | Public surface |
| `app/devtools/integrations/module_hooks.py` | Module-layer integration hooks |

---

## Tool Inventory (18 tools, 68+ actions)

### Stage A — Core Developer Tools (7 tools)

| Tool | Name | Actions | Mode Required |
|------|------|---------|---------------|
| RepoSearchTool | `repo_search` | search_files, search_content, search_symbols | READ_ONLY |
| FilesystemTool | `filesystem` | read_file, write_file, list_dir, delete_file, move_file | READ_ONLY / SAFE_WRITE |
| CodePatchTool | `code_patch` | apply_patch, view_diff, create_file, insert_lines, replace_lines | READ_ONLY / SAFE_WRITE |
| TerminalTool | `terminal` | run_command, run_script, kill_process | FULL |
| TestRunnerTool | `test_runner` | run_tests, run_file, list_tests | FULL |
| GitTool | `git` | status, diff, log, add, commit, push, checkout, branch | READ_ONLY / SAFE_WRITE / FULL |
| PlaywrightBrowserTool | `playwright_browser` | navigate, screenshot, click, fill, extract_text, get_html | FULL |

### Stage B — Professional Development Tools (6 tools)

| Tool | Name | Actions | Mode Required |
|------|------|---------|---------------|
| LintFormatTool | `lint_format` | lint, format, check, fix | READ_ONLY / SAFE_WRITE |
| DependencyTool | `dependency` | list_installed, check_outdated, install, uninstall, audit | READ_ONLY / FULL |
| LogReaderTool | `log_reader` | read_log, tail_log, search_log, parse_log | READ_ONLY |
| BuildTool | `build_tool` | build, clean, info, install | FULL |
| EnvConfigTool | `env_config` | read_env, list_configs, read_config, validate_env | READ_ONLY |
| MigrationTool | `migration` | status, list, apply, rollback, create | READ_ONLY / SAFE_WRITE / FULL |

### Stage C — Advanced Developer Mode (5 tools)

| Tool | Name | Actions | Mode Required |
|------|------|---------|---------------|
| PreviewTool | `preview` | start, stop, status, get_url, open | READ_ONLY / FULL |
| WorkflowTool | `workflow` | run_workflow, list_workflows, validate_workflow, run_steps | READ_ONLY / SAFE_WRITE |
| DeployHelperTool | `deploy_helper` | validate, preflight, package, deploy, status | READ_ONLY / SAFE_WRITE / FULL |
| DocExportTool | `doc_export` | generate_readme, export_markdown, generate_report, export_pdf | SAFE_WRITE |
| SandboxRunTool | `sandbox_run` | run_python, run_snippet, validate, profile | READ_ONLY / FULL |

---

## Test Suite

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `tests/devtools/test_devtools_infra.py` | 52 | types, registry, executor, normalizers |
| `tests/devtools/test_devtools_filesystem.py` | 24 | FilesystemTool all paths |
| `tests/devtools/test_devtools_code_patch.py` | 22 | CodePatchTool all paths |
| `tests/devtools/test_devtools_terminal.py` | 19 | TerminalTool + security |
| `tests/devtools/test_devtools_git.py` | 21 | GitTool (real git repo) |
| `tests/devtools/test_devtools_playwright.py` | 22 | PlaywrightBrowserTool (mocked) |
| `tests/devtools/test_devtools_test_runner.py` | 14 | TestRunnerTool (real pytest) |
| `tests/devtools/test_devtools_stage_b.py` | 56 | All Stage B tools |
| `tests/devtools/test_devtools_stage_c.py` | 54 | All Stage C tools |
| **Total Phase 16** | **276** | **0 regressions** |
| **Total project** | **1206** | **0 failures** |

---

## Security Model

### DevToolMode Hierarchy

```
READ_ONLY  (0)  →  reads only, no filesystem writes, no shell
SAFE_WRITE (1)  →  filesystem writes allowed, no shell execution
FULL       (2)  →  all operations (shell, tests, build, deploy, browser)
```

### Path Safety
- All filesystem/patch/log tools run `realpath()` and verify the resolved path
  starts with `workspace_root + os.sep` before any I/O.
- `PathUnsafeError` raised on traversal attempt → `DEVTOOL_PATH_UNSAFE` error code.

### Shell Security
- TerminalTool carries a `_DEFAULT_BLOCKED` list of dangerous command prefixes.
- Callers can inject additional blocked prefixes via `context["blocked_prefixes"]`.
- BuildTool is FULL-mode only.

### Secrets Redaction
- `EnvConfigTool.read_env` redacts values for keys matching
  `PASSWORD|SECRET|TOKEN|KEY|API_KEY|AUTH|CRED|PRIVATE|PASSWD`.

### Deploy Safety Gate
- `DeployHelperTool.deploy` requires `confirm=True` + `FULL` mode.
- Production preflight check explicitly fails to force manual review.

### Sandbox Isolation
- `SandboxRunTool` runs code in a temp directory, enforces timeout,
  and statically blocks `os, sys, subprocess, socket, ctypes, ...` imports.
- **Note:** True kernel-level sandboxing requires Docker/nsjail wrapping.

---

## Extension Points

All extension happens by **adding**, never modifying frozen files.

### Add a New Tool
```python
# 1. Create app/devtools/tools/my_tool.py inheriting BaseDevTool
# 2. Add to _try_register() in registry.py (open for additions)
# 3. Add tests in tests/devtools/test_devtools_my_tool.py
```

### Inject Custom Executor
```python
# WorkflowTool and SandboxRunTool accept executor injection:
tool = WorkflowTool(executor=my_custom_executor)
```

### Extend Mode Hierarchy
- Add new constants to `DevToolMode` (soft-frozen).
- Update `_MODE_RANK` in `normalizers.py`.

### Add Lifecycle Hooks
- Override `on_pre_execute(tool_input)` and `on_post_execute(raw, success=bool)`
  in any BaseDevTool subclass — no base class changes needed.

### Workflow Definitions
- Drop YAML files in `<workspace_root>/.devtools/workflows/`.
- WorkflowTool auto-discovers them via `list_workflows`.

---

## Known Risks / Open Questions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | SandboxRunTool — subprocess-only isolation | HIGH | Wrap in Docker for production use |
| 2 | TerminalTool block-list is not exhaustive | MEDIUM | Add project-specific prefixes via context |
| 3 | PlaywrightBrowserTool — stateless (no session reuse) | MEDIUM | WorkflowTool can share context in Stage C |
| 4 | MigrationTool — Alembic/Django commands must be on PATH | LOW | DependencyTool checks; fail fast on DEPENDENCY_ERROR |
| 5 | DeployHelperTool._deploy — no rollback on failure | MEDIUM | Add rollback workflow step in WorkflowTool |
| 6 | WorkflowTool YAML parsing — requires PyYAML | LOW | Falls back to JSON workflows |

---

## Future Admin Recommendations

1. **Rate-limit FULL-mode tools** in the admin layer — prevent abuse via API.
2. **Audit log** — persist all DevToolResult.as_dict() records to a write-once store.
3. **Per-user mode caps** — admins can set maximum mode per user/role.
4. **Docker wrapping** for SandboxRunTool in production deployments.
5. **Playwright browser pool** — reuse browser instances across calls for performance.
6. **Workflow editor UI** — admin panel to create/edit YAML workflows visually.
7. **Tool health checks** — `DevToolRegistry.health_check()` endpoint for monitoring.
