// ============================================================
// failureRecorder.js — Phase 3: Failure Recorder (고수준 래퍼)
// ============================================================
// 역할:
//   - failureStore의 captureFailure를 래핑
//   - AgentRuntime / ToolChainExecutor에서 통일된 인터페이스 제공
//   - context 자동 정규화 (누락 필드 보완)
//   - is_partial 필드 명시 지원
// ============================================================

'use strict';

const failureStore = require('./failureStore');

/**
 * recordFailure(context)
 * 실패 또는 partial 실행 정보를 저장한다.
 *
 * @param {Object} context
 *   runId, sessionId, userMessage, mode, strategy, model, complexity,
 *   plan, tasks, taskStates, toolCalls, toolResults,
 *   correctionRounds, correctionLogs, budget,
 *   executionTimeMs, errorMessage, isPartial
 * @returns {number|null} inserted DB row id
 */
function recordFailure(context) {
  const {
    runId,
    sessionId,
    userMessage     = '',
    mode,
    strategy,
    model,
    complexity,
    plan,
    tasks,
    taskStates,
    toolCalls,
    toolResults,
    correctionRounds = 0,
    correctionLogs,
    budget,
    executionTimeMs,
    errorMessage,
    isPartial        = false,
    replayedFrom,
  } = context || {};

  // errorType 자동 분류
  let errorType = 'chain_error';
  if (isPartial)                                          errorType = 'budget_exceeded';
  if (budget?.budget_stop_reason)                         errorType = 'budget_exceeded';
  if (errorMessage?.includes('timeout'))                  errorType = 'timeout';
  if (errorMessage?.includes('LLM') || errorMessage?.includes('OpenAI')) errorType = 'llm_error';

  // toolCalls 통합 (toolCalls + toolResults 병합)
  const mergedToolCalls = _mergeToolData(toolCalls, toolResults);

  // correctionLogs를 correction_rounds 숫자로도 표현
  const rounds = correctionRounds
    || (Array.isArray(correctionLogs) ? correctionLogs.length : 0);

  return failureStore.captureFailure({
    planId:           runId || plan?.planId || null,
    sessionId:        sessionId || null,
    userMessage,
    strategy:         strategy || null,
    model:            model || null,
    complexity:       complexity || plan?.complexity || null,
    plan:             plan || null,
    tasks:            tasks || plan?.tasks || null,
    taskStates:       taskStates || null,
    toolCalls:        mergedToolCalls,
    correctionRounds: rounds,
    finalError:       errorMessage || null,
    errorType,
    budget:           budget || null,
    partialResult:    isPartial ? (context.partialResult || 'partial') : null,
    replayedFrom:     replayedFrom || null,
  });
}

/**
 * recordPartialResult(context)
 * isPartial = true로 고정한 편의 함수
 */
function recordPartialResult(context) {
  return recordFailure({ ...context, isPartial: true });
}

/**
 * recordToolFailure(context)
 * 개별 tool 실패 기록 편의 함수
 */
function recordToolFailure({ sessionId, userMessage, taskType, taskId, toolName, errorMessage, budget, chainContext }) {
  return failureStore.captureFailure({
    planId:           null,
    sessionId:        sessionId || null,
    userMessage:      userMessage || chainContext?.originalMessage || '',
    strategy:         null,
    model:            null,
    complexity:       null,
    plan:             null,
    tasks:            null,
    taskStates:       null,
    toolCalls:        chainContext?.toolOutputs || [],
    correctionRounds: 0,
    finalError:       `[${taskType || 'tool'}:${taskId || toolName || '?'}] ${errorMessage}`,
    errorType:        'chain_error',
    budget:           budget || null,
    partialResult:    null,
    replayedFrom:     null,
  });
}

// ── 내부 헬퍼 ────────────────────────────────────────────────

function _mergeToolData(toolCalls, toolResults) {
  if (!toolCalls && !toolResults) return null;
  if (!toolResults) return toolCalls;
  if (!toolCalls)   return toolResults;

  // 배열이면 합치기
  if (Array.isArray(toolCalls) && Array.isArray(toolResults)) {
    return toolCalls.map((call, i) => ({
      ...call,
      result: toolResults[i] || null,
    }));
  }
  return toolCalls;
}

module.exports = {
  recordFailure,
  recordPartialResult,
  recordToolFailure,
};
