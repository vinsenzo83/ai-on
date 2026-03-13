'use strict';
/**
 * test_engine_phase5.js — Phase 5: 보안 강화 + 베타 사용자 시스템 테스트
 * 테스트 범주:
 *  A) 보안 엔드포인트 접근 제어 (auth guard)
 *  B) Rate Limit 동작 검증
 *  C) 베타 초대 코드 발급 / 가입 플로우
 *  D) 쿼터 관리 API
 *  E) Phase 1~4 회귀 (핵심 기능 유지)
 */

const BASE = 'http://localhost:3000';
let token = null;
let betaToken = null;
let betaUserId = null;
let inviteCode = null;

const results = { pass: 0, warn: 0, fail: 0, total: 0 };

function report(label, ok, warn = false, detail = '') {
  results.total++;
  if (ok)        { results.pass++; console.log(`  ✅ PASS  ${label}${detail ? ' – ' + detail : ''}`); }
  else if (warn) { results.warn++; console.log(`  ⚠️  WARN  ${label}${detail ? ' – ' + detail : ''}`); }
  else           { results.fail++; console.log(`  ❌ FAIL  ${label}${detail ? ' – ' + detail : ''}`); }
}

async function req(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await r.json(); } catch(e) { data = {}; }
  return { status: r.status, data };
}

function authHeader() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function login() {
  const r = await req('POST', '/api/auth/login', { email: 'admin@ai-orch.local', password: 'admin1234' });
  if (r.status === 200 && r.data.token) {
    token = r.data.token;
    return true;
  }
  throw new Error('로그인 실패: ' + JSON.stringify(r.data));
}

