'use strict';
/**
 * realEstateDomain.js — Phase 3-1
 * 부동산 도메인 심화 엔진 (40건 미커버 → 커버)
 *
 * 핵심 기능:
 *  - 부동산_데이터_API: 실거래가/분양/시세 데이터 조회 (국토부 API stub)
 *  - 실거래가_API: 아파트/빌라/상업시설 실거래 내역
 *  - 상권분석_API: 상권 점수 / 유동인구 / 경쟁사 지도
 *  - GIS_분석_모듈: 위경도 기반 반경 분석 / 등시선 생성
 *  - 투자 수익률 시뮬레이터
 *  - 인테리어 견적 자동화
 */

// ── 지역 코드 (법정동) ────────────────────────────────────
const REGION_CODES = {
  '서울':    { code: '11', lat: 37.5665, lng: 126.9780 },
  '강남구':  { code: '11680', lat: 37.5175, lng: 127.0473 },
  '서초구':  { code: '11650', lat: 37.4837, lng: 127.0324 },
  '마포구':  { code: '11440', lat: 37.5663, lng: 126.9014 },
  '용산구':  { code: '11170', lat: 37.5324, lng: 126.9904 },
  '성동구':  { code: '11200', lat: 37.5635, lng: 127.0365 },
  '부산':    { code: '26', lat: 35.1796, lng: 129.0756 },
  '인천':    { code: '28', lat: 37.4563, lng: 126.7052 },
  '경기':    { code: '41', lat: 37.4138, lng: 127.5183 },
  '판교':    { code: '41135', lat: 37.3943, lng: 127.1112 },
};

// ── 부동산 유형 ───────────────────────────────────────────
const PROPERTY_TYPES = {
  apt:       { name: '아파트',    taxRate: 0.01,   avgYield: 0.025 },
  villa:     { name: '빌라/다세대', taxRate: 0.004, avgYield: 0.035 },
  officetel: { name: '오피스텔',  taxRate: 0.004,  avgYield: 0.045 },
  commercial:{ name: '상업시설',  taxRate: 0.002,  avgYield: 0.055 },
  land:      { name: '토지',      taxRate: 0.002,  avgYield: 0.015 },
  warehouse: { name: '창고/물류', taxRate: 0.002,  avgYield: 0.060 },
};

// ── 인테리어 단가 (원/m²) ─────────────────────────────────
const INTERIOR_UNIT_PRICES = {
  basic:    { name: '경제형',   perSqm: 300_000,  desc: '셀프 인테리어 수준' },
  standard: { name: '표준형',   perSqm: 600_000,  desc: '일반 인테리어 업체' },
  premium:  { name: '프리미엄', perSqm: 1_200_000,desc: '고급 자재 + 전문 시공' },
  luxury:   { name: '럭셔리',   perSqm: 2_500_000,desc: '수입 자재 + 인테리어 디자이너' },
};

// ── 대출 상품 (2026년 기준) ───────────────────────────────
const LOAN_PRODUCTS = {
  dsr_40:    { name: 'DSR 40% 기준',      maxLTV: 0.40, baseRate: 0.038, termYears: 30 },
  bogeumjari:{ name: '보금자리론',         maxLTV: 0.70, baseRate: 0.034, termYears: 30, maxAmount: 500_000_000 },
  jeonse:    { name: '전세자금대출',        maxLTV: 0.80, baseRate: 0.036, termYears: 2  },
  commercial_loan: { name: '상업용 부동산', maxLTV: 0.60, baseRate: 0.055, termYears: 20 },
};

