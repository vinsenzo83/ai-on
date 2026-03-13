'use strict';
/**
 * jobEngine.js — Platform Layer: Background Job Abstraction
 * ===========================================================
 * Phase 14 platform extension. Frozen engine core (aiConnector) untouched.
 *
 * Provides a unified, priority-aware background job system for long-running
 * tasks (LLM batch generation, asset exports, bulk imports, cron-triggered
 * pipeline runs) that should not block HTTP request/response cycles.
 *
 * Architecture:
 *   QUEUE     – named channel (e.g. 'llm', 'export', 'import', 'notify')
 *   JOB       – work unit: { queue, data, handler, priority, retries }
 *   WORKER    – async fn(job) registered per queue
 *   SCHEDULER – cron expressions for recurring jobs
 *
 * Priority levels (higher = processed first):
 *   10 CRITICAL  – user-facing real-time requests
 *    5 HIGH       – interactive but tolerable delay
 *    3 NORMAL     – default async tasks
 *    1 LOW        – bulk / background
 *    0 IDLE       – maintenance tasks
 *
 * Persistence:
 *   Active jobs → SQLite job_runs table (survive restart)
 *   Job results → kept for RESULT_TTL_MS, then pruned
 *
 * Integrates with:
 *   analyticsEngine  – auto-tracks job.queued / job.completed / job.failed
 *   observabilityEngine – wraps each job execution in a span
 *   Socket.IO        – emits job:progress, job:completed, job:failed events
 *
 * Admin API surface (exported):
 *   enqueue(queueName, data, opts)         → JobRecord
 *   getJob(jobId)                          → JobRecord
 *   cancelJob(jobId)                       → boolean
 *   retryJob(jobId)                        → JobRecord
 *   listJobs(filter)                       → JobRecord[]
 *   registerWorker(queueName, fn, opts)    → void
 *   registerRecurring(name, cron, fn, opts)→ void
 *   getQueueStats()                        → QueueStats
 *   stats()
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

// ── DB (lazy) ─────────────────────────────────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) { try { _db = require('../db/database'); } catch (_) {} }
  return _db;
}

// ── Analytics / Observability (lazy) ─────────────────────────────────────
let _analytics = null, _obs = null;
function _getAnalytics() {
  if (!_analytics) { try { _analytics = require('./analyticsEngine'); } catch (_) {} }
  return _analytics;
}
function _getObs() {
  if (!_obs) { try { _obs = require('./observabilityEngine'); } catch (_) {} }
  return _obs;
}

// ── Config ────────────────────────────────────────────────────────────────
const MAX_CONCURRENT     = parseInt(process.env.JOB_MAX_CONCURRENT || '5', 10);
const RESULT_TTL_MS      = parseInt(process.env.JOB_RESULT_TTL_HOURS || '24', 10) * 3600 * 1000;
const MAX_RETRIES_DEFAULT = 2;
const RETRY_BACKOFF_BASE  = 1000;   // 1 s base, exponential
const POLL_INTERVAL_MS    = 200;    // queue poll loop

// ── Priority levels ────────────────────────────────────────────────────────
const PRIORITY = { CRITICAL: 10, HIGH: 5, NORMAL: 3, LOW: 1, IDLE: 0 };

// ── State ─────────────────────────────────────────────────────────────────
const _emitter   = new EventEmitter();
_emitter.setMaxListeners(200);

const _queues    = new Map();    // queueName → JobRecord[] (priority-sorted)
const _workers   = new Map();    // queueName → { fn, opts }
const _jobs      = new Map();    // jobId     → JobRecord (hot cache)
const _recurring = new Map();    // name      → { fn, cronExpr, timer, lastRun }
const _active    = new Set();    // jobId of currently running jobs

let _totalEnqueued = 0;
let _totalCompleted = 0;
let _totalFailed    = 0;
let _io = null;   // Socket.IO reference, injected by server.js

// ── JobRecord schema ──────────────────────────────────────────────────────
/*
  JobRecord {
    jobId, queueName, status: waiting|active|completed|failed|cancelled,
    priority, data: {}, result: {}|null, error: string|null,
    progress: 0-100, logs: [{ ts, msg }],
    attempts, maxRetries, nextRetryAt,
    userId, pipeline, traceId,
    createdAt, startedAt, finishedAt
  }
*/

// ── Socket.IO inject ──────────────────────────────────────────────────────
function setSocketIO(io) { _io = io; }

function _emit(event, data) {
  _emitter.emit(event, data);
  if (_io) { try { _io.emit(event, data); } catch (_) {} }
}

