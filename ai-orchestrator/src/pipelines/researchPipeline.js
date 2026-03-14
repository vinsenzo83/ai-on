'use strict';
/**
 * researchPipeline.js  v3.1 — 멀티모델 오케스트레이션
 *
 * 흐름:
 *   1. 검색팀  — Brave + Tavily + SerpAPI 병렬 deepSearch
 *   2. 크롤팀  — 상위 5개 URL Tavily Extract 병렬 크롤
 *   3. 분석팀  — 슬라이드 섹션별 전문 모델 병렬 호출
 *        ├── Claude Sonnet  → 산업/경쟁/전략 깊은 분석 (3섹션)
 *        ├── GPT-4o         → 재무/수치/차트 데이터 구조화 (3섹션)
 *        └── GPT-4o-mini    → 리스크/전망/결론 빠른 처리 (4섹션)
 *   4. 병합    — 10개 섹션 통합 + 메타데이터
 */

const { searchEngine } = require('../agent');

// ── 헬퍼: timeout fetch ──────────────────────────────────────
function fetchWithTimeout(url, opts, ms = 12000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// ── 1. 검색팀 ─────────────────────────────────────────────────
async function runSearchTeam(topic) {
  console.log('[researchPipeline] 🔍 검색팀 시작...');
  try {
    const result = await searchEngine.deepSearch(topic, { maxResults: 15, multiQuery: true });
    console.log('[researchPipeline] 🔍 검색팀 완료');
    return String(result || '');
  } catch (e) {
    console.warn('[researchPipeline] 검색팀 실패:', e.message);
    try { return String(await searchEngine.search(topic, { maxResults: 8 }) || ''); }
    catch { return ''; }
  }
}

// ── 2. 크롤팀 ─────────────────────────────────────────────────
// HTML에서 본문 텍스트만 추출 (노이즈 제거 강화)
function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(Skip to|Jump to|Back to top|Cookie|Privacy Policy|Terms of Service).{0,80}/gi, '')
    .trim()
    .slice(0, 3000);
}

// 단일 URL 크롤 — Tavily 우선, 실패 시 직접 fetch (각각 독립 타임아웃)
async function crawlOne(url, tavilyKey) {
  // Tavily Extract (빠름, 8초 타임아웃으로 단축)
  if (tavilyKey) {
    try {
      const res = await fetchWithTimeout('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, urls: [url] }),
      }, 8000);
      const data = await res.json();
      const content = data?.results?.[0]?.raw_content || data?.results?.[0]?.content;
      if (content && content.length > 100) {
        return cleanHtml(content).slice(0, 3000);
      }
    } catch {}
  }
  // 직접 fetch 폴백 (5초 타임아웃)
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)' },
    }, 5000);
    const html = await res.text();
    return cleanHtml(html);
  } catch { return ''; }
}

async function runCrawlTeam(searchText, topic) {
  console.log('[researchPipeline] 🕷 크롤팀 시작...');
  const tavilyKey = process.env.TAVILY_API_KEY;
  const urlRegex = /https?:\/\/[^\s"'<>)]+/g;

  // 노이즈 도메인 필터링 확대
  const SKIP_DOMAINS = ['google.com','facebook.com','twitter.com','instagram.com',
    'youtube.com','tiktok.com','linkedin.com','amazon.com','apple.com/kr'];

  const urls = [...new Set((searchText.match(urlRegex) || [])
    .filter(u => !SKIP_DOMAINS.some(d => u.includes(d)))
    .filter(u => u.length < 200)
    .slice(0, 5))];

  if (!urls.length) {
    console.log('[researchPipeline] 🕷 크롤팀: URL 없음, 스킵');
    return '';
  }

  console.log(`[researchPipeline] 🕷 크롤 대상: ${urls.length}개 URL`);

  // 전체 크롤 최대 15초 타임아웃 (병렬)
  const crawlPromise = Promise.allSettled(urls.map(u => crawlOne(u, tavilyKey)));
  const timeoutPromise = new Promise(r => setTimeout(() => r([]), 15000));
  const results = await Promise.race([crawlPromise, timeoutPromise]);

  const crawled = (Array.isArray(results) ? results : [])
    .filter(r => r?.status === 'fulfilled' && r.value && r.value.length > 50)
    .map((r, i) => `[출처${i+1}]\n${r.value}`)
    .join('\n\n');

  console.log(`[researchPipeline] 🕷 크롤팀 완료: ${urls.length}개 URL`);
  return crawled;
}

// ── 3. 분석팀 ─────────────────────────────────────────────────
function makeOpenAI() {
  const OpenAI = require('openai');
  // 시스템 환경변수에 genspark proxy가 주입되어 있을 수 있으므로
  // REAL_OPENAI_API_KEY가 있으면 항상 공식 OpenAI endpoint로 직접 연결
  const apiKey = process.env.REAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const rawBase = process.env.OPENAI_BASE_URL || '';
  // genspark proxy 또는 빈 문자열이면 공식 endpoint 사용
  const baseURL = (rawBase && rawBase.startsWith('http') && !rawBase.includes('genspark'))
    ? rawBase
    : 'https://api.openai.com/v1';
  return new OpenAI({ apiKey, baseURL, timeout: 55000, maxRetries: 0 });
}

function makeAnthropic() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 55000, maxRetries: 0 });
}

