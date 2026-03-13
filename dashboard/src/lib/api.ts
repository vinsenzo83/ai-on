/**
 * lib/api.ts — Typed API client for the KBeauty Admin backend.
 * All requests inject the stored JWT token automatically.
 */

const API_BASE =
  typeof window !== "undefined"
    ? ""  // browser: use rewrites → /api/...
    : (process.env.API_URL ?? "http://api:8000"); // SSR: direct to api service

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("admin_token");
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = API_BASE ? `${API_BASE}${path}` : path;
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("admin_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe(): Promise<{ email: string; role: string }> {
  return apiFetch("/admin/auth/me");
}

// ── Dashboard KPI ─────────────────────────────────────────────────────────────
export interface KPI {
  orders_today: number;
  revenue_today: number;
  avg_margin_pct: number;
  failed_today: number;
  tracking_stale_count: number;
  open_tickets_count: number;
}

export async function getKPI(): Promise<KPI> {
  return apiFetch("/admin/dashboard/kpi");
}

export interface Alerts {
  tracking_stale: Array<{ order_id: string; placed_at: string; supplier_order_id: string }>;
  margin_guard_violations: Array<{ order_id: string; margin_pct: number }>;
  bot_failures_last_hour: number;
  queue_backlog: number | null;
}

export async function getAlerts(): Promise<Alerts> {
  return apiFetch("/admin/dashboard/alerts");
}

export interface ChartRow {
  date: string;
  orders: number;
  revenue: number;
}

export async function getChart(days = 7): Promise<ChartRow[]> {
  return apiFetch(`/admin/dashboard/chart?days=${days}`);
}

// ── Orders ────────────────────────────────────────────────────────────────────
export interface OrderItem {
  id: string;
  shopify_order_id: string;
  email: string;
  total_price: string;
  currency: string;
  financial_status: string;
  status: string;
  supplier: string;
  supplier_order_id: string | null;
  placed_at: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  fail_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrdersResponse {
  total: number;
  page: number;
  page_size: number;
  items: OrderItem[];
}

export async function listOrders(params: {
  status?: string;
  supplier?: string;
  q?: string;
  page?: number;
  page_size?: number;
}): Promise<OrdersResponse> {
  const sp = new URLSearchParams();
  if (params.status)    sp.set("status",    params.status);
  if (params.supplier)  sp.set("supplier",  params.supplier);
  if (params.q)         sp.set("q",         params.q);
  if (params.page)      sp.set("page",      String(params.page));
  if (params.page_size) sp.set("page_size", String(params.page_size));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/orders${qs}`);
}

export async function getOrder(id: string): Promise<OrderItem & {
  shipping_address: Record<string, unknown>;
  line_items: unknown[];
  events: Array<{ id: string; source: string; event_type: string; note: string; created_at: string }>;
  artifacts: string[];
}> {
  return apiFetch(`/admin/orders/${id}`);
}

export async function retryPlace(orderId: string): Promise<void> {
  return apiFetch(`/admin/orders/${orderId}/retry-place`, { method: "POST" });
}

export async function forceTracking(orderId: string): Promise<void> {
  return apiFetch(`/admin/orders/${orderId}/force-tracking`, { method: "POST" });
}

export async function cancelRefund(orderId: string): Promise<void> {
  return apiFetch(`/admin/orders/${orderId}/cancel-refund`, { method: "POST" });
}

export async function createTicket(
  orderId: string,
  body: { type: string; subject?: string; note?: string }
): Promise<{ ticket_id: string }> {
  return apiFetch(`/admin/orders/${orderId}/create-ticket`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Tickets ───────────────────────────────────────────────────────────────────
export interface TicketItem {
  id: string;
  order_id: string | null;
  type: string;
  status: string;
  subject: string | null;
  created_by: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface TicketsResponse {
  total: number;
  page: number;
  page_size: number;
  items: TicketItem[];
}

export async function listTickets(params?: {
  status?: string;
  type?: string;
  q?: string;
  page?: number;
}): Promise<TicketsResponse> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.type)   sp.set("type",   params.type);
  if (params?.q)      sp.set("q",      params.q);
  if (params?.page)   sp.set("page",   String(params.page));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/tickets${qs}`);
}

