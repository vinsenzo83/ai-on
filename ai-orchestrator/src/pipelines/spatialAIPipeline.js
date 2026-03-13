'use strict';
/**
 * spatialAIPipeline.js — Phase 2-4
 * 공간인식 AI 파이프라인 (10건 커버)
 *
 * 이미지/좌표/도면 → 공간 분석 → AR 배치 → 면적/거리 측정 → 인테리어 시뮬레이션
 * 실제 API 연동 제외 — 공간 분석/AR/GIS 로직 완비
 * 실제 연동 시 callSpatialAPI() 교체
 */

// ── 분석 모드 ─────────────────────────────────────────────
const ANALYSIS_MODES = {
  floor_plan: {
    name:        '평면도 분석',
    description: '도면 이미지 → 방 구분 → 면적 계산 → 동선 분석',
    inputs:      ['image', 'pdf', 'dwg', 'svg'],
    outputs:     ['room_map', 'area_report', 'flow_analysis'],
    domains:     ['real_estate', 'architecture'],
    avgMs:       3000,
  },
  ar_placement: {
    name:        'AR 가구 배치',
    description: '공간 인식 → 평면 감지 → 3D 오브젝트 배치 → 시뮬레이션',
    inputs:      ['camera_feed', 'image', 'depth_map'],
    outputs:     ['ar_scene', 'placement_suggestion', 'collision_check'],
    domains:     ['real_estate', 'ecommerce'],
    avgMs:       2000,
  },
  property_valuation: {
    name:        '부동산 가치 분석',
    description: '위치 + 공간 데이터 → 유사 매물 비교 → 가격 추정',
    inputs:      ['coordinates', 'address', 'building_data'],
    outputs:     ['valuation_report', 'comparable_sales', 'market_trend'],
    domains:     ['real_estate', 'finance_invest'],
    avgMs:       4000,
  },
  crowd_analysis: {
    name:        '군중 밀도 분석',
    description: '공간 내 인원 감지 → 밀도 맵 → 최적 동선 제안',
    inputs:      ['image', 'video', 'sensor_data'],
    outputs:     ['density_map', 'flow_optimization', 'safety_report'],
    domains:     ['government', 'marketing', 'real_estate'],
    avgMs:       2500,
  },
  store_analytics: {
    name:        '매장 공간 분석',
    description: '매장 레이아웃 → 고객 동선 히트맵 → 진열 최적화 추천',
    inputs:      ['floor_plan', 'camera_data', 'sales_data'],
    outputs:     ['heatmap', 'conversion_zones', 'layout_recommendation'],
    domains:     ['ecommerce', 'marketing', 'real_estate'],
    avgMs:       3500,
  },
  geospatial: {
    name:        '지리공간 분석',
    description: 'GIS 데이터 → 상권 분석 → 입지 최적화',
    inputs:      ['coordinates', 'geojson', 'map_data'],
    outputs:     ['catchment_area', 'competitor_map', 'site_score'],
    domains:     ['real_estate', 'b2b', 'government'],
    avgMs:       5000,
  },
};

// ── 공간 측정 유닛 ────────────────────────────────────────
const MEASUREMENT_UNITS = {
  metric:   { area: 'm²', distance: 'm',   volume: 'm³' },
  imperial: { area: 'ft²', distance: 'ft', volume: 'ft³' },
  pyeong:   { area: '평',  distance: 'm',   volume: 'm³' },   // 한국 부동산
};

// ── 부동산 분석 기준 ─────────────────────────────────────
const REAL_ESTATE_BENCHMARKS = {
  // 용도별 평균 면적 (m²)
  studio:     { min: 20,  max: 40,  avg: 28,  name: '원룸' },
  apt_1br:    { min: 33,  max: 66,  avg: 49,  name: '아파트 1룸' },
  apt_2br:    { min: 59,  max: 99,  avg: 76,  name: '아파트 2룸' },
  apt_3br:    { min: 85,  max: 135, avg: 109, name: '아파트 3룸' },
  office:     { min: 16,  max: 33,  avg: 24,  name: '사무실/인' },
  retail:     { min: 10,  max: 330, avg: 66,  name: '소매점' },
  warehouse:  { min: 100, max: 3300,avg: 660, name: '창고' },
};