// ─────────────────────────────────────────────────────────────────────────
// ENQUEUE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Enqueue a job for background processing.
 * @param {string} queueName   e.g. 'llm', 'export', 'import'
 * @param {object} data        Payload passed to the worker function
 * @param {object} opts        { priority?, maxRetries?, userId?, pipeline?, traceId?, jobId? }
 * @returns {JobRecord}
 */
function enqueue(queueName, data, opts = {}) {
  const jobId = opts.jobId || uuidv4();
  const job = {
    jobId,
    queueName,
    status:    'waiting',
    priority:  opts.priority   ?? PRIORITY.NORMAL,
    data:      data || {},
    result:    null,
    error:     null,
    progress:  0,
    logs:      [],
    attempts:  0,
    maxRetries: opts.maxRetries ?? MAX_RETRIES_DEFAULT,
    nextRetryAt: null,
    userId:    opts.userId   || 'anonymous',
    pipeline:  opts.pipeline || queueName,
    traceId:   opts.traceId  || null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };

  _jobs.set(jobId, job);
  _totalEnqueued++;

  // Add to queue (priority-sorted)
  const q = _queues.get(queueName) || [];
  q.push(jobId);
  q.sort((a, b) => (_jobs.get(b)?.priority ?? 0) - (_jobs.get(a)?.priority ?? 0));
  _queues.set(queueName, q);

  // Persist to DB
  _persistJob(job);

  // Track analytics
  _getAnalytics()?.track('job.queued', {
    userId: job.userId, pipeline: job.pipeline,
    properties: { jobId, queueName, priority: job.priority },
  });

  _emit('job:queued', { jobId, queueName, priority: job.priority });

  // Trigger processing
  setImmediate(() => _processQueue(queueName));

  return { ...job };
}

// ─────────────────────────────────────────────────────────────────────────
// WORKER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register an async worker function for a queue.
 * @param {string} queueName
 * @param {function} fn   async fn(job, { updateProgress, addLog }) → result
 * @param {object} opts   { concurrency? }
 */
function registerWorker(queueName, fn, opts = {}) {
  _workers.set(queueName, { fn, opts });
  // Process any waiting jobs immediately
  setImmediate(() => _processQueue(queueName));
}

// ─────────────────────────────────────────────────────────────────────────
// QUEUE PROCESSOR
// ─────────────────────────────────────────────────────────────────────────

async function _processQueue(queueName) {
  const worker = _workers.get(queueName);
  if (!worker) return;

  const q = _queues.get(queueName) || [];

  while (q.length > 0 && _active.size < MAX_CONCURRENT) {
    const jobId = q.shift();
    if (!jobId) continue;
    const job = _jobs.get(jobId);
    if (!job || job.status !== 'waiting') continue;

    _active.add(jobId);
    _runJob(job, worker.fn).finally(() => {
      _active.delete(jobId);
      setImmediate(() => _processQueue(queueName));
    });
  }
}

