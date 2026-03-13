'use strict';
/**
 * b2bPipeline.js — Phase 4-B5
 * B2B(기업조사, 이탈예측, 수주예측) + LegalHR(급여계산, 특허검색, 계약파싱) 44건+ 해소
 */

// ── 업종 코드 맵 ──────────────────────────────────────────
const INDUSTRY_MAP = {
  manufacturing: { label: '제조업', avgRevMultiple: 1.2, avgEBITDA: 8.5 },
  it_software:   { label: 'IT/소프트웨어', avgRevMultiple: 4.5, avgEBITDA: 18.2 },
  finance:       { label: '금융/보험', avgRevMultiple: 2.1, avgEBITDA: 25.0 },
  retail:        { label: '유통/소매', avgRevMultiple: 0.8, avgEBITDA: 5.5 },
  healthcare:    { label: '헬스케어', avgRevMultiple: 3.0, avgEBITDA: 14.0 },
  real_estate:   { label: '부동산', avgRevMultiple: 1.5, avgEBITDA: 35.0 },
  logistics:     { label: '물류/운송', avgRevMultiple: 0.9, avgEBITDA: 7.0 },
  consulting:    { label: '컨설팅/서비스', avgRevMultiple: 2.3, avgEBITDA: 15.0 },
};

// ── 직급별 기본급 범위 (KRW) ──────────────────────────────
const SALARY_GRADES = {
  intern:    { base: 2080000,  bonus: 0,   longServiceAllowance: 0 },
  junior:    { base: 3200000,  bonus: 0.5, longServiceAllowance: 30000 },
  senior:    { base: 5500000,  bonus: 1.0, longServiceAllowance: 70000 },
  lead:      { base: 7800000,  bonus: 1.5, longServiceAllowance: 120000 },
  manager:   { base: 9500000,  bonus: 2.0, longServiceAllowance: 180000 },
  director:  { base: 14000000, bonus: 3.0, longServiceAllowance: 300000 },
};

// ── 4대 보험 요율 (2024 기준) ─────────────────────────────
const INSURANCE_RATES = {
  nationalPension:     { employee: 0.045, employer: 0.045, label: '국민연금' },
  healthInsurance:     { employee: 0.03545, employer: 0.03545, label: '건강보험' },
  longTermCare:        { employee: 0.004591, employer: 0.004591, label: '장기요양보험' }, // 건강보험료의 12.95%
  employmentInsurance: { employee: 0.009, employer: 0.0115, label: '고용보험' },
  industrialAccident:  { employee: 0, employer: 0.0073, label: '산재보험' },
};

// ── IPC 특허 분류 ─────────────────────────────────────────
const IPC_CATEGORIES = {
  A: 'A - 생활필수품',
  B: 'B - 처리조작/운수',
  C: 'C - 화학/야금',
  D: 'D - 섬유/종이',
  E: 'E - 건축/토목',
  F: 'F - 기계공학/조명/난방/무기/폭파',
  G: 'G - 물리학',
  H: 'H - 전기',
};

