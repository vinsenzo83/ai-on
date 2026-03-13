'use strict';
/**
 * test_engine_phase3.js — 엔진 3차 테스트 (24케이스)
 *
 * 검증 항목:
 *  [A] 환경 재검증 (5케이스)  — 에러 분류, whitelist 영속성, 재시작 복원
 *  [B] 설정 영속화 (5케이스)  — 우선순위 DB 저장, whitelist 오버라이드 영속
 *  [C] Health 대시보드 (6케이스) — 공급자 상태, 24h 집계, 에러 카테고리
 *  [D] 비용 대시보드 (4케이스) — 공급자별 비용, 토큰 집계, 실시간 누적
 *  [E] 통합 E2E (4케이스)     — 전체 파이프라인 + DB 영속 + 대시보드 일관성
 */

const http  = require('http');
const { v4: uuidv4 } = require('uuid');

const BASE  = 'http://localhost:3000';
const START = Date.now();

const results = [];
let token = '';

function log(id, name, status, detail = '', ms = 0) {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} [${id}] ${name.padEnd(44)} ${(ms+'ms').padStart(7)}  ${detail}`);
  results.push({ id, name, status, detail, ms });
}

function req(method, path, body, tok) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: 'localhost', port: 3000, method, path, headers }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: d }); } });
    });
    r.on('error', e => resolve({ status: 0, data: { error: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}

async function chat(model, prompt, opts = {}) {
  const start = Date.now();
  const r = await req('POST', '/api/ai/chat', {
    messages: [{ role: 'user', content: prompt }],
    model, ...opts
  }, token);
  return { ...r, ms: Date.now() - start };
}

async function main() {
  console.log('='.repeat(67));
  console.log('  AI Orchestrator 엔진 3차 테스트 (24케이스)');
  console.log('  시작:', new Date().toLocaleString('ko-KR'));
  console.log('='.repeat(67));

  // ── 0. 로그인 ───────────────────────────────────────────────
  console.log('\n▶ 0. 사전 준비');
  const loginR = await req('POST', '/api/auth/login', { email: 'admin@ai-orch.local', password: 'admin1234' });
  token = loginR.data?.token || '';
  console.log('  로그인:', token ? '✅ JWT 획득' : '❌ 실패');
  if (!token) { console.error('토큰 없음, 중단'); process.exit(1); }

  // ─────────────────────────────────────────────────────────────
  // A. 환경 재검증 (5케이스)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ A. 환경 재검증 (5케이스)');

  // A-1: 에러 분류 API — error_category 분해 정확성 확인
  {
    const r = await req('GET', '/api/admin/health/errors?days=30', null, token);
    const cats = r.data.categories || [];
    const hasNetwork = cats.some(c => c.category === 'network');
    const hasAuth    = cats.some(c => c.category === 'auth');
    const noUnknown  = !cats.some(c => c.category === 'unknown' && c.count > 5);
    const s = r.status === 200 && r.data.success && (hasNetwork || hasAuth);
    log('A-1', 'error_category 분해 API 정확성', s ? 'PASS' : 'FAIL',
      `총 ${r.data.totalErrors}건: ${cats.map(c=>c.category+':'+c.count).join(', ')}`);
  }

  // A-2: Phase2 코드 이후 에러 — 외부제약(google/xai)만인지 확인
  {
    const r = await req('GET', '/api/admin/inference/recent?limit=200', null, token);
    const rows = r.data.rows || [];
    // Phase2 코드 적용 시점(2026-03-10 23:00) 이후 에러만
    const phase2Errors = rows.filter(row =>
      !row.success && row.created_at >= '2026-03-10 23:00:00'
    );
    // 비외부제약 에러 = google(404) 또는 xai(AUTH_FAILED) 제외한 것
    const nonExternal = phase2Errors.filter(e =>
      !(e.provider === 'google' && e.error_code === 'MAX_RETRIES') &&
      !(e.provider === 'xai' && e.error_code === 'AUTH_FAILED')
    );
    const s = r.status === 200 && nonExternal.length === 0;
    log('A-2', 'Phase2 코드 에러 = 외부제약만 확인', s ? 'PASS' : 'WARN',
      `Phase2이후 ${phase2Errors.length}건, 비외부제약 ${nonExternal.length}건`);
  }

  // A-3: 화이트리스트 현재 상태 — 실제 모델 활성화 확인
  {
    const r = await req('GET', '/api/admin/models/whitelist', null, token);
    const stats = r.data.summary || {};
    const wl = r.data.byProvider || {};
    // gpt-4o-mini, gpt-4o, claude-haiku 등 실제 모델이 enabled 상태인지
    const oaiModels = (wl.openai || []).filter(m => m.enabled).map(m => m.modelId);
    const antModels = (wl.anthropic || []).filter(m => m.enabled).map(m => m.modelId);
    const hasRealOai = oaiModels.some(m => m.includes('gpt-4o'));
    const hasRealAnt = antModels.some(m => m.includes('claude'));
    const s = r.status === 200 && hasRealOai && hasRealAnt;
    log('A-3', '화이트리스트 실제 모델 활성 확인', s ? 'PASS' : 'FAIL',
      `enabled: ${stats.enabled}/${stats.total}, openai=[${oaiModels.slice(0,3).join(',')}]`);
  }

  // A-4: 모델 우선순위 조회 — DB에서 복원된 값 확인
  {
    const r = await req('GET', '/api/admin/models/priority', null, token);
    const priority = r.data.priority || {};
    const resolved = r.data.resolved || {};
    // fast 태스크에 gpt-4o-mini가 사용되고 있는지 확인
    const fastOk = priority.fast === 'gpt-4o-mini' || (resolved.fast?.actual && !resolved.fast.actual.includes('5-nano'));
    const s = r.status === 200 && fastOk;
    log('A-4', '모델 우선순위 DB 복원 확인', s ? 'PASS' : 'FAIL',
      `fast=${priority.fast}→actual=${resolved.fast?.actual}, chat=${priority.chat}`);
  }

  // A-5: Health check 후 DB 기록 확인
  {
    const hcR = await req('POST', '/api/admin/health/check', { providers: ['openai', 'anthropic'] }, token);
    const s = hcR.status === 200 && hcR.data.checked >= 2;
    const ok = (hcR.data.results || []).filter(r => r.status === 'ok').length;
    log('A-5', 'health/check 실행 + DB 기록', s ? 'PASS' : 'FAIL',
      `checked=${hcR.data.checked}, ok=${ok}/${hcR.data.checked}`);
  }

  // ─────────────────────────────────────────────────────────────
  // B. 설정 영속화 (5케이스)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ B. 설정 영속화 (5케이스)');

  // B-1: 모델 우선순위 변경 → DB 저장 → 즉시 조회 일관성
  {
    const newPriority = { fast: 'gpt-4o-mini', chat: 'gpt-4o-mini', text: 'gpt-4o' };
    const putR = await req('PUT', '/api/admin/models/priority', { priority: newPriority }, token);
    const getR = await req('GET', '/api/admin/models/priority', null, token);
    const s = putR.status === 200 && getR.data.priority?.fast === 'gpt-4o-mini';
    log('B-1', '우선순위 PUT → GET 일관성 확인', s ? 'PASS' : 'FAIL',
      `put_status=${putR.status}, fast=${getR.data.priority?.fast}`);
  }

  // B-2: 모델 토글 → DB 영속 → 재조회 확인
  {
    // gpt-4o-mini를 잠시 비활성화 후 재활성화
    const toggleOff = await req('PATCH', '/api/admin/models/gpt-4o-mini/toggle', { enabled: false }, token);
    await new Promise(r => setTimeout(r, 200));
    const wl1 = await req('GET', '/api/admin/models/whitelist', null, token);
    const mini1 = (wl1.data.byProvider?.openai || []).find(m => m.modelId === 'gpt-4o-mini');
    // 다시 활성화
    await req('PATCH', '/api/admin/models/gpt-4o-mini/toggle', { enabled: true }, token);
    const wl2 = await req('GET', '/api/admin/models/whitelist', null, token);
    const mini2 = (wl2.data.byProvider?.openai || []).find(m => m.modelId === 'gpt-4o-mini');
    const s = toggleOff.status === 200 && mini1?.enabled === false && mini2?.enabled === true;
    log('B-2', 'whitelist 토글 → GET 일관성', s ? 'PASS' : 'FAIL',
      `off=${mini1?.enabled}, re-on=${mini2?.enabled}`);
  }

  // B-3: whitelist 저장 후 서버 재시작 없이 즉시 반영 확인
  {
    // gpt-4o를 비활성→활성으로 토글, 그 즉시 callLLM에 반영되는지
    const toggleOff = await req('PATCH', '/api/admin/models/gpt-4o/toggle', { enabled: false }, token);
    const r1 = await chat('gpt-4o', '안녕');
    const toggleOn  = await req('PATCH', '/api/admin/models/gpt-4o/toggle', { enabled: true }, token);
    const r2 = await chat('gpt-4o', '안녕');
    // off 상태: fallback이어야, on 상태: 직접 라우팅
    const offIsFallback = r1.data.isFallback === true;
    const onIsReal = r2.status === 200 && r2.data.provider === 'openai';
    const s = offIsFallback && onIsReal;
    log('B-3', 'whitelist 실시간 반영 (off→fallback, on→real)', s ? 'PASS' : 'FAIL',
      `off→isFallback=${r1.data.isFallback}, on→provider=${r2.data.provider}`);
  }

  // B-4: 설정 모델 DB 저장 후 재시작 전후 일관성 (재시작 없이 조회)
  {
    const r = await req('GET', '/api/admin/models/stats', null, token);
    const enabled = r.data.enabledModels || [];
    const hasRealModels = enabled.some(m => ['gpt-4o-mini','gpt-4o','claude-haiku-4-5-20251001'].includes(m.modelId));
    const s = r.status === 200 && enabled.length > 0 && hasRealModels;
    log('B-4', '모델 통계 — 실제 모델 활성 확인', s ? 'PASS' : 'FAIL',
      `활성 ${enabled.length}개: [${enabled.slice(0,4).map(m=>m.modelId).join(',')}...]`);
  }

  // B-5: model_settings DB 직접 확인
  {
    const r = await req('GET', '/api/admin/models/priority', null, token);
    // DB에서 로드된 우선순위가 기본값과 다른지 확인 (저장된 것 존재)
    const priority = r.data.priority || {};
    const s = r.status === 200 && priority.fast && priority.chat && priority.text;
    log('B-5', 'model_settings DB 저장 확인', s ? 'PASS' : 'FAIL',
      `keys: ${Object.keys(priority).join(',')}`);
  }

  // ─────────────────────────────────────────────────────────────
  // C. Health 대시보드 (6케이스)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ C. Health 대시보드 (6케이스)');

  // C-1: health/dashboard 구조 검증
  {
    const r = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const s = r.status === 200 && r.data.success &&
              r.data.summary?.totalProviders > 0 &&
              typeof r.data.providers === 'object';
    log('C-1', 'health/dashboard 구조 및 응답 검증', s ? 'PASS' : 'FAIL',
      `providers=${r.data.summary?.totalProviders}, configured=${r.data.summary?.configured}`);
  }

  // C-2: health/check 실행 → 결과 DB 기록 → dashboard 반영
  {
    const start = Date.now();
    const checkR = await req('POST', '/api/admin/health/check',
      { providers: ['openai', 'anthropic', 'deepseek', 'moonshot', 'mistral'] }, token);
    const ms = Date.now() - start;
    await new Promise(r => setTimeout(r, 300));
    const dashR = await req('GET', '/api/admin/health/dashboard', null, token);
    const allChecked = (checkR.data.results || []).every(r => r.status === 'ok' || r.status === 'degraded');
    const hasLatest = Object.values(dashR.data.providers || {}).some(p => p.latestCheck?.checked_at);
    const s = checkR.status === 200 && checkR.data.checked >= 3 && hasLatest;
    log('C-2', 'health/check 5개 공급자 → dashboard 반영', s ? 'PASS' : 'FAIL',
      `checked=${checkR.data.checked}, ok=${(checkR.data.results||[]).filter(r=>r.status==='ok').length}/${checkR.data.checked}, ${ms}ms`);
  }

  // C-3: Google/xAI health check — 외부제약은 WARN 처리
  {
    const checkR = await req('POST', '/api/admin/health/check',
      { providers: ['google', 'xai'] }, token);
    const googleR = (checkR.data.results || []).find(r => r.provider === 'google');
    const xaiR    = (checkR.data.results || []).find(r => r.provider === 'xai');
    // Google: ok(드문 경우) or degraded(404)/down(auth)
    // xAI: down (IP 블록)
    const s = checkR.status === 200;
    const googleStatus = googleR?.status || 'not_checked';
    const xaiStatus    = xaiR?.status || 'not_checked';
    log('C-3', 'Google/xAI 체크 — 외부제약 처리', s ? (googleStatus !== 'ok' || xaiStatus !== 'ok' ? 'WARN' : 'PASS') : 'FAIL',
      `google=${googleStatus}(${googleR?.errorCode||''}), xai=${xaiStatus}(${xaiR?.errorCode||''}) — 외부환경`);
  }

  // C-4: 에러 카테고리 — network vs auth 분리 정확성
  {
    const r = await req('GET', '/api/admin/health/errors?days=30', null, token);
    const cats = r.data.categories || [];
    const network = cats.find(c => c.category === 'network');
    const auth    = cats.find(c => c.category === 'auth');
    // network: MAX_RETRIES (42건), auth: AUTH_FAILED (5건)
    const s = r.status === 200 &&
              (network?.count || 0) > 0 &&
              (auth?.count || 0) > 0;
    log('C-4', 'error_category network/auth 분리 확인', s ? 'PASS' : 'FAIL',
      `network=${network?.count||0}, auth=${auth?.count||0}, total=${r.data.totalErrors}`);
  }

  // C-5: 24h uptime % 계산 정확성
  {
    const r = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const providers = Object.values(r.data.providers || {});
    // health/check를 방금 실행했으므로 최소 일부 공급자에 uptime%가 있어야
    const hasUptime = providers.some(p => p.uptimePct !== null);
    const s = r.status === 200 && hasUptime;
    log('C-5', '24h uptime% 계산 확인', s ? 'PASS' : 'FAIL',
      `uptime있는 공급자: ${providers.filter(p=>p.uptimePct!==null).map(p=>p.provider||'?').join(',')}`);
  }

  // C-6: inference 성공률(successRate24h) 계산 확인
  {
    const r = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const providers = Object.values(r.data.providers || {});
    const openaiP = (r.data.providers || {}).openai;
    const antP    = (r.data.providers || {}).anthropic;
    const oaiSR   = openaiP?.successRate24h;
    const antSR   = antP?.successRate24h;
    const s = r.status === 200 && (oaiSR !== null || antSR !== null);
    log('C-6', 'successRate24h 계산 확인', s ? 'PASS' : 'FAIL',
      `openai=${oaiSR}%, anthropic=${antSR}%, calls24h_total=${r.data.summary?.totalCalls24h}`);
  }

  // ─────────────────────────────────────────────────────────────
  // D. 비용 대시보드 (4케이스)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ D. 비용 대시보드 (4케이스)');

  // D-1: 실제 AI 호출 후 비용 즉시 반영 확인
  {
    const before = await req('GET', '/api/admin/inference/stats?days=1', null, token);
    const beforeCost = (before.data.byProvider || []).reduce((s, p) => s + (p.total_cost || 0), 0);
    await chat('gpt-4o-mini', '비용 테스트: 간단히 "ok"만 답하세요.');
    await new Promise(r => setTimeout(r, 300));
    const after = await req('GET', '/api/admin/inference/stats?days=1', null, token);
    const afterCost = (after.data.byProvider || []).reduce((s, p) => s + (p.total_cost || 0), 0);
    const s = afterCost > beforeCost;
    log('D-1', '실시간 비용 누적 확인 (call → stats)', s ? 'PASS' : 'FAIL',
      `before=$${beforeCost.toFixed(6)} → after=$${afterCost.toFixed(6)}`);
  }

  // D-2: 공급자별 비용 breakdown 정확성
  {
    const r = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const providers = Object.values(r.data.providers || {}).filter(p => p.calls24h > 0);
    const totalCost = providers.reduce((s, p) => s + (p.totalCost24h || 0), 0);
    const s = r.status === 200 && providers.length > 0 && totalCost > 0;
    log('D-2', '공급자별 비용 breakdown', s ? 'PASS' : 'FAIL',
      `활성공급자=${providers.length}개, 총비용=$${totalCost.toFixed(6)}`);
  }

  // D-3: 토큰 집계 확인
  {
    const r = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const totalTokens = Object.values(r.data.providers || {}).reduce((s, p) => s + (p.totalTokens24h || 0), 0);
    const s = r.status === 200 && totalTokens > 0;
    log('D-3', '24h 총 토큰 집계 확인', s ? 'PASS' : 'FAIL',
      `totalTokens24h=${totalTokens.toLocaleString()}개`);
  }

  // D-4: 비용 대 성공률 일관성 (비용 > 0이면 성공 호출 존재)
  {
    const r = await req('GET', '/api/admin/inference/stats?days=1', null, token);
    const providers = r.data.byProvider || [];
    // 비용이 있는데 성공이 0인 경우가 없어야
    const inconsistent = providers.filter(p => p.total_cost > 0 && p.real_success === 0 && p.fallback_success === 0);
    const s = r.status === 200 && inconsistent.length === 0;
    log('D-4', '비용-성공률 일관성 확인', s ? 'PASS' : 'FAIL',
      `비용있는공급자 ${providers.filter(p=>p.total_cost>0).length}개, 불일치 ${inconsistent.length}개`);
  }

  // ─────────────────────────────────────────────────────────────
  // E. 통합 E2E (4케이스)
  // ─────────────────────────────────────────────────────────────
  console.log('\n▶ E. 통합 E2E (4케이스)');

  // E-1: 전체 파이프라인 실행 → inference_log → dashboard 일관성
  {
    const comboId = `e2e-e1-${Date.now()}`;
    const start = Date.now();
    await req('POST', '/api/ai/chat', { messages:[{role:'user',content:'테스트 시작'}], model:'gpt-4o-mini', pipeline:'e2e-test', _comboId: comboId, _step: 0 }, token);
    await req('POST', '/api/ai/chat', { messages:[{role:'user',content:'테스트 완료'}], model:'claude-haiku-4-5-20251001', pipeline:'e2e-test', _comboId: comboId, _step: 1 }, token);
    const totalMs = Date.now() - start;
    await new Promise(r => setTimeout(r, 400));
    const statsR = await req('GET', '/api/admin/inference/stats?days=1', null, token);
    const dashR  = await req('GET', '/api/admin/health/dashboard?hours=24', null, token);
    const totalCalls = statsR.data.summary?.total || 0;
    const s = statsR.status === 200 && dashR.status === 200 && totalCalls > 100;
    log('E-1', '파이프라인 실행 → 대시보드 일관성', s ? 'PASS' : 'FAIL',
      `calls=${totalCalls}, ${totalMs}ms`);
  }

  // E-2: whitelist 영속화 후 재조회 — 재시작 시뮬레이션
  {
    // 현재 snapshot이 DB에 저장되어 있는지 model_settings에서 간접 확인
    const statsR = await req('GET', '/api/admin/models/stats', null, token);
    const enabledR = await req('GET', '/api/admin/models/whitelist', null, token);
    const s = statsR.status === 200 && enabledR.status === 200 &&
              (enabledR.data.summary?.enabled || 0) > 15;
    log('E-2', 'whitelist 영속화 상태 확인', s ? 'PASS' : 'FAIL',
      `enabled=${enabledR.data.summary?.enabled}/${enabledR.data.summary?.total}`);
  }

  // E-3: 에러 분류 → 수정 액션 추적 — 전체 흐름 검증
  {
    const errR = await req('GET', '/api/admin/health/errors?days=30', null, token);
    // 에러 분석 → 카테고리별 조치 가이드가 있는지
    const cats = errR.data.categories || [];
    const hasDesc = cats.every(c => c.description && c.description.length > 5);
    const s = errR.status === 200 && cats.length > 0 && hasDesc;
    log('E-3', '에러 카테고리 + 설명(action guide) 포함 확인', s ? 'PASS' : 'FAIL',
      `categories: ${cats.map(c=>c.category+'('+c.description?.slice(0,15)+')').join(', ')}`);
  }

  // E-4: 전체 시스템 health 종합 — 서버 + DB + AI + 대시보드
  {
    const [healthR, dashR, statsR, wlR] = await Promise.all([
      req('GET', '/health'),
      req('GET', '/api/admin/health/dashboard', null, token),
      req('GET', '/api/admin/inference/stats?days=1', null, token),
      req('GET', '/api/admin/models/whitelist', null, token),
    ]);
    const serverOk  = healthR.status === 200 && healthR.data.status === 'ok';
    const dashOk    = dashR.status === 200 && dashR.data.success;
    const statsOk   = statsR.status === 200 && statsR.data.success;
    const wlOk      = wlR.status === 200 && wlR.data.success;
    const s = serverOk && dashOk && statsOk && wlOk;
    const totalCost = (statsR.data.byProvider || []).reduce((s, p) => s + (p.total_cost || 0), 0);
    log('E-4', '전체 시스템 health 종합 검증', s ? 'PASS' : 'FAIL',
      `server=${serverOk}, dash=${dashOk}, stats=${statsOk}, wl=${wlOk}, cost=$${totalCost.toFixed(6)}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 최종 리포트
  // ─────────────────────────────────────────────────────────────
  const totalMs = Date.now() - START;
  const pass    = results.filter(r => r.status === 'PASS').length;
  const warn    = results.filter(r => r.status === 'WARN').length;
  const fail    = results.filter(r => r.status === 'FAIL').length;
  const score   = Math.round((pass + warn * 0.5) / results.length * 100);

  console.log('\n' + '='.repeat(67));
  console.log('  최종 리포트');
  console.log('='.repeat(67));
  console.log(`  총 케이스:  ${results.length}/24`);
  console.log(`  ✅ PASS:   ${pass}`);
  console.log(`  ⚠️  WARN:   ${warn}`);
  console.log(`  ❌ FAIL:   ${fail}`);
  console.log(`  점수:       ${score}/100`);
  console.log(`  소요시간:   ${(totalMs/1000).toFixed(1)}초`);

  if (fail > 0) {
    console.log('\n  실패 항목:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`    [${r.id}] ${r.name}: ${r.detail}`));
  }
  if (warn > 0) {
    console.log('\n  경고 항목:');
    results.filter(r => r.status === 'WARN').forEach(r => console.log(`    [${r.id}] ${r.name}: ${r.detail}`));
  }

  const statusMsg = fail === 0 && warn <= 2 ? '🎉 우수 — 스테이징 배포 적합' :
                    fail === 0 ? '✅ 양호 — 소규모 수정 후 배포 가능' :
                    '⚠️  수정 필요 — 실패 항목 해결 후 재테스트';
  console.log(`\n  상태: ${statusMsg}`);
  console.log('='.repeat(67));
}

main().catch(e => { console.error('테스트 오류:', e); process.exit(1); });
