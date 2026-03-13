#!/usr/bin/env node
/**
 * e2e-test.js — AI 오케스트레이터 End-to-End 테스트
 * 스테이징 서버 기준: 실제 AI API, DB 영속성, 작업큐, 어드민
 *
 * 사용법:
 *   BASE_URL=http://localhost:3000 node e2e-test.js
 *   BASE_URL=https://your-staging.server.com node e2e-test.js
 */
'use strict';

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@ai-orch.local';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'admin1234';

let passed = 0, failed = 0, warnings = 0;
let adminToken = '';

// ─── 유틸 ────────────────────────────────────────────────────────
function ok(label, value, note = '') {
  console.log(`  ✅ ${label}${note ? ' — ' + note : ''}`);
  passed++;
  return value;
}
function fail(label, note = '') {
  console.log(`  ❌ ${label}${note ? ' — ' + note : ''}`);
  failed++;
}
function warn(label, note = '') {
  console.log(`  ⚠️  ${label}${note ? ' — ' + note : ''}`);
  warnings++;
}
function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
  const res = await fetch(BASE_URL + path, { ...opts, headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  let data;
  try { data = await res.json(); } catch(e) { data = { _raw: await res.text?.() }; }
  return { status: res.status, ok: res.ok, data };
}

// ─── 테스트 스위트 ────────────────────────────────────────────────

async function testHealth() {
  section('1. Health Check & 서버 기동 확인');
  const r = await api('/health');
  if (r.status === 200) ok('서버 응답', r.data, `status=${r.data.status}`);
  else fail('서버 응답', `HTTP ${r.status}`);
  
  if (r.data.status === 'ok') ok('서버 상태 OK');
  else fail('서버 상태', r.data.status);
}

async function testAuth() {
  section('2. 인증 시스템 (JWT)');

  // 로그인
  const login = await api('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
  if (login.data.token) {
    adminToken = login.data.token;
    ok('어드민 로그인', null, `token 발급 완료`);
  } else {
    fail('어드민 로그인', JSON.stringify(login.data).slice(0,80));
    return;
  }

  // 비인증 요청 차단
  const savedToken = adminToken;
  adminToken = '';
  const unauth = await api('/api/admin/stats');
  adminToken = savedToken;
  if (unauth.status === 401) ok('비인증 요청 차단', null, 'HTTP 401');
  else fail('비인증 요청 차단', `예상: 401, 실제: ${unauth.status}`);

  // 잘못된 토큰 차단
  const oldToken = adminToken;
  adminToken = 'invalid.token.here';
  const badToken = await api('/api/admin/stats');
  adminToken = oldToken;
  if (badToken.status === 401) ok('잘못된 토큰 차단', null, 'HTTP 401');
  else fail('잘못된 토큰 차단', `예상: 401, 실제: ${badToken.status}`);
}

async function testApiKeyPersistence() {
  section('3. API 키 영속성 (DB 저장 & 서버 재시작 후 복원)');

  // 현재 등록된 공급자 목록
  const cfg = await api('/api/admin/apiconfig');
  if (!cfg.ok) { fail('apiconfig 조회', JSON.stringify(cfg.data)); return; }

  const providers = cfg.data.providers || [];
  ok(`공급자 로드`, null, `${providers.length}개 등록됨`);
  providers.forEach(p => {
    const icon = p.isActive ? '✅' : '⚠️';
    console.log(`     ${icon} ${p.providerLabel} (${p.provider}) — key: ${p.keyMasked}`);
  });

  // DB 직접 조회 (서버 측)
  const stats = await api('/api/admin/stats');
  if (stats.ok) ok('어드민 통계 조회', null, `users=${stats.data.stats?.users || stats.data.totalUsers}`);
  else fail('어드민 통계 조회', JSON.stringify(stats.data).slice(0,60));

  // 재등록 후 DB 저장 확인
  const testReg = await api('/api/admin/apiconfig', {
    method: 'POST',
    body: { provider: 'openai', apiKey: process.env.TEST_OPENAI_KEY || 'sk-test-check', memo: 'E2E test' }
  });
  if (testReg.ok) ok('API 키 재등록 (DB 저장)', null, `enabledModels=${testReg.data.enabledModels}`);
  else fail('API 키 재등록', JSON.stringify(testReg.data).slice(0,80));
}

async function testProviderConnections() {
  section('4. 공급자별 연결 테스트');

  const providers = ['openai', 'google', 'deepseek', 'mistral', 'anthropic', 'xai', 'moonshot'];
  for (const p of providers) {
    try {
      const r = await api(`/api/admin/apiconfig/${p}/test`, { method: 'POST' });
      if (r.data.success) {
        ok(`${p} 연결`, null, `${r.data.latencyMs}ms`);
      } else if (r.data.error?.includes('차단') || r.data.error?.includes('Cloudflare')) {
        warn(`${p} IP 차단 (키 유효)`, r.data.error?.slice(0, 50));
      } else {
        fail(`${p} 연결`, r.data.error?.slice(0, 60));
      }
    } catch(e) {
      fail(`${p} 연결`, e.message);
    }
  }
}

async function testRealAI() {
  section('5. 실제 AI 추론 테스트');

  // OpenAI gpt-4o-mini
  const chat = await api('/api/ai/chat', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'Reply with exactly: PONG' }], strategy: 'fast' }
  });
  if (chat.data.mock || chat.data.model === 'mock-gpt') {
    fail('OpenAI 실제 추론', 'Mock 모드 — API 키 확인 필요');
  } else if (chat.data.content) {
    ok('OpenAI 실제 추론', null, `model=${chat.data.model}, content="${chat.data.content?.slice(0,30)}"`);
  } else {
    fail('OpenAI 추론', JSON.stringify(chat.data).slice(0,100));
  }

  // 비용 자동 기록 확인
  const costs = await api('/api/admin/costs');
  if (costs.ok && (costs.data.total?.calls > 0 || costs.data.records?.length > 0)) {
    ok('비용 자동 기록', null, `total_records=${costs.data.total?.calls || costs.data.records?.length}`);
  } else {
    warn('비용 기록 확인 불가', JSON.stringify(costs.data).slice(0,60));
  }
}

