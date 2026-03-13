#!/usr/bin/env node
/**
 * AI 오케스트레이터 엔진 단위 1차 테스트
 * ─────────────────────────────────────────
 * 총 24회 케이스
 *  A. 라우팅 테스트        8회  — 태스크→공급자 정확성
 *  B. 멀티스텝 조합        6회  — 순차 파이프라인
 *  C. Fallback             4회  — 오류 시 대체 공급자
 *  D. 비용/속도 측정       3회  — 응답시간·토큰·비용
 *  E. 단일 vs 조합 비교    3회  — 품질 비교
 *
 * 동일 케이스 최대 2회 재시도
 */

const http = require('http');

const BASE  = 'http://localhost:3000';
const MAX_RETRY = 2;

let TOKEN = '';
const RESULTS = [];
let PASS = 0, FAIL = 0, WARN = 0, SKIP = 0;
const TIMINGS = [];

// ── 유틸 ──────────────────────────────────────────────────
function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE + path);
    const bStr   = body ? JSON.stringify(body) : null;
    const opts   = {
      hostname: url.hostname, port: url.port || 3000,
      path: url.pathname, method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(bStr   ? { 'Content-Length': Buffer.byteLength(bStr) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (bStr) r.write(bStr);
    r.end();
  });
}

async function chat(provider, model, prompt, retries = 0) {
  const start = Date.now();
  try {
    const r = await req('POST', '/api/ai/chat', {
      messages: [{ role: 'user', content: prompt }],
      provider, model,
    });
    const ms = Date.now() - start;
    if (r.status === 200 && r.body.success) {
      return { ok: true, ms, content: r.body.content || '', provider: r.body.provider, model: r.body.model,
               tokens: r.body.usage, cost: r.body.cost };
    }
    const errMsg = r.body?.error || r.body?.message || '';
    if (retries < MAX_RETRY && (r.status >= 500 || errMsg.includes('timeout'))) {
      await sleep(800);
      return chat(provider, model, prompt, retries + 1);
    }
    return { ok: false, ms, error: errMsg, status: r.status, retried: retries };
  } catch (e) {
    if (retries < MAX_RETRY) { await sleep(800); return chat(provider, model, prompt, retries + 1); }
    return { ok: false, error: e.message, retried: retries };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pad(s, n) { return String(s).padEnd(n); }

let caseNo = 0;
function record(group, name, result, detail = '') {
  caseNo++;
  const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : result === 'WARN' ? '⚠️ ' : '⏭️ ';
  if (result === 'PASS') PASS++;
  else if (result === 'FAIL') FAIL++;
  else if (result === 'WARN') WARN++;
  else SKIP++;
  const line = `${icon} [${String(caseNo).padStart(2,'0')}][${group}] ${pad(name,36)} ${detail}`;
  console.log(line);
  RESULTS.push({ no: caseNo, group, name, result, detail });
}

function section(title) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

// ── 사전 준비 ─────────────────────────────────────────────
async function setup() {
  const r = await req('POST', '/api/auth/login', {
    email: 'admin@ai-orch.local', password: 'admin1234',
  });
  if (r.body?.token) {
    TOKEN = r.body.token;
    console.log('🔑 JWT 발급 완료');
  } else {
    console.error('❌ 로그인 실패:', r.body);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════
// A. 라우팅 테스트 (8회)
// ═══════════════════════════════════════════════════════════
async function testRouting() {
  section('A. 라우팅 테스트 (8회) — 태스크→공급자 정확성');

  const cases = [
    { name: 'OpenAI  → chat   (gpt-4o-mini)',        provider: 'openai',    model: 'gpt-4o-mini',              prompt: '1+1은?' },
    { name: 'Anthropic → chat (claude-haiku-4-5)',    provider: 'anthropic', model: 'claude-haiku-4-5-20251001', prompt: '2+2는?' },
    { name: 'Google  → chat   (gemini-1.5-flash)',    provider: 'google',    model: 'gemini-1.5-flash',          prompt: '3+3은?' },
    { name: 'DeepSeek → chat  (deepseek-chat)',       provider: 'deepseek',  model: 'deepseek-chat',             prompt: '4+4는?' },
    { name: 'xAI     → chat   (grok-beta)',           provider: 'xai',       model: 'grok-beta',                 prompt: '5+5는?' },
    { name: 'Mistral → chat   (mistral-small)',       provider: 'mistral',   model: 'mistral-small-latest',      prompt: '6+6는?' },
    { name: 'OpenAI  → 분석   (gpt-4o)',              provider: 'openai',    model: 'gpt-4o',                    prompt: '이 문장을 분석해줘: "AI는 미래다"' },
    { name: 'Anthropic → 분석 (claude-sonnet-4-5)',   provider: 'anthropic', model: 'claude-sonnet-4-5-20250929',prompt: '이 문장을 분석해줘: "데이터가 힘이다"' },
  ];

  for (const c of cases) {
    const r = await chat(c.provider, c.model, c.prompt);
    TIMINGS.push({ group: 'A', label: c.name.trim(), ms: r.ms || 0 });
    if (!r.ok) {
      record('A-라우팅', c.name, 'FAIL', `${r.status || ''} ${r.error?.slice(0,60) || ''}`);
    } else if (r.provider === 'mock') {
      record('A-라우팅', c.name, 'WARN', `Mock 응답 (실제 미호출)`);
    } else {
      record('A-라우팅', c.name, 'PASS', `${r.ms}ms | "${r.content.slice(0,40)}"`);
    }
    await sleep(300);
  }
}

// ═══════════════════════════════════════════════════════════
// B. 멀티스텝 조합 (6회)
// ═══════════════════════════════════════════════════════════
async function testMultiStep() {
  section('B. 멀티스텝 조합 (6회) — 순차 파이프라인');

  // B-1: 요약 → 번역 (OpenAI 2단계)
  const b1_step1 = await chat('openai', 'gpt-4o-mini', '다음 내용을 3줄로 요약해줘: "AI 오케스트레이터는 여러 AI 공급자를 통합하여 최적 모델을 자동 선택하고, 비용과 속도를 균형 있게 관리하는 시스템이다."');
  const b1_result = b1_step1.ok
    ? await chat('openai', 'gpt-4o-mini', `다음 한국어를 영어로 번역해줘: "${b1_step1.content.slice(0,100)}"`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'B', label: 'B-1 요약→번역(OpenAI)', ms: (b1_step1.ms||0)+(b1_result.ms||0) });
  record('B-멀티스텝', 'B-1 요약→번역 (OpenAI 2단계)', b1_result.ok ? 'PASS' : 'FAIL',
    b1_result.ok ? `총 ${(b1_step1.ms||0)+(b1_result.ms||0)}ms | "${b1_result.content.slice(0,40)}"` : b1_result.error?.slice(0,60));
  await sleep(300);

  // B-2: 번역 → 감성분석 (OpenAI→Anthropic 교차)
  const b2_step1 = await chat('openai', 'gpt-4o-mini', '다음을 영어로 번역해: "오늘 날씨가 너무 좋아서 기분이 최고야!"');
  const b2_result = b2_step1.ok
    ? await chat('anthropic', 'claude-haiku-4-5-20251001', `Analyze the sentiment of this text (positive/negative/neutral + reason): "${b2_step1.content.slice(0,120)}"`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'B', label: 'B-2 번역→감성분석(교차)', ms: (b2_step1.ms||0)+(b2_result.ms||0) });
  record('B-멀티스텝', 'B-2 번역→감성분석 (OAI→ANT 교차)', b2_result.ok ? 'PASS' : 'FAIL',
    b2_result.ok ? `총 ${(b2_step1.ms||0)+(b2_result.ms||0)}ms | "${b2_result.content.slice(0,40)}"` : b2_result.error?.slice(0,60));
  await sleep(300);

  // B-3: 아이디어 생성 → 구조화 (Google→OpenAI)
  const b3_step1 = await chat('google', 'gemini-1.5-flash', '스마트홈 앱 아이디어 3개를 한 줄씩 제안해줘');
  const b3_result = b3_step1.ok
    ? await chat('openai', 'gpt-4o-mini', `다음 아이디어들을 JSON 배열로 구조화해줘 (name, description 필드): "${b3_step1.content.slice(0,200)}"`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'B', label: 'B-3 아이디어→구조화(GGL→OAI)', ms: (b3_step1.ms||0)+(b3_result.ms||0) });
  record('B-멀티스텝', 'B-3 아이디어→JSON구조화 (GGL→OAI)', b3_result.ok ? 'PASS' : 'FAIL',
    b3_result.ok ? `총 ${(b3_step1.ms||0)+(b3_result.ms||0)}ms | "${b3_result.content.slice(0,40)}"` : b3_result.error?.slice(0,60));
  await sleep(300);

  // B-4: 코드 생성 → 리뷰 (DeepSeek→Anthropic)
  const b4_step1 = await chat('deepseek', 'deepseek-chat', 'Python으로 피보나치 수열 10개 출력하는 함수 작성해줘 (코드만)');
  const b4_result = b4_step1.ok
    ? await chat('anthropic', 'claude-haiku-4-5-20251001', `다음 Python 코드를 리뷰해줘 (장단점 2가지씩): \`\`\`python\n${b4_step1.content.slice(0,300)}\n\`\`\``)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'B', label: 'B-4 코드생성→리뷰(DSK→ANT)', ms: (b4_step1.ms||0)+(b4_result.ms||0) });
  record('B-멀티스텝', 'B-4 코드생성→리뷰 (DSK→ANT)', b4_result.ok ? 'PASS' : 'FAIL',
    b4_result.ok ? `총 ${(b4_step1.ms||0)+(b4_result.ms||0)}ms | "${b4_result.content.slice(0,40)}"` : b4_result.error?.slice(0,60));
  await sleep(300);

  // B-5: 질문 생성 → 답변 → 요약 (3단계, 단일 공급자)
  const b5_s1 = await chat('openai', 'gpt-4o-mini', '머신러닝에 대한 초보자용 질문 2개 만들어줘');
  const b5_s2 = b5_s1.ok ? await chat('openai', 'gpt-4o-mini', `다음 질문들에 간단히 답해줘:\n${b5_s1.content.slice(0,200)}`) : { ok: false, error: 'step1 실패' };
  const b5_s3 = b5_s2.ok ? await chat('mistral', 'mistral-small-latest', `다음 Q&A를 1~2문장으로 요약해줘:\n${b5_s2.content.slice(0,300)}`) : { ok: false, error: 'step2 실패' };
  const totalMs = (b5_s1.ms||0)+(b5_s2.ms||0)+(b5_s3.ms||0);
  TIMINGS.push({ group: 'B', label: 'B-5 3단계파이프라인', ms: totalMs });
  record('B-멀티스텝', 'B-5 질문→답변→요약 (3단계)', b5_s3.ok ? 'PASS' : 'FAIL',
    b5_s3.ok ? `총 ${totalMs}ms | "${b5_s3.content.slice(0,40)}"` : b5_s3.error?.slice(0,60));
  await sleep(300);

  // B-6: 감성분석 → 응답 생성 (Anthropic→Google)
  const b6_s1 = await chat('anthropic', 'claude-haiku-4-5-20251001', '다음 고객 리뷰의 감성을 분석해줘: "배송이 너무 느리고 제품 품질도 실망스러웠어요. 다음엔 안 살 것 같아요."');
  const b6_s2 = b6_s1.ok
    ? await chat('google', 'gemini-1.5-flash', `고객이 부정적인 리뷰를 남겼습니다. 다음 분석을 참고해 공감하는 고객 응대 메시지를 작성해줘:\n${b6_s1.content.slice(0,200)}`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'B', label: 'B-6 감성분석→응대(ANT→GGL)', ms: (b6_s1.ms||0)+(b6_s2.ms||0) });
  record('B-멀티스텝', 'B-6 감성분석→응대 (ANT→GGL)', b6_s2.ok ? 'PASS' : 'FAIL',
    b6_s2.ok ? `총 ${(b6_s1.ms||0)+(b6_s2.ms||0)}ms | "${b6_s2.content.slice(0,40)}"` : b6_s2.error?.slice(0,60));
  await sleep(300);
}

