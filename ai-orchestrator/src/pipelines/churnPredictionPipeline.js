'use strict';
/**
 * churnPredictionPipeline.js — Phase 2-3
 * 이탈 예측 ML 모델 파이프라인 (8건 커버)
 *
 * 고객 데이터 → 피처 엔지니어링 → 이탈 예측 → 세그먼트 분류 → 리텐션 액션 플랜
 * 실제 API 연동 제외 — 피처셋/세그먼트/액션 플랜 로직 완비
 * 실제 연동 시 callMLModelAPI() 교체
 */

// ── 피처 정의 ─────────────────────────────────────────────
const FEATURE_DEFINITIONS = {
  // RFM 기본
  recency: {
    name:        '최근 구매/활동 경과일',
    type:        'numeric',
    importance:  0.22,
    description: '마지막 활동으로부터 경과한 일수 (낮을수록 활성)',
    normalize:   'min_max',
    high_churn:  '>90일',
  },
  frequency: {
    name:        '활동 빈도',
    type:        'numeric',
    importance:  0.18,
    description: '최근 3개월 내 구매/접속 횟수',
    normalize:   'log',
    high_churn:  '<2회',
  },
  monetary: {
    name:        '총 지출 금액',
    type:        'numeric',
    importance:  0.15,
    description: '가입 이래 누적 지출액 (원)',
    normalize:   'log',
    high_churn:  '<10만원',
  },
  // 행동 피처
  session_duration: {
    name:        '평균 세션 시간',
    type:        'numeric',
    importance:  0.12,
    description: '최근 1개월 평균 세션 지속 시간(분)',
    normalize:   'z_score',
    high_churn:  '<3분',
  },
  page_views: {
    name:        '페이지 뷰',
    type:        'numeric',
    importance:  0.10,
    description: '최근 30일 총 페이지 뷰 수',
    normalize:   'log',
    high_churn:  '<5 pv',
  },
  feature_adoption: {
    name:        '기능 활용도',
    type:        'numeric',
    importance:  0.09,
    description: '핵심 기능 중 실제 사용한 기능 비율 (0~1)',
    normalize:   'min_max',
    high_churn:  '<0.3',
  },
  support_tickets: {
    name:        '고객지원 티켓 수',
    type:        'numeric',
    importance:  0.07,
    description: '최근 3개월 내 고객지원 요청 횟수',
    normalize:   'min_max',
    high_churn:  '>3건',
  },
  // 계약/과금
  plan_tier: {
    name:        '요금제 등급',
    type:        'categorical',
    importance:  0.07,
    values:      ['free', 'basic', 'pro', 'enterprise'],
    high_churn:  'free',
  },
  // 생애주기
  customer_age_days: {
    name:        '고객 생애 기간',
    type:        'numeric',
    importance:  0.05,
    description: '가입 이래 경과한 일수',
    normalize:   'log',
    high_churn:  '<30일 또는 >730일',
  },
  nps_score: {
    name:        'NPS 점수',
    type:        'numeric',
    importance:  0.05,
    description: '최근 NPS 조사 점수 (0~10)',
    normalize:   'min_max',
    high_churn:  '<6',
  },
};

// ── 이탈 위험 세그먼트 ────────────────────────────────────
const CHURN_SEGMENTS = {
  critical: {
    label:       '이탈 임박',
    threshold:   { min: 0.80, max: 1.0 },
    color:       '#FF4444',
    icon:        '🔴',
    urgency:     'immediate',
    estimatedChurnDays: '7일 이내',
    actions:     ['urgent_call', 'special_offer', 'executive_outreach'],
  },
  high_risk: {
    label:       '고위험',
    threshold:   { min: 0.60, max: 0.80 },
    color:       '#FF8C00',
    icon:        '🟠',
    urgency:     'high',
    estimatedChurnDays: '30일 이내',
    actions:     ['personal_email', 'discount_offer', 'success_call'],
  },
  medium_risk: {
    label:       '중위험',
    threshold:   { min: 0.40, max: 0.60 },
    color:       '#FFD700',
    icon:        '🟡',
    urgency:     'medium',
    estimatedChurnDays: '90일 이내',
    actions:     ['nurture_campaign', 'feature_tutorial', 'check_in_email'],
  },
  low_risk: {
    label:       '저위험',
    threshold:   { min: 0.20, max: 0.40 },
    color:       '#90EE90',
    icon:        '🟢',
    urgency:     'low',
    estimatedChurnDays: '6개월 이내',
    actions:     ['regular_newsletter', 'product_update', 'loyalty_program'],
  },
  loyal: {
    label:       '충성 고객',
    threshold:   { min: 0.0, max: 0.20 },
    color:       '#4169E1',
    icon:        '💙',
    urgency:     'none',
    estimatedChurnDays: '12개월 이상',
    actions:     ['referral_program', 'beta_access', 'community_invite'],
  },
};