// Claude Sonnet — 산업/경쟁/전략 깊은 분석
async function analyzeWithClaude(topic, context) {
  console.log('[researchPipeline] 🧠 Claude 분석팀 시작...');
  try {
    const anthropic = makeAnthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `당신은 세계 최고의 산업 애널리스트입니다.
아래 데이터를 바탕으로 "${topic}"에 대해 다음 3개 섹션을 깊이 있게 분석하세요.

반드시 JSON 배열로만 응답 (마크다운 코드블록 없이 순수 JSON만):
[
  {
    "type": "comparison",
    "tag": "경쟁 분석",
    "title": "${topic} 경쟁사 비교 분석",
    "leftCol": {
      "title": "${topic} 강점",
      "icon": "🔵",
      "color": "#4cc9f0",
      "points": ["구체적 강점1 (수치 포함)", "구체적 강점2", "구체적 강점3", "구체적 강점4", "구체적 강점5"]
    },
    "rightCol": {
      "title": "주요 경쟁사/리스크",
      "icon": "🔴",
      "color": "#e94560",
      "points": ["구체적 경쟁사 위협1", "위협2", "위협3", "위협4", "위협5"]
    }
  },
  {
    "type": "bullets",
    "tag": "산업 분석",
    "title": "산업 트렌드 & 핵심 인사이트",
    "content": "산업 현황 요약 (2문장)",
    "bullets": ["인사이트1 (구체적 수치 포함)", "인사이트2", "인사이트3", "인사이트4", "인사이트5"],
    "highlight": "핵심 시사점 한 줄",
    "stat": { "value": "핵심수치", "label": "지표명", "trend": "up" }
  },
  {
    "type": "outlook",
    "tag": "전략 전망",
    "title": "2026년 핵심 전략 방향",
    "items": [
      { "icon": "🚀", "title": "전략1", "desc": "구체적 설명 (수치/목표 포함)" },
      { "icon": "💡", "title": "전략2", "desc": "구체적 설명" },
      { "icon": "🎯", "title": "전략3", "desc": "구체적 설명" },
      { "icon": "⚡", "title": "전략4", "desc": "구체적 설명" },
      { "icon": "🌐", "title": "전략5", "desc": "구체적 설명" },
      { "icon": "💰", "title": "전략6", "desc": "구체적 설명" }
    ],
    "target": { "label": "핵심 목표", "value": "목표수치", "sub": "부연설명" }
  }
]

분석 데이터:
${context.slice(0, 6000)}`
      }],
    });
    const text = msg.content[0].text.trim();
    // 마크다운 코드블록 제거
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    console.log('[researchPipeline] 🧠 Claude 분석팀 완료:', parsed.length, '섹션');
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.error('[researchPipeline] ❌ Claude 실패:', e.message, e.status || '');
    return null;
  }
}

