# kbeauty-autocommerce — Dashboard Handoff Package
## One-Pass Final Repository & Dashboard Audit

```
Document         : DASHBOARD_HANDOFF_PACKAGE.md  (definitive, supersedes DASHBOARD_HANDOFF.md)
Version          : 1.0 — Final
Prepared         : 2026-03-12
Commit basis     : c75462f  (branch: genspark_ai_developer)
Production server: 144.172.93.226  (HTTPS, Nginx → Node.js :3000)
GitHub PR        : https://github.com/vinsenzo83/kbeauty-autocommerce/pull/1
GitHub Release   : https://github.com/vinsenzo83/kbeauty-autocommerce/releases/tag/v14-final-2026-03-12
Archive download : https://github.com/vinsenzo83/kbeauty-autocommerce/releases/download/v14-final-2026-03-12/kbeauty-ai-orchestrator-v14-final-2026-03-12.tar.gz
```

---

## OVERVIEW

The kbeauty-autocommerce AI Orchestrator has completed **all backend phases** (13.1 through 15).
Phase 16 — Admin Dashboard — is the sole remaining task.

| Phase | Scope | Status |
|-------|-------|--------|
| 13.1 | Engine core — routing, fallback, cache, circuit-breaker | ✅ HARD-FROZEN |
| 14 | Platform layer — memory / storage / obs / analytics / jobs | ✅ FROZEN |
| 14 (modules) | Module execution layer — 7 Python modules | ✅ FROZEN |
| 15 | Tool integration layer — 6 Python tools | ✅ FROZEN |
| **16** | **Admin / Dashboard** | **🔲 YOUR TASK** |

**No backend changes are required for Phase 16.**  
Every API needed by the dashboard already exists and is live.  
The dashboard developer's only working directory is `dashboard/`.

**Delivery summary (what is already done):**
- Engine: 100 % routing hit rate, 16/16 live routes verified
- Platform: 5 engines live (memory, storage, observability, analytics, jobs)
- Modules: 7 modules (classify, summarize, translate, extract, analysis, document, code)
- Tools: 6 tools (search, pdf, ocr, email, image, browser)
- Archive: `kbeauty-ai-orchestrator-v14-final-2026-03-12.tar.gz` (793 KB, 91 source files)

---

## 1. REPOSITORY STRUCTURE SUMMARY

```
kbeauty-autocommerce/                   ← repo root (463 total files)
│
├── dashboard/                          ← ✅ PHASE 16 WORKING DIRECTORY
│   ├── src/app/
│   │   ├── api/proxy/[...path]/route.ts   ← Next.js API proxy (GET/POST/PUT/DELETE)
│   │   ├── dashboard/                     ← 11 existing pages (extend here)
│   │   │   ├── layout.tsx                 ← Sidebar nav — ADD new entries here
│   │   │   ├── page.tsx                   ← Overview (KPI + 7-day chart)
│   │   │   ├── orders/ + orders/[id]/     ← Order lifecycle
│   │   │   ├── metrics/                   ← Order status bar chart
│   │   │   ├── tickets/                   ← Support tickets
│   │   │   ├── health/                    ← Python backend health
│   │   │   ├── publish/                   ← Shopify publish pipeline
│   │   │   ├── repricing/                 ← Price repricing
│   │   │   ├── discovery/                 ← Product discovery (v2)
│   │   │   ├── ops/                       ← Ops KPI / alert rules
│   │   │   └── trends/                    ← TikTok/Amazon trend signals
│   │   ├── login/page.tsx                 ← JWT login form
│   │   └── globals.css
│   ├── src/lib/api.ts                     ← Central typed API client (~400 lines)
│   ├── src/lib/auth.tsx                   ← JWT auth context (complete)
│   ├── next.config.ts                     ← Rewrites /admin/* → Python:8000
│   ├── tailwind.config.js
│   └── package.json                       ← Next 15 / React 19 / Recharts / Radix UI
│
├── ai-orchestrator/                    ← Node.js engine (READ-ONLY for dashboard)
│   ├── src/server.js                      ← 3854 lines, ~270 API routes
│   ├── src/routes/admin.js                ← 1598 lines, admin + platform routes
│   ├── src/db/database.js                 ← SQLite schema (22 tables)
│   └── src/services/
│       ├── aiConnector.js                 ← HARD-FROZEN engine core (905 lines)
│       ├── modelRegistry.js               ← HARD-FROZEN model whitelist (249 lines)
│       ├── memoryEngine.js                ← Platform: session/workspace/user (513 lines)
│       ├── storageEngine.js               ← Platform: asset persistence (360 lines)
│       ├── observabilityEngine.js         ← Platform: spans/traces (402 lines)
│       ├── analyticsEngine.js             ← Platform: event analytics (464 lines)
│       ├── jobEngine.js                   ← Platform: background jobs (572 lines)
│       ├── costTracker.js                 ← Cost accounting (233 lines)
│       └── cronScheduler.js               ← Cron scheduler (226 lines)
│
├── app/                                ← Python FastAPI backend (READ-ONLY)
│   ├── main.py                            ← FastAPI lifespan, table creation
│   ├── routers/admin.py                   ← 2385 lines, all Python admin routes
│   ├── services/dashboard_service.py      ← KPI/alert computation (Seoul TZ)
│   ├── modules/                           ← 7-module Python layer
│   │   ├── types.py / base.py / registry.py / executor.py / validators.py  ← FROZEN
│   │   └── modules/  classify / summarize / translate / extract / analysis / document / code
│   └── tools/                             ← 6-tool Python layer
│       ├── types.py / base.py / registry.py / executor.py / validators.py  ← FROZEN
│       └── tools/  search / pdf / ocr / email / image / browser
│
├── ai-orchestrator/public/             ← Static HTML (LEGACY — do not extend)
│   ├── admin.html         (2356 lines — Korean SPA)
│   ├── index.html         (1658 lines — user-facing chat)
│   ├── health-dashboard.html (432 lines)
│   └── js/app.js          (3903 lines)
│
├── migrations/                         ← PostgreSQL migrations (0001–0020)
├── infra/                              ← Docker Compose, Nginx, deploy scripts
├── tests/                              ← pytest suites
│
├── FINAL_ENGINE_STATUS_REPORT.md      ← 887 lines  (READ FIRST)
├── MODULE_SYSTEM_STATUS_REPORT.md     ← 614 lines  (READ SECOND)
├── TOOL_SYSTEM_STATUS_REPORT.md       ← 337 lines  (READ THIRD)
├── DASHBOARD_HANDOFF.md               ← 1098 lines (predecessor to this file)
└── DASHBOARD_HANDOFF_PACKAGE.md       ← THIS FILE (definitive)
```

### Two Independent Backend Servers

| Backend | Language | Runtime Port | Auth endpoint | Token key | Dashboard access |
|---------|----------|-------------|--------------|-----------|-----------------|
| Python FastAPI (`app/`) | Python | 8000 | `POST /admin/auth/login` | `admin_token` (localStorage) | `/admin/*` via Next.js rewrite |
| Node.js AI Orchestrator (`ai-orchestrator/`) | Node | 3000 | `POST /api/auth/login` | `orch_token` (localStorage) | Direct HTTPS: `144.172.93.226` |

**The current `dashboard/` talks ONLY to the Python backend.**  
Phase 16 adds pages that call the Node.js AI Orchestrator backend.

---

## 2. FULL FILE INVENTORY WITH EXACT PATHS, PURPOSE, STATUS, AND FREEZE LEVEL

### 2A. Node.js AI Orchestrator Files