// ── AR 오브젝트 카탈로그 ──────────────────────────────────
const AR_OBJECTS = {
  furniture: {
    sofa:      { dims: [2.2, 0.85, 0.9],  weight: 45, name: '소파 3인용' },
    dining_table: { dims: [1.6, 0.9, 0.75], weight: 30, name: '다이닝 테이블' },
    bed_queen: { dims: [1.6, 2.0, 0.5],  weight: 60, name: '퀸사이즈 침대' },
    wardrobe:  { dims: [1.8, 0.6, 2.1],  weight: 80, name: '붙박이장' },
    desk:      { dims: [1.4, 0.7, 0.75], weight: 25, name: '책상' },
  },
  appliances: {
    refrigerator: { dims: [0.7, 0.7, 1.8], weight: 80, name: '냉장고 양문형' },
    washing_machine: { dims: [0.6, 0.6, 0.85], weight: 65, name: '세탁기' },
    tv_65:     { dims: [1.45, 0.05, 0.84], weight: 22, name: 'TV 65인치' },
    ac_stand:  { dims: [0.5, 0.38, 1.75], weight: 32, name: '스탠드형 에어컨' },
  },
  decor: {
    plant_large: { dims: [0.6, 0.6, 1.5], weight: 8, name: '대형 화분' },
    bookshelf:   { dims: [0.8, 0.3, 1.8], weight: 35, name: '책장 5단' },
    rug_large:   { dims: [2.0, 3.0, 0.01], weight: 5, name: '대형 러그' },
  },
};

// ── GIS/상권 분석 지표 ────────────────────────────────────
const GIS_INDICATORS = {
  population_density:  { weight: 0.25, desc: '반경 500m 인구 밀도' },
  foot_traffic:        { weight: 0.20, desc: '유동인구 지수' },
  competitor_distance: { weight: 0.15, desc: '가장 가까운 경쟁사 거리' },
  transit_access:      { weight: 0.15, desc: '대중교통 접근성 점수' },
  income_level:        { weight: 0.10, desc: '주변 평균 소득 수준' },
  parking_availability:{ weight: 0.10, desc: '주차 가능 여부' },
  growth_trend:        { weight: 0.05, desc: '상권 성장 추세' },
};

// ─────────────────────────────────────────────────────────
// 평면도 분석
// ─────────────────────────────────────────────────────────
function analyzeFloorPlan(opts = {}) {
  const {
    imageDimensions = { width: 1000, height: 800 },
    scale           = 0.01,   // 픽셀당 미터
    unit            = 'metric',
  } = opts;

  // stub: 픽셀 → 실제 크기 변환
  const realWidth  = imageDimensions.width  * scale;
  const realHeight = imageDimensions.height * scale;
  const totalArea  = realWidth * realHeight;

  const units = MEASUREMENT_UNITS[unit] || MEASUREMENT_UNITS.metric;
  const pyeong = unit === 'pyeong' ? totalArea / 3.305 : null;

  // 방 감지 stub
  const rooms = [
    { id: 'living', name: '거실', area: totalArea * 0.35, type: 'living', color: '#AED6F1' },
    { id: 'master_bed', name: '안방', area: totalArea * 0.20, type: 'bedroom', color: '#A9DFBF' },
    { id: 'room2', name: '방 2', area: totalArea * 0.15, type: 'bedroom', color: '#A9DFBF' },
    { id: 'kitchen', name: '주방', area: totalArea * 0.12, type: 'kitchen', color: '#FAD7A0' },
    { id: 'bath1', name: '욕실', area: totalArea * 0.08, type: 'bathroom', color: '#D2B4DE' },
    { id: 'entry', name: '현관', area: totalArea * 0.05, type: 'entry', color: '#F0E68C' },
  ];

  // 평수 분류
  const benchmark = totalArea > 110 ? REAL_ESTATE_BENCHMARKS.apt_3br
    : totalArea > 75  ? REAL_ESTATE_BENCHMARKS.apt_2br
    : totalArea > 46  ? REAL_ESTATE_BENCHMARKS.apt_1br
    : REAL_ESTATE_BENCHMARKS.studio;

  return {
    totalArea:   parseFloat(totalArea.toFixed(2)),
    unitLabel:   units.area,
    pyeong:      pyeong ? parseFloat(pyeong.toFixed(1)) : null,
    rooms,
    roomCount:   rooms.length,
    typeMatch:   benchmark.name,
    dimensions:  { width: parseFloat(realWidth.toFixed(2)), height: parseFloat(realHeight.toFixed(2)) },
    stub:        true,
  };
}

