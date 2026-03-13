"use client";
import { useEffect, useState } from "react";
import {
  getAiHealthDashboard,
  getAiHealthErrors,
  runAiHealthCheck,
  type HealthDashboardResponse,
  type HealthErrorsResponse,
  type ProviderHealth,
} from "@/lib/api";

function fmtCost(n: number) {
  return `$${n.toFixed(5)}`;
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR");
}
function fmtLatency(ms: number | null) {
  if (ms === null) return "—";
  return `${ms}ms`;
}
function fmtPct(n: number | null) {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok:       "bg-green-100 text-green-700",
    error:    "bg-red-100 text-red-700",
    timeout:  "bg-orange-100 text-orange-700",
    unknown:  "bg-slate-100 text-slate-600",
    ready:    "bg-green-100 text-green-700",
    configured: "bg-blue-100 text-blue-700",
    unconfigured: "bg-slate-100 text-slate-500",
  };
  const cls = map[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status || "unknown"}
    </span>
  );
}

function UptimeBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400 text-xs">—</span>;
  const color = pct >= 99 ? "bg-green-500" : pct >= 90 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-600 w-12 text-right">{pct}%</span>
    </div>
  );
}

function ProviderCard({ name, p }: { name: string; p: ProviderHealth }) {
  const latestStatus = p.latestCheck?.status ?? (p.clientReady ? "ready" : "unconfigured");
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 capitalize">{name}</h3>
          <p className="text-xs text-slate-400">
            {p.enabledModels?.length ?? 0} model{(p.enabledModels?.length ?? 0) !== 1 ? "s" : ""} enabled
          </p>
        </div>
        <StatusBadge status={latestStatus} />
      </div>

      {/* Uptime */}
      <div>
        <p className="text-xs text-slate-500 mb-1">24h Uptime</p>
        <UptimeBar pct={p.uptimePct} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 rounded p-2">
          <p className="text-slate-400">Avg Latency</p>
          <p className="font-medium text-slate-700">{fmtLatency(p.avgLatency)}</p>
        </div>
        <div className="bg-slate-50 rounded p-2">
          <p className="text-slate-400">Calls 24h</p>
          <p className="font-medium text-slate-700">{p.calls24h}</p>
        </div>
        <div className="bg-slate-50 rounded p-2">
          <p className="text-slate-400">Success Rate</p>
          <p className={`font-medium ${
            p.successRate24h === null ? "text-slate-400" :
            p.successRate24h >= 95 ? "text-green-700" :
            p.successRate24h >= 80 ? "text-yellow-700" : "text-red-700"
          }`}>{fmtPct(p.successRate24h)}</p>
        </div>
        <div className="bg-slate-50 rounded p-2">
          <p className="text-slate-400">Cost 24h</p>
          <p className="font-medium text-green-700">{fmtCost(p.totalCost24h)}</p>
        </div>
      </div>

      {/* Latest check */}
      {p.latestCheck && (
        <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
          Last check: {fmtDate(p.latestCheck.checked_at)}
          {p.latestCheck.error_msg && (
            <p className="text-red-500 mt-0.5 truncate">{p.latestCheck.error_msg}</p>
          )}
        </div>
      )}

      {/* Enabled models */}
      {p.enabledModels && p.enabledModels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.enabledModels.slice(0, 4).map((m) => (
            <span key={m} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
              {m}
            </span>
          ))}
          {p.enabledModels.length > 4 && (
            <span className="text-xs text-slate-400">+{p.enabledModels.length - 4}</span>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ cat }: { cat: string }) {
  const map: Record<string, string> = {
    auth:     "bg-red-100 text-red-700",
    config:   "bg-orange-100 text-orange-700",
    whitelist:"bg-yellow-100 text-yellow-700",
    network:  "bg-blue-100 text-blue-700",
    unknown:  "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[cat] ?? "bg-slate-100 text-slate-600"}`}>
      {cat}
    </span>
  );
}

export default function AiHealthPage() {
  const [dashboard, setDashboard] = useState<HealthDashboardResponse | null>(null);
  const [errors, setErrors]       = useState<HealthErrorsResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [checking, setChecking]   = useState(false);
  const [apiError, setApiError]   = useState<string | null>(null);
  const [hours, setHours]         = useState(24);
  const [tab, setTab]             = useState<"providers" | "errors">("providers");

  async function load() {
    setLoading(true);
    setApiError(null);
    try {
      const [d, e] = await Promise.all([
        getAiHealthDashboard(hours),
        getAiHealthErrors(7),
      ]);
      setDashboard(d);
      setErrors(e);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function doHealthCheck() {
    setChecking(true);
    try {
      await runAiHealthCheck();
      await load();
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { load(); }, [hours]);

  const providers = dashboard ? Object.entries(dashboard.providers) : [];
  const okCount   = providers.filter(([, p]) => p.latestCheck?.status === "ok" || p.clientReady).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🏥 Provider Health</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {dashboard?.period ?? "Loading…"} · {okCount}/{providers.length} providers healthy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
          >
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
          </select>
          <button
            onClick={doHealthCheck}
            disabled={checking}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium
                       hover:bg-green-700 disabled:opacity-50 transition"
          >
            {checking ? "Checking…" : "⚡ Run Health Check"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
                       hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {apiError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {apiError}
        </div>
      )}

      {/* Summary bar */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Total Providers</p>
            <p className="text-2xl font-bold text-white">{dashboard.summary.totalProviders}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Configured</p>
            <p className="text-2xl font-bold text-green-400">{dashboard.summary.configured}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Calls ({hours}h)</p>
            <p className="text-2xl font-bold text-white">{dashboard.summary.totalCalls24h}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Cost ({hours}h)</p>
            <p className="text-2xl font-bold text-green-400">
              ${dashboard.summary.totalCost24h.toFixed(4)}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(["providers", "errors"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "providers" ? "Provider Cards" : "Error Analysis"}
          </button>
        ))}
      </div>

      {/* Providers Tab */}
      {tab === "providers" && (
        <>
          {loading && <div className="text-center py-16 text-slate-400">Loading providers…</div>}
          {!loading && providers.length === 0 && (
            <div className="text-center py-16 text-slate-400">No providers found.</div>
          )}
          {!loading && providers.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {providers.map(([name, p]) => (
                <ProviderCard key={name} name={name} p={p} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Errors Tab */}
      {tab === "errors" && errors && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">{errors.totalErrors}</span> total errors · {errors.period}
            </p>
          </div>
          {errors.categories.length === 0 ? (
            <div className="text-center py-16 text-slate-400">No errors in this period. 🎉</div>
          ) : (
            <div className="space-y-3">
              {errors.categories.map((cat) => (
                <div
                  key={cat.category}
                  className="bg-white rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <CategoryBadge cat={cat.category} />
                      <span className="text-sm font-medium text-slate-700">{cat.description}</span>
                    </div>
                    <span className="text-lg font-bold text-red-600">{cat.count}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-slate-500">
                    <span className="font-medium">Providers:</span>
                    {cat.providers.map((p) => (
                      <span key={p} className="bg-slate-100 px-1.5 py-0.5 rounded">{p}</span>
                    ))}
                    {cat.codes.length > 0 && (
                      <>
                        <span className="font-medium ml-2">Codes:</span>
                        {cat.codes.slice(0, 5).map((c) => (
                          <span key={c} className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded">{c}</span>
                        ))}
                      </>
                    )}
                  </div>
                  {/* Error count bar */}
                  <div className="mt-2 h-1.5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded"
                      style={{ width: `${Math.min((cat.count / (errors.totalErrors || 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