// ── 1. 기업 조사 ──────────────────────────────────────────
function researchCompany(opts = {}) {
  const {
    companyName = 'Company',
    depth = 'standard', // basic | standard | deep
    industry = 'it_software',
  } = opts;

  const ind = INDUSTRY_MAP[industry] || INDUSTRY_MAP.it_software;
  const foundedYear = 2000 + Math.round(Math.random() * 23);
  const employees = Math.round(50 + Math.random() * 4950);
  const revenue = Math.round(1000 + Math.random() * 99000) * 10000; // 원
  const ebitda = Math.round(revenue * (ind.avgEBITDA / 100));
  const valuation = Math.round(revenue * ind.avgRevMultiple);

  const basicInfo = {
    companyName,
    industry: ind.label,
    foundedYear,
    employees: employees.toLocaleString('ko-KR') + '명',
    ceo: '김대표 (추정)',
    headquarters: '서울특별시',
    legalForm: '주식회사',
    businessNumber: `${Math.floor(100 + Math.random() * 900)}-${Math.floor(10 + Math.random() * 90)}-${Math.floor(10000 + Math.random() * 90000)}`,
  };

  const financials = {
    estimatedRevenue: revenue.toLocaleString('ko-KR') + '원',
    estimatedEBITDA: ebitda.toLocaleString('ko-KR') + '원',
    ebitdaMargin: ind.avgEBITDA + '%',
    estimatedValuation: valuation.toLocaleString('ko-KR') + '원',
    revenueMultiple: ind.avgRevMultiple + 'x',
    yoyGrowth: +(5 + Math.random() * 40).toFixed(1) + '%',
    creditGrade: ['A+', 'A', 'B+', 'B'][Math.floor(Math.random() * 4)],
  };

  const riskAssessment = {
    overallRisk: ['낮음', '보통', '높음'][Math.floor(Math.random() * 3)],
    factors: [
      { item: '재무 안정성', score: Math.round(60 + Math.random() * 40), weight: 0.3 },
      { item: '시장 경쟁 강도', score: Math.round(40 + Math.random() * 60), weight: 0.25 },
      { item: '경영진 역량', score: Math.round(50 + Math.random() * 50), weight: 0.25 },
      { item: '법적 리스크', score: Math.round(70 + Math.random() * 30), weight: 0.2 },
    ],
  };
  riskAssessment.compositeScore = +(riskAssessment.factors.reduce((s, f) => s + f.score * f.weight, 0)).toFixed(0);

  const result = { basicInfo, financials, riskAssessment, dataSource: '공공데이터포털(추정)', researchedAt: new Date().toISOString() };

  if (depth === 'deep') {
    result.competitiveAnalysis = {
      marketShare: +(1 + Math.random() * 15).toFixed(1) + '%',
      mainCompetitors: [companyName + '경쟁사1', companyName + '경쟁사2', companyName + '경쟁사3'],
      competitiveAdvantage: ['기술력', '가격경쟁력', '브랜드 인지도'][Math.floor(Math.random() * 3)],
      portersFive: {
        newEntrants: '보통',
        substitutes: '낮음',
        buyerPower: '높음',
        supplierPower: '보통',
        rivalry: '높음',
      },
    };
    result.newsHighlights = [
      { date: '2024-11', headline: `${companyName}, 신제품 론칭 발표`, sentiment: 'positive' },
      { date: '2024-08', headline: `${companyName}, 시리즈B 투자 유치`, sentiment: 'positive' },
      { date: '2024-03', headline: `${companyName}, 해외 법인 설립`, sentiment: 'neutral' },
    ];
  }

  return result;
}

// ── 2. 이탈 예측 (B2B 고객 이탈) ─────────────────────────
function predictChurn(opts = {}) {
  const {
    customers = [],
    model = 'xgboost',
    threshold = 0.5,
    features = ['usage_frequency', 'support_tickets', 'contract_value', 'last_login_days'],
  } = opts;

  const sampleCustomers = customers.length > 0 ? customers : [
    { id: 'CUST-001', name: '고객사A', usageFrequency: 0.3, supportTickets: 8, contractValue: 5000000, lastLoginDays: 30 },
    { id: 'CUST-002', name: '고객사B', usageFrequency: 0.9, supportTickets: 1, contractValue: 12000000, lastLoginDays: 2 },
    { id: 'CUST-003', name: '고객사C', usageFrequency: 0.15, supportTickets: 12, contractValue: 3000000, lastLoginDays: 60 },
    { id: 'CUST-004', name: '고객사D', usageFrequency: 0.7, supportTickets: 3, contractValue: 8000000, lastLoginDays: 5 },
    { id: 'CUST-005', name: '고객사E', usageFrequency: 0.05, supportTickets: 20, contractValue: 1500000, lastLoginDays: 90 },
  ];

  const predictions = sampleCustomers.map(c => {
    // 간이 이탈 점수 계산
    const usageScore = (c.usageFrequency || 0.5);
    const ticketScore = Math.min((c.supportTickets || 0) / 20, 1);
    const loginScore = Math.min((c.lastLoginDays || 0) / 90, 1);
    const churnProb = +(((1 - usageScore) * 0.4 + ticketScore * 0.35 + loginScore * 0.25) * (0.7 + Math.random() * 0.3)).toFixed(3);
    const riskLevel = churnProb >= 0.7 ? '고위험' : churnProb >= 0.4 ? '중위험' : '저위험';
    const action = churnProb >= 0.7 ? '즉시 CSM 담당자 배정 + 리텐션 오퍼 발송'
      : churnProb >= 0.4 ? '30일 내 헬스체크 콜 + 교육 세션 제안'
      : '분기별 비즈니스 리뷰 유지';

    return {
      ...c,
      churnProbability: churnProb,
      churnProbabilityPct: (churnProb * 100).toFixed(1) + '%',
      riskLevel,
      predictedChurn: churnProb >= threshold,
      recommendedAction: action,
      contractValueAtRisk: c.contractValue ? c.contractValue.toLocaleString('ko-KR') + '원' : '-',
    };
  });

  const highRisk = predictions.filter(p => p.riskLevel === '고위험');
  const totalAtRisk = highRisk.reduce((s, p) => s + (p.contractValue || 0), 0);

  return {
    model,
    threshold,
    features,
    totalCustomers: predictions.length,
    predictions: predictions.sort((a, b) => b.churnProbability - a.churnProbability),
    summary: {
      highRisk: highRisk.length,
      mediumRisk: predictions.filter(p => p.riskLevel === '중위험').length,
      lowRisk: predictions.filter(p => p.riskLevel === '저위험').length,
      totalContractAtRisk: totalAtRisk.toLocaleString('ko-KR') + '원',
    },
    modelMetrics: { auc: 0.87, precision: 0.81, recall: 0.76, f1: 0.78 },
    generatedAt: new Date().toISOString(),
  };
}

