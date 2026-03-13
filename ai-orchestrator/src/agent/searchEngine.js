// ── searchEngine.js ──────────────────────────────────────────────────────────
// Multi-provider web search with fallback chain
//
// Provider priority:
//   1. Brave Search API  (BRAVE_SEARCH_API_KEY)  — 실시간, 빠름
//   2. SerpAPI           (SERPAPI_API_KEY)        — Google 결과, 폴백
//   3. Serper.dev        (SERPER_API_KEY)         — Google 결과, 2차 폴백
//   4. Tavily            (TAVILY_API_KEY)         — 요약 포함
//   5. DuckDuckGo Instant Answer (무료, 키 불필요) — 최후 폴백
//
// Usage:
//   const searchEngine = require('./searchEngine');
//   const result = await searchEngine.search(query, { maxResults: 5 });
//   const kpi = searchEngine.getKPI();
// ────────────────────────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');

// ── KPI 영속화 경로 ──────────────────────────────────────────────────────────
const _KPI_FILE = path.resolve(__dirname, '../../data/search_stats.json');

// ── KPI 카운터 ─────────────────────────────────────────────────────────────
const _statsDefaults = () => ({
  totalSearches:     0,
  successCount:      0,
  failureCount:      0,
  providerCounts:    { brave: 0, serpapi: 0, serper: 0, tavily: 0, duckduckgo: 0, none: 0 },
  providerErrors:    { brave: 0, serpapi: 0, serper: 0, tavily: 0, duckduckgo: 0 },
  totalLatencyMs:    0,
  lastUsedProvider:  null,
  lastSearchAt:      null,
});

// 시작 시 저장된 KPI 복원
function _loadStats() {
  try {
    if (fs.existsSync(_KPI_FILE)) {
      const saved = JSON.parse(fs.readFileSync(_KPI_FILE, 'utf8'));
      return Object.assign(_statsDefaults(), saved);
    }
  } catch (_) {}
  return _statsDefaults();
}

// KPI 저장 (비동기 write)
function _saveStats() {
  try {
    const dir = path.dirname(_KPI_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_KPI_FILE, JSON.stringify(_stats), 'utf8');
  } catch (_) {}
}

const _stats = _loadStats();

// 5분마다 자동 저장
setInterval(_saveStats, 5 * 60 * 1000).unref();

// ── 내부 헬퍼: 타임아웃 fetch ───────────────────────────────────────────────
// 기본 타임아웃 4초로 단축 (병렬 경쟁 방식에서는 빠른 실패가 중요)
async function _fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider 1: Brave Search ────────────────────────────────────────────────
async function _searchBrave(query, maxResults) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;

  try {
    // [FIX #17] search_lang=ko&country=KR 제거 → 한국어 쿼리 결과 0건 방지
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 5)}&text_decorations=0`;
    const res = await _fetchWithTimeout(url, {
      headers: {
        'Accept':             'application/json',
        'Accept-Encoding':    'gzip',
        'X-Subscription-Token': key,
      },
    }, 4000);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[SearchEngine:Brave] HTTP ${res.status}: ${errText.slice(0, 100)}`);
      return null;
    }

    const data = await res.json();
    const webResults = (data.web?.results || []).slice(0, maxResults);
    const infobox    = data.infobox?.results?.[0];
    const news       = (data.news?.results  || []).slice(0, 2);

    if (webResults.length === 0 && !infobox) return null;

    const parts = [];

    // 인포박스 (즉답)
    if (infobox) {
      parts.push(`✅ **${infobox.title || ''}** — ${(infobox.description || '').slice(0, 300)}`);
    }

    // 뉴스
    for (const n of news) {
      parts.push(`📰 **${n.title}**\n  ${(n.description || '').slice(0, 150)}\n  🔗 ${n.url}`);
    }

    // 웹 결과
    for (const r of webResults) {
      const desc = (r.description || r.extra_snippets?.[0] || '').slice(0, 250);
      parts.push(`• **${r.title}**\n  ${desc}\n  🔗 ${r.url}`);
    }

    if (parts.length === 0) return null;
    console.log(`[SearchEngine:Brave] ✅ ${webResults.length}건 반환`);
    return { text: parts.join('\n\n'), provider: 'brave', resultCount: webResults.length };
  } catch (err) {
    console.warn(`[SearchEngine:Brave] 실패: ${err.message}`);
    _stats.providerErrors.brave++;
    return null;
  }
}

