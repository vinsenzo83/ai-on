# Dashboard Developer Handoff Package
## kbeauty-autocommerce — AI Orchestrator Platform

```
Document version : 1.0
Prepared by      : Platform/Engine Lead
Date             : 2026-03-12
Commit basis     : c75462f  (branch: genspark_ai_developer)
Production server: 144.172.93.226  (HTTPS, Nginx → :3000 Node.js)
PR               : https://github.com/vinsenzo83/kbeauty-autocommerce/pull/1
```

---

## SECTION 1 — Dashboard Handoff Overview

The AI orchestration platform has completed **all backend phases**:

| Phase | Scope | Status |
|-------|-------|--------|
| 13.1 | Engine core (routing, fallback, cache, circuit-breaker) | ✅ FROZEN |
| 14 | Platform layer (memory/storage/obs/analytics/jobs) | ✅ FROZEN |
| 14 (modules) | Module execution layer (7 modules) | ✅ FROZEN |
| 15 | Tool integration layer (6 tools) | ✅ FROZEN |
| **16** | **Admin / Dashboard** | **🔲 YOUR TASK** |

The **dashboard developer's job** is Phase 16: build the admin dashboard that
surfaces all platform data through the APIs that already exist.

**No backend changes are required.** Every API you need is already live.  
**No engine files are to be touched.** Read only; never write.  
**Start immediately** — this document gives you everything.

### Key decision upfront
**Build new pages inside the existing `dashboard/` Next.js app** (Option A —
extend). Do NOT replace it. Rationale in Section 11.

---

## SECTION 2 — Dashboard-Relevant Repository Structure Summary

```
kbeauty-autocommerce/                   ← repo root
│
├── dashboard/                          ← ✅ YOUR WORKING DIRECTORY
│   ├── src/app/
│   │   ├── api/proxy/[...path]/route.ts  ← proxy to Python backend (app:8000)
│   │   ├── dashboard/                    ← existing pages (extend here)
│   │   │   ├── layout.tsx                ← nav bar — ADD new entries here
│   │   │   ├── page.tsx                  ← Overview (orders/KPI)
│   │   │   ├── orders/                   ← Orders
│   │   │   ├── metrics/                  ← Order metrics
│   │   │   ├── tickets/                  ← Support tickets
│   │   │   ├── health/                   ← Python backend health
│   │   │   ├── publish/                  ← Shopify publish
│   │   │   ├── repricing/                ← Price repricing
│   │   │   ├── discovery/                ← Product discovery
│   │   │   └── ops/                      ← Ops KPI / alerts
│   │   ├── login/page.tsx                ← Auth page
│   │   └── globals.css
│   ├── src/lib/api.ts                    ← ✅ MAIN API CLIENT — extend this
│   ├── src/lib/auth.tsx                  ← JWT auth context (complete)
│   ├── next.config.ts                    ← rewrites /admin/* → Python backend
│   ├── tailwind.config.js
│   └── package.json                      ← Next.js 15, Recharts, Radix UI
│
├── ai-orchestrator/                    ← Node.js engine (read-only for you)
│   ├── src/server.js                     ← 3854 lines, ~270 routes
│   ├── src/routes/admin.js               ← 1598 lines, admin+platform routes
│   └── src/services/
│       ├── aiConnector.js                ← HARD-FROZEN engine core
│       ├── modelRegistry.js              ← HARD-FROZEN model whitelist
│       ├── memoryEngine.js               ← Platform: memory
│       ├── storageEngine.js              ← Platform: assets
│       ├── observabilityEngine.js        ← Platform: spans/traces
│       ├── analyticsEngine.js            ← Platform: analytics
│       └── jobEngine.js                  ← Platform: background jobs
│
├── app/                                ← Python FastAPI backend (read-only)
│   ├── routers/admin.py                  ← 2385 lines, all Python admin APIs
│   ├── modules/                          ← 7 modules (classify…code)
│   ├── tools/                            ← 6 tools (search/pdf/ocr/email/image/browser)
│   └── services/dashboard_service.py    ← KPI/alerts computation
│
├── FINAL_ENGINE_STATUS_REPORT.md       ← READ FIRST (887 lines)
├── MODULE_SYSTEM_STATUS_REPORT.md      ← READ SECOND
├── TOOL_SYSTEM_STATUS_REPORT.md        ← READ THIRD
└── DASHBOARD_HANDOFF.md                ← THIS FILE
```

### Two separate backends

The project has **two independent backend servers**:

| Backend | Language | Port | Auth token | Base URL in dashboard |
|---------|----------|------|------------|----------------------|
| Python FastAPI (`app/`) | Python | 8000 | JWT via `/admin/auth/login` | `/admin/...` (via Next.js rewrite) |
| Node.js AI Orchestrator (`ai-orchestrator/`) | Node | 3000 | JWT via `/api/auth/login` | Direct HTTPS to `144.172.93.226` |

**Current dashboard (`dashboard/`) talks ONLY to the Python backend.**  
Phase 16 extends it to ALSO talk to the Node.js AI Orchestrator backend.

---

## SECTION 3 — Full File Inventory by Domain

### 3.1 Engine Files (Node.js — READ-ONLY)

| File | Lines | Purpose | Touch? |
|------|-------|---------|--------|
| `ai-orchestrator/src/server.js` | 3854 | Main Express server, all routes | ❌ NO |
| `ai-orchestrator/src/routes/admin.js` | 1598 | Admin + platform routes | ❌ NO |
| `ai-orchestrator/src/services/aiConnector.js` | 905 | FROZEN engine core | ❌ NEVER |
| `ai-orchestrator/src/services/modelRegistry.js` | 249 | FROZEN model whitelist | ❌ NEVER |
| `ai-orchestrator/src/db/database.js` | ~950 | SQLite schema + migrations | ❌ NO |
| `ai-orchestrator/src/services/costTracker.js` | 233 | Cost accounting | ❌ NO |
| `ai-orchestrator/src/services/cronScheduler.js` | 226 | Cron jobs | ❌ NO |
| `ai-orchestrator/src/types/index.js` | ~600 | Task types, model registry | ❌ NO |

### 3.2 Platform Files (Node.js — READ-ONLY, API consumers)

| File | Lines | Purpose | Relevant dashboard section |
|------|-------|---------|---------------------------|
| `ai-orchestrator/src/services/memoryEngine.js` | 513 | Session/workspace/user memory | Platform > Memory |
| `ai-orchestrator/src/services/storageEngine.js` | 360 | Asset persistence | Platform > Storage |
| `ai-orchestrator/src/services/observabilityEngine.js` | 402 | Span/trace/event logging | Platform > Observability |
| `ai-orchestrator/src/services/analyticsEngine.js` | 464 | Business event tracking | Platform > Analytics |
| `ai-orchestrator/src/services/jobEngine.js` | 572 | Background job queue | Platform > Jobs |

### 3.3 Module Files (Python — READ-ONLY)

| File | Lines | Purpose | Relevant dashboard section |
|------|-------|---------|---------------------------|
| `app/modules/types.py` | 151 | ModuleInput, ExecutionResult | Engine > Modules |
| `app/modules/registry.py` | 175 | Module registry singleton | Engine > Modules |
| `app/modules/executor.py` | 449 | Module orchestration | Engine > Modules |
| `app/modules/modules/classify.py` | 244 | Classify module | Engine > Modules |
| `app/modules/modules/summarize.py` | 209 | Summarize module | Engine > Modules |
| `app/modules/modules/translate.py` | 195 | Translate module | Engine > Modules |
| `app/modules/modules/extract.py` | 238 | Extract module | Engine > Modules |
| `app/modules/modules/analysis.py` | 267 | Analysis module | Engine > Modules |
| `app/modules/modules/document.py` | 238 | Document module | Engine > Modules |
| `app/modules/modules/code.py` | 265 | Code module | Engine > Modules |

