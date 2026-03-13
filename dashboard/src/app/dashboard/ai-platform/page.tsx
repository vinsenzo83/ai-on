"use client";
import { useEffect, useState } from "react";
import {
  getAiPlatformStatus,
  getAiPlatformAnalytics,
  getAiAnalyticsTimeline,
  type PlatformStatusResponse,
  type PlatformEngineStats,
  type PlatformAnalyticsStats,
  type PlatformAnalyticsTimeline,
} from "@/lib/api";

function fmtNum(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCost(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  return `$${n.toFixed(4)}`;
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR");
}
function fmtSize(bytes: number | undefined) {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

interface EngineCardProps {
  title: string;
  icon: string;
  color: string;
  stats: PlatformEngineStats;
  fields: Array<{ key: string; label: string; fmt?: (v: unknown) => string }>;
}

function EngineCard({ title, icon, color, stats, fields }: EngineCardProps) {
  return (
    <div className={`bg-white rounded-xl border ${color} shadow-sm overflow-hidden`}>
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h3 className="font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="p-4 grid grid-cols-2 gap-3">
        {fields.map(({ key, label, fmt }) => {
          const val = stats[key];
          const display = val === undefined || val === null
            ? "—"
            : fmt ? fmt(val) : fmtNum(Number(val));
          return (
            <div key={key} className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">{label}</p>
              <p className="text-lg font-bold text-slate-800">{display}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineChart({ data }: { data: PlatformAnalyticsTimeline["timeline"] }) {
  if (!data || data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const max = Math.max(...sorted.map((d) => d.count), 1);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-600 mb-3">Analytics Events — Daily (30d)</h3>
      <div className="flex items-end gap-1 h-24">
        {sorted.map((d, i) => {
          const pct = Math.max((d.count / max) * 100, 2);
          return (
            <div
              key={i}
              className="flex-1 bg-purple-500 rounded-t opacity-80 hover:opacity-100 cursor-pointer transition"
              style={{ height: `${pct}%` }}
              title={`${d.date}: ${d.count} events`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-slate-400 mt-1">
        <span>{sorted[0]?.date}</span>
        <span>{sorted[sorted.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function AiPlatformPage() {
  const [status, setStatus]       = useState<PlatformStatusResponse | null>(null);
  const [analytics, setAnalytics] = useState<PlatformAnalyticsStats | null>(null);
  const [timeline, setTimeline]   = useState<PlatformAnalyticsTimeline | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [st, an, tl] = await Promise.all([
        getAiPlatformStatus(),
        getAiPlatformAnalytics(),
        getAiAnalyticsTimeline(30),
      ]);
      setStatus(st);
      setAnalytics(an);
      setTimeline(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const p = status?.platform;

  const engineConfigs: EngineCardProps[] = p ? [
    {
      title: "Memory Engine",
      icon: "🧠",
      color: "border-blue-200",
      stats: p.memory,
      fields: [
        { key: "sessions",      label: "Sessions" },
        { key: "profiles",      label: "User Profiles" },
        { key: "totalMessages", label: "Total Messages" },
        { key: "activeUsers",   label: "Active Users" },
      ],
    },
    {
      title: "Storage Engine",
      icon: "📦",
      color: "border-green-200",
      stats: p.storage,
      fields: [
        { key: "assets",       label: "Assets" },
        { key: "totalSize",    label: "Total Size", fmt: (v) => fmtSize(Number(v)) },
        { key: "types",        label: "Asset Types" },
        { key: "recentAssets", label: "Recent Assets" },
      ],
    },
    {
      title: "Observability Engine",
      icon: "🔭",
      color: "border-orange-200",
      stats: p.observability,
      fields: [
        { key: "spans",    label: "Spans" },
        { key: "events",   label: "Events" },
        { key: "traces",   label: "Traces" },
        { key: "errors",   label: "Errors" },
      ],
    },
    {
      title: "Analytics Engine",
      icon: "📊",
      color: "border-purple-200",
      stats: p.analytics,
      fields: [
        { key: "trackedEvents", label: "Tracked Events" },
        { key: "counters",      label: "Counters" },
        { key: "pipelines",     label: "Pipelines" },
        { key: "totalCostUsd",  label: "Total Cost", fmt: (v) => fmtCost(Number(v)) },
      ],
    },
    {
      title: "Job Engine",
      icon: "⚙️",
      color: "border-slate-200",
      stats: p.jobs,
      fields: [
        { key: "pendingJobs",   label: "Pending" },
        { key: "runningJobs",   label: "Running" },
        { key: "completedJobs", label: "Completed" },
        { key: "failedJobs",    label: "Failed" },
        { key: "queues",        label: "Queues" },
        { key: "totalJobs",     label: "Total Jobs" },
      ],
    },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🏗️ Platform Status</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {status ? `Snapshot at ${fmtDate(status.ts)}` : "Loading…"}
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

      {loading && !status && (
        <div className="text-center py-16 text-slate-400">Loading platform status…</div>
      )}

      {/* Quick summary from analytics */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Tracked Events</p>
            <p className="text-2xl font-bold text-white">{fmtNum(analytics.stats.trackedEvents)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Counters</p>
            <p className="text-2xl font-bold text-white">{fmtNum(analytics.stats.counters)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Pipelines</p>
            <p className="text-2xl font-bold text-white">{fmtNum(analytics.stats.pipelines)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase mb-1">Total Cost</p>
            <p className="text-2xl font-bold text-green-400">{fmtCost(analytics.stats.totalCostUsd)}</p>
          </div>
        </div>
      )}

      {/* Engine Cards */}
      {engineConfigs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {engineConfigs.map((cfg) => (
            <EngineCard key={cfg.title} {...cfg} />
          ))}
        </div>
      )}

      {/* Analytics Timeline */}
      {timeline && (
        <TimelineChart data={timeline.timeline} />
      )}

      {/* Raw platform data details */}
      {p && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Raw Engine Stats
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(
              [
                { key: "memory",        label: "Memory",        icon: "🧠" },
                { key: "storage",       label: "Storage",       icon: "📦" },
                { key: "observability", label: "Observability", icon: "🔭" },
                { key: "analytics",     label: "Analytics",     icon: "📊" },
                { key: "jobs",          label: "Jobs",          icon: "⚙️" },
              ] as const
            ).map(({ key, label, icon }) => (
              <div key={key} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-600 mb-2">{icon} {label}</p>
                <pre className="text-xs bg-slate-50 rounded p-2 overflow-auto max-h-48 text-slate-700">
                  {JSON.stringify(p[key], null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
