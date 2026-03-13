'use strict';
/**
 * domainOrchestrator.js — Phase 3 통합 라우터
 * 
 * 4개 심화 도메인 엔진을 하나의 인터페이스로 통합:
 *  - real_estate : realEstateDomain.js (40건 커버)
 *  - finance     : financeDomain.js   (28건 커버)
 *  - healthcare  : healthcareDomain.js (27건 커버)
 *  - government  : governmentDomain.js (18건 커버)
 * 
 * 총 Phase 3 커버: 113건 추가
 * 누적 총 커버: 426 (Phase1+2) + 113 = 539건
 */

const realEstate  = require('./realEstateDomain');
const finance     = require('./financeDomain');
const healthcare  = require('./healthcareDomain');
const government  = require('./governmentDomain');

// ── 도메인 레지스트리 ────────────────────────────────────────
const DOMAIN_REGISTRY = {
  real_estate: {
    module: realEstate,
    name: '부동산/공간 AI',
    icon: '🏠',
    phase: 3,
    casesAdded: 40,
    description: 'GIS 분석 · 실거래가 API · 상권분석 · 투자 수익률 시뮬레이터 · 인테리어 AI',
    actions: {
      analyze:    'getTransactionHistory',
      commercial: 'analyzeCommercialArea',
      invest:     'simulateInvestmentROI',
      interior:   'estimateInterior',
      gis:        'analyzeIsochrone',
      predict:    'predictPropertyPrice',
    },
    tags: ['부동산', '공간AI', 'GIS', '상권', '투자', '인테리어'],
  },
  finance: {
    module: finance,
    name: '금융/투자 AI',
    icon: '📈',
    phase: 3,
    casesAdded: 28,
    description: '기술적 분석 · 포트폴리오 최적화 · 옵션 프라이싱 · 암호화폐 감성분석 · 리스크 관리',
    actions: {
      technical:   'generateTradingSignal',
      portfolio:   'rebalancePortfolio',
      option:      'blackScholes',
      crypto:      'analyzeCryptoSentiment',
      quote:       'getMarketQuote',
    },
    tags: ['주식', '암호화폐', '포트폴리오', '옵션', '리스크', '퀀트'],
  },
  healthcare: {
    module: healthcare,
    name: '헬스케어 AI',
    icon: '🏥',
    phase: 3,
    casesAdded: 27,
    description: '처방전 OCR · 약물 상호작용 · 의료 영상 분석 · 임상 의사결정 지원 · 건강 대화',
    actions: {
      prescription: 'checkDrugInteractions',
      clinical:     'clinicalDecisionSupport',
      phr:          'analyzePHR',
      compliance:   'applyComplianceLayer',
      execute:      'execute',
    },
    tags: ['처방전', '의료영상', 'PHR', '감별진단', '약물상호작용', '임상'],
  },
  government: {
    module: government,
    name: '정부/공공 AI',
    icon: '🏛️',
    phase: 3,
    casesAdded: 18,
    description: '공공데이터 포털 · 다국어 문서 번역 · 재난 경보 · 행정 챗봇 · 법령 분석',
    actions: {
      publicData:   'fetchPublicData',
      translate:    'parsePolicyDocument',
      disaster:     'sendEmergencyAlert',
      chatbot:      'buildCitizenServiceGuide',
      legislation:  'parsePolicyDocument',
      execute:      'execute',
    },
    tags: ['공공데이터', '재난경보', '다국어', '행정', '법령', '시민서비스'],
  },
};

// ── 통합 실행 함수 ────────────────────────────────────────────
/**
 * run(domain, action, params)
 * @param {string} domain   - 도메인 키 (real_estate | finance | healthcare | government)
 * @param {string} action   - 액션 키 (각 도메인 actions 참조)
 * @param {object} params   - 액션 파라미터
 * @returns {Promise<object>}
 */
