"use client";
import { useEffect, useState } from "react";
import {
  getAiStats,
  getAiSystemInfo,
  type AiStatsResponse,
  type AiSystemInfo,
} from "@/lib/api";

function fmtCost(n: number) {
  return `$${n.toFixed(4)}`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUptime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR");
}

function fmtMem(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}
function StatCard({ label, value, sub, color = "text-white" }: StatCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function JobStatusBar({ stats }: { stats: AiStatsResponse["jobStats"] }) {
  const total = stats.total || 1;
  const bars = [
    { label: "Completed", count: stats.completed, color: "bg-green-500" },
    { label: "Running",   count: stats.running,   color: "bg-blue-500" },
    { label: "Pending",   count: stats.pending,   color: "bg-yellow-500" },
    { label: "Failed",    count: stats.failed,    color: "bg-red-500" },
    { label: "Cancelled", count: stats.cancelled, color: "bg-slate-500" },
  ];
  return (
    <div>
      <div className="flex rounded overflow-hidden h-3 mb-2">
        {bars.map((b) =>
          b.count > 0 ? (
            <div
              key={b.label}
              className={`${b.color} transition-all`}
              style={{ width: `${(b.count / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {bars.map((b) => (
          <span key={b.label} className="text-xs text-slate-400 flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${b.color}`} />
            {b.label}: {b.count}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AiOverviewPage() {
  const [stats, setStats]   = useState<AiStatsResponse | null>(null);
  const [sysInfo, setSysInfo] = useState<AiSystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, sys] = await Promise.all([getAiStats(), getAiSystemInfo()]);
      setStats(s);
      setSysInfo(sys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🤖 AI Orchestrator — Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">Phase 13–16 · Node.js Engine Status</p>
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
          <p className="mt-1 text-xs text-red-500">
            Make sure AI_API_URL is configured and the Node.js orchestrator is running.
          </p>
        </div>
      )}

      {loading && !stats && (
        <div className="text-center py-16 text-slate-400">Loading…</div>
      )}

      {stats && (
        <>
          {/* Key Metrics */}
          <section>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Key Metrics
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Cost (USD)"
                value={fmtCost(stats.overview.totalCostUsd)}
                color="text-green-400"
              />
              <StatCard
                label="Total API Calls"
                value={fmtNum(stats.overview.totalApiCalls)}
                sub="All-time"
              />
              <StatCard
                label="Total Tokens"
                value={fmtNum(stats.overview.totalTokens)}
                sub="Input + Output"
              />
              <StatCard
                label="Total Users"
                value={stats.overview.totalUsers}
                sub={`${stats.overview.activeUsers7d} active 7d`}
              />
            </div>
          </section>

          {/* Job Stats */}
          <section>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Job Queue
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <StatCard label="Total Jobs"    value={stats.jobStats.total}    color="text-slate-800" />
                <StatCard label="Pending"       value={stats.jobStats.pending}  color="text-yellow-600" />
                <StatCard label="Running"       value={stats.jobStats.running}  color="text-blue-600" />
                <StatCard label="Completed"     value={stats.jobStats.completed} color="text-green-600" />
                <StatCard label="Failed"        value={stats.jobStats.failed}   color="text-red-600" />
              </div>
              <JobStatusBar stats={stats.jobStats} />
            </div>
          </section>

          {/* Cost by Model */}
          {stats.costByModel?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Cost by Model
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Model</th>
                      <th className="px-4 py-3 text-right">Calls</th>
                      <th className="px-4 py-3 text-right">Input Tokens</th>
                      <th className="px-4 py-3 text-right">Output Tokens</th>
                      <th className="px-4 py-3 text-right">Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.costByModel.slice(0, 10).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{row.model}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtNum(row.calls)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtNum(row.input_tokens)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtNum(row.output_tokens)}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-700">
                          {fmtCost(row.total_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Hourly Activity */}
          {stats.hourly?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Hourly Activity (last 24h)
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-end gap-1 h-24">
                  {stats.hourly.slice(-24).map((h, i) => {
                    const maxCalls = Math.max(...stats.hourly.map((x) => x.calls), 1);
                    const pct = Math.max((h.calls / maxCalls) * 100, 2);
                    return (
                      <div
                        key={i}
                        title={`${h.hour}: ${h.calls} calls, ${fmtCost(h.total_cost)}`}
                        className="flex-1 bg-blue-500 rounded-t opacity-80 hover:opacity-100 cursor-pointer transition"
                        style={{ height: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-2 text-right">← Older · Newer →</p>
              </div>
            </section>
          )}

          {/* Recent Users + Jobs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent Users */}
            <section>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Recent Users
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">Role</th>
                      <th className="px-4 py-2 text-left">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(stats.recentUsers || []).map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-700 truncate max-w-[160px]">{u.email}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{fmtDate(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Recent Jobs */}
            <section>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Recent Jobs
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Pipeline</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(stats.recentJobs || []).map((j) => (
                      <tr key={j.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-700">{j.pipeline || "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            j.status === "completed" ? "bg-green-100 text-green-700" :
                            j.status === "running"   ? "bg-blue-100 text-blue-700" :
                            j.status === "failed"    ? "bg-red-100 text-red-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {j.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{fmtDate(j.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {/* System Info */}
      {sysInfo && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            System Info
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Uptime"
              value={fmtUptime(sysInfo.system.uptime)}
              sub={`PID ${sysInfo.system.pid}`}
            />
            <StatCard
              label="RSS Memory"
              value={fmtMem(sysInfo.system.memory.rss)}
              sub={`Heap: ${fmtMem(sysInfo.system.memory.heapUsed)}`}
            />
            <StatCard
              label="Node.js"
              value={sysInfo.system.nodeVersion}
              sub={sysInfo.system.platform}
            />
            <StatCard
              label="Environment"
              value={sysInfo.env}
            />
          </div>
        </section>
      )}

      {/* Server Time */}
      {stats && (
        <p className="text-xs text-slate-400 text-right">
          Server time: {fmtDate(stats.serverTime)}
        </p>
      )}
    </div>
  );
}
