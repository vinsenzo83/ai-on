'use strict';
/**
 * crawlerPipeline.js — Phase 1
 * 웹 크롤링 & 스크래핑 파이프라인 (51건 커버)
 *
 * 실제 Puppeteer 호출 제외 — URL 파싱/정제/스케줄/결과구조 완비
 * 실제 연동 시 callPuppeteer() stub만 교체
 */

const { URL } = require('url');

// ── 도메인별 크롤 전략 ────────────────────────────────────
const CRAWL_STRATEGIES = {
  product_page: {
    name:        '상품 페이지 스크래핑',
    selectors:   { title: 'h1, .product-title', price: '.price, [class*="price"]', images: 'img[src*="product"]', description: '.description, #description', specs: 'table, .specs' },
    waitFor:     'networkidle2',
    scrollToBottom: true,
    extractImages:  true,
    targetDomains:  ['taobao.com', 'alibaba.com', 'amazon.com', 'coupang.com', 'gmarket.co.kr'],
  },
  price_compare: {
    name:        '가격 비교 크롤링',
    selectors:   { price: '[class*="price"], [id*="price"]', seller: '[class*="seller"], [class*="shop"]', rating: '[class*="rating"], [class*="star"]' },
    waitFor:     'domcontentloaded',
    scrollToBottom: false,
    extractImages:  false,
    targetDomains:  ['danawa.com', 'enuri.com', 'naver.com/shopping'],
  },
  company_research: {
    name:        '기업 정보 수집',
    selectors:   { name: 'h1, .company-name', description: '.about, #about, .company-desc', employees: '[class*="employee"], [class*="size"]', founded: '[class*="founded"], [class*="year"]' },
    waitFor:     'networkidle2',
    scrollToBottom: false,
    extractImages:  false,
    targetDomains:  ['linkedin.com', 'crunchbase.com', 'wanted.co.kr'],
  },
  news_feed: {
    name:        '뉴스/블로그 피드',
    selectors:   { articles: 'article, .post, .news-item', title: 'h2, h3', date: 'time, .date', body: 'p, .content' },
    waitFor:     'domcontentloaded',
    scrollToBottom: true,
    extractImages:  false,
    targetDomains:  [],
  },
  sns_profile: {
    name:        'SNS 프로필/포스트',
    selectors:   { followers: '[class*="follower"]', posts: '[class*="post"], article', bio: '[class*="bio"], [class*="description"]' },
    waitFor:     'networkidle2',
    scrollToBottom: true,
    extractImages:  true,
    targetDomains:  [],
    requiresAuth:   true,
    note:           'SNS는 로그인 세션 쿠키 주입 필요',
  },
  real_estate: {
    name:        '부동산 매물 스크래핑',
    selectors:   { price: '[class*="price"]', area: '[class*="area"], [class*="size"]', address: '[class*="address"], [class*="location"]', description: '.detail, .info' },
    waitFor:     'networkidle2',
    scrollToBottom: false,
    extractImages:  true,
    targetDomains:  ['zigbang.com', 'dabang.com', 'naver.com/realestate'],
  },
  finance_data: {
    name:        '금융 데이터 스크래핑',
    selectors:   { price: '[class*="price"], [class*="close"]', change: '[class*="change"], [class*="diff"]', volume: '[class*="volume"]' },
    waitFor:     'networkidle2',
    scrollToBottom: false,
    extractImages:  false,
    targetDomains:  ['finance.yahoo.com', 'investing.com', 'kisline.com'],
  },
};

// ── 크롤 스케줄 타입 ──────────────────────────────────────
const SCHEDULE_TYPES = {
  once:     { label: '단발', cron: null,          desc: '1회 즉시 실행' },
  hourly:   { label: '시간별', cron: '0 * * * *', desc: '매 시 정각' },
  daily:    { label: '일별',  cron: '0 9 * * *',  desc: '매일 오전 9시' },
  weekly:   { label: '주별',  cron: '0 9 * * 1',  desc: '매주 월요일 9시' },
  realtime: { label: '실시간', cron: '*/5 * * * *',desc: '5분 간격' },
};

// ─────────────────────────────────────────────────────────
// URL 파싱 & 정제
// ─────────────────────────────────────────────────────────
function parseUrl(rawUrl = '') {
  try {
    const u   = new URL(rawUrl.trim());
    const ext = u.pathname.split('.').pop()?.toLowerCase();
    const isFile = ['pdf','doc','xls','zip','png','jpg'].includes(ext);
    return {
      valid:    true,
      url:      u.href,
      domain:   u.hostname,
      path:     u.pathname,
      params:   Object.fromEntries(u.searchParams),
      isFile,
      protocol: u.protocol,
    };
  } catch {
    return { valid: false, url: rawUrl, error: '유효하지 않은 URL 형식' };
  }
}

// 도메인 기반 전략 자동 추천
function recommendStrategy(domain = '') {
  const lower = domain.toLowerCase();
  for (const [key, strat] of Object.entries(CRAWL_STRATEGIES)) {
    if ((strat.targetDomains || []).some(d => lower.includes(d))) {
      return { key, strategy: strat, autoDetected: true };
    }
  }
  return { key: 'news_feed', strategy: CRAWL_STRATEGIES.news_feed, autoDetected: false, note: '자동 감지 실패 — 기본 전략 사용' };
}