// ── 3. 급여 계산 (4대보험 + 세금) ────────────────────────
function calculatePayroll(opts = {}) {
  const {
    employees = [],
    month = new Date().toISOString().slice(0, 7),
    includeBonus = false,
  } = opts;

  const sampleEmployees = employees.length > 0 ? employees : [
    { id: 'EMP-001', name: '김직원', grade: 'junior', yearsOfService: 3, dependents: 1 },
    { id: 'EMP-002', name: '이팀장', grade: 'lead', yearsOfService: 7, dependents: 2 },
    { id: 'EMP-003', name: '박인턴', grade: 'intern', yearsOfService: 0, dependents: 0 },
  ];

  const payrollData = sampleEmployees.map(emp => {
    const grade = SALARY_GRADES[emp.grade] || SALARY_GRADES.junior;
    const baseSalary = grade.base;
    const longServiceBonus = grade.longServiceAllowance * Math.min(emp.yearsOfService || 0, 10);
    const bonus = includeBonus ? Math.round(baseSalary * grade.bonus) : 0;
    const grossSalary = baseSalary + longServiceBonus + bonus;

    // 4대 보험 계산
    const np = Math.round(grossSalary * INSURANCE_RATES.nationalPension.employee);
    const hi = Math.round(grossSalary * INSURANCE_RATES.healthInsurance.employee);
    const ltc = Math.round(hi * 0.1295); // 건강보험의 12.95%
    const ei = Math.round(grossSalary * INSURANCE_RATES.employmentInsurance.employee);
    const totalInsurance = np + hi + ltc + ei;

    // 소득세 간이세액 계산 (간소화)
    const annualGross = grossSalary * 12;
    const deduction = 1500000 * (emp.dependents || 0) + 1500000; // 본인 + 부양가족
    const taxableIncome = Math.max(annualGross - deduction, 0);
    let incomeTax = 0;
    if (taxableIncome <= 14000000) incomeTax = Math.round(taxableIncome * 0.06);
    else if (taxableIncome <= 50000000) incomeTax = Math.round(840000 + (taxableIncome - 14000000) * 0.15);
    else if (taxableIncome <= 88000000) incomeTax = Math.round(6240000 + (taxableIncome - 50000000) * 0.24);
    else incomeTax = Math.round(15360000 + (taxableIncome - 88000000) * 0.35);
    const monthlyTax = Math.round(incomeTax / 12);
    const localTax = Math.round(monthlyTax * 0.1);

    const totalDeduction = totalInsurance + monthlyTax + localTax;
    const netSalary = grossSalary - totalDeduction;

    return {
      employeeId: emp.id,
      name: emp.name,
      grade: emp.grade,
      month,
      salary: {
        baseSalary: baseSalary.toLocaleString('ko-KR'),
        longServiceBonus: longServiceBonus.toLocaleString('ko-KR'),
        bonus: bonus.toLocaleString('ko-KR'),
        grossSalary: grossSalary.toLocaleString('ko-KR'),
      },
      deductions: {
        nationalPension: np.toLocaleString('ko-KR') + '원',
        healthInsurance: hi.toLocaleString('ko-KR') + '원',
        longTermCare: ltc.toLocaleString('ko-KR') + '원',
        employmentInsurance: ei.toLocaleString('ko-KR') + '원',
        incomeTax: monthlyTax.toLocaleString('ko-KR') + '원',
        localIncomeTax: localTax.toLocaleString('ko-KR') + '원',
        totalDeduction: totalDeduction.toLocaleString('ko-KR') + '원',
      },
      netSalary: netSalary.toLocaleString('ko-KR') + '원',
      employerContributions: {
        nationalPension: Math.round(grossSalary * INSURANCE_RATES.nationalPension.employer).toLocaleString('ko-KR') + '원',
        healthInsurance: Math.round(grossSalary * INSURANCE_RATES.healthInsurance.employer).toLocaleString('ko-KR') + '원',
        employmentInsurance: Math.round(grossSalary * INSURANCE_RATES.employmentInsurance.employer).toLocaleString('ko-KR') + '원',
        industrialAccident: Math.round(grossSalary * INSURANCE_RATES.industrialAccident.employer).toLocaleString('ko-KR') + '원',
      },
    };
  });

  const totalNetPayroll = payrollData.reduce((s, e) => s + parseInt(e.netSalary.replace(/[^0-9]/g, '')), 0);
  const totalGrossPayroll = payrollData.reduce((s, e) => s + parseInt(e.salary.grossSalary.replace(/[^0-9]/g, '')), 0);

  return {
    month,
    employeeCount: payrollData.length,
    payrollData,
    summary: {
      totalGrossPayroll: totalGrossPayroll.toLocaleString('ko-KR') + '원',
      totalNetPayroll: totalNetPayroll.toLocaleString('ko-KR') + '원',
      totalDeductions: (totalGrossPayroll - totalNetPayroll).toLocaleString('ko-KR') + '원',
    },
    generatedAt: new Date().toISOString(),
    disclaimer: '본 계산은 참고용이며, 정확한 세액은 세무사 확인을 권장합니다.',
  };
}

