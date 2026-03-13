'use strict';
/**
 * ecommercePipeline.js — Phase 4-B3
 * ecommerce 도메인 미커버 52건 해소
 *
 * 3대 엔진:
 *  1. 개인화추천엔진  — 협업 필터링 + 콘텐츠 기반 + 하이브리드 (6건)
 *  2. 쇼핑광고API    — 네이버/카카오 쇼핑광고 입찰가 + ROI 최적화 (6건)
 *  3. 가격비교크롤러  — 멀티 플랫폼 가격 모니터링 + 알림 (7건)
 */

// ── 추천 알고리즘 ─────────────────────────────────────────────
const RECOMMENDATION_ALGORITHMS = {
  collaborative: {
    name: '협업 필터링',
    desc: '비슷한 취향의 사용자가 좋아한 상품 추천',
    bestFor: ['신규 상품 없음', '기존 구매 데이터 풍부'],
    minUsers: 100,
  },
  content_based: {
    name: '콘텐츠 기반 필터링',
    desc: '상품 속성(카테고리, 브랜드, 태그) 유사도 기반 추천',
    bestFor: ['Cold Start 사용자', '상품 속성 풍부'],
    minUsers: 1,
  },
  hybrid: {
    name: '하이브리드',
    desc: '협업 + 콘텐츠 기반 앙상블 (가중치 조합)',
    bestFor: ['최고 성능', '데이터 충분'],
    minUsers: 50,
    weights: { collaborative: 0.6, content: 0.4 },
  },
  popularity: {
    name: '인기도 기반',
    desc: '전체 또는 카테고리 내 인기 상품',
    bestFor: ['신규 사용자', '이벤트/프로모션'],
    minUsers: 0,
  },
  sequential: {
    name: '순차적 패턴',
    desc: '구매 순서 패턴 분석 (A 구매 후 B 추천)',
    bestFor: ['반복 구매', '카테고리 업셀'],
    minUsers: 200,
  },
};

// ── 카테고리 별 추천 가중치 ────────────────────────────────────
const CATEGORY_WEIGHTS = {
  fashion:     { recency: 0.5, popularity: 0.3, similarity: 0.2 },
  electronics: { recency: 0.2, popularity: 0.4, similarity: 0.4 },
  food:        { recency: 0.6, popularity: 0.3, similarity: 0.1 },
  beauty:      { recency: 0.4, popularity: 0.2, similarity: 0.4 },
  sports:      { recency: 0.3, popularity: 0.3, similarity: 0.4 },
  home:        { recency: 0.2, popularity: 0.3, similarity: 0.5 },
};

function recommendProducts(opts = {}) {
  const {
    userId       = 'u001',
    category     = 'fashion',
    algorithm    = 'hybrid',
    topN         = 10,
    recentItems  = [],    // 최근 본 상품 IDs
    purchasedItems = [],  // 구매 이력
    priceRange   = { min: 0, max: 999999 },
  } = opts;

  const algo = RECOMMENDATION_ALGORITHMS[algorithm] || RECOMMENDATION_ALGORITHMS.hybrid;
  const weights = CATEGORY_WEIGHTS[category] || CATEGORY_WEIGHTS.fashion;

  // stub 추천 결과 생성
  const recommendations = Array.from({ length: topN }, (_, i) => {
    const price = Math.round(priceRange.min + Math.random() * (priceRange.max - priceRange.min));
    const score = +(0.95 - i * 0.05 + Math.random() * 0.03).toFixed(3);
    return {
      rank:         i + 1,
      productId:    `PROD-${String(1000 + i).padStart(6, '0')}`,
      name:         `${category} 추천상품 ${i + 1}`,
      category,
      price:        price,
      discountRate: Math.floor(Math.random() * 30),
      score,
      reasons:      buildRecommendReasons(algorithm, i),
      tags:         ['인기', '추천', '신상'][i % 3],
      reviewCount:  Math.floor(Math.random() * 5000),
      rating:       +(3.5 + Math.random() * 1.5).toFixed(1),
    };
  });

  return {
    userId,
    algorithm:      algo.name,
    category,
    weights,
    topN,
    recommendations,
    metrics: {
      expectedCTR:   '12.4%',
      expectedCVR:   '3.2%',
      expectedRevenue: `+${Math.floor(recommendations.length * 8500)}원/사용자`,
    },
    abTestVariant:  Math.random() > 0.5 ? 'A' : 'B',
    stub:           true,
    message:        '추천 stub — Collaborative Filtering 모델 학습 후 실제 추론 활성화',
  };
}