// ── Provider 2: SerpAPI (Google) ────────────────────────────────────────────
async function _searchSerpApi(query, maxResults) {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return null;

  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&hl=ko&gl=kr&num=${maxResults}&api_key=${encodeURIComponent(key)}`;
    const res = await _fetchWithTimeout(url, {}, 4000);

    if (!res.ok) {
      console.warn(`[SearchEngine:SerpAPI] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.error) {
      console.warn(`[SearchEngine:SerpAPI] API error: ${data.error}`);
      return null;
    }

    const organic    = (data.organic_results    || []).slice(0, maxResults);
    const answerBox  = data.answer_box;
    const knowledgeGraph = data.knowledge_graph;
    const news       = (data.news_results       || []).slice(0, 2);

    if (organic.length === 0 && !answerBox && !knowledgeGraph) return null;

    const parts = [];

    // 즉답
    if (answerBox) {
      if (answerBox.answer)  parts.push(`✅ ${answerBox.answer}`);
      if (answerBox.snippet) parts.push(`📌 ${answerBox.snippet.slice(0, 300)}`);
    }
    if (knowledgeGraph?.description) {
      parts.push(`📖 **${knowledgeGraph.title || ''}** — ${knowledgeGraph.description.slice(0, 300)}`);
    }

    // 뉴스
    for (const n of news) {
      parts.push(`📰 **${n.title}**\n  ${(n.snippet || '').slice(0, 150)}\n  🔗 ${n.link}`);
    }

    // 유기 결과
    for (const r of organic) {
      const snippet = (r.snippet || r.rich_snippet?.top?.extensions?.join(' ') || '').slice(0, 250);
      parts.push(`• **${r.title}**\n  ${snippet}\n  🔗 ${r.link}`);
    }

    if (parts.length === 0) return null;
    console.log(`[SearchEngine:SerpAPI] ✅ ${organic.length}건 반환`);
    return { text: parts.join('\n\n'), provider: 'serpapi', resultCount: organic.length };
  } catch (err) {
    console.warn(`[SearchEngine:SerpAPI] 실패: ${err.message}`);
    _stats.providerErrors.serpapi++;
    return null;
  }
}

// ── Provider 3: Serper.dev (Google) ────────────────────────────────────────
async function _searchSerper(query, maxResults) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  try {
    const res = await _fetchWithTimeout('https://google.serper.dev/search', {
      method:  'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: query, gl: 'kr', hl: 'ko', num: maxResults }),
    }, 4000);

    if (!res.ok) {
      console.warn(`[SearchEngine:Serper] HTTP ${res.status}`);
      return null;
    }

    const data    = await res.json();
    const organic = (data.organic   || []).slice(0, maxResults);
    const box     = data.answerBox;
    const news    = (data.news      || []).slice(0, 2);

    if (organic.length === 0 && !box) return null;

    const parts = [];
    if (box?.answer)  parts.push(`✅ ${box.answer}`);
    if (box?.snippet) parts.push(`📌 ${box.snippet.slice(0, 300)}`);

    for (const n of news) {
      parts.push(`📰 **${n.title}**\n  ${(n.snippet || '').slice(0, 150)}\n  🔗 ${n.link}`);
    }

    for (const r of organic) {
      parts.push(`• **${r.title}**\n  ${(r.snippet || '').slice(0, 200)}\n  🔗 ${r.link}`);
    }

    if (parts.length === 0) return null;
    console.log(`[SearchEngine:Serper] ✅ ${organic.length}건 반환`);
    return { text: parts.join('\n\n'), provider: 'serper', resultCount: organic.length };
  } catch (err) {
    console.warn(`[SearchEngine:Serper] 실패: ${err.message}`);
    _stats.providerErrors.serper++;
    return null;
  }
}

// ── Provider 4: Tavily ──────────────────────────────────────────────────────
async function _searchTavily(query, maxResults) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;

  try {
    const res = await _fetchWithTimeout('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        api_key:              key,
        query,
        search_depth:         'basic',
        include_answer:       true,
        include_raw_content:  false,
        max_results:          maxResults,
      }),
    }, 4000);

    if (!res.ok) return null;

    const data    = await res.json();
    const results = (data.results || []).slice(0, maxResults);
    const parts   = [];

    if (data.answer)  parts.push(`✅ ${data.answer}`);
    for (const r of results) {
      const snippet = (r.content || r.snippet || '').slice(0, 250);
      parts.push(`• **${r.title}**\n  ${snippet}\n  🔗 ${r.url}`);
    }

    if (parts.length === 0) return null;
    console.log(`[SearchEngine:Tavily] ✅ ${results.length}건 반환`);
    return { text: parts.join('\n\n'), provider: 'tavily', resultCount: results.length };
  } catch (err) {
    console.warn(`[SearchEngine:Tavily] 실패: ${err.message}`);
    _stats.providerErrors.tavily++;
    return null;
  }
}

