'use strict';
/**
 * nerPipeline.js — Phase 2-2
 * NER (Named Entity Recognition) 파이프라인 (10건 커버)
 *
 * 텍스트 입력 → 토크나이징 → 개체명 인식 → 관계 추출 → 지식그래프 구조화 → 출력
 * 실제 API 연동 제외 — GPT-4 기반 NER / spaCy 스키마 / 관계 그래프 완비
 * 실제 연동 시 callNerAPI() 교체
 */

// ── 지원 개체 타입 ────────────────────────────────────────
const ENTITY_TYPES = {
  // 공통
  PERSON:       { label: '인물',     color: '#FF6B6B', icon: '👤', examples: ['이순신', 'Elon Musk'] },
  ORGANIZATION: { label: '기관/회사', color: '#4ECDC4', icon: '🏢', examples: ['삼성전자', 'OpenAI'] },
  LOCATION:     { label: '장소',     color: '#45B7D1', icon: '📍', examples: ['서울', 'Silicon Valley'] },
  DATE:         { label: '날짜',     color: '#96CEB4', icon: '📅', examples: ['2026년 3월', 'Q1 2026'] },
  MONEY:        { label: '금액',     color: '#FFEAA7', icon: '💰', examples: ['500만원', '$1.2B'] },
  PERCENT:      { label: '비율',     color: '#DDA0DD', icon: '📊', examples: ['15%', '3배 성장'] },
  PRODUCT:      { label: '제품',     color: '#FFB347', icon: '📦', examples: ['아이폰 16', 'GPT-5'] },
  LAW:          { label: '법률',     color: '#B0C4DE', icon: '⚖️', examples: ['개인정보보호법', 'GDPR'] },
  // 도메인 특화
  MEDICAL:      { label: '의료/질병', color: '#FF9999', icon: '🏥', examples: ['당뇨병', 'COVID-19'] },
  CHEMICAL:     { label: '화학물질', color: '#99FF99', icon: '🧪', examples: ['아스피린', 'C2H5OH'] },
  GENE:         { label: '유전자',   color: '#9999FF', icon: '🧬', examples: ['BRCA1', 'TP53'] },
  TECH:         { label: '기술',     color: '#FFD700', icon: '⚡', examples: ['딥러닝', 'Transformer'] },
  EVENT:        { label: '이벤트',   color: '#FF69B4', icon: '🎪', examples: ['CES 2026', '블랙프라이데이'] },
  QUANTITY:     { label: '수량',     color: '#20B2AA', icon: '🔢', examples: ['50개', '3천만 명'] },
};