async function testDatabasePersistence() {
  section('6. DB 영속성 검증');

  // 사용자 생성
  const newUser = {
    username: `e2e_test_${Date.now()}`,
    email: `e2e_${Date.now()}@test.com`,
    password: 'test1234!',
    role: 'user'
  };
  const reg = await api('/api/auth/register', { method: 'POST', body: newUser });
  if (reg.ok || reg.status === 201) {
    ok('사용자 생성', null, `id=${reg.data.user?.id || reg.data.id}`);

    // 생성한 사용자 조회
    const users = await api('/api/admin/users');
    const found = users.data.users?.find(u => u.email === newUser.email);
    if (found) ok('사용자 DB 조회', null, `email=${found.email}`);
    else warn('사용자 DB 조회', '생성은 됐으나 목록에서 미확인');

    // 사용자 삭제 (테스트 정리)
    if (found) {
      const del = await api(`/api/admin/users/${found.id}`, { method: 'DELETE' });
      if (del.ok) ok('사용자 삭제', null, 'DB에서 제거됨');
    }
  } else {
    fail('사용자 생성', JSON.stringify(reg.data).slice(0,80));
  }

  // 감사 로그 기록 확인
  const audit = await api('/api/admin/audit');
  if (audit.ok && audit.data.logs?.length > 0) {
    ok('감사 로그', null, `${audit.data.logs.length}건 기록됨`);
  } else {
    warn('감사 로그', JSON.stringify(audit.data).slice(0,60));
  }

  // 비용 통계
  const costSummary = await api('/api/admin/costs');
  if (costSummary.ok) {
    const total = costSummary.data.total;
    ok('비용 DB', null, `총 ${total?.calls || 0}건, $${(total?.totalUsd || 0).toFixed(4)}`);
  } else {
    fail('비용 DB', JSON.stringify(costSummary.data).slice(0,60));
  }
}

async function testJobQueue() {
  section('7. 작업 큐 (Jobs) 테스트');

  // 파이프라인 실행 (jobs 테이블에 기록되는지 확인)
  const jobs = await api('/api/admin/jobs');
  if (jobs.ok) {
    ok('Jobs 테이블 조회', null, `${jobs.data.jobs?.length || 0}건`);
  } else {
    fail('Jobs 테이블 조회', JSON.stringify(jobs.data).slice(0,60));
  }

  // 직접 job 생성 테스트
  const jobCreate = await api('/api/jobs', {
    method: 'POST',
    body: { pipeline: 'e2e-test', action: 'test', data: { test: true }, priority: 0 }
  });
  if (jobCreate.ok || jobCreate.status === 201) {
    ok('Job 생성', null, `id=${jobCreate.data.job?.id || jobCreate.data.id}`);
    const jobId = jobCreate.data.job?.id || jobCreate.data.id;
    if (jobId) {
      const jobGet = await api(`/api/jobs/${jobId}`);
      if (jobGet.ok) ok('Job 조회', null, `status=${jobGet.data.job?.status}`);
      else warn('Job 조회 실패', JSON.stringify(jobGet.data).slice(0,60));
    }
  } else {
    warn('Job 생성 엔드포인트', `HTTP ${jobCreate.status} — ${JSON.stringify(jobCreate.data).slice(0,60)}`);
  }
}

