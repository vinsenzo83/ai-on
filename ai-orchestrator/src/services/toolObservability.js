// ============================================================
// toolObservability.js — Tool 사용 관찰/분석 로그 시스템
// ============================================================
//
// STEP 7: AI가 언제 어떤 툴을 쓰는지 기록 + KPI 분석
//
// 로그 항목:
//   timestamp, user_query, strategy, model,
//   tool_called, tool_arguments, tool_latency,
//   tool_success, response_tokens, session_id
//
// KPI 지표:
//   tool_call_rate, tool_success_rate,
//   average_latency, tool_error_rate
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '../../data');
const LOG_FILE  = path.join(DATA_DIR, 'tool_observability.jsonl'); // 1줄 1이벤트
const STAT_FILE = path.join(DATA_DIR, 'tool_stats.json');

// 최대 보관 로그 (1만 개 초과 시 오래된 것 제거)
const MAX_LOG_LINES = 10000;

// ── 초기화 ────────────────────────────────────────────────────
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE))  fs.writeFileSync(LOG_FILE, '', 'utf8');
  if (!fs.existsSync(STAT_FILE)) fs.writeFileSync(STAT_FILE, JSON.stringify({
    totalRequests:     0,
    toolCallRequests:  0,
    memoryHitRequests: 0,     // STEP 7: hasMemory=true 요청 수
    totalResponseMs:   0,     // STEP 7: 응답지연 합계
    totalTokens:       0,     // STEP 7: 총 토큰 사용량
    errorRequests:     0,     // STEP 7: 오류 요청 수
    toolEvents:        {},    // toolName → { calls, successes, errors, totalLatency }
    strategyStats:     {},    // strategy → { calls, totalMs, totalTokens }
    dailyStats:        {},    // YYYY-MM-DD → { requests, toolCalls, totalMs, totalTokens }
    lastUpdated: null,
  }), 'utf8');
}
ensureFiles();  // 서버 시작 시 파일 초기화