// ── Provider 5: DuckDuckGo Instant Answer (무료 폴백) ───────────────────────
async function _searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await _fetchWithTimeout(url, {}, 4000);
    if (!res.ok) return null;

    const data    = await res.json();
    const parts   = [];
    if (data.AbstractText)  parts.push(`📌 ${data.AbstractText.slice(0, 400)}`);
    if (data.Answer)        parts.push(`✅ ${data.Answer}`);
    const topics = (data.RelatedTopics || []).slice(0, 3);
    for (const t of topics) {
      if (t.Text) parts.push(`• ${t.Text.slice(0, 200)}`);
    }

    if (parts.length === 0) return null;
    console.log(`[SearchEngine:DuckDuckGo] ✅ ${parts.length}건 반환`);
    return { text: parts.join('\n'), provider: 'duckduckgo', resultCount: parts.length };
  } catch (err) {
    console.warn(`[SearchEngine:DuckDuckGo] 실패: ${err.message}`);
    _stats.providerErrors.duckduckgo++;
    return null;
  }
}

// ── 메인 search 함수 ────────────────────────────────────────────────────────
/**
 * search — 병렬 경쟁(Promise.race) 웹 검색
 *
 * 변경: 순차 폴백 → 병렬 경쟁
 * - API 키가 있는 provider들을 동시에 호출
 * - 가장 먼저 성공한 결과를 반환 (나머지는 자동 중단)
 * - API 키가 없는 provider는 즉시 null 반환 → 레이스에서 제외
 * - 전체 타임아웃 5초 → 초과 시 DuckDuckGo 폴백
 *
 * @param {string} query        — 검색어
 * @param {object} [options]
 * @param {number} [options.maxResults=5]           — 최대 결과 수 (1-10)
 * @param {string} [options.preferredProvider]      — 'brave'|'serpapi'|'serper'|'tavily' (힌트만, 병렬실행)
 * @param {boolean} [options.skipDuckDuckGo=false]  — DDG 폴백 건너뜀
 * @returns {Promise<string|null>}
 */
async function search(query, options = {}) {
  if (!query || typeof query !== 'string') return null;

  const maxResults = Math.min(Math.max(options.maxResults || 5, 1), 10);
  const startTime  = Date.now();
  _stats.totalSearches++;
  _stats.lastSearchAt = new Date().toISOString();

  // 활성 provider만 수집 (API 키 없는 것은 즉시 null → 레이스 제외)
  const apiProviders = [
    _searchBrave,
    _searchSerpApi,
    _searchSerper,
    _searchTavily,
  ];

  // 병렬 경쟁: 모두 동시에 실행, 가장 빠른 성공 결과 사용
  // Promise.race 대신 직접 구현 → 첫 성공 결과 반환, null은 무시
  let result = null;
  if (apiProviders.length > 0) {
    result = await new Promise((resolve) => {
      let settled    = false;
      let remaining  = apiProviders.length;

      // 전체 레이스 타임아웃 5초
      const raceTimer = setTimeout(() => {
        if (!settled) { settled = true; resolve(null); }
      }, 5000);

      for (const providerFn of apiProviders) {
        providerFn(query, maxResults)
          .then((res) => {
            remaining--;
            if (res && !settled) {
              settled = true;
              clearTimeout(raceTimer);
              resolve(res);   // 첫 성공 반환
            } else if (remaining === 0 && !settled) {
              settled = true;
              clearTimeout(raceTimer);
              resolve(null);  // 모두 실패
            }
          })
          .catch(() => {
            remaining--;
            if (remaining === 0 && !settled) {
              settled = true;
              clearTimeout(raceTimer);
              resolve(null);
            }
          });
      }
    });
  }

  if (result) {
    _stats.successCount++;
    _stats.providerCounts[result.provider] = (_stats.providerCounts[result.provider] || 0) + 1;
    _stats.lastUsedProvider = result.provider;
    _stats.totalLatencyMs  += (Date.now() - startTime);
    console.log(`[SearchEngine] ✅ ${result.provider} 승리 (${Date.now() - startTime}ms)`);
    return `[웹 검색: "${query}"] (${result.provider})\n${result.text}`;
  }

  // DuckDuckGo 폴백 (무료, API 키 불필요)
  if (!options.skipDuckDuckGo) {
    const ddg = await _searchDuckDuckGo(query);
    if (ddg) {
      _stats.successCount++;
      _stats.providerCounts.duckduckgo++;
      _stats.lastUsedProvider = 'duckduckgo';
      _stats.totalLatencyMs  += (Date.now() - startTime);
      return `[웹 검색: "${query}"] (duckduckgo)\n${ddg.text}`;
    }
  }

  _stats.failureCount++;
  _stats.providerCounts.none++;
  _stats.totalLatencyMs += (Date.now() - startTime);
  console.warn(`[SearchEngine] 모든 프로바이더 실패 (${Date.now() - startTime}ms): "${query.slice(0, 60)}"`);
  return null;
}

