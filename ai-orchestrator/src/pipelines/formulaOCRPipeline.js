'use strict';
/**
 * formulaOCRPipeline.js — Phase 2-5
 * 수식 인식 OCR 파이프라인 (9건 커버)
 *
 * 이미지/PDF → 수식 감지 → LaTeX 변환 → 계산 → 설명 생성
 * 실제 API 연동 제외 — 수식 파서/LaTeX/계산 엔진 완비
 * 실제 연동 시 callFormulaOCRAPI() 교체
 */

// ── 지원 수식 타입 ────────────────────────────────────────
const FORMULA_TYPES = {
  arithmetic:    { label: '산술식',      icon: '➕', examples: ['2+3=5', '100×0.15'] },
  algebraic:     { label: '대수식',      icon: '🔣', examples: ['ax²+bx+c=0', '(a+b)²=a²+2ab+b²'] },
  calculus:      { label: '미적분',      icon: '∫',  examples: ['∫f(x)dx', 'lim(x→0) sinx/x'] },
  statistics:    { label: '통계/확률',   icon: '📊', examples: ['μ=ΣX/n', 'σ²=Σ(X-μ)²/n'] },
  linear_algebra:{ label: '선형대수',    icon: '⬛', examples: ['Ax=b', 'det(A)=ad-bc'] },
  differential:  { label: '미분방정식',  icon: '🌀', examples: ["y'=ky", "d²y/dx²+y=0"] },
  physics:       { label: '물리 공식',   icon: '⚛️', examples: ['E=mc²', 'F=ma', 'PV=nRT'] },
  chemistry:     { label: '화학식',      icon: '🧪', examples: ['H₂O', 'C₆H₁₂O₆', '2H₂+O₂→2H₂O'] },
  financial:     { label: '금융 공식',   icon: '💹', examples: ['PV=FV/(1+r)^n', 'ROI=(수익-비용)/비용'] },
  geometry:      { label: '기하 공식',   icon: '📐', examples: ['A=πr²', 'c²=a²+b²'] },
};

// ── LaTeX 패턴 라이브러리 ─────────────────────────────────
const LATEX_PATTERNS = {
  // 그리스 문자
  greekLetters: {
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\epsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
    'π': '\\pi', 'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\phi', 'ω': '\\omega',
  },
  // 연산자
  operators: {
    '×': '\\times', '÷': '\\div', '≤': '\\leq', '≥': '\\geq',
    '≠': '\\neq', '≈': '\\approx', '∞': '\\infty', '∑': '\\sum',
    '∏': '\\prod', '∫': '\\int', '∂': '\\partial', '∇': '\\nabla',
    '√': '\\sqrt', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
  },
  // 공통 수식 패턴
  common: {
    'quadratic':   { latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', name: '이차방정식 근의 공식' },
    'euler':       { latex: 'e^{i\\pi} + 1 = 0', name: '오일러 공식' },
    'pythagorean': { latex: 'c^2 = a^2 + b^2', name: '피타고라스 정리' },
    'normal_dist': { latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{1}{2}(\\frac{x-\\mu}{\\sigma})^2}', name: '정규분포 PDF' },
    'bayes':       { latex: 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}', name: '베이즈 정리' },
    'compound_interest': { latex: 'A = P(1 + \\frac{r}{n})^{nt}', name: '복리 계산식' },
    'circle_area': { latex: 'A = \\pi r^2', name: '원의 넓이' },
    'einstein':    { latex: 'E = mc^2', name: '질량-에너지 등가' },
    'npv':         { latex: 'NPV = \\sum_{t=0}^{T}\\frac{CF_t}{(1+r)^t}', name: 'NPV 공식' },
    'gradient_descent': { latex: '\\theta := \\theta - \\alpha\\nabla_{\\theta}J(\\theta)', name: '경사하강법' },
  },
};

// ── 수식 계산 엔진 ────────────────────────────────────────
const FORMULA_CALCULATORS = {
  // 재무 계산
  compound_interest: (P, r, n, t) => P * Math.pow(1 + r/n, n*t),
  simple_interest:   (P, r, t)    => P * (1 + r * t),
  npv:               (cashflows, r) => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1+r, t), 0),
  irr_approx:        (cashflows)    => {
    let rate = 0.1;
    for (let i = 0; i < 20; i++) {
      const npv = cashflows.reduce((s, cf, t) => s + cf / Math.pow(1+rate, t), 0);
      rate += npv / 1000;
    }
    return parseFloat(rate.toFixed(4));
  },
  // 통계
  mean:     (arr) => arr.reduce((s, x) => s + x, 0) / arr.length,
  variance: (arr) => {
    const m = arr.reduce((s, x) => s + x, 0) / arr.length;
    return arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / arr.length;
  },
  std_dev:  (arr) => {
    const m = arr.reduce((s, x) => s + x, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / arr.length);
  },
  // 기하
  circle_area:   (r)    => Math.PI * r * r,
  sphere_volume: (r)    => (4/3) * Math.PI * Math.pow(r, 3),
  pythagorean:   (a, b) => Math.sqrt(a*a + b*b),
  // 물리
  kinetic_energy:  (m, v) => 0.5 * m * v * v,
  potential_energy:(m, g, h) => m * g * h,
  force:           (m, a) => m * a,
};

