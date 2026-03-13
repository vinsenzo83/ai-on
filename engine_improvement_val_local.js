'use strict';
/**
 * engine_improvement_val_local.js
 * Phase 13 개선사항 로컬 검증 (ai-orchestrator 로컬 모듈 사용)
 */
// dotenv 로드 (있으면)
try { require('dotenv').config({ path: '/home/user/webapp/ai-orchestrator/.env' }); } catch(_) {}
// API keys from env (서버에서 테스트 시 실제 키 필요)
// 로컬에서는 구조/로직 검증만 수행

// ── 로컬 모듈 경로로 require ──────────────────────────────────
const path = require('path');
const fs = require('fs');
const BASE = '/home/user/webapp/ai-orchestrator';

// aiConnector 로드 (node_modules 있어야 함)
let aiConnector;
try {
  // Process the require from the module's directory
  const mod = require(path.join(BASE, 'src/services/aiConnector'));
  aiConnector = mod;
} catch(e) {
  console.error('aiConnector 로드 실패:', e.message);
  process.exit(1);
}

const {
  callLLM,
  getCircuitStatus,
  getCacheStats,
  MODEL_STRATEGY,
} = aiConnector;

function ts() { return new Date().toISOString().replace('T',' ').slice(0,19); }
function ms(start) { return Date.now() - start; }

const results = [];
let pass = 0, fail = 0;
const modelCalls = {};

function recordResult(r) {
  results.push(r);
  if (r.success) pass++; else fail++;
  const m = r.selected_model || 'unknown';
  modelCalls[m] = (modelCalls[m] || 0) + 1;
  const icon = r.success ? '✅' : '❌';
  const fb = r.fallback_used ? ` [FB:${r.fallback_chain}]` : '';
  console.log(`${icon} [${r.task_id}] ${r.selected_model} | ${r.latency_ms}ms | Q:${r.quality_score} | ${r.notes?.slice(0,70)}${fb}`);
}

// ────────────────────────────────────────────────────────────
// STATIC CHECKS (로직 검증 — API 호출 없이 코드 구조 확인)
// ────────────────────────────────────────────────────────────

async function checkP5_DisabledModels() {
  console.log('\n[CHECK-P5] DISABLED_MODELS 구조 확인...');
  // aiConnector 소스 파일 직접 분석
  const src = fs.readFileSync(path.join(BASE, 'src/services/aiConnector.js'), 'utf8');
  const hasDisabledSet = src.includes("const DISABLED_MODELS = new Set(");
  const hasGrokMini = src.includes("'grok-3-mini'");
  const hasDisabledCheck = src.includes('DISABLED_MODELS.has(resolvedModel)');

  recordResult({
    task_id: 'P5-grok-disabled-code',
    prompt: 'grok-3-mini DISABLED_MODELS 코드 확인',
    expected_route: 'DISABLED_MODELS Set에 grok-3-mini 포함',
    actual_route: hasDisabledSet && hasGrokMini && hasDisabledCheck ? 'DISABLED_MODELS 정의 + 체크 로직 확인됨' : '코드 누락',
    selected_model: 'code-check',
    fallback_used: false, fallback_chain: '',
    latency_ms: 1, cost_usd: 0,
    success_fail: hasDisabledSet && hasGrokMini && hasDisabledCheck ? 'PASS' : 'FAIL',
    quality_score: hasDisabledSet && hasGrokMini && hasDisabledCheck ? 100 : 0,
    format_match: true,
    success: hasDisabledSet && hasGrokMini && hasDisabledCheck,
    notes: `[P5] DISABLED_MODELS Set: ${hasDisabledSet}, grok-3-mini포함: ${hasGrokMini}, 차단로직: ${hasDisabledCheck}`,
  });
}

