// ============================================================
// costController.js — Phase 2: Cost Controller
// ============================================================
// 역할:
//   - complexity별 실행 예산(Budget) 생성
//   - LLM 호출 / Tool 호출 / 토큰 / 시간 / 교정 횟수 추적
//   - 제한 초과 시 graceful stop 결과 생성
//   - KPI 집계를 위한 지표 노출
// ============================================================

'use strict';

// ─────────────────────────────────────────────────────────────
// § complexity별 기본 예산 설정
// ─────────────────────────────────────────────────────────────
const BUDGET_DEFAULTS = {
  simple: {
    maxLLMCalls:          2,
    maxToolCalls:         2,
    maxTokens:            3000,
    maxExecutionTimeMs:   20_000,
    maxCorrectionRounds:  1,
  },
  normal: {
    maxLLMCalls:          5,
    maxToolCalls:         5,
    maxTokens:            8000,
    maxExecutionTimeMs:   45_000,
    maxCorrectionRounds:  2,
  },
  complex: {
    maxLLMCalls:          10,
    maxToolCalls:         10,
    maxTokens:            20_000,
    maxExecutionTimeMs:   90_000,
    maxCorrectionRounds:  2,
  },
};

// 알 수 없는 complexity → normal 기본값
const DEFAULT_COMPLEXITY = 'normal';

// ─────────────────────────────────────────────────────────────
// § 전역 KPI 집계 (인-메모리, 서버 재시작 시 초기화)
// ─────────────────────────────────────────────────────────────
const _kpiAccum = {
  totalTasks:           0,
  totalLLMCalls:        0,
  totalToolCalls:       0,
  totalTokens:          0,
  totalExecutionMs:     0,
  budgetStopCount:      0,    // budget 초과로 중단된 횟수
  partialResultCount:   0,    // partial result 반환 횟수
  stopReasons:          {},   // reason → count
};

// ─────────────────────────────────────────────────────────────
// § 공개 API
// ─────────────────────────────────────────────────────────────

/**
 * createExecutionBudget(complexity)
 * complexity 기준 budget 객체 생성
 */
function createExecutionBudget(complexity) {
  const key    = (complexity || DEFAULT_COMPLEXITY).toLowerCase();
  const limits = BUDGET_DEFAULTS[key] || BUDGET_DEFAULTS[DEFAULT_COMPLEXITY];

  return {
    complexity,
    startedAt:        Date.now(),
    llmCalls:         0,
    toolCalls:        0,
    totalTokens:      0,
    correctionRounds: 0,
    isExceeded:       false,
    stopReason:       null,
    limits: { ...limits },
  };
}

/**
 * trackLLMCall(budget, model, tokensUsed)
 * LLM 호출 1회 추적. 제한 초과 시 budget.isExceeded = true 설정.
 * @returns {{ ok: boolean, reason: string|null }}
 */
function trackLLMCall(budget, model = '', tokensUsed = 0) {
  if (!budget || budget.isExceeded) return { ok: false, reason: budget?.stopReason || 'already_exceeded' };

  budget.llmCalls++;
  budget.totalTokens += (tokensUsed || 0);

  if (budget.llmCalls > budget.limits.maxLLMCalls) {
    return _exceed(budget, 'max_llm_calls_exceeded',
      `LLM 호출 ${budget.llmCalls}/${budget.limits.maxLLMCalls} 초과`);
  }
  if (budget.totalTokens > budget.limits.maxTokens) {
    return _exceed(budget, 'max_tokens_exceeded',
      `토큰 ${budget.totalTokens}/${budget.limits.maxTokens} 초과`);
  }
  return { ok: true, reason: null };
}

/**
 * trackToolCall(budget, toolName)
 * Tool 호출 1회 추적. 제한 초과 시 exceeded.
 * @returns {{ ok: boolean, reason: string|null }}
 */
function trackToolCall(budget, toolName = '') {
  if (!budget || budget.isExceeded) return { ok: false, reason: budget?.stopReason || 'already_exceeded' };

  budget.toolCalls++;

  if (budget.toolCalls > budget.limits.maxToolCalls) {
    return _exceed(budget, 'max_tool_calls_exceeded',
      `Tool 호출 ${budget.toolCalls}/${budget.limits.maxToolCalls} 초과`);
  }
  return { ok: true, reason: null };
}

/**
 * checkTimeLimit(budget)
 * 실행 시간 초과 여부 확인.
 * @returns {{ ok: boolean, reason: string|null }}
 */
function checkTimeLimit(budget) {
  if (!budget || budget.isExceeded) return { ok: false, reason: budget?.stopReason || 'already_exceeded' };

  const elapsed = Date.now() - budget.startedAt;
  if (elapsed > budget.limits.maxExecutionTimeMs) {
    return _exceed(budget, 'max_execution_time_exceeded',
      `실행 시간 ${elapsed}ms / ${budget.limits.maxExecutionTimeMs}ms 초과`);
  }
  return { ok: true, reason: null, elapsedMs: elapsed };
}

/**
 * canRunCorrection(budget)
 * correction 1회 실행 가능 여부 확인 후 카운터 증가.
 * @returns {{ ok: boolean, reason: string|null }}
 */
