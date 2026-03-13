// ============================================================
// parallelExecutor.js — Phase 4: Parallel Tool Execution
// ============================================================
//
// 역할:
//   1. groupParallelizableTasks(tasks)
//      - tasks 배열을 실행 웨이브(wave) 배열로 분리
//      - 독립 태스크 그룹 → parallel_group (Promise.allSettled)
//      - 의존성 있는 태스크    → sequential_group (순차 실행)
//
//   2. runParallelGroup(taskGroup, execFn)
//      - Promise.allSettled 기반 병렬 실행
//      - 개별 실패 포함 결과 배열 반환 (전체 중단 없음)
//      - max_parallel_tools 배치 처리 지원
//
//   3. mergeParallelResults(results)
//      - dedupe: 동일 URL / 동일 title 중복 제거
//      - ranking: query relevance, source, freshness 기반 정렬
//      - normalize: 공통 포맷 { title, url, snippet, source, score }
//
//   4. KPI 집계:
//      - parallel_groups_total
//      - parallel_tasks_total
//      - parallel_success_rate
//      - average_parallel_group_size
//
// ============================================================

'use strict';

// ─────────────────────────────────────────────────────────────
// § 설정
// ─────────────────────────────────────────────────────────────
const PARALLEL_CONFIG = {
  // 동시 실행 최대 수 (초기값 3, 최대 5)
  MAX_PARALLEL_TOOLS:    3,

  // 병렬 실행 가능한 태스크 타입 Set
  PARALLELIZABLE_TYPES:  new Set(['SEARCH', 'EXTRACT', 'TOOL', 'DATA_FETCH']),

  // 순차 실행만 허용 (이전 결과 의존성 높음)
  SEQUENTIAL_ONLY_TYPES: new Set(['WRITE', 'SYNTHESIZE', 'PLAN', 'CODE', 'REVIEW']),
};

// ─────────────────────────────────────────────────────────────
// § KPI 누적기
// ─────────────────────────────────────────────────────────────
const _kpi = {
  parallelGroupsTotal:      0,
  parallelTasksTotal:       0,
  parallelSuccessTotal:     0,
  parallelFailureTotal:     0,
  groupSizesSum:            0,
  sequentialTasksTotal:     0,
  timeSavedEstimateMs:      0, // 병렬화로 절약된 추정 시간
};

// ─────────────────────────────────────────────────────────────
// § 1. 태스크 그룹화 → 실행 웨이브 배열
// ─────────────────────────────────────────────────────────────

/**
 * groupParallelizableTasks(tasks)
 *
 * tasks 배열을 실행 순서를 유지하며 웨이브(wave)로 그룹화.
 *
 * Wave 구조:
 *   { parallel: true/false, tasks: [...] }
 *
 * 알고리즘:
 *   - 의존성 그래프를 위상 정렬(topological level)로 계층화
 *   - 같은 레벨에서 PARALLELIZABLE_TYPES 태스크 → parallel wave
 *   - 같은 레벨에서 SEQUENTIAL_ONLY_TYPES 태스크 → 개별 sequential wave
 *   - MAX_PARALLEL_TOOLS 초과 시 배치 분할
 *
 * @param {Array} tasks - 태스크 배열 (id, type, dependsOn 포함)
 * @returns {Array<{ parallel: boolean, tasks: Array, groupId: string }>}
 */
function groupParallelizableTasks(tasks) {
  if (!tasks || tasks.length === 0) return [];

  // Step 1: 의존성 레벨 계산 (위상 정렬)
  const levels = _computeDependencyLevels(tasks);

  // Step 2: 레벨별로 태스크 그룹화
  const levelMap = new Map();
  for (const task of tasks) {
    const lvl = levels.get(task.id) ?? 0;
    if (!levelMap.has(lvl)) levelMap.set(lvl, []);
    levelMap.get(lvl).push(task);
  }

  const waves = [];
  const sortedLevels = [...levelMap.keys()].sort((a, b) => a - b);
  let groupCounter = 0;

  for (const lvl of sortedLevels) {
    const levelTasks = levelMap.get(lvl);

    // 병렬 가능 태스크와 순차 전용 태스크 분리
    const parallelizable = levelTasks.filter(t =>
      PARALLEL_CONFIG.PARALLELIZABLE_TYPES.has(t.type)
    );
    const sequential = levelTasks.filter(t =>
      !PARALLEL_CONFIG.PARALLELIZABLE_TYPES.has(t.type)
    );

    // 병렬 그룹 생성 (MAX_PARALLEL_TOOLS 배치 분할)
    if (parallelizable.length > 1) {
      // MAX 초과 시 배치로 쪼갬
      for (let i = 0; i < parallelizable.length; i += PARALLEL_CONFIG.MAX_PARALLEL_TOOLS) {
        const batch = parallelizable.slice(i, i + PARALLEL_CONFIG.MAX_PARALLEL_TOOLS);
        waves.push({
          parallel: true,
          tasks:    batch,
          groupId:  `pg_${lvl}_${groupCounter++}`,
          level:    lvl,
        });
      }
    } else if (parallelizable.length === 1) {
      // 1개면 순차로
      waves.push({
        parallel: false,
        tasks:    parallelizable,
        groupId:  `sg_${lvl}_${groupCounter++}`,
        level:    lvl,
      });
    }

    // 순차 전용 태스크는 개별 wave
    for (const task of sequential) {
      waves.push({
        parallel: false,
        tasks:    [task],
        groupId:  `sq_${lvl}_${groupCounter++}`,
        level:    lvl,
      });
    }
  }

  return waves;
}