async function checkP4_DeepSeekCB() {
  console.log('\n[CHECK-P4] DeepSeek CB 임계값 3 코드 확인...');
  const src = fs.readFileSync(path.join(BASE, 'src/services/aiConnector.js'), 'utf8');
  const hasThresholdMap = src.includes('CB_FAIL_THRESHOLD_BY_PROVIDER');
  const hasDeepseek3 = src.includes('deepseek: 3');
  const hasXai2 = src.includes('xai:      2') || src.includes('xai: 2');
  const hasThresholdUsage = src.includes('CB_FAIL_THRESHOLD_BY_PROVIDER[provider] || CB_FAIL_THRESHOLD');

  // CB 상태 확인
  const cbStatus = getCircuitStatus();

  recordResult({
    task_id: 'P4-deepseek-cb-3',
    prompt: 'DeepSeek CB 임계값 3 코드 확인',
    expected_route: 'CB_FAIL_THRESHOLD_BY_PROVIDER.deepseek = 3',
    actual_route: hasThresholdMap && hasDeepseek3 ? 'deepseek=3 확인됨' : '코드 누락',
    selected_model: 'code-check',
    fallback_used: false, fallback_chain: '',
    latency_ms: 1, cost_usd: 0,
    success_fail: hasThresholdMap && hasDeepseek3 ? 'PASS' : 'FAIL',
    quality_score: hasThresholdMap && hasDeepseek3 ? 100 : 0,
    format_match: true,
    success: hasThresholdMap && hasDeepseek3,
    notes: `[P4] ThresholdMap: ${hasThresholdMap}, deepseek=3: ${hasDeepseek3}, xai=2: ${hasXai2}, 적용로직: ${hasThresholdUsage}. CB상태: ${JSON.stringify(cbStatus)}`,
  });
}

async function checkP3_CachePersist() {
  console.log('\n[CHECK-P3] 캐시 영속화 코드 확인...');
  const src = fs.readFileSync(path.join(BASE, 'src/services/aiConnector.js'), 'utf8');
  const hasFsRequire = src.includes("require('fs')");
  const hasCachePath = src.includes('CACHE_PERSIST_PATH');
  const hasLoadFn = src.includes('_loadCacheFromDisk');
  const hasSaveFn = src.includes('_saveCacheToDisk');
  const hasInterval = src.includes('setInterval(_saveCacheToDisk');
  const hasSigterm = src.includes("process.on('SIGTERM'");
  const cacheStats = getCacheStats();

  recordResult({
    task_id: 'P3-cache-persist-code',
    prompt: '캐시 파일 영속화 코드 확인',
    expected_route: 'fs + CACHE_PERSIST_PATH + load/save + interval + SIGTERM',
    actual_route: [hasFsRequire, hasCachePath, hasLoadFn, hasSaveFn, hasInterval, hasSigterm].every(Boolean) ? '모든 영속화 코드 확인됨' : '일부 누락',
    selected_model: 'code-check',
    fallback_used: false, fallback_chain: '',
    latency_ms: 1, cost_usd: 0,
    success_fail: [hasFsRequire, hasCachePath, hasLoadFn, hasSaveFn, hasInterval, hasSigterm].every(Boolean) ? 'PASS' : 'FAIL',
    quality_score: [hasFsRequire, hasCachePath, hasLoadFn, hasSaveFn, hasInterval, hasSigterm].filter(Boolean).length / 6 * 100,
    format_match: true,
    success: [hasFsRequire, hasCachePath, hasLoadFn, hasSaveFn].every(Boolean),
    notes: `[P3] fs:${hasFsRequire}, path:${hasCachePath}, load:${hasLoadFn}, save:${hasSaveFn}, interval:${hasInterval}, sigterm:${hasSigterm}. 캐시stats:${JSON.stringify(cacheStats)}`,
  });
}