// ─────────────────────────────────────────────────────────
// AR 배치 계획
// ─────────────────────────────────────────────────────────
function planARPlacement(roomArea = 20, objectKeys = ['sofa', 'dining_table', 'bed_queen']) {
  const placements = [];
  let usedArea = 0;

  for (const key of objectKeys) {
    // 카테고리에서 오브젝트 찾기
    let obj = null;
    for (const cat of Object.values(AR_OBJECTS)) {
      if (cat[key]) { obj = { key, ...cat[key] }; break; }
    }
    if (!obj) continue;

    const footprint = obj.dims[0] * obj.dims[1];
    usedArea += footprint;

    const fits = usedArea <= roomArea * 0.6;   // 60% 이상 채우지 않도록
    placements.push({
      object:    obj.name,
      key,
      dims:      obj.dims,
      footprint: parseFloat(footprint.toFixed(2)),
      fits,
      suggestion: fits
        ? `배치 가능 (공간 활용률: ${Math.round(usedArea / roomArea * 100)}%)`
        : '공간 초과 — 더 작은 가구 추천',
      position: fits ? {
        x: Math.random() * 3 - 1.5,
        y: 0,
        z: Math.random() * 3 - 1.5,
      } : null,
    });
  }

  return {
    roomArea,
    totalFootprint:  parseFloat(usedArea.toFixed(2)),
    utilizationRate: parseFloat((usedArea / roomArea * 100).toFixed(1)),
    placements,
    recommendation:  usedArea / roomArea > 0.6
      ? '배치 밀도가 높습니다. 일부 가구 제거 추천'
      : '쾌적한 공간 구성입니다',
    stub: true,
  };
}

// ─────────────────────────────────────────────────────────
// 부동산 가치 추정
// ─────────────────────────────────────────────────────────
function estimatePropertyValue(opts = {}) {
  const {
    address      = '',
    areaM2       = 84,
    floor        = 5,
    totalFloors  = 15,
    buildingAge  = 10,
    nearbyStations = 1,
    recentPrices = [],   // [{area, price}]
  } = opts;

  // 기준 단가 (서울 평균 stub)
  const baseUnitPrice = 8_000_000;   // 원/m²

  // 조정 계수
  const floorAdj   = floor > totalFloors * 0.7 ? 1.05 : floor < 3 ? 0.95 : 1.0;
  const ageAdj     = buildingAge < 5 ? 1.10 : buildingAge < 15 ? 1.0 : buildingAge < 30 ? 0.90 : 0.80;
  const transitAdj = nearbyStations > 0 ? 1.05 : 0.95;

  const adjustedUnitPrice = baseUnitPrice * floorAdj * ageAdj * transitAdj;
  const estimatedPrice    = areaM2 * adjustedUnitPrice;

  // 유사 매물 stub
  const comparables = recentPrices.length > 0
    ? recentPrices
    : [
        { area: areaM2 - 5, price: estimatedPrice * 0.92, date: '2025-12', note: '동일 단지' },
        { area: areaM2 + 3, price: estimatedPrice * 1.05, date: '2026-01', note: '인근 단지' },
        { area: areaM2,     price: estimatedPrice * 0.98, date: '2026-02', note: '동일 면적' },
      ];

  const avgComparablePrice = comparables.reduce((s, c) => s + c.price / (c.area / areaM2), 0) / comparables.length;

  return {
    estimatedPrice:      Math.round(estimatedPrice),
    estimatedPriceLabel: `₩${(estimatedPrice / 1e8).toFixed(2)}억`,
    unitPrice:           Math.round(adjustedUnitPrice),
    pyeong:              parseFloat((areaM2 / 3.305).toFixed(1)),
    adjustments:         { floor: floorAdj, age: ageAdj, transit: transitAdj },
    comparables,
    avgComparablePrice:  Math.round(avgComparablePrice),
    priceRange: {
      low:  Math.round(estimatedPrice * 0.92),
      high: Math.round(estimatedPrice * 1.08),
    },
    confidence: 0.75,
    stub:       true,
  };
}

// ─────────────────────────────────────────────────────────
// 상권/입지 분석
// ─────────────────────────────────────────────────────────
function analyzeGeospatial(opts = {}) {
  const {
    lat           = 37.5665,
    lng           = 126.9780,
    radiusM       = 500,
    businessType  = 'retail',
    indicators    = Object.keys(GIS_INDICATORS),
  } = opts;

  // stub: 지표별 랜덤 스코어 생성 (실제는 카카오맵/네이버 지도 API 호출)
  const scores = {};
  let totalScore = 0;

  for (const indicator of indicators) {
    const def   = GIS_INDICATORS[indicator];
    if (!def) continue;
    const score = 50 + Math.floor(Math.random() * 40);   // 50~90점
    scores[indicator] = { score, weight: def.weight, desc: def.desc };
    totalScore += score * def.weight;
  }

  const overallScore = Math.round(totalScore);

  return {
    location:     { lat, lng, address: '서울시 (stub 주소)' },
    radiusM,
    businessType,
    overallScore,
    grade:        overallScore >= 80 ? 'A' : overallScore >= 70 ? 'B' : overallScore >= 60 ? 'C' : 'D',
    recommendation: overallScore >= 75
      ? '입지 우수 — 출점 권고'
      : overallScore >= 60
      ? '양호 — 추가 조사 후 결정'
      : '입지 불리 — 대안 검토 필요',
    indicators:   scores,
    nearbyPOIs: {
      stations:    Math.floor(Math.random() * 3),
      schools:     Math.floor(Math.random() * 5),
      hospitals:   Math.floor(Math.random() * 3),
      competitors: Math.floor(Math.random() * 8),
    },
    catchmentPopulation: Math.floor(Math.random() * 50000) + 10000,
    stub: true,
  };
}