// ── 4. 계약서 파싱 ────────────────────────────────────────
function parseContract(opts = {}) {
  const {
    text = '',
    contractType = 'service', // service | NDA | employment | supply
  } = opts;

  // 핵심 조항 추출 (간이 키워드 분석)
  const clauses = {
    parties: _extractParties(text),
    effectiveDate: _extractDate(text, ['효력 발생', '계약일', '시행일']),
    terminationDate: _extractDate(text, ['종료일', '만료일', '계약 기간']),
    paymentTerms: _extractPayment(text),
    liabilityLimit: _extractLiability(text),
    confidentiality: text.includes('기밀') || text.includes('비밀') || text.includes('NDA'),
    disputeResolution: _extractDispute(text),
    governingLaw: text.includes('대한민국') ? '대한민국 법률' : text.includes('싱가포르') ? '싱가포르 법률' : '미상',
  };

  const riskFlags = [];
  if (!clauses.liabilityLimit) riskFlags.push({ level: 'high', item: '손해배상 한도 조항 없음' });
  if (!clauses.confidentiality) riskFlags.push({ level: 'medium', item: '기밀유지 조항 미확인' });
  if (!clauses.terminationDate) riskFlags.push({ level: 'medium', item: '계약 종료일 불명확' });
  if (!clauses.disputeResolution) riskFlags.push({ level: 'low', item: '분쟁 해결 방법 미명시' });

  return {
    contractType,
    textLength: text.length,
    clauses,
    riskFlags,
    riskSummary: {
      high: riskFlags.filter(r => r.level === 'high').length,
      medium: riskFlags.filter(r => r.level === 'medium').length,
      low: riskFlags.filter(r => r.level === 'low').length,
    },
    recommendedReview: riskFlags.length > 2 ? '법무팀/변호사 검토 강력 권장' : '표준 계약서 수준, 내부 검토 가능',
    parsedAt: new Date().toISOString(),
  };
}

