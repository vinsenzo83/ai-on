'use strict';
/**
 * test_cost_controller.js — Phase 2: Cost Controller 회귀 테스트 (T1–T6)
 *
 * T1: simple budget — LLM 2회 제한 동작
 * T2: complex budget — 10회 허용
 * T3: 실행 시간 초과 — maxExecutionTimeMs 0 설정으로 즉시 초과
 * T4: tool 호출 초과 — maxToolCalls 1 설정
 * T5: correction 횟수 초과 — maxCorrectionRounds 0
 * T6: 토큰 초과 — maxTokens 10 설정
 * T7: KPI 집계 — finalizeBudget 후 getBudgetKPI 검증
 * T8: partial result 반환 형식 검증
 */

const cc = require('./src/agent/costController');

const START = Date.now();
const results = [];
let PASS = 0, FAIL = 0;

function log(id, name, ok, detail = '') {
  const icon = ok ? '✅' : '❌';
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`${icon} [${id}] ${name.padEnd(48)} ${detail}`);
  results.push({ id, name, status, detail });
  if (ok) PASS++; else FAIL++;
}

function assert(cond, id, name, detail) {
  log(id, name, cond, detail);
}

// ─────────────────────────────────────────────────────────────
// T1: simple budget — LLM 2회 제한
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('simple');
  assert(budget.limits.maxLLMCalls === 2,  'T1a', 'simple: maxLLMCalls=2',   `got ${budget.limits.maxLLMCalls}`);
  assert(budget.limits.maxToolCalls === 2, 'T1b', 'simple: maxToolCalls=2',  `got ${budget.limits.maxToolCalls}`);
  assert(budget.limits.maxTokens === 3000, 'T1c', 'simple: maxTokens=3000', `got ${budget.limits.maxTokens}`);
  assert(budget.limits.maxExecutionTimeMs === 20000, 'T1d', 'simple: maxExecMs=20000', `got ${budget.limits.maxExecutionTimeMs}`);
  assert(budget.limits.maxCorrectionRounds === 1,    'T1e', 'simple: maxCorrections=1', `got ${budget.limits.maxCorrectionRounds}`);

  const r1 = cc.trackLLMCall(budget, 'gpt-4o-mini', 100);
  assert(r1.ok, 'T1f', 'simple: 1st LLM call OK', `ok=${r1.ok}`);

  const r2 = cc.trackLLMCall(budget, 'gpt-4o-mini', 100);
  assert(r2.ok, 'T1g', 'simple: 2nd LLM call OK', `ok=${r2.ok}`);

  const r3 = cc.trackLLMCall(budget, 'gpt-4o-mini', 100);
  assert(!r3.ok, 'T1h', 'simple: 3rd LLM call BLOCKED', `reason=${r3.reason}`);
  assert(budget.isExceeded, 'T1i', 'simple: budget.isExceeded=true after 3rd call', `isExceeded=${budget.isExceeded}`);
  assert(budget.stopReason === 'max_llm_calls_exceeded', 'T1j', 'simple: stopReason correct', budget.stopReason);
}

// ─────────────────────────────────────────────────────────────
// T2: complex budget — LLM 10회 허용
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('complex');
  assert(budget.limits.maxLLMCalls === 10,  'T2a', 'complex: maxLLMCalls=10',   `got ${budget.limits.maxLLMCalls}`);
  assert(budget.limits.maxTokens   === 20000,'T2b', 'complex: maxTokens=20000', `got ${budget.limits.maxTokens}`);

  let allOk = true;
  for (let i = 0; i < 10; i++) {
    const r = cc.trackLLMCall(budget, 'gpt-4o', 100);
    if (!r.ok) { allOk = false; break; }
  }
  assert(allOk, 'T2c', 'complex: 10 LLM calls all OK', '');

  const r11 = cc.trackLLMCall(budget, 'gpt-4o', 100);
  assert(!r11.ok, 'T2d', 'complex: 11th LLM call BLOCKED', `reason=${r11.reason}`);
}

// ─────────────────────────────────────────────────────────────
// T3: 실행 시간 초과
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('normal');
  // 인위적으로 startedAt을 과거로 설정
  budget.startedAt = Date.now() - 100_000; // 100초 전
  const r = cc.checkTimeLimit(budget);
  assert(!r.ok, 'T3a', 'time: checkTimeLimit detects overflow', `reason=${r.reason}`);
  assert(budget.stopReason === 'max_execution_time_exceeded', 'T3b', 'time: stopReason correct', budget.stopReason);
  assert(budget.isExceeded, 'T3c', 'time: budget.isExceeded=true', `${budget.isExceeded}`);

  // 이미 초과된 budget에 추가 호출 → 즉시 차단 (실제 stop reason 또는 already_exceeded 반환)
  const r2 = cc.trackLLMCall(budget, 'gpt-4o', 0);
  assert(!r2.ok, 'T3d', 'time: subsequent calls blocked when already exceeded', `ok=${r2.ok} reason=${r2.reason}`);
}

// ─────────────────────────────────────────────────────────────
// T4: tool 호출 초과
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('normal');
  // normal = 5 tool calls
  for (let i = 0; i < 5; i++) cc.trackToolCall(budget, 'web_search');
  assert(!budget.isExceeded, 'T4a', 'tool: 5 tool calls — not exceeded yet', `${budget.toolCalls}`);

  const r6 = cc.trackToolCall(budget, 'web_search');
  assert(!r6.ok, 'T4b', 'tool: 6th tool call BLOCKED', `reason=${r6.reason}`);
  assert(budget.stopReason === 'max_tool_calls_exceeded', 'T4c', 'tool: stopReason correct', budget.stopReason);
}