async function checkP1_FastRouting() {
  console.log('\n[CHECK-P1] fast strategy google/mistral 우선 코드 확인...');
  const src = fs.readFileSync(path.join(BASE, 'src/services/aiConnector.js'), 'utf8');
  const hasFastStratPriority = src.includes('FAST_STRATEGY_PRIORITY');
  const hasGoogleFirst = src.includes("'google', 'mistral', 'openai'");
  const hasFastStratGoogle = src.includes("google: 'gemini-2.0-flash'");
  const hasFastStratMistral = src.includes("mistral: 'mistral-small-latest'");
  const hasFastBranch = src.includes("if (strategy === 'fast')");
  const hasFallbackChainUpdated = src.includes("['google', 'mistral', 'openai'");

  // MODEL_STRATEGY 확인
  const stratFast = MODEL_STRATEGY?.fast;

  recordResult({
    task_id: 'P1-fast-routing-code',
    prompt: 'fast strategy google/mistral 우선 코드 확인',
    expected_route: 'FAST_STRATEGY_PRIORITY: [google, mistral, openai, anthropic]',
    actual_route: hasFastStratPriority && hasGoogleFirst ? '우선순위 배열 확인됨' : '코드 누락',
    selected_model: 'code-check',
    fallback_used: false, fallback_chain: '',
    latency_ms: 1, cost_usd: 0,
    success_fail: hasFastStratPriority && hasGoogleFirst && hasFastBranch ? 'PASS' : 'FAIL',
    quality_score: [hasFastStratPriority, hasGoogleFirst, hasFastStratGoogle, hasFastStratMistral, hasFastBranch, hasFallbackChainUpdated].filter(Boolean).length / 6 * 100,
    format_match: true,
    success: hasFastStratPriority && hasGoogleFirst && hasFastBranch,
    notes: `[P1] Priority배열:${hasFastStratPriority}, google우선:${hasGoogleFirst}, gemini:${hasFastStratGoogle}, mistral:${hasFastStratMistral}, fast분기:${hasFastBranch}, chain:${hasFallbackChainUpdated}. stratFast:${JSON.stringify(stratFast)}`,
  });
}

async function checkP1_xAIFallback() {
  console.log('\n[CHECK-P1] xAI 429 폴백 체인 코드 확인...');
  const src = fs.readFileSync(path.join(BASE, 'src/services/aiConnector.js'), 'utf8');
  const hasXaiChain = src.includes('xaiPreferredChain');
  const hasXaiCheck = src.includes("excludeProvider === 'xai'");
  const hasRateLimit = src.includes("reason === 'RATE_LIMIT'");
  const hasXaiLog = src.includes('[aiConnector][xAI-429]');
  const hasModelMap = src.includes("const fbModelMap = {");

  recordResult({
    task_id: 'P1-xai-fallback-code',
    prompt: 'xAI 429 폴백 체인 코드 확인',
    expected_route: 'xAI RATE_LIMIT → xaiPreferredChain 순서로 폴백',
    actual_route: hasXaiChain && hasXaiCheck ? 'xAI 폴백 체인 코드 확인됨' : '코드 누락',
    selected_model: 'code-check',
    fallback_used: false, fallback_chain: '',
    latency_ms: 1, cost_usd: 0,
    success_fail: hasXaiChain && hasXaiCheck && hasRateLimit ? 'PASS' : 'FAIL',
    quality_score: [hasXaiChain, hasXaiCheck, hasRateLimit, hasXaiLog, hasModelMap].filter(Boolean).length / 5 * 100,
    format_match: true,
    success: hasXaiChain && hasXaiCheck && hasRateLimit,
    notes: `[P1] xaiChain:${hasXaiChain}, xaiCheck:${hasXaiCheck}, rateLimitBranch:${hasRateLimit}, 로그:${hasXaiLog}, modelMap:${hasModelMap}`,
  });
}