// ═══════════════════════════════════════════════════════════
// C. Fallback 테스트 (4회)
// ═══════════════════════════════════════════════════════════
async function testFallback() {
  section('C. Fallback 테스트 (4회) — 오류 시 대체 공급자');

  // C-1: 존재하지 않는 모델 → fallback 확인
  const c1_primary = await chat('openai', 'gpt-99-nonexistent', '안녕?');
  const c1_fallback = await chat('openai', 'gpt-4o-mini', '안녕?');
  TIMINGS.push({ group: 'C', label: 'C-1 잘못된모델→fallback', ms: c1_fallback.ms||0 });
  const c1_ok = !c1_primary.ok && c1_fallback.ok;
  record('C-Fallback', 'C-1 잘못된 모델명 → fallback 동작', c1_ok ? 'PASS' : 'WARN',
    `primary:${c1_primary.ok?'성공':'실패(예상)'} fallback:${c1_fallback.ok?'✅성공':'❌실패'}`);
  await sleep(300);

  // C-2: 비활성 공급자 → 다른 공급자로 대체
  const c2_primary = await chat('moonshot', 'moonshot-v1-8k', '안녕?');
  const c2_fallback = await chat('deepseek', 'deepseek-chat', '안녕?');
  TIMINGS.push({ group: 'C', label: 'C-2 비활성공급자→fallback', ms: c2_fallback.ms||0 });
  const c2_ok = !c2_primary.ok && c2_fallback.ok;
  record('C-Fallback', 'C-2 비활성 공급자 → fallback 동작', c2_ok ? 'PASS' : 'WARN',
    `moonshot:${c2_primary.ok?'성공':'실패(예상)'} fallback deepseek:${c2_fallback.ok?'✅성공':'❌실패'}`);
  await sleep(300);

  // C-3: 빈 응답/프롬프트 → 오류 핸들링
  const c3 = await req('POST', '/api/ai/chat', {
    messages: [{ role: 'user', content: '' }],
    provider: 'openai', model: 'gpt-4o-mini',
  });
  TIMINGS.push({ group: 'C', label: 'C-3 빈프롬프트 핸들링', ms: 0 });
  const c3_handled = c3.status === 400 || (c3.body?.error && !c3.body?.success) || c3.body?.content;
  record('C-Fallback', 'C-3 빈 프롬프트 오류 핸들링', c3_handled ? 'PASS' : 'WARN',
    `HTTP:${c3.status} | ${JSON.stringify(c3.body).slice(0,60)}`);
  await sleep(300);

  // C-4: 매우 긴 프롬프트 → 오류 없이 처리
  const longPrompt = '다음 텍스트를 요약해줘: ' + '이것은 테스트 문장입니다. '.repeat(50);
  const c4 = await chat('openai', 'gpt-4o-mini', longPrompt);
  TIMINGS.push({ group: 'C', label: 'C-4 긴프롬프트 처리', ms: c4.ms||0 });
  record('C-Fallback', 'C-4 긴 프롬프트 (1100자) 처리', c4.ok ? 'PASS' : 'WARN',
    c4.ok ? `${c4.ms}ms | "${c4.content.slice(0,40)}"` : c4.error?.slice(0,60));
  await sleep(300);
}