### 3.4 Tool Files (Python — READ-ONLY)

| File | Lines | Purpose | Relevant dashboard section |
|------|-------|---------|---------------------------|
| `app/tools/types.py` | ~120 | ToolInput, ToolResult | Engine > Tools |
| `app/tools/registry.py` | ~130 | Tool registry singleton | Engine > Tools |
| `app/tools/executor.py` | ~230 | Tool orchestration | Engine > Tools |
| `app/tools/tools/search.py` | ~220 | Search tool | Engine > Tools |
| `app/tools/tools/pdf.py` | ~210 | PDF tool | Engine > Tools |
| `app/tools/tools/ocr.py` | ~200 | OCR tool | Engine > Tools |
| `app/tools/tools/email.py` | ~280 | Email tool | Engine > Tools |
| `app/tools/tools/image.py` | ~310 | Image tool | Engine > Tools |
| `app/tools/tools/browser.py` | ~360 | Browser/scrape tool | Engine > Tools |

### 3.5 Dashboard / Frontend Files (YOUR WORKING FILES)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `dashboard/src/lib/api.ts` | ~400 | **Central API client** — extend for new APIs | OPEN |
| `dashboard/src/lib/auth.tsx` | ~70 | JWT context, login/logout | OPEN (stable) |
| `dashboard/src/app/dashboard/layout.tsx` | 76 | **Nav bar** — add new links here | OPEN |
| `dashboard/src/app/dashboard/page.tsx` | ~180 | Overview (orders KPI + 7-day chart) | OPEN |
| `dashboard/src/app/dashboard/orders/page.tsx` | — | Order list with filters | OPEN |
| `dashboard/src/app/dashboard/orders/[id]/page.tsx` | — | Order detail | OPEN |
| `dashboard/src/app/dashboard/metrics/page.tsx` | ~180 | Order status bar chart | OPEN |
| `dashboard/src/app/dashboard/tickets/page.tsx` | — | Support tickets | OPEN |
| `dashboard/src/app/dashboard/health/page.tsx` | 193 | Python backend health | OPEN |
| `dashboard/src/app/dashboard/publish/page.tsx` | — | Shopify publish pipeline | OPEN |
| `dashboard/src/app/dashboard/repricing/page.tsx` | — | Price repricing | OPEN |
| `dashboard/src/app/dashboard/discovery/page.tsx` | 487 | Product discovery | OPEN |
| `dashboard/src/app/dashboard/ops/page.tsx` | 455 | Ops KPI / alert rules | OPEN |
| `dashboard/src/app/dashboard/trends/page.tsx` | 466 | TikTok/Amazon trends | OPEN |
| `dashboard/src/app/api/proxy/[...path]/route.ts` | ~60 | Next.js API proxy to Python | OPEN |
| `dashboard/next.config.ts` | ~20 | Rewrites `/admin/*` → Python:8000 | OPEN |
| `dashboard/tailwind.config.js` | — | Tailwind config | OPEN |
| `dashboard/package.json` | — | Next 15, Recharts, Radix UI | OPEN |

### 3.6 Static Admin / HTML Files (Node.js public — LEGACY for Phase 16)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `ai-orchestrator/public/admin.html` | 2356 | Full-page SPA admin panel (Korean UI) | LEGACY — do not extend |
| `ai-orchestrator/public/index.html` | 1658 | User-facing AI chat interface | LEGACY — do not extend |
| `ai-orchestrator/public/health-dashboard.html` | 432 | Health + inference stats | LEGACY — do not extend |
| `ai-orchestrator/public/current-state.html` | 972 | Static status page | LEGACY — reference only |
| `ai-orchestrator/public/handover.html` | 1636 | Static handover doc | LEGACY — reference only |
| `ai-orchestrator/public/master-document.html` | 1224 | Static master doc | LEGACY — reference only |
| `ai-orchestrator/public/status-report.html` | 1286 | Static status report | LEGACY — reference only |
| `ai-orchestrator/public/js/app.js` | 3903 | Frontend JS for index.html | LEGACY — do not extend |
| `ai-orchestrator/public/css/style.css` | — | CSS for static pages | LEGACY — do not extend |

### 3.7 Documentation Files (READ FIRST)

| File | Lines | Must read? | Why |
|------|-------|-----------|-----|
| `FINAL_ENGINE_STATUS_REPORT.md` | 887 | ✅ YES — first | Complete engine+platform spec, API list, frozen rules |
| `MODULE_SYSTEM_STATUS_REPORT.md` | ~400 | ✅ YES — second | Module list, types, freeze rules |
| `TOOL_SYSTEM_STATUS_REPORT.md` | ~350 | ✅ YES — third | Tool list, types, freeze rules |
| `ENGINE_SPEC.md` | — | Skim | Original engine spec |
| `ENGINE_VALIDATION_REPORT.md` | — | Skim | Validation results |
| `ENGINE_QUALITY_REPORT.md` | — | Skim | Quality metrics |
| `UPDATE_LOG.md` | — | Optional | Change history |
| `TEAM_COLLABORATION.md` | — | Optional | Team notes |

### 3.8 Test Files (Reference for API contract understanding)

| File | What it tests | Useful for |
|------|--------------|------------|
| `tests/modules/test_module_integration.py` | All 7 modules end-to-end | Understanding module API contract |
| `tests/tools/test_tool_integration.py` | All 6 tools end-to-end | Understanding tool API contract |
| `tests/test_sprint5_dashboard_kpi.py` | Dashboard KPI endpoint | Understanding `/admin/dashboard/*` shape |
| `tests/test_sprint16_monitoring.py` | Ops/alerts endpoints | Understanding `/admin/ops/*` shape |
| `ai-orchestrator/e2e-test.js` | Engine E2E | Understanding engine route behavior |

### 3.9 Legacy / Deprecated (DO NOT USE FOR NEW WORK)

| File/Path | Why deprecated |
|-----------|---------------|
| `ai-orchestrator/src/queue/jobQueue.js` | Phase 7A in-memory queue — replaced by `jobEngine.js` |
| `ai-orchestrator/src/memory/memoryEngine.js` | Phase 7 legacy memory — replaced by `services/memoryEngine.js` |
| `ai-orchestrator/src/types/index.js.backup_*` | Backup file, ignore |
| Routes `/api/queue-legacy/*` | Renamed from Phase 7A — do not reference |
| Routes `/api/memory-legacy/*` | Renamed from Phase 7 — do not reference |
| `ai-orchestrator/public/admin.html` (for new work) | Korean SPA, not typed, not React — do not extend |

---

## SECTION 4 — Freeze / Open / Legacy Classification Table

| File | Freeze Level | Notes |
|------|-------------|-------|
| `ai-orchestrator/src/services/aiConnector.js` | **HARD-FROZEN** | Never touch |
| `ai-orchestrator/src/services/modelRegistry.js` | **HARD-FROZEN** | Never touch |
| `app/modules/types.py` | **HARD-FROZEN** | Never touch |
| `app/modules/base.py` | **HARD-FROZEN** | Never touch |
| `app/modules/registry.py` | **HARD-FROZEN** | Never touch |
| `app/modules/executor.py` | **HARD-FROZEN** | Never touch |
| `app/tools/types.py` | **HARD-FROZEN** | Never touch |
| `app/tools/base.py` | **HARD-FROZEN** | Never touch |
| `app/tools/registry.py` | **HARD-FROZEN** | Never touch |
| `app/tools/executor.py` | **HARD-FROZEN** | Never touch |
| `ai-orchestrator/src/services/memoryEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/storageEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/observabilityEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/analyticsEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/services/jobEngine.js` | **SOFT-FROZEN** | Read via API only |
| `ai-orchestrator/src/server.js` | **SOFT-FROZEN** | Do not modify for dashboard work |
| `ai-orchestrator/src/routes/admin.js` | **SOFT-FROZEN** | Admin APIs already complete |
| `app/routers/admin.py` | **SOFT-FROZEN** | Python admin APIs complete |
| `app/modules/modules/*.py` | **OPEN** | Can add new modules |
| `app/tools/tools/*.py` | **OPEN** | Can add new tools |
| `dashboard/src/lib/api.ts` | **OPEN** | Extend with Node.js API functions |
| `dashboard/src/lib/auth.tsx` | **OPEN** | Stable, extend if needed |
| `dashboard/src/app/dashboard/**` | **OPEN** | All new pages go here |
| `dashboard/next.config.ts` | **OPEN** | Add rewrites for Node.js backend |
| `ai-orchestrator/public/*.html` | **LEGACY** | Do not extend |
| `ai-orchestrator/src/queue/jobQueue.js` | **LEGACY** | Do not reference |
| `ai-orchestrator/src/memory/memoryEngine.js` | **LEGACY** | Do not reference |

