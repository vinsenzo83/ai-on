/**
 * dailyCycleEngine.js
 * 24시간 자동 사이클 메인 오케스트레이터
 * 
 * 사이클:
 * 1. 현재 DB 로드
 * 2. 부족 기술/AI 분석 (systemPatcher)
 * 3. types/index.js 자동 패치
 * 4. 새 테스트케이스 생성 (caseExpander)
 * 5. DB 저장 + 리포트 생성
 * 6. 로그 기록
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'testcases_db.json');
const LOG_PATH = path.join(__dirname, 'cycle_log.json');
const REPORT_PATH = path.join(__dirname, 'daily_report.json');

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return { meta: { total_cases: 0, version: '1.0.0', generated_at: new Date().toISOString() }, stats: {}, cases: [] };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return { cycles: [] };
  return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
}

function saveLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function now() { return new Date().toISOString(); }

function log(msg) {
  console.log(`[${now()}] ${msg}`);
}

// ─────────────────────────────────────────────
// 분석: 부족 기술 집계
// ─────────────────────────────────────────────
function analyzeMissing(cases) {
  const missingTech = {};
  const missingRoles = {};
  const missingApis = {};
  const uncoveredDomains = {};

  for (const c of cases) {
    // missing_tech 집계
    for (const t of (c.missing_tech || [])) {
      missingTech[t] = (missingTech[t] || 0) + 1;
    }
    // required_apis 집계
    for (const a of (c.required_apis || [])) {
      missingApis[a] = (missingApis[a] || 0) + 1;
    }
    // roles 집계 (알 수 없는 role 탐지는 별도)
    for (const r of (c.roles || [])) {
      missingRoles[r] = (missingRoles[r] || 0) + 1;
    }
    // 시스템 미커버 케이스
    if (!c.system_coverage) {
      uncoveredDomains[c.domain] = (uncoveredDomains[c.domain] || 0) + 1;
    }
  }

  // 정렬
  const sortDesc = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);

  return {
    topMissingTech: sortDesc(missingTech).slice(0, 20),
    topMissingApis: sortDesc(missingApis).slice(0, 15),
    topRoles: sortDesc(missingRoles).slice(0, 15),
    uncoveredDomains: sortDesc(uncoveredDomains),
    totalUncovered: Object.values(uncoveredDomains).reduce((a, b) => a + b, 0)
  };
}

// ─────────────────────────────────────────────
// 케이스 확장 (로컬 생성)
// ─────────────────────────────────────────────
function expandCases(db, targetPerCycle = 50) {
  const { caseExpander } = require('./caseExpander');
  const existing = db.cases;
  const newCases = caseExpander(existing, targetPerCycle);
  return newCases;
}

// ─────────────────────────────────────────────
// 시스템 패치
// ─────────────────────────────────────────────
function patchSystem(analysis) {
  const { systemPatcher } = require('./systemPatcher');
  return systemPatcher(analysis);
}

// ─────────────────────────────────────────────
// 통계 재계산
// ─────────────────────────────────────────────
function recomputeStats(cases) {
  const byDomain = {};
  const byFeasibility = {};
  const byComplexity = {};
  const topRolesMap = {};
  const topApisMap = {};
  const topMissingMap = {};

  for (const c of cases) {
    byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
    byFeasibility[c.feasibility] = (byFeasibility[c.feasibility] || 0) + 1;
    byComplexity[c.complexity] = (byComplexity[c.complexity] || 0) + 1;
    for (const r of (c.roles || [])) topRolesMap[r] = (topRolesMap[r] || 0) + 1;
    for (const a of (c.required_apis || [])) topApisMap[a] = (topApisMap[a] || 0) + 1;
    for (const t of (c.missing_tech || [])) topMissingMap[t] = (topMissingMap[t] || 0) + 1;
  }

  const sortTop = (obj, n) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  return {
    total: cases.length,
    by_domain: byDomain,
    by_feasibility: byFeasibility,
    by_complexity: byComplexity,
    top_roles: sortTop(topRolesMap, 10),
    top_apis: sortTop(topApisMap, 10),
    top_missing_tech: sortTop(topMissingMap, 20)
  };
}

// ─────────────────────────────────────────────
// 메인 사이클
// ─────────────────────────────────────────────
async function runDailyCycle(options = {}) {
  const cycleStart = Date.now();
  const cycleId = `cycle_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  log(`=== 일일 사이클 시작: ${cycleId} ===`);

  const result = {
    cycleId,
    startedAt: now(),
    steps: [],
    success: false
  };

  try {
    // STEP 1: DB 로드
    log('STEP 1: DB 로드');
    const db = loadDB();
    const beforeCount = db.cases.length;
    result.steps.push({ step: 1, name: 'DB 로드', casesBefore: beforeCount });
    log(`  → 현재 케이스 수: ${beforeCount}`);

    // STEP 2: 부족 기술 분석
    log('STEP 2: 부족 기술/AI 분석');
    const analysis = analyzeMissing(db.cases);
    result.steps.push({
      step: 2, name: '분석',
      topMissingTech: analysis.topMissingTech.slice(0, 5),
      topMissingApis: analysis.topMissingApis.slice(0, 5),
      totalUncovered: analysis.totalUncovered
    });
    log(`  → 미커버 케이스: ${analysis.totalUncovered}, 부족기술 top5: ${analysis.topMissingTech.slice(0,5).map(x=>x[0]).join(', ')}`);

    // STEP 3: 시스템 패치 (role/combo/tasktype 자동 추가)
    log('STEP 3: 시스템 패치');
    const patchResult = patchSystem(analysis);
    result.steps.push({ step: 3, name: '시스템 패치', ...patchResult });
    log(`  → 패치: roles +${patchResult.rolesAdded}, combos +${patchResult.combosAdded}, taskTypes +${patchResult.taskTypesAdded}`);

    // STEP 4: 새 케이스 생성
    log('STEP 4: 새 테스트케이스 생성');
    const targetPerCycle = options.targetPerCycle || 50;
    const newCases = expandCases(db, targetPerCycle);
    result.steps.push({ step: 4, name: '케이스 생성', generated: newCases.length });
    log(`  → 새 케이스 생성: ${newCases.length}개`);

    // STEP 5: DB 병합 + 저장
    log('STEP 5: DB 저장');
    // ID 재할당 (중복 방지)
    const maxId = Math.max(0, ...db.cases.map(c => c.id || 0));
    newCases.forEach((c, i) => {
      c.id = maxId + i + 1;
      c.created_at = now();
      c.cycle_id = cycleId;
    });
    db.cases = [...db.cases, ...newCases];
    db.stats = recomputeStats(db.cases);
    db.meta = {
      ...db.meta,
      total_cases: db.cases.length,
      last_cycle: cycleId,
      last_updated: now(),
      version: bumpVersion(db.meta.version || '2.0.0')
    };
    saveDB(db);
    const afterCount = db.cases.length;
    result.steps.push({ step: 5, name: 'DB 저장', casesAfter: afterCount, added: afterCount - beforeCount });
    log(`  → DB 저장 완료: ${beforeCount} → ${afterCount} (+${afterCount - beforeCount})`);

    // STEP 6: 리포트 생성
    log('STEP 6: 리포트 생성');
    const report = generateReport(db, analysis, patchResult, newCases, cycleId);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    result.steps.push({ step: 6, name: '리포트 저장', path: REPORT_PATH });
    log(`  → 리포트 저장: ${REPORT_PATH}`);

    // 사이클 완료
    result.success = true;
    result.completedAt = now();
    result.durationMs = Date.now() - cycleStart;
    result.summary = {
      before: beforeCount,
      after: afterCount,
      added: afterCount - beforeCount,
      patchResult,
      topMissingTech: analysis.topMissingTech.slice(0, 10)
    };

  } catch (err) {
    result.success = false;
    result.error = err.message;
    result.stack = err.stack;
    log(`ERROR: ${err.message}`);
  }

  // 로그 저장
  const cycleLog = loadLog();
  cycleLog.cycles.push(result);
  // 최근 30회만 보관
  if (cycleLog.cycles.length > 30) cycleLog.cycles = cycleLog.cycles.slice(-30);
  saveLog(cycleLog);

  log(`=== 사이클 완료 (${result.durationMs}ms) success=${result.success} ===`);
  return result;
}

function bumpVersion(v) {
  const parts = v.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

function generateReport(db, analysis, patchResult, newCases, cycleId) {
  const byFeas = db.stats.by_feasibility || {};
  const total = db.stats.total || db.cases.length;
  const ready = byFeas.ready || 0;
  const apiNeeded = byFeas.api_needed || 0;

  return {
    cycleId,
    generatedAt: now(),
    summary: {
      totalCases: total,
      readyCases: ready,
      readyPct: ((ready / total) * 100).toFixed(1) + '%',
      apiNeededCases: apiNeeded,
      apiNeededPct: ((apiNeeded / total) * 100).toFixed(1) + '%',
      newCasesThisCycle: newCases.length
    },
    patch: patchResult,
    missingAnalysis: {
      topMissingTech: analysis.topMissingTech.slice(0, 10),
      topMissingApis: analysis.topMissingApis.slice(0, 10),
      uncoveredDomains: analysis.uncoveredDomains
    },
    domainBreakdown: db.stats.by_domain,
    complexityBreakdown: db.stats.by_complexity,
    topRoles: db.stats.top_roles,
    topApis: db.stats.top_apis,
    recommendations: buildRecommendations(analysis)
  };
}

function buildRecommendations(analysis) {
  const recs = [];
  const topApis = analysis.topMissingApis.slice(0, 3);
  for (const [api, count] of topApis) {
    recs.push({
      priority: 'HIGH',
      action: `${api} 연동 구현`,
      impact: `${count}개 케이스 즉시 커버 가능`,
      effort: count > 30 ? '중간' : '낮음'
    });
  }
  const topTech = analysis.topMissingTech.slice(0, 3);
  for (const [tech, count] of topTech) {
    recs.push({
      priority: 'MEDIUM',
      action: `${tech} 모듈 개발`,
      impact: `${count}개 케이스 커버`,
      effort: '높음'
    });
  }
  return recs;
}

// ─────────────────────────────────────────────
// CLI 직접 실행 지원
// ─────────────────────────────────────────────
if (require.main === module) {
  runDailyCycle({ targetPerCycle: 50 })
    .then(r => {
      console.log('\n✅ 사이클 결과:', JSON.stringify(r.summary || r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runDailyCycle, analyzeMissing, recomputeStats };