| Exact path | Lines | Purpose | Status | Freeze level |
|------------|-------|---------|--------|-------------|
| `ai-orchestrator/src/server.js` | 3854 | Express app entry, ~270 API routes | Active | SOFT-FROZEN |
| `ai-orchestrator/src/routes/admin.js` | 1598 | Admin + platform API routes | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/aiConnector.js` | 905 | Core LLM routing engine (callLLM, CB, cache, fallback) | Active | **HARD-FROZEN** |
| `ai-orchestrator/src/services/modelRegistry.js` | 249 | Model whitelist, XAI_DISABLED, FALLBACK_CHAIN | Active | **HARD-FROZEN** |
| `ai-orchestrator/src/services/memoryEngine.js` | 513 | Session / workspace / user profile memory | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/storageEngine.js` | 360 | Asset persistence (local FS, stubbed S3) | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/observabilityEngine.js` | 402 | Span/trace/event ring buffer + DB flush | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/analyticsEngine.js` | 464 | Event tracking, O(1) counters, snapshots | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/jobEngine.js` | 572 | Priority job queue, 5 workers, Socket.IO events | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/costTracker.js` | 233 | LLM cost accounting | Active | SOFT-FROZEN |
| `ai-orchestrator/src/services/cronScheduler.js` | 226 | Cron-based background scheduler | Active | SOFT-FROZEN |
| `ai-orchestrator/src/db/database.js` | ~950 | SQLite schema (22 tables), migrations | Active | SOFT-FROZEN |
| `ai-orchestrator/src/types/index.js` | ~600 | TASK_TYPES enum (39 types), task constants | Active | SOFT-FROZEN |
| `ai-orchestrator/src/orchestrator/masterOrchestrator.js` | ~300 | DynamicPlanner + ParallelExecutor + FeedbackLoop | Active | SOFT-FROZEN |
| `ai-orchestrator/src/queue/jobQueue.js` | ~100 | Phase 7A InMemoryJobStore | **LEGACY** | LEGACY |
| `ai-orchestrator/src/memory/memoryEngine.js` | ~150 | Phase 7 3-layer memory (episodic/semantic) | **LEGACY** | LEGACY |
| `ai-orchestrator/public/admin.html` | 2356 | Korean SPA admin panel | **LEGACY** | LEGACY |
| `ai-orchestrator/public/index.html` | 1658 | User-facing AI chat UI | Legacy | LEGACY |
| `ai-orchestrator/public/health-dashboard.html` | 432 | Health + inference dashboard | Legacy | LEGACY |
| `ai-orchestrator/public/js/app.js` | 3903 | Frontend JS for index.html | Legacy | LEGACY |

### 2B. Python FastAPI Files

| Exact path | Lines | Purpose | Status | Freeze level |
|------------|-------|---------|--------|-------------|
| `app/main.py` | ~120 | FastAPI lifespan, table init, app factory | Active | SOFT-FROZEN |
| `app/routers/admin.py` | 2385 | All Python admin API routes | Active | SOFT-FROZEN |
| `app/services/dashboard_service.py` | ~300 | KPI + alert computation, Seoul TZ | Active | OPEN |
| `app/modules/types.py` | 151 | ModuleInput, ExecutionResult types | Active | **HARD-FROZEN** |
| `app/modules/base.py` | ~120 | BaseModule abstract class | Active | **HARD-FROZEN** |
| `app/modules/registry.py` | 175 | ModuleRegistry singleton | Active | **HARD-FROZEN** |
| `app/modules/executor.py` | 449 | ModuleExecutor orchestration | Active | **HARD-FROZEN** |
| `app/modules/validators.py` | ~100 | Output validation | Active | **HARD-FROZEN** |
| `app/modules/modules/classify.py` | 244 | Classification module | Active | OPEN |
| `app/modules/modules/summarize.py` | 209 | Summarization module | Active | OPEN |
| `app/modules/modules/translate.py` | 195 | Translation module | Active | OPEN |
| `app/modules/modules/extract.py` | 238 | Entity extraction module | Active | OPEN |
| `app/modules/modules/analysis.py` | 267 | Data analysis module | Active | OPEN |
| `app/modules/modules/document.py` | 238 | Document processing module | Active | OPEN |
| `app/modules/modules/code.py` | 265 | Code generation/review module | Active | OPEN |
| `app/tools/types.py` | ~120 | ToolInput, ToolResult types | Active | **HARD-FROZEN** |
| `app/tools/base.py` | ~110 | BaseTool abstract class | Active | **HARD-FROZEN** |
| `app/tools/registry.py` | ~130 | ToolRegistry singleton | Active | **HARD-FROZEN** |
| `app/tools/executor.py` | ~230 | ToolExecutor orchestration | Active | **HARD-FROZEN** |
| `app/tools/validators.py` | ~100 | Output validation | Active | **HARD-FROZEN** |
| `app/tools/tools/search.py` | ~220 | Web search tool | Active | OPEN |
| `app/tools/tools/pdf.py` | ~210 | PDF parse tool | Active | OPEN |
| `app/tools/tools/ocr.py` | ~200 | OCR tool | Active | OPEN |
| `app/tools/tools/email.py` | ~280 | Email tool | Active | OPEN |
| `app/tools/tools/image.py` | ~310 | Image analysis tool | Active | OPEN |
| `app/tools/tools/browser.py` | ~360 | Browser / scrape tool | Active | OPEN |

### 2C. Dashboard / Frontend Files (YOUR WORKING DIRECTORY)

| Exact path | Lines | Purpose | Status | Freeze level |
|------------|-------|---------|--------|-------------|
| `dashboard/src/lib/api.ts` | ~400 | Typed API client — all API functions | Active | **OPEN** |
| `dashboard/src/lib/auth.tsx` | ~70 | JWT AuthContext, login/logout | Active | **OPEN** |
| `dashboard/src/app/dashboard/layout.tsx` | 76 | Sidebar nav — add new link entries | Active | **OPEN** |
| `dashboard/src/app/dashboard/page.tsx` | ~180 | Overview page (KPI + chart) | Active | **OPEN** |
| `dashboard/src/app/dashboard/orders/page.tsx` | ~250 | Order list | Active | **OPEN** |
| `dashboard/src/app/dashboard/orders/[id]/page.tsx` | ~300 | Order detail | Active | **OPEN** |
| `dashboard/src/app/dashboard/metrics/page.tsx` | ~180 | Metrics bar chart | Active | **OPEN** |
| `dashboard/src/app/dashboard/tickets/page.tsx` | ~200 | Ticket list | Active | **OPEN** |
| `dashboard/src/app/dashboard/health/page.tsx` | 193 | Python backend health | Active | **OPEN** |
| `dashboard/src/app/dashboard/publish/page.tsx` | ~300 | Shopify publish | Active | **OPEN** |
| `dashboard/src/app/dashboard/repricing/page.tsx` | ~400 | Price repricing | Active | **OPEN** |
| `dashboard/src/app/dashboard/discovery/page.tsx` | 487 | Product discovery v2 | Active | **OPEN** |
| `dashboard/src/app/dashboard/ops/page.tsx` | 455 | Ops KPI + alerts | Active | **OPEN** |
| `dashboard/src/app/dashboard/trends/page.tsx` | 466 | TikTok/Amazon trends | Active | **OPEN** |
| `dashboard/src/app/api/proxy/[...path]/route.ts` | ~60 | Next.js API proxy to Python | Active | **OPEN** |
| `dashboard/next.config.ts` | ~20 | Rewrites `/admin/*` → Python:8000 | Active | **OPEN** |
| `dashboard/tailwind.config.js` | — | Tailwind CSS config | Active | **OPEN** |
| `dashboard/package.json` | — | Next 15, Recharts, Radix UI dependencies | Active | **OPEN** |

### 2D. Documentation Files (READ FIRST)

| File | Lines | Must read? | Key content |
|------|-------|-----------|------------|
| `FINAL_ENGINE_STATUS_REPORT.md` | 887 | ✅ YES — first | Engine + platform spec, all APIs, frozen constants, deployment |
| `MODULE_SYSTEM_STATUS_REPORT.md` | 614 | ✅ YES — second | 7 modules, types, freeze rules, execution flow |
| `TOOL_SYSTEM_STATUS_REPORT.md` | 337 | ✅ YES — third | 6 tools, types, freeze rules, ToolResult schema |
| `DASHBOARD_HANDOFF_PACKAGE.md` | this | ✅ YES — fourth | This document |
| `ENGINE_SPEC.md` | 17380 | Skim | Original engine spec |
| `ENGINE_VALIDATION_REPORT.md` | 18912 | Skim | Validation results |
| `ENGINE_QUALITY_REPORT.md` | 27273 | Skim | Quality metrics |
| `UPDATE_LOG.md` | — | Optional | Full change history |

### 2E. Legacy / Deprecated — DO NOT USE FOR NEW WORK