// ── 도메인별 이탈 모델 ────────────────────────────────────
const DOMAIN_MODELS = {
  ecommerce: {
    name:         '이커머스 이탈 모델',
    keyFeatures:  ['recency', 'frequency', 'monetary', 'page_views'],
    avgChurnRate: 0.35,
    baselineModel: 'XGBoost + RFM',
    predictionWindow: '30일',
    usecases:    ['재구매 예측', '장바구니 포기 예측', 'VIP 이탈 경보'],
  },
  b2b: {
    name:         'B2B SaaS 이탈 모델',
    keyFeatures:  ['feature_adoption', 'session_duration', 'support_tickets', 'plan_tier'],
    avgChurnRate: 0.12,
    baselineModel: 'LightGBM + 행동 피처',
    predictionWindow: '60일',
    usecases:    ['계약 갱신 예측', '업셀 적기 감지', 'CSM 우선순위 분류'],
  },
  healthcare: {
    name:         '헬스케어 이탈 모델',
    keyFeatures:  ['recency', 'frequency', 'session_duration', 'nps_score'],
    avgChurnRate: 0.20,
    baselineModel: 'Random Forest + 건강 행동',
    predictionWindow: '90일',
    usecases:    ['앱 이탈 예측', '처방 이행률 예측', '재방문 예측'],
  },
  finance_invest: {
    name:         '금융 이탈 모델',
    keyFeatures:  ['recency', 'monetary', 'frequency', 'plan_tier'],
    avgChurnRate: 0.08,
    baselineModel: 'Neural Network + 거래 패턴',
    predictionWindow: '30일',
    usecases:    ['계좌 해지 예측', '거래 빈도 감소 경보', '이자율 민감도'],
  },
  marketing: {
    name:         '마케팅 구독 이탈 모델',
    keyFeatures:  ['recency', 'page_views', 'session_duration', 'nps_score'],
    avgChurnRate: 0.45,
    baselineModel: 'Logistic Regression + 이메일 지표',
    predictionWindow: '14일',
    usecases:    ['이메일 구독 해제 예측', '앱 삭제 예측', '리텐션 캠페인 타겟팅'],
  },
};

// ── 리텐션 액션 카탈로그 ──────────────────────────────────
const RETENTION_ACTIONS = {
  urgent_call: {
    name:      '긴급 전화 아웃리치',
    channel:   'phone',
    timing:    '즉시 (24시간 이내)',
    effort:    'high',
    costLevel: 'high',
    successRate: 0.45,
    template:  '안녕하세요 {name}님, 최근 서비스 이용에 어려움이 있으신가요? 10분만 통화 가능하신가요?',
  },
  special_offer: {
    name:      '특별 할인 오퍼',
    channel:   'email+sms',
    timing:    '24시간 이내',
    effort:    'medium',
    costLevel: 'medium',
    successRate: 0.38,
    template:  '{name}님만을 위한 {discount}% 특별 할인 쿠폰을 드립니다. 유효기간: {expiry}',
  },
  personal_email: {
    name:      '개인화 이메일',
    channel:   'email',
    timing:    '3일 이내',
    effort:    'medium',
    costLevel: 'low',
    successRate: 0.28,
    template:  '{name}님, {last_used_feature} 기능을 최근 사용하지 않으셨네요. 새로운 기능 {new_feature}을 소개합니다.',
  },
  discount_offer: {
    name:      '할인 제안',
    channel:   'email',
    timing:    '1주일 이내',
    effort:    'low',
    costLevel: 'medium',
    successRate: 0.25,
    template:  '다음 달 구독료 {discount}% 할인 혜택을 드립니다.',
  },
  feature_tutorial: {
    name:      '핵심 기능 온보딩',
    channel:   'in-app+email',
    timing:    '1주일 이내',
    effort:    'medium',
    costLevel: 'low',
    successRate: 0.32,
    template:  '{feature} 기능으로 {benefit}을 달성한 고객 사례를 소개합니다.',
  },
  nurture_campaign: {
    name:      '육성 이메일 캠페인',
    channel:   'email',
    timing:    '시리즈 (2주)',
    effort:    'low',
    costLevel: 'low',
    successRate: 0.20,
    template:  '매주 유용한 팁과 성공 사례를 드립니다.',
  },
  check_in_email: {
    name:      '체크인 이메일',
    channel:   'email',
    timing:    '2주 이내',
    effort:    'low',
    costLevel: 'low',
    successRate: 0.18,
    template:  '{name}님, 잘 지내고 계신가요? 최근 {product}를 어떻게 활용하시는지 궁금합니다.',
  },
  loyalty_program: {
    name:      '로열티 프로그램 안내',
    channel:   'email+in-app',
    timing:    '1개월 이내',
    effort:    'low',
    costLevel: 'low',
    successRate: 0.22,
    template:  '{name}님은 {points}포인트를 보유 중입니다. {reward}로 교환하세요!',
  },
  referral_program: {
    name:      '추천 프로그램',
    channel:   'email+in-app',
    timing:    '지속',
    effort:    'low',
    costLevel: 'low',
    successRate: 0.30,
    template:  '친구를 추천하면 {reward}를 드립니다.',
  },
};

