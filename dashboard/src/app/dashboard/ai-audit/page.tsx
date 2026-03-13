"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  listAiAuditLogs,
  listAiInferenceLogs,
  listAiJobs,
  type AiAuditLog,
  type InferenceLogRow,
  type AiJob,
} from "@/lib/api";

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR");
}
function fmtDateShort(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}
function fmtCost(n: number | null) {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(6)}`;
}

// ── Audit action → category mapping ──────────────────────────────────────────

function categorizeAction(action: string): { category: string; color: string } {
  if (action.includes("login") || action.includes("auth"))
    return { category: "AUTH", color: "bg-blue-100 text-blue-700" };
  if (action.includes("delete") || action.includes("remove"))
    return { category: "DELETE", color: "bg-red-100 text-red-700" };
  if (action.includes("create") || action.includes("add") || action.includes("seed"))
    return { category: "CREATE", color: "bg-green-100 text-green-700" };
  if (action.includes("update") || action.includes("change") || action.includes("role") || action.includes("password"))
    return { category: "UPDATE", color: "bg-yellow-100 text-yellow-700" };
  if (action.includes("broadcast"))
    return { category: "BROADCAST", color: "bg-purple-100 text-purple-700" };
  if (action.includes("deploy"))
    return { category: "DEPLOY", color: "bg-orange-100 text-orange-700" };
  if (action.includes("clear") || action.includes("flush"))
    return { category: "BULK-OP", color: "bg-red-100 text-red-700" };
  if (action.includes("pipeline"))
    return { category: "PIPELINE", color: "bg-teal-100 text-teal-700" };
  return { category: "ADMIN", color: "bg-slate-100 text-slate-600" };
}

// ── Components ────────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const { category, color } = categorizeAction(action);
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>{category}</span>
  );
}

function InferenceStatusBadge({ status, isFallback }: { status: string; isFallback: boolean }) {
  const base = status === "success"
    ? "bg-green-100 text-green-700"
    : "bg-red-100 text-red-700";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${base}`}>
      {status}{isFallback ? " (↩FB)" : ""}
    </span>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    waiting:   "bg-yellow-100 text-yellow-700",
    running:   "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed:    "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

// ── Audit Log Detail Drawer ───────────────────────────────────────────────────