export async function closeTicket(id: string): Promise<void> {
  return apiFetch(`/admin/tickets/${id}/close`, { method: "POST" });
}

// ── Health ────────────────────────────────────────────────────────────────────
export interface HealthResponse {
  db_ok: boolean;
  redis_ok: boolean;
  queue_depth: number | null;
  recent_failures_24h: Array<{ event_type: string; count: number }>;
}

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch("/admin/health");
}

// ── Metrics ───────────────────────────────────────────────────────────────────
export interface MetricsResponse {
  orders_today: number;
  pending:      number;
  processing:   number;
  failed:       number;
  shipped:      number;
  canceled:     number;
  total:        number;
}

export async function getMetrics(): Promise<MetricsResponse> {
  return apiFetch("/admin/metrics");
}

// ── Sprint 12: Publish Pipeline ───────────────────────────────────────────────
export interface PublishPreviewItem {
  canonical_product_id: string;
  canonical_sku: string;
  name: string;
  brand: string | null;
  last_price: number | null;
  pricing_enabled: boolean;
  in_stock_suppliers: number;
  has_shopify_mapping: boolean;
  shopify_product_id: string | null;
}

export interface PublishJobItem {
  id: string;
  canonical_product_id: string;
  shopify_product_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishJob {
  id: string;
  channel: string;
  status: string;
  dry_run: boolean;
  target_count: number;
  published_count: number;
  failed_count: number;
  skipped_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items?: PublishJobItem[];
}

export async function getPublishPreview(limit = 20): Promise<{ total: number; items: PublishPreviewItem[] }> {
  return apiFetch(`/admin/publish/preview?limit=${limit}`);
}

export async function triggerPublish(limit = 20, dryRun = true): Promise<{ message: string; task_id: string; dry_run: boolean; limit: number }> {
  return apiFetch(`/admin/publish/shopify?limit=${limit}&dry_run=${dryRun}`, { method: "POST" });
}

export async function listPublishJobs(limit = 50): Promise<{ total: number; items: PublishJob[] }> {
  return apiFetch(`/admin/publish/jobs?limit=${limit}`);
}

export async function getPublishJob(jobId: string): Promise<PublishJob> {
  return apiFetch(`/admin/publish/jobs/${jobId}`);
}

// ── Sprint 13: Market Price Intelligence + Repricing ─────────────────────────
export interface CompetitorBand {
  min_price: number | null;
  median_price: number | null;
  max_price: number | null;
  sample_count: number;
}

export interface RepricingPreviewItem {
  canonical_product_id: string;
  canonical_sku: string;
  name: string;
  brand: string | null;
  skip_reason: string | null;
  supplier_cost: number | null;
  recommended_price: number | null;
  base_price: number | null;
  current_price: number | null;
  delta: number | null;
  expected_margin_pct: number | null;
  repricing_reason: string | null;
  competitor_min: number | null;
  competitor_median: number | null;
  competitor_max: number | null;
  competitor_samples: number;
}

export interface RepricingRun {
  id: string;
  channel: string;
  status: string;
  dry_run: boolean;
  target_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  notes: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    canonical_product_id: string;
    old_price: number | null;
    recommended_price: number | null;
    applied_price: number | null;
    status: string;
    reason: string | null;
    updated_at: string;
  }>;
}

export async function getRepricingPreview(limit = 50): Promise<{ total: number; items: RepricingPreviewItem[] }> {
  return apiFetch(`/admin/repricing/preview?limit=${limit}`);
}