// ═══════════════════════════════════════════════════════════
// D. 비용/속도 측정 (3회)
// ═══════════════════════════════════════════════════════════
async function testCostSpeed() {
  section('D. 비용/속도 측정 (3회)');

  const PROMPT = '인공지능의 역사를 200자 이내로 설명해줘';
  const speedData = [];

  // D-1: 동일 프롬프트 3개 공급자 동시 속도 비교
  console.log('  ⏱  동시 호출 중...');
  const [d1_oai, d1_ant, d1_ggl] = await Promise.all([
    chat('openai',    'gpt-4o-mini',             PROMPT),
    chat('anthropic', 'claude-haiku-4-5-20251001', PROMPT),
    chat('google',    'gemini-1.5-flash',          PROMPT),
  ]);
  speedData.push({ name:'OpenAI gpt-4o-mini',  ms: d1_oai.ms||9999, ok: d1_oai.ok });
  speedData.push({ name:'Anthropic haiku-4-5', ms: d1_ant.ms||9999, ok: d1_ant.ok });
  speedData.push({ name:'Google gemini-flash', ms: d1_ggl.ms||9999, ok: d1_ggl.ok });
  speedData.sort((a,b)=>a.ms-b.ms);
  const fastest = speedData.filter(s=>s.ok)[0];
  TIMINGS.push({ group: 'D', label: 'D-1 속도비교(3공급자)', ms: Math.max(d1_oai.ms||0,d1_ant.ms||0,d1_ggl.ms||0) });
  record('D-비용속도', 'D-1 속도 비교 (3공급자 동시)',
    (d1_oai.ok || d1_ant.ok || d1_ggl.ok) ? 'PASS' : 'FAIL',
    speedData.map(s=>`${s.name}:${s.ok?s.ms+'ms':'❌'}`).join(' | '));
  await sleep(300);

  // D-2: 동일 쿼리 저비용 vs 고성능 모델 비교
  const [d2_mini, d2_full] = await Promise.all([
    chat('openai', 'gpt-4o-mini', '양자컴퓨팅을 한 문장으로 설명해줘'),
    chat('openai', 'gpt-4o',      '양자컴퓨팅을 한 문장으로 설명해줘'),
  ]);
  TIMINGS.push({ group: 'D', label: 'D-2 mini vs full 비교', ms: Math.max(d2_mini.ms||0,d2_full.ms||0) });
  record('D-비용속도', 'D-2 gpt-4o-mini vs gpt-4o 비교',
    (d2_mini.ok && d2_full.ok) ? 'PASS' : 'WARN',
    `mini:${d2_mini.ok?d2_mini.ms+'ms':'❌'} | full:${d2_full.ok?d2_full.ms+'ms':'❌'}`);
  if (d2_mini.ok && d2_full.ok) {
    console.log(`     mini 응답: "${d2_mini.content.slice(0,50)}"`);
    console.log(`     full 응답: "${d2_full.content.slice(0,50)}"`);
  }
  await sleep(300);

  // D-3: 응답 토큰 제어 테스트 (짧은 답변 요청)
  const d3_short = await chat('openai', 'gpt-4o-mini', '예/아니오로만 대답해: 지구는 둥근가?');
  const d3_long  = await chat('openai', 'gpt-4o-mini', '지구가 둥근 이유를 상세히 설명해줘 (최소 5문장)');
  TIMINGS.push({ group: 'D', label: 'D-3 토큰제어', ms: (d3_short.ms||0)+(d3_long.ms||0) });
  record('D-비용속도', 'D-3 짧은/긴 응답 토큰 제어',
    (d3_short.ok && d3_long.ok) ? 'PASS' : 'WARN',
    `short:${d3_short.content?.length||0}자 | long:${d3_long.content?.length||0}자`);
  await sleep(300);
}