function AuditDrawer({ log, onClose }: { log: AiAuditLog; onClose: () => void }) {
  const details = parseDetails(log.details);
  const { category, color } = categorizeAction(log.action);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-[460px] bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>{category}</span>
            <h2 className="font-bold text-slate-800 font-mono text-sm truncate max-w-[280px]">
              {log.action}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Timestamp</p>
              <p className="text-xs font-medium text-slate-700">{fmtDate(log.created_at)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">IP Address</p>
              <p className="text-xs font-mono text-slate-700">{log.ip || "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">User ID</p>
              <p className="text-xs font-mono text-slate-700 break-all">
                {log.user_id ?? "System / Anonymous"}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Resource</p>
              <p className="text-xs font-medium text-slate-700">{log.resource ?? "—"}</p>
            </div>
          </div>

          {/* Action */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Action</p>
            <code className="block bg-slate-900 text-green-400 text-xs rounded-lg p-3 break-all">
              {log.action}
            </code>
          </div>

          {/* Details */}
          {log.details && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Details</p>
              {details ? (
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-auto max-h-64 text-slate-700">
                  {JSON.stringify(details, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3">{log.details}</p>
              )}
            </div>
          )}

          {/* Danger indicator */}
          {["delete", "reset_password", "clear", "flush", "deploy"].some(k =>
            log.action.includes(k)
          ) && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-600">⚠ Dangerous Operation</p>
              <p className="text-xs text-red-500 mt-0.5">
                This action was classified as a destructive or sensitive operation.
              </p>
            </div>
          )}

          {/* Audit ID */}
          <div className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            Audit ID: <code className="font-mono">{log.id}</code>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── Inference Log Drawer ──────────────────────────────────────────────────────

function InferenceDrawer({ row, onClose }: { row: InferenceLogRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-[420px] bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">Inference Detail</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Pipeline",  row.pipeline],
              ["Provider",  row.provider],
              ["Model",     row.model],
              ["Status",    row.status],
              ["Latency",   row.latency_ms ? `${row.latency_ms}ms` : "—"],
              ["Cost",      fmtCost(row.cost_usd)],
              ["In Tokens", String(row.input_tokens ?? "—")],
              ["Out Tokens",String(row.output_tokens ?? "—")],
              ["Fallback",  row.is_fallback ? "Yes ↩" : "No"],
              ["Error",     row.error_code ?? "—"],
            ].map(([label, val]) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className="text-xs font-medium text-slate-700">{val}</p>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            {fmtDate(row.created_at)}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = "audit" | "inference" | "jobs";

export default function AiAuditPage() {
  const [auditLogs, setAuditLogs]       = useState<AiAuditLog[]>([]);
  const [infLogs, setInfLogs]           = useState<InferenceLogRow[]>([]);
  const [jobLogs, setJobLogs]           = useState<AiJob[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [tab, setTab]                   = useState<TabKey>("audit");

  // Audit filters (client-side — no server-side filter endpoint)
  const [filterUser, setFilterUser]     = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResource, setRes]        = useState("");
  const [filterCategory, setCategory]   = useState("all");
  const [filterDateFrom, setFrom]       = useState("");
  const [filterDateTo, setTo]           = useState("");

  // Inference filters
  const [infPipeline, setInfPipeline]   = useState("");
  const [infProvider, setInfProvider]   = useState("");
  const [infStatus, setInfStatus]       = useState("all");
  const [infFallback, setInfFallback]   = useState("all");

  // Job filters
  const [jobStatus, setJobStatus]       = useState("all");
  const [jobPipeline, setJobPipeline]   = useState("");

  // Detail drawers
  const [selectedAudit, setSelAudit]    = useState<AiAuditLog | null>(null);
  const [selectedInf, setSelInf]        = useState<InferenceLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, inf, jl] = await Promise.all([
        listAiAuditLogs(500),
        listAiInferenceLogs({ limit: 200 }),
        listAiJobs({ limit: 200 }),
      ]);
      setAuditLogs(a.logs);
      setInfLogs(inf.rows);
      setJobLogs(jl.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtered audit logs ────────────────────────────────────────────────────
  const filteredAudit = useMemo(() => {
    return auditLogs.filter((log) => {
      if (filterUser && !(log.user_id ?? "").toLowerCase().includes(filterUser.toLowerCase())) return false;
      if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) return false;
      if (filterResource && !(log.resource ?? "").toLowerCase().includes(filterResource.toLowerCase())) return false;
      if (filterCategory !== "all" && categorizeAction(log.action).category !== filterCategory) return false;
      if (filterDateFrom && log.created_at < filterDateFrom) return false;
      if (filterDateTo   && log.created_at > filterDateTo + "T23:59:59") return false;
      return true;
    });
  }, [auditLogs, filterUser, filterAction, filterResource, filterCategory, filterDateFrom, filterDateTo]);

  // ── Filtered inference logs ───────────────────────────────────────────────
  const filteredInf = useMemo(() => {
    return infLogs.filter((row) => {
      if (infPipeline && !row.pipeline.toLowerCase().includes(infPipeline.toLowerCase())) return false;
      if (infProvider  && !row.provider.toLowerCase().includes(infProvider.toLowerCase())) return false;
      if (infStatus !== "all" && row.status !== infStatus) return false;
      if (infFallback === "yes" && !row.is_fallback) return false;
      if (infFallback === "no"  &&  row.is_fallback) return false;
      return true;
    });
  }, [infLogs, infPipeline, infProvider, infStatus, infFallback]);

  // ── Filtered job logs ─────────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    return jobLogs.filter((j) => {
      if (jobStatus !== "all" && j.status !== jobStatus) return false;
      if (jobPipeline && !(j.pipeline ?? "").toLowerCase().includes(jobPipeline.toLowerCase())) return false;
      return true;
    });
  }, [jobLogs, jobStatus, jobPipeline]);

  // ── Category options from data ────────────────────────────────────────────
  const categories = useMemo(() => {
    const set = new Set(auditLogs.map((l) => categorizeAction(l.action).category));
    return ["all", ...Array.from(set).sort()];
  }, [auditLogs]);

  // ── Timeline for last 24h audit ───────────────────────────────────────────
  const timeline24h = useMemo(() => {
    const now = Date.now();
    const buckets: Record<string, number> = {};
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now - i * 3600_000);
      const key = `${String(h.getHours()).padStart(2, "0")}:00`;
      buckets[key] = 0;
    }
    auditLogs.forEach((log) => {
      const ts = new Date(log.created_at).getTime();
      if (now - ts <= 86400_000) {
        const h = new Date(ts);
        const key = `${String(h.getHours()).padStart(2, "0")}:00`;
        if (key in buckets) buckets[key]++;
      }
    });
    return Object.entries(buckets);
  }, [auditLogs]);

  const maxBucket = Math.max(...timeline24h.map(([, v]) => v), 1);

  // Tab labels with counts
  const tabLabels: Record<TabKey, string> = {
    audit:     `📋 Audit Logs (${auditLogs.length})`,
    inference: `🧠 Inference History (${infLogs.length})`,
    jobs:      `⚙️ Job History (${jobLogs.length})`,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">📋 Audit Log & Execution History</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Full operational trail · {auditLogs.length} audit events · {infLogs.length} inference logs
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* 24h Activity Timeline (Audit) */}
      {timeline24h.length > 0 && auditLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Audit Activity — Last 24 Hours</h3>
          <div className="flex items-end gap-0.5 h-16">
            {timeline24h.map(([hour, count]) => (
              <div
                key={hour}
                className="flex-1 bg-blue-500 rounded-t opacity-80 hover:opacity-100 cursor-pointer min-w-0 transition"
                style={{ height: `${Math.max((count / maxBucket) * 100, count > 0 ? 4 : 0)}%` }}
                title={`${hour}: ${count} events`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>00:00</span>
            <span>12:00</span>
            <span>Now</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto">
        {(["audit", "inference", "jobs"] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB 1: AUDIT LOGS
          Backend note: GET /api/admin/audit returns all logs.
          Server-side filtering not available — done client-side.
      ═══════════════════════════════════════════════════════════ */}
      {tab === "audit" && (
        <div className="space-y-4">
          {/* Filter Row */}
          <div className="flex flex-wrap gap-3">
            <input
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              placeholder="Filter by user ID…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44"
            />
            <input
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              placeholder="Filter by action…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44"
            />
            <input
              value={filterResource}
              onChange={(e) => setRes(e.target.value)}
              placeholder="Filter by resource…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-36"
            />
            <select
              value={filterCategory}
              onChange={(e) => setCategory(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>
              ))}
            </select>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setTo(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            {(filterUser || filterAction || filterResource || filterCategory !== "all" || filterDateFrom || filterDateTo) && (
              <button
                onClick={() => { setFilterUser(""); setFilterAction(""); setRes(""); setCategory("all"); setFrom(""); setTo(""); }}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                ✕ Clear
              </button>
            )}
            <span className="self-center text-sm text-slate-500 ml-auto">
              {filteredAudit.length} / {auditLogs.length} shown
            </span>
          </div>

          {/* Audit Log Note */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 text-xs text-blue-600">
            ℹ Server returns up to 500 most-recent logs. Filtering is client-side.
            For deeper queries, use the SQLite DB directly or add <code className="font-mono">/api/admin/audit?user_id=&action=</code> server-side filters (future-ready).
          </div>

          {loading && auditLogs.length === 0 && (
            <div className="text-center py-16 text-slate-400">Loading audit logs…</div>
          )}

          {!loading && filteredAudit.length === 0 && (
            <div className="text-center py-12 text-slate-400">No audit events match the current filters.</div>
          )}

          {filteredAudit.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Resource</th>
                    <th className="px-4 py-3 text-left">User ID</th>
                    <th className="px-4 py-3 text-left">IP</th>
                    <th className="px-4 py-3 text-left">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAudit.slice(0, 200).map((log) => {
                    const details = parseDetails(log.details);
                    const isDanger = ["delete", "reset_password", "clear", "flush", "deploy"].some(k =>
                      log.action.includes(k)
                    );
                    return (
                      <tr
                        key={log.id}
                        className={`hover:bg-slate-50 cursor-pointer ${isDanger ? "bg-red-50/30" : ""}`}
                        onClick={() => setSelAudit(log)}
                      >
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDateShort(log.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <ActionBadge action={log.action} />
                          {isDanger && <span className="ml-1 text-xs text-red-500">⚠</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700 max-w-[200px] truncate"
                            title={log.action}>
                          {log.action}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{log.resource ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 truncate max-w-[100px]"
                            title={log.user_id ?? ""}>
                          {log.user_id ? log.user_id.slice(0, 12) + "…" : "System"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{log.ip || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 max-w-[140px] truncate"
                            title={log.details ?? ""}>
                          {details
                            ? Object.entries(details).slice(0, 2).map(([k, v]) =>
                                `${k}: ${String(v).slice(0, 20)}`).join(" · ")
                            : log.details?.slice(0, 40) ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAudit.length > 200 && (
                <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100 bg-slate-50">
                  Showing first 200 of {filteredAudit.length} filtered results.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 2: INFERENCE HISTORY
          Source: GET /api/admin/inference/recent
      ═══════════════════════════════════════════════════════════ */}
      {tab === "inference" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <input
              value={infPipeline}
              onChange={(e) => setInfPipeline(e.target.value)}
              placeholder="Filter by pipeline…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44"
            />
            <input
              value={infProvider}
              onChange={(e) => setInfProvider(e.target.value)}
              placeholder="Filter by provider…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-36"
            />
            <select
              value={infStatus}
              onChange={(e) => setInfStatus(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
            <select
              value={infFallback}
              onChange={(e) => setInfFallback(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="all">All (Fallback?)</option>
              <option value="yes">Fallback Only</option>
              <option value="no">Non-Fallback Only</option>
            </select>
            <span className="self-center text-sm text-slate-500 ml-auto">
              {filteredInf.length} / {infLogs.length}
            </span>
          </div>

          {/* Stats summary */}
          {infLogs.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total",    value: infLogs.length, cls: "text-white" },
                { label: "Success",  value: infLogs.filter(r => r.status === "success").length, cls: "text-green-400" },
                { label: "Errors",   value: infLogs.filter(r => r.status === "error").length, cls: "text-red-400" },
                { label: "Fallbacks",value: infLogs.filter(r => r.is_fallback).length, cls: "text-yellow-400" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="bg-slate-800 rounded-xl p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 uppercase mb-1">{label}</p>
                  <p className={`text-xl font-bold ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {filteredInf.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No inference logs match filters.</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Pipeline</th>
                    <th className="px-3 py-2 text-left">Provider</th>
                    <th className="px-3 py-2 text-left">Model</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Latency</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-center">Fallback</th>
                    <th className="px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInf.slice(0, 200).map((row, i) => (
                    <tr
                      key={i}
                      className={`hover:bg-slate-50 cursor-pointer ${row.is_fallback ? "bg-yellow-50/40" : ""}`}
                      onClick={() => setSelInf(row)}
                    >
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {fmtDateShort(row.created_at)}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.pipeline}</td>
                      <td className="px-3 py-2 text-slate-600 capitalize">{row.provider}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[110px] truncate">{row.model}</td>
                      <td className="px-3 py-2">
                        <InferenceStatusBadge status={row.status} isFallback={row.is_fallback} />
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {row.latency_ms != null ? `${row.latency_ms}ms` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-green-700">{fmtCost(row.cost_usd)}</td>
                      <td className="px-3 py-2 text-center">
                        {row.is_fallback ? "↩" : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-red-600 max-w-[90px] truncate">
                        {row.error_code ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 3: JOB HISTORY
          Source: GET /api/admin/platform/jobs (platform engine)
      ═══════════════════════════════════════════════════════════ */}
      {tab === "jobs" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <input
              value={jobPipeline}
              onChange={(e) => setJobPipeline(e.target.value)}
              placeholder="Filter by pipeline…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44"
            />
            <select
              value={jobStatus}
              onChange={(e) => setJobStatus(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <span className="self-center text-sm text-slate-500 ml-auto">
              {filteredJobs.length} / {jobLogs.length}
            </span>
          </div>

          {/* Job status summary */}
          {jobLogs.length > 0 && (
            <div className="grid grid-cols-5 gap-3">
              {(["pending","running","completed","failed","cancelled"] as const).map((s) => {
                const cnt = jobLogs.filter(j => j.status === s).length;
                return (
                  <div key={s}
                    className={`rounded-xl border p-3 cursor-pointer transition ${
                      jobStatus === s ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                    onClick={() => setJobStatus(jobStatus === s ? "all" : s)}
                  >
                    <p className="text-xs text-slate-500 capitalize">{s}</p>
                    <p className={`text-lg font-bold ${
                      s === "failed" ? "text-red-600" :
                      s === "running" ? "text-blue-600" :
                      s === "completed" ? "text-green-600" :
                      s === "pending" ? "text-yellow-600" : "text-slate-500"
                    }`}>{cnt}</p>
                  </div>
                );
              })}
            </div>
          )}

          {filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No job history found.</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Queue</th>
                    <th className="px-4 py-3 text-left">Pipeline</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Priority</th>
                    <th className="px-4 py-3 text-right">Attempts</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-left">Completed</th>
                    <th className="px-4 py-3 text-left">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredJobs.slice(0, 200).map((job) => (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                        {job.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{job.queueName}</td>
                      <td className="px-4 py-2.5 text-slate-600">{job.pipeline || "—"}</td>
                      <td className="px-4 py-2.5">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{job.priority}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{job.attempts}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {job.createdAt ? fmtDateShort(job.createdAt) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {job.completedAt ? fmtDateShort(job.completedAt) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-red-600 max-w-[160px] truncate"
                          title={job.error ?? ""}>
                        {job.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Drawers */}
      {selectedAudit && (
        <AuditDrawer log={selectedAudit} onClose={() => setSelAudit(null)} />
      )}
      {selectedInf && (
        <InferenceDrawer row={selectedInf} onClose={() => setSelInf(null)} />
      )}
    </div>
  );
}