// GPT-4o — 재무/수치/차트 구조화
// ⚠️ json_object 포맷은 배열 직접 반환 불가 → text 모드로 배열 요청
async function analyzeWithGPT4o(topic, context) {
  console.log('[researchPipeline] 📊 GPT-4o 재무팀 시작...');
  try {
    const openai = makeOpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: `당신은 세계 최고의 재무 애널리스트입니다. 반드시 JSON 배열로만 응답. 마크다운, 코드블록, 설명 텍스트 절대 금지. 첫 문자는 반드시 '['`
      }, {
        role: 'user',
        content: `"${topic}" 관련 데이터로 다음 3개 섹션을 구성하세요. 반드시 아래 형식 그대로, JSON 배열만 반환:

[
  {
    "type": "kpi",
    "tag": "핵심 지표",
    "title": "2025년 핵심 재무 지표",
    "kpis": [
      { "value": "실제수치", "label": "지표명", "sub": "전년比 변화율", "color": "#10b981" },
      { "value": "실제수치", "label": "지표명", "sub": "부연", "color": "#f59e0b" },
      { "value": "실제수치", "label": "지표명", "sub": "부연", "color": "#4cc9f0" },
      { "value": "실제수치", "label": "지표명", "sub": "부연", "color": "#e94560" }
    ]
  },
  {
    "type": "bar_chart",
    "tag": "실적 추이",
    "title": "분기별 실적 추이",
    "chartData": {
      "bars": [
        { "label": "24Q1", "value": 100, "color": "#4cc9f0", "highlight": false },
        { "label": "24Q2", "value": 120, "color": "#4cc9f0", "highlight": false },
        { "label": "24Q3", "value": 110, "color": "#4cc9f0", "highlight": false },
        { "label": "24Q4", "value": 130, "color": "#4cc9f0", "highlight": false },
        { "label": "25Q1", "value": 140, "color": "#7c3aed", "highlight": true },
        { "label": "25Q2", "value": 150, "color": "#7c3aed", "highlight": true },
        { "label": "25Q3", "value": 145, "color": "#7c3aed", "highlight": false },
        { "label": "25Q4", "value": 160, "color": "#7c3aed", "highlight": true }
      ],
      "unit": "억달러",
      "maxValue": 180,
      "note": "실제 데이터 기반 핵심 인사이트 한 줄"
    }
  },
  {
    "type": "donut_chart",
    "tag": "사업 구조",
    "title": "사업 부문별 매출 구성",
    "chartData": {
      "segments": [
        { "label": "부문1", "value": 40, "pct": 40, "color": "#4cc9f0" },
        { "label": "부문2", "value": 30, "pct": 30, "color": "#7c3aed" },
        { "label": "부문3", "value": 20, "pct": 20, "color": "#f59e0b" },
        { "label": "기타", "value": 10, "pct": 10, "color": "#e94560" }
      ],
      "centerLabel": "총 매출",
      "centerValue": "실제수치"
    }
  }
]

실제 데이터로 수치를 채워서 반환하세요. 데이터: ${context.slice(0, 5000)}`
      }],
      temperature: 0.1,
      max_tokens: 3000,
      // json_object 대신 text 사용 (배열 직접 반환 위해)
    });

    const raw = resp.choices[0].message.content.trim();
    // 마크다운 코드블록 제거
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    let parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    if (!Array.isArray(parsed)) {
      parsed = parsed.sections || parsed.slides || Object.values(parsed).find(Array.isArray) || [];
    }
    console.log('[researchPipeline] 📊 GPT-4o 재무팀 완료:', parsed.length, '섹션');
    return parsed;
  } catch (e) {
    console.error('[researchPipeline] ❌ GPT-4o 실패:', e.message, e.status || '');
    return null;
  }
}

