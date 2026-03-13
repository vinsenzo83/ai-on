// ============================================================
// failureStore.js — Phase 3: Failure Replay System
// ============================================================
// 역할:
//   - 에이전트 실행 실패 데이터를 SQLite failed_runs 테이블에 저장
//   - 실패 목록/상세 조회
//   - 동일 입력/플랜으로 재실행(replay) 지원
// ============================================================

'use strict';

const dbModule = require('../db/database');
const db = dbModule._raw;  // better-sqlite3 raw instance

// ─────────────────────────────────────────────────────────────
// § DB 초기화: failed_runs 테이블
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS failed_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id         TEXT,
    session_id      TEXT,
    user_message    TEXT NOT NULL,
    strategy        TEXT,
    model           TEXT,
    complexity      TEXT,
    plan_json       TEXT,       -- JSON: full plan object
    tasks_json      TEXT,       -- JSON: task list
    task_states_json TEXT,      -- JSON: task state map
    tool_calls_json TEXT,       -- JSON: tool calls + outputs
    correction_rounds INTEGER DEFAULT 0,
    final_error     TEXT,
    error_type      TEXT,       -- 'budget_exceeded' | 'timeout' | 'llm_error' | 'chain_error'
    budget_json     TEXT,       -- JSON: budget summary at time of failure
    partial_result  TEXT,       -- partial content if any
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    replayed_from   INTEGER,    -- id of original run if this is a replay
    replay_count    INTEGER DEFAULT 0,
    parallel_group_id    TEXT,  -- Phase 4: 병렬 그룹 ID
    parallel_group_size  INTEGER DEFAULT 0,  -- Phase 4: 그룹 내 태스크 수
    parallel_task_results TEXT, -- Phase 4: JSON: 병렬 태스크 결과 배열
    failed_parallel_tasks TEXT  -- Phase 4: JSON: 실패한 병렬 태스크 ID 배열
  )
`);

// Phase 4: 기존 테이블에 parallel 컬럼 추가 (마이그레이션)
try {
  db.exec(`ALTER TABLE failed_runs ADD COLUMN parallel_group_id TEXT`);
} catch (_) { /* 이미 존재 */ }
try {
  db.exec(`ALTER TABLE failed_runs ADD COLUMN parallel_group_size INTEGER DEFAULT 0`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE failed_runs ADD COLUMN parallel_task_results TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE failed_runs ADD COLUMN failed_parallel_tasks TEXT`);
} catch (_) {}

// ─────────────────────────────────────────────────────────────
// § 공개 API
// ─────────────────────────────────────────────────────────────

/**
 * captureFailure(data)
 * 실패 실행 정보를 DB에 저장 → id 반환
 *
 * @param {Object} data
 *   planId, sessionId, userMessage, strategy, model, complexity,
 *   plan, tasks, taskStates, toolCalls, correctionRounds,
 *   finalError, errorType, budget, partialResult,
 *   parallelGroupId, parallelGroupSize, parallelTaskResults, failedParallelTasks (Phase 4)
 * @returns {number} inserted row id
 */