| File/Route | Why deprecated |
|------------|---------------|
| `ai-orchestrator/src/queue/jobQueue.js` | Phase 7A in-memory queue — replaced by `jobEngine.js` |
| `ai-orchestrator/src/memory/memoryEngine.js` | Phase 7 memory — replaced by `services/memoryEngine.js` |
| Route prefix `/api/queue-legacy/*` | Renamed from Phase 7A; use `/api/jobs/*` |
| Route prefix `/api/memory-legacy/*` | Renamed from Phase 7; use `/api/memory/*` |
| Route prefix `/api/queue/*` (Phase 7 UI) | Use `/api/jobs/*` |
| `ai-orchestrator/public/admin.html` | Korean vanilla SPA — do not extend; keep for legacy access |
| `ai-orchestrator/public/js/app.js` | Frontend JS for admin.html — do not extend |

---

## 3. FROZEN / OPEN / LEGACY CLASSIFICATION TABLE

| File | Freeze Level | Rule |
|------|-------------|------|
| `ai-orchestrator/src/services/aiConnector.js` | **HARD-FROZEN** | Never touch — callLLM internals, CB, cache, fallback chain |
| `ai-orchestrator/src/services/modelRegistry.js` | **HARD-FROZEN** | Never touch — model whitelist, XAI_DISABLED |
| `app/modules/types.py` | **HARD-FROZEN** | Never touch |
| `app/modules/base.py` | **HARD-FROZEN** | Never touch |
| `app/modules/registry.py` | **HARD-FROZEN** | Never touch |
| `app/modules/executor.py` | **HARD-FROZEN** | Never touch |
| `app/modules/validators.py` | **HARD-FROZEN** | Never touch |
| `app/tools/types.py` | **HARD-FROZEN** | Never touch |
| `app/tools/base.py` | **HARD-FROZEN** | Never touch |
| `app/tools/registry.py` | **HARD-FROZEN** | Never touch |
| `app/tools/executor.py` | **HARD-FROZEN** | Never touch |
| `app/tools/validators.py` | **HARD-FROZEN** | Never touch |
| `ai-orchestrator/src/services/memoryEngine.js` | **SOFT-FROZEN** | Read via API only — do not modify |
| `ai-orchestrator/src/services/storageEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/observabilityEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/analyticsEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/jobEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/server.js` | **SOFT-FROZEN** | Do not modify for dashboard work |
| `ai-orchestrator/src/routes/admin.js` | **SOFT-FROZEN** | All APIs already complete |
| `app/routers/admin.py` | **SOFT-FROZEN** | Python admin APIs complete |
| `app/modules/modules/*.py` | **OPEN** | Can add new module implementations |
| `app/tools/tools/*.py` | **OPEN** | Can add new tool implementations |
| `dashboard/src/lib/api.ts` | **OPEN** | Extend freely — add typed functions |
| `dashboard/src/lib/auth.tsx` | **OPEN** | Stable; extend for Node.js auth if needed |
| `dashboard/src/app/dashboard/**` | **OPEN** | All new Phase 16 pages go here |
| `dashboard/next.config.ts` | **OPEN** | Add rewrites for Node.js backend |
| `ai-orchestrator/public/*.html` | **LEGACY** | Reference only; do not extend |
| `ai-orchestrator/src/queue/jobQueue.js` | **LEGACY** | Do not reference |
| `ai-orchestrator/src/memory/memoryEngine.js` | **LEGACY** | Do not reference |

---

## 4. BACKEND ENTRYPOINTS AND ROUTE MAP

### 4.1 Python FastAPI Backend (existing dashboard)

```
Docker host  : http://api:8000
Local dev    : http://localhost:8000
Route prefix : /admin  (all routes in app/routers/admin.py)
Auth         : POST /admin/auth/login → Bearer JWT
Dashboard    : Next.js rewrites /admin/* → api:8000/admin/*
```

**Complete Python route groups used by dashboard:**

| Group | Routes | Dashboard page |
|-------|--------|---------------|
| Auth | `POST /admin/auth/login`, `GET /admin/auth/me` | login/ |
| Dashboard | `GET /admin/dashboard/kpi`, `/alerts`, `/chart` | page.tsx |
| Orders | `GET /admin/orders`, `/orders/:id`, retry/cancel/track/switch | orders/ |
| Tickets | `GET /admin/tickets`, `/tickets/:id`, `POST /:id/close` | tickets/ |
| Health | `GET /admin/health` | health/ |
| Metrics | `GET /admin/metrics` | metrics/ |
| Publish | `GET/POST /admin/publish/preview`, `POST /admin/publish/shopify`, `GET/POST /admin/publish/jobs` | publish/ |
| Repricing | `GET /admin/repricing/preview`, `POST /admin/repricing/apply`, `GET /admin/repricing/runs/:id` | repricing/ |
| Market prices | `POST /admin/market-prices`, `GET /admin/market-prices/:id` | repricing/ |
| Discovery | `GET /admin/discovery/v2/candidates`, `POST /admin/discovery/v2/run`, `POST /admin/discovery/v2/candidates/:id/reject` | discovery/ |
| Trends | `GET /admin/trends/v2/sources`, `/items`, `/mentions`, `POST /admin/trends/v2/run` | trends/ |
| Ops | `GET /admin/ops/kpis`, `/alerts`, `/alert-rules`, `/errors`, `POST /admin/ops/alerts/:id/acknowledge` | ops/ |

### 4.2 Node.js AI Orchestrator Backend (Phase 16 — new pages)

```
Production   : https://144.172.93.226  (Nginx → :3000)
Local dev    : http://localhost:3000
Auth         : POST /api/auth/login → { token, user: { id, email, role } }
Credentials  : admin@ai-orch.local / AiOrch2026!Secure
Store token  : localStorage "orch_token"
Inject header: Authorization: Bearer <orch_token>
```

**All Node.js admin/platform route groups (alphabetical):**