// GPT-4o-mini — 리스크/결론/커버 메타
async function analyzeWithMini(topic, context) {
  console.log('[researchPipeline] ⚡ GPT-4o-mini 리스크팀 시작...');
  try {
    const openai = makeOpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `반드시 JSON 객체로만 응답. 마크다운, 코드블록 절대 금지. 첫 문자는 반드시 '{'`
      }, {
        role: 'user',
        content: `"${topic}" 데이터로 아래 JSON을 완성하세요 (실제 데이터 기반):
{
  "meta": {
    "title": "${topic} 심층 분석 리포트",
    "subtitle": "2025-2026 전략 및 투자 인사이트",
    "keyMessage": "핵심 메시지 한 문장 (구체적 수치 포함)",
    "conclusion": "결론 한 문장",
    "dataSource": "Brave Search · Tavily · Web Research"
  },
  "sections": [
    {
      "type": "timeline",
      "tag": "주요 이벤트",
      "title": "2025년 주요 이벤트 타임라인",
      "timeline": [
        { "year": "2025 Q1", "event": "구체적 이벤트 설명", "color": "#10b981" },
        { "year": "2025 Q2", "event": "구체적 이벤트 설명", "color": "#f59e0b" },
        { "year": "2025 Q3", "event": "구체적 이벤트 설명", "color": "#4cc9f0" },
        { "year": "2025 Q4", "event": "구체적 이벤트 설명", "color": "#e94560" },
        { "year": "2026 Q1", "event": "구체적 이벤트/전망", "color": "#7c3aed" },
        { "year": "2026 전망", "event": "핵심 전망 설명", "color": "#ff9f0a" }
      ]
    },
    {
      "type": "risk",
      "tag": "리스크 분석",
      "title": "주요 리스크 & 위협 요인",
      "risks": [
        { "icon": "⚠️", "title": "리스크1", "desc": "구체적 설명 (수치 포함)", "level": "high" },
        { "icon": "⚠️", "title": "리스크2", "desc": "구체적 설명", "level": "high" },
        { "icon": "⚡", "title": "리스크3", "desc": "구체적 설명", "level": "mid" },
        { "icon": "⚡", "title": "리스크4", "desc": "구체적 설명", "level": "mid" }
      ]
    },
    {
      "type": "conclusion",
      "tag": "투자 결론",
      "title": "종합 투자 의견",
      "message": "핵심 결론 2~3문장",
      "points": [
        "결론 포인트1 (구체적 수치 포함)",
        "결론 포인트2",
        "결론 포인트3",
        "결론 포인트4"
      ],
      "rating": "BUY",
      "tp": "목표주가"
    }
  ]
}

데이터: ${context.slice(0, 4000)}`
      }],
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0].message.content.trim();
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log('[researchPipeline] ⚡ GPT-4o-mini 리스크팀 완료');
    return parsed;
  } catch (e) {
    console.error('[researchPipeline] ❌ GPT-4o-mini 실패:', e.message, e.status || '');
    return null;
  }
}

// ── 4. 투자제안서 전용 분석 ─────────────────────────────────────