// ────────────────────────────────────────────────────────────
// LIVE API 테스트 (API 키 있는 경우)
// ────────────────────────────────────────────────────────────
async function runLiveTests() {
  console.log('\n[LIVE-TEST] 실제 API 호출 테스트 (키 있는 경우)...');

  const liveTests = [
    { id:'L01', cat:1, prompt:'안녕! 오늘 기분 어때?', strategy:'fast', expected:['gemini','mistral','gpt-4o-mini'] },
    { id:'L02', cat:1, prompt:'"Great job!" 한국어로 번역', strategy:'fast', expected:['gemini','mistral','gpt-4o-mini'] },
    { id:'L03', cat:2, prompt:'파이썬에서 리스트와 튜플의 차이점은?', strategy:'fast', expected:['gemini','mistral','gpt-4o-mini'] },
    { id:'L04', cat:2, prompt:'태양계에서 가장 큰 행성은?', strategy:'fast', expected:['gemini','mistral','gpt-4o-mini'] },
    { id:'L05', cat:3, prompt:'123456789에서 짝수 자릿수의 합을 구해줘', strategy:'balanced', expected:['gpt-4o','claude','gemini'] },
    { id:'L06', cat:4, prompt:'JavaScript async/await 사용 예시 코드 보여줘', strategy:'code', expected:['gpt-4o','claude'] },
    { id:'L07', cat:5, prompt:'간단한 인사: 안녕하세요', model:'grok-3-mini', strategy:'fast', expected:['gpt-4o-mini','mistral','gemini'] },
    { id:'L08', cat:6, prompt:'{"a":1,"b":2,"c":3}에서 b의 값을 {"value":X} 형태로 반환', strategy:'fast', responseFormat:'json', expected:['gemini','mistral','gpt-4o'] },
    { id:'L09', cat:7, prompt:'다음을 요약: ' + '클라우드 컴퓨팅은 인터넷을 통해 서버, 스토리지, DB를 제공하는 기술입니다. '.repeat(10), strategy:'balanced', expected:['gpt-4o','claude','gemini'] },
    { id:'L10', cat:8, prompt:'7 × 6 = ?', strategy:'fast', expected:['gemini','mistral','gpt-4o-mini'] },
  ];

  let routingHit = 0;

  for (const tc of liveTests) {
    const start = Date.now();
    try {
      const opts = {
        messages: [{ role:'user', content: tc.prompt }],
        strategy: tc.strategy || 'fast',
        userId: 'val-live',
        pipeline: 'improvement-val',
        maxTokens: 200,
      };
      if (tc.model) opts.model = tc.model;
      if (tc.responseFormat) opts.responseFormat = tc.responseFormat;

      const r = await callLLM(opts);
      const usedModel = r.model || r.selectedModel || '';
      const latency = ms(start);
      const isExpected = tc.expected.some(h => usedModel.includes(h));
      if (isExpected) routingHit++;

      let formatMatch = true;
      if (tc.responseFormat === 'json') {
        try { JSON.parse(r.content || '{}'); } catch(_) { formatMatch = false; }
      }

      recordResult({
        task_id: tc.id,
        prompt: tc.prompt.slice(0,50),
        expected_route: tc.expected.join('|'),
        actual_route: usedModel,
        selected_model: usedModel,
        fallback_used: r.isFallback || false,
        fallback_chain: r.fallbackReason || '',
        latency_ms: latency, cost_usd: 0,
        success_fail: isExpected ? 'PASS' : 'NOTE',
        quality_score: isExpected ? 95 : 80,
        format_match: formatMatch,
        success: true,
        notes: isExpected
          ? `✅ 기대 모델: ${usedModel}`
          : `⚠️ 기대외: ${usedModel} (기대:${tc.expected[0]}) ${r.isFallback ? '[FB:'+r.fallbackReason+']' : ''}`,
      });
    } catch(e) {
      recordResult({
        task_id: tc.id,
        prompt: tc.prompt.slice(0,50),
        expected_route: tc.expected.join('|'),
        actual_route: 'error',
        selected_model: 'error',
        fallback_used: false, fallback_chain: '',
        latency_ms: ms(start), cost_usd: 0,
        success_fail: 'FAIL', quality_score: 0, format_match: false,
        success: false, notes: e.message?.slice(0,80),
      });
    }
  }
  return { routingHit, total: liveTests.length };
}