/**
 * _computeDependencyLevels(tasks)
 * BFS 기반 위상 정렬 → 각 태스크의 최소 실행 레벨 반환
 * 레벨 0: 의존성 없음 (즉시 실행 가능)
 * 레벨 N: N개 선행 태스크 완료 필요
 */
function _computeDependencyLevels(tasks) {
  const idToTask = new Map(tasks.map(t => [t.id, t]));
  const levels   = new Map();

  // 의존성 없는 태스크 → 레벨 0
  for (const task of tasks) {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      levels.set(task.id, 0);
    }
  }

  // BFS: 의존성 있는 태스크 레벨 계산
  let changed = true;
  let maxIter = tasks.length + 1; // 순환 방지
  while (changed && maxIter-- > 0) {
    changed = false;
    for (const task of tasks) {
      if (levels.has(task.id)) continue;
      const deps = task.dependsOn || [];
      if (deps.every(d => levels.has(d))) {
        const maxDepLevel = Math.max(...deps.map(d => levels.get(d) ?? 0));
        levels.set(task.id, maxDepLevel + 1);
        changed = true;
      }
    }
  }

  // 미결정 태스크 → 맨 뒤에 배치
  for (const task of tasks) {
    if (!levels.has(task.id)) levels.set(task.id, 999);
  }

  return levels;
}

// ─────────────────────────────────────────────────────────────
// § 2. 병렬 실행 (Promise.allSettled)
// ─────────────────────────────────────────────────────────────

/**
 * runParallelGroup(taskGroup, execFn, options)
 *
 * 태스크 그룹을 병렬로 실행하고 모든 결과(성공+실패)를 반환.
 * Rule 4: 일부 실패해도 나머지 결과는 수집.
 *
 * @param {Array} taskGroup - 병렬 실행할 태스크 배열
 * @param {Function} execFn - async execFn(task) → result
 * @param {Object} options
 *   @param {number} [options.maxParallel=3] - 최대 동시 실행 수
 *   @param {string} [options.groupId]       - 그룹 식별자 (KPI용)
 * @returns {Promise<Array<{ task, result, error, success, ms }>>}
 */
async function runParallelGroup(taskGroup, execFn, options = {}) {
  const maxParallel = options.maxParallel || PARALLEL_CONFIG.MAX_PARALLEL_TOOLS;
  const groupId     = options.groupId || `g_${Date.now()}`;
  const groupStart  = Date.now();

  // 배치 처리: maxParallel 초과 시 나눠서 실행
  const allResults = [];
  for (let i = 0; i < taskGroup.length; i += maxParallel) {
    const batch      = taskGroup.slice(i, i + maxParallel);
    const batchStart = Date.now();

    const settled = await Promise.allSettled(
      batch.map(async (task) => {
        const taskStart = Date.now();
        try {
          const result = await execFn(task);
          return { task, result, error: null, success: true, ms: Date.now() - taskStart };
        } catch (err) {
          return { task, result: null, error: err.message || String(err), success: false, ms: Date.now() - taskStart };
        }
      })
    );

    for (const s of settled) {
      const val = s.status === 'fulfilled' ? s.value : {
        task:    null,
        result:  null,
        error:   s.reason?.message || String(s.reason),
        success: false,
        ms:      Date.now() - batchStart,
      };
      allResults.push({ ...val, groupId });
    }
  }

  // KPI 업데이트
  const successCount = allResults.filter(r => r.success).length;
  const failureCount = allResults.length - successCount;
  const groupMs      = Date.now() - groupStart;

  _kpi.parallelGroupsTotal++;
  _kpi.parallelTasksTotal    += allResults.length;
  _kpi.parallelSuccessTotal  += successCount;
  _kpi.parallelFailureTotal  += failureCount;
  _kpi.groupSizesSum         += taskGroup.length;

  // 절약 시간 추정: 순차 실행 시간 - 병렬 실행 시간
  const seqEstimate = allResults.reduce((sum, r) => sum + (r.ms || 0), 0);
  _kpi.timeSavedEstimateMs += Math.max(0, seqEstimate - groupMs);

  console.log(`[ParallelExecutor] 그룹 ${groupId}: ${allResults.length}개 실행 → 성공 ${successCount} / 실패 ${failureCount} (${groupMs}ms)`);

  return allResults;
}