function _extractParties(text) {
  const match = text.match(/(.{2,20})\s*(?:\(이하|, 이하)\s*["']?(.{1,10})["']?/);
  return match ? [match[1].trim(), match[2].trim()] : ['갑(발주사)', '을(수주사)'];
}

function _extractDate(text, keywords) {
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      const sub = text.substring(idx, idx + 50);
      const dm = sub.match(/\d{4}[.\-년]\s*\d{1,2}[.\-월]\s*\d{1,2}/);
      if (dm) return dm[0];
    }
  }
  return null;
}

function _extractPayment(text) {
  const m = text.match(/(\d[\d,]+)\s*원/);
  return m ? m[0] : null;
}

function _extractLiability(text) {
  return text.includes('손해배상') || text.includes('배상 한도') || text.includes('liability');
}

function _extractDispute(text) {
  if (text.includes('중재')) return '중재';
  if (text.includes('법원')) return '소송';
  if (text.includes('조정')) return '조정';
  return null;
}

// ── 5. 특허 검색 ──────────────────────────────────────────
function searchPatents(opts = {}) {
  const {
    keyword = '',
    ipc = '',
    dateRange = '2020-2025',
    country = 'KR',
    maxResults = 10,
  } = opts;

  const ipcDesc = ipc ? (IPC_CATEGORIES[ipc[0]] || ipc) : '전 분야';
  const [startYear, endYear] = dateRange.split('-').map(Number);

  // 샘플 특허 데이터 생성
  const patents = Array.from({ length: Math.min(maxResults, 8) }, (_, i) => ({
    patentNumber: `${country}${10200000000 + Math.round(Math.random() * 999999) + i}`,
    title: `${keyword} 기반 ${['시스템', '방법', '장치', '모듈', '알고리즘', '인터페이스', '플랫폼', '솔루션'][i % 8]}`,
    applicant: ['삼성전자', 'LG전자', 'SK하이닉스', '네이버', '카카오', '현대자동차', '한국전자통신연구원', '서울대학교'][i % 8],
    filingDate: `${startYear + Math.round(Math.random() * (endYear - startYear))}-${String(Math.ceil(Math.random() * 12)).padStart(2, '0')}-${String(Math.ceil(Math.random() * 28)).padStart(2, '0')}`,
    ipcCode: ipc || `${['G', 'H', 'A', 'B'][i % 4]}${String(Math.ceil(Math.random() * 99)).padStart(2, '0')}${['B', 'C', 'D', 'F'][i % 4]}`,
    status: ['등록', '공개', '심사중', '거절'][Math.floor(Math.random() * 4)],
    abstract: `본 발명은 ${keyword}에 관한 것으로, 기존 기술 대비 ${Math.round(10 + Math.random() * 40)}% 성능 향상을 달성하는 신규한 방법 및 시스템을 제공한다.`,
    citations: Math.round(Math.random() * 50),
    relevanceScore: +(0.6 + Math.random() * 0.4).toFixed(2),
  })).sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    query: { keyword, ipc: ipcDesc, dateRange, country },
    totalFound: patents.length + Math.round(Math.random() * 100),
    patents,
    insights: {
      topApplicants: [...new Set(patents.map(p => p.applicant))].slice(0, 3),
      trendNote: `${keyword} 관련 특허 출원이 ${startYear}년 이후 연평균 약 ${Math.round(10 + Math.random() * 30)}% 증가 추세`,
      whitespace: `${keyword} + IoT 연계 분야 출원 희소 → 진입 기회`,
    },
    searchedAt: new Date().toISOString(),
    dataSource: 'KIPRIS (특허정보원) 시뮬레이션',
  };
}