async function _runJob(job, fn) {
  // Start observability span
  const obs  = _getObs();
  const span = obs?.startSpan('job.execute', {
    traceId:  job.traceId,
    pipeline: job.pipeline,
    userId:   job.userId,
    tags:     ['job', job.queueName],
  });

  job.status    = 'active';
  job.startedAt = new Date().toISOString();
  job.attempts++;
  _persistJob(job);
  _emit('job:started', { jobId: job.jobId, queueName: job.queueName });

  const helpers = {
    updateProgress(pct, msg) {
      job.progress = Math.max(0, Math.min(100, pct));
      if (msg) job.logs.push({ ts: new Date().toISOString(), msg });
      _persistJob(job);
      _emit('job:progress', { jobId: job.jobId, progress: job.progress, log: msg });
    },
    addLog(msg) {
      job.logs.push({ ts: new Date().toISOString(), msg });
    },
  };

  try {
    const result = await fn({ ...job }, helpers);

    job.status     = 'completed';
    job.result     = result || null;
    job.progress   = 100;
    job.finishedAt = new Date().toISOString();
    _totalCompleted++;

    _persistJob(job);
    span?.finish({ status: 'ok' });

    _getAnalytics()?.track('job.completed', {
      userId: job.userId, pipeline: job.pipeline,
      properties: { jobId: job.jobId, attempts: job.attempts,
                    durationMs: job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0 },
    });

    _emit('job:completed', { jobId: job.jobId, result: job.result });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (job.attempts <= job.maxRetries) {
      // Schedule retry with exponential backoff
      const backoff = RETRY_BACKOFF_BASE * Math.pow(2, job.attempts - 1);
      job.status      = 'waiting';
      job.error       = errMsg;
      job.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      job.logs.push({ ts: new Date().toISOString(), msg: `Retry ${job.attempts}/${job.maxRetries} in ${backoff}ms: ${errMsg}` });

      const q = _queues.get(job.queueName) || [];
      q.push(job.jobId);
      _queues.set(job.queueName, q);

      setTimeout(() => _processQueue(job.queueName), backoff);
      _persistJob(job);
      span?.finish({ status: 'error', errorCode: 'RETRYING' });
      _emit('job:retried', { jobId: job.jobId, attempt: job.attempts, nextRetryAt: job.nextRetryAt });

    } else {
      job.status     = 'failed';
      job.error      = errMsg;
      job.finishedAt = new Date().toISOString();
      _totalFailed++;

      _persistJob(job);
      span?.finish({ status: 'error', errorCode: 'MAX_RETRIES' });

      _getAnalytics()?.track('job.failed', {
        userId: job.userId, pipeline: job.pipeline,
        properties: { jobId: job.jobId, attempts: job.attempts, error: errMsg },
      });

      _emit('job:failed', { jobId: job.jobId, error: errMsg });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// RECURRING JOBS (cron-like)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register a recurring job.
 * @param {string} name        Unique job name
 * @param {string|number} schedule  Cron expression OR millisecond interval
 * @param {function} fn        async fn() → any
 * @param {object} opts        { queueName?, priority?, immediate? }
 */
function registerRecurring(name, schedule, fn, opts = {}) {
  const queueName = opts.queueName || 'recurring';

  // Register a worker for this specific recurring job if not already present
  if (!_workers.has(queueName)) {
    registerWorker(queueName, async (job) => {
      const handler = _recurring.get(job.data.name);
      if (!handler) throw new Error(`No handler for recurring job: ${job.data.name}`);
      return handler.fn();
    });
  }

  const intervalMs = typeof schedule === 'number' ? schedule : _parseCron(schedule);

  const entry = {
    name, fn, schedule, intervalMs,
    lastRun: null, nextRun: null, runCount: 0,
    timer: null,
  };

  const runOnce = () => {
    entry.lastRun = new Date().toISOString();
    entry.runCount++;
    enqueue(queueName, { name }, { priority: opts.priority ?? PRIORITY.LOW, pipeline: `recurring:${name}` });
    entry.nextRun = new Date(Date.now() + intervalMs).toISOString();
  };

  if (opts.immediate) runOnce();
  entry.timer = setInterval(runOnce, intervalMs);
  entry.nextRun = new Date(Date.now() + intervalMs).toISOString();

  _recurring.set(name, entry);
  return entry;
}

/**
 * Very simple cron-to-ms parser (supports basic expressions only).
 * For complex cron, use node-cron in cronScheduler.js.
 */
function _parseCron(expr) {
  const presets = {
    '@hourly':  3600_000,
    '@daily':  86400_000,
    '@weekly': 604800_000,
  };
  return presets[expr] || 60_000;  // default 1 min
}

// ─────────────────────────────────────────────────────────────────────────
// JOB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

function getJob(jobId) {
  const job = _jobs.get(jobId);
  if (job) return { ...job };
  // Try DB
  const db = _getDb();
  if (!db?.db) return null;
  try {
    const r = db.db.prepare(`SELECT * FROM job_runs WHERE job_id=?`).get(jobId);
    return r ? _rowToJob(r) : null;
  } catch { return null; }
}

function cancelJob(jobId) {
  const job = _jobs.get(jobId);
  if (!job || job.status === 'completed' || job.status === 'failed') return false;
  job.status     = 'cancelled';
  job.finishedAt = new Date().toISOString();
  _persistJob(job);
  // Remove from queue
  for (const [qName, q] of _queues) {
    const idx = q.indexOf(jobId);
    if (idx !== -1) { q.splice(idx, 1); break; }
  }
  _emit('job:cancelled', { jobId });
  return true;
}

function retryJob(jobId) {
  const job = _jobs.get(jobId);
  if (!job || job.status !== 'failed') return null;
  job.status      = 'waiting';
  job.error       = null;
  job.attempts    = 0;
  job.progress    = 0;
  job.result      = null;
  job.startedAt   = null;
  job.finishedAt  = null;
  job.createdAt   = new Date().toISOString();

  const q = _queues.get(job.queueName) || [];
  q.push(jobId);
  _queues.set(job.queueName, q);
  _persistJob(job);
  setImmediate(() => _processQueue(job.queueName));
  return { ...job };
}

function listJobs(filter = {}) {
  let results = [..._jobs.values()];

  if (filter.status)    results = results.filter(j => j.status    === filter.status);
  if (filter.queueName) results = results.filter(j => j.queueName === filter.queueName);
  if (filter.userId)    results = results.filter(j => j.userId    === filter.userId);
  if (filter.pipeline)  results = results.filter(j => j.pipeline  === filter.pipeline);

  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results.slice(0, filter.limit || 100).map(j => ({ ...j }));
}

// ── EventEmitter subscription (for external listeners) ───────────────────
function on(event, fn)  { _emitter.on(event, fn); }
function off(event, fn) { _emitter.off(event, fn); }

// ─────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────

function getQueueStats() {
  const result = {};
  for (const [name, q] of _queues) {
    const waiting   = q.filter(id => _jobs.get(id)?.status === 'waiting').length;
    const active    = q.filter(id => _jobs.get(id)?.status === 'active').length;
    result[name] = { waiting, active, queueLength: q.length };
  }
  return result;
}

function stats() {
  return {
    totalEnqueued:  _totalEnqueued,
    totalCompleted: _totalCompleted,
    totalFailed:    _totalFailed,
    activeJobs:     _active.size,
    registeredQueues:  [..._queues.keys()],
    registeredWorkers: [..._workers.keys()],
    recurringJobs:  [..._recurring.values()].map(r => ({
      name: r.name, schedule: r.schedule, runCount: r.runCount,
      lastRun: r.lastRun, nextRun: r.nextRun,
    })),
    queueStats:     getQueueStats(),
    maxConcurrent:  MAX_CONCURRENT,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DB PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────

function _persistJob(job) {
  const db = _getDb();
  if (!db?.db) return;
  try {
    db.db.prepare(`
      INSERT INTO job_runs
        (job_id, queue_name, status, priority, data, result, error,
         progress, logs, attempts, max_retries, next_retry_at,
         user_id, pipeline, trace_id, created_at, started_at, finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET
        status=excluded.status, progress=excluded.progress,
        result=excluded.result, error=excluded.error,
        logs=excluded.logs, attempts=excluded.attempts,
        next_retry_at=excluded.next_retry_at,
        started_at=excluded.started_at, finished_at=excluded.finished_at
    `).run(
      job.jobId, job.queueName, job.status, job.priority,
      JSON.stringify(job.data), JSON.stringify(job.result), job.error,
      job.progress, JSON.stringify(job.logs),
      job.attempts, job.maxRetries, job.nextRetryAt,
      job.userId, job.pipeline, job.traceId,
      job.createdAt, job.startedAt, job.finishedAt
    );
  } catch (e) {
    console.warn('[JobEngine] Persist error:', e.message);
  }
}

function _rowToJob(r) {
  return {
    jobId:       r.job_id,      queueName:  r.queue_name,
    status:      r.status,      priority:   r.priority,
    data:        _safeJson(r.data, {}),
    result:      _safeJson(r.result, null),
    error:       r.error,
    progress:    r.progress,    logs:       _safeJson(r.logs, []),
    attempts:    r.attempts,    maxRetries: r.max_retries,
    nextRetryAt: r.next_retry_at,
    userId:      r.user_id,     pipeline:   r.pipeline,
    traceId:     r.trace_id,    createdAt:  r.created_at,
    startedAt:   r.started_at,  finishedAt: r.finished_at,
  };
}

function _safeJson(str, fallback) {
  if (str === null || str === undefined) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

/** Load waiting jobs from DB on boot (resume interrupted work). */
function _loadWaitingJobs() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    // Mark any active jobs as failed (they were interrupted by restart)
    db.db.prepare(`
      UPDATE job_runs SET status='failed', error='Server restarted', finished_at=datetime('now')
      WHERE status='active'
    `).run();
    // Load waiting jobs back into queue
    const rows = db.db.prepare(`
      SELECT * FROM job_runs WHERE status='waiting' ORDER BY priority DESC, created_at ASC LIMIT 200
    `).all();
    for (const r of rows) {
      const job = _rowToJob(r);
      _jobs.set(job.jobId, job);
      const q = _queues.get(job.queueName) || [];
      q.push(job.jobId);
      _queues.set(job.queueName, q);
    }
    if (rows.length > 0) console.log(`[JobEngine] Resumed ${rows.length} waiting jobs from DB`);
  } catch (e) {
    console.warn('[JobEngine] Load error:', e.message);
  }
}

/** Prune completed/failed jobs older than RESULT_TTL_MS from memory. */
function _pruneMemory() {
  const cutoff = Date.now() - RESULT_TTL_MS;
  for (const [id, job] of _jobs) {
    if ((job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
        && new Date(job.finishedAt).getTime() < cutoff) {
      _jobs.delete(id);
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
setImmediate(() => _loadWaitingJobs());
setInterval(() => _pruneMemory(), 10 * 60 * 1000);   // prune every 10 min

module.exports = {
  // Core
  enqueue,
  getJob,
  cancelJob,
  retryJob,
  listJobs,
  // Workers
  registerWorker,
  registerRecurring,
  // Events
  on,
  off,
  // Stats
  getQueueStats,
  stats,
  // Injection
  setSocketIO,
  // Constants
  PRIORITY,
};
