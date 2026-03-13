'use strict';
/**
 * observabilityEngine.js — Platform Layer: Structured Execution & Event Logging
 * ===============================================================================
 * Phase 14 platform extension. Frozen engine core (aiConnector) untouched.
 *
 * Provides structured, queryable execution tracing for every pipeline call:
 *   SPAN     – a single timed operation (callLLM, pipeline run, tool call, etc.)
 *   TRACE    – a tree of spans belonging to one top-level request
 *   EVENT    – discrete instantaneous fact (error, fallback, cache hit, etc.)
 *
 * Design principles:
 *   • Zero overhead on hot path: async ring buffer, never blocks callLLM
 *   • Structured fields only: all entries are machine-parseable JSON rows
 *   • DB persistence: SQLite via obs_spans / obs_events tables
 *   • Admin queryable: filter by traceId, pipeline, status, time range
 *
 * Admin API surface (exported):
 *   startSpan(name, fields)    → span (call span.finish(fields?) to close)
 *   startTrace(name, fields)   → trace (wraps root span)
 *   logEvent(name, fields)     → void
 *   querySpans(filter)         → SpanRecord[]
 *   queryEvents(filter)        → EventRecord[]
 *   getTrace(traceId)          → { trace, spans[], events[] }
 *   stats()
 */

const { v4: uuidv4 } = require('uuid');

// ── DB (lazy) ─────────────────────────────────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) { try { _db = require('../db/database'); } catch (_) {} }
  return _db;
}

// ── Config ────────────────────────────────────────────────────────────────
const RING_BUFFER_SIZE  = 2000;   // in-memory ring buffer for hot queries
const FLUSH_INTERVAL_MS = 3000;   // flush to DB every 3 s
const RETENTION_DAYS    = parseInt(process.env.OBS_RETENTION_DAYS || '7', 10);

// ── Ring buffers ──────────────────────────────────────────────────────────
const _spanRing  = [];   // SpanRecord[]   (circular, most recent at tail)
const _eventRing = [];   // EventRecord[]  (circular, most recent at tail)
const _pending   = { spans: [], events: [] };   // unflushed batch

let _totalSpans  = 0;
let _totalEvents = 0;
let _errorCount  = 0;
let _fallbackCount = 0;

// ── Types ─────────────────────────────────────────────────────────────────
/*
  SpanRecord {
    spanId, traceId, parentSpanId,
    name, status: 'ok'|'error'|'timeout',
    pipeline, userId, model, provider, taskType,
    startedAt, finishedAt, durationMs,
    inputTokens, outputTokens, costUsd,
    isFallback, fromCache, errorCode,
    tags: string[],
    meta: {}
  }
  EventRecord {
    eventId, traceId, spanId?,
    name, level: 'info'|'warn'|'error',
    pipeline, userId,
    message, data: {},
    ts
  }
*/

// ── Ring buffer helpers ────────────────────────────────────────────────────
function _pushRing(ring, item) {
  ring.push(item);
  if (ring.length > RING_BUFFER_SIZE) ring.shift();
}

// ─────────────────────────────────────────────────────────────────────────
// SPAN API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Start a new span. Returns a Span handle with a .finish(fields?) method.
 *
 * Usage:
 *   const span = obs.startSpan('callLLM', { traceId, pipeline, userId });
 *   // ... do work ...
 *   span.finish({ model, provider, inputTokens, outputTokens, costUsd });
 */
function startSpan(name, fields = {}) {
  const spanId   = uuidv4();
  const traceId  = fields.traceId || uuidv4();
  const startMs  = Date.now();
  const startedAt = new Date().toISOString();

  const span = {
    spanId,
    traceId,
    parentSpanId: fields.parentSpanId || null,
    name,
    status:    'ok',
    pipeline:  fields.pipeline  || 'unknown',
    userId:    fields.userId    || 'anonymous',
    model:     fields.model     || null,
    provider:  fields.provider  || null,
    taskType:  fields.taskType  || null,
    startedAt,
    finishedAt: null,
    durationMs: null,
    inputTokens:  0,
    outputTokens: 0,
    costUsd:      0,
    isFallback:   false,
    fromCache:    false,
    errorCode:    null,
    tags:         Array.isArray(fields.tags) ? fields.tags : [],
    meta:         fields.meta || {},
    _startMs:     startMs,
    // Attached finish method
    finish(endFields = {}) {
      const durationMs  = Date.now() - startMs;
      span.finishedAt   = new Date().toISOString();
      span.durationMs   = durationMs;
      span.status       = endFields.status    || (endFields.errorCode ? 'error' : 'ok');
      span.model        = endFields.model     || span.model;
      span.provider     = endFields.provider  || span.provider;
      span.taskType     = endFields.taskType  || span.taskType;
      span.inputTokens  = endFields.inputTokens  || 0;
      span.outputTokens = endFields.outputTokens || 0;
      span.costUsd      = endFields.costUsd   || 0;
      span.isFallback   = endFields.isFallback || false;
      span.fromCache    = endFields.fromCache  || false;
      span.errorCode    = endFields.errorCode  || null;
      if (endFields.tags)  span.tags.push(...endFields.tags);
      if (endFields.meta)  Object.assign(span.meta, endFields.meta);

      _recordSpan(span);
      return span;
    },
  };

  return span;
}