// ─────────────────────────────────────────────────────────────
// § 3. 병렬 결과 병합 (dedupe + ranking + normalize)
// ─────────────────────────────────────────────────────────────

/**
 * mergeParallelResults(results, query)
 *
 * 여러 검색/툴 결과를 하나의 문자열로 병합.
 * - dedupe: 동일 URL/title 중복 제거
 * - ranking: 관련도, 신선도, 소스 품질 기반 정렬
 * - normalize: 공통 포맷으로 통일
 *
 * @param {Array<string|null>} results  - 각 병렬 태스크의 결과 문자열 배열
 * @param {string} [query='']          - 원본 쿼리 (관련도 점수용)
 * @returns {string} 병합된 결과 문자열
 */
function mergeParallelResults(results, query = '') {
  const validResults = results.filter(r => r && typeof r === 'string' && r.length > 10);
  if (validResults.length === 0) return '[검색 결과 없음]';
  if (validResults.length === 1) return validResults[0];

  // 파싱: 결과 문자열 → 항목 배열
  const items = [];
  for (const raw of validResults) {
    const parsed = _parseResultItems(raw);
    items.push(...parsed);
  }

  // 중복 제거
  const deduped = _dedupeItems(items);

  // 점수 계산 + 정렬
  const ranked = _rankItems(deduped, query);

  // 상위 10개 정규화 포맷으로 직렬화
  const top = ranked.slice(0, 10);
  const lines = [];

  // 즉답(answer) 먼저
  const answers = top.filter(i => i.type === 'answer');
  const others  = top.filter(i => i.type !== 'answer');

  for (const a of answers) lines.push(`✅ ${a.snippet}`);
  for (const o of others)  lines.push(`• **${o.title}**\n  ${o.snippet}\n  🔗 ${o.url}`);

  return `[병렬 검색 결과 병합: ${deduped.length}건 → 상위 ${top.length}건]\n\n${lines.join('\n\n')}`;
}

/**
 * _parseResultItems(raw)
 * 검색 결과 문자열을 개별 항목 배열로 파싱
 */
function _parseResultItems(raw) {
  const items  = [];
  const lines  = raw.split('\n');
  let current  = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 즉답 라인
    if (trimmed.startsWith('✅ ')) {
      items.push({ type: 'answer', title: 'Answer', snippet: trimmed.slice(3), url: '', score: 100 });
      current = null;
      continue;
    }

    // 뉴스/결과 헤더: • **title**
    const titleMatch = trimmed.match(/^[•·]\s*\*\*(.+?)\*\*/);
    if (titleMatch) {
      current = { type: 'result', title: titleMatch[1], snippet: '', url: '', score: 50 };
      items.push(current);
      continue;
    }

    // URL 라인
    if (trimmed.startsWith('🔗 ') && current) {
      current.url = trimmed.slice(3).trim();
      current = null;
      continue;
    }

    // 스니펫 라인
    if (current && !current.snippet) {
      current.snippet = trimmed;
      continue;
    }
  }

  return items.filter(i => i.title || i.snippet);
}

/**
 * _dedupeItems(items)
 * URL 또는 title 기준 중복 제거
 */
