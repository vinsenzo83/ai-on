'use strict';
/**
 * pipelineManager.js — Phase 1 + Phase 2 통합 매니저
 * 모든 파이프라인의 단일 진입점
 *
 * Phase 1 (379건): imageGen, stt, crawler, email, vision, notification
 * Phase 2 (47건):  threeD, ner, churnPrediction, spatialAI, formulaOCR
 * Total: 426건 커버
 */

// ── Phase 1 파이프라인 ────────────────────────────────────
const imageGen          = require('./imageGenPipeline');
const stt               = require('./sttPipeline');
const crawler           = require('./crawlerPipeline');
const email             = require('./emailPipeline');
const vision            = require('./visionPipeline');
const notification      = require('./notificationPipeline');

// ── Phase 2 파이프라인 ────────────────────────────────────
const threeD            = require('./threeDRenderPipeline');
const ner               = require('./nerPipeline');
const churnPrediction   = require('./churnPredictionPipeline');
const spatialAI         = require('./spatialAIPipeline');
const formulaOCR        = require('./formulaOCRPipeline');

// ── 파이프라인 레지스트리 ─────────────────────────────────
const PIPELINES = {
  // ─── Phase 1 ───────────────────────────────────────────
  imageGen: {
    module:      imageGen,
    name:        'AI 이미지 생성',
    icon:        '🎨',
    phase:       1,
    casesCount:  80,
    description: '프롬프트 설계 → 이미지 생성 → 후처리(누끼/리사이즈/워터마크)',
    requiredEnv: ['OPENAI_API_KEY'],
    stubReady:   true,
    domains:     ['ecommerce', 'marketing', 'creative'],
    tags:        ['image', 'generation', 'product', 'banner'],
  },
  stt: {
    module:      stt,
    name:        'Speech-to-Text',
    icon:        '🎙️',
    phase:       1,
    casesCount:  55,
    description: '음성 파일 → 텍스트 전사 → 화자 분리 → SRT/VTT 자막 생성',
    requiredEnv: ['OPENAI_API_KEY'],
    stubReady:   true,
    domains:     ['edu_med', 'marketing', 'b2b', 'creative'],
    tags:        ['audio', 'transcript', 'subtitle', 'whisper'],
  },
  crawler: {
    module:      crawler,
    name:        '웹 크롤러',
    icon:        '🕷️',
    phase:       1,
    casesCount:  51,
    description: 'URL 분석 → 전략 선택 → Puppeteer 스크래핑 → 데이터 구조화',
    requiredEnv: ['puppeteer (npm)'],
    stubReady:   true,
    domains:     ['ecommerce', 'b2b', 'real_estate', 'finance_invest'],
    tags:        ['crawl', 'scrape', 'data', 'automation'],
  },
  email: {
    module:      email,
    name:        '이메일 자동화',
    icon:        '📧',
    phase:       1,
    casesCount:  51,
    description: '템플릿 렌더 → 수신자 세그먼트 → A/B 설계 → 발송 계획',
    requiredEnv: ['SMTP_HOST 또는 SENDGRID_API_KEY'],
    stubReady:   true,
    domains:     ['marketing', 'b2b', 'ecommerce', 'legal_hr'],
    tags:        ['email', 'campaign', 'automation', 'newsletter'],
  },
  vision: {
    module:      vision,
    name:        'GPT-4V 비전 분석',
    icon:        '👁️',
    phase:       1,
    casesCount:  46,
    description: '이미지 입력 → 분석 모드 선택 → OCR/상품분석/UI분석/수식인식 등',
    requiredEnv: ['OPENAI_API_KEY'],
    stubReady:   true,
    domains:     ['ecommerce', 'edu_med', 'real_estate', 'data_ai'],
    tags:        ['vision', 'ocr', 'image-analysis', 'gpt4v'],
  },
  notification: {
    module:      notification,
    name:        'SMS/Slack/GitHub 알림',
    icon:        '🔔',
    phase:       1,
    casesCount:  96,
    description: '이벤트 라우팅 → 채널별 템플릿 → SMS/Slack/GitHub 발송',
    requiredEnv: ['SLACK_WEBHOOK_URL 또는 TWILIO_ACCOUNT_SID 또는 GITHUB_TOKEN'],
    stubReady:   true,
    domains:     ['it', 'b2b', 'ecommerce', 'marketing'],
    tags:        ['notification', 'alert', 'slack', 'sms', 'github'],
  },

  // ─── Phase 2 ───────────────────────────────────────────
  threeD: {
    module:      threeD,
    name:        '3D 렌더링',
    icon:        '🧊',
    phase:       2,
    casesCount:  10,
    description: 'GLB/GLTF → 씬 설정 → 조명/카메라 → PNG/MP4/USDZ 출력',
    requiredEnv: ['three (npm) 또는 BLENDER_PATH 또는 SPLINE_API_KEY'],
    stubReady:   true,
    domains:     ['ecommerce', 'real_estate', 'creative', 'marketing'],
    tags:        ['3d', 'render', 'ar', 'visualization', 'glb', 'mp4'],
  },
  ner: {
    module:      ner,
    name:        'NER 파이프라인',
    icon:        '🏷️',
    phase:       2,
    casesCount:  10,
    description: '텍스트 입력 → 개체명 인식 → 관계 추출 → 지식 그래프 구조화',
    requiredEnv: ['OPENAI_API_KEY 또는 SPACY_SERVER_URL'],
    stubReady:   true,
    domains:     ['legal_hr', 'finance_invest', 'data_ai', 'b2b', 'government', 'healthcare'],
    tags:        ['nlp', 'ner', 'entity', 'knowledge-graph', 'text-mining'],
  },
  churnPrediction: {
    module:      churnPrediction,
    name:        '이탈 예측 ML',
    icon:        '📉',
    phase:       2,
    casesCount:  8,
    description: '고객 데이터 → 피처 엔지니어링 → 이탈 확률 예측 → 리텐션 액션 플랜',
    requiredEnv: ['MLFLOW_SERVER_URL 또는 VERTEX_AI_KEY'],
    stubReady:   true,
    domains:     ['ecommerce', 'b2b', 'healthcare', 'finance_invest', 'marketing'],
    tags:        ['ml', 'churn', 'retention', 'prediction', 'customer'],
  },
  spatialAI: {
    module:      spatialAI,
    name:        '공간인식 AI',
    icon:        '🗺️',
    phase:       2,
    casesCount:  10,
    description: '이미지/좌표 → 공간 분석 → AR 배치 → 면적측정 → 부동산 가치 추정',
    requiredEnv: ['KAKAO_MAP_KEY 또는 GOOGLE_MAPS_KEY 또는 VISION_API_KEY'],
    stubReady:   true,
    domains:     ['real_estate', 'ecommerce', 'government', 'marketing'],
    tags:        ['spatial', 'ar', 'gis', 'floor-plan', 'real-estate'],
  },
  formulaOCR: {
    module:      formulaOCR,
    name:        '수식 인식 OCR',
    icon:        '🔢',
    phase:       2,
    casesCount:  9,
    description: '이미지/PDF → 수식 감지 → LaTeX 변환 → 계산 → 설명 생성',
    requiredEnv: ['MATHPIX_APP_ID + MATHPIX_APP_KEY 또는 OPENAI_API_KEY'],
    stubReady:   true,
    domains:     ['edu_med', 'data_ai', 'finance_invest', 'government'],
    tags:        ['ocr', 'latex', 'math', 'formula', 'equation'],
  },
};