// ── 도메인별 수식 우선순위 ────────────────────────────────
const DOMAIN_FORMULA_FOCUS = {
  edu_med:       ['algebraic', 'calculus', 'statistics', 'physics', 'chemistry'],
  finance_invest:['financial', 'statistics', 'arithmetic'],
  data_ai:       ['statistics', 'linear_algebra', 'calculus', 'algebraic'],
  engineering:   ['physics', 'calculus', 'differential', 'geometry'],
  government:    ['statistics', 'arithmetic', 'financial'],
  healthcare:    ['statistics', 'chemistry', 'arithmetic'],
};

// ─────────────────────────────────────────────────────────
// 수식 감지 (이미지에서)
// ─────────────────────────────────────────────────────────
function detectFormulaRegions(imageData = {}) {
  // stub: 이미지 분석으로 수식 영역 bbox 감지
  const { width = 800, height = 600, hasGrid = false } = imageData;

  // 예상 수식 위치 생성 (stub)
  const regions = [
    { id: 1, bbox: [50, 80, 400, 120], confidence: 0.95, type: 'inline', page: 1 },
    { id: 2, bbox: [100, 200, 600, 260], confidence: 0.91, type: 'display', page: 1 },
    { id: 3, bbox: [50, 320, 350, 360], confidence: 0.87, type: 'inline', page: 1 },
  ];

  return {
    totalRegions: regions.length,
    regions,
    hasDisplayFormulas: regions.some(r => r.type === 'display'),
    avgConfidence:       parseFloat((regions.reduce((s, r) => s + r.confidence, 0) / regions.length).toFixed(3)),
    imageSize:           { width, height },
    stub:                true,
  };
}