function _dedupeItems(items) {
  const seenUrls   = new Set();
  const seenTitles = new Set();
  const result     = [];

  for (const item of items) {
    const urlKey   = (item.url   || '').toLowerCase().replace(/https?:\/\//, '').replace(/\/$/, '');
    const titleKey = (item.title || '').toLowerCase().trim().slice(0, 60);

    if (item.url && seenUrls.has(urlKey))     continue;
    if (item.title && seenTitles.has(titleKey)) {
      // 중복 title이어도 URL이 다르면 허용 (다른 소스)
      if (!item.url || seenUrls.has(urlKey)) continue;
    }

    if (urlKey)   seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    result.push(item);
  }

  return result;
}

/**
 * _rankItems(items, query)
 * 관련도·소스·신선도 기반 점수 정렬
 */
function _rankItems(items, query) {
  const qTerms = (query || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);

  return items.map(item => {
    let score = item.score || 50;

    // 즉답 보너스
    if (item.type === 'answer') { score += 40; }

    // 쿼리 관련도: 제목/스니펫에 쿼리 단어 포함 시 보너스
    const haystack = `${item.title} ${item.snippet}`.toLowerCase();
    for (const term of qTerms) {
      if (haystack.includes(term)) score += 5;
    }

    // 신뢰 소스 보너스 (Wikipedia, 주요 뉴스)
    const trustedDomains = ['wikipedia.org', 'naver.com', 'daum.net', 'google.com', 'github.com', 'mdn.io', 'docs.'];
    for (const domain of trustedDomains) {
      if ((item.url || '').includes(domain)) { score += 10; break; }
    }

    // 스니펫 길이 보너스 (내용이 풍부)
    if (item.snippet.length > 100) score += 5;
    if (item.snippet.length > 200) score += 5;

    return { ...item, score };
  }).sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────
// § 4. 병렬 실행 요약 로그 생성
// ─────────────────────────────────────────────────────────────

/**
 * buildParallelSummary(groupResults)
 * 병렬 실행 결과 배열 → 로그/저장용 요약 객체
 */
function buildParallelSummary(groupResults) {
  const summary = {
    parallel_group_id:    groupResults[0]?.groupId || null,
    parallel_group_size:  groupResults.length,
    parallel_success:     groupResults.filter(r => r.success).length,
    parallel_failures:    groupResults.filter(r => !r.success).length,
    parallel_task_results: groupResults.map(r => ({
      taskId:  r.task?.id   || null,
      type:    r.task?.type || null,
      success: r.success,
      ms:      r.ms,
      error:   r.error || null,
    })),
    failed_parallel_tasks: groupResults
      .filter(r => !r.success)
      .map(r => r.task?.id || null)
      .filter(Boolean),
  };
  return summary;
}

// ─────────────────────────────────────────────────────────────
// § 5. KPI
// ─────────────────────────────────────────────────────────────

function getParallelKPI() {
  const total   = _kpi.parallelTasksTotal || 0;
  const groups  = _kpi.parallelGroupsTotal || 0;
  const success = _kpi.parallelSuccessTotal;

  return {
    parallel_groups_total:        groups,
    parallel_tasks_total:         total,
    parallel_success_rate:        total > 0
      ? ((success / total) * 100).toFixed(1) + '%'
      : '0%',
    parallel_failure_total:       _kpi.parallelFailureTotal,
    average_parallel_group_size:  groups > 0
      ? +(_kpi.groupSizesSum / groups).toFixed(2)
      : 0,
    sequential_tasks_total:       _kpi.sequentialTasksTotal,
    time_saved_estimate_ms:       _kpi.timeSavedEstimateMs,
    max_parallel_tools:           PARALLEL_CONFIG.MAX_PARALLEL_TOOLS,
  };
}

/**
 * recordSequentialTask()
 * 순차 실행 태스크 수 기록 (비교 KPI용)
 */
function recordSequentialTask() {
  _kpi.sequentialTasksTotal++;
}

/**
 * setMaxParallelTools(n)
 * 최대 병렬 실행 수 동적 변경 (1-5)
 */
function setMaxParallelTools(n) {
  PARALLEL_CONFIG.MAX_PARALLEL_TOOLS = Math.min(Math.max(n, 1), 5);
  console.log(`[ParallelExecutor] max_parallel_tools → ${PARALLEL_CONFIG.MAX_PARALLEL_TOOLS}`);
}

// ─────────────────────────────────────────────────────────────
// § exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  // 설정
  PARALLEL_CONFIG,

  // 핵심 API
  groupParallelizableTasks,
  runParallelGroup,
  mergeParallelResults,
  buildParallelSummary,

  // KPI
  getParallelKPI,
  recordSequentialTask,
  setMaxParallelTools,

  // 내부 (테스트용)
  _computeDependencyLevels,
  _parseResultItems,
  _dedupeItems,
  _rankItems,
};