// ── 파라미터 어댑터 (함수 시그니처 정규화) ─────────────────────
function adaptParams(domain, action, params) {
  // finance/technical: generateTradingSignal(prices[], opts)
  if (domain === 'finance' && action === 'technical') {
    const prices = params.prices || Array.from({ length: 50 }, (_, i) =>
      Math.round(50000 + Math.sin(i / 5) * 5000 + (Math.random() - 0.5) * 2000));
    const opts = { symbol: params.symbol || 'UNKNOWN', ...params };
    return [prices, opts];
  }
  // finance/option: blackScholes(opts)
  if (domain === 'finance' && action === 'option') {
    return [params];
  }
  // healthcare/prescription: checkDrugInteractions(drugList[])
  if (domain === 'healthcare' && action === 'prescription') {
    const drugList = params.drugs || params.drugList || [];
    return [drugList];
  }
  // healthcare/phr: analyzePHR(phrData)
  if (domain === 'healthcare' && action === 'phr') {
    return [params];
  }
  // healthcare/clinical: clinicalDecisionSupport(symptoms[], opts)
  if (domain === 'healthcare' && action === 'clinical') {
    const symptoms = params.symptoms || params;
    return [Array.isArray(symptoms) ? symptoms : [symptoms], params];
  }
  // real_estate/analyze: getTransactionHistory(opts)
  if (domain === 'real_estate' && action === 'analyze') {
    return [params];
  }
  // real_estate/invest: simulateInvestmentROI(opts)
  if (domain === 'real_estate' && action === 'invest') {
    return [params];
  }
  // Default: pass params as first argument
  return [params];
}

async function run(domain, action, params = {}) {
  const reg = DOMAIN_REGISTRY[domain];
  if (!reg) {
    throw new Error(`Unknown domain: "${domain}". Available: ${Object.keys(DOMAIN_REGISTRY).join(', ')}`);
  }

  const fnName = reg.actions[action];
  if (!fnName) {
    throw new Error(
      `Unknown action "${action}" for domain "${domain}". ` +
      `Available actions: ${Object.keys(reg.actions).join(', ')}`
    );
  }

  const fn = reg.module[fnName];
  if (typeof fn !== 'function') {
    throw new Error(`Function "${fnName}" not exported from ${domain} module.`);
  }

  const args = adaptParams(domain, action, params);
  const startTime = Date.now();
  try {
    const result = await fn(...args);
    return {
      success: true,
      domain,
      action,
      fnName,
      durationMs: Date.now() - startTime,
      result,
    };
  } catch (err) {
    return {
      success: false,
      domain,
      action,
      fnName,
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

// ── 상태 리포트 ───────────────────────────────────────────────
function getStatus() {
  const domains = Object.entries(DOMAIN_REGISTRY).map(([key, reg]) => ({
    key,
    name: reg.name,
    icon: reg.icon,
    phase: reg.phase,
    casesAdded: reg.casesAdded,
    actions: Object.keys(reg.actions),
    tags: reg.tags,
    description: reg.description,
  }));

  const totalCasesAdded = domains.reduce((s, d) => s + d.casesAdded, 0);

  return {
    phase: 3,
    domains,
    totalDomains: domains.length,
    totalCasesAdded,
    cumulativeCoverage: {
      phase1: 379,
      phase2: 47,
      phase3: totalCasesAdded,
      total: 379 + 47 + totalCasesAdded,
    },
  };
}

// ── 도메인별 빠른 헬퍼 ───────────────────────────────────────
async function runRealEstate(action, params)  { return run('real_estate', action, params); }
async function runFinance(action, params)      { return run('finance', action, params); }
async function runHealthcare(action, params)   { return run('healthcare', action, params); }
async function runGovernment(action, params)   { return run('government', action, params); }

// ── 배치 실행 (복수 도메인 병렬) ───────────────────────────────
async function runBatch(requests) {
  // requests: [{ domain, action, params }, ...]
  const results = await Promise.allSettled(
    requests.map(({ domain, action, params }) => run(domain, action, params))
  );
  return results.map((r, i) => ({
    request: requests[i],
    ...(r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }),
  }));
}

// ── 도메인 자동 감지 (프롬프트 키워드 기반) ────────────────────
const DOMAIN_KEYWORDS = {
  real_estate: ['부동산', '아파트', '분양', '실거래', '임대', '상권', '인테리어', '평수', 'GIS', '건물', '빌라', '오피스텔'],
  finance:     ['주식', '코인', '암호화폐', '포트폴리오', 'ETF', '옵션', '선물', '투자', '수익률', '리스크', '퀀트', '트레이딩'],
  healthcare:  ['처방전', '약물', '의료', '건강', '진단', 'PHR', '임상', '증상', '병원', '의사', '영상의학', 'CT', 'MRI'],
  government:  ['공공데이터', '정부', '행정', '민원', '법령', '재난', '다국어', '시민', '공공', '국가', '법안', '규정'],
};

function detectDomain(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[domain] = keywords.filter(kw => lower.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? { domain: best[0], confidence: best[1] / DOMAIN_KEYWORDS[best[0]].length } : null;
}

module.exports = {
  DOMAIN_REGISTRY,
  run,
  runBatch,
  runRealEstate,
  runFinance,
  runHealthcare,
  runGovernment,
  getStatus,
  detectDomain,
};