| Route prefix | Method(s) | Purpose |
|-------------|---------|---------|
| `GET /health` | GET | Engine liveness |
| `GET /api/ai/status` | GET | Provider runtime status |
| `GET /api/ai/cache/stats` | GET | Cache size, hit rate, TTL, valid entries |
| `POST /api/ai/cache/clear` | POST | Clear response cache |
| `GET /api/models` | GET | All 51 models + enabled status |
| `GET /api/task-types` | GET | All 39 task types |
| `GET /api/admin/stats` | GET | Top-level KPIs (users, jobs, cost, tokens, pipelines) |
| `GET /api/admin/system` | GET | Node version, memory, uptime |
| `GET /api/admin/users` | GET | User list |
| `GET /api/admin/users/:id` | GET | User detail |
| `PUT /api/admin/users/:id/role` | PUT | Set user role |
| `PUT /api/admin/users/:id/password` | PUT | Reset password |
| `DELETE /api/admin/users/:id` | DELETE | Delete user |
| `GET /api/admin/costs` | GET | Cost breakdown |
| `GET /api/cost/summary` | GET | Cost summary |
| `GET /api/cost/daily` | GET | Daily cost history |
| `GET /api/cost/monthly` | GET | Monthly cost history |
| `GET /api/cost/top-pipelines?limit=N` | GET | Top pipelines by cost |
| `GET /api/cost/model` | GET | Cost by model |
| `GET /api/admin/audit?limit=N` | GET | Admin audit log |
| `GET /api/admin/apiconfig` | GET | Provider API keys (masked) |
| `POST /api/admin/apiconfig` | POST | Register provider API key |
| `GET /api/admin/apiconfig/:provider` | GET | Provider config detail |
| `PUT /api/admin/apiconfig/:provider` | PUT | Update provider config |
| `DELETE /api/admin/apiconfig/:provider` | DELETE | Remove provider |
| `POST /api/admin/apiconfig/:provider/test` | POST | Test provider connectivity |
| `GET /api/admin/models/whitelist` | GET | Model whitelist + disabled list |
| `PATCH /api/admin/models/:modelId/toggle` | PATCH | Enable/disable a model |
| `GET /api/admin/models/priority` | GET | TASK_PROVIDER_PRIORITY per task type |
| `PUT /api/admin/models/priority` | PUT | Update task routing priority |
| `GET /api/admin/models/stats` | GET | Per-model call counts + cost |
| `GET /api/admin/inference/stats?days=N` | GET | Inference stats by day |
| `GET /api/admin/inference/summary` | GET | Aggregated inference summary |
| `GET /api/admin/inference/recent?limit=N` | GET | Recent inference log entries |
| `GET /api/admin/health/dashboard?hours=N` | GET | Per-provider: calls, latency, errors |
| `GET /api/admin/health/errors?days=N` | GET | Provider error log |
| `POST /api/admin/health/check` | POST | Trigger manual health probe |
| `POST /api/admin/deploy` | POST | Trigger hot deploy `{branch:"genspark_ai_developer"}` |
| `GET /api/admin/beta/users` | GET | Beta user list |
| `GET /api/admin/beta/quota/:userId` | GET | User quota |
| `PATCH /api/admin/beta/quota/:userId` | PATCH | Modify user quota |
| `POST /api/admin/beta/quota/reset/:userId` | POST | Reset quota |
| `GET /api/admin/platform/status` | GET | **All 5 engine stats in one call** |
| `GET /api/admin/platform/memory/stats` | GET | Active sessions, workspaces, profiles, hit/miss |
| `GET /api/admin/platform/memory/sessions` | GET | Session list (filter by userId) |
| `GET /api/admin/platform/memory/sessions/:id` | GET | Session detail (turns, summary) |
| `DELETE /api/admin/platform/memory/sessions/:id` | DELETE | Delete session |
| `POST /api/admin/platform/memory/sessions/:id/summarise` | POST | Force summarise |
| `GET /api/admin/platform/memory/profiles/:userId` | GET | User profile |
| `PATCH /api/admin/platform/memory/profiles/:userId` | PATCH | Update profile |
| `POST /api/admin/platform/memory/flush` | POST | Force flush to SQLite |
| `GET /api/admin/platform/storage/stats` | GET | Asset count, bytes, by type, by pipeline |
| `GET /api/admin/platform/storage/assets` | GET | Asset list (filter: pipeline, type) |
| `GET /api/admin/platform/storage/assets/:id` | GET | Asset metadata |
| `DELETE /api/admin/platform/storage/assets/:id` | DELETE | Delete asset |
| `GET /api/assets/:id` | GET | **Download asset content (streams file)** |
| `GET /api/admin/platform/obs/stats` | GET | totalSpans, errorCount, fallbackCount, avgDurationMs, p95DurationMs |
| `GET /api/admin/platform/obs/spans` | GET | Span query (filters: pipeline, status, provider, traceId) |
| `GET /api/admin/platform/obs/events` | GET | Event log (filters: level, pipeline) |
| `GET /api/admin/platform/obs/traces/:traceId` | GET | Full trace tree |
| `POST /api/admin/platform/obs/flush` | POST | Force flush ring buffer |
| `GET /api/admin/platform/analytics/stats` | GET | totalTracked, ring size, counters, pipelines |
| `GET /api/admin/platform/analytics/counters` | GET | All event names + counts (O(1)) |
| `GET /api/admin/platform/analytics/pipelines` | GET | Per-pipeline: runs, cost, avg duration |
| `GET /api/admin/platform/analytics/timeline?days=N` | GET | Daily event count timeline |
| `GET /api/admin/platform/analytics/costs` | GET | Cost by pipeline + by model |
| `GET /api/admin/platform/analytics/users/:userId` | GET | Per-user activity |
| `GET /api/admin/platform/analytics/events` | GET | Raw event query (filter: event, userId) |
| `POST /api/admin/platform/analytics/funnel` | POST | Funnel analysis `{steps:["A","B","C"]}` |
| `POST /api/admin/platform/analytics/track` | POST | Track event manually |
| `GET /api/admin/platform/jobs/stats` | GET | totalEnqueued, completed, failed, active workers |
| `GET /api/admin/platform/jobs/queues` | GET | Per-queue depth |
| `GET /api/admin/platform/jobs` | GET | Job list (filter: status, queue) |
| `GET /api/admin/platform/jobs/:jobId` | GET | Job detail (logs, attempts, result) |
| `POST /api/admin/platform/jobs/:jobId/cancel` | POST | Cancel job |
| `POST /api/admin/platform/jobs/:jobId/retry` | POST | Retry failed job |
| `POST /api/admin/platform/jobs/enqueue` | POST | Manually enqueue job |

### 4.3 Legacy Routes (DO NOT USE)

| Route prefix | Replacement |
|-------------|------------|
| `/api/queue-legacy/*` | `/api/jobs/*` |
| `/api/memory-legacy/*` | `/api/memory/*` |
| `/api/queue/stats` (Phase 7) | `/api/jobs/queues/stats` |

---

## 5. EXISTING DASHBOARD / ADMIN AUDIT

### 5.1 Next.js Dashboard (`dashboard/`) — ACTIVE — Extend This

**Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Recharts, Radix UI, Lucide React  
**Auth:** JWT stored in `localStorage.admin_token`, auto-injected via `apiFetch()`, 401 auto-redirect  
**API client:** `lib/api.ts` ~400 lines, fully typed, uses native `fetch`  
**Proxy:** Next.js rewrites `/admin/*` → Python:8000; `/api/admin/*` → Python:8000  
**Build:** `output: "standalone"` for Docker multi-stage build  

**11 existing pages — all complete:**

| Page | Route | Backend used | State |
|------|-------|-------------|-------|
| Overview | `/dashboard` | Python `/admin/dashboard/kpi` + `/alerts` + `/chart` | ✅ Complete |
| Orders list | `/dashboard/orders` | Python `/admin/orders` | ✅ Complete |
| Order detail | `/dashboard/orders/:id` | Python `/admin/orders/:id` + actions | ✅ Complete |
| Metrics | `/dashboard/metrics` | Python `/admin/metrics` | ✅ Complete |
| Tickets | `/dashboard/tickets` | Python `/admin/tickets` | ✅ Complete |
| Health | `/dashboard/health` | Python `/admin/health` | ✅ Complete |
| Publish | `/dashboard/publish` | Python `/admin/publish/*` | ✅ Complete |
| Repricing | `/dashboard/repricing` | Python `/admin/repricing/*` + `/admin/market-prices` | ✅ Complete |
| Discovery | `/dashboard/discovery` | Python `/admin/discovery/v2/*` | ✅ Complete |
| Ops | `/dashboard/ops` | Python `/admin/ops/*` | ✅ Complete |
| Trends | `/dashboard/trends` | Python `/admin/trends/v2/*` | ✅ Complete |

**API functions in `lib/api.ts` (all Python backend):**  
login, getMe, getKPI, getAlerts, getChart, listOrders, getOrder, retryPlace, forceTracking, cancelRefund, createTicket, listTickets, closeTicket, getHealth, getMetrics, getPublishPreview, triggerPublish, listPublishJobs, getPublishJob, getRepricingPreview, triggerRepricing, listRepricingRuns, getRepricingRun, addMarketPrice, + (discovery, trends, ops functions)

### 5.2 Node.js Admin HTML (`public/admin.html`) — LEGACY — Do Not Extend

A 2356-line single-file Korean-language SPA with 96 fetch/API calls.

| Section | `data-sec` | APIs used | Gaps |
|---------|-----------|----------|------|
| Overview | `overview` | `/api/admin/stats`, `/api/cost/top-pipelines` | No platform stats |
| Users | `users` | `/api/admin/users`, role/password management | — |
| Jobs | `jobs` | `/api/admin/jobs` (Phase 7A legacy jobs) | **Shows wrong job system** |
| Costs | `costs` | `/api/admin/costs` | No per-model breakdown |
| Beta | `beta` | `/api/admin/beta/*` | — |
| API Keys | `apikeys` | `/api/admin/apikeys/:uid` | — |
| API Config | `apiconfig` | `/api/admin/apiconfig`, test endpoints | — |
| Models | `models` | `/api/admin/models/whitelist`, `/priority` | No stats |
| Pipelines | `pipelines` | `/api/admin/pipelines` | — |
| Audit | `audit` | `/api/admin/audit` | — |
| System | `system` | `/api/admin/system` | — |
| Broadcast | `broadcast` | `/api/admin/broadcast` | — |

**`admin.html` does NOT cover:**
- Platform memory/storage/observability/analytics/jobs (Phase 14)
- Module usage stats
- Tool usage stats
- Provider health (covered separately by `health-dashboard.html`)

### 5.3 Node.js Health Dashboard (`public/health-dashboard.html`) — LEGACY

Covers: provider health cards (24h calls, latency, error rate), cache stats, inference error log, inference stats history, streaming test console.  
APIs: `/api/admin/health/dashboard`, `/api/admin/health/errors`, `/api/admin/inference/stats`, `/api/admin/inference/recent`, `/api/ai/cache/stats`, `/api/ai/chat/stream`.  
**Status:** Reference-grade; supersede with `/dashboard/engine/health` in Phase 16.