// ─────────────────────────────────────────────────────────
// 공간 API stub
// ─────────────────────────────────────────────────────────
async function callSpatialAPI(mode, input, _apiKey) {
  // ※ 실제 연동 예시:
  // 카카오 지도 API:
  //   const res = await axios.get(`https://dapi.kakao.com/v2/local/geo/coord2address`, {
  //     headers: { Authorization: `KakaoAK ${apiKey}` },
  //     params: { x: input.lng, y: input.lat }
  //   });
  //
  // Google Cloud Vision (floor plan):
  //   const [result] = await visionClient.documentTextDetection(imageBuffer);
  //
  // Apple ARKit / Google ARCore → WebXR API

  const modeConfig = ANALYSIS_MODES[mode];
  if (!modeConfig) throw new Error(`지원하지 않는 분석 모드: ${mode}`);

  return {
    stub:    true,
    mode,
    modeName: modeConfig.name,
    outputs: modeConfig.outputs,
    message: `공간 분석 stub (${modeConfig.name}) — 실제 API 연동 후 활성화`,
    estimatedMs: modeConfig.avgMs,
  };
}

// ─────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    mode         = 'floor_plan',
    imageData    = null,
    coordinates  = null,
    floorPlanOpts= {},
    arOpts       = {},
    propertyOpts = {},
    geoOpts      = {},
    domain       = 'real_estate',
    apiKey       = null,
  } = opts;

  const startMs = Date.now();

  // Step 1: API 호출 (stub)
  const apiResult = await callSpatialAPI(mode, { imageData, coordinates }, apiKey);

  // Step 2: 모드별 전문 분석
  let analysis = {};

  switch (mode) {
    case 'floor_plan':
      analysis = analyzeFloorPlan(floorPlanOpts);
      break;
    case 'ar_placement':
      analysis = planARPlacement(
        arOpts.roomArea    || 20,
        arOpts.objectKeys  || ['sofa', 'dining_table', 'tv_65'],
      );
      break;
    case 'property_valuation':
      analysis = estimatePropertyValue(propertyOpts);
      break;
    case 'geospatial':
      analysis = analyzeGeospatial({ ...geoOpts, ...coordinates });
      break;
    case 'store_analytics': {
      const floorResult = analyzeFloorPlan({ ...floorPlanOpts, scale: 0.02 });
      const geoResult   = analyzeGeospatial({ ...geoOpts, businessType: 'retail' });
      analysis = { floorPlan: floorResult, geospatial: geoResult };
      break;
    }
    case 'crowd_analysis':
      analysis = {
        detectedPeople:   Math.floor(Math.random() * 50) + 5,
        densityLevel:     'medium',
        hotspots:         [{ area: '입구', density: 'high' }, { area: '중앙', density: 'medium' }],
        recommendation:   '동선 분산 필요',
        stub:             true,
      };
      break;
    default:
      analysis = { message: '분석 모드 미지원', stub: true };
  }

  return {
    success:    true,
    pipeline:   'spatialAI',
    mode,
    modeName:   ANALYSIS_MODES[mode]?.name || mode,
    domain,
    analysis,
    apiResult,
    durationMs: Date.now() - startMs,
    readyToUse: false,
    meta: {
      availableModes:    Object.keys(ANALYSIS_MODES),
      availableUnits:    Object.keys(MEASUREMENT_UNITS),
      arObjectCount:     Object.values(AR_OBJECTS).reduce((s, c) => s + Object.keys(c).length, 0),
      gisIndicators:     Object.keys(GIS_INDICATORS),
    },
  };
}

module.exports = {
  execute,
  analyzeFloorPlan,
  planARPlacement,
  estimatePropertyValue,
  analyzeGeospatial,
  ANALYSIS_MODES,
  MEASUREMENT_UNITS,
  REAL_ESTATE_BENCHMARKS,
  AR_OBJECTS,
  GIS_INDICATORS,
};