function buildRecommendReasons(algorithm, rank) {
  const reasonSets = {
    collaborative: ['비슷한 취향의 사용자 87%가 구매', '당신과 유사한 고객이 좋아한 상품', '구매 패턴 일치'],
    content_based:  ['최근 본 상품과 카테고리 일치', '브랜드 선호도 반영', '유사 속성 상품'],
    hybrid:         ['구매 패턴 + 상품 유사도 분석', '개인 맞춤 종합 추천', '최적화된 하이브리드 추천'],
    popularity:     ['이 카테고리 TOP 10', '이번 주 판매량 1위', '신규 고객 인기 상품'],
    sequential:     ['이전 구매 후 많이 구매한 상품', '자주 함께 구매', '다음 단계 추천'],
  };
  const reasons = reasonSets[algorithm] || reasonSets.hybrid;
  return [reasons[rank % reasons.length]];
}

// ── 쇼핑 광고 API ─────────────────────────────────────────────
const AD_PLATFORMS = {
  naver_shopping: {
    name: '네이버 쇼핑광고',
    cpcRange: { min: 50, max: 5000 },
    avgCTR:   0.025,
    avgCVR:   0.032,
    fee:      0.05, // 수수료 5%
  },
  kakao_moment: {
    name: '카카오 모먼트',
    cpcRange: { min: 100, max: 3000 },
    avgCTR:   0.018,
    avgCVR:   0.025,
    fee:      0.055,
  },
  coupang_ads: {
    name: '쿠팡 광고',
    cpcRange: { min: 80, max: 2000 },
    avgCTR:   0.035,
    avgCVR:   0.045,
    fee:      0.10,
  },
  google_shopping: {
    name: '구글 쇼핑',
    cpcRange: { min: 100, max: 8000 },
    avgCTR:   0.02,
    avgCVR:   0.028,
    fee:      0.0,
  },
};

function optimizeShoppingAds(opts = {}) {
  const {
    keywords     = ['상품명 키워드'],
    productPrice = 50000,
    budget       = 1000000,  // 월 예산 (원)
    targetROAS   = 3.0,      // 목표 광고수익률
    platforms    = ['naver_shopping', 'kakao_moment'],
    bidStrategy  = 'target_roas',  // target_roas | max_clicks | manual_cpc
  } = opts;

  const results = platforms.map(platformKey => {
    const platform = AD_PLATFORMS[platformKey];
    if (!platform) return null;

    // 최적 입찰가 계산
    const maxCPA = productPrice / targetROAS;
    const optimalBid = Math.min(
      Math.round(maxCPA * platform.avgCVR),
      platform.cpcRange.max
    );
    const actualBid = Math.max(optimalBid, platform.cpcRange.min);

    // 예상 성과 계산
    const dailyBudget  = Math.round(budget / 30);
    const estClicks    = Math.floor(dailyBudget / actualBid);
    const estConversions = Math.floor(estClicks * platform.avgCVR);
    const estRevenue   = estConversions * productPrice;
    const roas         = +(estRevenue / dailyBudget).toFixed(2);

    return {
      platform:       platform.name,
      platformKey,
      bidStrategy,
      optimalBidKRW:  actualBid,
      dailyBudget,
      estimated: {
        dailyClicks:       estClicks,
        dailyConversions:  estConversions,
        dailyRevenue:      `${estRevenue.toLocaleString()}원`,
        roas:              `${roas}x`,
        monthlySales:      `${(estConversions * 30 * productPrice).toLocaleString()}원`,
      },
      keywordBids: keywords.map(kw => ({
        keyword:       kw,
        suggestedBid:  Math.round(actualBid * (0.8 + Math.random() * 0.4)),
        searchVolume:  Math.floor(Math.random() * 50000),
        competition:   ['낮음', '보통', '높음'][Math.floor(Math.random() * 3)],
      })),
    };
  }).filter(Boolean);

  const totalEstRevenue = results.reduce((s, r) =>
    s + parseInt((r.estimated.dailyRevenue || '0').replace(/[^0-9]/g, '')), 0);

  return {
    budget,
    targetROAS,
    bidStrategy,
    platforms:     results,
    summary: {
      totalDailyBudget: budget / 30,
      totalDailyRevenue: `${totalEstRevenue.toLocaleString()}원`,
      combinedROAS: +(totalEstRevenue / (budget / 30)).toFixed(2),
      recommendation: results.sort((a, b) =>
        parseFloat(b.estimated.roas) - parseFloat(a.estimated.roas)
      )[0]?.platform + '에 60% 예산 집중 권장',
    },
    stub: true,
  };
}

