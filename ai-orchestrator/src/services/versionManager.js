'use strict';
/**
 * versionManager.js — Phase 7D: 파이프라인 버전 관리 + A/B 테스트
 */
const crypto = require('crypto');

const versions   = new Map(); // pipelineName → [versionObj]
const abTests    = new Map(); // testId → abTestObj
const abResults  = new Map(); // testId → [resultObj]

// ── Version Management ────────────────────────────────────────
function registerVersion(pipelineName, code, meta = {}) {
  const list = versions.get(pipelineName) || [];
  const version = {
    id:          `v${list.length + 1}.0`,
    pipelineName,
    code,
    hash:        crypto.createHash('md5').update(code || pipelineName).digest('hex').slice(0, 8),
    meta:        { ...meta, createdAt: new Date().toISOString() },
    status:      'active',
    metrics:     { calls: 0, avgMs: 0, errorRate: 0, qualityScore: 0 },
  };
  list.push(version);
  versions.set(pipelineName, list);
  return version;
}

function getVersions(pipelineName) {
  return versions.get(pipelineName) || [];
}

function updateMetrics(pipelineName, versionId, { ms, success, qualityScore }) {
  const list = versions.get(pipelineName) || [];
  const v = list.find(x => x.id === versionId);
  if (!v) return;
  const prev = v.metrics;
  prev.calls++;
  prev.avgMs = Math.round((prev.avgMs * (prev.calls - 1) + ms) / prev.calls);
  if (!success) prev.errorRate = +(prev.errorRate * (prev.calls - 1) / prev.calls + 1 / prev.calls).toFixed(4);
  if (qualityScore) prev.qualityScore = +(prev.qualityScore * (prev.calls - 1) / prev.calls + qualityScore / prev.calls).toFixed(3);
}

// ── A/B Test ──────────────────────────────────────────────────
function createABTest(pipelineName, { variantA, variantB, splitPct = 50, description = '' }) {
  const testId = 'ab-' + Date.now();
  const test = {
    testId, pipelineName, description,
    variantA: { name: variantA, traffic: splitPct,       results: { calls: 0, avgMs: 0, wins: 0 } },
    variantB: { name: variantB, traffic: 100 - splitPct, results: { calls: 0, avgMs: 0, wins: 0 } },
    status: 'running',
    createdAt: new Date().toISOString(),
    winner: null,
  };
  abTests.set(testId, test);
  abResults.set(testId, []);
  return test;
}

function routeABTest(testId) {
  const test = abTests.get(testId);
  if (!test || test.status !== 'running') return null;
  return Math.random() * 100 < test.variantA.traffic ? 'A' : 'B';
}

function recordABResult(testId, variant, { ms, success, score }) {
  const test = abTests.get(testId);
  if (!test) return;
  const v = variant === 'A' ? test.variantA : test.variantB;
  v.results.calls++;
  v.results.avgMs = Math.round((v.results.avgMs * (v.results.calls - 1) + ms) / v.results.calls);
  if (score > 0.7) v.results.wins++;
  abResults.get(testId).push({ variant, ms, success, score, ts: new Date().toISOString() });
}

function concludeABTest(testId) {
  const test = abTests.get(testId);
  if (!test) throw new Error('A/B 테스트를 찾을 수 없습니다.');
  const a = test.variantA.results;
  const b = test.variantB.results;
  const scoreA = (a.calls > 0 ? a.wins / a.calls : 0) * 0.7 + (b.avgMs > 0 ? (1 - a.avgMs / b.avgMs) : 0) * 0.3;
  const scoreB = (b.calls > 0 ? b.wins / b.calls : 0) * 0.7 + (a.avgMs > 0 ? (1 - b.avgMs / a.avgMs) : 0) * 0.3;
  test.winner  = scoreA >= scoreB ? 'A' : 'B';
  test.status  = 'concluded';
  test.concludedAt = new Date().toISOString();
  test.analysis = { scoreA: +scoreA.toFixed(3), scoreB: +scoreB.toFixed(3) };
  return test;
}

function listABTests() { return Array.from(abTests.values()); }

// 샘플 버전 시딩
['marketingPipeline','itSecurityPipeline','financeInvestPipeline'].forEach(name => {
  registerVersion(name, null, { description: 'Phase 5 초기 릴리즈', author: 'system' });
  const v2 = registerVersion(name, null, { description: 'Phase 6 고도화', author: 'system' });
  v2.metrics = { calls: Math.floor(Math.random()*200)+50, avgMs: Math.floor(Math.random()*300)+100, errorRate: +(Math.random()*0.05).toFixed(3), qualityScore: +(0.7 + Math.random()*0.3).toFixed(3) };
});
const sampleAB = createABTest('marketingPipeline', { variantA: 'v1.0', variantB: 'v2.0', splitPct: 50, description: '마케팅 파이프라인 v1 vs v2 비교' });
for (let i = 0; i < 20; i++) {
  recordABResult(sampleAB.testId, i % 3 === 0 ? 'A' : 'B', { ms: 200 + Math.random()*300, success: true, score: 0.5 + Math.random()*0.5 });
}

module.exports = {
  registerVersion, getVersions, updateMetrics,
  createABTest, routeABTest, recordABResult, concludeABTest, listABTests,
  _versions: versions, _abTests: abTests,
};