---

## SECTION 5 — Entrypoints and Active Route Map

### 5.1 Python Backend Entrypoint
```
Host (Docker): http://api:8000
Host (local):  http://localhost:8000
Mount prefix:  /admin  (all routes under app/routers/admin.py)
Auth:          POST /admin/auth/login → Bearer JWT
Dashboard hits via: Next.js rewrites (/admin/* → Python:8000/admin/*)
```

### 5.2 Node.js AI Orchestrator Entrypoint
```
Host (prod):   https://144.172.93.226  (Nginx → :3000)
Host (local):  http://localhost:3000
Auth:          POST /api/auth/login → Bearer JWT
               email: admin@ai-orch.local / password: AiOrch2026!Secure
Dashboard hits via: direct fetch with Bearer token (add rewrite or env var)
```

### 5.3 Active Python Backend Route Groups (for dashboard)

| Group | Prefix | Key routes |
|-------|--------|-----------|
| Auth | `/admin/auth/` | `POST /login`, `GET /me` |
| Dashboard KPI | `/admin/dashboard/` | `GET /kpi`, `GET /alerts`, `GET /chart` |
| Orders | `/admin/orders/` | `GET /`, `GET /:id`, retry/cancel/track actions |
| Tickets | `/admin/tickets/` | `GET /`, `GET /:id`, `POST /:id/close` |
| Health | `/admin/health` | `GET /health` |
| Metrics | `/admin/metrics` | `GET /metrics` |
| Publish | `/admin/publish/` | preview, trigger, jobs |
| Repricing | `/admin/repricing/` | preview, apply, runs |
| Discovery | `/admin/discovery/` | v2 candidates, run, reject |
| Trends | `/admin/trends/` | v2 sources, items, mentions, run |
| Ops | `/admin/ops/` | kpis, alerts, alert-rules, errors, ack/resolve |
| Canonical | `/admin/canonical/` | products, suppliers, backfill |
| Pricing | `/admin/pricing/` | quotes, sync |
| Channels | `/admin/channels/` | products, publish, orders, sync |

### 5.4 Active Node.js Admin/Platform Route Groups (for dashboard)

| Group | Prefix | Key purpose |
|-------|--------|------------|
| Engine status | `/api/` | health, models, task-types, ai/cache/stats |
| Admin overview | `/api/admin/` | stats, users, costs, audit, system |
| Provider / model mgmt | `/api/admin/` | apiconfig, models/whitelist, models/priority |
| Inference stats | `/api/admin/inference/` | stats, summary, recent |
| Provider health | `/api/admin/health/` | dashboard, errors, check |
| Platform status | `/api/admin/platform/` | status (all 5 engines) |
| Platform memory | `/api/admin/platform/memory/` | stats, sessions, profiles, flush |
| Platform storage | `/api/admin/platform/storage/` | stats, assets list/detail/delete |
| Platform obs | `/api/admin/platform/obs/` | stats, spans, events, traces, flush |
| Platform analytics | `/api/admin/platform/analytics/` | stats, counters, pipelines, timeline, costs, users, funnel |
| Platform jobs | `/api/admin/platform/jobs/` | stats, queues, list, detail, cancel, retry, enqueue |
| Cost tracking | `/api/cost/` | summary, daily, monthly, top-pipelines, model |
| Job queue | `/api/jobs/` | enqueue, status, list, cancel, retry, queues/stats |
| Memory | `/api/memory/` | session CRUD, workspace CRUD, profile, stats |
| Storage | `/api/storage/` | assets CRUD, stats |
| Observability | `/api/obs/` | spans, traces, events, stats |
| Analytics | `/api/analytics/` | track, events, counters, pipelines, timeline, costs, funnel |
| Deploy | `/api/admin/deploy` | POST triggers hot deploy |
| Beta | `/api/admin/beta/` | users, invites, quota management |

### 5.5 Legacy Route Groups (DO NOT USE)

| Route prefix | Why deprecated |
|-------------|---------------|
| `/api/queue-legacy/*` | Old Phase 7A jobs — use `/api/jobs/*` |
| `/api/memory-legacy/*` | Old Phase 7 memory — use `/api/memory/*` |
| `/api/queue/*` | Phase 7 queue UI — use `/api/jobs/*` |

---

## SECTION 6 — Existing Dashboard / Admin Audit Summary

### 6.1 What exists — The Python dashboard (dashboard/)

The `dashboard/` directory is a **well-structured Next.js 15 app** with:
- React 19, TypeScript, Tailwind CSS, Recharts, Radix UI
- JWT auth context with localStorage persistence
- Typed API client (`lib/api.ts` ~400 lines)
- Next.js rewrites routing `/admin/*` → Python backend
- Docker support (standalone output for multi-stage build)

**9 dashboard pages currently exist:**

| Page | Route | Backend | Status |
|------|-------|---------|--------|
| Overview | `/dashboard` | Python `/admin/dashboard/kpi` + `/alerts` + `/chart` | ✅ Complete |
| Orders | `/dashboard/orders` | Python `/admin/orders` | ✅ Complete |
| Order detail | `/dashboard/orders/:id` | Python `/admin/orders/:id` | ✅ Complete |
| Metrics | `/dashboard/metrics` | Python `/admin/metrics` | ✅ Complete |
| Tickets | `/dashboard/tickets` | Python `/admin/tickets` | ✅ Complete |
| Health | `/dashboard/health` | Python `/admin/health` | ✅ Complete |
| Publish | `/dashboard/publish` | Python `/admin/publish/*` | ✅ Complete |
| Repricing | `/dashboard/repricing` | Python `/admin/repricing/*` | ✅ Complete |
| Discovery | `/dashboard/discovery` | Python `/admin/discovery/v2/*` | ✅ Complete |
| Ops | `/dashboard/ops` | Python `/admin/ops/*` | ✅ Complete |
| Trends | `/dashboard/trends` | Python `/admin/trends/v2/*` | ✅ Complete |

### 6.2 What exists — The Node.js admin panel (admin.html)

`ai-orchestrator/public/admin.html` is a **2356-line single-file Korean-language SPA** serving:

| Section | `data-sec` | What it shows |
|---------|-----------|--------------|
| Overview | `overview` | Users, jobs, cost, tokens, pipeline KPIs + job chart + hourly cost chart |
| Users | `users` | User table, role/password management |
| Jobs | `jobs` | Legacy job queue list (Phase 7A) |
| Costs | `costs` | Cost breakdown (hits `/api/admin/costs`) |
| Beta | `beta` | Beta user management, quota |
| API Keys | `apikeys` | User API key management |
| API Config | `apiconfig` | Provider API key registration + test |
| Models | `models` | Model whitelist, priority controls |
| Pipelines | `pipelines` | Pipeline management |
| Audit | `audit` | Admin audit log |
| System | `system` | System health info |
| Broadcast | `broadcast` | Admin broadcast messages |