/**
 * Start a root trace (wraps startSpan, provides convenient child span factory).
 */
function startTrace(name, fields = {}) {
  const traceId = uuidv4();
  const rootSpan = startSpan(name, { ...fields, traceId });

  return {
    traceId,
    rootSpan,
    childSpan(childName, childFields = {}) {
      return startSpan(childName, { ...childFields, traceId, parentSpanId: rootSpan.spanId });
    },
    finish(endFields = {}) {
      return rootSpan.finish(endFields);
    },
  };
}

function _recordSpan(span) {
  _totalSpans++;
  if (span.status === 'error') _errorCount++;
  if (span.isFallback) _fallbackCount++;

  // Clean copy (no internal _ fields)
  const record = { ...span };
  delete record._startMs;
  delete record.finish;

  _pushRing(_spanRing, record);
  _pending.spans.push(record);
}

// ─────────────────────────────────────────────────────────────────────────
// EVENT API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Log an instantaneous event.
 * @param {string} name          e.g. 'cache.hit', 'provider.fallback', 'model.disabled'
 * @param {object} fields        { traceId?, spanId?, level?, pipeline?, userId?, message, data? }
 */
function logEvent(name, fields = {}) {
  const event = {
    eventId:  uuidv4(),
    traceId:  fields.traceId  || null,
    spanId:   fields.spanId   || null,
    name,
    level:    fields.level    || 'info',
    pipeline: fields.pipeline || 'unknown',
    userId:   fields.userId   || 'anonymous',
    message:  fields.message  || name,
    data:     fields.data     || {},
    ts:       new Date().toISOString(),
  };

  _totalEvents++;
  if (event.level === 'error') _errorCount++;

  _pushRing(_eventRing, event);
  _pending.events.push(event);
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query spans from the in-memory ring (fast, recent data only).
 * For historical queries, use DB directly.
 * @param {object} filter { traceId?, pipeline?, status?, provider?, limit? }
 */
function querySpans(filter = {}) {
  let results = [..._spanRing].reverse();  // most recent first

  if (filter.traceId)  results = results.filter(s => s.traceId  === filter.traceId);
  if (filter.pipeline) results = results.filter(s => s.pipeline === filter.pipeline);
  if (filter.status)   results = results.filter(s => s.status   === filter.status);
  if (filter.provider) results = results.filter(s => s.provider === filter.provider);
  if (filter.userId)   results = results.filter(s => s.userId   === filter.userId);
  if (filter.minDurationMs !== undefined) {
    results = results.filter(s => (s.durationMs || 0) >= filter.minDurationMs);
  }

  return results.slice(0, filter.limit || 50);
}

/**
 * Query events from ring buffer.
 */
function queryEvents(filter = {}) {
  let results = [..._eventRing].reverse();

  if (filter.traceId)  results = results.filter(e => e.traceId  === filter.traceId);
  if (filter.name)     results = results.filter(e => e.name     === filter.name);
  if (filter.level)    results = results.filter(e => e.level    === filter.level);
  if (filter.pipeline) results = results.filter(e => e.pipeline === filter.pipeline);
  if (filter.userId)   results = results.filter(e => e.userId   === filter.userId);

  return results.slice(0, filter.limit || 100);
}

/**
 * Get full trace (root span + all child spans + all events).
 */
function getTrace(traceId) {
  const spans  = _spanRing.filter(s => s.traceId === traceId)
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const events = _eventRing.filter(e => e.traceId === traceId)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  if (spans.length === 0 && events.length === 0) {
    // Try DB
    const db = _getDb();
    if (!db?.db) return null;
    try {
      const dbSpans  = db.db.prepare(`SELECT * FROM obs_spans  WHERE trace_id=? ORDER BY started_at`).all(traceId);
      const dbEvents = db.db.prepare(`SELECT * FROM obs_events WHERE trace_id=? ORDER BY ts`).all(traceId);
      return {
        traceId,
        spans:  dbSpans.map(_rowToSpan),
        events: dbEvents.map(_rowToEvent),
      };
    } catch { return null; }
  }

  return { traceId, spans, events };
}

function _rowToSpan(r) {
  return {
    spanId: r.span_id, traceId: r.trace_id, parentSpanId: r.parent_span_id,
    name: r.name, status: r.status, pipeline: r.pipeline, userId: r.user_id,
    model: r.model, provider: r.provider, taskType: r.task_type,
    startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd,
    isFallback: !!r.is_fallback, fromCache: !!r.from_cache, errorCode: r.error_code,
    tags: _safeJson(r.tags, []), meta: _safeJson(r.meta, {}),
  };
}
function _rowToEvent(r) {
  return {
    eventId: r.event_id, traceId: r.trace_id, spanId: r.span_id,
    name: r.name, level: r.level, pipeline: r.pipeline, userId: r.user_id,
    message: r.message, data: _safeJson(r.data, {}), ts: r.ts,
  };
}
function _safeJson(str, fallback) {
  if (str && typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────
// DB FLUSH (async batch write)
// ─────────────────────────────────────────────────────────────────────────

function _flush() {
  const db = _getDb();
  if (!db?.db) return;
  if (_pending.spans.length === 0 && _pending.events.length === 0) return;

  const spans  = _pending.spans.splice(0);
  const events = _pending.events.splice(0);

  try {
    const insertSpan = db.db.prepare(`
      INSERT OR IGNORE INTO obs_spans
        (span_id, trace_id, parent_span_id, name, status, pipeline, user_id,
         model, provider, task_type, started_at, finished_at, duration_ms,
         input_tokens, output_tokens, cost_usd, is_fallback, from_cache,
         error_code, tags, meta)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertEvent = db.db.prepare(`
      INSERT OR IGNORE INTO obs_events
        (event_id, trace_id, span_id, name, level, pipeline, user_id, message, data, ts)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);

    const txn = db.db.transaction(() => {
      for (const s of spans) {
        insertSpan.run(
          s.spanId, s.traceId, s.parentSpanId, s.name, s.status,
          s.pipeline, s.userId, s.model, s.provider, s.taskType,
          s.startedAt, s.finishedAt, s.durationMs,
          s.inputTokens, s.outputTokens, s.costUsd,
          s.isFallback ? 1 : 0, s.fromCache ? 1 : 0,
          s.errorCode,
          JSON.stringify(s.tags), JSON.stringify(s.meta)
        );
      }
      for (const e of events) {
        insertEvent.run(
          e.eventId, e.traceId, e.spanId, e.name, e.level,
          e.pipeline, e.userId, e.message, JSON.stringify(e.data), e.ts
        );
      }
    });
    txn();
  } catch (e) {
    console.warn('[ObservabilityEngine] Flush error:', e.message);
  }
}

// ── Expiry cleanup (delete data older than RETENTION_DAYS) ────────────────
function _runRetention() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    const cutoff = `datetime('now','-${RETENTION_DAYS} days')`;
    db.db.prepare(`DELETE FROM obs_spans  WHERE started_at < ${cutoff}`).run();
    db.db.prepare(`DELETE FROM obs_events WHERE ts          < ${cutoff}`).run();
  } catch (e) {
    console.warn('[ObservabilityEngine] Retention cleanup error:', e.message);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
function stats() {
  const recent = _spanRing.slice(-100);
  const avgDuration = recent.length
    ? Math.round(recent.reduce((s, r) => s + (r.durationMs || 0), 0) / recent.length)
    : 0;
  const p95 = recent.length >= 5
    ? [...recent].sort((a,b) => (a.durationMs||0)-(b.durationMs||0))[Math.floor(recent.length * 0.95)]?.durationMs || 0
    : 0;

  return {
    totalSpans:    _totalSpans,
    totalEvents:   _totalEvents,
    errorCount:    _errorCount,
    fallbackCount: _fallbackCount,
    ringSpans:     _spanRing.length,
    ringEvents:    _eventRing.length,
    pendingFlush:  _pending.spans.length + _pending.events.length,
    avgDurationMs: avgDuration,
    p95DurationMs: p95,
    retentionDays: RETENTION_DAYS,
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
setInterval(() => _flush(), FLUSH_INTERVAL_MS);
setInterval(() => _runRetention(), 6 * 60 * 60 * 1000);   // every 6 hours
process.on('SIGTERM', () => _flush());
process.on('SIGINT',  () => _flush());

module.exports = {
  startSpan,
  startTrace,
  logEvent,
  querySpans,
  queryEvents,
  getTrace,
  stats,
  flush: _flush,
};
