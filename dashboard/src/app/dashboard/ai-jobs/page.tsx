"use client";
import { useEffect, useState } from "react";
import {
  getAiJobStats,
  listAiJobs,
  cancelAiJob,
  retryAiJob,
  enqueueAiJob,
  type AiJob,
  type AiJobQueueStats,
} from "@/lib/api";

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("ko-KR");
}
function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-700",
  running:   "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed:    "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function JobDrawer({
  job,
  onClose,
  onCancel,
  onRetry,
}: {
  job: AiJob;
  onClose: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-[480px] bg-white shadow-2xl overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">Job Details</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">ID</span>
            <span className="font-mono text-xs text-slate-700">{job.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Queue</span>
            <span className="font-medium">{job.queueName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Pipeline</span>
            <span>{job.pipeline || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Status</span>
            <StatusPill status={job.status} />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Priority</span>
            <span>{job.priority}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Attempts</span>
            <span>{job.attempts}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Created</span>
            <span>{fmtDate(job.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Started</span>
            <span>{fmtDate(job.startedAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Completed</span>
            <span>{fmtDate(job.completedAt)}</span>
          </div>
          {job.startedAt && job.completedAt && (
            <div className="flex justify-between">
              <span className="text-slate-500">Duration</span>
              <span>{fmtDuration(job.startedAt, job.completedAt)}</span>
            </div>
          )}
        </div>

        {/* Data */}
        {job.data && Object.keys(job.data).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Input Data</p>
            <pre className="bg-slate-50 rounded p-3 text-xs overflow-auto max-h-40">
              {JSON.stringify(job.data, null, 2)}
            </pre>
          </div>
        )}

        {/* Result */}
        {job.result !== null && job.result !== undefined && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Result</p>
            <pre className="bg-green-50 rounded p-3 text-xs overflow-auto max-h-40">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </div>
        )}

        {/* Error */}
        {job.error && (
          <div>
            <p className="text-xs font-semibold text-red-500 uppercase mb-1">Error</p>
            <pre className="bg-red-50 rounded p-3 text-xs overflow-auto max-h-40 text-red-700">
              {job.error}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {(job.status === "pending" || job.status === "running") && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition"
            >
              Cancel Job
            </button>
          )}
          {job.status === "failed" && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-yellow-600 text-white text-sm font-medium hover:bg-yellow-700 transition"
            >
              Retry Job
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function EnqueueModal({ onClose, onEnqueued }: { onClose: () => void; onEnqueued: () => void }) {
  const [queueName, setQueueName] = useState("default");
  const [pipeline, setPipeline]   = useState("");
  const [priority, setPriority]   = useState("5");
  const [dataRaw, setDataRaw]     = useState("{}");
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const data = JSON.parse(dataRaw);
      await enqueueAiJob({
        queueName,
        data,
        priority: Number(priority),
        pipeline: pipeline || undefined,
      });
      onEnqueued();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enqueue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl p-6 w-[400px] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">Enqueue New Job</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-slate-500 mb-1">Queue Name</label>
            <input
              value={queueName}
              onChange={(e) => setQueueName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              placeholder="default"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Pipeline (optional)</label>
            <input
              value={pipeline}
              onChange={(e) => setPipeline(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              placeholder="e.g. chat"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Priority (1–10)</label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              min={1}
              max={10}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Data (JSON)</label>
            <textarea
              value={dataRaw}
              onChange={(e) => setDataRaw(e.target.value)}
              rows={4}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>
        </div>
        {error && (
          <p className="text-red-600 text-sm">⚠️ {error}</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Enqueueing…" : "Enqueue"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AiJobsPage() {
  const [stats, setStats]         = useState<AiJobQueueStats | null>(null);
  const [jobs, setJobs]           = useState<AiJob[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [statusFilter, setStatus] = useState<string>("all");
  const [selectedJob, setSelected]= useState<AiJob | null>(null);
  const [showEnqueue, setShowEnqueue] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [st, jl] = await Promise.all([
        getAiJobStats(),
        listAiJobs({
          status: statusFilter !== "all" ? statusFilter : undefined,
          limit: 100,
        }),
      ]);
      setStats(st);
      setJobs(jl.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function doCancel(jobId: string) {
    setActionError(null);
    try {
      await cancelAiJob(jobId);
      setSelected(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function doRetry(jobId: string) {
    setActionError(null);
    try {
      await retryAiJob(jobId);
      setSelected(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Retry failed");
    }
  }

  const s = stats?.stats;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">⚙️ Job Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">AI Orchestrator · Platform Job Engine</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowEnqueue(true)}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition"
          >
            + Enqueue Job
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ⚠️ {error || actionError}
        </div>
      )}

      {/* Stats Row */}
      {s && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {(["total", "pending", "running", "completed", "failed", "cancelled"] as const).map((k) => (
            <div
              key={k}
              className={`rounded-xl p-3 border cursor-pointer transition ${
                statusFilter === k ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              onClick={() => setStatus(statusFilter === k ? "all" : k)}
            >
              <p className="text-xs text-slate-500 capitalize">{k}</p>
              <p className={`text-xl font-bold ${
                k === "failed"    ? "text-red-600" :
                k === "running"   ? "text-blue-600" :
                k === "pending"   ? "text-yellow-600" :
                k === "completed" ? "text-green-600" : "text-slate-800"
              }`}>{s[k]}</p>
            </div>
          ))}
        </div>
      )}

      {/* Queue breakdown */}
      {s?.queues && Object.keys(s.queues).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-500 self-center">Queues:</span>
          {Object.entries(s.queues).map(([q, count]) => (
            <span key={q} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
              {q}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="text-sm text-slate-500">{jobs.length} jobs</span>
      </div>

      {/* Jobs Table */}
      {loading && jobs.length === 0 && (
        <div className="text-center py-16 text-slate-400">Loading jobs…</div>
      )}
      {!loading && jobs.length === 0 && (
        <div className="text-center py-16 text-slate-400">No jobs found.</div>
      )}
      {jobs.length > 0 && (
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
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelected(job)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {job.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-slate-700">{job.queueName}</td>
                  <td className="px-4 py-3 text-slate-600">{job.pipeline || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={job.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{job.priority}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{job.attempts}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(job.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {fmtDuration(job.startedAt, job.completedAt)}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {(job.status === "pending" || job.status === "running") && (
                      <button
                        onClick={() => doCancel(job.id)}
                        className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition"
                      >
                        Cancel
                      </button>
                    )}
                    {job.status === "failed" && (
                      <button
                        onClick={() => doRetry(job.id)}
                        className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Job Drawer */}
      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          onClose={() => setSelected(null)}
          onCancel={() => doCancel(selectedJob.id)}
          onRetry={() => doRetry(selectedJob.id)}
        />
      )}

      {/* Enqueue Modal */}
      {showEnqueue && (
        <EnqueueModal
          onClose={() => setShowEnqueue(false)}
          onEnqueued={load}
        />
      )}
    </div>
  );
}