export async function triggerRepricing(limit = 50, dryRun = true): Promise<{ message: string; task_id: string; dry_run: boolean }> {
  return apiFetch(`/admin/repricing/apply?limit=${limit}&dry_run=${dryRun}`, { method: "POST" });
}

export async function listRepricingRuns(limit = 50): Promise<{ total: number; items: RepricingRun[] }> {
  return apiFetch(`/admin/repricing/runs?limit=${limit}`);
}

export async function getRepricingRun(runId: string): Promise<RepricingRun> {
  return apiFetch(`/admin/repricing/runs/${runId}`);
}

export async function addMarketPrice(body: {
  canonical_product_id: string;
  source: string;
  price: number;
  currency?: string;
  in_stock?: boolean;
  external_url?: string;
}): Promise<{ id: string; price: number }> {
  return apiFetch("/admin/market-prices", { method: "POST", body: JSON.stringify(body) });
}

// ── Sprint 14: Supplier Orders / Auto-Fulfillment ─────────────────────────────
export interface SupplierOrderItem {
  id: string;
  channel_order_id: string;
  supplier: string;
  supplier_order_id: string | null;
  supplier_status: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  cost: number | null;
  currency: string | null;
  status: string;
  failure_reason: string | null;
  retry_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupplierOrdersResponse {
  total: number;
  items: SupplierOrderItem[];
}

export async function listSupplierOrders(params?: {
  status?: string;
  supplier?: string;
  limit?: number;
}): Promise<SupplierOrdersResponse> {
  const sp = new URLSearchParams();
  if (params?.status)   sp.set("status",   params.status);
  if (params?.supplier) sp.set("supplier", params.supplier);
  if (params?.limit)    sp.set("limit",    String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/supplier-orders${qs}`);
}

export async function getSupplierOrder(id: string): Promise<SupplierOrderItem> {
  return apiFetch(`/admin/supplier-orders/${id}`);
}

export async function triggerFulfillment(
  channelOrderId: string,
  dryRun = false
): Promise<{ message: string; task_id: string; channel_order_id: string; dry_run: boolean; note: string }> {
  return apiFetch(
    `/admin/supplier-orders/trigger/${channelOrderId}?dry_run=${dryRun}`,
    { method: "POST" }
  );
}

// ── Sprint 16: Operational Observability ─────────────────────────────────────
export interface KpiSnapshot {
  window_minutes: number;
  collected_at: string;
  total_order_count: number;
  pending_order_count: number;
  order_error_rate: number;
  supplier_order_count: number;
  fulfillment_error_count: number;
  fulfillment_error_rate: number;
  avg_fulfillment_hours: number;
  repricing_run_count: number;
  repricing_updated_count: number;
  repricing_error_count: number;
  publish_job_count: number;
  publish_success_count: number;
  publish_failure_count: number;
  discovery_candidate_count: number;
  market_price_count: number;
  recent_errors: Array<{
    type: string;
    id: string;
    reason: string;
    supplier?: string;
    ts: string | null;
  }>;
}

export async function getOpsKpis(windowMinutes = 60): Promise<KpiSnapshot> {
  return apiFetch(`/admin/ops/kpis?window_minutes=${windowMinutes}`);
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  rule_name: string;
  metric: string;
  observed_value: number;
  threshold: number;
  severity: string;
  status: string;
  notes: string | null;
  fired_at: string | null;
  resolved_at: string | null;
}

export interface AlertsResponse {
  total: number;
  items: AlertEvent[];
}

export async function listAlertEvents(params?: {
  status?: string;
  severity?: string;
  limit?: number;
}): Promise<AlertsResponse> {
  const sp = new URLSearchParams();
  if (params?.status)   sp.set("status",   params.status);
  if (params?.severity) sp.set("severity", params.severity);
  if (params?.limit)    sp.set("limit",    String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/ops/alerts${qs}`);
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  return apiFetch(`/admin/ops/alerts/${alertId}/acknowledge`, { method: "POST" });
}

export async function resolveAlert(alertId: string): Promise<void> {
  return apiFetch(`/admin/ops/alerts/${alertId}/resolve`, { method: "POST" });
}

// ── Sprint 17: AI Discovery Engine v2 ────────────────────────────────────────
export interface CandidateV2 {
  id: string;
  canonical_product_id: string;
  canonical_sku?: string | null;
  name?: string | null;
  brand?: string | null;
  last_price?: number | null;
  score: number;
  amazon_rank_score: number;
  supplier_rank_score: number;
  margin_score: number;
  review_score: number;
  competition_score: number;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CandidatesV2Response {
  total: number;
  items: CandidateV2[];
}

export async function listCandidatesV2(params?: {
  status?: string;
  limit?: number;
}): Promise<CandidatesV2Response> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.limit)  sp.set("limit",  String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/discovery/v2/candidates${qs}`);
}

export interface DiscoveryV2RunResult {
  dry_run: boolean;
  candidates_generated: number;
  top_n: number;
  top_candidates: CandidateV2[];
}

export async function runDiscoveryV2(
  limit = 20,
  dryRun = true
): Promise<DiscoveryV2RunResult> {
  return apiFetch(
    `/admin/discovery/v2/run?limit=${limit}&dry_run=${dryRun}`,
    { method: "POST" }
  );
}

export async function rejectCandidateV2(
  candidateId: string,
  reason?: string
): Promise<void> {
  const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return apiFetch(
    `/admin/discovery/v2/candidates/${candidateId}/reject${qs}`,
    { method: "POST" }
  );
}

// ── Sprint 18: Trend Signal v2 ────────────────────────────────────────────────
export interface TrendSource {
  id: string;
  source: string;
  name: string;
  is_enabled: boolean;
  created_at: string | null;
}

export interface TrendItem {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  rank: number | null;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  observed_at: string | null;
}

export interface MentionSignal {
  id: string;
  canonical_product_id: string;
  source_id: string;
  mentions: number;
  velocity: number | null;
  score: number | null;
  observed_at: string | null;
}

export async function listTrendSources(): Promise<{ sources: TrendSource[]; total: number }> {
  return apiFetch("/admin/trends/v2/sources");
}

export async function listTrendItems(params?: {
  source?: string;
  limit?: number;
}): Promise<{ items: TrendItem[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.source) sp.set("source", params.source);
  if (params?.limit)  sp.set("limit",  String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/trends/v2/items${qs}`);
}