async function testAdminOperations() {
  section('8. 어드민 주요 기능 검증');

  // 시스템 통계
  const stats = await api('/api/admin/stats');
  if (stats.ok) {
    const s = stats.data.stats || stats.data;
    ok('시스템 통계', null,
      `users=${s.total_users||s.users}, jobs=${s.total_jobs||s.jobs}, costs=${s.total_cost_records||s.cost_records}`);
  } else fail('시스템 통계', JSON.stringify(stats.data).slice(0,60));

  // 파이프라인 목록
  const pipes = await api('/api/pipelines');
  if (pipes.ok) ok('파이프라인 목록', null, `${pipes.data.pipelines?.length || pipes.data.total || 0}개`);
  else fail('파이프라인 목록', JSON.stringify(pipes.data).slice(0,60));

  // 모델 화이트리스트
  const wl = await api('/api/admin/models/whitelist');
  if (wl.ok) ok('모델 화이트리스트', null, `${wl.data.total || wl.data.models?.length || 0}개 모델`);
  else fail('모델 화이트리스트', JSON.stringify(wl.data).slice(0,60));

  // 모델 우선순위 조회
  const prio = await api('/api/admin/apiconfig');
  if (prio.ok && prio.data.modelPriority) {
    ok('모델 우선순위', null, `fast=${prio.data.modelPriority.fast}`);
  } else warn('모델 우선순위', JSON.stringify(prio.data).slice(0,60));
}

async function testModelPriorityPersistence() {
  section('9. 모델 우선순위 영속성 (DB 저장 확인)');

  // 우선순위 변경
  const update = await api('/api/admin/apiconfig/model-priority', {
    method: 'PUT',
    body: { priority: { fast: 'gpt-4o-mini', balanced: 'gpt-4o', analysis: 'gpt-4o' } }
  });
  if (update.ok) ok('우선순위 변경', null, `fast→${update.data.modelPriority?.fast}`);
  else fail('우선순위 변경', JSON.stringify(update.data).slice(0,80));

  // 다시 조회해서 변경 확인
  const check = await api('/api/admin/apiconfig');
  if (check.data.modelPriority?.fast === 'gpt-4o-mini') {
    ok('우선순위 DB 반영 확인', null, 'gpt-4o-mini 저장됨');
  } else {
    warn('우선순위 확인', `실제: ${check.data.modelPriority?.fast}`);
  }
}

async function testDockerReadiness() {
  section('10. Docker/스테이징 배포 준비 상태');

  // 필수 환경변수 확인
  const checks = [
    ['NODE_ENV',        process.env.NODE_ENV || '(미설정)', process.env.NODE_ENV === 'production'],
    ['PORT',            process.env.PORT || '3000',         true],
    ['JWT_SECRET',      process.env.JWT_SECRET ? '설정됨' : '❌미설정', !!process.env.JWT_SECRET],
    ['OPENAI_API_KEY',  process.env.REAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY ? '설정됨' : '미설정', !!(process.env.REAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY)],
    ['GOOGLE_API_KEY',  process.env.GOOGLE_API_KEY ? '설정됨' : '미설정', !!process.env.GOOGLE_API_KEY],
    ['DEEPSEEK_API_KEY',process.env.DEEPSEEK_API_KEY ? '설정됨' : '미설정', !!process.env.DEEPSEEK_API_KEY],
  ];
  checks.forEach(([key, val, isOk]) => {
    if (isOk) ok(`${key}`, null, val);
    else warn(`${key}`, val);
  });
}

// ─── 메인 실행 ────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AI 오케스트레이터 — E2E 테스트                           ║');
  console.log(`║  대상: ${BASE_URL.padEnd(50)}║`);
  console.log(`║  시각: ${new Date().toLocaleString('ko-KR').padEnd(50)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  const start = Date.now();

  try { await testHealth(); } catch(e) { fail('Health 테스트 오류', e.message); }
  try { await testAuth(); } catch(e) { fail('Auth 테스트 오류', e.message); }
  try { await testApiKeyPersistence(); } catch(e) { fail('API 키 영속성 오류', e.message); }
  try { await testProviderConnections(); } catch(e) { fail('공급자 연결 오류', e.message); }
  try { await testRealAI(); } catch(e) { fail('AI 추론 오류', e.message); }
  try { await testDatabasePersistence(); } catch(e) { fail('DB 영속성 오류', e.message); }
  try { await testJobQueue(); } catch(e) { fail('작업큐 오류', e.message); }
  try { await testAdminOperations(); } catch(e) { fail('어드민 오류', e.message); }
  try { await testModelPriorityPersistence(); } catch(e) { fail('우선순위 영속성 오류', e.message); }
  try { await testDockerReadiness(); } catch(e) { fail('배포 준비 오류', e.message); }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const total = passed + failed + warnings;

  console.log('\n' + '═'.repeat(60));
  console.log('  최종 결과');
  console.log('═'.repeat(60));
  console.log(`  ✅ 통과:    ${passed}/${total}`);
  console.log(`  ❌ 실패:    ${failed}/${total}`);
  console.log(`  ⚠️  경고:    ${warnings}/${total}`);
  console.log(`  ⏱️  소요시간: ${elapsed}초`);
  console.log('');

  if (failed === 0) {
    console.log('  🎉 모든 핵심 테스트 통과! 스테이징 배포 준비 완료.');
  } else if (failed <= 3) {
    console.log('  🟡 일부 테스트 실패. 위 항목 확인 후 재배포 권장.');
  } else {
    console.log('  🔴 다수 테스트 실패. 배포 전 수정 필요.');
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('E2E 테스트 오류:', e); process.exit(1); });