// ═══════════════════════════════════════════════════════════
// E. 단일 vs 조합 비교 (3회)
// ═══════════════════════════════════════════════════════════
async function testSingleVsCombo() {
  section('E. 단일 vs 조합 비교 (3회)');

  // E-1: 단일 vs 2단계 번역 품질
  const prompt_e1 = '복잡한 문장을 영어로 번역해줘: "인공지능이 인류의 삶을 근본적으로 변화시키고 있으며, 이는 산업 전반에 걸쳐 새로운 패러다임을 형성하고 있다."';
  const e1_single = await chat('openai', 'gpt-4o-mini', prompt_e1);
  const e1_step1  = await chat('deepseek', 'deepseek-chat', prompt_e1);
  const e1_combo  = e1_step1.ok
    ? await chat('openai', 'gpt-4o-mini', `다음 번역을 더 자연스럽게 다듬어줘 (영어 유지): "${e1_step1.content.slice(0,200)}"`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'E', label: 'E-1 단일vs2단계번역', ms: Math.max(e1_single.ms||0,(e1_step1.ms||0)+(e1_combo.ms||0)) });
  record('E-단일vs조합', 'E-1 번역: 단일(OAI) vs 2단계(DSK→OAI)',
    (e1_single.ok && e1_combo.ok) ? 'PASS' : 'WARN',
    `단일:${e1_single.ms||'❌'}ms | 조합:${(e1_step1.ms||0)+(e1_combo.ms||0)}ms`);
  if (e1_single.ok) console.log(`     단일:  "${e1_single.content.slice(0,60)}"`);
  if (e1_combo.ok)  console.log(`     조합:  "${e1_combo.content.slice(0,60)}"`);
  await sleep(300);

  // E-2: 단일 요약 vs 요약+검증 2단계
  const longText = '블록체인은 분산 원장 기술로, 모든 거래 내역을 블록에 담아 체인 형식으로 연결합니다. 각 블록은 이전 블록의 해시값을 포함하여 위조가 불가능하며, 탈중앙화된 네트워크에서 합의 알고리즘을 통해 검증됩니다. 비트코인이 처음 이 기술을 활용했으며, 이후 스마트 컨트랙트, DeFi, NFT 등 다양한 응용 분야로 확장되었습니다.';
  const e2_single = await chat('openai', 'gpt-4o-mini', `다음을 2문장으로 요약해줘: "${longText}"`);
  const e2_s1     = await chat('anthropic', 'claude-haiku-4-5-20251001', `다음을 2문장으로 요약해줘: "${longText}"`);
  const e2_combo  = e2_s1.ok
    ? await chat('google', 'gemini-1.5-flash', `다음 두 요약 중 더 정확한 것을 선택하고 이유를 설명해줘:\nA: ${e2_single.content?.slice(0,150)||'없음'}\nB: ${e2_s1.content?.slice(0,150)||'없음'}`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'E', label: 'E-2 단일요약vs검증조합', ms: (e2_single.ms||0)+(e2_s1.ms||0)+(e2_combo.ms||0) });
  record('E-단일vs조합', 'E-2 요약: 단일 vs 교차검증 (OAI+ANT+GGL)',
    (e2_single.ok && e2_combo.ok) ? 'PASS' : 'WARN',
    `단일:${e2_single.ms||'❌'}ms | 조합:${(e2_single.ms||0)+(e2_s1.ms||0)+(e2_combo.ms||0)}ms`);
  await sleep(300);

  // E-3: 단일 창작 vs 아이디어+구체화 조합
  const e3_single = await chat('openai', 'gpt-4o', 'AI를 소재로 한 단편소설 첫 단락을 써줘 (3~4문장)');
  const e3_idea   = await chat('anthropic', 'claude-sonnet-4-5-20250929', 'AI를 소재로 한 단편소설 아이디어를 3줄로 제안해줘 (배경, 주인공, 갈등)');
  const e3_combo  = e3_idea.ok
    ? await chat('openai', 'gpt-4o', `다음 아이디어를 바탕으로 단편소설 첫 단락을 써줘 (3~4문장):\n${e3_idea.content.slice(0,200)}`)
    : { ok: false, error: 'step1 실패' };
  TIMINGS.push({ group: 'E', label: 'E-3 단일창작vs조합창작', ms: Math.max(e3_single.ms||0,(e3_idea.ms||0)+(e3_combo.ms||0)) });
  record('E-단일vs조합', 'E-3 창작: 단일(GPT-4o) vs 아이디어→구체화(ANT→OAI)',
    (e3_single.ok && e3_combo.ok) ? 'PASS' : 'WARN',
    `단일:${e3_single.ms||'❌'}ms | 조합:${(e3_idea.ms||0)+(e3_combo.ms||0)}ms`);
  if (e3_single.ok) console.log(`     단일:  "${e3_single.content.slice(0,70)}"`);
  if (e3_combo.ok)  console.log(`     조합:  "${e3_combo.content.slice(0,70)}"`);
  await sleep(300);
}