// ─────────────────────────────────────────────────────────
// 피처 엔지니어링
// ─────────────────────────────────────────────────────────
function engineerFeatures(customerData = {}) {
  const features = {};
  const issues   = [];

  for (const [key, def] of Object.entries(FEATURE_DEFINITIONS)) {
    const raw = customerData[key];

    if (raw === undefined || raw === null) {
      features[key] = null;
      issues.push(`피처 누락: ${def.name} (${key})`);
      continue;
    }

    // 정규화
    let normalized = raw;
    if (def.normalize === 'min_max') {
      normalized = Math.min(1, Math.max(0, raw / 100));
    } else if (def.normalize === 'log') {
      normalized = Math.log1p(raw) / Math.log1p(1000);
    } else if (def.normalize === 'z_score') {
      normalized = Math.min(1, Math.max(0, (raw - 30) / 60 + 0.5));
    }

    features[key] = {
      raw,
      normalized: parseFloat(normalized.toFixed(4)),
      importance: def.importance,
      isHighRisk: def.high_churn
        ? String(raw).includes(def.high_churn.replace(/[<>]/g, '').trim())
        : false,
    };
  }

  return { features, issues, featureCount: Object.keys(features).length };
}

// ─────────────────────────────────────────────────────────
// ML 모델 API stub (실제 연동 시 교체)
// ─────────────────────────────────────────────────────────
async function callMLModelAPI(features, domainModel, _apiKey) {
  // ※ 실제 연동 예시:
  // MLflow serving:
  //   const res = await axios.post('http://mlflow-server/invocations', {
  //     columns: Object.keys(features),
  //     data: [Object.values(features).map(f => f?.normalized ?? 0)]
  //   });
  //   return { churnProb: res.data.predictions[0], confidence: 0.92 };
  //
  // Vertex AI:
  //   const endpoint = await aiPlatform.getPredictionServiceClient();
  //   const [response] = await endpoint.predict({ instances: [featureVector] });

  // stub: 피처 기반 휴리스틱 예측
  const vals = Object.values(features)
    .filter(f => f && typeof f.normalized === 'number')
    .map(f => ({ normalized: f.normalized, importance: f.importance, isHighRisk: f.isHighRisk }));

  const riskScore = vals.reduce((sum, f) => {
    const risk = f.isHighRisk ? 0.15 : 0;
    // recency가 높으면 이탈 위험 높음
    return sum + (f.importance * (1 - f.normalized + risk));
  }, 0) / (vals.length || 1);

  const churnProb = Math.min(0.99, Math.max(0.01, riskScore * 1.2));

  return {
    stub:       true,
    churnProb:  parseFloat(churnProb.toFixed(4)),
    confidence: 0.87,
    model:      domainModel.baselineModel + ' (stub)',
    predictionWindow: domainModel.predictionWindow,
    message:    'Churn 예측 stub — ML 모델 API 연동 후 실제 예측 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 세그먼트 분류
// ─────────────────────────────────────────────────────────
function classifySegment(churnProb) {
  for (const [key, seg] of Object.entries(CHURN_SEGMENTS)) {
    if (churnProb >= seg.threshold.min && churnProb < seg.threshold.max) {
      return { key, ...seg };
    }
  }
  return { key: 'loyal', ...CHURN_SEGMENTS.loyal };
}

// ─────────────────────────────────────────────────────────
// 리텐션 액션 플랜 생성
// ─────────────────────────────────────────────────────────
function buildActionPlan(segment, customerData = {}, domain = 'b2b') {
  const actions    = segment.actions || [];
  const planItems  = actions.map(actionKey => {
    const action = RETENTION_ACTIONS[actionKey];
    if (!action) return null;
    return {
      key:         actionKey,
      name:        action.name,
      channel:     action.channel,
      timing:      action.timing,
      effort:      action.effort,
      costLevel:   action.costLevel,
      successRate: action.successRate,
      message:     action.template
        .replace('{name}', customerData.name || '고객')
        .replace('{discount}', '20')
        .replace('{feature}', '핵심 기능')
        .replace('{benefit}', '업무 효율 30% 향상')
        .replace('{points}', '1,250')
        .replace('{reward}', '1개월 무료 구독')
        .replace('{last_used_feature}', '대시보드')
        .replace('{new_feature}', 'AI 자동화 기능')
        .replace('{product}', domain)
        .replace('{expiry}', '7일 후')
    };
  }).filter(Boolean);

  const expectedLTV = customerData.monetary
    ? customerData.monetary * (1 - segment.threshold.min) * 12
    : 0;

  return {
    segment:          segment.label,
    urgency:          segment.urgency,
    actions:          planItems,
    primaryAction:    planItems[0] || null,
    expectedROI:      planItems[0]
      ? `${Math.round(planItems[0].successRate * 100)}% 리텐션 가능성`
      : '데이터 부족',
    estimatedLTVSaved: expectedLTV > 0
      ? `₩${Math.round(expectedLTV / 10000)}만원`
      : '계산 불가',
  };
}

// ─────────────────────────────────────────────────────────
// 배치 분석 (여러 고객 한번에)
// ─────────────────────────────────────────────────────────
async function executeBatch(customers = [], domain = 'b2b', apiKey = null) {
  const results = [];
  let criticalCount = 0;

  for (const customer of customers) {
    const r = await execute({ customerData: customer, domain, apiKey });
    if (r.success && r.churnProbability > 0.8) criticalCount++;
    results.push({ customerId: customer.id || customer.email, ...r });
  }

  const avgChurnProb = results.reduce((s, r) => s + (r.churnProbability || 0), 0) / (results.length || 1);

  return {
    success:      true,
    batchSize:    customers.length,
    avgChurnProb: parseFloat(avgChurnProb.toFixed(3)),
    criticalCount,
    segmentDistribution: {
      critical:    results.filter(r => r.segment?.key === 'critical').length,
      high_risk:   results.filter(r => r.segment?.key === 'high_risk').length,
      medium_risk: results.filter(r => r.segment?.key === 'medium_risk').length,
      low_risk:    results.filter(r => r.segment?.key === 'low_risk').length,
      loyal:       results.filter(r => r.segment?.key === 'loyal').length,
    },
    results,
  };
}

// ─────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    customerData  = {},
    domain        = 'b2b',
    includeAction = true,
    apiKey        = null,
  } = opts;

  const startMs    = Date.now();
  const domainModel = DOMAIN_MODELS[domain] || DOMAIN_MODELS.b2b;

  // Step 1: 피처 엔지니어링
  const { features, issues } = engineerFeatures(customerData);

  // Step 2: 예측
  const prediction = await callMLModelAPI(features, domainModel, apiKey);

  // Step 3: 세그먼트 분류
  const segment = classifySegment(prediction.churnProb);

  // Step 4: 액션 플랜
  const actionPlan = includeAction
    ? buildActionPlan(segment, customerData, domain)
    : null;

  return {
    success:          true,
    pipeline:         'churnPrediction',
    customerId:       customerData.id || customerData.email || 'unknown',
    domain,
    churnProbability: prediction.churnProb,
    churnRisk:        `${Math.round(prediction.churnProb * 100)}%`,
    confidence:       prediction.confidence,
    segment,
    actionPlan,
    featureIssues:    issues,
    predictionModel:  prediction.model,
    predictionWindow: prediction.predictionWindow,
    stub:             prediction.stub,
    durationMs:       Date.now() - startMs,
    readyToUse:       !prediction.stub,
    meta: {
      availableDomains:  Object.keys(DOMAIN_MODELS),
      featureCount:      Object.keys(FEATURE_DEFINITIONS).length,
      segmentTypes:      Object.keys(CHURN_SEGMENTS),
    },
  };
}

module.exports = {
  execute,
  executeBatch,
  engineerFeatures,
  classifySegment,
  buildActionPlan,
  FEATURE_DEFINITIONS,
  CHURN_SEGMENTS,
  DOMAIN_MODELS,
  RETENTION_ACTIONS,
};
