'use strict';
/**
 * analyticsEngine.js — Platform Layer: Analytics Event Tracking
 * ==============================================================
 * Phase 14 platform extension. Frozen engine core (aiConnector) untouched.
 *
 * Tracks business-level events with aggregation, funnels, and rollups.
 * Distinct from observabilityEngine (which tracks execution spans):
 *   Observability = HOW the engine ran (latency, fallback, error)
 *   Analytics     = WHAT happened (user created X, module generated Y, cost incurred Z)
 *
 * Event taxonomy:
 *   user.*          – login, signup, api_key_created
 *   session.*       – started, ended, turn_added
 *   pipeline.*      – run_started, run_completed, run_failed
 *   module.*        – generated, validated, exported
 *   storage.*       – asset_saved, asset_deleted
 *   cost.*          – incurred, budget_alert, daily_summary
 *   job.*           – queued, started, completed, failed, retried
 *   admin.*         – provider_registered, model_toggled, priority_changed, deploy_triggered
 *
 * Aggregations (computed in-memory, snapshotted to DB hourly):
 *   counters  – event.name → total count
 *   daily     – { date, event.name } → count (last 30 d)
 *   pipelines – pipeline → { runs, errors, totalCost, avgLatency }
 *   users     – userId → { events, lastSeen }
 *
 * Admin API surface (exported):
 *   track(eventName, fields)              → void (fire & forget)
 *   query(filter)                         → AnalyticsEvent[]
 *   getCounters()                         → { eventName: count }
 *   getPipelineStats()                    → PipelineStats[]
 *   getDailyTimeline(days, eventName?)    → [{ date, count }]
 *   getUserActivity(userId)               → UserActivity
 *   getCostSummary()                      → CostSummary
 *   getFunnel(steps[])                    → FunnelResult
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
const RING_SIZE          = 5000;
const FLUSH_INTERVAL_MS  = 5000;   // flush every 5 s
const SNAPSHOT_INTERVAL  = 60 * 60 * 1000;  // snapshot aggregations every hour
const RETENTION_DAYS     = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '30', 10);

// ── In-memory stores ──────────────────────────────────────────────────────
const _ring      = [];              // AnalyticsEvent[] ring buffer
const _pending   = [];              // unflushed events for DB batch
const _counters  = new Map();       // eventName → count
const _daily     = new Map();       // `${date}::${eventName}` → count
const _pipelines = new Map();       // pipelineName → PipelineAgg
const _users     = new Map();       // userId → UserAgg
const _costAgg   = {                // global cost aggregate
  totalUsd: 0, todayUsd: 0, _today: null,
  byPipeline: new Map(), byModel: new Map(),
};

let _totalTracked = 0;

// ── Types ─────────────────────────────────────────────────────────────────
/*
  AnalyticsEvent {
    eventId, eventName, userId, sessionId, pipeline,
    properties: {},   (free-form, indexable)
    value: number,    (numeric value, e.g. cost, latency, token count)
    ts
  }
  PipelineAgg {
    pipeline, runs, errors, totalCost, totalTokens, totalLatencyMs,
    lastRun, firstRun
  }
  UserAgg {
    userId, events, lastSeen, firstSeen, pipelines: Set<string>
  }
*/