// ── JSON 유틸 ─────────────────────────────────────────────────
function readStats() {
  try { return JSON.parse(fs.readFileSync(STAT_FILE, 'utf8')); }
  catch { return { totalRequests: 0, toolCallRequests: 0, toolEvents: {}, dailyStats: {}, lastUpdated: null }; }
}
function writeStats(data) {
  fs.writeFileSync(STAT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── 로그 이벤트 구조 ──────────────────────────────────────────
/**
 * ToolEvent — 단일 툴 호출 이벤트
 * @typedef {Object} ToolEvent
 * @property {string}  sessionId
 * @property {string}  query        - 사용자 원본 쿼리
 * @property {string}  strategy     - fast | balanced | deep
 * @property {string}  model        - 실제 사용 모델
 * @property {string}  taskType
 * @property {string}  toolName     - web_search | get_weather | ...
 * @property {Object}  toolArgs     - 툴 호출 인수
 * @property {number}  toolLatencyMs
 * @property {boolean} toolSuccess
 * @property {string}  [errorMsg]
 * @property {number}  responseTokens
 * @property {string}  timestamp    - ISO string
 */

// ── 핵심 API ──────────────────────────────────────────────────

/**
 * logRequest — API 요청 단위 기록 (툴 미사용 포함)
 * @param {Object} params
 * @param {string}   params.sessionId
 * @param {string}   params.query
 * @param {string}   params.strategy
 * @param {string}   params.model
 * @param {string}   params.taskType
 * @param {string[]} params.toolsUsed
 * @param {number}   params.responseTokens
 * @param {number}   params.responseMs      — STEP 7: 응답 지연 (ms)
 * @param {boolean}  params.hasMemory       — STEP 7: 메모리 주입 여부
 */
function logRequest({ sessionId, query, strategy, model, taskType,
                      toolsUsed = [], responseTokens = 0,
                      responseMs = 0, hasMemory = false }) {
  const today = new Date().toISOString().slice(0, 10);
  const stats = readStats();

  stats.totalRequests++;
  if (toolsUsed.length > 0) stats.toolCallRequests++;
  if (hasMemory) stats.memoryHitRequests = (stats.memoryHitRequests || 0) + 1;
  stats.totalResponseMs = (stats.totalResponseMs || 0) + responseMs;
  stats.totalTokens     = (stats.totalTokens || 0) + responseTokens;

  // 전략별 통계
  if (strategy) {
    if (!stats.strategyStats) stats.strategyStats = {};
    if (!stats.strategyStats[strategy]) {
      stats.strategyStats[strategy] = { calls: 0, totalMs: 0, totalTokens: 0 };
    }
    stats.strategyStats[strategy].calls++;
    stats.strategyStats[strategy].totalMs     += responseMs;
    stats.strategyStats[strategy].totalTokens += responseTokens;
  }

  // 일별 통계
  if (!stats.dailyStats[today]) {
    stats.dailyStats[today] = { requests: 0, toolCalls: 0, totalMs: 0, totalTokens: 0 };
  }
  stats.dailyStats[today].requests++;
  if (toolsUsed.length > 0) stats.dailyStats[today].toolCalls++;
  stats.dailyStats[today].totalMs     = (stats.dailyStats[today].totalMs     || 0) + responseMs;
  stats.dailyStats[today].totalTokens = (stats.dailyStats[today].totalTokens || 0) + responseTokens;

  // 일별 통계 30일만 유지
  const days = Object.keys(stats.dailyStats).sort();
  if (days.length > 30) delete stats.dailyStats[days[0]];

  stats.lastUpdated = new Date().toISOString();
  writeStats(stats);

  // 요청 수준 로그
  appendLog({
    type:           'request',
    timestamp:      new Date().toISOString(),
    sessionId:      sessionId?.slice(0, 8),
    query:          query?.slice(0, 120),
    strategy,
    model,
    taskType,
    toolsUsed,
    responseTokens,
    responseMs,
    hasMemory,
  });
}

/**
 * logToolCall — 개별 툴 호출 기록
 * @param {ToolEvent} event
 */
function logToolCall(event) {
  const stats = readStats();
  const { toolName, toolLatencyMs = 0, toolSuccess = true, errorMsg } = event;

  if (!stats.toolEvents[toolName]) {
    stats.toolEvents[toolName] = { calls: 0, successes: 0, totalLatency: 0, errors: 0 };
  }
  const te = stats.toolEvents[toolName];
  te.calls++;
  if (toolSuccess) te.successes++;
  else             te.errors++;
  te.totalLatency += toolLatencyMs;

  stats.lastUpdated = new Date().toISOString();
  writeStats(stats);

  appendLog({
    type:          'tool_call',
    timestamp:     new Date().toISOString(),
    sessionId:     event.sessionId?.slice(0, 8),
    query:         event.query?.slice(0, 80),
    strategy:      event.strategy,
    model:         event.model,
    taskType:      event.taskType,
    tool:          toolName,
    args:          event.toolArgs,
    latencyMs:     toolLatencyMs,
    success:       toolSuccess,
    errorMsg:      errorMsg || null,
    responseTokens: event.responseTokens || 0,
  });

  // 콘솔 로그 (간결)
  const status = toolSuccess ? '✅' : '❌';
  console.log(`[toolObs] ${status} ${toolName}(${JSON.stringify(event.toolArgs || {}).slice(0, 60)}) ${toolLatencyMs}ms`);
}

/**
 * appendLog — JSONL 파일에 1줄 추가 (비동기 write, 에러 무시)
 */
function appendLog(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');

    // 로그 크기 제한 (초과 시 앞 1000줄 제거)
    try {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length > MAX_LOG_LINES) {
        fs.writeFileSync(LOG_FILE, lines.slice(1000).join('\n') + '\n', 'utf8');
      }
    } catch (_) {}
  } catch (err) {
    // 로그 실패는 무시 (서비스 중단 방지)
    console.warn('[toolObs] 로그 저장 실패:', err.message);
  }
}

// ── KPI 분석 API ─────────────────────────────────────────────

/**
 * getKPI — 종합 KPI 반환
 */