// GPT-4o — Pitch Deck 핵심 데이터 (시장규모 + 경쟁분석 + 재무계획)
async function analyzeWithGPT4oPitch(topic, context) {
  console.log('[researchPipeline] 📊 GPT-4o 피치덱팀 시작...');
  try {
    const openai = makeOpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: `당신은 세계 최고의 VC/스타트업 투자 전문가입니다. 반드시 JSON 배열로만 응답. 마크다운 코드블록 없이 순수 JSON 배열만. 첫 문자는 반드시 '['`
      }, {
        role: 'user',
        content: `"${topic}" AI 스타트업 투자 제안서용 데이터로 아래 5개 섹션을 구성하세요. 실제 시장 데이터와 수치를 사용하세요:

[
  {
    "type": "kpi",
    "tag": "시장 기회",
    "title": "글로벌 AI 시장 핵심 지표",
    "kpis": [
      { "value": "실제수치", "label": "TAM (전체시장)", "sub": "2025년 기준", "color": "#10b981" },
      { "value": "실제수치", "label": "SAM (유효시장)", "sub": "목표 세그먼트", "color": "#f59e0b" },
      { "value": "실제수치%", "label": "시장 CAGR", "sub": "연평균 성장률", "color": "#4cc9f0" },
      { "value": "실제수치", "label": "VC 투자 규모", "sub": "2025년 AI 투자", "color": "#e94560" }
    ]
  },
  {
    "type": "bar_chart",
    "tag": "시장 성장",
    "title": "글로벌 AI 시장 규모 추이 (단위: 십억달러)",
    "chartData": {
      "bars": [
        { "label": "2022", "value": 95, "color": "#4cc9f0", "highlight": false },
        { "label": "2023", "value": 142, "color": "#4cc9f0", "highlight": false },
        { "label": "2024", "value": 214, "color": "#4cc9f0", "highlight": false },
        { "label": "2025E", "value": 320, "color": "#7c3aed", "highlight": true },
        { "label": "2026E", "value": 480, "color": "#7c3aed", "highlight": true },
        { "label": "2027E", "value": 720, "color": "#7c3aed", "highlight": true },
        { "label": "2028E", "value": 1050, "color": "#ff9f0a", "highlight": true }
      ],
      "unit": "B$",
      "maxValue": 1100,
      "note": "실제 시장 데이터 기반 핵심 인사이트"
    }
  },
  {
    "type": "comparison",
    "tag": "경쟁 우위",
    "title": "경쟁사 대비 핵심 차별점",
    "leftCol": {
      "title": "우리 회사 강점",
      "icon": "🚀",
      "color": "#10b981",
      "points": ["독자 기술 강점1 (구체적 수치)", "차별화 포인트2", "비용 우위3", "팀 역량4", "특허/IP 보유5"]
    },
    "rightCol": {
      "title": "기존 경쟁사 한계",
      "icon": "⚠️",
      "color": "#e94560",
      "points": ["경쟁사 약점1 (구체적)", "기술 격차2", "비용 문제3", "시장 진입 장벽4", "확장성 한계5"]
    }
  },
  {
    "type": "outlook",
    "tag": "비즈니스 모델",
    "title": "수익 모델 & 성장 전략",
    "items": [
      { "icon": "💰", "title": "주 수익원 (SaaS)", "desc": "구독 기반 B2B 서비스, ARR 목표 및 단가" },
      { "icon": "🔗", "title": "API 라이선싱", "desc": "기업 고객 API 제공, 사용량 기반 과금" },
      { "icon": "🎯", "title": "초기 타깃 고객", "desc": "구체적 고객 세그먼트 및 규모" },
      { "icon": "📈", "title": "확장 로드맵", "desc": "국내 → 동남아 → 글로벌 단계적 확장" },
      { "icon": "🤝", "title": "전략적 파트너십", "desc": "대기업/플랫폼 파트너 확보 계획" },
      { "icon": "⚡", "title": "그로스 해킹", "desc": "바이럴 계수 및 CAC/LTV 목표" }
    ],
    "target": { "label": "3년 목표 ARR", "value": "$50M", "sub": "Series B 시점" }
  },
  {
    "type": "donut_chart",
    "tag": "자금 운용",
    "title": "투자금 사용 계획 ($10M 기준)",
    "chartData": {
      "segments": [
        { "label": "R&D / 기술개발", "value": 40, "pct": 40, "color": "#4cc9f0" },
        { "label": "영업 / 마케팅", "value": 30, "pct": 30, "color": "#7c3aed" },
        { "label": "인재 채용", "value": 20, "pct": 20, "color": "#f59e0b" },
        { "label": "운영 / 인프라", "value": 10, "pct": 10, "color": "#e94560" }
      ],
      "centerLabel": "투자 요청",
      "centerValue": "$10M"
    }
  }
]

실제 AI 스타트업 시장 데이터로 수치를 채워주세요. 데이터: ${context.slice(0, 5000)}`
      }],
      temperature: 0.1,
      max_tokens: 4000,
    });
    const raw = resp.choices[0].message.content.trim();
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    let parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    if (!Array.isArray(parsed)) {
      parsed = parsed.sections || parsed.slides || Object.values(parsed).find(Array.isArray) || [];
    }
    console.log('[researchPipeline] 📊 GPT-4o 피치덱팀 완료:', parsed.length, '섹션');
    return parsed;
  } catch (e) {
    console.error('[researchPipeline] ❌ GPT-4o Pitch 실패:', e.message);
    return null;
  }
}