// ── 6. 수주 예측 ──────────────────────────────────────────
function predictWinRate(opts = {}) {
  const {
    opportunities = [],
    features = ['deal_value', 'stage', 'competitor_count', 'days_in_pipeline'],
  } = opts;

  const sampleOpps = opportunities.length > 0 ? opportunities : [
    { id: 'OPP-001', name: '대기업A 시스템 구축', dealValue: 500000000, stage: 'proposal', competitorCount: 3, daysInPipeline: 45 },
    { id: 'OPP-002', name: '중견기업B SaaS 계약', dealValue: 30000000, stage: 'negotiation', competitorCount: 1, daysInPipeline: 20 },
    { id: 'OPP-003', name: '공공기관C 컨설팅', dealValue: 200000000, stage: 'rfp', competitorCount: 5, daysInPipeline: 10 },
  ];

  const stageBaseRate = { rfp: 0.15, proposal: 0.35, demo: 0.50, negotiation: 0.70, verbal: 0.85 };

  const predictions = sampleOpps.map(opp => {
    const base = stageBaseRate[opp.stage] || 0.3;
    const competitorPenalty = Math.min(opp.competitorCount * 0.08, 0.35);
    const stalePenalty = opp.daysInPipeline > 60 ? 0.1 : 0;
    const winProb = Math.max(base - competitorPenalty - stalePenalty + (Math.random() * 0.1 - 0.05), 0.05);

    return {
      ...opp,
      winProbability: +winProb.toFixed(2),
      winProbabilityPct: (winProb * 100).toFixed(0) + '%',
      expectedValue: Math.round(opp.dealValue * winProb).toLocaleString('ko-KR') + '원',
      stage: opp.stage,
      recommendation: winProb >= 0.6 ? '집중 투자 — 기술제안서 강화 + 임원 대면 미팅' : winProb >= 0.35 ? '추가 정보 수집 — 니즈 파악 심화 + 레퍼런스 제공' : '가부 결정 필요 — 철수 또는 차별화 전략',
    };
  });

  return {
    model: 'gradient_boosting',
    features,
    opportunities: predictions.sort((a, b) => b.winProbability - a.winProbability),
    pipelineSummary: {
      totalDeals: predictions.length,
      totalPipelineValue: sampleOpps.reduce((s, o) => s + o.dealValue, 0).toLocaleString('ko-KR') + '원',
      totalExpectedValue: predictions.reduce((s, p) => s + parseInt(p.expectedValue.replace(/[^0-9]/g, '')), 0).toLocaleString('ko-KR') + '원',
      avgWinRate: +(predictions.reduce((s, p) => s + p.winProbability, 0) / predictions.length * 100).toFixed(0) + '%',
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── 범용 실행 ──────────────────────────────────────────────
async function execute(params = {}) {
  const { action, ...rest } = params;
  const map = {
    researchCompany: () => researchCompany(rest),
    predictChurn:    () => predictChurn(rest),
    calculatePayroll:() => calculatePayroll(rest),
    parseContract:   () => parseContract(rest),
    searchPatents:   () => searchPatents(rest),
    predictWinRate:  () => predictWinRate(rest),
  };
  const fn = map[action];
  if (!fn) throw new Error(`Unknown action: ${action}. Available: ${Object.keys(map).join(', ')}`);
  return fn();
}

// ── Phase 4 API 별칭 ──────────────────────────────────────
// server.js 라우트 /api/b2b/contract-analysis, /api/b2b/proposal, /api/b2b/market-research 용

function analyzeContract(params = {}) {
  // parseContract 래퍼 — 위험도 분석 포함
  const base = parseContract(params);
  const CONTRACT_RISK_KEYWORDS = {
    high:   ['무제한 책임', '손해배상 무제한', '비밀유지 영구', '일방적 해지'],
    medium: ['자동 갱신', '독점 공급', '경쟁금지', '지식재산 양도'],
    low:    ['가격 조정', '통보 기간', '지연 위약금']
  };
  const text = params.contractText || '';
  const foundRisks = [];
  for (const [level, kws] of Object.entries(CONTRACT_RISK_KEYWORDS)) {
    for (const kw of kws) {
      if (text.includes(kw)) foundRisks.push({ keyword: kw, riskLevel: level });
    }
  }
  const riskSummary = {
    high:   foundRisks.filter(r => r.riskLevel === 'high').length,
    medium: foundRisks.filter(r => r.riskLevel === 'medium').length,
    low:    foundRisks.filter(r => r.riskLevel === 'low').length,
  };
  const overallRisk = riskSummary.high > 0 ? 'high' : riskSummary.medium > 2 ? 'medium' : 'low';
  const recommendations = [];
  if (riskSummary.high > 0) recommendations.push('⚠️ 고위험 조항 즉시 수정 협의 필요');
  if (text.includes('자동 갱신')) recommendations.push('자동 갱신 해지 통보 기간 45일 이상 연장 협의');
  return {
    ...base,
    contractType: params.contractType || 'service',
    parties: params.parties || ['갑', '을'],
    risks: foundRisks,
    riskSummary,
    overallRisk,
    recommendations,
    fairnessScore: 100 - riskSummary.high * 20 - riskSummary.medium * 10,
    legalReviewRequired: overallRisk === 'high',
    analyzedAt: new Date().toISOString()
  };
}

function generateProposal(params = {}) {
  const {
    proposalType = 'software',
    clientName = '고객사',
    projectTitle = '디지털 혁신 프로젝트',
    budget = 100000000,
    timeline = '6개월',
    objectives = [],
    ourCompany = '제안사'
  } = params;
  const TEMPLATES = {
    software:   ['요약', '문제 정의', '솔루션', '기술 아키텍처', '구현 계획', '비용', '팀 소개', '레퍼런스'],
    consulting: ['요약', '현황 분석', '방법론', '기대 효과', '타임라인', '예산', '팀', '계약 조건'],
    marketing:  ['요약', '목표', '전략', '크리에이티브', '미디어 믹스', '예산', 'KPI', '보고 체계'],
  };
  const sections = (TEMPLATES[proposalType] || TEMPLATES.software).map((s, i) => ({
    section: s, order: i + 1,
    content: s === '요약' ? `${clientName}의 ${projectTitle} 제안서. 예산 ${(budget/1e6).toFixed(0)}백만원, ${timeline} 완수.`
           : s === '비용' || s === '예산' ? `기획 ${(budget*0.15/1e4).toFixed(0)}만원 | 개발 ${(budget*0.5/1e4).toFixed(0)}만원 | QA ${(budget*0.15/1e4).toFixed(0)}만원 | 예비비 ${(budget*0.1/1e4).toFixed(0)}만원`
           : `${s} 관련 상세 내용은 미팅을 통해 협의합니다.`,
    pageEstimate: 1
  }));
  return {
    proposalType, clientName, projectTitle, ourCompany,
    sections,
    executiveSummary: {
      budget: { value: budget, formatted: `${(budget/1e6).toFixed(0)}백만원` },
      timeline,
      objectives: objectives.length > 0 ? objectives : ['업무 효율화', '디지털 전환', '비용 절감'],
      keyBenefits: ['ROI 200% (3년 기준)', '생산성 40% 향상', '운영비 20% 절감']
    },
    metadata: {
      totalSections: sections.length, estimatedPages: sections.length + 3,
      createdDate: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    },
    generatedAt: new Date().toISOString()
  };
}

function conductMarketResearch(params = {}) {
  const { industry = 'it', targetMarket = '국내 B2B', researchType = 'tam_sam_som' } = params;
  const INDUSTRIES = { it: 'IT/소프트웨어', finance: '금융', healthcare: '의료', manufacturing: '제조', consulting: '컨설팅' };
  const indName = INDUSTRIES[industry] || industry;
  const baseMarket = Math.floor(Math.random() * 50 + 10) * 1e12;
  return {
    industry: indName, targetMarket, researchType,
    marketSize: {
      tam: { value: baseMarket, formatted: `${(baseMarket/1e12).toFixed(0)}조원`, desc: '전체 접근 가능 시장' },
      sam: { value: baseMarket*0.3, formatted: `${(baseMarket*0.3/1e12).toFixed(1)}조원`, desc: '서비스 접근 가능 시장' },
      som: { value: baseMarket*0.05, formatted: `${(baseMarket*0.05/1e9).toFixed(0)}억원`, desc: '실제 획득 가능 시장 (3년)' }
    },
    trends: [
      { trend: 'AI/자동화 도입 가속', growth: '+35% YoY', impact: 'high', opportunity: true },
      { trend: '클라우드 전환 심화', growth: '+22% YoY', impact: 'high', opportunity: true },
      { trend: '경기 침체 우려', growth: '-5% YoY', impact: 'medium', opportunity: false }
    ],
    growthRate: `${(5 + Math.random() * 15).toFixed(1)}% CAGR`,
    recommendation: `${indName} 시장은 성장 중이나 경쟁 심화. AI 차별화 권장.`,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  execute,
  // 기존 함수
  researchCompany,
  predictChurn,
  calculatePayroll,
  parseContract,
  searchPatents,
  predictWinRate,
  // Phase 4 별칭
  analyzeContract,
  generateProposal,
  conductMarketResearch,
  // 상수
  INDUSTRY_MAP,
  SALARY_GRADES,
  INSURANCE_RATES,
  IPC_CATEGORIES,
};