// ── Helpers ───────────────────────────────────────────────────────────────
function _now() { return new Date().toISOString(); }
function _today() { return new Date().toISOString().slice(0, 10); }
function _safeJson(str, fallback) {
  if (str && typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Update aggregations (synchronous, O(1) per event) ────────────────────
function _updateAggs(ev) {
  // Counters
  _counters.set(ev.eventName, (_counters.get(ev.eventName) || 0) + 1);

  // Daily
  const dayKey = `${_today()}::${ev.eventName}`;
  _daily.set(dayKey, (_daily.get(dayKey) || 0) + 1);

  // Pipeline aggregation
  if (ev.pipeline && ev.pipeline !== 'unknown') {
    let pa = _pipelines.get(ev.pipeline);
    if (!pa) {
      pa = { pipeline: ev.pipeline, runs: 0, errors: 0, totalCost: 0, totalTokens: 0, totalLatencyMs: 0, lastRun: null, firstRun: null };
      _pipelines.set(ev.pipeline, pa);
    }
    if (ev.eventName.endsWith('.run_started') || ev.eventName.endsWith('.run_completed')) pa.runs++;
    if (ev.eventName.endsWith('.run_failed'))   pa.errors++;
    if (ev.properties?.costUsd)    pa.totalCost      += ev.properties.costUsd;
    if (ev.properties?.tokens)     pa.totalTokens    += ev.properties.tokens;
    if (ev.properties?.durationMs) pa.totalLatencyMs += ev.properties.durationMs;
    pa.lastRun  = ev.ts;
    pa.firstRun = pa.firstRun || ev.ts;
  }

  // User aggregation
  if (ev.userId && ev.userId !== 'anonymous') {
    let ua = _users.get(ev.userId);
    if (!ua) {
      ua = { userId: ev.userId, events: 0, lastSeen: null, firstSeen: ev.ts, pipelines: new Set() };
      _users.set(ev.userId, ua);
    }
    ua.events++;
    ua.lastSeen = ev.ts;
    if (ev.pipeline) ua.pipelines.add(ev.pipeline);
  }

  // Cost aggregation
  if (ev.eventName === 'cost.incurred' && ev.value) {
    _costAgg.totalUsd += ev.value;
    const today = _today();
    if (_costAgg._today !== today) { _costAgg.todayUsd = 0; _costAgg._today = today; }
    _costAgg.todayUsd += ev.value;
    if (ev.pipeline) {
      _costAgg.byPipeline.set(ev.pipeline, (_costAgg.byPipeline.get(ev.pipeline) || 0) + ev.value);
    }
    if (ev.properties?.model) {
      _costAgg.byModel.set(ev.properties.model, (_costAgg.byModel.get(ev.properties.model) || 0) + ev.value);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TRACK API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Track an analytics event. Fire & forget — never throws.
 * @param {string} eventName   e.g. 'pipeline.run_completed', 'cost.incurred'
 * @param {object} fields      { userId?, sessionId?, pipeline?, properties?, value? }
 */
function track(eventName, fields = {}) {
  try {
    const ev = {
      eventId:    uuidv4(),
      eventName,
      userId:     fields.userId     || 'anonymous',
      sessionId:  fields.sessionId  || null,
      pipeline:   fields.pipeline   || 'unknown',
      properties: fields.properties || {},
      value:      typeof fields.value === 'number' ? fields.value : 0,
      ts:         _now(),
    };

    _totalTracked++;
    _pushRing(ev);
    _pending.push(ev);
    _updateAggs(ev);
  } catch (e) {
    // Analytics must never throw
    console.warn('[AnalyticsEngine] track error:', e.message);
  }
}

function _pushRing(ev) {
  _ring.push(ev);
  if (_ring.length > RING_SIZE) _ring.shift();
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query events from the in-memory ring.
 * @param {object} filter { eventName?, userId?, pipeline?, from?, to?, limit? }
 */
function query(filter = {}) {
  let results = [..._ring].reverse();

  if (filter.eventName) {
    const prefix = filter.eventName.endsWith('*');
    const base   = filter.eventName.replace('*', '');
    results = prefix
      ? results.filter(e => e.eventName.startsWith(base))
      : results.filter(e => e.eventName === filter.eventName);
  }
  if (filter.userId)   results = results.filter(e => e.userId   === filter.userId);
  if (filter.pipeline) results = results.filter(e => e.pipeline === filter.pipeline);
  if (filter.from)     results = results.filter(e => e.ts >= filter.from);
  if (filter.to)       results = results.filter(e => e.ts <= filter.to);

  return results.slice(0, filter.limit || 100);
}

/**
 * Get current counter values.
 */
function getCounters() {
  return Object.fromEntries(_counters);
}

/**
 * Get per-pipeline aggregated stats.
 */
function getPipelineStats() {
  return [..._pipelines.values()].map(pa => ({
    ...pa,
    avgLatencyMs: pa.runs > 0 ? Math.round(pa.totalLatencyMs / pa.runs) : 0,
    errorRate:    pa.runs > 0 ? (pa.errors / pa.runs) : 0,
  }));
}

/**
 * Get daily timeline for an event (or all events).
 * @param {number} days   How many days back
 * @param {string?} eventName  Specific event or omit for total
 */
function getDailyTimeline(days = 7, eventName = null) {
  const timeline = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);

    if (eventName) {
      const count = _daily.get(`${date}::${eventName}`) || 0;
      timeline.push({ date, count });
    } else {
      // Sum all events for that day
      let count = 0;
      for (const [key, val] of _daily) {
        if (key.startsWith(date + '::')) count += val;
      }
      timeline.push({ date, count });
    }
  }
  return timeline;
}

/**
 * Get activity summary for a specific user.
 */
function getUserActivity(userId) {
  const ua = _users.get(userId);
  if (!ua) return null;
  return {
    userId:    ua.userId,
    events:    ua.events,
    firstSeen: ua.firstSeen,
    lastSeen:  ua.lastSeen,
    pipelines: [...ua.pipelines],
    recentEvents: query({ userId, limit: 20 }),
  };
}

/**
 * Get cost summary.
 */
function getCostSummary() {
  return {
    totalUsd: _costAgg.totalUsd,
    todayUsd: _costAgg.todayUsd,
    byPipeline: Object.fromEntries(_costAgg.byPipeline),
    byModel:    Object.fromEntries(_costAgg.byModel),
    timeline:   getDailyTimeline(7, 'cost.incurred'),
  };
}

/**
 * Simple funnel analysis.
 * @param {string[]} steps  Ordered event names, e.g. ['session.started','pipeline.run_started','module.generated']
 * @param {object}  opts    { userId?, window?: 'day'|'session' }
 */
function getFunnel(steps, opts = {}) {
  if (!steps || steps.length < 2) return { steps: [], conversion: [] };

  const events = opts.userId
    ? query({ userId: opts.userId, limit: 2000 })
    : [..._ring].slice(-2000);

  const counts = steps.map(() => 0);
  const seen   = new Set();

  for (let i = 0; i < steps.length; i++) {
    for (const ev of events) {
      if (ev.eventName === steps[i]) {
        const key = `${ev.userId || '?'}::${i}`;
        if (!seen.has(key)) {
          counts[i]++;
          seen.add(key);
        }
      }
    }
  }

  return {
    steps: steps.map((name, i) => ({
      step:    i + 1,
      name,
      count:   counts[i],
      dropOff: i > 0 && counts[i - 1] > 0
        ? ((counts[i - 1] - counts[i]) / counts[i - 1] * 100).toFixed(1) + '%'
        : null,
    })),
    overallConversion: counts[0] > 0
      ? ((counts[counts.length - 1] / counts[0]) * 100).toFixed(1) + '%'
      : '0%',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DB FLUSH
// ─────────────────────────────────────────────────────────────────────────

function _flush() {
  const db = _getDb();
  if (!db?.db || _pending.length === 0) return;
  const batch = _pending.splice(0);

  try {
    const insertEvt = db.db.prepare(`
      INSERT OR IGNORE INTO analytics_events
        (event_id, event_name, user_id, session_id, pipeline, properties, value, ts)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const txn = db.db.transaction(() => {
      for (const e of batch) {
        insertEvt.run(
          e.eventId, e.eventName, e.userId, e.sessionId,
          e.pipeline, JSON.stringify(e.properties), e.value, e.ts
        );
      }
    });
    txn();
  } catch (e) {
    console.warn('[AnalyticsEngine] Flush error:', e.message);
  }
}

/**
 * Persist aggregation snapshot to DB (called hourly).
 * Allows dashboards to reconstruct historical data after restart.
 */
function _snapshotAggs() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    const upsert = db.db.prepare(`
      INSERT INTO analytics_agg_snapshots (snapshot_key, snapshot_value, snapped_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(snapshot_key) DO UPDATE SET
        snapshot_value=excluded.snapshot_value, snapped_at=excluded.snapped_at
    `);
    const txn = db.db.transaction(() => {
      upsert.run('counters',      JSON.stringify(Object.fromEntries(_counters)));
      upsert.run('pipelineStats', JSON.stringify(getPipelineStats()));
      upsert.run('costSummary',   JSON.stringify({
        totalUsd: _costAgg.totalUsd, todayUsd: _costAgg.todayUsd,
        byPipeline: Object.fromEntries(_costAgg.byPipeline),
        byModel:    Object.fromEntries(_costAgg.byModel),
      }));
    });
    txn();
  } catch (e) {
    console.warn('[AnalyticsEngine] Snapshot error:', e.message);
  }
}

/** Load last snapshot from DB on boot (restore counters after restart). */
function _loadSnapshot() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    const rows = db.db.prepare(`SELECT * FROM analytics_agg_snapshots`).all();
    for (const r of rows) {
      const val = _safeJson(r.snapshot_value, null);
      if (!val) continue;
      if (r.snapshot_key === 'counters') {
        for (const [k, v] of Object.entries(val)) _counters.set(k, v);
      }
      if (r.snapshot_key === 'costSummary') {
        _costAgg.totalUsd = val.totalUsd || 0;
        _costAgg.todayUsd = val.todayUsd || 0;
        if (val.byPipeline) for (const [k, v] of Object.entries(val.byPipeline)) _costAgg.byPipeline.set(k, v);
        if (val.byModel)    for (const [k, v] of Object.entries(val.byModel))    _costAgg.byModel.set(k, v);
      }
    }
    // Load recent daily events for timeline reconstruction
    const recent = db.db.prepare(`
      SELECT date(ts) as day, event_name, COUNT(*) as cnt
      FROM analytics_events
      WHERE ts > datetime('now','-30 days')
      GROUP BY day, event_name
    `).all();
    for (const r of recent) {
      const key = `${r.day}::${r.event_name}`;
      _daily.set(key, (_daily.get(key) || 0) + r.cnt);
    }
    console.log(`[AnalyticsEngine] Snapshot loaded: ${_counters.size} counters, ${_daily.size} daily keys`);
  } catch (e) {
    console.warn('[AnalyticsEngine] Snapshot load error:', e.message);
  }
}

// ── Retention cleanup ─────────────────────────────────────────────────────
function _runRetention() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    db.db.prepare(`DELETE FROM analytics_events WHERE ts < datetime('now','-${RETENTION_DAYS} days')`).run();
  } catch (e) {
    console.warn('[AnalyticsEngine] Retention error:', e.message);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
function stats() {
  return {
    totalTracked:  _totalTracked,
    ringSize:      _ring.length,
    counters:      _counters.size,
    pipelines:     _pipelines.size,
    users:         _users.size,
    pendingFlush:  _pending.length,
    costTotal:     _costAgg.totalUsd,
    costToday:     _costAgg.todayUsd,
    retentionDays: RETENTION_DAYS,
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
setImmediate(() => _loadSnapshot());
setInterval(() => _flush(),          FLUSH_INTERVAL_MS);
setInterval(() => _snapshotAggs(),   SNAPSHOT_INTERVAL);
setInterval(() => _runRetention(),   24 * 60 * 60 * 1000);
process.on('SIGTERM', () => { _flush(); _snapshotAggs(); });
process.on('SIGINT',  () => { _flush(); _snapshotAggs(); });

module.exports = {
  track,
  query,
  getCounters,
  getPipelineStats,
  getDailyTimeline,
  getUserActivity,
  getCostSummary,
  getFunnel,
  stats,
  flush: _flush,
};