// ── 도메인별 NER 스키마 ───────────────────────────────────
const DOMAIN_SCHEMAS = {
  legal_hr: {
    name:       '법무/HR',
    entities:   ['PERSON', 'ORGANIZATION', 'DATE', 'MONEY', 'LAW', 'LOCATION'],
    relations:  ['SIGNS', 'EMPLOYED_BY', 'BREACHES', 'OWNS', 'LITIGATES_AGAINST'],
    outputFormat: 'contract_analysis',
    usecases:   ['계약서 분석', '법령 조항 추출', '인사 문서 파싱'],
  },
  finance_invest: {
    name:       '금융/투자',
    entities:   ['ORGANIZATION', 'PERSON', 'MONEY', 'PERCENT', 'DATE', 'PRODUCT', 'QUANTITY'],
    relations:  ['INVESTS_IN', 'ACQUIRES', 'REPORTS', 'PARTNERS_WITH', 'COMPETES_WITH'],
    outputFormat: 'financial_report',
    usecases:   ['재무제표 파싱', '공시 분석', '뉴스 감성 분석'],
  },
  healthcare: {
    name:       '의료/헬스케어',
    entities:   ['PERSON', 'MEDICAL', 'CHEMICAL', 'GENE', 'DATE', 'ORGANIZATION', 'QUANTITY'],
    relations:  ['DIAGNOSED_WITH', 'PRESCRIBED', 'CAUSES', 'TREATS', 'CONTRAINDICATED'],
    outputFormat: 'medical_record',
    usecases:   ['의무기록 파싱', '처방전 분석', '임상시험 데이터 추출'],
  },
  data_ai: {
    name:       '데이터/AI',
    entities:   ['TECH', 'ORGANIZATION', 'PERSON', 'PRODUCT', 'DATE', 'QUANTITY', 'PERCENT'],
    relations:  ['DEVELOPS', 'USES', 'BENCHMARKS', 'OUTPERFORMS', 'TRAINED_ON'],
    outputFormat: 'knowledge_graph',
    usecases:   ['AI 논문 파싱', '기술 트렌드 분석', 'API 문서 구조화'],
  },
  ecommerce: {
    name:       '이커머스',
    entities:   ['PRODUCT', 'ORGANIZATION', 'MONEY', 'QUANTITY', 'PERSON', 'LOCATION', 'DATE'],
    relations:  ['SELLS', 'MANUFACTURED_BY', 'PRICED_AT', 'SHIPS_TO', 'REVIEWED_BY'],
    outputFormat: 'product_catalog',
    usecases:   ['상품설명 파싱', '리뷰 분석', '가격 정보 추출'],
  },
  b2b: {
    name:       'B2B/기업',
    entities:   ['ORGANIZATION', 'PERSON', 'MONEY', 'DATE', 'LOCATION', 'PRODUCT', 'PERCENT'],
    relations:  ['SUPPLIES', 'CONTRACTS_WITH', 'HEADQUARTERED_IN', 'SUBSIDIARY_OF', 'CEO_OF'],
    outputFormat: 'company_profile',
    usecases:   ['기업 조사 자동화', '계약 조건 추출', '공급망 분석'],
  },
  government: {
    name:       '정부/공공',
    entities:   ['ORGANIZATION', 'PERSON', 'LAW', 'DATE', 'MONEY', 'LOCATION', 'EVENT'],
    relations:  ['ENACTS', 'GOVERNS', 'FUNDS', 'REGULATES', 'ISSUES'],
    outputFormat: 'policy_analysis',
    usecases:   ['공공데이터 파싱', '정책 문서 분석', '입찰 공고 추출'],
  },
};

// ── 관계 추출 패턴 ────────────────────────────────────────
const RELATION_PATTERNS = {
  OWNS:            ['소유', '보유', '지분', '인수', 'owns', 'acquired'],
  LOCATED_IN:      ['위치', '소재지', '주소', '본사', 'located in', 'based in'],
  FOUNDED_BY:      ['설립', '창업', '창설', 'founded by', 'established by'],
  EMPLOYED_BY:     ['재직', '근무', '소속', '직원', 'works at', 'employed by'],
  COMPETES_WITH:   ['경쟁', '라이벌', '대항', 'competes with', 'rival'],
  PARTNERS_WITH:   ['파트너십', '제휴', '협업', '협력', 'partnered with'],
  INVESTS_IN:      ['투자', '출자', '펀딩', 'invested in', 'funded'],
  DEVELOPS:        ['개발', '출시', '제작', 'developed', 'launched'],
  REPORTS:         ['발표', '공시', '보고', 'reported', 'announced'],
};

