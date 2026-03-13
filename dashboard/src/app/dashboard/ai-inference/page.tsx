"use client";
import { useEffect, useState } from "react";
import {
  getAiInferenceStats,
  getAiInferenceSummary,
  listAiInferenceLogs,
  type InferenceStatsResponse,
  type InferenceSummaryResponse,
  type InferenceLogRow,
} from "@/lib/api";

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR");
}
function fmtCost(n: number | null) {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(6)}`;
}
function fmtLatency(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  return `${ms}ms`;
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function ProviderRow({ r }: { r: InferenceStatsResponse["byProvider"][0] }) {
  const total = r.total || 1;
  const realPct    = (r.real_success / total) * 100;
  const fallPct    = (r.fallback_success / total) * 100;
  const errPct     = (r.errors / total) * 100;

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-800 capitalize">{r.provider}</td>
      <td className="px-4 py-3 text-right text-slate-700">{r.total}</td>
      <td className="px-4 py-3 text-right text-green-700">{r.real_success}</td>
      <td className="px-4 py-3 text-right text-yellow-700">{r.fallback_success}</td>
      <td className="px-4 py-3 text-right text-red-700">{r.errors}</td>
      <td className="px-4 py-3">
        <div className="flex rounded overflow-hidden h-2 min-w-[80px]">
          <div className="bg-green-500" style={{ width: `${realPct}%` }} title={`Real: ${fmtPct(realPct)}`} />
          <div className="bg-yellow-400" style={{ width: `${fallPct}%` }} title={`Fallback: ${fmtPct(fallPct)}`} />
          <div className="bg-red-400" style={{ width: `${errPct}%` }} title={`Error: ${fmtPct(errPct)}`} />
        </div>
      </td>
    </tr>
  );
}

function InferenceLogTable({ rows }: { rows: InferenceLogRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
          <tr>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Pipeline</th>
            <th className="px-3 py-2 text-left">Provider</th>
            <th className="px-3 py-2 text-left">Model</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Latency</th>
            <th className="px-3 py-2 text-right">Tokens</th>
            <th className="px-3 py-2 text-right">Cost</th>
            <th className="px-3 py-2 text-center">Fallback</th>
            <th className="px-3 py-2 text-left">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className={`hover:bg-slate-50 ${row.is_fallback ? "bg-yellow-50/50" : ""}`}>
              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(row.created_at)}</td>
              <td className="px-3 py-2 text-slate-700">{row.pipeline}</td>
              <td className="px-3 py-2 text-slate-600 capitalize">{row.provider}</td>
              <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{row.model}</td>
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  row.status === "success" ? "bg-green-100 text-green-700" :
                  row.status === "error"   ? "bg-red-100 text-red-700" :
                  "bg-slate-100 text-slate-600"
                }`}>{row.status}</span>
              </td>
              <td className="px-3 py-2 text-right text-slate-500">{fmtLatency(row.latency_ms)}</td>
              <td className="px-3 py-2 text-right text-slate-500">
                {(row.input_tokens !== null && row.output_tokens !== null)
                  ? `${row.input_tokens}+${row.output_tokens}`
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right text-green-700">{fmtCost(row.cost_usd)}</td>
              <td className="px-3 py-2 text-center">
                {row.is_fallback ? (
                  <span className="text-yellow-600 font-bold">↩</span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-red-600 max-w-[100px] truncate" title={row.error_code ?? ""}>
                {row.error_code || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AiInferencePage() {
  const [stats, setStats]       = useState<InferenceStatsResponse | null>(null);
  const [summary, setSummary]   = useState<InferenceSummaryResponse | null>(null);
  const [logs, setLogs]         = useState<InferenceLogRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [days, setDays]         = useState(7);
  const [tab, setTab]           = useState<"stats" | "summary" | "logs">("stats");
  const [pipelineFilter, setPf] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [st, sm, lg] = await Promise.all([
        getAiInferenceStats(days),
        getAiInferenceSummary({ pipeline: pipelineFilter || undefined }),
        listAiInferenceLogs({ limit: 100, pipeline: pipelineFilter || undefined }),
      ]);
      setStats(st);
      setSummary(sm);
      setLogs(lg.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days, pipelineFilter]);

  const s = stats?.summary;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🧠 Inference Stats</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {stats?.period ?? "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
          >
            <option value={1}>Last 1d</option>
            <option value={7}>Last 7d</option>
            <option value={30}>Last 30d</option>
          </select>
          <input
            value={pipelineFilter}
            onChange={(e) => setPf(e.target.value)}
            placeholder="Filter by pipeline…"
            className="text-sm border border-slate-300 rounded-lg px-3 py-2"
          />
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Summary Cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 col-span-1">
            <p className="text-xs text-slate-400 uppercase mb-1">Total</p>
            <p className="text-2xl font-bold text-white">{s.total}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Real OK</p>
            <p className="text-2xl font-bold text-green-400">{s.realSuccess}</p>
            <p className="text-xs text-slate-500">{fmtPct(s.realPct)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Fallback</p>
            <p className="text-2xl font-bold text-yellow-400">{s.fallbackSuccess}</p>
            <p className="text-xs text-slate-500">{fmtPct(s.fallbackPct)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Errors</p>
            <p className="text-2xl font-bold text-red-400">{s.errors}</p>
            <p className="text-xs text-slate-500">
              {s.total > 0 ? fmtPct((s.errors / s.total) * 100) : "—"}
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 col-span-2">
            <p className="text-xs text-slate-400 uppercase mb-2">Success Breakdown</p>
            <div className="flex rounded overflow-hidden h-3">
              <div className="bg-green-500" style={{ width: `${s.realPct}%` }} title={`Real ${fmtPct(s.realPct)}`} />
              <div className="bg-yellow-400" style={{ width: `${s.fallbackPct}%` }} title={`Fallback ${fmtPct(s.fallbackPct)}`} />
              <div className="bg-red-400"
                style={{ width: `${s.total > 0 ? ((s.errors / s.total) * 100) : 0}%` }}
                title="Errors" />
            </div>
            <div className="flex gap-3 mt-1">
              {[
                { label: "Real", color: "bg-green-500", pct: s.realPct },
                { label: "Fallback", color: "bg-yellow-400", pct: s.fallbackPct },
                { label: "Error", color: "bg-red-400", pct: s.total > 0 ? (s.errors / s.total) * 100 : 0 },
              ].map((item) => (
                <span key={item.label} className="text-xs text-slate-400 flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${item.color}`} />
                  {item.label}: {fmtPct(item.pct)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(["stats", "summary", "logs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition capitalize ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "stats" ? "By Provider" : t === "summary" ? "Pipeline Summary" : "Recent Logs"}
          </button>
        ))}
      </div>

      {/* Stats Tab - By Provider */}
      {tab === "stats" && stats && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Provider</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Real OK</th>
                <th className="px-4 py-3 text-right">Fallback</th>
                <th className="px-4 py-3 text-right">Errors</th>
                <th className="px-4 py-3 text-left">Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.byProvider
                .sort((a, b) => b.total - a.total)
                .map((r, i) => <ProviderRow key={i} r={r} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary Tab - Pipeline Summary */}
      {tab === "summary" && summary && (
        <div className="space-y-4">
          {/* Pipelines */}
          {summary.pipelines && summary.pipelines.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <p className="px-4 py-3 bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b">
                Pipeline Stats
              </p>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Pipeline</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Success</th>
                    <th className="px-4 py-3 text-right">Errors</th>
                    <th className="px-4 py-3 text-right">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.pipelines.map((p, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{p.pipeline}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{p.total}</td>
                      <td className="px-4 py-3 text-right text-green-700">{p.success}</td>
                      <td className="px-4 py-3 text-right text-red-700">{p.errors}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${
                          p.total > 0 && (p.success / p.total) >= 0.95 ? "text-green-700" :
                          p.total > 0 && (p.success / p.total) >= 0.8  ? "text-yellow-700" : "text-red-700"
                        }`}>
                          {p.total > 0 ? fmtPct((p.success / p.total) * 100) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Combos */}
          {summary.combos && summary.combos.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <p className="px-4 py-3 bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b">
                Pipeline × Provider × Model Combos
              </p>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Pipeline</th>
                    <th className="px-4 py-3 text-left">Provider</th>
                    <th className="px-4 py-3 text-left">Model</th>
                    <th className="px-4 py-3 text-right">Calls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.combos.slice(0, 20).map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{c.pipeline}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{c.provider}</td>
                      <td className="px-4 py-3 text-slate-600">{c.model}</td>
                      <td className="px-4 py-3 text-right text-slate-700 font-medium">{c.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Logs Tab */}
      {tab === "logs" && (
        <>
          {loading && logs.length === 0 ? (
            <div className="text-center py-16 text-slate-400">Loading logs…</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-slate-400">No inference logs found.</div>
          ) : (
            <InferenceLogTable rows={logs} />
          )}
        </>
      )}
    </div>
  );
}