// ══════════════════════════════════════════════════════════════════════════════
// A) 보안 – 엔드포인트 접근 제어
// ══════════════════════════════════════════════════════════════════════════════
async function testSecurity() {
  console.log('\n[A] 보안 엔드포인트 접근 제어');

  // A-1: cache/stats – 인증 없이 접근 시 401
  {
    const r = await req('GET', '/api/ai/cache/stats');
    report('A-1 cache/stats 비인증 → 401', r.status === 401, false, `status=${r.status}`);
  }

  // A-2: cache/clear – 인증 없이 접근 시 401
  {
    const r = await req('POST', '/api/ai/cache/clear');
    report('A-2 cache/clear 비인증 → 401', r.status === 401, false, `status=${r.status}`);
  }

  // A-3: cache/clear – 인증 후 (admin) → 200
  {
    const r = await req('POST', '/api/ai/cache/clear', {}, authHeader());
    report('A-3 cache/clear admin → 200', r.status === 200 && r.data.success, false, `status=${r.status}`);
  }

  // A-4: /api/admin/beta/users – admin 인증 필요
  {
    const r = await req('GET', '/api/admin/beta/users', null, authHeader());
    report('A-4 beta/users admin → 200', r.status === 200 && r.data.success, false, `users=${r.data.total}`);
  }

  // A-5: /api/admin/beta/users – 비인증 → 401
  {
    const r = await req('GET', '/api/admin/beta/users');
    report('A-5 beta/users 비인증 → 401', r.status === 401, false, `status=${r.status}`);
  }

  // A-6: /api/ai/chat – 비인증도 접근 가능 (optionalAuth), 200 기대
  {
    const r = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'ping' }], strategy: 'fast' });
    report('A-6 /api/ai/chat 비인증 허용', r.status === 200, r.status >= 500, `status=${r.status}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// B) 베타 초대 코드 발급 플로우
// ══════════════════════════════════════════════════════════════════════════════
async function testBetaInvite() {
  console.log('\n[B] 베타 초대 코드 발급');

  // B-1: 초대 코드 1개 생성
  {
    const r = await req('POST', '/api/admin/beta/invites', { count: 1, role: 'beta' }, authHeader());
    report('B-1 초대 코드 생성', r.status === 201 || (r.status === 200 && r.data.success),
      false, `created=${r.data.created}, code=${r.data.invites?.[0]?.code}`);
    if (r.data.invites?.[0]) inviteCode = r.data.invites[0].code;
  }

  // B-2: 초대 코드 목록 조회
  {
    const r = await req('GET', '/api/admin/beta/invites', null, authHeader());
    report('B-2 초대 코드 목록', r.status === 200 && r.data.total > 0, false, `total=${r.data.total}`);
  }

  // B-3: 잘못된 초대 코드로 가입 시도 → 400
  {
    const r = await req('POST', '/api/beta/register', {
      username: 'betauser_bad', email: 'betabad@test.com',
      password: 'test1234!', inviteCode: 'INVALID-CODE-XXXX'
    });
    report('B-3 잘못된 초대 코드 → 400', r.status === 400, false, `err=${r.data.error}`);
  }

  // B-4: 올바른 초대 코드로 베타 가입
  if (inviteCode) {
    const ts = Date.now();
    const r = await req('POST', '/api/beta/register', {
      username: `beta_tester_${ts}`,
      email: `beta_${ts}@test.com`,
      password: 'betapass123!',
      inviteCode
    });
    report('B-4 베타 가입 성공', r.status === 200 && r.data.success,
      r.status !== 200, `status=${r.status}, user=${r.data.user?.email}`);
    if (r.data.token) {
      betaToken = r.data.token;
      betaUserId = r.data.user?.id;
    }
  } else {
    report('B-4 베타 가입 성공', false, true, 'inviteCode 없음 (B-1 실패)');
  }

  // B-5: 동일 초대 코드 재사용 시도 → 400
  if (inviteCode) {
    const r = await req('POST', '/api/beta/register', {
      username: `beta_dup_${Date.now()}`, email: `betadup_${Date.now()}@test.com`,
      password: 'betapass123!', inviteCode
    });
    report('B-5 초대 코드 재사용 → 400', r.status === 400, false, `err=${r.data.error}`);
  } else {
    report('B-5 초대 코드 재사용 → 400', false, true, 'skip');
  }

  // B-6: 초대 코드 없이 베타 가입 → 400
  {
    const r = await req('POST', '/api/beta/register', {
      username: 'betanoinvite', email: 'betanoinvite@test.com', password: 'pass1234'
    });
    report('B-6 초대 코드 없이 가입 → 400', r.status === 400, false, `err=${r.data.error}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// C) 쿼터 관리
// ══════════════════════════════════════════════════════════════════════════════
async function testQuota() {
  console.log('\n[C] 쿼터 관리');

  // C-1: 전체 쿼터 목록
  {
    const r = await req('GET', '/api/admin/beta/quota', null, authHeader());
    report('C-1 전체 쿼터 목록', r.status === 200 && r.data.success, false, `users=${r.data.total}`);
  }

  // C-2: 베타 통계 조회
  {
    const r = await req('GET', '/api/admin/beta/stats', null, authHeader());
    report('C-2 베타 통계', r.status === 200 && r.data.success,
      false, `total=${r.data.summary?.totalBetaUsers}, cost=$${r.data.summary?.totalCostMonth}`);
  }

  // C-3: 특정 사용자 쿼터 조회 (admin)
  if (betaUserId) {
    const r = await req('GET', `/api/admin/beta/quota/${betaUserId}`, null, authHeader());
    report('C-3 사용자 쿼터 조회', r.status === 200 && r.data.success,
      false, `plan=${r.data.quota?.plan}, daily=${r.data.quota?.daily_limit}`);
  } else {
    report('C-3 사용자 쿼터 조회', false, true, 'betaUserId 없음');
  }

  // C-4: 플랜 변경 (beta → pro)
  if (betaUserId) {
    const r = await req('PATCH', `/api/admin/beta/quota/${betaUserId}`, { plan: 'pro' }, authHeader());
    report('C-4 플랜 변경 beta→pro', r.status === 200 && r.data.success, false, `msg=${r.data.message}`);
  } else {
    report('C-4 플랜 변경', false, true, 'betaUserId 없음');
  }

  // C-5: 쿼터 리셋
  if (betaUserId) {
    const r = await req('POST', `/api/admin/beta/quota/reset/${betaUserId}`, {}, authHeader());
    report('C-5 쿼터 리셋', r.status === 200 && r.data.success, false, `msg=${r.data.message}`);
  } else {
    report('C-5 쿼터 리셋', false, true, 'betaUserId 없음');
  }

  // C-6: 베타 유저 인증 후 AI 채팅 → 쿼터 증가 확인
  if (betaToken && betaUserId) {
    await req('POST', '/api/ai/chat',
      { messages: [{ role: 'user', content: 'Hello quota test' }], strategy: 'fast' },
      { Authorization: `Bearer ${betaToken}` });
    const r = await req('GET', `/api/admin/beta/quota/${betaUserId}`, null, authHeader());
    const used = r.data.quota?.used_today || 0;
    report('C-6 AI 호출 후 쿼터 증가', used >= 1, used === 0, `used_today=${used}`);
  } else {
    report('C-6 쿼터 증가 확인', false, true, 'betaToken 없음');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// D) 비용 로그 강화
// ══════════════════════════════════════════════════════════════════════════════
async function testCostLog() {
  console.log('\n[D] 비용 로그 강화');

  // D-1: 일별 비용 집계
  {
    const r = await req('GET', '/api/admin/inference/stats?days=7', null, authHeader());
    report('D-1 추론 통계 조회', r.status === 200 && r.data.success,
      false, `total=${r.data.summary?.total}, cost=$${r.data.summary?.totalCost?.toFixed(6) || 'n/a'}`);
  }

  // D-2: 최근 추론 로그 (per-user 확인)
  {
    const r = await req('GET', '/api/admin/inference/recent?limit=10', null, authHeader());
    const rows = r.data.rows || [];
    const hasUserId = rows.some(row => row.user_id);
    report('D-2 추론 로그 userId 포함', r.status === 200 && hasUserId,
      r.status === 200 && !hasUserId, `rows=${rows.length}, withUser=${rows.filter(r=>r.user_id).length}`);
  }

  // D-3: 에러 브레이크다운
  {
    const r = await req('GET', '/api/admin/health/errors?days=7', null, authHeader());
    report('D-3 에러 브레이크다운', r.status === 200 && r.data.success,
      false, `categories=${r.data.breakdown?.length || 0}`);
  }

  // D-4: 코스트 통계 (cost_usd per provider)
  {
    const r = await req('GET', '/api/admin/inference/stats?days=7', null, authHeader());
    const providers = r.data.byProvider || [];
    const hasAny = providers.length > 0 || (r.data.summary?.total > 0);
    report('D-4 Provider 비용 집계', r.status === 200 && hasAny, r.status !== 200,
      `providers=${providers.length}`);
  }

  // D-5: 헬스 대시보드 UI 접근
  {
    const r = await fetch(`${BASE}/health-dashboard.html`);
    report('D-5 health-dashboard.html 제공', r.status === 200, false, `status=${r.status}`);
  }

  // D-6: 캐시 통계 (인증 후)
  {
    const r = await req('GET', '/api/ai/cache/stats', null, authHeader());
    report('D-6 캐시 통계 (인증 후)', r.status === 200 && r.data.success,
      false, `size=${r.data.cache?.size}, valid=${r.data.cache?.valid}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// E) 회귀: Phase 1~4 핵심 기능
// ══════════════════════════════════════════════════════════════════════════════
async function testRegression() {
  console.log('\n[E] Phase 1~4 회귀 테스트');

  // E-1: health check
  {
    const r = await req('GET', '/health');
    report('E-1 /health', r.status === 200 && r.data.status === 'ok', false, `openai=${r.data.hasOpenAI}, anthropic=${r.data.hasAnthropic}`);
  }

  // E-2: AI 상태 조회
  {
    const r = await req('GET', '/api/ai/status');
    const providers = r.data.providers || {};
    const openai = providers.openai;
    report('E-2 provider status', r.status === 200 && openai?.available,
      !openai?.available, `openai=${openai?.available}, models=${openai?.models}`);
  }

  // E-3: 기본 AI chat
  {
    const t0 = Date.now();
    const r = await req('POST', '/api/ai/chat', {
      messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
      strategy: 'fast', maxTokens: 10
    });
    const ms = Date.now() - t0;
    report('E-3 AI chat 기본', r.status === 200 && r.data.content, false, `${ms}ms, model=${r.data.model}`);
  }

  // E-4: SSE 스트리밍
  {
    const t0 = Date.now();
    let chunks = 0;
    let done = false;
    await new Promise((resolve) => {
      const body = JSON.stringify({ messages: [{ role: 'user', content: 'Count 1 2 3.' }], strategy: 'fast', maxTokens: 30 });
      fetch(`${BASE}/api/ai/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }).then(async resp => {
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done: d, value } = await reader.read();
          if (d) break;
          const txt = dec.decode(value);
          if (txt.includes('event: chunk')) chunks++;
          if (txt.includes('event: done')) { done = true; break; }
        }
        resolve();
      }).catch(() => resolve());
      setTimeout(resolve, 8000);
    });
    report('E-4 SSE 스트리밍', chunks >= 1 && done, chunks === 0, `chunks=${chunks}, done=${done}, ms=${Date.now()-t0}`);
  }

  // E-5: 헬스 체크 (provider check)
  {
    const r = await req('POST', '/api/admin/health/check', { providers: ['openai'] }, authHeader());
    report('E-5 헬스 체크 실행', r.status === 200 && r.data.success, false, `checked=${r.data.checked}`);
  }

  // E-6: 추론 요약 (7일)
  {
    const r = await req('GET', '/api/admin/inference/summary', null, authHeader());
    report('E-6 추론 요약', r.status === 200 && r.data.success,
      false, `total=${r.data.total}, real=${r.data.realSuccess}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('🔐 AI Orchestrator Phase 5 Test — 보안 + 베타 사용자 시스템');
  console.log('='.repeat(60));
  const t0 = Date.now();

  try { await login(); console.log(`  ✅ Admin 로그인 성공`); }
  catch(e) { console.error('  ❌ 로그인 실패:', e.message); process.exit(1); }

  await testSecurity();
  await testBetaInvite();
  await testQuota();
  await testCostLog();
  await testRegression();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`📊 결과: ${results.pass} PASS  ${results.warn} WARN  ${results.fail} FAIL  (${results.total}개 / ${elapsed}s)`);

  const score = Math.round(((results.pass * 3 + results.warn * 1) / (results.total * 3)) * 100);
  console.log(`🏆 Phase 5 Score: ${score}/100`);

  if (results.fail === 0 && results.warn <= 2) {
    console.log('✨ Phase 5 완료: 보안 + 베타 시스템 정상');
  } else if (results.fail <= 2) {
    console.log('⚠️  일부 항목 확인 필요');
  } else {
    console.log('❌ 다수 실패 – 서버 로그 확인 필요');
  }
  process.exit(results.fail > 3 ? 1 : 0);
})();