// ── 실거래가 API stub ─────────────────────────────────────
async function getTransactionHistory(opts = {}) {
  const {
    region   = '서울',
    district = '강남구',
    type     = 'apt',
    months   = 6,
    _apiKey,
  } = opts;

  // ※ 실제 연동:
  // 국토교통부 실거래가 API:
  //   GET https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev
  //   params: serviceKey, pageNo, numOfRows, LAWD_CD, DEAL_YMD
  // 카카오 부동산:
  //   GET https://a.m.land.kakao.com/map/getPanelInfo?pnu=...

  const regionInfo = REGION_CODES[district] || REGION_CODES['서울'];
  const propType   = PROPERTY_TYPES[type] || PROPERTY_TYPES.apt;

  // stub: 실거래가 생성
  const basePrice    = district === '강남구' ? 2_500_000 : district === '서초구' ? 2_200_000 : 1_200_000;
  const transactions = Array.from({ length: 10 }, (_, i) => {
    const monthsAgo = Math.floor(Math.random() * months);
    const area      = 59 + Math.floor(Math.random() * 60);
    const unitPrice = basePrice + (Math.random() - 0.5) * 400_000;
    const totalPrice = Math.round(area * unitPrice / 10_000);  // 만원 단위
    return {
      id:          `TXN-${Date.now()}-${i}`,
      date:        new Date(Date.now() - monthsAgo * 30 * 24 * 3600_000).toISOString().split('T')[0],
      type:        propType.name,
      area,
      floor:       Math.floor(Math.random() * 20) + 1,
      totalFloors: 25,
      price:       totalPrice,
      priceLabel:  `${Math.round(totalPrice/10_000)}억 ${(totalPrice%10_000) > 0 ? (totalPrice%10_000)+'만' : ''}원`,
      unitPrice:   Math.round(unitPrice),
      location:    `${district} 샘플동 ${Math.floor(Math.random()*900)+100}번지`,
      pyeong:      parseFloat((area / 3.305).toFixed(1)),
    };
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const avgPrice = transactions.reduce((s, t) => s + t.price, 0) / transactions.length;
  const priceChange3m = ((transactions[0].price - transactions[9].price) / transactions[9].price * 100).toFixed(1);

  return {
    stub:         true,
    region:       { name: district, code: regionInfo.code, lat: regionInfo.lat, lng: regionInfo.lng },
    propertyType: propType.name,
    period:       `최근 ${months}개월`,
    count:        transactions.length,
    avgPrice:     Math.round(avgPrice),
    avgPriceLabel:`${Math.round(avgPrice/10_000)}억원`,
    priceChange3m:`${priceChange3m}%`,
    trend:        parseFloat(priceChange3m) > 0 ? '상승' : '하락',
    transactions,
    message:      '부동산 실거래가 stub — 국토부 API 연동 후 실제 데이터 활성화',
  };
}

// ── 시세 예측 (ML 모델 stub) ──────────────────────────────
async function predictPropertyPrice(opts = {}) {
  const {
    region      = '강남구',
    type        = 'apt',
    areaSqm     = 84,
    floor       = 10,
    totalFloors = 25,
    buildYear   = 2015,
    nearSubway  = 1,
    nearSchool  = 1,
    months      = 12,
  } = opts;

  const currentYear   = 2026;
  const propType      = PROPERTY_TYPES[type] || PROPERTY_TYPES.apt;
  const basePrice     = region === '강남구' ? 2_800_000 : region === '서초구' ? 2_400_000 : 1_300_000;

  // 조정 요소
  const ageAdj        = Math.max(0.70, 1 - (currentYear - buildYear) * 0.008);
  const floorAdj      = floor > totalFloors * 0.7 ? 1.05 : floor < 3 ? 0.92 : 1.0;
  const subwayAdj     = nearSubway <= 2 ? 1.08 : nearSubway <= 5 ? 1.03 : 0.97;
  const schoolAdj     = nearSchool ? 1.03 : 1.0;
  const adjustedPrice = basePrice * ageAdj * floorAdj * subwayAdj * schoolAdj;
  const totalCurrent  = Math.round(areaSqm * adjustedPrice);

  // 예측 (월별 상승률 가정: 0.3~0.8%)
  const monthlyRate   = 0.003 + Math.random() * 0.005;
  const forecasts     = Array.from({ length: months }, (_, i) => {
    const price = Math.round(totalCurrent * Math.pow(1 + monthlyRate, i + 1));
    return {
      month:      i + 1,
      date:       new Date(Date.now() + (i + 1) * 30 * 24 * 3600_000).toISOString().split('T')[0].slice(0, 7),
      price,
      priceLabel: `${Math.round(price / 10_000)}억원`,
      change:     `+${(monthlyRate * 100).toFixed(2)}%`,
    };
  });

  const forecast12m = forecasts[months - 1]?.price || totalCurrent;
  const roi12m      = ((forecast12m - totalCurrent) / totalCurrent * 100).toFixed(1);

  return {
    stub:         true,
    currentPrice: totalCurrent,
    currentLabel: `${Math.round(totalCurrent / 10_000)}억원`,
    pyeong:       parseFloat((areaSqm / 3.305).toFixed(1)),
    unitPrice:    Math.round(adjustedPrice),
    adjustments:  { age: ageAdj.toFixed(3), floor: floorAdj, subway: subwayAdj, school: schoolAdj },
    forecasts,
    roi12m:       `+${roi12m}%`,
    confidence:   0.72,
    model:        'Random Forest 시세 예측 (stub)',
    message:      '시세 예측 stub — 학습된 ML 모델 연동 후 실제 예측 활성화',
  };
}

// ── 상권 분석 ─────────────────────────────────────────────
async function analyzeCommercialArea(opts = {}) {
  const {
    lat          = 37.5175,
    lng          = 127.0473,
    radiusM      = 500,
    businessType = 'cafe',
  } = opts;

  // stub: 상권 지표 생성
  const BUSINESS_TYPES = {
    cafe:        { avgRevenue: 8_000_000,  competition: 'high',   survivalRate: 0.55 },
    restaurant:  { avgRevenue: 15_000_000, competition: 'high',   survivalRate: 0.48 },
    retail:      { avgRevenue: 12_000_000, competition: 'medium', survivalRate: 0.60 },
    gym:         { avgRevenue: 10_000_000, competition: 'medium', survivalRate: 0.65 },
    academy:     { avgRevenue: 20_000_000, competition: 'medium', survivalRate: 0.70 },
    convenience: { avgRevenue: 18_000_000, competition: 'low',    survivalRate: 0.80 },
  };

  const biz    = BUSINESS_TYPES[businessType] || BUSINESS_TYPES.retail;
  const score  = Math.floor(Math.random() * 30) + 60;

  return {
    stub:          true,
    location:      { lat, lng, radiusM },
    businessType,
    overallScore:  score,
    grade:         score >= 80 ? 'A' : score >= 70 ? 'B' : 'C',
    metrics: {
      footTraffic:     Math.floor(Math.random() * 5000) + 2000,
      peakHours:       ['12:00-13:00', '18:00-20:00'],
      avgMonthlyRev:   biz.avgRevenue,
      competition:     biz.competition,
      nearbyCompetitors: Math.floor(Math.random() * 8) + 2,
      survival3y:      biz.survivalRate,
      rentIndex:       Math.floor(Math.random() * 30) + 50,   // 100점 기준
    },
    recommendation: score >= 75
      ? `입지 우수 — ${businessType} 창업 적합`
      : score >= 65
      ? `양호 — 추가 시장 조사 권고`
      : `입지 불리 — 대안 위치 탐색 필요`,
    nearbyPOI: {
      subway: Math.floor(Math.random() * 3) + 1,
      bus:    Math.floor(Math.random() * 5) + 2,
      park:   Math.floor(Math.random() * 2),
    },
    message: '상권 분석 stub — 카카오맵/NICE 상권 API 연동 후 실제 데이터 활성화',
  };
}

// ── 투자 수익률 시뮬레이터 ────────────────────────────────
function simulateInvestmentROI(opts = {}) {
  const {
    purchasePrice   = 500_000_000,   // 취득가
    downPayment     = 200_000_000,   // 자기자본
    monthlyRent     = 1_500_000,     // 월세
    annualPriceGrowth = 0.03,        // 연간 가격 상승률
    holdingYears    = 5,
    loanProduct     = 'dsr_40',
    propertyType    = 'apt',
    maintenancePct  = 0.005,         // 연간 유지비 비율
  } = opts;

  const loan           = LOAN_PRODUCTS[loanProduct] || LOAN_PRODUCTS.dsr_40;
  const propType       = PROPERTY_TYPES[propertyType] || PROPERTY_TYPES.apt;
  const loanAmount     = purchasePrice - downPayment;
  const monthlyRate    = loan.baseRate / 12;
  const totalMonths    = loan.termYears * 12;

  // 월 원리금 (원금균등 근사)
  const monthlyPayment = loanAmount > 0
    ? loanAmount * monthlyRate * Math.pow(1 + monthlyRate, totalMonths)
      / (Math.pow(1 + monthlyRate, totalMonths) - 1)
    : 0;

  // 연간 지출
  const annualLoan        = monthlyPayment * 12;
  const annualMaintenance = purchasePrice * maintenancePct;
  const annualTax         = purchasePrice * propType.taxRate;
  const annualExpense     = annualLoan + annualMaintenance + annualTax;

  // 연간 수입
  const annualRent     = monthlyRent * 12;
  const annualCashflow = annualRent - annualExpense;

  // 시뮬레이션 (연도별)
  let currentValue = purchasePrice;
  const yearlyData = [];
  for (let y = 1; y <= holdingYears; y++) {
    currentValue *= (1 + annualPriceGrowth);
    const capitalGain = currentValue - purchasePrice;
    const totalReturn = capitalGain + annualCashflow * y;
    yearlyData.push({
      year:         y,
      propertyValue: Math.round(currentValue),
      valueLabel:   `${Math.round(currentValue / 1e8).toFixed(1)}억원`,
      capitalGain:  Math.round(capitalGain),
      cashflow:     Math.round(annualCashflow * y),
      totalReturn:  Math.round(totalReturn),
      roi:          parseFloat((totalReturn / downPayment * 100).toFixed(1)),
    });
  }

  const finalYear = yearlyData[holdingYears - 1];

  return {
    input: { purchasePrice, downPayment, monthlyRent, holdingYears, loanProduct },
    loan: {
      amount:         loanAmount,
      monthlyPayment: Math.round(monthlyPayment),
      annualPayment:  Math.round(annualLoan),
      interestRate:   `${(loan.baseRate * 100).toFixed(1)}%`,
    },
    annual: {
      rent:       annualRent,
      expense:    Math.round(annualExpense),
      cashflow:   Math.round(annualCashflow),
      cashflowLabel: annualCashflow >= 0
        ? `+${Math.round(annualCashflow / 10_000)}만원/년 (월 +${Math.round(annualCashflow/12/10_000)}만원)`
        : `${Math.round(annualCashflow / 10_000)}만원/년 적자`,
    },
    simulation:     yearlyData,
    summary: {
      totalROI:   `${finalYear.roi}%`,
      recommendation: finalYear.roi >= 30 ? '매우 우수한 투자처'
        : finalYear.roi >= 15 ? '양호한 투자처'
        : finalYear.roi >= 0  ? '보유 가능 — 수익 낮음'
        : '손실 위험 — 재검토 필요',
    },
  };
}

// ── 인테리어 견적 자동화 ──────────────────────────────────
function estimateInterior(opts = {}) {
  const {
    areaSqm   = 84,
    grade     = 'standard',
    rooms     = { living: 1, bedroom: 2, kitchen: 1, bathroom: 2 },
    includeItems = ['flooring', 'wall', 'ceiling', 'lighting', 'bathroom', 'kitchen'],
  } = opts;

  const gradeInfo = INTERIOR_UNIT_PRICES[grade] || INTERIOR_UNIT_PRICES.standard;
  const pyeong    = areaSqm / 3.305;

  // 항목별 비율
  const ITEM_RATIOS = {
    flooring:   0.20, wall: 0.15, ceiling: 0.08,
    lighting:   0.07, bathroom: 0.20, kitchen: 0.18,
    doors:      0.06, misc: 0.06,
  };

  const totalBase = areaSqm * gradeInfo.perSqm;
  const items     = [];
  let   total     = 0;

  for (const item of includeItems) {
    const ratio   = ITEM_RATIOS[item] || 0.05;
    const cost    = Math.round(totalBase * ratio);
    total        += cost;
    items.push({
      item, ratio,
      cost,
      costLabel: `${Math.round(cost / 10_000)}만원`,
    });
  }

  return {
    areaSqm, pyeong: parseFloat(pyeong.toFixed(1)),
    grade:     gradeInfo.name,
    perSqm:    gradeInfo.perSqm,
    totalCost: total,
    totalLabel:`${Math.round(total / 10_000)}만원 (평당 ${Math.round(total / pyeong / 10_000)}만원)`,
    items,
    timeline:  grade === 'luxury' ? '8~12주' : grade === 'premium' ? '6~8주' : '3~5주',
    tips: [
      '철거 전 구조 검토 필수',
      `${gradeInfo.name} 수준 — 평당 약 ${Math.round(gradeInfo.perSqm / 10_000)}만원 기준`,
      '도배·장판 전문업체 비교견적 3곳 이상 권장',
    ],
  };
}

// ── GIS 등시선 분석 (시간대별 도달 범위) ─────────────────
function analyzeIsochrone(opts = {}) {
  const {
    lat          = 37.5175,
    lng          = 127.0473,
    minutes      = [10, 20, 30],
    transportMode = 'transit',   // transit, walking, driving
  } = opts;

  // stub: 이동 수단별 속도 (km/h)
  const SPEEDS = { walking: 5, transit: 25, driving: 40 };
  const speed  = SPEEDS[transportMode] || 25;

  const zones = minutes.map(min => {
    const radiusKm = speed * min / 60;
    const radiusM  = radiusKm * 1000;
    const areaSqKm = Math.PI * radiusKm * radiusKm;

    // 원 근사 bbox
    const deltaLat = radiusKm / 111;
    const deltaLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

    return {
      minutes: min,
      radiusM: Math.round(radiusM),
      areaSqKm: parseFloat(areaSqKm.toFixed(2)),
      bbox: {
        north: +(lat + deltaLat).toFixed(6),
        south: +(lat - deltaLat).toFixed(6),
        east:  +(lng + deltaLng).toFixed(6),
        west:  +(lng - deltaLng).toFixed(6),
      },
      estimatedPopulation: Math.round(areaSqKm * 8000),  // 서울 평균 인구밀도
    };
  });

  return {
    stub:          true,
    center:        { lat, lng },
    transportMode,
    speed:         `${speed} km/h`,
    zones,
    recommendation: `${minutes[minutes.length-1]}분권 도달 인구: 약 ${(zones[zones.length-1].estimatedPopulation / 10_000).toFixed(0)}만명`,
    message:       '등시선 분석 stub — 네이버 지도 / Kakao Mobility API 연동 후 활성화',
  };
}

// ── 메인 실행 ─────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    mode         = 'transaction',   // transaction | predict | commercial | roi | interior | isochrone
    region       = '강남구',
    propertyType = 'apt',
    coordinates  = null,
    ...rest
  } = opts;

  const startMs = Date.now();
  let result    = {};

  switch (mode) {
    case 'transaction':
      result = await getTransactionHistory({ district: region, type: propertyType, ...rest });
      break;
    case 'predict':
      result = await predictPropertyPrice({ region, type: propertyType, ...rest });
      break;
    case 'commercial':
      result = await analyzeCommercialArea({ ...(coordinates || {}), ...rest });
      break;
    case 'roi':
      result = simulateInvestmentROI({ propertyType, ...rest });
      break;
    case 'interior':
      result = estimateInterior(rest);
      break;
    case 'isochrone':
      result = analyzeIsochrone({ ...(coordinates || {}), ...rest });
      break;
    default:
      return { success: false, error: `알 수 없는 모드: ${mode}` };
  }

  return {
    success:    true,
    domain:     'real_estate',
    mode,
    region,
    propertyType,
    ...result,
    durationMs: Date.now() - startMs,
    meta: {
      availableModes:     ['transaction','predict','commercial','roi','interior','isochrone'],
      propertyTypes:      Object.keys(PROPERTY_TYPES),
      interiorGrades:     Object.keys(INTERIOR_UNIT_PRICES),
      loanProducts:       Object.keys(LOAN_PRODUCTS),
      supportedRegions:   Object.keys(REGION_CODES),
    },
  };
}

module.exports = {
  execute,
  getTransactionHistory,
  predictPropertyPrice,
  analyzeCommercialArea,
  simulateInvestmentROI,
  estimateInterior,
  analyzeIsochrone,
  PROPERTY_TYPES,
  REGION_CODES,
  INTERIOR_UNIT_PRICES,
  LOAN_PRODUCTS,
};