// ── 집계 ─────────────────────────────────────────────────
const TOTAL_CASES_COVERED = Object.values(PIPELINES).reduce((s, p) => s + p.casesCount, 0);
const PHASE1_CASES = Object.values(PIPELINES).filter(p => p.phase === 1).reduce((s, p) => s + p.casesCount, 0);
const PHASE2_CASES = Object.values(PIPELINES).filter(p => p.phase === 2).reduce((s, p) => s + p.casesCount, 0);

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────
async function run(pipelineKey, opts = {}) {
  const reg = PIPELINES[pipelineKey];
  if (!reg) {
    return {
      success:   false,
      error:     `알 수 없는 파이프라인: ${pipelineKey}`,
      available: Object.keys(PIPELINES),
    };
  }

  const startMs = Date.now();
  try {
    const result = await reg.module.execute(opts);
    return {
      ...result,
      _pipeline:     pipelineKey,
      _pipelineName: reg.name,
      _phase:        reg.phase,
      _totalMs:      Date.now() - startMs,
    };
  } catch (err) {
    return {
      success:   false,
      _pipeline: pipelineKey,
      error:     err.message,
      stack:     err.stack,
    };
  }
}

// ─────────────────────────────────────────────────────────
// 파이프라인 상태 조회
// ─────────────────────────────────────────────────────────
function getStatus() {
  const envChecks = {};
  for (const [key, reg] of Object.entries(PIPELINES)) {
    const missingEnv = reg.requiredEnv.filter(e => {
      const envKey = e.split(' ')[0].replace(/[()]/g, '');
      return envKey.includes('_') && !process.env[envKey];
    });
    envChecks[key] = {
      name:        reg.name,
      icon:        reg.icon,
      phase:       reg.phase,
      casesCount:  reg.casesCount,
      stubReady:   reg.stubReady,
      live:        missingEnv.length === 0,
      missingEnv,
      requiredEnv: reg.requiredEnv,
      domains:     reg.domains,
      tags:        reg.tags,
    };
  }

  const liveCount = Object.values(envChecks).filter(e => e.live).length;
  const phase1    = Object.entries(envChecks).filter(([,v]) => v.phase === 1);
  const phase2    = Object.entries(envChecks).filter(([,v]) => v.phase === 2);

  return {
    phases: {
      phase1: { count: phase1.length, cases: PHASE1_CASES },
      phase2: { count: phase2.length, cases: PHASE2_CASES },
    },
    totalPipelines:    Object.keys(PIPELINES).length,
    livePipelines:     liveCount,
    stubPipelines:     Object.keys(PIPELINES).length - liveCount,
    totalCasesCovered: TOTAL_CASES_COVERED,
    pipelines:         envChecks,
    message: liveCount === 0
      ? '모든 파이프라인이 stub 모드입니다. 환경변수를 설정하면 실제 API가 활성화됩니다.'
      : `${liveCount}개 파이프라인 실제 연동 활성화됨`,
  };
}