function canRunCorrection(budget) {
  if (!budget || budget.isExceeded) return { ok: false, reason: budget?.stopReason || 'already_exceeded' };

  // 시간 체크 먼저
  const timeCheck = checkTimeLimit(budget);
  if (!timeCheck.ok) return timeCheck;

  if (budget.correctionRounds >= budget.limits.maxCorrectionRounds) {
    return _exceed(budget, 'max_correction_rounds_exceeded',
      `교정 ${budget.correctionRounds}/${budget.limits.maxCorrectionRounds} 초과`);
  }

  budget.correctionRounds++;
  return { ok: true, reason: null };
}

/**
 * buildBudgetExceededResult(reason, partialResult)
 * graceful stop 응답 객체 생성
 */
function buildBudgetExceededResult(reason, partialResult = null) {
  const messages = {
    max_llm_calls_exceeded:       'LLM 호출 한도를 초과하여 부분 결과를 반환합니다.',
    max_tool_calls_exceeded:      '도구 호출 한도를 초과하여 부분 결과를 반환합니다.',
    max_tokens_exceeded:          '토큰 사용 한도를 초과하여 부분 결과를 반환합니다.',
    max_execution_time_exceeded:  '실행 시간 한도를 초과하여 부분 결과를 반환합니다.',
    max_correction_rounds_exceeded: '자기교정 한도를 초과하였습니다.',
    already_exceeded:             '예산 초과 상태입니다.',
  };

  return {
    status:        'partial',
    reason,
    message:       messages[reason] || '예산 초과로 작업이 중단되었습니다.',
    partialResult: partialResult || null,
    isBudgetStop:  true,
  };
}

/**
 * finalizeBudget(budget)
 * 실행 완료 시 KPI 집계에 기록
 */
function finalizeBudget(budget) {
  if (!budget) return;

  const elapsedMs = Date.now() - budget.startedAt;

  _kpiAccum.totalTasks++;
  _kpiAccum.totalLLMCalls    += budget.llmCalls;
  _kpiAccum.totalToolCalls   += budget.toolCalls;
  _kpiAccum.totalTokens      += budget.totalTokens;
  _kpiAccum.totalExecutionMs += elapsedMs;

  if (budget.isExceeded) {
    _kpiAccum.budgetStopCount++;
    const r = budget.stopReason || 'unknown';
    _kpiAccum.stopReasons[r] = (_kpiAccum.stopReasons[r] || 0) + 1;
  }
}

/**
 * recordPartialResult()
 * partial result 반환 횟수 기록
 */
function recordPartialResult() {
  _kpiAccum.partialResultCount++;
}

/**
 * getBudgetKPI()
 * /api/kpi 에서 merge할 budget 관련 KPI 반환
 */
function getBudgetKPI() {
  const n = _kpiAccum.totalTasks || 1;

  // Phase 4: parallelExecutor KPI 통합
  let parallelKpi = {};
  try {
    const pe = require('./parallelExecutor');
    parallelKpi = pe.getParallelKPI();
  } catch (_) {}

  return {
    agent_tasks_total:           _kpiAccum.totalTasks,
    avg_llm_calls_per_task:      +(_kpiAccum.totalLLMCalls  / n).toFixed(2),
    avg_tool_calls_per_task:     +(_kpiAccum.totalToolCalls / n).toFixed(2),
    avg_tokens_per_task:         Math.round(_kpiAccum.totalTokens / n),
    avg_execution_time_ms:       Math.round(_kpiAccum.totalExecutionMs / n),
    budget_stop_rate:            +(_kpiAccum.budgetStopCount / n * 100).toFixed(1) + '%',
    partial_result_rate:         +(_kpiAccum.partialResultCount / n * 100).toFixed(1) + '%',
    budget_stop_reasons:         { ..._kpiAccum.stopReasons },
    // Phase 4: 병렬 실행 KPI
    parallel:                    parallelKpi,
  };
}

/**
 * getBudgetSummary(budget)
 * 단일 실행의 budget 사용량 요약 반환 (로그/KPI 기록용)
 */
function getBudgetSummary(budget) {
  if (!budget) return null;
  const elapsedMs = Date.now() - budget.startedAt;
  return {
    budget_complexity:    budget.complexity,
    llm_calls_used:       budget.llmCalls,
    tool_calls_used:      budget.toolCalls,
    total_tokens_used:    budget.totalTokens,
    correction_rounds:    budget.correctionRounds,
    execution_time_ms:    elapsedMs,
    budget_stop_reason:   budget.stopReason || null,
    is_partial_result:    budget.isExceeded,
    limits:               { ...budget.limits },
  };
}

// ─────────────────────────────────────────────────────────────
// § 내부 헬퍼
// ─────────────────────────────────────────────────────────────
function _exceed(budget, reason, logMsg) {
  budget.isExceeded = true;
  budget.stopReason = reason;
  console.warn(`[CostController] ⚠️  ${logMsg} (complexity=${budget.complexity})`);
  return { ok: false, reason };
}

// ─────────────────────────────────────────────────────────────
// § exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  BUDGET_DEFAULTS,
  createExecutionBudget,
  trackLLMCall,
  trackToolCall,
  checkTimeLimit,
  canRunCorrection,
  buildBudgetExceededResult,
  finalizeBudget,
  recordPartialResult,
  getBudgetKPI,
  getBudgetSummary,
};
