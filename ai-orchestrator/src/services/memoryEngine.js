'use strict';
/**
 * memoryEngine.js — Platform Layer: Session / Workspace / User Memory
 * =====================================================================
 * Phase 14 platform extension. Frozen engine core (aiConnector) untouched.
 *
 * Three-scope memory model:
 *   SESSION   – per-request turn buffer + summary (TTL-based, LRU evicted)
 *   WORKSPACE – persistent named context shared across sessions for a user
 *   USER      – long-term profile: preferences, patterns, stats
 *
 * Persistence:
 *   Hot path → in-memory Maps (zero-latency reads on every callLLM)
 *   Warm path → SQLite (survive PM2 restart; loaded at boot)
 *   Flush     → on write + SIGTERM (debounced 2 s)
 *
 * Admin API surface (exported):
 *   getSessionContext(sessionId)        → messages[] for callLLM injection
 *   appendTurn(sessionId, role, text, meta)
 *   summariseSession(sessionId)         → collapses old turns to summary
 *   getWorkspace(userId, wsName)        → workspace object
 *   upsertWorkspace(userId, wsName, patch)
 *   getUserProfile(userId)              → profile object
 *   patchUserProfile(userId, patch)
 *   listSessions(userId)
 *   deleteSession(sessionId)
 *   stats()
 */

const path = require('path');

// ── DB (lazy load to prevent circular deps) ────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) { try { _db = require('../db/database'); } catch (_) {} }
  return _db;
}

// ── Constants ──────────────────────────────────────────────────────────────
const SESSION_TTL_MS     = 30 * 60 * 1000;   // 30 min idle → evict
const SESSION_MAX_TURNS  = 40;                // turns kept hot before summary
const SESSION_SUMMARY_AT = 30;               // summarise when turns >= this
const MAX_HOT_SESSIONS   = 2000;             // LRU cap for in-memory map
const WORKSPACE_MAX_KEYS = 100;              // max context keys per workspace

// ── In-memory stores ──────────────────────────────────────────────────────
const _sessions   = new Map();   // sessionId → SessionEntry
const _workspaces = new Map();   // `${userId}::${wsName}` → WorkspaceEntry
const _profiles   = new Map();   // userId → ProfileEntry

let _sessionHits  = 0;
let _sessionMisses = 0;
let _totalTurns   = 0;

// ── Types ─────────────────────────────────────────────────────────────────
/*
  SessionEntry {
    sessionId, userId, pipeline,
    turns: [{ role, content, ts, meta }],
    summary: string | null,
    createdAt, lastUsed, turnCount
  }
  WorkspaceEntry {
    userId, wsName, context: { key: value },
    createdAt, updatedAt
  }
  ProfileEntry {
    userId,
    preferences: { style, language, tone, ... },
    patterns:    { taskType: count, ... },
    stats:       { totalSessions, totalTurns, totalCost },
    createdAt, updatedAt
  }
*/

// ── Boot: load persisted state from SQLite ────────────────────────────────
function _loadFromDb() {
  const db = _getDb();
  if (!db || !db.db) return;
  try {
    // Load recent sessions (last 24 h)
    const rows = db.db.prepare(`
      SELECT * FROM mem_sessions
      WHERE last_used > datetime('now','-1 day')
      ORDER BY last_used DESC LIMIT 500
    `).all();
    for (const r of rows) {
      _sessions.set(r.session_id, {
        sessionId: r.session_id, userId: r.user_id, pipeline: r.pipeline,
        turns:     _safeJson(r.turns,   []),
        summary:   r.summary || null,
        createdAt: r.created_at, lastUsed: r.last_used,
        turnCount: r.turn_count || 0,
        _dirty: false,
      });
    }
    // Load all workspaces
    const wsRows = db.db.prepare(`SELECT * FROM mem_workspaces`).all();
    for (const r of wsRows) {
      const key = `${r.user_id}::${r.ws_name}`;
      _workspaces.set(key, {
        userId: r.user_id, wsName: r.ws_name,
        context:   _safeJson(r.context, {}),
        createdAt: r.created_at, updatedAt: r.updated_at,
        _dirty: false,
      });
    }
    // Load user profiles
    const profRows = db.db.prepare(`SELECT * FROM mem_user_profiles`).all();
    for (const r of profRows) {
      _profiles.set(r.user_id, {
        userId:      r.user_id,
        preferences: _safeJson(r.preferences, {}),
        patterns:    _safeJson(r.patterns,    {}),
        stats:       _safeJson(r.stats,       { totalSessions:0, totalTurns:0, totalCost:0 }),
        createdAt:   r.created_at, updatedAt: r.updated_at,
        _dirty: false,
      });
    }
    console.log(`[MemoryEngine] Loaded: ${_sessions.size} sessions, ${_workspaces.size} workspaces, ${_profiles.size} profiles`);
  } catch (e) {
    console.warn('[MemoryEngine] Boot load error:', e.message);
  }
}