// ── 텍스트 전처리 ─────────────────────────────────────────
function preprocessText(text = '') {
  // 기본 정제
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

  // 문장 분리 (간단한 규칙 기반)
  const sentences = cleaned
    .split(/(?<=[.!?。]\s)|(?<=\n)/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  // 통계
  const words    = cleaned.split(/\s+/).length;
  const hasKorean = /[가-힣]/.test(cleaned);
  const hasEng    = /[a-zA-Z]{3,}/.test(cleaned);

  return {
    original: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
    cleaned:  cleaned.slice(0, 500),
    sentences,
    stats: {
      chars:    cleaned.length,
      words,
      sentences: sentences.length,
      hasKorean,
      hasEng,
      language: hasKorean ? 'ko' : hasEng ? 'en' : 'mixed',
    },
  };
}

// ─────────────────────────────────────────────────────────
// NER API stub (실제 연동 시 교체)
// ─────────────────────────────────────────────────────────
async function callNerAPI(text, schema, _apiKey) {
  // ※ 실제 연동 예시:
  // GPT-4 기반:
  //   const prompt = `다음 텍스트에서 개체명을 JSON으로 추출해주세요.
  //     지원 타입: ${schema.entities.join(', ')}
  //     텍스트: "${text}"`;
  //   const res = await openai.chat.completions.create({
  //     model: 'gpt-4o', messages: [{role:'user', content: prompt}],
  //     response_format: { type: 'json_object' }
  //   });
  //   return JSON.parse(res.choices[0].message.content);
  //
  // spaCy 기반:
  //   const res = await axios.post('http://spacy-server/ner', { text, model: 'ko_core_news_lg' });
  //   return res.data.entities;

  // stub: 텍스트에서 키워드 패턴으로 예시 개체 생성
  const hasKorean = /[가-힣]/.test(text);
  const stubEntities = [];

  // 간단한 패턴 매칭으로 stub 개체 생성
  const patterns = {
    ORGANIZATION: [/[가-힣A-Z][가-힣a-zA-Z]+(?:주식회사|㈜|Inc\.|Corp\.|Ltd\.)/g, /(삼성|LG|현대|SK|네이버|카카오|Apple|Google|OpenAI)/g],
    PERSON:       [/(?:대표|CEO|CTO|의장|회장)\s+([가-힣]{2,4})/g],
    MONEY:        [/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:원|달러|USD|\$|억|조|만)/g],
    DATE:         [/(\d{4}년\s*\d{1,2}월|\d{4}-\d{2}-\d{2}|Q[1-4]\s*\d{4})/g],
    PERCENT:      [/(\d+(?:\.\d+)?)\s*%/g],
  };

  for (const [type, patternList] of Object.entries(patterns)) {
    if (!schema.entities.includes(type)) continue;
    for (const pattern of patternList) {
      const matches = [...text.matchAll(pattern)];
      for (const m of matches.slice(0, 3)) {
        stubEntities.push({
          text:       m[0],
          type,
          label:      ENTITY_TYPES[type]?.label || type,
          start:      m.index,
          end:        m.index + m[0].length,
          confidence: 0.85 + Math.random() * 0.14,
          stub:       true,
        });
      }
    }
  }

  // 최소 결과 보장
  if (stubEntities.length === 0) {
    stubEntities.push(
      { text: '예시기업', type: 'ORGANIZATION', label: '기관/회사', start: 0, end: 4, confidence: 0.90, stub: true },
      { text: '2026년', type: 'DATE', label: '날짜', start: 5, end: 11, confidence: 0.95, stub: true },
    );
  }

  return {
    stub:     true,
    entities: stubEntities,
    model:    'gpt-4o-ner (stub)',
    language: hasKorean ? 'ko' : 'en',
    message:  'NER stub — GPT-4 API 설정 후 실제 개체명 인식 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 관계 추출
// ─────────────────────────────────────────────────────────
function extractRelations(entities, text, schema) {
  const relations = [];

  // 동일 문장 내 개체 쌍 분석 (stub)
  const orgEntities    = entities.filter(e => e.type === 'ORGANIZATION');
  const personEntities = entities.filter(e => e.type === 'PERSON');
  const moneyEntities  = entities.filter(e => e.type === 'MONEY');

  // 간단한 공존 기반 관계 추출
  for (const rel of schema.relations || []) {
    const patterns = RELATION_PATTERNS[rel] || [];
    const matched  = patterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
    if (matched && orgEntities.length >= 2) {
      relations.push({
        subject:    orgEntities[0].text,
        predicate:  rel,
        object:     orgEntities[1]?.text || '(unknown)',
        confidence: 0.75,
        stub:       true,
      });
    }
  }

  // 기본 관계: 인물 → 조직
  if (personEntities.length > 0 && orgEntities.length > 0) {
    relations.push({
      subject:   personEntities[0].text,
      predicate: 'EMPLOYED_BY',
      object:    orgEntities[0].text,
      confidence: 0.80,
      stub:      true,
    });
  }

  // 금액 관계
  if (moneyEntities.length > 0 && orgEntities.length > 0) {
    relations.push({
      subject:   orgEntities[0].text,
      predicate: 'VALUED_AT',
      object:    moneyEntities[0].text,
      confidence: 0.82,
      stub:      true,
    });
  }

  return relations;
}

// ─────────────────────────────────────────────────────────
// 지식 그래프 생성
// ─────────────────────────────────────────────────────────
function buildKnowledgeGraph(entities, relations) {
  const nodes = entities.map((e, i) => ({
    id:     `node_${i}`,
    label:  e.text,
    type:   e.type,
    color:  ENTITY_TYPES[e.type]?.color || '#999',
    icon:   ENTITY_TYPES[e.type]?.icon  || '❓',
  }));

  const entityIndex = {};
  entities.forEach((e, i) => { entityIndex[e.text] = `node_${i}`; });

  const edges = relations.map((r, i) => ({
    id:         `edge_${i}`,
    source:     entityIndex[r.subject]   || 'node_0',
    target:     entityIndex[r.object]    || 'node_1',
    label:      r.predicate,
    confidence: r.confidence,
  }));

  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      entityTypes: [...new Set(entities.map(e => e.type))],
    },
  };
}