**`admin.html` does NOT cover:**
- Platform memory engine stats/sessions
- Platform storage/assets
- Platform observability (spans/traces)
- Platform analytics (counters/timeline/funnel)
- Platform jobs (jobEngine — it only shows Phase 7A legacy jobs)
- Module visibility (no module usage stats)
- Tool visibility (no tool stats)
- Provider health history (health-dashboard.html covers this separately)

### 6.3 What exists — The Node.js health dashboard (health-dashboard.html)

`ai-orchestrator/public/health-dashboard.html` covers:
- Provider health cards (24h calls, latency, error rate)
- Cache stats (size, valid entries, TTL)
- Inference error log table
- Inference stats history
- Streaming test console

---

## SECTION 7 — Existing Dashboard-Related File Inventory

### Node.js public HTML (LEGACY — reference only)

| File | Size | API calls wired | Platform section |
|------|------|----------------|-----------------|
| `public/admin.html` | 2356L | `/api/admin/stats`, `/api/admin/users`, `/api/admin/costs`, `/api/admin/audit`, `/api/admin/apiconfig`, `/api/admin/models/*`, `/api/admin/beta/*`, `/api/admin/pipelines`, `/api/admin/broadcast`, `/api/admin/seed` | Overview, Users, Costs, Models, Beta, API |
| `public/health-dashboard.html` | 432L | `/api/admin/health/dashboard`, `/api/admin/health/errors`, `/api/admin/inference/stats`, `/api/admin/inference/recent`, `/api/ai/cache/stats`, `/api/ai/chat/stream` | Health, Inference, Cache |
| `public/index.html` | 1658L | `/api/metrics/dashboard`, `/api/pipelines/*`, `/api/workflow/*`, `/api/combo/*` | User-facing only |
| `public/js/app.js` | 3903L | General app logic for index.html | User-facing only |

### Next.js dashboard pages (ACTIVE — extend these)

| File | API endpoints used |
|------|-------------------|
| `dashboard/src/app/dashboard/page.tsx` | `/admin/dashboard/kpi`, `/admin/dashboard/alerts`, `/admin/dashboard/chart` |
| `dashboard/src/app/dashboard/orders/page.tsx` | `/admin/orders` |
| `dashboard/src/app/dashboard/orders/[id]/page.tsx` | `/admin/orders/:id`, retry/cancel/track actions |
| `dashboard/src/app/dashboard/metrics/page.tsx` | `/admin/metrics` |
| `dashboard/src/app/dashboard/tickets/page.tsx` | `/admin/tickets` |
| `dashboard/src/app/dashboard/health/page.tsx` | `/admin/health` |
| `dashboard/src/app/dashboard/publish/page.tsx` | `/admin/publish/*` |
| `dashboard/src/app/dashboard/repricing/page.tsx` | `/admin/repricing/*`, `/admin/market-prices` |
| `dashboard/src/app/dashboard/discovery/page.tsx` | `/admin/discovery/v2/*` |
| `dashboard/src/app/dashboard/ops/page.tsx` | `/admin/ops/*` |
| `dashboard/src/app/dashboard/trends/page.tsx` | `/admin/trends/v2/*` |

---

## SECTION 8 — What the Current Dashboard Already Supports

The `dashboard/` Next.js app currently covers **all Python backend business operations**:

✅ E-commerce order lifecycle (view, retry, cancel, track, switch supplier)  
✅ Support ticket management (list, close)  
✅ Dashboard KPI overview (orders, revenue, margin, failures, stale tracking, tickets)  
✅ 7-day revenue/order trend chart (Recharts AreaChart)  
✅ Order status metrics bar chart  
✅ Python backend health check (DB, Redis, queue depth, failures)  
✅ Shopify publish pipeline (preview, trigger dry-run/live, job history)  
✅ Price repricing (preview, trigger, run history, competitor band view)  
✅ Product discovery v2 (candidate scoring, approve/reject)  
✅ Ops monitoring (KPI snapshot, alert rules, active alerts, error log)  
✅ TikTok/Amazon trend signals (sources, items, mentions, run trigger)  
✅ JWT login/logout with role persistence  
✅ Token auto-injection on all requests  
✅ 401 auto-redirect to /login  
✅ Next.js rewrites for Python backend proxy  
✅ Docker standalone build  
✅ Recharts, Radix UI, Tailwind CSS stack  

---

## SECTION 9 — What the Current Dashboard is Missing