function captureFailure(data) {
  try {
    const stmt = db.prepare(`
      INSERT INTO failed_runs
        (plan_id, session_id, user_message, strategy, model, complexity,
         plan_json, tasks_json, task_states_json, tool_calls_json,
         correction_rounds, final_error, error_type, budget_json,
         partial_result, replayed_from,
         parallel_group_id, parallel_group_size,
         parallel_task_results, failed_parallel_tasks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const info = stmt.run(
      data.planId         || null,
      data.sessionId      || null,
      data.userMessage    || '',
      data.strategy       || null,
      data.model          || null,
      data.complexity     || null,
      _json(data.plan),
      _json(data.tasks),
      _json(data.taskStates),
      _json(data.toolCalls),
      data.correctionRounds || 0,
      data.finalError     || null,
      data.errorType      || null,
      _json(data.budget),
      data.partialResult  || null,
      data.replayedFrom   || null,
      // Phase 4: 병렬 실행 메타데이터
      data.parallelGroupId         || null,
      data.parallelGroupSize       || 0,
      _json(data.parallelTaskResults),
      _json(data.failedParallelTasks),
    );

    console.log(`[FailureStore] 실패 기록 저장: id=${info.lastInsertRowid} error=${data.errorType}`);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('[FailureStore] captureFailure 오류:', err.message);
    return null;
  }
}

/**
 * getFailures(limit, offset)
 * 실패 목록 조회 (최신순)
 */
function getFailures(limit = 20, offset = 0) {
  try {
    const rows = db.prepare(`
      SELECT id, plan_id, session_id, user_message, strategy, model,
             complexity, error_type, final_error, correction_rounds,
             replay_count, created_at, replayed_from,
             CASE WHEN partial_result IS NOT NULL THEN 1 ELSE 0 END AS has_partial
      FROM failed_runs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM failed_runs`).get().cnt;

    return {
      total,
      limit,
      offset,
      items: rows.map(_formatRow),
    };
  } catch (err) {
    console.error('[FailureStore] getFailures 오류:', err.message);
    return { total: 0, limit, offset, items: [] };
  }
}

/**
 * getFailure(id)
 * 특정 실패 상세 조회 (plan, tasks, toolCalls 등 포함)
 */
function getFailure(id) {
  try {
    const row = db.prepare(`SELECT * FROM failed_runs WHERE id = ?`).get(id);
    if (!row) return null;

    return {
      ..._formatRow(row),
      plan:        _parse(row.plan_json),
      tasks:       _parse(row.tasks_json),
      taskStates:  _parse(row.task_states_json),
      toolCalls:   _parse(row.tool_calls_json),
      budget:      _parse(row.budget_json),
      partialResult: row.partial_result || null,
    };
  } catch (err) {
    console.error('[FailureStore] getFailure 오류:', err.message);
    return null;
  }
}

/**
 * markReplayed(originalId)
 * 원본 실패 기록의 replay_count 증가
 */
function markReplayed(originalId) {
  try {
    db.prepare(`UPDATE failed_runs SET replay_count = replay_count + 1 WHERE id = ?`).run(originalId);
  } catch (err) {
    console.error('[FailureStore] markReplayed 오류:', err.message);
  }
}

/**
 * getReplayStats()
 * 전체 실패/재실행 통계 (간략)
 */
function getReplayStats() {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*)                                          AS total_failures,
        SUM(CASE WHEN error_type = 'budget_exceeded' THEN 1 ELSE 0 END) AS budget_exceeded,
        SUM(CASE WHEN error_type = 'timeout'          THEN 1 ELSE 0 END) AS timeout,
        SUM(CASE WHEN error_type = 'llm_error'        THEN 1 ELSE 0 END) AS llm_error,
        SUM(CASE WHEN error_type = 'chain_error'      THEN 1 ELSE 0 END) AS chain_error,
        SUM(replay_count)                                AS total_replays,
        SUM(CASE WHEN replayed_from IS NOT NULL THEN 1 ELSE 0 END) AS replay_runs
      FROM failed_runs
    `).get();
    // SQLite SUM() on empty table → null; normalize to 0
    return {
      total_failures:  stats.total_failures  || 0,
      budget_exceeded: stats.budget_exceeded || 0,
      timeout:         stats.timeout         || 0,
      llm_error:       stats.llm_error       || 0,
      chain_error:     stats.chain_error      || 0,
      total_replays:   stats.total_replays   || 0,
      replay_runs:     stats.replay_runs     || 0,
    };
  } catch (err) {
    return {
      total_failures: 0, budget_exceeded: 0, timeout: 0,
      llm_error: 0, chain_error: 0, total_replays: 0, replay_runs: 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// § 내부 헬퍼
// ─────────────────────────────────────────────────────────────
function _json(val) {
  if (val === null || val === undefined) return null;
  try { return JSON.stringify(val); } catch { return null; }
}

function _parse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function _formatRow(row) {
  return {
    id:              row.id,
    planId:          row.plan_id,
    sessionId:       row.session_id,
    userMessage:     row.user_message,
    strategy:        row.strategy,
    model:           row.model,
    complexity:      row.complexity,
    errorType:       row.error_type,
    finalError:      row.final_error,
    correctionRounds: row.correction_rounds,
    replayCount:     row.replay_count,
    replayedFrom:    row.replayed_from,
    hasPartial:      !!(row.has_partial || row.partial_result),
    createdAt:       row.created_at,
    createdAtISO:    new Date(row.created_at).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// § exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  captureFailure,
  getFailures,
  getFailure,
  markReplayed,
  getReplayStats,
};