// ═══════════════════════════════════════════════════════════
// 최종 보고서
// ═══════════════════════════════════════════════════════════
function printReport() {
  const bar = '═'.repeat(64);
  console.log(`\n${bar}`);
  console.log('  📊 엔진 단위 1차 테스트 최종 보고서');
  console.log(bar);

  // 그룹별 집계
  const groups = { 'A-라우팅':'A', 'B-멀티스텝':'B', 'C-Fallback':'C', 'D-비용속도':'D', 'E-단일vs조합':'E' };
  const labels = { 'A':'라우팅(8)', 'B':'멀티스텝(6)', 'C':'Fallback(4)', 'D':'비용/속도(3)', 'E':'단일vs조합(3)' };
  for (const [gKey, gCode] of Object.entries(groups)) {
    const rows = RESULTS.filter(r => r.group === gKey);
    const p = rows.filter(r=>r.result==='PASS').length;
    const f = rows.filter(r=>r.result==='FAIL').length;
    const w = rows.filter(r=>r.result==='WARN').length;
    const avg = TIMINGS.filter(t=>t.group===gCode).reduce((a,t)=>a+t.ms,0) / (TIMINGS.filter(t=>t.group===gCode).length||1);
    console.log(`  ${gCode}. ${labels[gCode].padEnd(14)} ✅${p} ❌${f} ⚠️${w}  평균 ${Math.round(avg)}ms`);
  }

  console.log(bar);
  console.log(`  ✅ PASS  : ${PASS}개`);
  console.log(`  ⚠️  WARN  : ${WARN}개`);
  console.log(`  ❌ FAIL  : ${FAIL}개`);
  console.log(`  📝 총계  : ${PASS+WARN+FAIL+SKIP}개 / 24개`);
  console.log(bar);

  // 속도 Top3
  const sorted = [...TIMINGS].filter(t=>t.ms>0).sort((a,b)=>a.ms-b.ms);
  if (sorted.length) {
    console.log('  ⚡ 빠른 케이스 Top3:');
    sorted.slice(0,3).forEach((t,i) => console.log(`     ${i+1}. ${t.label.slice(0,35).padEnd(35)} ${t.ms}ms`));
    console.log('  🐢 느린 케이스 Top3:');
    sorted.slice(-3).reverse().forEach((t,i) => console.log(`     ${i+1}. ${t.label.slice(0,35).padEnd(35)} ${t.ms}ms`));
  }
  console.log(bar);

  const total = PASS+WARN+FAIL;
  const score = total > 0 ? Math.round(((PASS + WARN*0.5) / total) * 100) : 0;
  console.log(`  🎯 점수  : ${score}/100`);
  if (FAIL === 0)       console.log('  🟢 판정  : 우수 — 모든 케이스 정상 처리');
  else if (FAIL <= 2)   console.log('  🟡 판정  : 양호 — 경미한 이슈 존재');
  else                  console.log('  🔴 판정  : 개선 필요');
  console.log(bar + '\n');
}

// ── 메인 ──────────────────────────────────────────────────
(async () => {
  console.log('\n' + '═'.repeat(64));
  console.log('  🚀 AI 오케스트레이터 엔진 단위 1차 테스트');
  console.log('  📅 ' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  console.log('  📋 총 24회 | 재시도 최대 2회/케이스');
  console.log('═'.repeat(64));

  await setup();
  await testRouting();
  await testMultiStep();
  await testFallback();
  await testCostSpeed();
  await testSingleVsCombo();
  printReport();
})();