---

## 6. SUPPORT AND MISSING SECTIONS

### Currently supported (dashboard/ — Python backend only):
✅ E-commerce order lifecycle · tickets · KPI overview · 7-day revenue chart  
✅ Publish pipeline · Repricing · Product discovery · Ops alerts · Trend signals  
✅ JWT auth, token injection, 401 redirect, Docker build

### NOT YET SUPPORTED (Phase 16 — Node.js backend):

| Category | Gap | Section to build |
|----------|-----|-----------------|
| Engine status | Health, routing hit rate, provider states | `/dashboard/engine` |
| Provider health | Latency, errors, circuit-breaker state | `/dashboard/engine/health` |
| Models | Whitelist, priority, usage stats, toggle | `/dashboard/engine/models` |
| AI costs | Cost by provider/model/pipeline | `/dashboard/engine/costs` |
| Modules | Registry, usage counts, error rate | `/dashboard/engine/modules` |
| Tools | Registry, usage counts, latency | `/dashboard/engine/tools` |
| Memory | Active sessions, session detail, profiles | `/dashboard/platform/memory` |
| Storage | Asset list, stats, download, delete | `/dashboard/platform/storage` |
| Observability | Spans, traces, events, stats | `/dashboard/platform/observability` |
| Analytics | Counters, timeline, pipelines, costs, funnel | `/dashboard/platform/analytics` |
| Jobs | Queue monitor, job list, cancel/retry | `/dashboard/platform/jobs` |
| Settings | Provider keys, model priority, deploy, audit | `/dashboard/settings` |

---

## 7. DETAILED API MAP FOR PHASE 16 PAGES

### Setup first: Add Node.js backend support

**Step 1 — Add rewrite in `dashboard/next.config.ts`:**
```typescript
// Current rewrites cover /admin/* → Python:8000
// Add for Node.js AI Orchestrator:
{
  source: '/orch/:path*',
  destination: `${process.env.ORCH_URL ?? 'https://144.172.93.226'}/api/:path*`,
}
```

**Step 2 — Add `orchApiFetch()` to `dashboard/src/lib/api.ts`:**
```typescript
const ORCH_BASE = typeof window !== "undefined" ? "" : (process.env.ORCH_URL ?? "https://144.172.93.226");

function getOrchToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("orch_token");
}

async function orchApiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getOrchToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = ORCH_BASE ? `${ORCH_BASE}/orch${path}` : `/orch${path}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("orch_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`Orch API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return {} as T;
  return res.json();
}