// ── Persist dirty entries to SQLite (debounced) ───────────────────────────
let _flushTimer = null;
function _schedulFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => { _flushTimer = null; _flush(); }, 2000);
}

function _flush() {
  const db = _getDb();
  if (!db || !db.db) return;
  try {
    const flushSessions = db.db.prepare(`
      INSERT INTO mem_sessions
        (session_id, user_id, pipeline, turns, summary, turn_count, created_at, last_used)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
        turns=excluded.turns, summary=excluded.summary,
        turn_count=excluded.turn_count, last_used=excluded.last_used
    `);
    const flushWs = db.db.prepare(`
      INSERT INTO mem_workspaces (user_id, ws_name, context, created_at, updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(user_id, ws_name) DO UPDATE SET
        context=excluded.context, updated_at=excluded.updated_at
    `);
    const flushProf = db.db.prepare(`
      INSERT INTO mem_user_profiles
        (user_id, preferences, patterns, stats, created_at, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET
        preferences=excluded.preferences, patterns=excluded.patterns,
        stats=excluded.stats, updated_at=excluded.updated_at
    `);

    const txn = db.db.transaction(() => {
      for (const s of _sessions.values()) {
        if (!s._dirty) continue;
        flushSessions.run(
          s.sessionId, s.userId, s.pipeline,
          JSON.stringify(s.turns), s.summary, s.turnCount,
          s.createdAt, s.lastUsed
        );
        s._dirty = false;
      }
      for (const w of _workspaces.values()) {
        if (!w._dirty) continue;
        flushWs.run(w.userId, w.wsName, JSON.stringify(w.context), w.createdAt, w.updatedAt);
        w._dirty = false;
      }
      for (const p of _profiles.values()) {
        if (!p._dirty) continue;
        flushProf.run(
          p.userId, JSON.stringify(p.preferences), JSON.stringify(p.patterns),
          JSON.stringify(p.stats), p.createdAt, p.updatedAt
        );
        p._dirty = false;
      }
    });
    txn();
  } catch (e) {
    console.warn('[MemoryEngine] Flush error:', e.message);
  }
}
process.on('SIGTERM', () => _flush());
process.on('SIGINT',  () => _flush());

// ── LRU eviction ─────────────────────────────────────────────────────────
function _evictSessions() {
  if (_sessions.size < MAX_HOT_SESSIONS) return;
  const now = Date.now();
  // Evict expired first
  for (const [id, s] of _sessions) {
    if (now - new Date(s.lastUsed).getTime() > SESSION_TTL_MS) {
      _sessions.delete(id);
    }
  }
  // If still over limit, evict LRU
  if (_sessions.size >= MAX_HOT_SESSIONS) {
    const sorted = [..._sessions.entries()]
      .sort(([, a], [, b]) => new Date(a.lastUsed) - new Date(b.lastUsed));
    const toEvict = sorted.slice(0, Math.floor(MAX_HOT_SESSIONS * 0.2));
    for (const [id] of toEvict) _sessions.delete(id);
  }
}

