'use strict';
/**
 * researchPipeline.js
 * URL 크롤 + 웹검색 → 구조화된 리서치 데이터 생성
 *
 * 흐름:
 *   1. URL 있으면 → 크롤 (Tavily Extract / fetch fallback)
 *   2. 검색어로 → 웹검색 (Brave / SerpAPI / Tavily)
 *   3. 두 결과 합산 → AI로 구조화
 *   4. { title, summary, keyPoints, sections, rawText } 반환
 */

const { searchEngine } = require('../agent');

// ── 웹 크롤 (Tavily Extract 우선, fetch fallback) ─────────────
async function crawlUrl(url) {
  const tavilyKey = process.env.TAVILY_API_KEY;

  // 1) Tavily Extract
  if (tavilyKey) {
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, urls: [url] }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await res.json();
      const extracted = data?.results?.[0];
      if (extracted?.raw_content) {
        return {
          url,
          title:   extracted.title || url,
          content: extracted.raw_content.slice(0, 8000),
          method:  'tavily',
        };
      }
    } catch (e) {
      console.warn('[researchPipeline] Tavily Extract 실패:', e.message);
    }
  }

  // 2) fetch fallback — HTML 파싱
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    // 태그 제거 + 공백 정리
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      url,
      title:   titleMatch ? titleMatch[1].trim() : url,
      content: text,
      method:  'fetch',
    };
  } catch (e) {
    console.warn('[researchPipeline] fetch 크롤 실패:', e.message);
    return { url, title: url, content: '', method: 'failed' };
  }
}

// ── 웹검색 (deepSearch 우선, 폴백 search) ───────────────────
async function webSearch(query, maxResults = 10) {
  try {
    // deepSearch: 멀티쿼리 + 전체 결과 병합 고품질 검색
    const result = await searchEngine.deepSearch(query, { maxResults, multiQuery: true });
    return result || '';
  } catch (e) {
    console.warn('[researchPipeline] deepSearch 실패, 기본 검색 폴백:', e.message);
    try {
      return await searchEngine.search(query, { maxResults: 5 }) || '';
    } catch (e2) {
      console.warn('[researchPipeline] 웹검색 실패:', e2.message);
      return '';
    }
  }
}

// ── AI로 리서치 데이터 구조화 ─────────────────────────────────
async function structureResearch({ topic, crawlData, searchData, outputType = 'ppt' }) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const outputGuide = {
    ppt:    '프레젠테이션 슬라이드 (10~12장)',
    pdf:    '상세 리포트 문서',
    excel:  '데이터 표/분석 시트',
    report: '분석 보고서',
  }[outputType] || '프레젠테이션';

  const contextParts = [];
  if (crawlData?.content) {
    contextParts.push(`=== 웹사이트 크롤 데이터 (${crawlData.url}) ===\n${crawlData.content.slice(0, 4000)}`);
  }
  if (searchData) {
    contextParts.push(`=== 웹검색 결과 ===\n${String(searchData).slice(0, 6000)}`);
  }

  const context = contextParts.join('\n\n') || `주제: ${topic}`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `당신은 세계 최고의 리서치 애널리스트입니다.
수집된 데이터를 분석하여 ${outputGuide}에 최적화된 구조화된 리포트를 JSON으로 반환하세요.

반드시 아래 JSON 형식으로만 응답:
{
  "title": "리포트 제목",
  "subtitle": "부제목 (한 줄 요약)",
  "keyMessage": "핵심 메시지 한 문장",
  "sections": [
    {
      "title": "섹션 제목",
      "type": "overview|stats|comparison|timeline|insight|conclusion",
      "content": "섹션 내용 (2~4문장)",
      "bullets": ["핵심 포인트1", "핵심 포인트2", "핵심 포인트3"],
      "stat": {"value": "숫자나 지표", "label": "설명", "trend": "up|down|neutral"},
      "highlight": "강조할 핵심 한 줄"
    }
  ],
  "conclusion": "결론 및 시사점",
  "dataSource": "데이터 출처 요약"
}

sections는 8~10개로 구성하세요.`,
      },
      {
        role: 'user',
        content: `주제: "${topic}"\n\n${context}`,
      },
    ],
    temperature: 0.4,
    max_tokens:  6000,
    response_format: { type: 'json_object' },
  });

  try {
    return JSON.parse(resp.choices[0].message.content);
  } catch {
    return {
      title: topic,
      subtitle: 'AI 리서치 분석',
      keyMessage: '데이터 기반 인사이트',
      sections: [],
      conclusion: '',
      dataSource: '',
    };
  }
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function run(opts = {}) {
  const {
    topic   = '',
    url     = null,
    query   = null,
    outputType = 'ppt',
  } = opts;

  const searchQuery = query || topic;
  console.log(`[researchPipeline] 시작 — topic="${topic}" url=${url || '없음'}`);

  // 병렬로 크롤 + 검색 동시 실행
  const [crawlData, searchData] = await Promise.all([
    url ? crawlUrl(url) : Promise.resolve(null),
    searchQuery ? webSearch(searchQuery) : Promise.resolve(''),
  ]);

  console.log(`[researchPipeline] 크롤=${crawlData?.method || '스킵'} 검색=${searchData ? '성공' : '스킵'}`);

  // AI 구조화
  const structured = await structureResearch({
    topic,
    crawlData,
    searchData,
    outputType,
  });

  return {
    success:    true,
    topic,
    url:        crawlData?.url || null,
    structured,
    crawlTitle: crawlData?.title || null,
    rawLength:  (crawlData?.content?.length || 0) + String(searchData || '').length,
  };
}

module.exports = { run, crawlUrl, webSearch, structureResearch };