function getKPI() {
  const stats = readStats();

  const totalReq     = stats.totalRequests || 1;  // div/0 방지
  const toolCallRate = ((stats.toolCallRequests / totalReq) * 100).toFixed(1);
  const memoryHitRate = (((stats.memoryHitRequests || 0) / totalReq) * 100).toFixed(1);
  const avgResponseMs = totalReq > 1
    ? Math.round((stats.totalResponseMs || 0) / totalReq) : 0;
  const avgTokens = Math.round((stats.totalTokens || 0) / totalReq);

  const toolSummary = {};
  let totalCalls = 0, totalSuccesses = 0, totalLatency = 0;

  for (const [name, te] of Object.entries(stats.toolEvents || {})) {
    const successRate = te.calls > 0 ? ((te.successes / te.calls) * 100).toFixed(1) : '0.0';
    const avgLatency  = te.calls > 0 ? Math.round(te.totalLatency / te.calls) : 0;
    toolSummary[name] = {
      calls:        te.calls,
      successes:    te.successes,
      errors:       te.errors || 0,
      successRate:  `${successRate}%`,
      avgLatencyMs: avgLatency,
    };
    totalCalls     += te.calls;
    totalSuccesses += te.successes;
    totalLatency   += te.totalLatency;
  }

  const overallSuccessRate = totalCalls > 0
    ? ((totalSuccesses / totalCalls) * 100).toFixed(1) : '0.0';
  const overallAvgLatency = totalCalls > 0
    ? Math.round(totalLatency / totalCalls) : 0;

  // 전략별 KPI
  const strategyKPI = {};
  for (const [strat, sv] of Object.entries(stats.strategyStats || {})) {
    strategyKPI[strat] = {
      calls:       sv.calls,
      avgMs:       sv.calls > 0 ? Math.round(sv.totalMs / sv.calls) : 0,
      avgTokens:   sv.calls > 0 ? Math.round(sv.totalTokens / sv.calls) : 0,
    };
  }

  // 최근 7일 일별 통계
  const recentDays = Object.entries(stats.dailyStats || {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([date, v]) => ({
      date,
      requests:    v.requests,
      toolCalls:   v.toolCalls,
      toolCallRate: v.requests > 0 ? ((v.toolCalls / v.requests) * 100).toFixed(1) + '%' : '0%',
      avgMs:        v.requests > 0 ? Math.round((v.totalMs || 0) / v.requests) : 0,
      avgTokens:    v.requests > 0 ? Math.round((v.totalTokens || 0) / v.requests) : 0,
    }));

  // KPI 목표 달성 여부 (운영 KPI)
  const toolSuccessMet   = parseFloat(overallSuccessRate) >= 95;  // > 95%
  const memoryRecallMet  = parseFloat(memoryHitRate)      >= 90;  // > 90%
  const latencyMet       = avgResponseMs <= 4000 || avgResponseMs === 0; // < 4s
  const errorRateMet     = (totalCalls - totalSuccesses) / Math.max(totalCalls, 1) <= 0.05; // < 5%

  return {
    // 종합 요청 KPI
    totalRequests:    stats.totalRequests,
    toolCallRequests: stats.toolCallRequests,
    toolCallRate:     `${toolCallRate}%`,
    memoryHitRate:    `${memoryHitRate}%`,   // ★ STEP 7
    avgResponseMs,                            // ★ STEP 7
    avgTokensPerReq:  avgTokens,              // ★ STEP 7
    totalTokensUsed:  stats.totalTokens || 0, // ★ STEP 7

    // 툴별
    tools: toolSummary,

    // 전체 툴 KPI
    overall: {
      totalCalls,
      totalSuccesses,
      successRate:  `${overallSuccessRate}%`,
      avgLatencyMs: overallAvgLatency,
      errorRate:    totalCalls > 0
        ? `${(((totalCalls - totalSuccesses) / totalCalls) * 100).toFixed(1)}%`
        : '0.0%',
    },

    // 전략별
    strategyKPI,  // ★ STEP 7

    // 일별
    recentDays,

    // 운영 KPI 목표 대비 (STEP 7)
    targets: {
      toolCallSuccess:  { target: '>95%', actual: `${overallSuccessRate}%`, met: toolSuccessMet },
      memoryRecall:     { target: '>90%', actual: `${memoryHitRate}%`,       met: memoryRecallMet },
      responseLatency:  { target: '<4s',  actual: `${avgResponseMs}ms`,      met: latencyMet },
      toolErrorRate:    { target: '<5%',  actual: `${overallAvgLatency}ms`,   met: errorRateMet },
    },

    lastUpdated: stats.lastUpdated,
  };
}

/**
 * getRecentLogs — 최근 N개 로그 이벤트 반환
 */
function getRecentLogs(n = 50, filter = {}) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    let lines = content.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // 필터 적용
    if (filter.type)     lines = lines.filter(l => l.type === filter.type);
    if (filter.tool)     lines = lines.filter(l => l.tool === filter.tool);
    if (filter.strategy) lines = lines.filter(l => l.strategy === filter.strategy);

    return lines.slice(-n).reverse();  // 최신순
  } catch {
    return [];
  }
}

module.exports = {
  logRequest,
  logToolCall,
  getKPI,
  getRecentLogs,
};