The following **are not implemented anywhere in dashboard/**:

### 9.1 AI Engine visibility (Node.js backend)
❌ Engine health / routing hit rate display  
❌ Provider status cards (which providers active, which degraded)  
❌ Model whitelist view (which models enabled/disabled)  
❌ Model priority order display (TASK_PROVIDER_PRIORITY)  
❌ Cache stats (size, hit rate, TTL remaining)  
❌ Circuit-breaker state per provider (CLOSED/OPEN/HALF-OPEN)  
❌ Inference log viewer (recent requests, latency, model used)  
❌ Fallback event history (how often did fallback trigger)  

### 9.2 Module visibility (Node.js + Python backend)
❌ Module registry overview (which 7 modules are registered)  
❌ Per-module usage stats (how many invocations per module)  
❌ Module validation failure rate  
❌ Recent module execution activity  

### 9.3 Tool visibility (Python backend)
❌ Tool registry overview (which 6 tools are registered)  
❌ Per-tool usage stats and success/failure rates  
❌ Recent tool execution activity  
❌ Tool latency distribution  

### 9.4 Platform — Memory Engine
❌ Active session count + list  
❌ Memory engine stats (sessions, workspaces, user profiles)  
❌ Session detail viewer (turn history)  
❌ Force summarise session action  
❌ Workspace browser  

### 9.5 Platform — Storage / Assets
❌ Asset count + total size display  
❌ Assets list table (pipeline, type, size, created, expiry)  
❌ Asset detail + download link  
❌ Admin delete asset action  
❌ Storage stats (by type, by pipeline)  

### 9.6 Platform — Observability
❌ Span query UI (filter by pipeline, status, provider, duration)  
❌ Trace viewer (full trace tree)  
❌ Event log viewer  
❌ Observability stats (totalSpans, errorCount, avgDurationMs, p95DurationMs)  
❌ Fallback count display  

### 9.7 Platform — Analytics
❌ Event counters dashboard (all event names + counts)  
❌ Daily timeline chart (events per day)  
❌ Pipeline stats table (usage per pipeline)  
❌ Cost summary (by pipeline, by model)  
❌ Funnel analysis UI  
❌ Per-user activity view  

### 9.8 Platform — Jobs
❌ Job queue list (status, priority, queue name, user, pipeline)  
❌ Queue stats (depth per queue, active workers)  
❌ Job detail viewer (logs, attempts, result)  
❌ Cancel job action  
❌ Retry job action  
❌ Manual enqueue form  

### 9.9 Admin / Settings (Node.js backend — not in dashboard/)
❌ Provider API key management (register, test, delete)  
❌ Model toggle (enable/disable per model)  
❌ Model priority editor (drag/reorder TASK_PROVIDER_PRIORITY)  
❌ Hot deploy trigger (`POST /api/admin/deploy`)  
❌ Beta user/quota management  
❌ Admin cost breakdown (by provider, by pipeline)  

---

## SECTION 10 — Dashboard API Map

### How to call the Node.js backend from dashboard/

The current `dashboard/next.config.ts` rewrites `/admin/*` → Python:8000. You need to add
calls to the Node.js backend. Two approaches:

**Approach A (recommended): Add a second rewrite in next.config.ts**
```typescript
// dashboard/next.config.ts — add this rewrite
{
  source: '/orch/:path*',
  destination: `${ORCH_URL}/api/:path*`,   // ORCH_URL=https://144.172.93.226
}
```
Then call `/orch/admin/platform/status` in your pages.

**Approach B: Direct fetch with separate base URL env var**
```typescript
const ORCH_BASE = process.env.NEXT_PUBLIC_ORCH_URL ?? 'https://144.172.93.226';
// store orch JWT separately in localStorage as "orch_token"
```

For the token: call `POST /api/auth/login` on the Node.js backend once, store the JWT, inject as `Authorization: Bearer <token>` on all `/api/*` calls.

---

### 10.1 Engine Status APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /health` | GET | Engine liveness (`{status:"ok"}`) | Engine > Overview |
| `GET /api/ai/status` | GET | AI provider runtime status | Engine > Overview |
| `GET /api/ai/cache/stats` | GET | Cache size, hit rate, TTL, valid entries | Engine > Overview |
| `GET /api/models` | GET | All 51 registered models + enabled status | Engine > Models |
| `GET /api/task-types` | GET | All 39 task types + routing | Engine > Models |
| `GET /api/admin/models/whitelist` | GET | Model whitelist + disabled list | Engine > Models |
| `GET /api/admin/models/priority` | GET | TASK_PROVIDER_PRIORITY per task type | Engine > Models |
| `GET /api/admin/models/stats` | GET | Per-model invocation counts + cost | Engine > Models |
| `PUT /api/admin/models/priority` | PUT | Update task type routing order | Engine > Settings |
| `PATCH /api/admin/models/:modelId/toggle` | PATCH | Enable/disable a model | Engine > Settings |
| `GET /api/admin/apiconfig` | GET | All registered provider API keys | Engine > Settings |
| `POST /api/admin/apiconfig/:provider/test` | POST | Test provider connectivity | Engine > Settings |

### 10.2 Provider Health APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/health/dashboard?hours=24` | GET | Per-provider: calls, latency, errors, success rate | Engine > Health |
| `GET /api/admin/health/errors?days=N` | GET | Provider error log table | Engine > Health |
| `POST /api/admin/health/check` | POST | Trigger manual health probe | Engine > Health |
| `GET /api/admin/inference/stats?days=N` | GET | Inference stats by day | Engine > Health |
| `GET /api/admin/inference/summary` | GET | Aggregated inference summary | Engine > Health |
| `GET /api/admin/inference/recent?limit=N` | GET | Most recent inference log entries | Engine > Health |

### 10.3 Module APIs

> **Note**: Modules are Python-only. The Node.js backend has no `/api/modules/` routes.
> Module visibility data comes from `analytics_events` (event_name prefix `module.*`)
> and the observability spans (name contains `module`).

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/analytics/pipelines` | GET | Per-pipeline invocation counts (modules show as pipelines) | Engine > Modules |
| `GET /api/analytics/counters` | GET | All event counters incl. `module.*` events | Engine > Modules |
| `GET /api/obs/spans?pipeline=<module-name>` | GET | Spans for a specific module pipeline | Engine > Modules |
| `GET /api/admin/platform/analytics/pipelines` | GET | Admin-level pipeline stats | Engine > Modules |

### 10.4 Tool APIs

> **Note**: Tools are Python-only. Tool visibility data comes from analytics events
> (event_name prefix `tool.*` if tracked) and observability spans.

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/analytics/counters` | GET | All event counters incl. any `tool.*` events | Engine > Tools |
| `GET /api/obs/spans` | GET | Spans for tool-related pipelines | Engine > Tools |

### 10.5 Memory Engine APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/platform/memory/stats` | GET | Total sessions, active, workspaces, profiles, hit/miss | Platform > Memory |
| `GET /api/admin/platform/memory/sessions?userId=X` | GET | List sessions (filter by userId) | Platform > Memory |
| `GET /api/admin/platform/memory/sessions/:id` | GET | Session detail (turns, summary, metadata) | Platform > Memory |
| `DELETE /api/admin/platform/memory/sessions/:id` | DELETE | Delete a session | Platform > Memory |
| `POST /api/admin/platform/memory/sessions/:id/summarise` | POST | Force summarise session | Platform > Memory |
| `GET /api/admin/platform/memory/profiles/:userId` | GET | User profile (preferences, patterns, stats) | Platform > Memory |
| `PATCH /api/admin/platform/memory/profiles/:userId` | PATCH | Update user profile | Platform > Memory |
| `POST /api/admin/platform/memory/flush` | POST | Force flush in-memory state to SQLite | Platform > Memory |
| `GET /api/memory/stats` | GET | Same stats (non-admin version, still requires admin role) | Platform > Memory |

### 10.6 Storage / Assets APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/platform/storage/stats` | GET | Total assets, total bytes, by type, by pipeline | Platform > Storage |
| `GET /api/admin/platform/storage/assets?pipeline=X&type=Y&limit=50` | GET | Asset list with filters | Platform > Storage |
| `GET /api/admin/platform/storage/assets/:assetId` | GET | Asset metadata detail | Platform > Storage |
| `DELETE /api/admin/platform/storage/assets/:assetId` | DELETE | Delete asset | Platform > Storage |
| `GET /api/assets/:assetId` | GET | Download asset content (streams file) | Platform > Storage |

### 10.7 Observability APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/platform/obs/stats` | GET | totalSpans, totalEvents, errorCount, fallbackCount, avgDurationMs, p95DurationMs | Platform > Observability |
| `GET /api/admin/platform/obs/spans?traceId=X&pipeline=Y&status=Z&provider=P&limit=50` | GET | Span query with filters | Platform > Observability |
| `GET /api/admin/platform/obs/events?pipeline=Y&level=L&limit=50` | GET | Event log query | Platform > Observability |
| `GET /api/admin/platform/obs/traces/:traceId` | GET | Full trace tree (root span + all children) | Platform > Observability |
| `POST /api/admin/platform/obs/flush` | POST | Force flush ring buffer to DB | Platform > Observability |
| `GET /api/obs/stats` | GET | Same stats (requires admin role) | Platform > Observability |

### 10.8 Analytics APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/platform/analytics/stats` | GET | totalTracked, ringSize, counters count, pipelines count, costs | Platform > Analytics |
| `GET /api/admin/platform/analytics/counters` | GET | All event names + counts (O(1) aggregation) | Platform > Analytics |
| `GET /api/admin/platform/analytics/pipelines` | GET | Per-pipeline: runs, cost, avg duration | Platform > Analytics |
| `GET /api/admin/platform/analytics/timeline?days=7&event=X` | GET | Daily event count timeline | Platform > Analytics |
| `GET /api/admin/platform/analytics/costs` | GET | Cost by pipeline + by model | Platform > Analytics |
| `GET /api/admin/platform/analytics/users/:userId` | GET | Per-user activity stats | Platform > Analytics |
| `GET /api/admin/platform/analytics/events?event=X&userId=Y&limit=50` | GET | Raw event query | Platform > Analytics |
| `POST /api/admin/platform/analytics/funnel` | POST | Funnel analysis `{steps:["A","B","C"]}` | Platform > Analytics |

### 10.9 Jobs APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/platform/jobs/stats` | GET | totalEnqueued, totalCompleted, totalFailed, active, registeredWorkers | Platform > Jobs |
| `GET /api/admin/platform/jobs/queues` | GET | Per-queue depth + name | Platform > Jobs |
| `GET /api/admin/platform/jobs?status=X&queue=Y&limit=50` | GET | Job list with filters | Platform > Jobs |
| `GET /api/admin/platform/jobs/:jobId` | GET | Job detail (logs, attempts, result, data) | Platform > Jobs |
| `POST /api/admin/platform/jobs/:jobId/cancel` | POST | Cancel pending/active job | Platform > Jobs |
| `POST /api/admin/platform/jobs/:jobId/retry` | POST | Retry failed job | Platform > Jobs |
| `POST /api/admin/platform/jobs/enqueue` | POST | Manually enqueue a job | Platform > Jobs |
| `GET /api/jobs/queues/stats` | GET | Same stats (non-admin alias) | Platform > Jobs |

### 10.10 Admin / Platform Control APIs

| Route (Node.js) | Method | Purpose | Dashboard Page |
|-----------------|--------|---------|----------------|
| `GET /api/admin/stats` | GET | Top-level admin overview (users, jobs, cost, tokens, pipelines) | Engine > Overview |
| `GET /api/admin/system` | GET | Runtime info (Node version, memory, uptime, platform) | Engine > Settings |
| `GET /api/admin/costs` | GET | Cost breakdown by provider, pipeline | Engine > Costs |
| `GET /api/cost/summary` | GET | Cost summary | Engine > Costs |
| `GET /api/cost/daily` | GET | Daily cost history | Engine > Costs |
| `GET /api/cost/top-pipelines?limit=10` | GET | Top pipelines by cost | Engine > Costs |
| `GET /api/admin/audit?limit=200` | GET | Admin audit log | Engine > Settings |
| `POST /api/admin/deploy` | POST | Trigger hot deploy `{branch:"genspark_ai_developer"}` | Engine > Settings |
| `GET /api/admin/platform/status` | GET | All 5 engine stats in one call | Platform > Overview |
| `GET /api/platform/status` | GET | Same (non-admin alias) | Platform > Overview |

### 10.11 Node.js Auth (for engine/platform pages)

```typescript
// POST https://144.172.93.226/api/auth/login
// Body: { email: "admin@ai-orch.local", password: "AiOrch2026!Secure" }
// Response: { token: "eyJ...", user: { id, email, role } }
// Store as: localStorage.setItem("orch_token", token)
// Inject as: Authorization: Bearer <orch_token>
```

---

## SECTION 11 — Recommendation: Extend vs Rebuild

### ✅ RECOMMENDATION: Option A — Extend the existing dashboard/

**Verdict: Add new sections to `dashboard/` as new top-level route groups.**  
Do NOT rebuild from scratch.  
Do NOT extend `admin.html`.

### Justification

| Criterion | dashboard/ (Next.js) | admin.html | Rebuild from scratch |
|-----------|---------------------|------------|---------------------|
| **Code quality** | ✅ TypeScript, typed API client, React 19, component model | ⚠️ Untyped vanilla JS, 2356-line single file, Korean strings hardcoded | N/A |
| **Reuse value** | ✅ Auth, layout, nav, lib/api.ts, all 11 pages reusable | ❌ Cannot reuse components | ❌ Start from zero |
| **Implementation speed** | ✅ Pattern established: copy page.tsx pattern, add API functions | ⚠️ Requires reverse-engineering Korean JS | ❌ Slowest |
| **Maintainability** | ✅ TypeScript catches errors, file-per-page, clear separation | ❌ Single file, hard to diff, hard to test | Depends |
| **Architecture fit** | ✅ Same stack (Next.js + Tailwind + Recharts) as existing pages | ❌ Different stack (plain HTML) | Could fit |
| **Future scalability** | ✅ Next.js App Router, easy to add server components, SSR | ❌ Cannot scale past current size cleanly | Could be designed well |
| **Auth** | ✅ Already working with Python backend, extend for Node.js | ✅ Already working with Node.js backend | Must implement |

**Additional reasons:**
1. `lib/api.ts` already has the typed client pattern — adding 20 more typed functions is trivial
2. `lib/auth.tsx` works — just add a second auth context for the Node.js backend or extend existing
3. The nav bar (`layout.tsx`) has 9 links; adding 4–5 more is one file change
4. Recharts is already installed — all charts need is data
5. `admin.html` is a prototype-quality Korean-language file that cannot be extended cleanly

**What to do with admin.html**: Keep it as-is for legacy access. Do not delete it. Add a link
from the new dashboard to redirect heavy users. Eventually deprecate.

---

## SECTION 12 — Proposed Dashboard IA / Menu Structure

### Navigation structure (extend `dashboard/src/app/dashboard/layout.tsx`)

```
/dashboard                          (existing Overview)
/dashboard/orders                   (existing)
/dashboard/orders/:id               (existing)
/dashboard/metrics                  (existing)
/dashboard/tickets                  (existing)
/dashboard/health                   (existing Python health)
/dashboard/publish                  (existing)
/dashboard/repricing                (existing)
/dashboard/discovery                (existing)
/dashboard/ops                      (existing)
/dashboard/trends                   (existing)

── NEW SECTIONS ──────────────────────────────────────────────
/dashboard/engine                   ← NEW: Engine Overview
/dashboard/engine/models            ← NEW: Models & Providers
/dashboard/engine/health            ← NEW: Provider Health (replaces health-dashboard.html)
/dashboard/engine/costs             ← NEW: Cost Analysis
/dashboard/engine/modules           ← NEW: Module Stats
/dashboard/engine/tools             ← NEW: Tool Stats

/dashboard/platform                 ← NEW: Platform Overview
/dashboard/platform/memory          ← NEW: Memory Engine
/dashboard/platform/storage         ← NEW: Storage / Assets
/dashboard/platform/observability   ← NEW: Observability
/dashboard/platform/analytics       ← NEW: Analytics
/dashboard/platform/jobs            ← NEW: Job Queue

/dashboard/settings                 ← NEW: Admin Settings
```

### Updated nav array for layout.tsx

```typescript
const NAV = [
  // ── Existing (keep as-is) ──────────────────────────────────
  { href: "/dashboard",             label: "Overview",      group: "Business" },
  { href: "/dashboard/orders",      label: "Orders",        group: "Business" },
  { href: "/dashboard/metrics",     label: "Metrics",       group: "Business" },
  { href: "/dashboard/tickets",     label: "Tickets",       group: "Business" },
  { href: "/dashboard/health",      label: "Health",        group: "Business" },
  { href: "/dashboard/publish",     label: "Publish",       group: "Business" },
  { href: "/dashboard/repricing",   label: "Repricing",     group: "Business" },
  { href: "/dashboard/discovery",   label: "Discovery",     group: "Business" },
  { href: "/dashboard/ops",         label: "Ops",           group: "Business" },
  { href: "/dashboard/trends",      label: "Trends",        group: "Business" },

  // ── NEW: Engine ───────────────────────────────────────────
  { href: "/dashboard/engine",          label: "Engine",        group: "AI Engine" },
  { href: "/dashboard/engine/models",   label: "Models",        group: "AI Engine" },
  { href: "/dashboard/engine/health",   label: "AI Health",     group: "AI Engine" },
  { href: "/dashboard/engine/costs",    label: "AI Costs",      group: "AI Engine" },
  { href: "/dashboard/engine/modules",  label: "Modules",       group: "AI Engine" },
  { href: "/dashboard/engine/tools",    label: "Tools",         group: "AI Engine" },

  // ── NEW: Platform ─────────────────────────────────────────
  { href: "/dashboard/platform",              label: "Platform",       group: "Platform" },
  { href: "/dashboard/platform/memory",       label: "Memory",         group: "Platform" },
  { href: "/dashboard/platform/storage",      label: "Storage",        group: "Platform" },
  { href: "/dashboard/platform/observability",label: "Observability",  group: "Platform" },
  { href: "/dashboard/platform/analytics",    label: "Analytics",      group: "Platform" },
  { href: "/dashboard/platform/jobs",         label: "Jobs",           group: "Platform" },

  // ── NEW: Settings ─────────────────────────────────────────
  { href: "/dashboard/settings",        label: "Settings",      group: "Admin" },
];
```

---

## SECTION 13 — Proposed Page Structure and Widgets

### 13.1 Engine Overview — `/dashboard/engine`

**Purpose**: Single status glance for the AI engine.

| Widget | Type | API |
|--------|------|-----|
| Engine health badge (ok/error) | Status badge | `GET /api/health` |
| Provider count (active/total) | KPI card | `GET /api/admin/health/dashboard` |
| Cache stats (size, hit rate, TTL) | 4-field stat row | `GET /api/ai/cache/stats` |
| Top-level admin stats (users, jobs, cost, tokens) | 4 KPI cards | `GET /api/admin/stats` |
| Recent inference activity (last 10) | Table | `GET /api/admin/inference/recent?limit=10` |
| Provider circuit-breaker state | Status pills | `GET /api/admin/health/dashboard` |

---

### 13.2 Models & Providers — `/dashboard/engine/models`

**Purpose**: View + control which models and providers are active.

| Widget | Type | API |
|--------|------|-----|
| Provider list with status + last-tested | Table | `GET /api/admin/apiconfig` |
| Test provider button | Action button | `POST /api/admin/apiconfig/:provider/test` |
| Model whitelist table (enabled/disabled toggle) | Toggleable table | `GET /api/admin/models/whitelist`, `PATCH /api/admin/models/:modelId/toggle` |
| Model usage stats (calls, cost) | Table | `GET /api/admin/models/stats` |
| Task type routing priority editor | Ordered list | `GET /api/admin/models/priority`, `PUT /api/admin/models/priority` |
| Full model registry (all 51) | Paginated table | `GET /api/models` |
| Task types (all 39) | Badge grid | `GET /api/task-types` |

---

### 13.3 AI Provider Health — `/dashboard/engine/health`

**Purpose**: Replaces and supersedes `health-dashboard.html`. Live provider monitoring.

| Widget | Type | API |
|--------|------|-----|
| Provider health cards (6 cards, one per provider) | Card grid | `GET /api/admin/health/dashboard?hours=24` |
| Each card shows: calls 24h, success rate, p95 latency, error rate, circuit status | Stat rows | same |
| Error history table (provider, error code, count, last seen) | Table | `GET /api/admin/health/errors?days=7` |
| Inference stats by day (table + sparkline) | Table + chart | `GET /api/admin/inference/stats?days=7` |
| Run health check button | Action button | `POST /api/admin/health/check` |
| Recent inference log (last 20) | Scrollable log | `GET /api/admin/inference/recent?limit=20` |

---

### 13.4 AI Costs — `/dashboard/engine/costs`

**Purpose**: Cost visibility across providers and pipelines.

| Widget | Type | API |
|--------|------|-----|
| Total cost today / this month | KPI cards | `GET /api/cost/summary` |
| Daily cost chart (7 days) | Line chart | `GET /api/cost/daily` |
| Top pipelines by cost | Bar chart + table | `GET /api/cost/top-pipelines?limit=10` |
| Cost by model | Pie/donut chart | `GET /api/admin/platform/analytics/costs` |
| Cost by pipeline (full table) | Sortable table | `GET /api/admin/platform/analytics/costs` |
| Admin cost breakdown | Table | `GET /api/admin/costs` |

---

### 13.5 Module Stats — `/dashboard/engine/modules`

**Purpose**: Visibility into the 7 module types usage and health.

| Widget | Type | API |
|--------|------|-----|
| Module registry overview (7 modules) | Badge grid | Static — use MODULE_SYSTEM_STATUS_REPORT data |
| Per-module invocation count | Bar chart | `GET /api/admin/platform/analytics/pipelines` (filter by module names) |
| Analytics counters for module.* events | Counter grid | `GET /api/admin/platform/analytics/counters` |
| Recent module spans (last 20) | Table | `GET /api/admin/platform/obs/spans?limit=20` |
| Module error rate | Stat | Derived from obs spans (status=error) |

**Module names to filter on**: `classify`, `summarize`, `translate`, `extract`, `analysis`, `document`, `code`

---

### 13.6 Tool Stats — `/dashboard/engine/tools`

**Purpose**: Visibility into the 6 tool types usage and health.

| Widget | Type | API |
|--------|------|-----|
| Tool registry overview (6 tools) | Badge grid | Static — use TOOL_SYSTEM_STATUS_REPORT data |
| Analytics counters for tool.* events | Counter grid | `GET /api/admin/platform/analytics/counters` |
| Recent tool spans | Table | `GET /api/admin/platform/obs/spans?limit=20` (filter tool pipelines) |

**Tool names**: `search`, `pdf`, `ocr`, `email`, `image`, `browser`

---

### 13.7 Platform Overview — `/dashboard/platform`

**Purpose**: One-glance health of all 5 platform engines.

| Widget | Type | API |
|--------|------|-----|
| Platform status card (all 5 engines in one payload) | 5-engine status grid | `GET /api/admin/platform/status` |
| Memory: active sessions, total sessions | KPI pair | same (memory field) |
| Storage: total assets, total bytes, backend | KPI triple | same (storage field) |
| Observability: totalSpans, errorCount | KPI pair | same (observability field) |
| Analytics: totalTracked, counters count | KPI pair | same (analytics field) |
| Jobs: enqueued, active, failed | KPI triple | same (jobs field) |

---

### 13.8 Memory Engine — `/dashboard/platform/memory`

**Purpose**: Inspect session memory, workspaces, user profiles.

| Widget | Type | API |
|--------|------|-----|
| Stats row (active sessions, total, hit rate, workspaces, profiles) | Stat row | `GET /api/admin/platform/memory/stats` |
| Session list table (sessionId, userId, pipeline, turns, last_used) | Filterable table | `GET /api/admin/platform/memory/sessions` |
| Session detail panel (turns list, summary) | Slide-in panel | `GET /api/admin/platform/memory/sessions/:id` |
| Delete session button | Action | `DELETE /api/admin/platform/memory/sessions/:id` |
| Force summarise button | Action | `POST /api/admin/platform/memory/sessions/:id/summarise` |
| User profile viewer (userId input → profile JSON) | Form + JSON view | `GET /api/admin/platform/memory/profiles/:userId` |
| Force flush button | Action | `POST /api/admin/platform/memory/flush` |

---

### 13.9 Storage / Assets — `/dashboard/platform/storage`

**Purpose**: Browse and manage generated assets.

| Widget | Type | API |
|--------|------|-----|
| Stats row (total assets, total bytes, by type breakdown) | Stat row | `GET /api/admin/platform/storage/stats` |
| Assets table (pipeline, type, filename, size, created, expires) | Filterable table | `GET /api/admin/platform/storage/assets?pipeline=X&type=Y` |
| Download button per asset | Link | `GET /api/assets/:assetId` (streams file) |
| Delete asset button | Action | `DELETE /api/admin/platform/storage/assets/:assetId` |

---

### 13.10 Observability — `/dashboard/platform/observability`

**Purpose**: Query spans and traces; see system-wide execution health.

| Widget | Type | API |
|--------|------|-----|
| Stats row (totalSpans, errorCount, fallbackCount, avgDurationMs, p95DurationMs) | Stat row | `GET /api/admin/platform/obs/stats` |
| Span query form (filters: pipeline, status, provider, traceId) | Filter form | `GET /api/admin/platform/obs/spans` |
| Span results table (name, pipeline, status, model, provider, durationMs, costUsd, isFallback) | Table | same |
| Trace detail viewer (enter traceId → full tree) | Tree view | `GET /api/admin/platform/obs/traces/:traceId` |
| Event log (filter by level, pipeline) | Log viewer | `GET /api/admin/platform/obs/events` |
| Fallback rate trend | Sparkline | Derived from obs stats |

---

### 13.11 Analytics — `/dashboard/platform/analytics`

**Purpose**: Business event tracking, cost by pipeline, funnel analysis.

| Widget | Type | API |
|--------|------|-----|
| Stats row (totalTracked, counters, pipelines, costs) | Stat row | `GET /api/admin/platform/analytics/stats` |
| Event counter grid (all event names + counts) | Counter grid | `GET /api/admin/platform/analytics/counters` |
| Daily events timeline chart (area chart, 7/14/30 days) | Area chart | `GET /api/admin/platform/analytics/timeline?days=7` |
| Pipeline stats table (pipeline, runs, cost, avg duration) | Sortable table | `GET /api/admin/platform/analytics/pipelines` |
| Cost by model (donut chart) | Donut | `GET /api/admin/platform/analytics/costs` |
| Cost by pipeline (bar chart) | Bar chart | same |
| Recent events table (filter by event name, userId) | Table | `GET /api/admin/platform/analytics/events` |

---

### 13.12 Jobs — `/dashboard/platform/jobs`

**Purpose**: Monitor background job queue in real time.

| Widget | Type | API |
|--------|------|-----|
| Stats row (enqueued, completed, failed, active workers) | Stat row | `GET /api/admin/platform/jobs/stats` |
| Queue depth per queue (pill badges) | Badge row | `GET /api/admin/platform/jobs/queues` |
| Job list table (jobId, queue, status, priority, pipeline, userId, createdAt) | Filterable table | `GET /api/admin/platform/jobs?status=X&queue=Y` |
| Job detail panel (logs, attempts, result, data) | Slide-in panel | `GET /api/admin/platform/jobs/:jobId` |
| Cancel job button | Action | `POST /api/admin/platform/jobs/:jobId/cancel` |
| Retry job button (failed only) | Action | `POST /api/admin/platform/jobs/:jobId/retry` |
| Manual enqueue form (queue, data JSON) | Form | `POST /api/admin/platform/jobs/enqueue` |

---

### 13.13 Settings — `/dashboard/settings`

**Purpose**: Admin controls for the engine (provider keys, model priorities, deploy).

| Widget | Type | API |
|--------|------|-----|
| Provider API key table (provider, key masked, test button) | Table | `GET /api/admin/apiconfig`, `POST /api/admin/apiconfig/:provider/test` |
| Add/remove provider key form | Form | `POST /api/admin/apiconfig`, `DELETE /api/admin/apiconfig/:provider` |
| Model priority editor per task type | Ordered list (drag or move) | `GET /api/admin/models/priority`, `PUT /api/admin/models/priority` |
| Model toggle table | Toggle table | `GET /api/admin/models/whitelist`, `PATCH /api/admin/models/:modelId/toggle` |
| System info (Node version, memory, uptime) | Info card | `GET /api/admin/system` |
| Hot deploy button (branch input) | Form + button | `POST /api/admin/deploy` |
| Admin audit log | Table | `GET /api/admin/audit` |
| Beta quota management | Table | `GET /api/admin/beta/users`, `PATCH /api/admin/beta/quota/:userId` |

---

## SECTION 14 — Dashboard Developer Handoff Summary

### Read these documents first (in order)
1. **`FINAL_ENGINE_STATUS_REPORT.md`** (887 lines) — Complete engine+platform spec. Contains the exact API list, frozen rules, architecture diagram, and deployment details. Read all of it.
2. **`MODULE_SYSTEM_STATUS_REPORT.md`** — Module list, freeze rules, execution flow.
3. **`TOOL_SYSTEM_STATUS_REPORT.md`** — Tool list, freeze rules, execution flow.
4. **`DASHBOARD_HANDOFF.md`** (this file) — The dashboard spec.

### Files that matter most to you
- `dashboard/src/lib/api.ts` — Add new typed API functions here (one function per endpoint)
- `dashboard/src/lib/auth.tsx` — Understand the auth pattern; replicate for Node.js backend auth
- `dashboard/src/app/dashboard/layout.tsx` — Add new nav entries here
- `dashboard/src/app/dashboard/page.tsx` — Copy as the pattern for new pages
- `dashboard/next.config.ts` — Add the Node.js backend rewrite here
- `app/routers/admin.py` — The Python backend source of truth (2385 lines, all API routes)
- `ai-orchestrator/src/routes/admin.js` — The Node.js admin source of truth (1598 lines)

### Files you must never touch
- `ai-orchestrator/src/services/aiConnector.js` — HARD FROZEN
- `ai-orchestrator/src/services/modelRegistry.js` — HARD FROZEN
- `app/modules/types.py` / `base.py` / `registry.py` / `executor.py` — HARD FROZEN
- `app/tools/types.py` / `base.py` / `registry.py` / `executor.py` — HARD FROZEN
- `ai-orchestrator/src/server.js` — Do not modify for dashboard work
- `ai-orchestrator/src/routes/admin.js` — Do not modify (all APIs already exist)

### What can be safely extended
- Everything in `dashboard/` — it is the working directory
- `dashboard/src/lib/api.ts` — add functions freely
- `dashboard/next.config.ts` — add rewrites for Node.js backend
- `app/modules/modules/*.py` — add new module implementations
- `app/tools/tools/*.py` — add new tool implementations
- `app/routers/admin.py` — add new Python API routes if needed (unlikely)

### Whether to extend or rebuild
**Extend `dashboard/` — do not rebuild.** The auth, routing, API client, component patterns,
and all 11 existing pages are solid. You are adding 13 new pages, not replacing 11 existing ones.

### Where to start first

**Day 1 — Setup (2 hours):**
1. Add Node.js backend rewrite to `next.config.ts`: `/orch/:path*` → `https://144.172.93.226/api/:path*`
2. Add `orchApiFetch()` helper in `lib/api.ts` that injects the Node.js JWT token
3. Add `POST /api/auth/login` call for Node.js backend auth, store as `orch_token` in localStorage
4. Confirm you can call `GET /orch/health` and get `{status:"ok"}`

**Day 1 — First page (4 hours):**
5. Add `/dashboard/platform` overview page — uses `GET /orch/admin/platform/status` — this single API returns all 5 engine stats in one call, giving you an instant win with real data
6. Add the nav entries to `layout.tsx`

**Day 2 — Platform pages (full day):**
7. Build `/dashboard/platform/jobs` — most operators will want this immediately
8. Build `/dashboard/platform/analytics` — counters + timeline chart

**Day 3+ — Engine pages:**
9. Build `/dashboard/engine` + `/dashboard/engine/models` + `/dashboard/engine/health`

**Day 4+ — Remaining platform pages:**
10. Build memory, storage, observability pages

**Day 5+ — Settings page:**
11. Build `/dashboard/settings` — provider key management + deploy button

### Auth credentials for Node.js backend
```
URL:      https://144.172.93.226
Login:    POST /api/auth/login
Email:    admin@ai-orch.local
Password: AiOrch2026!Secure
Token:    Store as localStorage "orch_token"
Header:   Authorization: Bearer <orch_token>
```

### Auth credentials for Python backend (already working)
```
URL:      http://api:8000  (Docker) or http://localhost:8000 (local)
Login:    POST /admin/auth/login
Email:    admin@kbeauty.local
Password: (set in .env.production)
Token:    Already handled by lib/auth.tsx as "admin_token"
```

### Tech stack (already installed — no new packages needed)
- Next.js 15, React 19, TypeScript
- Tailwind CSS (utility classes for layout)
- Recharts (charts — AreaChart, BarChart, LineChart, PieChart all available)
- Radix UI (Dialog, DropdownMenu, Label, Select, Toast — all available)
- Lucide React (icons)
- Axios (available but the existing code uses native fetch — be consistent)

---

## SECTION 15 — Final One-Line Conclusion

> **The entire AI engine + module + tool + platform backend is complete and live at `144.172.93.226`; extend `dashboard/` with 13 new typed Next.js pages wired to the 40+ admin/platform APIs that already exist — no backend work required.**