export async function listMentionSignals(params?: {
  limit?: number;
}): Promise<{ mentions: MentionSignal[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetch(`/admin/trends/v2/mentions${qs}`);
}

export async function runTrendsV2(
  dryRun = true,
  limit = 200
): Promise<{ task_id: string; dry_run: boolean; limit: number; status: string; message: string }> {
  return apiFetch(
    `/admin/trends/v2/run?dry_run=${dryRun}&limit=${limit}`,
    { method: "POST" }
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Node.js AI Orchestrator API  (Phase 13–16)
// Endpoint base: /api/admin/*  →  next.config.ts rewrites → AI_API_URL
// Token key: "admin_token"  (same localStorage key, but different backend)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * apiFetchAI — identical to apiFetch but targets /api/admin/* which is
 * rewritten to the Node.js AI Orchestrator by next.config.ts.
 */
async function apiFetchAI<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Always use relative path so Next.js rewrites forward to the AI backend
  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("admin_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

// ── Phase 16: Overview / Stats ────────────────────────────────────────────────
export interface AiOverview {
  totalUsers: number;
  totalRequests: number;
  activeUsers30d: number;
  activeUsers7d: number;
  pendingInvites: number;
}

export interface AiJobStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface AiCostSummary {
  total: number;
  inputs: number;
  outputs: number;
  calls: number;
}

export interface AiStatsResponse {
  success: boolean;
  overview: AiOverview & {
    totalCostUsd: number;
    totalTokens: number;
    totalApiCalls: number;
  } & AiJobStats;
  jobStats: AiJobStats;
  costByModel: Array<{ model: string; calls: number; total_cost: number; input_tokens: number; output_tokens: number }>;
  hourly: Array<{ hour: string; calls: number; total_cost: number }>;
  recentUsers: Array<{ id: string; email: string; role: string; created_at: string }>;
  recentJobs: Array<{ id: string; status: string; pipeline: string; created_at: string }>;
  serverTime: string;
}

export async function getAiStats(): Promise<AiStatsResponse> {
  return apiFetchAI("/api/admin/stats");
}

// ── Phase 16: Provider Health ─────────────────────────────────────────────────
export interface ProviderHealth {
  provider: string;
  configured: boolean;
  clientReady: boolean;
  enabledModels: string[];
  latestCheck: {
    status: string;
    latency_ms: number | null;
    error_code: string | null;
    error_msg: string | null;
    checked_at: string;
  } | null;
  uptimePct: number | null;
  avgLatency: number | null;
  calls24h: number;
  successRate24h: number | null;
  totalCost24h: number;
  totalTokens24h: number;
}

export interface HealthDashboardResponse {
  success: boolean;
  period: string;
  summary: {
    totalProviders: number;
    configured: number;
    totalCalls24h: number;
    totalCost24h: number;
  };
  providers: Record<string, ProviderHealth>;
}

export async function getAiHealthDashboard(hours = 24): Promise<HealthDashboardResponse> {
  return apiFetchAI(`/api/admin/health/dashboard?hours=${hours}`);
}

export interface HealthErrorCategory {
  category: string;
  count: number;
  providers: string[];
  codes: string[];
  description: string;
}

export interface HealthErrorsResponse {
  success: boolean;
  period: string;
  totalErrors: number;
  categories: HealthErrorCategory[];
}

export async function getAiHealthErrors(days = 7): Promise<HealthErrorsResponse> {
  return apiFetchAI(`/api/admin/health/errors?days=${days}`);
}

export async function runAiHealthCheck(): Promise<{ success: boolean; results: Record<string, unknown> }> {
  return apiFetchAI("/api/admin/health/check", { method: "POST" });
}

// ── Phase 16: Cost Analysis ───────────────────────────────────────────────────
export interface AiCostRecord {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
  calls: number;
  created_at: string;
}

export interface AiCostResponse {
  success: boolean;
  summary: { total: number; inputs: number; outputs: number; calls: number };
  daily: Array<{ date: string; total_cost: number; calls: number; input_tokens: number; output_tokens: number }>;
  monthly: Array<{ month: string; total_cost: number; calls: number }>;
  byModel: Array<{ model: string; provider: string; calls: number; total_cost: number; input_tokens: number; output_tokens: number }>;
}

export async function getAiCosts(): Promise<AiCostResponse> {
  return apiFetchAI("/api/admin/costs");
}

export interface AiAnalyticsCosts {
  success: boolean;
  costs: {
    totalCostUsd: number;
    totalTokens: number;
    totalCalls: number;
    byModel: Array<{ model: string; cost: number; tokens: number; calls: number }>;
  };
}

export async function getAiAnalyticsCosts(): Promise<AiAnalyticsCosts> {
  return apiFetchAI("/api/admin/platform/analytics/costs");
}

// ── Phase 16: Job Queue (Platform) ────────────────────────────────────────────
export interface AiJob {
  id: string;
  queueName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  priority: number;
  pipeline: string | null;
  userId: string | null;
  data: Record<string, unknown>;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
}

export interface AiJobsResponse {
  success: boolean;
  count: number;
  jobs: AiJob[];
}

export interface AiJobQueueStats {
  success: boolean;
  stats: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    queues: Record<string, number>;
  };
}

export async function getAiJobStats(): Promise<AiJobQueueStats> {
  return apiFetchAI("/api/admin/platform/jobs/stats");
}

export async function listAiJobs(params?: {
  status?: string;
  queueName?: string;
  userId?: string;
  pipeline?: string;
  limit?: number;
}): Promise<AiJobsResponse> {
  const sp = new URLSearchParams();
  if (params?.status)    sp.set("status",    params.status);
  if (params?.queueName) sp.set("queueName", params.queueName);
  if (params?.userId)    sp.set("userId",    params.userId);
  if (params?.pipeline)  sp.set("pipeline",  params.pipeline);
  if (params?.limit)     sp.set("limit",     String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetchAI(`/api/admin/platform/jobs${qs}`);
}

export async function getAiJob(jobId: string): Promise<{ success: boolean; job: AiJob }> {
  return apiFetchAI(`/api/admin/platform/jobs/${jobId}`);
}

export async function cancelAiJob(jobId: string): Promise<{ success: boolean; cancelled: boolean }> {
  return apiFetchAI(`/api/admin/platform/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function retryAiJob(jobId: string): Promise<{ success: boolean; job: AiJob }> {
  return apiFetchAI(`/api/admin/platform/jobs/${jobId}/retry`, { method: "POST" });
}

export async function enqueueAiJob(body: {
  queueName: string;
  data?: Record<string, unknown>;
  priority?: number;
  userId?: string;
  pipeline?: string;
}): Promise<{ success: boolean; job: AiJob }> {
  return apiFetchAI("/api/admin/platform/jobs/enqueue", { method: "POST", body: JSON.stringify(body) });
}

// ── Phase 16: Inference Stats ─────────────────────────────────────────────────
export interface InferenceStatsByProvider {
  provider: string;
  total: number;
  real_success: number;
  fallback_success: number;
  errors: number;
}

export interface InferenceStatsResponse {
  success: boolean;
  period: string;
  summary: {
    total: number;
    realSuccess: number;
    fallbackSuccess: number;
    errors: number;
    realPct: number;
    fallbackPct: number;
  };
  byProvider: InferenceStatsByProvider[];
}

export async function getAiInferenceStats(days = 7): Promise<InferenceStatsResponse> {
  return apiFetchAI(`/api/admin/inference/stats?days=${days}`);
}

export interface InferenceSummaryResponse {
  success: boolean;
  pipelines: Array<{ pipeline: string; total: number; success: number; errors: number }>;
  combos: Array<{ pipeline: string; provider: string; model: string; calls: number }>;
}

export async function getAiInferenceSummary(params?: {
  pipeline?: string;
  from?: string;
}): Promise<InferenceSummaryResponse> {
  const sp = new URLSearchParams();
  if (params?.pipeline) sp.set("pipeline", params.pipeline);
  if (params?.from)     sp.set("from",     params.from);
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetchAI(`/api/admin/inference/summary${qs}`);
}

export interface InferenceLogRow {
  id: string;
  pipeline: string;
  provider: string;
  model: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  is_fallback: boolean;
  error_code: string | null;
  created_at: string;
}

export async function listAiInferenceLogs(params?: {
  pipeline?: string;
  limit?: number;
}): Promise<{ success: boolean; total: number; rows: InferenceLogRow[] }> {
  const sp = new URLSearchParams();
  if (params?.pipeline) sp.set("pipeline", params.pipeline);
  if (params?.limit)    sp.set("limit",    String(params.limit));
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  return apiFetchAI(`/api/admin/inference/recent${qs}`);
}

// ── Phase 16: Platform Status ─────────────────────────────────────────────────
export interface PlatformEngineStats {
  sessions?: number;
  profiles?: number;
  totalMessages?: number;
  assets?: number;
  totalSize?: number;
  spans?: number;
  events?: number;
  trackedEvents?: number;
  counters?: number;
  pipelines?: number;
  totalCostUsd?: number;
  pendingJobs?: number;
  runningJobs?: number;
  completedJobs?: number;
  failedJobs?: number;
  queues?: number;
  [key: string]: unknown;
}

export interface PlatformStatusResponse {
  success: boolean;
  ts: string;
  platform: {
    memory: PlatformEngineStats;
    storage: PlatformEngineStats;
    observability: PlatformEngineStats;
    analytics: PlatformEngineStats;
    jobs: PlatformEngineStats;
  };
}

export async function getAiPlatformStatus(): Promise<PlatformStatusResponse> {
  return apiFetchAI("/api/admin/platform/status");
}

export interface PlatformAnalyticsStats {
  success: boolean;
  stats: {
    trackedEvents: number;
    counters: number;
    pipelines: number;
    totalCostUsd: number;
  };
}

export async function getAiPlatformAnalytics(): Promise<PlatformAnalyticsStats> {
  return apiFetchAI("/api/admin/platform/analytics/stats");
}

export interface PlatformAnalyticsTimeline {
  success: boolean;
  timeline: Array<{ date: string; count: number; eventName?: string }>;
}

export async function getAiAnalyticsTimeline(days = 7, event?: string): Promise<PlatformAnalyticsTimeline> {
  const sp = new URLSearchParams({ days: String(days) });
  if (event) sp.set("event", event);
  return apiFetchAI(`/api/admin/platform/analytics/timeline?${sp.toString()}`);
}

// ── Phase 16: Users ───────────────────────────────────────────────────────────
export interface AiUser {
  id: string;
  email: string;
  role: string;
  plan: string | null;
  created_at: string;
  last_active?: string | null;
}

export async function listAiUsers(q?: string): Promise<{ success: boolean; users: AiUser[] }> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetchAI(`/api/admin/users${qs}`);
}

export async function updateAiUserRole(
  userId: string,
  role: string
): Promise<{ success: boolean; user: AiUser }> {
  return apiFetchAI(`/api/admin/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

// ── Phase 16: Model Config ────────────────────────────────────────────────────
export interface ApiProviderConfig {
  provider: string;
  configured: boolean;
  models: string[];
  baseUrl?: string | null;
}

export async function listAiApiConfigs(): Promise<{ success: boolean; providers: ApiProviderConfig[] }> {
  return apiFetchAI("/api/admin/apiconfig");
}

export interface ModelWhitelistEntry {
  modelId: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  budgetUsd: number | null;
  contextWindow: number | null;
  inputCostPer1k: number | null;
  outputCostPer1k: number | null;
}

export async function getModelWhitelist(): Promise<{ success: boolean; models: ModelWhitelistEntry[] }> {
  return apiFetchAI("/api/admin/models/whitelist");
}

export async function toggleModel(
  modelId: string,
  enabled: boolean
): Promise<{ success: boolean }> {
  return apiFetchAI(`/api/admin/models/${modelId}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export interface ModelPriority {
  task: string;
  primary: string;
  fallback: string[];
}

export async function getModelPriority(): Promise<{ success: boolean; priorities: ModelPriority[] }> {
  return apiFetchAI("/api/admin/models/priority");
}

export async function getAiModelStats(): Promise<{
  success: boolean;
  stats: Array<{
    provider: string;
    model: string;
    total_calls: number;
    success_rate: number;
    avg_latency_ms: number;
    total_cost_usd: number;
  }>;
}> {
  return apiFetchAI("/api/admin/models/stats");
}

// ── Phase 16: System Info ─────────────────────────────────────────────────────
export interface AiSystemInfo {
  success: boolean;
  system: {
    uptime: number;
    memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
    cpu: { user: number; system: number };
    platform: string;
    nodeVersion: string;
    pid: number;
  };
  env: string;
}

export async function getAiSystemInfo(): Promise<AiSystemInfo> {
  return apiFetchAI("/api/admin/system");
}
