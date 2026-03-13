"use client";
import { useEffect, useState } from "react";
import {
  getAiCosts,
  getAiAnalyticsCosts,
  type AiCostResponse,
  type AiAnalyticsCosts,
} from "@/lib/api";

function fmtCost(n: number) {
  return `$${n.toFixed(5)}`;
}
function fmtCostBig(n: number) {
  return `$${n.toFixed(4)}`;
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ko-KR");
}

interface SummaryCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}
function SummaryCard({ label, value, sub, color = "text-white" }: SummaryCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({
  data,
  labelKey,
  valueKey,
  title,
  color = "bg-blue-500",
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  title: string;
  color?: string;
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 0.0001);
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-600 mb-3">{title}</h3>
      <div className="space-y-2">
        {data.map((d, i) => {
          const val = Number(d[valueKey]) || 0;
          const pct = Math.max((val / max) * 100, 1);
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-24 truncate flex-shrink-0">
                {String(d[labelKey]).slice(0, 16)}
              </span>
              <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                <div
                  className={`h-full ${color} rounded transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-slate-700 w-20 text-right flex-shrink-0">
                {fmtCost(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: AiCostResponse["daily"] }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.total_cost), 0.0001);
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-600 mb-3">Daily Cost (last 30 days)</h3>
      <div className="flex items-end gap-1 h-32">
        {sorted.map((d, i) => {
          const pct = Math.max((d.total_cost / max) * 100, 2);
          return (
            <div
              key={i}
              className="flex-1 bg-green-500 rounded-t opacity-80 hover:opacity-100 cursor-pointer transition"
              style={{ height: `${pct}%` }}
              title={`${fmtDate(d.date)}: ${fmtCost(d.total_cost)} · ${d.calls} calls`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-slate-400 mt-1">
        <span>{sorted[0] ? fmtDate(sorted[0].date) : ""}</span>
        <span>{sorted[sorted.length - 1] ? fmtDate(sorted[sorted.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

export default function AiCostsPage() {
  const [costs, setCosts]           = useState<AiCostResponse | null>(null);
  const [analytics, setAnalytics]   = useState<AiAnalyticsCosts | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [tab, setTab]               = useState<"overview" | "model" | "daily" | "monthly">("overview");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, a] = await Promise.all([
        getAiCosts().catch(() => null),
        getAiAnalyticsCosts().catch(() => null),
      ]);
      setCosts(c);
      setAnalytics(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const summary = costs?.summary;
  const analyticsCosts = analytics?.costs;

  // Unified total cost from whichever source is available
  const totalCost = summary?.total ?? analyticsCosts?.totalCostUsd ?? 0;
  const totalCalls = summary?.calls ?? analyticsCosts?.totalCalls ?? 0;
  const totalTokens = (summary ? summary.inputs + summary.outputs : analyticsCosts?.totalTokens) ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">💰 Cost Analysis</h1>
          <p className="text-sm text-slate-500 mt-0.5">AI Orchestrator · Spend Tracking</p>
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

      {loading && !costs && !analytics && (
        <div className="text-center py-16 text-slate-400">Loading cost data…</div>
      )}

      {/* Summary Cards */}
      {(costs || analytics) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Spend"
            value={fmtCostBig(totalCost)}
            color="text-green-400"
            sub="All-time"
          />
          <SummaryCard
            label="Total API Calls"
            value={fmtNum(totalCalls)}
            sub="All providers"
          />
          <SummaryCard
            label="Total Tokens"
            value={fmtNum(totalTokens)}
            sub={summary ? `${fmtNum(summary.inputs)} in + ${fmtNum(summary.outputs)} out` : undefined}
          />
          <SummaryCard
            label="Avg Cost/Call"
            value={totalCalls > 0 ? fmtCost(totalCost / totalCalls) : "—"}
            color="text-yellow-400"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(["overview", "model", "daily", "monthly"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition capitalize ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "overview" ? "Overview" :
             t === "model"    ? "By Model" :
             t === "daily"    ? "Daily Trend" : "Monthly"}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* Analytics cost by model (platform analytics engine) */}
          {analyticsCosts?.byModel && analyticsCosts.byModel.length > 0 && (
            <BarChart
              data={analyticsCosts.byModel as Record<string, unknown>[]}
              labelKey="model"
              valueKey="cost"
              title="Analytics Engine — Cost by Model"
              color="bg-purple-500"
            />
          )}

          {/* Cost by model from costs API */}
          {costs?.byModel && costs.byModel.length > 0 && (
            <BarChart
              data={costs.byModel as unknown as Record<string, unknown>[]}
              labelKey="model"
              valueKey="total_cost"
              title="Cost Tracker — Top Models"
              color="bg-green-500"
            />
          )}

          {/* Monthly chart */}
          {costs?.monthly && costs.monthly.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-600 mb-3">Monthly Spend</h3>
              <div className="space-y-2">
                {costs.monthly.map((m, i) => {
                  const maxM = Math.max(...costs.monthly.map((x) => x.total_cost), 0.0001);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-20">{m.month}</span>
                      <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded"
                          style={{ width: `${Math.max((m.total_cost / maxM) * 100, 1)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-slate-700 w-20 text-right">
                        {fmtCost(m.total_cost)}
                      </span>
                      <span className="text-xs text-slate-400 w-16 text-right">
                        {m.calls} calls
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* By Model Tab */}
      {tab === "model" && costs?.byModel && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Model</th>
                <th className="px-4 py-3 text-left">Provider</th>
                <th className="px-4 py-3 text-right">Calls</th>
                <th className="px-4 py-3 text-right">Input Tokens</th>
                <th className="px-4 py-3 text-right">Output Tokens</th>
                <th className="px-4 py-3 text-right">Total Cost</th>
                <th className="px-4 py-3 text-right">Cost/Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {costs.byModel
                .sort((a, b) => b.total_cost - a.total_cost)
                .map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.model}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{row.provider}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtNum(row.calls)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fmtNum(row.input_tokens)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fmtNum(row.output_tokens)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">
                      {fmtCost(row.total_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {row.calls > 0 ? fmtCost(row.total_cost / row.calls) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily Trend Tab */}
      {tab === "daily" && costs?.daily && (
        <div className="space-y-4">
          <DailyChart data={costs.daily} />
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Calls</th>
                  <th className="px-4 py-3 text-right">Input Tokens</th>
                  <th className="px-4 py-3 text-right">Output Tokens</th>
                  <th className="px-4 py-3 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...costs.daily]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 30)
                  .map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{fmtDate(row.date)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{row.calls}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmtNum(row.input_tokens)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmtNum(row.output_tokens)}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">
                        {fmtCost(row.total_cost)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly Tab */}
      {tab === "monthly" && costs?.monthly && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Month</th>
                <th className="px-4 py-3 text-right">Calls</th>
                <th className="px-4 py-3 text-right">Total Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...costs.monthly]
                .sort((a, b) => b.month.localeCompare(a.month))
                .map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{row.month}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{row.calls}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">
                      {fmtCost(row.total_cost)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