export async function orchLogin(email: string, password: string) {
  // Call Node.js directly (not via rewrite — auth needs raw URL)
  const res = await fetch(`${ORCH_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (typeof window !== "undefined") localStorage.setItem("orch_token", data.token);
  return data;
}
```

---

### 7.1 Engine Status — `/dashboard/engine`

| Route | Method | Response shape | Widget |
|-------|--------|---------------|--------|
| `/health` | GET | `{status:"ok", hasOpenAI, hasAnthropic, demoMode}` | Engine health badge |
| `/api/admin/stats` | GET | `{users, jobs, cost, tokens, pipelines, auditCount}` | 4 KPI cards |
| `/api/ai/cache/stats` | GET | `{size, valid, maxSize, ttlMs, hitRate}` | Cache stat row |
| `/api/admin/health/dashboard?hours=24` | GET | Array of provider health objects | Provider status pills |
| `/api/admin/inference/recent?limit=10` | GET | Array of recent calls | Inference log table |

### 7.2 Models & Providers — `/dashboard/engine/models`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/apiconfig` | GET | All provider configs (masked keys, enabled flag) | Provider table |
| `/api/admin/apiconfig/:provider/test` | POST | Test provider | Test button |
| `/api/admin/models/whitelist` | GET | All models + enabled/disabled | Toggle table |
| `/api/admin/models/:modelId/toggle` | PATCH | Enable/disable | Toggle action |
| `/api/admin/models/priority` | GET | `{[taskType]: [providers...]}` map | Priority editor |
| `/api/admin/models/priority` | PUT | Update priority | Save action |
| `/api/admin/models/stats` | GET | Per-model: calls, cost | Stats table |
| `/api/models` | GET | Full model registry (51 models) | Paginated table |
| `/api/task-types` | GET | All 39 task types | Badge grid |

### 7.3 Provider Health — `/dashboard/engine/health`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/health/dashboard?hours=24` | GET | Provider cards: calls, latency, errors, CB state | 6 provider cards |
| `/api/admin/health/errors?days=7` | GET | Error log by provider | Error table |
| `/api/admin/inference/stats?days=7` | GET | Daily inference stats | Stats table + sparkline |
| `/api/admin/inference/summary` | GET | Aggregated summary | Summary row |
| `/api/admin/inference/recent?limit=20` | GET | Recent calls with model, latency | Scrollable log |
| `/api/admin/health/check` | POST | Manual health probe | Run button |
| `/api/ai/cache/stats` | GET | Cache performance | Cache stats row |

### 7.4 AI Costs — `/dashboard/engine/costs`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/cost/summary` | GET | Total cost today/month | KPI cards |
| `/api/cost/daily` | GET | Daily cost history | Line chart |
| `/api/cost/monthly` | GET | Monthly cost history | Bar chart |
| `/api/cost/top-pipelines?limit=10` | GET | Top pipelines by cost | Bar chart + table |
| `/api/admin/platform/analytics/costs` | GET | Cost by pipeline + by model | Donut + table |
| `/api/admin/costs` | GET | Admin-level cost breakdown | Summary table |

### 7.5 Module Stats — `/dashboard/engine/modules`

> Modules are Python-only. Visibility comes from analytics + observability data.

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/analytics/pipelines` | GET | Per-pipeline stats (filter on module names) | Bar chart |
| `/api/admin/platform/analytics/counters` | GET | All `module.*` event counters | Counter grid |
| `/api/admin/platform/obs/spans?limit=20` | GET | Recent spans (filter by module pipelines) | Spans table |

**7 modules to surface**: `classify`, `summarize`, `translate`, `extract`, `analysis`, `document`, `code`

### 7.6 Tool Stats — `/dashboard/engine/tools`

> Tools are Python-only. Visibility comes from analytics + observability.

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/analytics/counters` | GET | `tool.*` event counters | Counter grid |
| `/api/admin/platform/obs/spans?limit=20` | GET | Tool spans | Spans table |

**6 tools to surface**: `search`, `pdf`, `ocr`, `email`, `image`, `browser`

### 7.7 Platform Overview — `/dashboard/platform`

| Route | Method | Response fields | Widget |
|-------|--------|----------------|--------|
| `/api/admin/platform/status` | GET | `{memory:{activeSessions, totalSessions, ...}, storage:{totalAssets, totalBytes, backend}, observability:{totalSpans, errorCount}, analytics:{totalTracked, countersCount}, jobs:{enqueued, active, failed}}` | 5-engine status grid |

### 7.8 Memory Engine — `/dashboard/platform/memory`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/memory/stats` | GET | activeSessions, totalSessions, workspaces, profiles, hits, misses | Stat row |
| `/api/admin/platform/memory/sessions?userId=X` | GET | Session list | Filterable table |
| `/api/admin/platform/memory/sessions/:id` | GET | Session detail (turns, summary) | Slide-in panel |
| `/api/admin/platform/memory/sessions/:id` | DELETE | Delete session | Delete action |
| `/api/admin/platform/memory/sessions/:id/summarise` | POST | Force summarise | Summarise button |
| `/api/admin/platform/memory/profiles/:userId` | GET | User profile JSON | Profile viewer |
| `/api/admin/platform/memory/profiles/:userId` | PATCH | Update profile | Edit form |
| `/api/admin/platform/memory/flush` | POST | Flush to SQLite | Admin button |

### 7.9 Storage / Assets — `/dashboard/platform/storage`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/storage/stats` | GET | totalAssets, totalBytes, byType, byPipeline | Stat row |
| `/api/admin/platform/storage/assets?pipeline=X&type=Y&limit=50` | GET | Asset list | Filterable table |
| `/api/admin/platform/storage/assets/:id` | GET | Asset metadata | Detail panel |
| `/api/admin/platform/storage/assets/:id` | DELETE | Delete asset | Delete action |
| `/api/assets/:id` | GET | Download asset (stream) | Download link |

### 7.10 Observability — `/dashboard/platform/observability`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/obs/stats` | GET | totalSpans, errorCount, fallbackCount, avgDurationMs, p95DurationMs | Stat row |
| `/api/admin/platform/obs/spans?pipeline=X&status=Y&provider=Z&limit=50` | GET | Span query | Filter form + table |
| `/api/admin/platform/obs/events?level=L&pipeline=P&limit=50` | GET | Event log | Log viewer |
| `/api/admin/platform/obs/traces/:traceId` | GET | Full trace tree | Tree viewer |
| `/api/admin/platform/obs/flush` | POST | Force ring buffer flush | Admin button |

**Span fields**: name, pipeline, status, model, provider, durationMs, costUsd, isFallback, traceId, timestamp

### 7.11 Analytics — `/dashboard/platform/analytics`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/analytics/stats` | GET | totalTracked, ringSize, counters, pipelines | Stat row |
| `/api/admin/platform/analytics/counters` | GET | All event names + counts | Counter grid |
| `/api/admin/platform/analytics/timeline?days=7&event=X` | GET | Daily event timeline | Area chart |
| `/api/admin/platform/analytics/pipelines` | GET | Per-pipeline: runs, cost, avg duration | Sortable table |
| `/api/admin/platform/analytics/costs` | GET | Cost by pipeline + by model | Donut + bar chart |
| `/api/admin/platform/analytics/users/:userId` | GET | Per-user activity | User detail panel |
| `/api/admin/platform/analytics/events?event=X&userId=Y&limit=50` | GET | Raw event query | Event table |
| `/api/admin/platform/analytics/funnel` | POST | `{steps:["A","B","C"]}` → conversion rates | Funnel chart |

**Analytics event namespaces**: `user.*`, `session.*`, `pipeline.*`, `module.*`, `storage.*`, `cost.*`, `job.*`, `admin.*`

### 7.12 Jobs — `/dashboard/platform/jobs`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/platform/jobs/stats` | GET | totalEnqueued, totalCompleted, totalFailed, active, registeredWorkers | Stat row |
| `/api/admin/platform/jobs/queues` | GET | Per-queue: name, depth | Queue depth badges |
| `/api/admin/platform/jobs?status=X&queue=Y&limit=50` | GET | Job list | Filterable table |
| `/api/admin/platform/jobs/:jobId` | GET | Job detail: logs, attempts, result, data | Detail panel |
| `/api/admin/platform/jobs/:jobId/cancel` | POST | Cancel job | Action button |
| `/api/admin/platform/jobs/:jobId/retry` | POST | Retry failed job | Action button |
| `/api/admin/platform/jobs/enqueue` | POST | Manually enqueue `{queue, workerName, data, priority, userId}` | Enqueue form |

**Job priorities**: CRITICAL(10) > HIGH(8) > NORMAL(5) > LOW(2) > IDLE(0)  
**Socket.IO events** (optional real-time): `job:queued`, `job:progress`, `job:completed`, `job:failed`

### 7.13 Settings — `/dashboard/settings`

| Route | Method | Purpose | Widget |
|-------|--------|---------|--------|
| `/api/admin/apiconfig` | GET | Provider API keys (masked) | Provider key table |
| `/api/admin/apiconfig/:provider/test` | POST | Test connectivity | Test button |
| `/api/admin/apiconfig` | POST | Register key | Add form |
| `/api/admin/apiconfig/:provider` | DELETE | Remove key | Delete action |
| `/api/admin/models/priority` | GET | Task type routing priority | Priority editor |
| `/api/admin/models/priority` | PUT | Update routing priority | Save action |
| `/api/admin/models/whitelist` | GET | Model list + enabled status | Toggle table |
| `/api/admin/models/:id/toggle` | PATCH | Enable/disable model | Toggle |
| `/api/admin/system` | GET | Node version, uptime, memory RSS | System info card |
| `/api/admin/deploy` | POST | Trigger deploy `{branch:"genspark_ai_developer"}` | Deploy button |
| `/api/admin/audit?limit=200` | GET | Admin audit log | Audit table |
| `/api/admin/beta/users` | GET | Beta user list | User table |
| `/api/admin/beta/quota/:userId` | PATCH | Modify quota | Edit action |

---

## 8. RECOMMENDATION: EXTEND VS REBUILD

### ✅ DECISION: Extend `dashboard/` — Do Not Rebuild

| Criterion | `dashboard/` (Next.js) | `admin.html` | Build from scratch |
|-----------|----------------------|--------------|-------------------|
| Code quality | ✅ TypeScript, React 19, component model | ❌ Untyped 2356-line Korean single file | N/A |
| Reuse value | ✅ Auth, API client, 11 pages, layout — all reusable | ❌ Cannot reuse components | ❌ Start from zero |
| Speed | ✅ Copy page.tsx pattern, add typed API functions | ❌ Reverse-engineer Korean JS | ❌ Slowest |
| Maintainability | ✅ TypeScript, file-per-page, clear separation | ❌ Hard to diff and test | Depends |
| Architecture fit | ✅ Same Next.js + Tailwind + Recharts stack | ❌ Different stack | Could fit |
| Auth | ✅ Working Python auth; extend for Node.js | ✅ Working Node.js auth (different codebase) | Must implement |
| Scalability | ✅ App Router, SSR, easy server components | ❌ Cannot scale past current size | Could be designed well |

**Rationale:**
1. `lib/api.ts` already has the typed client pattern — 20 more typed functions is trivial
2. `lib/auth.tsx` works — extend with a second context or a second token in localStorage
3. The nav bar (`layout.tsx`) has 9 links — add 13 more is one file change
4. Recharts is installed — all charts need is data from the new APIs
5. `admin.html` is a prototype-quality Korean-language file that cannot be cleanly extended

**What to do with `admin.html`:** Keep as-is for legacy reference access. Do not delete. Optionally add a legacy link from the new dashboard. Eventually deprecate after Phase 16 is complete.

---

## 9. INFORMATION ARCHITECTURE AND MENU STRUCTURE

### Full navigation tree (`dashboard/src/app/dashboard/layout.tsx`)

```typescript
// Current NAV array (9 items) — keep as-is:
const NAV_BUSINESS = [
  { href: "/dashboard",             label: "Overview"     },
  { href: "/dashboard/orders",      label: "Orders"       },
  { href: "/dashboard/metrics",     label: "Metrics"      },
  { href: "/dashboard/tickets",     label: "Tickets"      },
  { href: "/dashboard/health",      label: "Health"       },
  { href: "/dashboard/publish",     label: "🚀 Publish"   },
  { href: "/dashboard/repricing",   label: "💰 Repricing" },
  { href: "/dashboard/discovery",   label: "🔭 Discovery" },
  { href: "/dashboard/ops",         label: "⚙️ Ops"       },
  // Add Trends if not already in NAV:
  { href: "/dashboard/trends",      label: "📈 Trends"    },
];

// NEW: Phase 16 items — add to layout.tsx NAV array:
const NAV_ENGINE = [
  { href: "/dashboard/engine",              label: "Engine"    },
  { href: "/dashboard/engine/models",       label: "Models"    },
  { href: "/dashboard/engine/health",       label: "AI Health" },
  { href: "/dashboard/engine/costs",        label: "AI Costs"  },
  { href: "/dashboard/engine/modules",      label: "Modules"   },
  { href: "/dashboard/engine/tools",        label: "Tools"     },
];

const NAV_PLATFORM = [
  { href: "/dashboard/platform",                   label: "Platform"       },
  { href: "/dashboard/platform/memory",            label: "Memory"         },
  { href: "/dashboard/platform/storage",           label: "Storage"        },
  { href: "/dashboard/platform/observability",     label: "Observability"  },
  { href: "/dashboard/platform/analytics",         label: "Analytics"      },
  { href: "/dashboard/platform/jobs",              label: "Jobs"           },
];

const NAV_ADMIN = [
  { href: "/dashboard/settings",            label: "Settings"   },
];
```

**Recommended sidebar structure:** group by label in sidebar with dividers:
```
── Business ──────────────────────
Overview · Orders · Metrics · Tickets · Health · Publish · Repricing · Discovery · Ops · Trends

── AI Engine ─────────────────────
Engine · Models · AI Health · AI Costs · Modules · Tools

── Platform ──────────────────────
Platform · Memory · Storage · Observability · Analytics · Jobs

── Admin ─────────────────────────
Settings
```

---

## 10. PAGE AND WIDGET SPECIFICATION

### Page 1: Engine Overview — `/dashboard/engine`

**Purpose:** Single-glance status of the AI orchestration engine.

| Widget | Type | API | Fields to display |
|--------|------|-----|-------------------|
| Engine health badge | Status badge (green/red) | `GET /health` | `status === "ok"` |
| Provider active count | KPI card | `GET /api/admin/health/dashboard?hours=24` | count of providers with `successRate > 0` |
| Cache performance | 4-field stat row | `GET /api/ai/cache/stats` | size, valid, hitRate, ttlMs |
| Platform stats | 4 KPI cards | `GET /api/admin/stats` | users, jobs, cost, tokens |
| Provider circuit-breaker | 6 status pills | `GET /api/admin/health/dashboard` | provider name + circuit state (CLOSED/OPEN) |
| Recent inference | 10-row table | `GET /api/admin/inference/recent?limit=10` | model, provider, task, latency, cached |
| Routing hit rate | KPI card | `GET /api/admin/inference/summary` | hitRate (expected: 100%) |

---

### Page 2: Models & Providers — `/dashboard/engine/models`

**Purpose:** View and control which models/providers are active; edit routing priority.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Provider config table | Table with test buttons | `GET /api/admin/apiconfig` + `POST .../test` | provider, enabled, lastTested |
| Model whitelist | Toggle table | `GET /api/admin/models/whitelist` + `PATCH .../toggle` | modelId, provider, enabled |
| Model usage stats | Sortable table | `GET /api/admin/models/stats` | model, calls, costUsd |
| Task routing priority | Ordered list per task | `GET /api/admin/models/priority` + `PUT /priority` | taskType → [providers] |
| Full model registry | Paginated table | `GET /api/models` | name, provider, capabilities, enabled |
| Task type grid | Badge grid | `GET /api/task-types` | taskType, defaultProvider |

---

### Page 3: AI Provider Health — `/dashboard/engine/health`

**Purpose:** Supersedes `health-dashboard.html`. Live provider monitoring in React.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Provider health cards | 6-card grid | `GET /api/admin/health/dashboard?hours=24` | calls24h, successRate, avgLatency, p95Latency, circuitState |
| Error history | Table | `GET /api/admin/health/errors?days=7` | provider, errorCode, count, lastSeen |
| Inference stats chart | Line chart (7 days) | `GET /api/admin/inference/stats?days=7` | date, calls, cost, errors |
| Inference summary | Summary row | `GET /api/admin/inference/summary` | totalCalls, totalCost, cacheHitRate |
| Recent inference log | Scrollable log | `GET /api/admin/inference/recent?limit=20` | model, provider, latency, cached, timestamp |
| Manual health check | Button | `POST /api/admin/health/check` | trigger action |

---

### Page 4: AI Costs — `/dashboard/engine/costs`

**Purpose:** Cost visibility by provider, model, and pipeline.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Cost KPI row | 3 KPI cards | `GET /api/cost/summary` | today, thisMonth, total |
| Daily cost chart | Line chart | `GET /api/cost/daily` | date, costUsd |
| Top pipelines | Bar chart + table | `GET /api/cost/top-pipelines?limit=10` | pipeline, cost |
| Cost by model | Donut chart | `GET /api/admin/platform/analytics/costs` | model → cost |
| Cost by pipeline | Horizontal bar chart | same | pipeline → cost |
| Admin cost table | Sortable table | `GET /api/admin/costs` | provider, pipeline, cost |

---

### Page 5: Module Stats — `/dashboard/engine/modules`

**Purpose:** AI module usage and health visibility.

| Widget | Type | API/Source | Fields |
|--------|------|-----------|--------|
| Module registry | 7-badge grid | Static (MODULE_SYSTEM_STATUS_REPORT.md) | name, type, status (FROZEN) |
| Module invocations | Bar chart | `GET /api/admin/platform/analytics/pipelines` (filter: module names) | pipeline, runs, costUsd |
| Module counters | Counter grid | `GET /api/admin/platform/analytics/counters` (filter `module.*`) | eventName, count |
| Recent module spans | Table | `GET /api/admin/platform/obs/spans?limit=20` | name, pipeline, status, durationMs |
| Error rate | KPI badge | Derived from spans (status=error / total) | errorPct |

**Module names**: `classify`, `summarize`, `translate`, `extract`, `analysis`, `document`, `code`

---

### Page 6: Tool Stats — `/dashboard/engine/tools`

**Purpose:** AI tool usage and health visibility.

| Widget | Type | API/Source | Fields |
|--------|------|-----------|--------|
| Tool registry | 6-badge grid | Static (TOOL_SYSTEM_STATUS_REPORT.md) | name, actions, status (FROZEN) |
| Tool counters | Counter grid | `GET /api/admin/platform/analytics/counters` (filter `tool.*`) | eventName, count |
| Recent tool spans | Table | `GET /api/admin/platform/obs/spans?limit=20` | pipeline, status, durationMs |

**Tool names**: `search`, `pdf`, `ocr`, `email`, `image`, `browser`

---

### Page 7: Platform Overview — `/dashboard/platform`

**Purpose:** Single API call returns all 5 engine health stats.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| 5-engine status grid | 5 cards | `GET /api/admin/platform/status` | memory.activeSessions, storage.totalAssets+bytes, obs.totalSpans+errorCount, analytics.totalTracked, jobs.enqueued+active+failed |

---

### Page 8: Memory Engine — `/dashboard/platform/memory`

**Purpose:** Inspect and manage session memory state.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Stats row | 5 KPI fields | `GET /api/admin/platform/memory/stats` | activeSessions, totalSessions, hits, misses, workspaces, profiles |
| Session list | Filterable table | `GET /api/admin/platform/memory/sessions?userId=X` | sessionId, userId, pipeline, turns, lastUsed |
| Session detail | Slide-in panel | `GET /api/admin/platform/memory/sessions/:id` | turns[], summary, metadata |
| Delete session | Action button | `DELETE .../sessions/:id` | confirmation dialog |
| Force summarise | Action button | `POST .../sessions/:id/summarise` | — |
| Profile viewer | Form + JSON | `GET .../profiles/:userId` + `PATCH` | userId input → profile JSON |
| Force flush | Admin button | `POST .../memory/flush` | — |

---

### Page 9: Storage / Assets — `/dashboard/platform/storage`

**Purpose:** Browse, download, and manage generated assets.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Stats row | 4 KPI fields | `GET /api/admin/platform/storage/stats` | totalAssets, totalBytes, byType breakdown |
| Assets table | Filterable table | `GET .../storage/assets?pipeline=X&type=Y` | assetId, pipeline, type, filename, sizeBytes, createdAt, expiresAt |
| Download button | Link | `GET /api/assets/:id` | streams file |
| Delete button | Action | `DELETE .../storage/assets/:id` | confirmation dialog |

---

### Page 10: Observability — `/dashboard/platform/observability`

**Purpose:** Query execution spans and trace trees; monitor error/fallback rates.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Stats row | 5 KPI fields | `GET /api/admin/platform/obs/stats` | totalSpans, errorCount, fallbackCount, avgDurationMs, p95DurationMs |
| Span query form | Filter + table | `GET .../obs/spans?pipeline=X&status=Y&provider=Z` | name, pipeline, status, model, provider, durationMs, costUsd, isFallback |
| Trace viewer | TraceId input → tree | `GET .../obs/traces/:traceId` | root span + child spans |
| Event log | Log viewer | `GET .../obs/events?level=L&pipeline=P` | timestamp, level, name, pipeline, message |
| Flush button | Admin button | `POST .../obs/flush` | — |

---

### Page 11: Analytics — `/dashboard/platform/analytics`

**Purpose:** Business event tracking, cost analysis, funnel analytics.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Stats row | 4 KPI fields | `GET .../analytics/stats` | totalTracked, ringSize, counters, pipelines |
| Event counter grid | Counter badges | `GET .../analytics/counters` | eventName → count |
| Daily timeline | Area chart | `GET .../analytics/timeline?days=7` | date → count |
| Pipeline stats | Sortable table | `GET .../analytics/pipelines` | pipeline, runs, costUsd, avgDurationMs |
| Cost donut | Donut chart | `GET .../analytics/costs` | model → cost |
| Cost pipeline bar | Horizontal bar | same | pipeline → cost |
| Event query | Filter + table | `GET .../analytics/events?event=X&userId=Y` | eventName, userId, timestamp, metadata |

---

### Page 12: Jobs — `/dashboard/platform/jobs`

**Purpose:** Real-time background job queue monitoring and control.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Stats row | 4 KPI fields | `GET .../jobs/stats` | totalEnqueued, totalCompleted, totalFailed, active, registeredWorkers |
| Queue depth | Badge row | `GET .../jobs/queues` | queue name → depth |
| Job list | Filterable table | `GET .../jobs?status=X&queue=Y` | jobId, queue, status, priority, pipeline, userId, createdAt |
| Job detail | Slide-in panel | `GET .../jobs/:jobId` | logs[], attempts, result, data |
| Cancel job | Action button | `POST .../jobs/:jobId/cancel` | — |
| Retry job | Action button | `POST .../jobs/:jobId/retry` | failed jobs only |
| Enqueue form | Form | `POST .../jobs/enqueue` | queue, workerName, data (JSON), priority |

**Priority values**: `CRITICAL`=10, `HIGH`=8, `NORMAL`=5, `LOW`=2, `IDLE`=0

---

### Page 13: Settings — `/dashboard/settings`

**Purpose:** Admin controls — provider keys, model priorities, deploy trigger, audit log.

| Widget | Type | API | Fields |
|--------|------|-----|--------|
| Provider key table | Table + test buttons | `GET /api/admin/apiconfig` + `POST .../test` | provider, keyMasked, enabled, lastTested |
| Add key form | Form | `POST /api/admin/apiconfig` | provider, key, enabled |
| Remove key | Delete action | `DELETE /api/admin/apiconfig/:provider` | — |
| Task routing editor | Ordered list (per task) | `GET/PUT /api/admin/models/priority` | taskType → [providers] |
| Model toggle table | Toggleable table | `GET /api/admin/models/whitelist` + `PATCH .../toggle` | model, provider, enabled |
| System info | Info card | `GET /api/admin/system` | nodeVersion, memory.rss, uptime |
| Hot deploy | Form + button | `POST /api/admin/deploy` | branch input (default: genspark_ai_developer) |
| Audit log | Paginated table | `GET /api/admin/audit?limit=200` | timestamp, action, user, details |
| Beta quotas | Table | `GET /api/admin/beta/users` + `PATCH .../quota/:userId` | userId, quota, used |

---

## 11. HANDOFF SUMMARY

### Documents to read first (in order)
1. **`FINAL_ENGINE_STATUS_REPORT.md`** (887 lines) — Complete engine + platform spec, all frozen constants, deployment details, API list, live verification results
2. **`MODULE_SYSTEM_STATUS_REPORT.md`** (614 lines) — 7 module types, freeze rules, execution flow
3. **`TOOL_SYSTEM_STATUS_REPORT.md`** (337 lines) — 6 tool types, freeze rules, ToolResult schema
4. **`DASHBOARD_HANDOFF_PACKAGE.md`** (this file) — The complete Phase 16 spec

### Crucial files for Phase 16 development
- `dashboard/src/lib/api.ts` — Add all new typed functions here (one per endpoint, following existing pattern)
- `dashboard/src/lib/auth.tsx` — Understand the auth pattern; add `orchLogin()` and `orch_token` handling
- `dashboard/src/app/dashboard/layout.tsx` — Add nav entries here (13 new items)
- `dashboard/next.config.ts` — Add `/orch/:path*` → Node.js rewrite
- `dashboard/src/app/dashboard/page.tsx` — Copy as the pattern for new pages
- `app/routers/admin.py` — Python backend source of truth (2385 lines, all routes)
- `ai-orchestrator/src/routes/admin.js` — Node.js backend source of truth (1598 lines)

### Files you must NEVER touch
- `ai-orchestrator/src/services/aiConnector.js` — **HARD FROZEN** (callLLM internals, CB threshold=3, cache TTL=600s, fallback chain)
- `ai-orchestrator/src/services/modelRegistry.js` — **HARD FROZEN** (model whitelist, XAI_DISABLED)
- `app/modules/types.py` / `base.py` / `registry.py` / `executor.py` / `validators.py` — **HARD FROZEN**
- `app/tools/types.py` / `base.py` / `registry.py` / `executor.py` / `validators.py` — **HARD FROZEN**
- `ai-orchestrator/src/server.js` — Do not modify for dashboard work
- `ai-orchestrator/src/routes/admin.js` — All APIs already exist; do not add routes

### Extension vs rebuild
**Extend `dashboard/` — do not rebuild.**  
- Auth, routing, API client, component patterns, and all 11 existing pages are solid
- You are adding 13 new pages to an existing working app, not replacing 11 pages
- `lib/api.ts` pattern is proven — copy it for Node.js calls
- Tech stack (Recharts, Radix UI, Tailwind) is already installed

### First steps (suggested 5-day plan)

**Day 1 — Node.js backend plumbing (2 h):**
1. Add `/orch/:path*` rewrite to `next.config.ts`
2. Add `orchApiFetch()` and `orchLogin()` to `lib/api.ts`
3. Verify `GET /orch/health` returns `{status:"ok"}`

**Day 1 — First win: Platform overview (4 h):**
4. Create `dashboard/src/app/dashboard/platform/page.tsx`
5. Call `GET /orch/admin/platform/status` → render 5-engine status grid
6. Add nav entries to `layout.tsx`

**Day 2 — Platform: Jobs + Analytics (8 h):**
7. `/dashboard/platform/jobs` — job queue monitor (highest operator priority)
8. `/dashboard/platform/analytics` — counters + timeline chart

**Day 3 — Engine pages (8 h):**
9. `/dashboard/engine` — status glance
10. `/dashboard/engine/models` — model/provider management
11. `/dashboard/engine/health` — provider health cards

**Day 4 — Remaining platform pages (8 h):**
12. `/dashboard/platform/memory`
13. `/dashboard/platform/storage`
14. `/dashboard/platform/observability`

**Day 5 — Engine costs, modules, tools, settings (8 h):**
15. `/dashboard/engine/costs`
16. `/dashboard/engine/modules` + `/dashboard/engine/tools`
17. `/dashboard/settings`

### Auth credentials
```
Node.js backend:
  URL:      https://144.172.93.226
  Login:    POST /api/auth/login  (direct, not via rewrite)
  Email:    admin@ai-orch.local
  Password: AiOrch2026!Secure
  Token:    localStorage.setItem("orch_token", data.token)
  Header:   Authorization: Bearer <orch_token>

Python backend (already working in dashboard/):
  URL:      http://api:8000  (Docker) / http://localhost:8000 (local)
  Login:    POST /admin/auth/login
  Token:    localStorage "admin_token"  (handled by lib/auth.tsx)
```

### Tech stack — no new packages needed
| Package | Version | Usage |
|---------|---------|-------|
| Next.js | 15.2.4 | App Router, rewrites, standalone build |
| React | 19.0.0 | Components |
| TypeScript | ✅ | All files |
| Tailwind CSS | ✅ | All layout and styling |
| Recharts | 2.13.3 | AreaChart, BarChart, LineChart, PieChart, RadarChart |
| Radix UI | ✅ | Dialog, Select, DropdownMenu, Toast, Label |
| Lucide React | 0.395.0 | Icons |
| Axios | 1.7.2 | Available but use native fetch (consistent with existing code) |

### Frozen engine constants (reference — never change in code)
```
CB_FAIL_THRESHOLD    = 3          (circuit-breaker opens after 3 failures)
CACHE_TTL_MS         = 600_000    (10-minute response cache)
CACHE_MAX_SIZE       = 1000       (cache cap)
FALLBACK_CHAIN       = [openai, google, mistral, anthropic, moonshot, deepseek]
XAI_DISABLED         = [grok-3-mini, grok-3, grok-beta]
INSTANT_FALLBACK_CODES = [AUTH_FAILED, RATE_LIMIT, INSUFFICIENT_CREDIT]
```

---

## 12. FINAL ONE-LINE CONCLUSION

> **The entire AI engine (Phase 13.1 FROZEN) + module layer (7 modules FROZEN) + tool layer (6 tools FROZEN) + platform layer (5 engines FROZEN) is complete and live at `144.172.93.226`; Phase 16 is exclusively dashboard work — extend `dashboard/` with 13 typed Next.js pages and 40+ typed API functions wired to the admin/platform APIs that already exist, no backend changes required.**