// ─────────────────────────────────────────────────────────
// 커버리지 리포트
// ─────────────────────────────────────────────────────────
function getCoverageReport() {
  const byDomain = {};
  for (const [key, reg] of Object.entries(PIPELINES)) {
    for (const domain of reg.domains) {
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push({ pipeline: key, name: reg.name, icon: reg.icon, cases: reg.casesCount, phase: reg.phase });
    }
  }

  const byPhase = { 1: [], 2: [] };
  for (const [k, v] of Object.entries(PIPELINES)) {
    byPhase[v.phase].push({ key: k, name: v.name, icon: v.icon, cases: v.casesCount, domains: v.domains });
  }

  return {
    totalCovered: TOTAL_CASES_COVERED,
    phase1Cases:  PHASE1_CASES,
    phase2Cases:  PHASE2_CASES,
    byDomain,
    byPhase,
    byPipeline: Object.entries(PIPELINES)
      .map(([k, v]) => ({ key: k, name: v.name, icon: v.icon, cases: v.casesCount, phase: v.phase, domains: v.domains }))
      .sort((a, b) => b.cases - a.cases),
  };
}

// ─────────────────────────────────────────────────────────
// 도메인별 파이프라인 추천
// ─────────────────────────────────────────────────────────
function recommendForDomain(domain = 'ecommerce') {
  const matched = Object.entries(PIPELINES)
    .filter(([, reg]) => reg.domains.includes(domain))
    .sort((a, b) => b[1].casesCount - a[1].casesCount)
    .map(([k, reg]) => ({ key: k, name: reg.name, icon: reg.icon, phase: reg.phase, cases: reg.casesCount }));

  return { domain, recommended: matched, count: matched.length };
}

module.exports = {
  run,
  getStatus,
  getCoverageReport,
  recommendForDomain,
  PIPELINES,
  TOTAL_CASES_COVERED,
  PHASE1_CASES,
  PHASE2_CASES,
  // 개별 모듈 직접 접근
  modules: { imageGen, stt, crawler, email, vision, notification, threeD, ner, churnPrediction, spatialAI, formulaOCR },
};