// GPT-4o-mini — 투자 제안서 메타 + 팀/타임라인/요청
async function analyzeWithMiniPitch(topic, context) {
  console.log('[researchPipeline] ⚡ GPT-4o-mini 피치팀 시작...');
  try {
    const openai = makeOpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `반드시 JSON 객체로만 응답. 마크다운 코드블록 절대 금지. 첫 문자는 반드시 '{'`
      }, {
        role: 'user',
        content: `"${topic}" AI 스타트업 투자 제안서 Pitch Deck용 JSON을 완성하세요:
{
  "meta": {
    "title": "${topic} AI",
    "subtitle": "차세대 AI 플랫폼 투자 제안서",
    "keyMessage": "핵심 투자 포인트 한 문장 (수치 포함)",
    "conclusion": "투자자를 설득하는 결론 한 문장",
    "dataSource": "AI 시장 리서치 2025"
  },
  "sections": [
    {
      "type": "bullets",
      "tag": "문제 정의",
      "title": "우리가 해결하는 핵심 문제",
      "content": "현재 시장의 핵심 페인포인트 (2문장)",
      "bullets": [
        "문제1: 구체적 규모/수치 포함 (예: 국내 XX 기업의 YY%가 ZZ 문제 직면)",
        "문제2: 기존 솔루션의 한계",
        "문제3: 비용/시간 낭비 규모",
        "문제4: 미해결시 시장 기회 손실",
        "문제5: 우리가 해결할 수 있는 이유"
      ],
      "highlight": "이 문제의 시장 규모: 연간 $XXX billion",
      "stat": { "value": "$XXX B", "label": "해결 가능 시장", "trend": "up" }
    },
    {
      "type": "timeline",
      "tag": "실행 로드맵",
      "title": "제품 & 사업 로드맵",
      "timeline": [
        { "year": "2025 Q2", "event": "MVP 개발 완료, 파일럿 고객 5개사 확보", "color": "#10b981" },
        { "year": "2025 Q3", "event": "정식 출시, 유료 고객 20개사, ARR $500K 달성", "color": "#f59e0b" },
        { "year": "2025 Q4", "event": "Series A 클로징, 팀 30명 확장", "color": "#4cc9f0" },
        { "year": "2026 Q2", "event": "동남아 진출, ARR $5M 달성", "color": "#e94560" },
        { "year": "2026 Q4", "event": "기업가치 $100M, 유니콘 로드맵 진입", "color": "#7c3aed" },
        { "year": "2027", "event": "Series B, 글로벌 확장, ARR $50M", "color": "#ff9f0a" }
      ]
    },
    {
      "type": "conclusion",
      "tag": "투자 요청",
      "title": "Why Now? — 지금 투자해야 하는 이유",
      "message": "AI 시장이 폭발적으로 성장하는 지금이 최적의 투자 타이밍입니다.",
      "points": [
        "투자 포인트1: 구체적 수치와 근거",
        "투자 포인트2: 팀의 독보적 역량",
        "투자 포인트3: 기술적 해자 (moat)",
        "투자 포인트4: 예상 투자 회수 시나리오"
      ],
      "rating": "STRONG BUY",
      "tp": "Series A $10M"
    }
  ]
}

실제 AI 스타트업 투자 데이터 기반으로 작성하세요. 데이터: ${context.slice(0, 4000)}`
      }],
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    console.log('[researchPipeline] ⚡ GPT-4o-mini 피치팀 완료');
    return parsed;
  } catch (e) {
    console.error('[researchPipeline] ❌ Mini Pitch 실패:', e.message);
    return null;
  }
}

// 투자 제안서 병합
function mergePitchResults(pitchSections, miniResult, topic) {
  const meta = miniResult?.meta || {};
  const miniSections = miniResult?.sections || [];
  const sections = [];

  // GPT-4o Pitch: KPI → 바차트 → 비교 → 아웃룩 → 도넛 (5개)
  if (Array.isArray(pitchSections)) sections.push(...pitchSections.slice(0, 5));

  // Mini: 문제정의 → 로드맵 → 투자요청 (3개)
  if (Array.isArray(miniSections)) sections.push(...miniSections.slice(0, 3));

  // fallback
  const PITCH_FALLBACK = [
    { type:'bullets', tag:'솔루션', title:'우리의 솔루션', bullets:['AI 기반 핵심 기술','차별화된 접근법','확장 가능한 플랫폼'], highlight:'기술적 해자 보유' },
    { type:'bullets', tag:'팀 소개', title:'창업팀 역량', bullets:['CEO: AI/ML 전문가','CTO: 대형 플랫폼 출신','비즈니스: 대기업 BD 경험'], highlight:'' },
  ];
  let fi = 0;
  while (sections.length < 10) sections.push(PITCH_FALLBACK[fi++ % PITCH_FALLBACK.length]);

  return {
    title:      meta.title      || `${topic} AI`,
    subtitle:   meta.subtitle   || '투자 제안서 2025',
    keyMessage: meta.keyMessage || 'AI 시장의 폭발적 성장과 함께하는 투자 기회',
    conclusion: meta.conclusion || '',
    dataSource: meta.dataSource || 'AI Market Research 2025',
    sections:   sections.slice(0, 10),
  };
}

