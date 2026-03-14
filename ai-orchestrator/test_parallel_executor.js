// test_parallel_executor.js — Phase 4 Parallel Execution Tests (P1-P6)
// Run: node test_parallel_executor.js
'use strict';

require('dotenv').config();
const pe = require('./src/agent/parallelExecutor');

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

let passed = 0, failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ${GREEN}✅ PASS${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}❌ FAIL${RESET} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── 테스트용 태스크 팩토리 ────────────────────────────────────
function makeTask(id, type, dependsOn = []) {
  return { id, type, name: `Task-${id}`, dependsOn };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── P1: SEARCH 3개 → 병렬 실행 확인 ─────────────────────────
async function testP1() {
  console.log(`\n${BOLD}P1: SEARCH 3개 → 병렬 실행 확인${RESET}`);

  const tasks = [
    makeTask('search_a', 'SEARCH'),
    makeTask('search_b', 'SEARCH'),
    makeTask('search_c', 'SEARCH'),
  ];

  const waves = pe.groupParallelizableTasks(tasks);
  console.log(`  Waves: ${JSON.stringify(waves.map(w => ({ parallel: w.parallel, tasks: w.tasks.map(t => t.id), groupId: w.groupId })))}`);

  assert(waves.length === 1, '웨이브 1개 생성');
  assert(waves[0].parallel === true, '웨이브가 병렬 실행');
  assert(waves[0].tasks.length === 3, `태스크 3개 포함 (${waves[0].tasks.length}개)`);

  // 실제 병렬 실행: 각 task 200ms 소요 → 순차라면 600ms, 병렬이면 ~200ms
  const start = Date.now();
  const results = await pe.runParallelGroup(tasks, async (task) => {
    await sleep(200);
    return `result_${task.id}`;
  });
  const elapsed = Date.now() - start;

  assert(results.length === 3, `결과 3개 반환 (${results.length}개)`);
  assert(results.every(r => r.success), '모든 태스크 성공');
  assert(elapsed < 500, `병렬 실행 시간 < 500ms (실제: ${elapsed}ms)`);
  console.log(`  병렬 실행 시간: ${elapsed}ms (순차 예상: 600ms, 절약: ~${600 - elapsed}ms)`);
}

// ── P2: SEARCH 3개 + SUMMARIZE → search 병렬 / summarize 순차 ─
async function testP2() {
  console.log(`\n${BOLD}P2: SEARCH 3개 + SUMMARIZE → 병렬/순차 혼합${RESET}`);

  const tasks = [
    makeTask('search_a', 'SEARCH'),
    makeTask('search_b', 'SEARCH'),
    makeTask('search_c', 'SEARCH'),
    makeTask('summarize', 'SYNTHESIZE', ['search_a', 'search_b', 'search_c']),
  ];

  const waves = pe.groupParallelizableTasks(tasks);
  console.log(`  Waves: ${waves.length}개`);
  waves.forEach((w, i) => {
    console.log(`    [Wave ${i}] parallel=${w.parallel} tasks=[${w.tasks.map(t => t.id).join(', ')}]`);
  });

  assert(waves.length >= 2, `웨이브 2개 이상 (${waves.length}개)`);

  const parallelWave = waves.find(w => w.parallel);
  const seqWave      = waves.find(w => !w.parallel && w.tasks.some(t => t.type === 'SYNTHESIZE'));

  assert(!!parallelWave, 'SEARCH 병렬 웨이브 존재');
  assert(parallelWave?.tasks.length === 3, `병렬 웨이브에 SEARCH 3개 (${parallelWave?.tasks.length}개)`);
  assert(!!seqWave, 'SYNTHESIZE 순차 웨이브 존재');
  assert(seqWave?.parallel === false, 'SYNTHESIZE는 순차 실행');

  // 레벨 계산 확인
  const levels = pe._computeDependencyLevels(tasks);
  assert(levels.get('search_a') === 0, 'search_a 레벨=0');
  assert(levels.get('search_b') === 0, 'search_b 레벨=0');
  assert(levels.get('summarize') === 1, `summarize 레벨=1 (실제=${levels.get('summarize')})`);
}

// ── P3: 병렬 task 1개 실패 → allSettled로 나머지 유지 ─────────
async function testP3() {
  console.log(`\n${BOLD}P3: 병렬 task 1개 실패 → 나머지 결과 유지${RESET}`);

  const tasks = [
    makeTask('ok_a',   'SEARCH'),
    makeTask('fail_b', 'SEARCH'),
    makeTask('ok_c',   'SEARCH'),
  ];

  const results = await pe.runParallelGroup(tasks, async (task) => {
    if (task.id === 'fail_b') throw new Error('Simulated failure');
    return `result_${task.id}`;
  });

  assert(results.length === 3, `결과 3개 반환 (${results.length}개)`);
  const successes = results.filter(r => r.success);
  const failures  = results.filter(r => !r.success);
  assert(successes.length === 2, `성공 2개 (${successes.length}개)`);
  assert(failures.length  === 1, `실패 1개 (${failures.length}개)`);
  assert(failures[0].task.id === 'fail_b', `실패 태스크 = fail_b (${failures[0].task?.id})`);
  assert(successes.every(r => r.result), '성공 태스크 결과 보존');
  console.log(`  성공: ${successes.map(r => r.task.id).join(', ')} | 실패: ${failures.map(r => r.task.id).join(', ')}`);
}

// ── P4: max_parallel_tools 초과 → 배치 실행 ──────────────────
async function testP4() {
  console.log(`\n${BOLD}P4: max_parallel_tools=3 초과 → 배치 분할 실행${RESET}`);

  // 5개 task → 배치 [3, 2]
  const tasks = Array.from({ length: 5 }, (_, i) => makeTask(`search_${i}`, 'SEARCH'));

  const waves = pe.groupParallelizableTasks(tasks);
  console.log(`  Tasks: 5개, Waves: ${waves.length}개`);
  waves.forEach((w, i) => {
    console.log(`    [Wave ${i}] parallel=${w.parallel} tasks=[${w.tasks.map(t => t.id).join(', ')}]`);
  });

  // max=3이므로 첫 배치 3개, 두번째 배치 2개
  assert(waves.length === 2, `배치 2개로 분할 (실제: ${waves.length}개)`);
  assert(waves[0].parallel === true, '첫 배치 병렬 실행');
  assert(waves[0].tasks.length === 3, `첫 배치 3개 (${waves[0].tasks.length}개)`);
  assert(waves[1].tasks.length === 2, `두번째 배치 2개 (${waves[1].tasks.length}개)`);

  // 실제 runParallelGroup: maxParallel=3으로 5개 처리
  const results = await pe.runParallelGroup(tasks, async (task) => {
    await sleep(100);
    return `done_${task.id}`;
  }, { maxParallel: 3 });

  assert(results.length === 5, `결과 5개 반환 (${results.length}개)`);
  assert(results.every(r => r.success), '모든 태스크 성공');
  console.log(`  배치 처리 성공: ${results.map(r => r.result).join(', ')}`);
}

// ── P5: budget 적용 → token/tool usage 정상 누적 ─────────────
async function testP5() {
  console.log(`\n${BOLD}P5: budget 적용 → tool usage 정상 누적${RESET}`);

  const costController = require('./src/agent/costController');
  const budget = costController.createExecutionBudget('normal');

  assert(budget.limits.maxToolCalls === 5, `normal budget maxToolCalls=5 (${budget.limits.maxToolCalls})`);
  assert(budget.toolCalls === 0, '초기 toolCalls=0');

  // tool call 2번
  const r1 = costController.trackToolCall(budget, 'web_search');
  const r2 = costController.trackToolCall(budget, 'web_search');
  assert(r1.ok && r2.ok, '2회 toolCall 성공');
  assert(budget.toolCalls === 2, `toolCalls=2 (${budget.toolCalls})`);

  // 병렬 실행 중 budget 추적
  const tasks = [
    makeTask('s1', 'SEARCH'),
    makeTask('s2', 'SEARCH'),
  ];

  let callCount = 0;
  await pe.runParallelGroup(tasks, async (task) => {
    const check = costController.trackToolCall(budget, 'web_search');
    if (!check.ok) return `[건너뜀: ${check.reason}]`;
    callCount++;
    return `result_${task.id}`;
  });

  assert(budget.toolCalls === 4, `병렬 후 toolCalls=4 (${budget.toolCalls})`);
  assert(callCount === 2, `실제 호출 2회 (${callCount}회)`);

  // budget 초과 테스트 (maxToolCalls=5 → 2번 더 호출 시 초과)
  costController.trackToolCall(budget, 'web_search'); // 5
  const overCheck = costController.trackToolCall(budget, 'web_search'); // 6 > 5
  assert(!overCheck.ok, `6번째 호출 budget 초과 확인 (ok=${overCheck.ok})`);
  assert(budget.isExceeded, 'budget.isExceeded=true');
  console.log(`  최종 toolCalls: ${budget.toolCalls}/${budget.limits.maxToolCalls}`);
}

// ── P6: failure replay → 병렬 실패 구조 저장 확인 ─────────────
async function testP6() {
  console.log(`\n${BOLD}P6: failure replay → 병렬 실패 메타데이터 저장${RESET}`);

  // buildParallelSummary 테스트
  const mockGroupResults = [
    { task: makeTask('s1', 'SEARCH'), result: 'ok', error: null, success: true,  ms: 500, groupId: 'pg_0_0' },
    { task: makeTask('s2', 'SEARCH'), result: null, error: 'timeout', success: false, ms: 15000, groupId: 'pg_0_0' },
    { task: makeTask('s3', 'SEARCH'), result: 'ok', error: null, success: true,  ms: 700, groupId: 'pg_0_0' },
  ];

  const summary = pe.buildParallelSummary(mockGroupResults);
  assert(summary.parallel_group_id === 'pg_0_0', `group_id 정확 (${summary.parallel_group_id})`);
  assert(summary.parallel_group_size === 3, `group_size=3 (${summary.parallel_group_size})`);
  assert(summary.parallel_success === 2, `success=2 (${summary.parallel_success})`);
  assert(summary.parallel_failures === 1, `failures=1 (${summary.parallel_failures})`);
  assert(Array.isArray(summary.parallel_task_results), 'parallel_task_results 배열');
  assert(summary.failed_parallel_tasks.includes('s2'), `failed_tasks=['s2'] (${summary.failed_parallel_tasks})`);

  // failureStore에 parallel 데이터 저장 테스트
  const failureStore = require('./src/agent/failureStore');
  const id = failureStore.captureFailure({
    userMessage:          'parallel test message',
    errorType:            'chain_error',
    finalError:           'P6 test error',
    parallelGroupId:      'pg_0_0',
    parallelGroupSize:    3,
    parallelTaskResults:  summary.parallel_task_results,
    failedParallelTasks:  summary.failed_parallel_tasks,
  });

  assert(typeof id === 'number' || id !== null, `failureStore 저장 성공 (id=${id})`);

  if (id) {
    const saved = failureStore.getFailure(id);
    assert(saved !== null, 'failureStore에서 조회 성공');
    if (saved) {
      console.log(`  저장된 실패 id=${saved.id}, errorType=${saved.errorType}`);
    }
  }
}

// ── 추가: mergeParallelResults dedupe/ranking 테스트 ──────────
async function testMerge() {
  console.log(`\n${BOLD}Extra: mergeParallelResults — dedupe + ranking${RESET}`);

  const r1 = `[웹 검색: "Python"] (brave)
✅ Python is a programming language.

• **Python.org**
  Official Python site
  🔗 https://python.org`;

  const r2 = `[웹 검색: "Python tutorial"] (serpapi)
• **Python.org**
  Official Python site
  🔗 https://python.org

• **W3Schools Python**
  Learn Python online
  🔗 https://w3schools.com/python`;

  const merged = pe.mergeParallelResults([r1, r2], 'Python');
  assert(typeof merged === 'string', 'merged 결과 string 반환');
  assert(merged.includes('병렬 검색 결과 병합'), '병합 헤더 포함');

  // Python.org가 중복이므로 한 번만 나와야 함
  const pythonOrgCount = (merged.match(/python\.org/gi) || []).length;
  assert(pythonOrgCount <= 2, `python.org 중복 제거 (${pythonOrgCount}회)`);
  console.log(`  병합 결과 길이: ${merged.length}자`);
  console.log(`  Preview: ${merged.slice(0, 150)}...`);
}

// ── KPI 검증 ───────────────────────────────────────────────────
async function testKPI() {
  console.log(`\n${BOLD}KPI: getParallelKPI() 집계 확인${RESET}`);

  const kpi = pe.getParallelKPI();
  assert(typeof kpi.parallel_groups_total      === 'number', 'parallel_groups_total number');
  assert(typeof kpi.parallel_tasks_total       === 'number', 'parallel_tasks_total number');
  assert(typeof kpi.parallel_success_rate      === 'string', 'parallel_success_rate string');
  assert(typeof kpi.average_parallel_group_size === 'number', 'avg_parallel_group_size number');
  assert(typeof kpi.sequential_tasks_total     === 'number', 'sequential_tasks_total number');
  assert(typeof kpi.max_parallel_tools         === 'number', 'max_parallel_tools number');
  assert(kpi.max_parallel_tools === 3, `max_parallel_tools=3 (${kpi.max_parallel_tools})`);

  console.log(`  KPI: groups=${kpi.parallel_groups_total}, tasks=${kpi.parallel_tasks_total}, rate=${kpi.parallel_success_rate}`);
}

// ── 메인 실행 ──────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}=== Phase 4: Parallel Executor Tests ===${RESET}\n`);

  await testP1();
  await testP2();
  await testP3();
  await testP4();
  await testP5();
  await testP6();
  await testMerge();
  await testKPI();

  console.log(`\n${BOLD}─────────────────────────────────────${RESET}`);
  console.log(`${BOLD}Results: ${GREEN}${passed} PASS${RESET} / ${failed > 0 ? RED : ''}${failed} FAIL${RESET}`);
  console.log(`─────────────────────────────────────`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