// ─────────────────────────────────────────────────────────
// OCR API stub (실제 연동 시 교체)
// ─────────────────────────────────────────────────────────
async function callFormulaOCRAPI(imageRegion, context = '', _apiKey) {
  // ※ 실제 연동 예시:
  // Mathpix API:
  //   const res = await axios.post('https://api.mathpix.com/v3/text', {
  //     src: imageBase64,
  //     formats: ['latex_simplified', 'text', 'mathml'],
  //     math_inline_delimiters: ['$', '$'],
  //   }, { headers: { 'app_id': APP_ID, 'app_key': APP_KEY }});
  //   return { latex: res.data.latex_simplified, confidence: res.data.confidence };
  //
  // GPT-4V:
  //   const res = await openai.chat.completions.create({
  //     model: 'gpt-4o',
  //     messages: [{ role: 'user', content: [
  //       { type: 'image_url', image_url: { url: imageBase64 }},
  //       { type: 'text', text: '이 수식을 LaTeX로 변환해주세요.' }
  //     ]}]
  //   });

  // stub: 컨텍스트 기반 예시 수식 반환
  const contextLower = (context || '').toLowerCase();
  let formula = LATEX_PATTERNS.common.quadratic;

  if (contextLower.includes('통계') || contextLower.includes('평균')) {
    formula = LATEX_PATTERNS.common.normal_dist;
  } else if (contextLower.includes('금융') || contextLower.includes('복리')) {
    formula = LATEX_PATTERNS.common.compound_interest;
  } else if (contextLower.includes('물리') || contextLower.includes('에너지')) {
    formula = LATEX_PATTERNS.common.einstein;
  } else if (contextLower.includes('npv') || contextLower.includes('투자')) {
    formula = LATEX_PATTERNS.common.npv;
  } else if (contextLower.includes('ai') || contextLower.includes('학습')) {
    formula = LATEX_PATTERNS.common.gradient_descent;
  } else if (contextLower.includes('베이즈') || contextLower.includes('확률')) {
    formula = LATEX_PATTERNS.common.bayes;
  } else if (contextLower.includes('원') || contextLower.includes('기하')) {
    formula = LATEX_PATTERNS.common.circle_area;
  }

  return {
    stub:        true,
    latex:       formula.latex,
    text:        formula.latex.replace(/\\/g, '').replace(/[{}]/g, ''),
    mathml:      `<math><mrow><!-- stub MathML for: ${formula.name} --></mrow></math>`,
    confidence:  0.92,
    formulaName: formula.name,
    model:       'Mathpix-stub / GPT-4V-stub',
    message:     'Formula OCR stub — Mathpix API 또는 GPT-4V 연동 후 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// LaTeX → 설명 생성
// ─────────────────────────────────────────────────────────
function generateExplanation(latex, formulaName, domain = 'edu_med') {
  const explanationTemplates = {
    '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}': {
      ko: '이차방정식 ax²+bx+c=0의 근을 구하는 공식입니다. 판별식 b²-4ac의 값에 따라 실근(>0), 중근(=0), 허근(<0)이 결정됩니다.',
      variables: { a: '이차항 계수', b: '일차항 계수', c: '상수항' },
      usecase: '이차방정식 풀이',
    },
    'E = mc^2': {
      ko: '아인슈타인의 질량-에너지 등가 공식입니다. 물질의 질량(m)이 빛의 속도(c)의 제곱에 비례하는 에너지로 변환될 수 있음을 나타냅니다.',
      variables: { E: '에너지 (J)', m: '질량 (kg)', c: '빛의 속도 (3×10⁸ m/s)' },
      usecase: '핵반응, 입자물리학',
    },
    'A = P(1 + \\frac{r}{n})^{nt}': {
      ko: '복리 계산 공식입니다. 원금 P를 연이율 r로 1년에 n번 복리 계산하여 t년 후의 금액 A를 구합니다.',
      variables: { A: '미래 가치', P: '원금', r: '연이율', n: '연간 복리 횟수', t: '기간(년)' },
      usecase: '적금, 대출, 투자 수익 계산',
    },
  };

  const template = explanationTemplates[latex] || {
    ko: `${formulaName || '수식'}입니다. 수식을 분석하여 설명을 생성합니다.`,
    variables: {},
    usecase: '수학/과학 계산',
  };

  return {
    description:  template.ko,
    variables:    template.variables,
    usecase:      template.usecase,
    domain,
    relatedTopics: DOMAIN_FORMULA_FOCUS[domain]?.slice(0, 3) || ['algebraic', 'calculus'],
  };
}

// ─────────────────────────────────────────────────────────
// 수식 계산 실행
// ─────────────────────────────────────────────────────────
function computeFormula(formulaKey, params = {}) {
  const calc = FORMULA_CALCULATORS[formulaKey];
  if (!calc) {
    return { success: false, error: `알 수 없는 공식: ${formulaKey}`, available: Object.keys(FORMULA_CALCULATORS) };
  }

  try {
    const args   = Object.values(params);
    const result = calc(...args);
    return {
      success:    true,
      formulaKey,
      params,
      result:     typeof result === 'number' ? parseFloat(result.toFixed(6)) : result,
      resultLabel: typeof result === 'number' ? result.toLocaleString() : String(result),
    };
  } catch (err) {
    return { success: false, error: err.message, formulaKey, params };
  }
}

// ─────────────────────────────────────────────────────────
// 배치 처리 (문서 전체 수식 추출)
// ─────────────────────────────────────────────────────────
async function processBatch(pages = [], context = '', domain = 'edu_med', apiKey = null) {
  const allFormulas = [];
  let totalRegions  = 0;

  for (let i = 0; i < pages.length; i++) {
    const detected = detectFormulaRegions(pages[i] || {});
    totalRegions  += detected.totalRegions;

    for (const region of detected.regions) {
      const ocr = await callFormulaOCRAPI(region, context, apiKey);
      const exp = generateExplanation(ocr.latex, ocr.formulaName, domain);
      allFormulas.push({
        page:       i + 1,
        region:     region.id,
        ...ocr,
        explanation: exp,
      });
    }
  }

  return {
    success:       true,
    pageCount:     pages.length,
    totalRegions,
    totalFormulas: allFormulas.length,
    formulas:      allFormulas,
    latexList:     allFormulas.map(f => f.latex),
    stub:          true,
  };
}

// ─────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    imageData     = null,
    imageUrl      = null,
    text          = '',
    context       = '',
    domain        = 'edu_med',
    computeFormulas = true,
    computeParams = {},
    batchPages    = [],
    apiKey        = null,
  } = opts;

  const startMs = Date.now();

  // Step 1: 수식 영역 감지
  const detected = detectFormulaRegions(imageData || { width: 800, height: 600 });

  // Step 2: OCR 수행
  const ocrResults = [];
  const sourcesToProcess = detected.regions.slice(0, 5);  // 최대 5개 처리

  for (const region of sourcesToProcess) {
    const ocr = await callFormulaOCRAPI(region, context || text, apiKey);
    const exp = generateExplanation(ocr.latex, ocr.formulaName, domain);
    ocrResults.push({ region: region.id, ...ocr, explanation: exp });
  }

  // Step 3: 계산 (요청된 경우)
  const computeResults = {};
  if (computeFormulas && Object.keys(computeParams).length > 0) {
    for (const [formulaKey, params] of Object.entries(computeParams)) {
      computeResults[formulaKey] = computeFormula(formulaKey, params);
    }
  }

  // Step 4: 배치 처리 (다중 페이지)
  let batchResult = null;
  if (batchPages.length > 0) {
    batchResult = await processBatch(batchPages, context, domain, apiKey);
  }

  // 주요 수식 요약
  const primaryFormula = ocrResults[0] || null;

  return {
    success:       true,
    pipeline:      'formulaOCR',
    input:         { hasImage: !!(imageData || imageUrl), textLength: text.length, domain },
    detection:     detected,
    formulas:      ocrResults,
    primaryFormula,
    computeResults,
    batchResult,
    latexSummary:  ocrResults.map(r => ({ latex: r.latex, name: r.formulaName, confidence: r.confidence })),
    durationMs:    Date.now() - startMs,
    readyToUse:    false,
    meta: {
      supportedTypes:       Object.keys(FORMULA_TYPES),
      availableCalculators: Object.keys(FORMULA_CALCULATORS),
      commonFormulas:       Object.keys(LATEX_PATTERNS.common),
      domainFocus:          DOMAIN_FORMULA_FOCUS[domain] || [],
    },
  };
}

module.exports = {
  execute,
  detectFormulaRegions,
  generateExplanation,
  computeFormula,
  processBatch,
  FORMULA_TYPES,
  LATEX_PATTERNS,
  FORMULA_CALCULATORS,
  DOMAIN_FORMULA_FOCUS,
};