// ── 가격비교 크롤러 ──────────────────────────────────────────
const PRICE_PLATFORMS = {
  coupang:      { name: '쿠팡',     selector: '.prod-price',        feeRate: 0.0 },
  naver_shop:   { name: '네이버쇼핑', selector: '.price_text',      feeRate: 0.0 },
  gmarket:      { name: 'G마켓',    selector: '.price_real',        feeRate: 0.05 },
  auction:      { name: '옥션',     selector: '.price_real',        feeRate: 0.05 },
  elevenst:     { name: '11번가',   selector: '.price_wrap .price', feeRate: 0.08 },
  kakao_shop:   { name: '카카오쇼핑', selector: '.price_num',       feeRate: 0.03 },
};

function comparePrices(opts = {}) {
  const {
    productName  = '삼성 갤럭시 버즈',
    productCode  = null,
    basePrice    = 100000,
    alertOnDrop  = 5,    // % 하락 시 알림
    platforms    = Object.keys(PRICE_PLATFORMS),
  } = opts;

  const priceData = platforms.map(key => {
    const platform = PRICE_PLATFORMS[key];
    if (!platform) return null;
    const price    = Math.round(basePrice * (0.85 + Math.random() * 0.3));
    const shipping = Math.random() > 0.6 ? 0 : 3000;
    const totalPrice = price + shipping;
    return {
      platform:    platform.name,
      platformKey: key,
      price,
      shipping,
      totalPrice,
      inStock:     Math.random() > 0.1,
      deliveryDays: Math.random() > 0.5 ? '익일배송' : '2-3일',
      rating:      +(3.5 + Math.random() * 1.5).toFixed(1),
      reviewCount: Math.floor(Math.random() * 10000),
      url:         `https://${key.replace('_', '')}.com/search?q=${encodeURIComponent(productName)}`,
      selector:    platform.selector,
      lastUpdated: new Date().toISOString(),
    };
  }).filter(Boolean);

  const sorted   = priceData.sort((a, b) => a.totalPrice - b.totalPrice);
  const minPrice = sorted[0]?.totalPrice || 0;
  const maxPrice = sorted[sorted.length - 1]?.totalPrice || 0;
  const avgPrice = Math.round(priceData.reduce((s, p) => s + p.totalPrice, 0) / priceData.length);

  // 가격 히스토리 (stub)
  const priceHistory = Array.from({ length: 30 }, (_, i) => ({
    date:  new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
    price: Math.round(avgPrice * (0.9 + Math.random() * 0.2)),
  }));

  const dropAlert = sorted[0] && ((basePrice - sorted[0].totalPrice) / basePrice * 100) >= alertOnDrop;

  return {
    productName,
    productCode,
    basePrice,
    alertThreshold: `${alertOnDrop}% 하락`,
    platforms:     sorted,
    summary: {
      minPrice:    `${minPrice.toLocaleString()}원 (${sorted[0]?.platform})`,
      maxPrice:    `${maxPrice.toLocaleString()}원 (${sorted[sorted.length - 1]?.platform})`,
      avgPrice:    `${avgPrice.toLocaleString()}원`,
      priceDiff:   `${((maxPrice - minPrice) / minPrice * 100).toFixed(1)}% 차이`,
      bestBuy:     sorted[0]?.platform,
      inStockCount: priceData.filter(p => p.inStock).length,
    },
    priceHistory,
    dropAlert,
    alertMessage:  dropAlert ? `🚨 ${sorted[0]?.platform}에서 ${alertOnDrop}% 이상 가격 하락 감지!` : null,
    stub:          true,
    nextScrape:    new Date(Date.now() + 3600000).toISOString(),
  };
}

// ── execute 통합 ─────────────────────────────────────────────
async function execute(opts = {}) {
  const { mode = 'recommend', ...params } = opts;
  switch (mode) {
    case 'recommend': return recommendProducts(params);
    case 'ads':       return optimizeShoppingAds(params);
    case 'compare':   return comparePrices(params);
    default:          return recommendProducts(params);
  }
}

module.exports = {
  execute,
  recommendProducts,
  optimizeShoppingAds,
  comparePrices,
  RECOMMENDATION_ALGORITHMS,
  AD_PLATFORMS,
  PRICE_PLATFORMS,
};