// ── Helper ────────────────────────────────────────────────────────────────
function _safeJson(str, fallback) {
  if (str && typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}
function _now() { return new Date().toISOString(); }

// ─────────────────────────────────────────────────────────────────────────
// SESSION API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get or create session. Returns SessionEntry.
 * @param {string} sessionId
 * @param {object} opts  { userId?, pipeline? }
 */
function _getOrCreateSession(sessionId, opts = {}) {
  if (_sessions.has(sessionId)) {
    const s = _sessions.get(sessionId);
    s.lastUsed = _now();
    _sessionHits++;
    return s;
  }
  _sessionMisses++;
  _evictSessions();
  const s = {
    sessionId,
    userId:    opts.userId   || 'anonymous',
    pipeline:  opts.pipeline || 'unknown',
    turns:     [],
    summary:   null,
    createdAt: _now(),
    lastUsed:  _now(),
    turnCount: 0,
    _dirty:    true,
  };
  _sessions.set(sessionId, s);
  return s;
}

/**
 * Append a conversation turn.
 * @param {string} sessionId
 * @param {'user'|'assistant'|'system'} role
 * @param {string} content
 * @param {object} meta  { taskType?, model?, provider?, qualityScore?, pipeline? }
 */
function appendTurn(sessionId, role, content, meta = {}, opts = {}) {
  const s = _getOrCreateSession(sessionId, opts);
  s.turns.push({ role, content: content.slice(0, 4000), ts: _now(), meta });
  s.turnCount++;
  s.lastUsed = _now();
  _totalTurns++;
  s._dirty = true;

  // Update user profile patterns
  if (meta.taskType && s.userId !== 'anonymous') {
    const p = _getOrCreateProfile(s.userId);
    p.patterns[meta.taskType] = (p.patterns[meta.taskType] || 0) + 1;
    if (meta.cost) p.stats.totalCost = (p.stats.totalCost || 0) + meta.cost;
    p.stats.totalTurns = (p.stats.totalTurns || 0) + 1;
    p._dirty = true;
  }

  // Auto-summarise when too many turns
  if (s.turns.length >= SESSION_SUMMARY_AT) {
    _compactSession(s);
  }

  _schedulFlush();
  return s;
}

/**
 * Compact old turns into a rolling summary (keeps last 10 turns hot).
 */
function _compactSession(s) {
  const keepTail = 10;
  const toSummarise = s.turns.slice(0, s.turns.length - keepTail);
  const tail        = s.turns.slice(-keepTail);
  const lines       = toSummarise.map(t => `${t.role}: ${t.content.slice(0, 200)}`).join('\n');
  const prevSummary = s.summary ? `Previous summary: ${s.summary}\n\n` : '';
  s.summary = `${prevSummary}[Compacted ${toSummarise.length} turns]\n${lines.slice(0, 1500)}`;
  s.turns    = tail;
  s._dirty   = true;
}

/**
 * Build context array for callLLM injection.
 * Returns [{role, content}] prepending summary as system message if present.
 */
function getSessionContext(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s) return [];
  const ctx = [];
  if (s.summary) {
    ctx.push({ role: 'system', content: `Conversation context:\n${s.summary}` });
  }
  ctx.push(...s.turns.map(t => ({ role: t.role, content: t.content })));
  return ctx;
}

/**
 * Manually trigger session summarisation (admin use).
 */
function summariseSession(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s || s.turns.length === 0) return null;
  _compactSession(s);
  _schedulFlush();
  return { sessionId, summary: s.summary, remainingTurns: s.turns.length };
}

/**
 * List all sessions for a user.
 */
function listSessions(userId) {
  const result = [];
  for (const s of _sessions.values()) {
    if (s.userId === userId) {
      result.push({
        sessionId: s.sessionId, pipeline: s.pipeline,
        turnCount: s.turnCount, createdAt: s.createdAt, lastUsed: s.lastUsed,
        hasSummary: !!s.summary,
      });
    }
  }
  return result.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
}

function deleteSession(sessionId) {
  const existed = _sessions.has(sessionId);
  _sessions.delete(sessionId);
  if (existed) {
    const db = _getDb();
    if (db?.db) {
      try { db.db.prepare(`DELETE FROM mem_sessions WHERE session_id=?`).run(sessionId); } catch (_) {}
    }
  }
  return existed;
}