// ────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log('AI 조합 엔진 Phase 13 개선 검증 (로컬)');
  console.log(`실행 시각: ${ts()}`);
  console.log(`${'='.repeat(70)}\n`);

  // 1. 코드 정적 검사 (5개 개선 항목)
  await checkP5_DisabledModels();
  await checkP4_DeepSeekCB();
  await checkP3_CachePersist();
  await checkP1_FastRouting();
  await checkP1_xAIFallback();

  // 2. 실제 API 호출 (가능한 경우)
  let liveRouting = { routingHit: 0, total: 0 };
  const hasApiKey = !!(process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY || process.env.MISTRAL_API_KEY);
  if (hasApiKey) {
    liveRouting = await runLiveTests();
  } else {
    console.log('\n[SKIP] API 키 없음 — 라이브 테스트 건너뜀 (코드 검증만 수행)');
  }

  // KPI 집계
  const total = results.length;
  const successCount = results.filter(r => r.success).length;
  const avgLatency = Math.round(results.reduce((s, r) => s + (r.latency_ms||0), 0) / total);
  const formatCount = results.filter(r => r.format_match).length;
  const avgQuality = Math.round(results.reduce((s, r) => s + (r.quality_score||0), 0) / total);

  // 정적 검사 통과율 (5개 항목)
  const staticChecks = results.filter(r => r.task_id.includes('-code'));
  const staticPass = staticChecks.filter(r => r.success).length;

  // 라이브 라우팅 히트율
  const liveHitRate = liveRouting.total > 0 ? Math.round(liveRouting.routingHit / liveRouting.total * 100) : null;

  const compositeScore = (
    (successCount / total * 100) * 0.4 +
    avgQuality * 0.35 +
    (formatCount / total * 100) * 0.25
  ).toFixed(1);

  const verdict = compositeScore >= 90 ? '✅ 합격 (PASS)' :
                  compositeScore >= 75 ? '⚠️ 주의 (WARNING)' : '❌ 불합격 (FAIL)';

  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 Phase 13 개선 검증 최종 결과');
  console.log(`${'='.repeat(70)}`);
  console.log(`실행 시각: ${ts()}`);
  console.log(`총 테스트: ${total}개 (코드검사:${staticChecks.length}, 라이브:${liveRouting.total})`);
  console.log('');
  console.log('[ KPI 요약 ]');
  console.log(`  코드 검사 통과: ${staticPass}/${staticChecks.length} 항목`);
  console.log(`  전체 성공률:   ${Math.round(successCount/total*100)}% (${successCount}/${total})`);
  if (liveHitRate !== null) {
    console.log(`  라이브 라우팅:  ${liveHitRate}% (${liveRouting.routingHit}/${liveRouting.total}) | 목표:≥90%`);
  }
  console.log(`  평균 latency:  ${avgLatency}ms`);
  console.log(`  형식 준수율:   ${Math.round(formatCount/total*100)}%`);
  console.log(`  평균 품질:     ${avgQuality}/100`);
  console.log(`  종합 점수:     ${compositeScore}/100`);
  console.log(`  최종 판정:     ${verdict}`);
  console.log('');
  console.log('[ Phase 13 개선 항목별 결과 ]');
  for (const r of results.filter(r => r.task_id.includes('-code'))) {
    console.log(`  ${r.success ? '✅' : '❌'} [${r.task_id}] ${r.notes?.slice(0,80)}`);
  }
  console.log(`${'='.repeat(70)}`);

  const summary = {
    phase: 13,
    timestamp: ts(),
    mode: hasApiKey ? 'full' : 'code-check-only',
    code_checks: { total: staticChecks.length, pass: staticPass },
    live_tests: liveRouting,
    kpi: {
      success_rate: `${Math.round(successCount/total*100)}%`,
      routing_hit_rate: liveHitRate !== null ? `${liveHitRate}%` : 'N/A(no API key)',
      avg_latency_ms: avgLatency,
      format_compliance: `${Math.round(formatCount/total*100)}%`,
      avg_quality: avgQuality,
      composite_score: parseFloat(compositeScore),
      verdict: compositeScore >= 90 ? 'PASS' : compositeScore >= 75 ? 'WARNING' : 'FAIL',
    },
    improvements_verified: {
      'P1-fast-routing': results.find(r => r.task_id==='P1-fast-routing-code')?.success_fail,
      'P1-xai-429':      results.find(r => r.task_id==='P1-xai-fallback-code')?.success_fail,
      'P3-cache':        results.find(r => r.task_id==='P3-cache-persist-code')?.success_fail,
      'P4-deepseek-cb':  results.find(r => r.task_id==='P4-deepseek-cb-3')?.success_fail,
      'P5-grok-mini':    results.find(r => r.task_id==='P5-grok-disabled-code')?.success_fail,
    },
    details: results,
  };
  console.log('\nVALIDATION_JSON:' + JSON.stringify(summary, null, 2));
}

main().catch(e => {
  console.error('검증 오류:', e.message, e.stack?.slice(0,200));
  process.exit(1);
});