// ─────────────────────────────────────────────────────────────
// T5: correction 횟수 초과
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('simple'); // maxCorrectionRounds=1
  const r1 = cc.canRunCorrection(budget);
  assert(r1.ok, 'T5a', 'correction: 1st round OK', `round=${budget.correctionRounds}`);
  assert(budget.correctionRounds === 1, 'T5b', 'correction: counter incremented to 1', `${budget.correctionRounds}`);

  const r2 = cc.canRunCorrection(budget);
  assert(!r2.ok, 'T5c', 'correction: 2nd round BLOCKED (limit=1)', `reason=${r2.reason}`);
  assert(budget.stopReason === 'max_correction_rounds_exceeded', 'T5d', 'correction: stopReason correct', budget.stopReason);
}

// ─────────────────────────────────────────────────────────────
// T6: 토큰 초과
// ─────────────────────────────────────────────────────────────
{
  const budget = cc.createExecutionBudget('simple'); // maxTokens=3000
  const r1 = cc.trackLLMCall(budget, 'gpt-4o', 2999);
  assert(r1.ok, 'T6a', 'token: 2999 tokens — under limit', `totalTokens=${budget.totalTokens}`);

  const r2 = cc.trackLLMCall(budget, 'gpt-4o', 2); // 2999+2=3001 > 3000
  assert(!r2.ok, 'T6b', 'token: 3001 tokens — BLOCKED', `reason=${r2.reason}`);
  assert(budget.stopReason === 'max_tokens_exceeded', 'T6c', 'token: stopReason correct', budget.stopReason);
}

// ─────────────────────────────────────────────────────────────
// T7: KPI 집계
// ─────────────────────────────────────────────────────────────
{
  const b1 = cc.createExecutionBudget('normal');
  cc.trackLLMCall(b1, 'gpt-4o', 500);
  cc.trackToolCall(b1, 'web_search');
  cc.finalizeBudget(b1);

  const b2 = cc.createExecutionBudget('complex');
  for (let i = 0; i < 11; i++) cc.trackLLMCall(b2, 'gpt-4o', 100); // exceed on 11th
  cc.finalizeBudget(b2);
  cc.recordPartialResult();

  const kpi = cc.getBudgetKPI();
  assert(kpi.agent_tasks_total >= 2,             'T7a', 'kpi: agent_tasks_total >= 2',         `got ${kpi.agent_tasks_total}`);
  assert(typeof kpi.avg_llm_calls_per_task === 'number', 'T7b', 'kpi: avg_llm_calls_per_task is number', `got ${kpi.avg_llm_calls_per_task}`);
  assert(kpi.budget_stop_rate !== undefined,     'T7c', 'kpi: budget_stop_rate present',        kpi.budget_stop_rate);
  assert(kpi.partial_result_rate !== undefined,  'T7d', 'kpi: partial_result_rate present',     kpi.partial_result_rate);
  assert(kpi.budget_stop_reasons !== undefined,  'T7e', 'kpi: budget_stop_reasons present',     JSON.stringify(kpi.budget_stop_reasons));
}

// ─────────────────────────────────────────────────────────────
// T8: buildBudgetExceededResult 반환 형식
// ─────────────────────────────────────────────────────────────
{
  const r = cc.buildBudgetExceededResult('max_execution_time_exceeded', '부분 결과');
  assert(r.status === 'partial',         'T8a', 'partial: status=partial',        r.status);
  assert(r.isBudgetStop === true,        'T8b', 'partial: isBudgetStop=true',     `${r.isBudgetStop}`);
  assert(r.reason === 'max_execution_time_exceeded', 'T8c', 'partial: reason correct', r.reason);
  assert(typeof r.message === 'string' && r.message.length > 0, 'T8d', 'partial: message non-empty', r.message);
  assert(r.partialResult === '부분 결과', 'T8e', 'partial: partialResult passed through', r.partialResult);
}

// ─────────────────────────────────────────────────────────────
// getBudgetSummary 형식 검증
// ─────────────────────────────────────────────────────────────
{
  const b = cc.createExecutionBudget('normal');
  cc.trackLLMCall(b, 'gpt-4o', 300);
  cc.trackToolCall(b, 'web_search');
  const s = cc.getBudgetSummary(b);
  assert(s.budget_complexity === 'normal',   'T9a', 'summary: budget_complexity correct', s.budget_complexity);
  assert(s.llm_calls_used === 1,             'T9b', 'summary: llm_calls_used=1',          `${s.llm_calls_used}`);
  assert(s.tool_calls_used === 1,            'T9c', 'summary: tool_calls_used=1',         `${s.tool_calls_used}`);
  assert(s.total_tokens_used === 300,        'T9d', 'summary: total_tokens_used=300',     `${s.total_tokens_used}`);
  assert(s.is_partial_result === false,      'T9e', 'summary: is_partial_result=false',   `${s.is_partial_result}`);
  assert(typeof s.execution_time_ms === 'number', 'T9f', 'summary: execution_time_ms is number', `${s.execution_time_ms}`);
}

// ─────────────────────────────────────────────────────────────
// 결과 요약
// ─────────────────────────────────────────────────────────────
const total = PASS + FAIL;
const elapsed = Date.now() - START;
console.log('\n' + '='.repeat(65));
console.log(`Phase 2 Cost Controller — ${total}개 테스트, ${elapsed}ms`);
console.log(`✅ PASS: ${PASS}  ❌ FAIL: ${FAIL}`);
if (FAIL === 0) {
  console.log('🎉 모든 테스트 통과!');
} else {
  console.log('⚠️ 실패한 테스트가 있습니다. 확인 필요.');
  process.exitCode = 1;
}