function getSession(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s) return null;
  return {
    sessionId: s.sessionId, userId: s.userId, pipeline: s.pipeline,
    turnCount: s.turnCount, turns: s.turns.slice(-20),
    summary: s.summary, createdAt: s.createdAt, lastUsed: s.lastUsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// WORKSPACE API
// ─────────────────────────────────────────────────────────────────────────

function _wsKey(userId, wsName) { return `${userId}::${wsName}`; }

function getWorkspace(userId, wsName) {
  const k = _wsKey(userId, wsName);
  return _workspaces.get(k) || null;
}

/**
 * Upsert workspace context. patch = { key: value } — values are merged.
 */
function upsertWorkspace(userId, wsName, patch = {}) {
  const k = _wsKey(userId, wsName);
  let w = _workspaces.get(k);
  if (!w) {
    w = { userId, wsName, context: {}, createdAt: _now(), updatedAt: _now(), _dirty: true };
    _workspaces.set(k, w);
  }
  // Merge patch, enforce key limit
  for (const [key, val] of Object.entries(patch)) {
    if (Object.keys(w.context).length >= WORKSPACE_MAX_KEYS && !(key in w.context)) {
      console.warn(`[MemoryEngine] Workspace key limit (${WORKSPACE_MAX_KEYS}) reached for ${userId}::${wsName}`);
      break;
    }
    if (val === null || val === undefined) {
      delete w.context[key];
    } else {
      w.context[key] = val;
    }
  }
  w.updatedAt = _now();
  w._dirty    = true;
  _schedulFlush();
  return w;
}

function deleteWorkspace(userId, wsName) {
  const k = _wsKey(userId, wsName);
  const existed = _workspaces.has(k);
  _workspaces.delete(k);
  if (existed) {
    const db = _getDb();
    if (db?.db) {
      try { db.db.prepare(`DELETE FROM mem_workspaces WHERE user_id=? AND ws_name=?`).run(userId, wsName); } catch (_) {}
    }
  }
  return existed;
}

function listWorkspaces(userId) {
  const result = [];
  for (const w of _workspaces.values()) {
    if (w.userId === userId) {
      result.push({
        wsName: w.wsName, keyCount: Object.keys(w.context).length,
        createdAt: w.createdAt, updatedAt: w.updatedAt,
      });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// USER PROFILE API
// ─────────────────────────────────────────────────────────────────────────

function _getOrCreateProfile(userId) {
  if (_profiles.has(userId)) return _profiles.get(userId);
  const p = {
    userId,
    preferences: {},
    patterns:    {},
    stats:       { totalSessions: 0, totalTurns: 0, totalCost: 0 },
    createdAt: _now(), updatedAt: _now(),
    _dirty: true,
  };
  _profiles.set(userId, p);
  return p;
}

function getUserProfile(userId) {
  const p = _profiles.get(userId);
  if (!p) return null;
  const { _dirty, ...safe } = p;
  return safe;
}

/**
 * Patch user profile. patch = { preferences?: {}, patterns?: {}, stats?: {} }
 */
function patchUserProfile(userId, patch = {}) {
  const p = _getOrCreateProfile(userId);
  if (patch.preferences) Object.assign(p.preferences, patch.preferences);
  if (patch.patterns)    Object.assign(p.patterns,    patch.patterns);
  if (patch.stats)       Object.assign(p.stats,       patch.stats);
  p.updatedAt = _now();
  p._dirty    = true;
  _schedulFlush();
  return getUserProfile(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// STATS & ADMIN
// ─────────────────────────────────────────────────────────────────────────

function stats() {
  const now = Date.now();
  let activeSessions = 0;
  for (const s of _sessions.values()) {
    if (now - new Date(s.lastUsed).getTime() < SESSION_TTL_MS) activeSessions++;
  }
  return {
    sessions:       { total: _sessions.size,   active: activeSessions,    hits: _sessionHits, misses: _sessionMisses },
    workspaces:     { total: _workspaces.size },
    profiles:       { total: _profiles.size },
    totalTurns:     _totalTurns,
    maxTurns:       SESSION_MAX_TURNS,
    ttlMs:          SESSION_TTL_MS,
    lruCap:         MAX_HOT_SESSIONS,
  };
}

// ── Initialise on first require ────────────────────────────────────────────
setImmediate(() => _loadFromDb());

// ── Periodic flush (every 5 min) ───────────────────────────────────────────
setInterval(() => _flush(), 5 * 60 * 1000);

module.exports = {
  // Session
  appendTurn,
  getSessionContext,
  summariseSession,
  getSession,
  listSessions,
  deleteSession,
  // Workspace
  getWorkspace,
  upsertWorkspace,
  deleteWorkspace,
  listWorkspaces,
  // Profile
  getUserProfile,
  patchUserProfile,
  // Internal
  stats,
  flush: _flush,
};