// ─────────────────────────────────────────────────────────
// 결과 정제 (스크래핑된 원시 HTML → 구조화)
// ─────────────────────────────────────────────────────────
function cleanHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function structureResult(rawData = {}, strategy = 'product_page') {
  const strat = CRAWL_STRATEGIES[strategy] || CRAWL_STRATEGIES.news_feed;
  const structured = { strategy, extractedAt: new Date().toISOString() };
  for (const [field, _sel] of Object.entries(strat.selectors || {})) {
    structured[field] = rawData[field] ? cleanHtml(String(rawData[field])) : null;
  }
  structured.images     = rawData.images   || [];
  structured.links      = rawData.links    || [];
  structured.rawTextLen = (rawData.rawText || '').length;
  return structured;
}

// ─────────────────────────────────────────────────────────
// 배치 URL 목록 생성
// ─────────────────────────────────────────────────────────
function buildUrlList(seeds = [], opts = {}) {
  const { maxDepth = 1, maxPerDomain = 10, filterPattern = null } = opts;
  return seeds
    .map(u => parseUrl(u))
    .filter(u => u.valid)
    .filter(u => !filterPattern || new RegExp(filterPattern).test(u.url))
    .slice(0, maxPerDomain)
    .map(u => ({ ...u, depth: 0, maxDepth, scheduled: false }));
}

// ─────────────────────────────────────────────────────────
// Puppeteer stub
// ─────────────────────────────────────────────────────────
async function callPuppeteer(url, strategyKey, _opts) {
  // 실제 연동 시 교체:
  // const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  // const page = await browser.newPage();
  // await page.goto(url, { waitUntil: strat.waitFor });
  // if (strat.scrollToBottom) await autoScroll(page);
  // const data = await page.evaluate(selectors => { ... }, strat.selectors);
  // await browser.close();
  // return data;
  const strat = CRAWL_STRATEGIES[strategyKey] || CRAWL_STRATEGIES.news_feed;
  const stubData = {};
  for (const field of Object.keys(strat.selectors || {})) {
    stubData[field] = `[stub] ${field} extracted from ${url}`;
  }
  return {
    stub:       true,
    url,
    strategy:   strategyKey,
    rawData:    stubData,
    images:     [`https://stub.img/1.jpg`, `https://stub.img/2.jpg`],
    links:      [`${url}/page/2`, `${url}/category`],
    rawText:    `[stub] 크롤링 결과 텍스트 — Puppeteer 설치 후 활성화 (url: ${url})`,
    statusCode: 200,
    crawledAt:  new Date().toISOString(),
    message:    'Puppeteer stub — npm install puppeteer 후 실제 크롤링 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 파이프라인 실행 (단일 URL)
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    url          = '',
    strategy     = 'auto',
    schedule     = 'once',
    outputFormat = 'json',   // json | csv | html
    maxRetries   = 2,
  } = opts;

  const startMs = Date.now();

  // 1. URL 파싱
  const parsed = parseUrl(url);
  if (!parsed.valid) return { success: false, error: parsed.error, url };

  // 2. 전략 결정
  const stratKey  = strategy === 'auto' ? recommendStrategy(parsed.domain).key : strategy;
  const stratInfo = CRAWL_STRATEGIES[stratKey] || CRAWL_STRATEGIES.news_feed;

  // 3. 크롤 실행
  let lastError = null;
  let rawResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      rawResult = await callPuppeteer(url, stratKey, opts);
      break;
    } catch (e) {
      lastError = e.message;
      if (attempt === maxRetries) return { success: false, error: lastError, url, attempts: attempt };
    }
  }

  // 4. 데이터 구조화
  const structured = structureResult(rawResult.rawData || {}, stratKey);

  // 5. 출력 포맷
  let output;
  if (outputFormat === 'csv') {
    const rows = Object.entries(structured).map(([k, v]) => `"${k}","${String(v).replace(/"/g, '""')}"`);
    output = ['field,value', ...rows].join('\n');
  } else if (outputFormat === 'html') {
    const rows = Object.entries(structured).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`);
    output = `<table border="1">${rows.join('')}</table>`;
  } else {
    output = structured;
  }

  return {
    success:     true,
    pipeline:    'crawler',
    url,
    parsed,
    strategy:    { key: stratKey, name: stratInfo.name },
    schedule:    SCHEDULE_TYPES[schedule],
    rawCrawl:    rawResult,
    structured,
    output,
    outputFormat,
    durationMs:  Date.now() - startMs,
    readyToUse:  !rawResult.stub,
    meta: { strategies: Object.keys(CRAWL_STRATEGIES), schedules: Object.keys(SCHEDULE_TYPES) },
  };
}

// 배치 실행
async function executeBatch(urls = [], sharedOpts = {}) {
  const results = [];
  for (const url of urls) {
    const r = await execute({ ...sharedOpts, url });
    results.push(r);
  }
  return {
    total: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}

module.exports = {
  execute,
  executeBatch,
  parseUrl,
  recommendStrategy,
  structureResult,
  buildUrlList,
  CRAWL_STRATEGIES,
  SCHEDULE_TYPES,
};