// ── 5. 병합 (일반 리서치) ───────────────────────────────────────
function mergeResults(gpt4oSections, claudeSections, miniResult) {
  const meta = miniResult?.meta || {};
  const miniSections = miniResult?.sections || [];

  const sections = [];

  // GPT-4o: KPI, 바차트, 도넛 (인덱스 0,1,2)
  if (Array.isArray(gpt4oSections) && gpt4oSections.length > 0) {
    sections.push(...gpt4oSections.slice(0, 3));
  }

  // Claude: 비교, 산업분석, 전략전망 (인덱스 0,1,2)
  if (Array.isArray(claudeSections) && claudeSections.length > 0) {
    sections.push(...claudeSections.slice(0, 3));
  }

  // GPT-4o-mini: 타임라인, 리스크, 결론
  if (Array.isArray(miniSections) && miniSections.length > 0) {
    sections.push(...miniSections.slice(0, 3));
  }

  // 10개로 맞추기 (부족한 경우 bullets로 채우기)
  const FALLBACK_SECTIONS = [
    { type:'bullets', tag:'핵심 인사이트', title:'시장 분석 요약', bullets:['AI 기반 실시간 데이터 분석 결과','검색 데이터 종합 인사이트','향후 시장 전망'], highlight:'종합 분석 중' },
    { type:'bullets', tag:'전략 제안', title:'액션 플랜', bullets:['단기 전략 방향','중기 성장 목표','장기 비전'], highlight:'' },
    { type:'bullets', tag:'추가 분석', title:'핵심 데이터 포인트', bullets:['주요 지표 분석','경쟁 환경 변화','투자자 관점'], highlight:'' },
  ];

  let fi = 0;
  while (sections.length < 10) {
    sections.push(FALLBACK_SECTIONS[fi++ % FALLBACK_SECTIONS.length]);
  }

  return {
    title:      meta.title      || `${sections[0]?.title || '리서치'} 리포트`,
    subtitle:   meta.subtitle   || '2025-2026 전략 분석',
    keyMessage: meta.keyMessage || '',
    conclusion: meta.conclusion || '',
    dataSource: meta.dataSource || 'Web Research',
    sections:   sections.slice(0, 10),
  };
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function run(opts = {}) {
  const { topic = '', url = null, query = null, outputType = 'ppt', isPitchDeck = false } = opts;
  const searchQuery = query || topic;
  const startTime = Date.now();
  console.log(`\n[researchPipeline] ========== 멀티모델 오케스트레이션 시작 ==========`);
  console.log(`[researchPipeline] 주제: "${topic}" | 타입: ${isPitchDeck ? 'PITCH DECK' : 'PPT'}`);

  // STEP 1: 검색
  const searchText = await runSearchTeam(searchQuery);
  console.log(`[researchPipeline] 검색 결과: ${searchText.length}자`);

  let structured;
  let crawlText = '';

  if (isPitchDeck) {
    // ── 투자 제안서 전용 파이프라인 ──────────────────────────
    const [_crawlText, pitchSections, miniResult] = await Promise.all([
      runCrawlTeam(searchText, topic),
      analyzeWithGPT4oPitch(topic, searchText),
      analyzeWithMiniPitch(topic, searchText),
    ]);
    crawlText = _crawlText || '';
    console.log(`[researchPipeline] 크롤 데이터: ${crawlText.length}자`);
    console.log(`[researchPipeline] Pitch섹션: ${pitchSections?.length ?? 'null'}, Mini: ${miniResult?.sections?.length ?? 'null'}`);
    structured = mergePitchResults(pitchSections, miniResult, topic);
  } else {
    const [_crawlText, gpt4oSections, claudeSections, miniResult] = await Promise.all([
      runCrawlTeam(searchText, topic),
      analyzeWithGPT4o(topic, searchText),
      analyzeWithClaude(topic, searchText),
      analyzeWithMini(topic, searchText),
    ]);
    crawlText = _crawlText || '';
    console.log(`[researchPipeline] 크롤 데이터: ${crawlText.length}자`);
    console.log(`[researchPipeline] GPT-4o: ${gpt4oSections?.length ?? 'null'}섹션, Claude: ${claudeSections?.length ?? 'null'}섹션, Mini: ${miniResult?.sections?.length ?? 'null'}섹션`);
    structured = mergeResults(gpt4oSections, claudeSections, miniResult);
  }

  console.log(`[researchPipeline] ✅ 완료 — ${((Date.now()-startTime)/1000).toFixed(1)}s, 섹션 ${structured.sections.length}개`);

  return {
    success: true, topic,
    structured,
    rawLength: searchText.length + crawlText.length,
  };
}

// 단독 실행 지원 (기존 server.js 호환)
async function structureResearch(opts) {
  return run(opts);
}

module.exports = { run, structureResearch, runSearchTeam, runCrawlTeam };