// ─────────────────────────────────────────────────────────
// 출력 포맷터
// ─────────────────────────────────────────────────────────
function formatOutput(entities, relations, graph, schema, preprocessed) {
  const byType = {};
  for (const e of entities) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push({ text: e.text, confidence: e.confidence });
  }

  return {
    summary: {
      totalEntities:   entities.length,
      totalRelations:  relations.length,
      entityTypes:     Object.keys(byType),
      topEntities:     entities.sort((a,b) => b.confidence - a.confidence).slice(0, 5).map(e => e.text),
      language:        preprocessed.stats.language,
    },
    entities:          byType,
    relations,
    knowledgeGraph:    graph,
    rawEntities:       entities,
    outputFormat:      schema.outputFormat,
    domainSchema:      schema.name,
  };
}

// ─────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    text           = '',
    domain         = 'data_ai',
    extractRelationships = true,
    buildGraph     = true,
    customEntities = [],
    apiKey         = null,
  } = opts;

  if (!text || text.trim().length < 5) {
    return { success: false, error: '텍스트가 너무 짧습니다 (최소 5자)' };
  }

  const startMs = Date.now();

  // Step 1: 전처리
  const preprocessed = preprocessText(text);

  // Step 2: 스키마 선택
  const schema = DOMAIN_SCHEMAS[domain] || DOMAIN_SCHEMAS.data_ai;
  const mergedEntities = [...schema.entities, ...customEntities].filter(Boolean);
  const mergedSchema   = { ...schema, entities: mergedEntities };

  // Step 3: NER 수행
  const nerResult = await callNerAPI(preprocessed.cleaned, mergedSchema, apiKey);

  // Step 4: 관계 추출
  const relations = extractRelationships
    ? extractRelations(nerResult.entities, preprocessed.cleaned, mergedSchema)
    : [];

  // Step 5: 지식 그래프
  const graph = buildGraph
    ? buildKnowledgeGraph(nerResult.entities, relations)
    : null;

  // Step 6: 출력 포맷
  const formatted = formatOutput(nerResult.entities, relations, graph, mergedSchema, preprocessed);

  return {
    success:      true,
    pipeline:     'ner',
    input:        { textLength: text.length, domain },
    preprocessed: {
      stats:     preprocessed.stats,
      sentences: preprocessed.sentences.length,
    },
    ...formatted,
    nerModel:     nerResult.model,
    stub:         nerResult.stub,
    durationMs:   Date.now() - startMs,
    readyToUse:   !nerResult.stub,
    meta: {
      availableDomains:  Object.keys(DOMAIN_SCHEMAS),
      availableEntities: Object.keys(ENTITY_TYPES),
      supportedRelations: Object.keys(RELATION_PATTERNS),
    },
  };
}

// ─────────────────────────────────────────────────────────
// 도메인 스키마 추천
// ─────────────────────────────────────────────────────────
function recommendSchema(domain = 'data_ai') {
  const schema = DOMAIN_SCHEMAS[domain] || DOMAIN_SCHEMAS.data_ai;
  return {
    domain,
    schema,
    entityTypes: schema.entities.map(k => ({ key: k, ...ENTITY_TYPES[k] })),
    usecases:    schema.usecases,
  };
}

module.exports = {
  execute,
  preprocessText,
  extractRelations,
  buildKnowledgeGraph,
  formatOutput,
  recommendSchema,
  ENTITY_TYPES,
  DOMAIN_SCHEMAS,
  RELATION_PATTERNS,
};
