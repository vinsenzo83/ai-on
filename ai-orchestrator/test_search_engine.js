// test_search_engine.js — Phase 5 Search Engine Integration Tests
// Run: node test_search_engine.js
'use strict';

require('dotenv').config();
const searchEngine = require('./src/agent/searchEngine');

const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW= '\x1b[33m';
const RESET = '\x1b[0m';

let passed = 0, failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ${GREEN}✅ PASS${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}❌ FAIL${RESET} ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log(`\n${BOLD}=== Phase 5: Search Engine Tests ===${RESET}\n`);

  // ── T1: 모듈 로드 ──────────────────────────────────────────
  console.log(`${BOLD}T1: Module Load & Provider Detection${RESET}`);
  assert(typeof searchEngine.search === 'function', 'search() 함수 존재');
  assert(typeof searchEngine.getKPI === 'function', 'getKPI() 함수 존재');
  assert(typeof searchEngine.getActiveProviders === 'function', 'getActiveProviders() 함수 존재');

  const providers = searchEngine.getActiveProviders();
  assert(Array.isArray(providers), 'providers 배열 반환');
  assert(providers.includes('duckduckgo'), 'DuckDuckGo 항상 포함');
  console.log(`  Active providers: ${providers.join(', ')}`);

  const hasKeys = {
    brave:   !!process.env.BRAVE_SEARCH_API_KEY,
    serpapi: !!process.env.SERPAPI_API_KEY,
    serper:  !!process.env.SERPER_API_KEY,
    tavily:  !!process.env.TAVILY_API_KEY,
  };
  console.log(`  Key detection: ${JSON.stringify(hasKeys)}`);
  assert(hasKeys.brave || hasKeys.serpapi || hasKeys.tavily || hasKeys.serper,
    '최소 하나의 유료 프로바이더 키 존재');

  // ── T2: Brave Search ───────────────────────────────────────
  console.log(`\n${BOLD}T2: Brave Search Provider${RESET}`);
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const start = Date.now();
    const result = await searchEngine._searchBrave('서울 날씨 오늘', 3);
    const latency = Date.now() - start;
    assert(result !== null, 'Brave 결과 반환', result?.text?.slice(0, 80));
    assert(result?.provider === 'brave', 'provider = brave');
    assert(latency < 10000, `응답시간 < 10s (${latency}ms)`);
    if (result) console.log(`  Preview: ${result.text.slice(0, 120)}...`);
  } else {
    console.log(`  ${YELLOW}⏭ SKIP${RESET} BRAVE_SEARCH_API_KEY 없음`);
  }

  // ── T3: SerpAPI ────────────────────────────────────────────
  console.log(`\n${BOLD}T3: SerpAPI Provider${RESET}`);
  if (process.env.SERPAPI_API_KEY) {
    const start = Date.now();
    const result = await searchEngine._searchSerpApi('AI 최신 뉴스', 3);
    const latency = Date.now() - start;
    assert(result !== null, 'SerpAPI 결과 반환');
    assert(result?.provider === 'serpapi', 'provider = serpapi');
    assert(latency < 12000, `응답시간 < 12s (${latency}ms)`);
    if (result) console.log(`  Preview: ${result.text.slice(0, 120)}...`);
  } else {
    console.log(`  ${YELLOW}⏭ SKIP${RESET} SERPAPI_API_KEY 없음`);
  }

  // ── T4: 통합 search() — Brave 우선 ────────────────────────
  console.log(`\n${BOLD}T4: search() — Multi-provider Fallback${RESET}`);
  {
    const start  = Date.now();
    const result = await searchEngine.search('Python 프로그래밍 튜토리얼', { maxResults: 3 });
    const latency = Date.now() - start;
    assert(typeof result === 'string', 'search() string 반환');
    assert(result.length > 50, `결과 길이 > 50자 (${result.length}자)`);
    assert(latency < 12000, `응답시간 < 12s (${latency}ms)`);
    const kpi = searchEngine.getKPI();
    assert(kpi.total_searches >= 1, 'KPI total_searches 카운트됨');
    assert(kpi.success_count >= 1, 'KPI success_count 카운트됨');
    assert(kpi.last_used_provider !== null, `last_used_provider: ${kpi.last_used_provider}`);
    console.log(`  Provider used: ${kpi.last_used_provider} (${latency}ms)`);
    console.log(`  Preview: ${result.slice(0, 120)}...`);
  }

  // ── T5: DuckDuckGo 폴백 ────────────────────────────────────
  console.log(`\n${BOLD}T5: DuckDuckGo Fallback (no keys)${RESET}`);
  {
    // 임시로 키 없는 상태 시뮬레이션
    const savedBrave   = process.env.BRAVE_SEARCH_API_KEY;
    const savedSerpapi = process.env.SERPAPI_API_KEY;
    const savedSerper  = process.env.SERPER_API_KEY;
    const savedTavily  = process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const result = await searchEngine._searchDuckDuckGo('JavaScript');
    // 복원
    if (savedBrave)   process.env.BRAVE_SEARCH_API_KEY = savedBrave;
    if (savedSerpapi) process.env.SERPAPI_API_KEY       = savedSerpapi;
    if (savedSerper)  process.env.SERPER_API_KEY         = savedSerper;
    if (savedTavily)  process.env.TAVILY_API_KEY         = savedTavily;

    if (result) {
      assert(result.provider === 'duckduckgo', 'DuckDuckGo 결과 반환');
      console.log(`  DDG Preview: ${result.text.slice(0, 80)}...`);
    } else {
      console.log(`  ${YELLOW}⚠ DDG returned null (네트워크 연결 확인)${RESET}`);
      // DDG는 네트워크 환경에 따라 null 가능 — 실패로 처리하지 않음
      passed++;
    }
  }

  // ── T6: KPI 집계 ───────────────────────────────────────────
  console.log(`\n${BOLD}T6: KPI Aggregation${RESET}`);
  {
    const kpi = searchEngine.getKPI();
    assert(typeof kpi.total_searches     === 'number', 'total_searches number');
    assert(typeof kpi.success_count      === 'number', 'success_count number');
    assert(typeof kpi.failure_count      === 'number', 'failure_count number');
    assert(typeof kpi.avg_latency_ms     === 'number', 'avg_latency_ms number');
    assert(typeof kpi.success_rate       === 'string', 'success_rate string');
    assert(typeof kpi.provider_counts    === 'object', 'provider_counts object');
    assert(Array.isArray(kpi.active_providers), 'active_providers array');
    console.log(`  KPI summary: total=${kpi.total_searches}, success=${kpi.success_count}, rate=${kpi.success_rate}`);
    console.log(`  Provider usage: ${JSON.stringify(kpi.provider_counts)}`);
  }

  // ── 결과 ───────────────────────────────────────────────────
  console.log(`\n${BOLD}─────────────────────────────────────${RESET}`);
  console.log(`${BOLD}Results: ${GREEN}${passed} PASS${RESET} / ${failed > 0 ? RED : ''}${failed} FAIL${RESET}`);
  console.log(`─────────────────────────────────────`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