// ── 활성 공급자 감지 ──────────────────────────────────────────────────────
function getActiveProviders() {
  const providers = [];
  if (process.env.BRAVE_SEARCH_API_KEY) providers.push('brave');
  if (process.env.SERPAPI_API_KEY)      providers.push('serpapi');
  if (process.env.SERPER_API_KEY)       providers.push('serper');
  if (process.env.TAVILY_API_KEY)       providers.push('tavily');
  providers.push('duckduckgo'); // 항상 사용 가능
  return providers;
}

// ── KPI ────────────────────────────────────────────────────────────────────
function getKPI() {
  const total    = _stats.totalSearches;
  const avgMs    = total > 0 ? Math.round(_stats.totalLatencyMs / total) : 0;
  const successRate = total > 0
    ? ((_stats.successCount / total) * 100).toFixed(1) + '%'
    : '0%';

  return {
    total_searches:      total,
    success_count:       _stats.successCount,
    failure_count:       _stats.failureCount,
    success_rate:        successRate,
    avg_latency_ms:      avgMs,
    provider_counts:     { ..._stats.providerCounts },
    provider_errors:     { ..._stats.providerErrors },
    last_used_provider:  _stats.lastUsedProvider,
    last_search_at:      _stats.lastSearchAt,
    active_providers:    getActiveProviders(),
  };
}

// ── 단독 테스트용 ──────────────────────────────────────────────────────────
async function testProviders(query = '오늘 날씨 서울') {
  console.log('\n[SearchEngine] 프로바이더 테스트 시작...\n');
  const results = {};

  const tests = [
    { name: 'Brave',     fn: () => _searchBrave(query, 3) },
    { name: 'SerpAPI',   fn: () => _searchSerpApi(query, 3) },
    { name: 'Serper',    fn: () => _searchSerper(query, 3) },
    { name: 'Tavily',    fn: () => _searchTavily(query, 3) },
    { name: 'DuckDuckGo',fn: () => _searchDuckDuckGo(query) },
  ];

  for (const t of tests) {
    const start = Date.now();
    try {
      const r = await t.fn();
      results[t.name] = {
        ok:      !!r,
        latency: Date.now() - start,
        preview: r ? r.text.slice(0, 80) : null,
      };
    } catch (e) {
      results[t.name] = { ok: false, error: e.message };
    }
    console.log(`  ${t.name}: ${results[t.name].ok ? '✅' : '❌'} (${results[t.name].latency || 0}ms)`);
  }

  return results;
}

// ── .env 주입 유틸 (테스트 환경용) ──────────────────────────────────────────
function setKeys({ braveKey, serpapiKey, serperKey, tavilyKey } = {}) {
  if (braveKey)   process.env.BRAVE_SEARCH_API_KEY = braveKey;
  if (serpapiKey) process.env.SERPAPI_API_KEY       = serpapiKey;
  if (serperKey)  process.env.SERPER_API_KEY         = serperKey;
  if (tavilyKey)  process.env.TAVILY_API_KEY         = tavilyKey;
}

module.exports = {
  search,
  getKPI,
  getActiveProviders,
  testProviders,
  setKeys,
  // 내부 provider 직접 접근 (테스트용)
  _searchBrave,
  _searchSerpApi,
  _searchSerper,
  _searchTavily,
  _searchDuckDuckGo,
};
