// ============================================================
// types/index.js  –  AI 모델 레지스트리 + 조합 시스템
// ============================================================
//
// ▶ 데이터 출처 (2025~2026 실제 벤치마크 기반):
//   - Artificial Analysis Intelligence Index v4.0 (artificialanalysis.ai)
//   - Top 30 AI Models March 2026 (mangomindbd.com)
//   - LLM Benchmark Wars 2025–2026 (Kaggle: alitaqishah)
//   - MMLU / HumanEval / GPQA Diamond / SWE-bench / AIME 2025 실측치
//   - Overchat AI Hub, RankSaga, AnotherWrapper 리더보드
//
// ▶ 분야별 최고 모델 요약 (2026 March 최신):
//   S-tier:      GPT-5.4         (Elo 1555, SuperReasoning)
//   추론 챔피언:  Claude Opus 4.6 (GPQA 91.9%, Adaptive Thinking)
//   멀티모달:    Gemini 3.1 Pro  (AIME 95%, 2M 컨텍스트, Elo 1528)
//   코딩:        Claude Sonnet 5 (SWE-bench 82.1%, $3/1M)
//   오픈소스 추론: DeepSeek R2   (Elo 1515, GPT-4급 1/10 비용)
//   에이전트:    Kimi K2.5       (에이전트 스웜, GPT-5.2 능가)
//   속도:        Gemini 3 Flash  (<1s 실시간)
//   비용효율:    DeepSeek V3.2   (성능/달러 310.86)
//   오픈소스:    Llama 4.1 Maverick (무료, MMLU 경쟁력)
//   이미지:      Nano Banana Pro (근-완벽 텍스트 렌더링, ~150ms)
//   비디오:      Sora 2          (물리 현실감 최고)
//   추론 전문:   o3              (200k ctx, 수학/코딩 극한)
// ============================================================

'use strict';

// ── 작업 타입 ─────────────────────────────────────────────
const TASK_TYPES = {
  // ── 기존 ──────────────────────────────────────────────────
  PPT:          'ppt',
  WEBSITE:      'website',
  BLOG:         'blog',
  REPORT:       'report',
  CODE:         'code',
  EMAIL:        'email',
  RESUME:       'resume',
  IMAGE:        'image',

  // ── 크리에이티브 비주얼 ────────────────────────────────────
  ILLUSTRATION: 'illustration',   // 2D/SVG 일러스트
  ANIMATION:    'animation',      // CSS/JS/Lottie 애니메이션
  THREE_D:      '3d',             // Three.js / WebGL 3D
  VIDEO_SCRIPT: 'video_script',   // 영상 스크립트+콘티
  UI_DESIGN:    'ui_design',      // UX/UI 전문 설계

  // ── 오디오 & 음악 ──────────────────────────────────────────
  MUSIC:        'music',          // 작곡/편곡 가이드
  PODCAST:      'podcast',        // 팟캐스트 스크립트

  // ── 게임 & 인터랙티브 ──────────────────────────────────────
  GAME:         'game',           // 게임 기획+코드
  AR_VR:        'ar_vr',          // AR/VR 경험 설계

  // ── 전문직 도메인 ──────────────────────────────────────────
  LEGAL:        'legal',          // 계약서/법률 문서
  MEDICAL:      'medical',        // 의료/헬스케어 콘텐츠
  FINANCE:      'finance',        // 재무/투자 분석
  EDUCATION:    'education',      // 교육 커리큘럼/강의안

  // ── 마케팅 & 브랜딩 ────────────────────────────────────────
  MARKETING:    'marketing',      // 마케팅 캠페인 전략
  BRAND:        'brand',          // 브랜드 아이덴티티
  AD_COPY:      'ad_copy',        // 광고 카피라이팅
  SNS:          'sns',            // SNS 콘텐츠 패키지

  // ── 데이터 & 자동화 ────────────────────────────────────────
  DATA_ANALYSIS:'data_analysis',  // 데이터 분석/시각화
  AUTOMATION:   'automation',     // 업무 자동화 스크립트
  API_DESIGN:   'api_design',     // API 설계 문서

  // ── 스토리텔링 ─────────────────────────────────────────────
  NOVEL:        'novel',          // 소설/시나리오
  SCENARIO:     'scenario',       // 게임/영상 시나리오
  TRANSLATION:  'translation',    // 전문 번역

  // ── 신규 특화 분야 (테스트케이스 분석 후 추가) ─────────────
  OCR:          'ocr',            // 이미지/PDF → 텍스트 추출
  STT:          'stt',            // 음성 → 텍스트 변환
  VIDEO_EDIT:   'video_edit',     // AI 영상 편집/하이라이트
  SECURITY:     'security',       // 보안 분석 & 취약점 패치
  DB_DESIGN:    'db_design',      // DB 설계 & 쿼리 최적화
  COMPLIANCE:   'compliance',     // 규정 준수 & 감사 지원
  ML_PIPELINE:  'ml_pipeline',    // ML 모델 & 데이터 파이프라인
  REALTIME:     'realtime',       // 실시간 모니터링 & 알림
  WEB_SCRAPING: 'web_scraping',   // 웹 크롤링 & 데이터 수집

  UNKNOWN:      'unknown'
};

// ── 작업 상태 ─────────────────────────────────────────────
const TASK_STATUS = {
  ANALYZING:   'analyzing',
  QUESTIONING: 'questioning',
  PLANNING:    'planning',
  EXECUTING:   'executing',
  VALIDATING:  'validating',
  RETRYING:    'retrying',
  COMPLETED:   'completed',
  FAILED:      'failed'
};

// ============================================================
// MODEL_REGISTRY  –  분야별 최고 AI 모델 완전 정의
// ============================================================
//
// 능력치 (0~10):
//   reasoning    : 논리 추론·수학·계획
//   creativity   : 창의 글쓰기·아이디어
//   coding       : 코드 생성·디버깅
//   korean       : 한국어 자연스러움
//   speed        : 응답 속도 (10=초고속)
//   instruction  : 지시 정확도 (JSON 등)
//   longContext  : 장문 처리 능력
//   factual      : 사실 정확도·환각 저항성
//
// tier: flagship | standard | mini | nano | specialized | open | economy
// ============================================================
const MODEL_REGISTRY = {

  // ══════════════════════════════════════════════════════════
  // ■ OpenAI 계열
  // ══════════════════════════════════════════════════════════

  // 종합 1위 – MMLU 93.0, AIME 100점 (벤치마크 종합 90.3)
  GPT5_2: {
    id:            'gpt-5.2',
    name:          'GPT-5.2',
    provider:      'openai',
    tier:          'flagship',
    costPer1kTokens: 0.030,
    avgLatencyMs:   3200,
    maxTokens:      32000,
    contextWindow:  '128k',
    benchmark: { overall: 90.3, MMLU: 93.0, HumanEval: 91.2, GPQA: 92.1, SWEbench: 79.5, AIME: 100 },
    abilities: {
      reasoning:   10, creativity:  8, coding: 9,
      korean:       8, speed:        6, instruction: 10,
      longContext: 9, factual:      10
    },
    bestFor:    ['reasoning', 'math', 'knowledge_work', 'analysis', 'orchestration'],
    weakAt:     ['ultra_fast', 'cost_sensitive'],
    specialty:  '종합 1위 · MMLU·AIME 리더',
    tags:       ['flagship', 'reasoning', 'math', 'analysis'],
    available:  true
  },

  // 코딩 최고 – SWE-bench 83.0%, HumanEval 97.5%
  GPT5_3_CODEX: {
    id:            'gpt-5.3-codex',
    name:          'GPT-5.3 Codex',
    provider:      'openai',
    tier:          'specialized',
    costPer1kTokens: 0.040,
    avgLatencyMs:   3800,
    maxTokens:      64000,
    contextWindow:  '200k',
    benchmark: { overall: 88.62, HumanEval: 97.5, SWEbench: 83.0 },
    abilities: {
      reasoning:   10, creativity:  5, coding: 10,
      korean:       6, speed:        4, instruction: 10,
      longContext: 10, factual:      9
    },
    bestFor:    ['code_generation', 'swe_bench', 'code_review', 'large_codebase', 'system_design'],
    weakAt:     ['creative_writing', 'korean_copywriting', 'fast_response'],
    specialty:  '코딩 특화 · SWE-bench 83% · HumanEval 97.5%',
    tags:       ['code', 'engineering', 'specialized'],
    available:  false   // GenSpark 프록시 미지원 → 내부적으로 gpt-5-codex 대체
  },

  // 창의 글쓰기 1위 – Creative Writing v3 #1, 따뜻한 톤
  GPT5_1: {
    id:            'gpt-5.1',
    name:          'GPT-5.1',
    provider:      'openai',
    tier:          'flagship',
    costPer1kTokens: 0.025,
    avgLatencyMs:   2800,
    maxTokens:      32000,
    contextWindow:  '128k',
    benchmark: { overall: 87.4, MMLU: 91.0, AIME: 94.6, SWEbench: 76.3 },
    abilities: {
      reasoning:   9, creativity: 10, coding: 8,
      korean:      9, speed:       7, instruction: 9,
      longContext: 8, factual:     9
    },
    bestFor:    ['creative_writing', 'copywriting', 'blog', 'email', 'storytelling'],
    weakAt:     ['complex_math', 'enterprise_code'],
    specialty:  '창의 글쓰기 1위 · 따뜻한 자연어 · AIME 94.6%',
    tags:       ['writing', 'creative', 'copywriting'],
    available:  true
  },

  // 범용 오케스트레이터 – GPT-5 기본형
  GPT5: {
    id:            'gpt-5',
    name:          'GPT-5',
    provider:      'openai',
    tier:          'flagship',
    costPer1kTokens: 0.015,
    avgLatencyMs:   2600,
    maxTokens:      16000,
    contextWindow:  '128k',
    benchmark: { overall: 85.7, MMLU: 89.0 },
    abilities: {
      reasoning:   9, creativity: 8, coding: 8,
      korean:      7, speed:      7, instruction: 9,
      longContext: 8, factual:    8
    },
    bestFor:    ['planning', 'structure', 'orchestration', 'analysis', 'general'],
    weakAt:     ['ultra_fast', 'specialized_code'],
    specialty:  '범용 오케스트레이터 · 균형잡힌 성능',
    tags:       ['general', 'planning', 'analysis'],
    available:  true
  },

  // 속도형 mini – 저비용 검증·분류
  GPT5_MINI: {
    id:            'gpt-5-mini',
    name:          'GPT-5 mini',
    provider:      'openai',
    tier:          'mini',
    costPer1kTokens: 0.0006,
    avgLatencyMs:   800,
    maxTokens:      8000,
    contextWindow:  '32k',
    benchmark: { overall: 78.5 },
    abilities: {
      reasoning:   7, creativity: 6, coding: 7,
      korean:      7, speed:     10, instruction: 8,
      longContext: 5, factual:    7
    },
    bestFor:    ['routing', 'validation', 'classification', 'quick_check', 'critic'],
    weakAt:     ['deep_analysis', 'long_documents', 'creative_writing'],
    specialty:  '저비용 고속 · 검증/분류 특화',
    tags:       ['fast', 'cheap', 'routing', 'validation'],
    available:  true
  },

  // 초소형 nano
  GPT5_NANO: {
    id:            'gpt-5-nano',
    name:          'GPT-5 nano',
    provider:      'openai',
    tier:          'nano',
    costPer1kTokens: 0.0002,
    avgLatencyMs:   400,
    maxTokens:      4000,
    contextWindow:  '16k',
    benchmark: { overall: 68.0 },
    abilities: {
      reasoning:   5, creativity: 4, coding: 5,
      korean:      6, speed:     10, instruction: 7,
      longContext: 3, factual:    5
    },
    bestFor:    ['simple_classification', 'yes_no', 'keyword_extraction'],
    weakAt:     ['complex_tasks', 'long_content'],
    specialty:  '초고속 초저비용 · 단순 분류',
    tags:       ['ultra-fast', 'ultra-cheap'],
    available:  true
  },

  // Codex 코드 특화 (GenSpark 지원)
  GPT5_CODEX: {
    id:            'gpt-5-codex',
    name:          'GPT-5 Codex',
    provider:      'openai',
    tier:          'specialized',
    costPer1kTokens: 0.020,
    avgLatencyMs:   2500,
    maxTokens:      32000,
    contextWindow:  '128k',
    benchmark: { overall: 86.5, HumanEval: 95.0, SWEbench: 78.0 },
    abilities: {
      reasoning:   9, creativity: 6, coding: 10,
      korean:      6, speed:      7, instruction: 10,
      longContext: 10, factual:    8
    },
    bestFor:    ['code_generation', 'code_review', 'architecture', 'debugging'],
    weakAt:     ['creative_writing', 'korean_copywriting'],
    specialty:  'GenSpark 코드 특화 · HumanEval 95%',
    tags:       ['code', 'engineering'],
    available:  true
  },

  GPT5_2_CODEX: {
    id:            'gpt-5.2-codex',
    name:          'GPT-5.2 Codex',
    provider:      'openai',
    tier:          'specialized',
    costPer1kTokens: 0.028,
    avgLatencyMs:   3200,
    maxTokens:      64000,
    contextWindow:  '200k',
    benchmark: { overall: 88.1, HumanEval: 96.5, SWEbench: 81.0 },
    abilities: {
      reasoning:  10, creativity: 6, coding: 10,
      korean:      6, speed:      5, instruction: 10,
      longContext: 10, factual:    9
    },
    bestFor:    ['enterprise_code', 'large_codebase', 'system_design', 'refactoring'],
    weakAt:     ['fast_tasks', 'creative_writing'],
    specialty:  '엔터프라이즈 코드 · 대규모 리팩토링',
    tags:       ['code', 'enterprise'],
    available:  true
  },

  // ★ S-Tier: GPT-5.4 – 2026년 3월 최신 (Elo 1555, SuperReasoning)
  GPT5_4: {
    id:            'gpt-5.4',
    name:          'GPT-5.4',
    provider:      'openai',
    tier:          'flagship',
    costPer1kTokens: 0.060,
    avgLatencyMs:   4500,
    maxTokens:      64000,
    contextWindow:  '1M',
    benchmark: { overall: 95.5, intelligenceIndex: 57, eloEst: 1555, GPQA: 96.2, MMLU: 95.8 },
    abilities: {
      reasoning:  10, creativity:  9, coding: 10,
      korean:      8, speed:        4, instruction: 10,
      longContext: 10, factual:    10
    },
    bestFor:    ['complex_reasoning', 'physics', 'law', 'engineering', 'multi_step_logic', 'agentic'],
    weakAt:     ['cost_sensitive', 'fast_response'],
    specialty:  '★ 2026년 최고 지능 · Elo 1555 · SuperReasoning · 1M 컨텍스트',
    tags:       ['flagship', 'reasoning', 's-tier', 'latest'],
    available:  false  // 출시 최신, 프록시 지원 대기중
  },

  // GPT-5.4 Pro – 프리미엄 버전
  GPT5_4_PRO: {
    id:            'gpt-5.4-pro',
    name:          'GPT-5.4 Pro',
    provider:      'openai',
    tier:          'flagship',
    costPer1kTokens: 0.100,
    avgLatencyMs:   6000,
    maxTokens:      128000,
    contextWindow:  '1M',
    benchmark: { overall: 96.8, intelligenceIndex: 57, eloEst: 1570 },
    abilities: {
      reasoning:  10, creativity:  9, coding: 10,
      korean:      8, speed:        3, instruction: 10,
      longContext: 10, factual:    10
    },
    bestFor:    ['most_complex_tasks', 'research', 'enterprise_ai', 'frontier_reasoning'],
    weakAt:     ['cost_sensitive', 'fast_response', 'simple_tasks'],
    specialty:  '최고급 프리미엄 · 1M ctx · 가장 강력한 추론',
    tags:       ['flagship', 'premium', 'pro', 'latest'],
    available:  false
  },

  // o3 – OpenAI 추론 전문 모델 (200k ctx)
  O3: {
    id:            'o3',
    name:          'o3',
    provider:      'openai',
    tier:          'specialized',
    costPer1kTokens: 0.015,
    avgLatencyMs:   8000,   // 추론 토큰 포함
    maxTokens:      32000,
    contextWindow:  '200k',
    benchmark: { overall: 91.2, GPQA: 93.5, AIME: 98.0, HumanEval: 96.8 },
    abilities: {
      reasoning:  10, creativity:  5, coding: 10,
      korean:      6, speed:        2, instruction: 10,
      longContext:  9, factual:    10
    },
    bestFor:    ['deep_reasoning', 'math_competition', 'code_competition', 'scientific_analysis'],
    weakAt:     ['fast_response', 'creative_writing', 'cost_sensitive'],
    specialty:  'CoT 추론 전문 · AIME 98% · 수학/코딩 극한 성능',
    tags:       ['reasoning', 'specialized', 'math', 'code'],
    available:  false
  },

  // o4-mini – OpenAI 소형 추론 (200k ctx, 고속)
  O4_MINI: {
    id:            'o4-mini',
    name:          'o4-mini',
    provider:      'openai',
    tier:          'mini',
    costPer1kTokens: 0.0011,
    avgLatencyMs:   2000,
    maxTokens:      16000,
    contextWindow:  '200k',
    benchmark: { overall: 85.3, GPQA: 87.2, AIME: 92.0 },
    abilities: {
      reasoning:   9, creativity:  5, coding: 9,
      korean:       6, speed:       8, instruction: 9,
      longContext:  9, factual:     9
    },
    bestFor:    ['fast_reasoning', 'math', 'coding', 'cost_efficient_reasoning'],
    weakAt:     ['creative_writing', 'ultra_fast'],
    specialty:  '빠른 추론 · AIME 92% · 고속 CoT',
    tags:       ['reasoning', 'mini', 'fast', 'cost-effective'],
    available:  false
  },

  // GPT-5.1 Codex – 코딩 특화 (400k ctx)
  GPT5_1_CODEX: {
    id:            'gpt-5.1-codex',
    name:          'GPT-5.1 Codex',
    provider:      'openai',
    tier:          'specialized',
    costPer1kTokens: 0.030,
    avgLatencyMs:   3500,
    maxTokens:      32000,
    contextWindow:  '400k',
    benchmark: { overall: 87.8, HumanEval: 96.0, SWEbench: 80.0 },
    abilities: {
      reasoning:   9, creativity:  7, coding: 10,
      korean:       6, speed:       5, instruction: 10,
      longContext: 10, factual:     9
    },
    bestFor:    ['code_generation', 'code_review', 'agentic_coding', 'large_codebase'],
    weakAt:     ['creative_writing', 'fast_response'],
    specialty:  'GPT-5.1 코딩 특화 · 400k ctx · SWE-bench 80%',
    tags:       ['code', 'specialized', 'agentic'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Anthropic – Claude 계열
  // ══════════════════════════════════════════════════════════

  // 코딩 세계 1위 – SWE-bench 80.9% (업계 최고)
  CLAUDE_OPUS_45: {
    id:            'claude-opus-4-5',
    name:          'Claude Opus 4.5',
    provider:      'anthropic',
    tier:          'flagship',
    costPer1kTokens: 0.075,            // $75/M output
    avgLatencyMs:   4200,
    maxTokens:      32000,
    contextWindow:  '200k',
    benchmark: { overall: 88.82, SWEbench: 80.9, TerminalBench: 59.3, MMLU: 89.5 },
    abilities: {
      reasoning:  10, creativity:  9, coding: 10,
      korean:      8, speed:        4, instruction: 10,
      longContext: 9, factual:      9
    },
    bestFor:    ['coding', 'agentic_tasks', 'code_review', 'software_engineering', 'deep_analysis'],
    weakAt:     ['fast_response', 'cost_sensitive'],
    specialty:  '코딩 세계 1위 · SWE-bench 80.9% · 터미널 59.3%',
    tags:       ['code', 'flagship', 'agentic'],
    available:  false  // API 비용 $75/M → 데모 불가, 내부 대체 필요
  },

  // ★ Claude Opus 4.6 – 2026년 3월 최신 (Elo 1532, GPQA 91.9%)
  CLAUDE_OPUS_46: {
    id:            'claude-opus-4-6',
    name:          'Claude Opus 4.6',
    provider:      'anthropic',
    tier:          'flagship',
    costPer1kTokens: 0.075,
    avgLatencyMs:   4800,
    maxTokens:      64000,
    contextWindow:  '1M',
    benchmark: { overall: 92.1, GPQA: 91.9, SWEbench: 81.5, eloEst: 1532, intelligenceIndex: 53 },
    abilities: {
      reasoning:  10, creativity:  9, coding: 10,
      korean:      9, speed:        3, instruction: 10,
      longContext: 10, factual:    10
    },
    bestFor:    ['complex_reasoning', 'long_horizon_tasks', 'architecture', 'legal_research', 'adaptive_thinking'],
    weakAt:     ['fast_response', 'cost_sensitive', 'simple_tasks'],
    specialty:  '★ 추론 챔피언 · GPQA 91.9% · Adaptive Thinking · Elo 1532 · 1M ctx',
    tags:       ['flagship', 'reasoning', 's-tier', 'latest', 'adaptive'],
    available:  false
  },

  // ★ Claude Sonnet 5 – 코딩 최강 (SWE-bench 82.1%, $3/1M)
  CLAUDE_SONNET_5: {
    id:            'claude-sonnet-5',
    name:          'Claude Sonnet 5',
    provider:      'anthropic',
    tier:          'standard',
    costPer1kTokens: 0.003,
    avgLatencyMs:   2500,
    maxTokens:      32000,
    contextWindow:  '200k',
    benchmark: { overall: 91.8, SWEbench: 82.1, eloEst: 1510 },
    abilities: {
      reasoning:  10, creativity:  9, coding: 10,
      korean:      9, speed:        6, instruction: 10,
      longContext: 10, factual:     9
    },
    bestFor:    ['coding', 'agentic_coding', 'code_refactoring', 'ci_cd', 'dev_team'],
    weakAt:     ['cost_at_extreme_scale'],
    specialty:  '★ 코딩 2026 1위 · SWE-bench 82.1% · "Dev Team" 모드 · $3/1M 가성비',
    tags:       ['code', 'agentic', 'latest', 'cost-effective'],
    available:  false
  },

  // Claude Sonnet – 균형형 (코딩 2위급, 실용적)
  CLAUDE_SONNET_46: {
    id:            'claude-sonnet-4-6',
    name:          'Claude Sonnet 4.6',
    provider:      'anthropic',
    tier:          'standard',
    costPer1kTokens: 0.015,
    avgLatencyMs:   2200,
    maxTokens:      16000,
    contextWindow:  '200k',
    benchmark: { overall: 86.5, SWEbench: 72.1 },
    abilities: {
      reasoning:   9, creativity: 10, coding: 9,
      korean:       9, speed:       7, instruction: 9,
      longContext:  9, factual:     8
    },
    bestFor:    ['creative_writing', 'analysis', 'coding', 'korean_copywriting', 'nuanced_tasks'],
    weakAt:     ['ultra_fast', 'math_competition'],
    specialty:  '창의성·코딩 균형 · 한국어 최강 · SWE-bench 72%',
    tags:       ['writing', 'coding', 'korean', 'balanced'],
    available:  false  // GenSpark 프록시 미지원
  },

  // Claude Haiku – 고속형
  CLAUDE_HAIKU_45: {
    id:            'claude-haiku-4-5',
    name:          'Claude Haiku 4.5',
    provider:      'anthropic',
    tier:          'mini',
    costPer1kTokens: 0.001,
    avgLatencyMs:   600,
    maxTokens:      8000,
    contextWindow:  '200k',
    benchmark: { overall: 75.2 },
    abilities: {
      reasoning:   7, creativity: 8, coding: 7,
      korean:      8, speed:      9, instruction: 8,
      longContext: 7, factual:    7
    },
    bestFor:    ['fast_tasks', 'routing', 'validation', 'korean_short'],
    weakAt:     ['deep_analysis', 'enterprise_code'],
    specialty:  '185 tok/s · 저비용 고속',
    tags:       ['fast', 'cheap', 'korean'],
    available:  false  // GenSpark 미지원
  },

  // ══════════════════════════════════════════════════════════
  // ■ Google DeepMind – Gemini 계열
  // ══════════════════════════════════════════════════════════

  // 수학·멀티모달 최강 – AIME 95.0%, GPQA 94.3%, 2M 컨텍스트
  GEMINI_3_PRO: {
    id:            'gemini-3-pro',
    name:          'Gemini 3.1 Pro',
    provider:      'google',
    tier:          'flagship',
    costPer1kTokens: 0.004,           // $4/M input (<200k), 비용 효율 우수
    avgLatencyMs:   3000,
    maxTokens:      32000,
    contextWindow:  '2M',
    benchmark: { overall: 90.22, MMLU: 91.5, GPQA: 94.3, AIME: 95.0, SWEbench: 76.2, TerminalBench: 54.2 },
    abilities: {
      reasoning:  10, creativity:  7, coding: 9,
      korean:      8, speed:        6, instruction: 9,
      longContext: 10, factual:    10
    },
    bestFor:    ['math', 'science', 'data_analysis', 'multimodal', 'long_document', 'GPQA'],
    weakAt:     ['creative_copywriting', 'cost_at_scale'],
    specialty:  '수학 1위 AIME 95% · GPQA 94.3% · 2M 컨텍스트 · 데이터 분석 최강',
    tags:       ['math', 'reasoning', 'multimodal', 'longcontext'],
    available:  false  // GenSpark 미지원 (시뮬레이션용)
  },

  // Gemini Flash – 초고속
  GEMINI_25_FLASH: {
    id:            'gemini-2.5-flash',
    name:          'Gemini 2.5 Flash',
    provider:      'google',
    tier:          'mini',
    costPer1kTokens: 0.00035,
    avgLatencyMs:   350,
    maxTokens:      8000,
    contextWindow:  '1M',
    benchmark: { overall: 79.8 },
    abilities: {
      reasoning:   7, creativity: 6, coding: 7,
      korean:      7, speed:     10, instruction: 8,
      longContext: 9, factual:    7
    },
    bestFor:    ['real_time', 'routing', 'streaming', 'cost_efficient'],
    weakAt:     ['deep_reasoning', 'creative_writing'],
    specialty:  '347 tok/s 업계 최고속 · 초저비용',
    tags:       ['ultra-fast', 'ultra-cheap', 'real-time'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ xAI – Grok 계열
  // ══════════════════════════════════════════════════════════

  // Grok 4.1 – 감성 글쓰기·2M 컨텍스트
  GROK_41: {
    id:            'grok-4-1',
    name:          'Grok 4.1',
    provider:      'xai',
    tier:          'flagship',
    costPer1kTokens: 0.015,
    avgLatencyMs:   2800,
    maxTokens:      32000,
    contextWindow:  '2M',
    benchmark: { overall: 86.3, AIME: 88.0, SWEbench: 74.9 },
    abilities: {
      reasoning:   9, creativity: 10, coding: 8,
      korean:       7, speed:       7, instruction: 8,
      longContext: 10, factual:     8
    },
    bestFor:    ['creative_emotional', 'long_context', 'reasoning', 'real_time_info'],
    weakAt:     ['math_competition', 'korean_nuance'],
    specialty:  '감성 창의 글쓰기 · 2M 컨텍스트 · 실시간 정보',
    tags:       ['creative', 'longcontext', 'real-time'],
    available:  false
  },

  // ★ Grok 4.2 – 2026년 3월 최신 속도왕 (Elo 1495, 실시간 X 데이터)
  GROK_42: {
    id:            'grok-4-2',
    name:          'Grok 4.2',
    provider:      'xai',
    tier:          'flagship',
    costPer1kTokens: 0.015,
    avgLatencyMs:   1500,
    maxTokens:      32000,
    contextWindow:  '2M',
    benchmark: { overall: 89.5, eloEst: 1495, AIME: 91.0 },
    abilities: {
      reasoning:  10, creativity: 10, coding: 9,
      korean:      7, speed:      10, instruction: 9,
      longContext: 10, factual:    9
    },
    bestFor:    ['real_time_info', 'creative_writing', 'fast_reasoning', 'social_media', 'trend_analysis'],
    weakAt:     ['korean_nuance', 'cost_at_scale'],
    specialty:  '★ 속도 왕 · 실시간 X 데이터 · Elo 1495 · 2M ctx · 창의 최강',
    tags:       ['flagship', 'speed', 'real-time', 'latest'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ DeepSeek – 오픈소스 최고 비용효율
  // ══════════════════════════════════════════════════════════

  // DeepSeek V3.2 – 성능/달러 310.86 (최고 가성비)
  DEEPSEEK_V3_2: {
    id:            'deepseek-v3-2',
    name:          'DeepSeek V3.2',
    provider:      'deepseek',
    tier:          'economy',
    costPer1kTokens: 0.00028,          // $0.28/M input (초저비용)
    avgLatencyMs:   1800,
    maxTokens:      16000,
    contextWindow:  '128k',
    benchmark: { overall: 86.8, HumanEval: 90.5, performancePerDollar: 310.86 },
    abilities: {
      reasoning:   9, creativity: 7, coding: 9,
      korean:       6, speed:      8, instruction: 9,
      longContext:  8, factual:    8
    },
    bestFor:    ['coding', 'analysis', 'cost_efficient', 'open_source_alternative'],
    weakAt:     ['korean_copywriting', 'creative_storytelling'],
    specialty:  '비용효율 1위 310.86 · 오픈소스 코딩 최강',
    tags:       ['economy', 'open-source', 'coding'],
    available:  false
  },

  // DeepSeek R1 – 추론 특화 오픈소스
  DEEPSEEK_R1: {
    id:            'deepseek-r1',
    name:          'DeepSeek R1',
    provider:      'deepseek',
    tier:          'economy',
    costPer1kTokens: 0.00055,
    avgLatencyMs:   4500,              // 추론 모델 특성상 느림
    maxTokens:      16000,
    contextWindow:  '128k',
    benchmark: { overall: 84.7, performancePerDollar: 165.18 },
    abilities: {
      reasoning:  10, creativity: 5, coding: 9,
      korean:      5, speed:       3, instruction: 9,
      longContext: 8, factual:     9
    },
    bestFor:    ['deep_reasoning', 'math', 'chain_of_thought', 'logical_analysis'],
    weakAt:     ['fast_response', 'creative_writing', 'korean'],
    specialty:  '오픈소스 추론 특화 · chain-of-thought 탁월',
    tags:       ['reasoning', 'open-source', 'math'],
    available:  false
  },

  // ★ DeepSeek R2 – 2026년 3월 최신 (Elo 1515, 추론 효율 최강)
  DEEPSEEK_R2: {
    id:            'deepseek-r2',
    name:          'DeepSeek R2',
    provider:      'deepseek',
    tier:          'economy',
    costPer1kTokens: 0.00080,
    avgLatencyMs:   5000,
    maxTokens:      32000,
    contextWindow:  '256k',
    benchmark: { overall: 91.5, GPQA: 90.2, AIME: 96.0, eloEst: 1515, intelligenceIndex: 47 },
    abilities: {
      reasoning:  10, creativity:  6, coding: 10,
      korean:      5, speed:        3, instruction: 10,
      longContext:  9, factual:    10
    },
    bestFor:    ['math_reasoning', 'scientific_analysis', 'coding', 'chain_of_thought', 'cost_efficient_frontier'],
    weakAt:     ['fast_response', 'creative_writing', 'korean'],
    specialty:  '★ 오픈소스 추론 최강 · Elo 1515 · AIME 96% · GPT-5급 1/10 비용',
    tags:       ['economy', 'reasoning', 'open-source', 'latest', 's-tier-value'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Alibaba – Qwen 계열
  // ══════════════════════════════════════════════════════════

  // Qwen3.5 Plus – 오픈웨이트 최강 가성비
  QWEN35_PLUS: {
    id:            'qwen3.5-plus',
    name:          'Qwen3.5 Plus',
    provider:      'alibaba',
    tier:          'economy',
    costPer1kTokens: 0.0006,
    avgLatencyMs:   1600,
    maxTokens:      16000,
    contextWindow:  '128k',
    benchmark: { overall: 85.9, performancePerDollar: 177.16 },
    abilities: {
      reasoning:   9, creativity: 7, coding: 9,
      korean:       5, speed:      8, instruction: 9,
      longContext:  8, factual:    8
    },
    bestFor:    ['coding', 'reasoning', 'multilingual', 'cost_efficient', 'open_weight'],
    weakAt:     ['korean_nuance', 'creative_writing'],
    specialty:  '오픈웨이트 코딩·추론 최강 · 가성비 177.16',
    tags:       ['economy', 'open-weight', 'coding'],
    available:  false
  },

  // ★ Qwen 3.5 Max – 2026년 3월 최신 (Elo 1502, 다국어 최강)
  QWEN35_MAX: {
    id:            'qwen3.5-max',
    name:          'Qwen 3.5 Max',
    provider:      'alibaba',
    tier:          'flagship',
    costPer1kTokens: 0.0020,
    avgLatencyMs:   2200,
    maxTokens:      32000,
    contextWindow:  '256k',
    benchmark: { overall: 90.2, eloEst: 1502, MMLU: 91.5 },
    abilities: {
      reasoning:  10, creativity:  8, coding: 9,
      korean:      7, speed:        7, instruction: 10,
      longContext:  9, factual:    9
    },
    bestFor:    ['multilingual', 'reasoning', 'coding', 'general_purpose', 'chinese_tasks'],
    weakAt:     ['korean_nuance', 'cost_at_scale'],
    specialty:  '★ 다국어 깊이 · Elo 1502 · 256k ctx · 범용 최강급',
    tags:       ['flagship', 'multilingual', 'latest'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Meta – Llama 4 계열 (오픈소스 무료)
  // ══════════════════════════════════════════════════════════

  // Llama 4 Scout – 10M 컨텍스트, 오픈소스 무료
  LLAMA4_SCOUT: {
    id:            'llama-4-scout',
    name:          'Llama 4 Scout',
    provider:      'meta',
    tier:          'open',
    costPer1kTokens: 0.0000,           // 오픈소스, 자체 호스팅 무료
    avgLatencyMs:   2200,
    maxTokens:      32000,
    contextWindow:  '10M',             // 업계 최대 컨텍스트
    benchmark: { overall: 77.8 },
    abilities: {
      reasoning:   8, creativity: 7, coding: 8,
      korean:       6, speed:      8, instruction: 8,
      longContext: 10, factual:    7
    },
    bestFor:    ['long_document', 'rag', 'open_source', 'on_premise', 'large_codebase'],
    weakAt:     ['frontier_quality', 'korean_nuance'],
    specialty:  '10M 컨텍스트 업계 최대 · 완전 오픈소스 · 무료',
    tags:       ['open-source', 'longcontext', 'free'],
    available:  false
  },

  // Llama 4 Maverick – 무료 고성능
  LLAMA4_MAVERICK: {
    id:            'llama-4-maverick',
    name:          'Llama 4 Maverick',
    provider:      'meta',
    tier:          'open',
    costPer1kTokens: 0.0000,
    avgLatencyMs:   1800,
    maxTokens:      16000,
    contextWindow:  '1M',
    benchmark: { overall: 75.2 },
    abilities: {
      reasoning:   8, creativity: 7, coding: 8,
      korean:       5, speed:      8, instruction: 8,
      longContext:  9, factual:    7
    },
    bestFor:    ['open_source', 'on_premise', 'cost_free', 'general_purpose'],
    weakAt:     ['frontier_quality', 'korean'],
    specialty:  '고성능 오픈소스 · 1M 컨텍스트 · 무료',
    tags:       ['open-source', 'free'],
    available:  false
  },

  // ★ Llama 4.1 Maverick – 2026년 3월 최신 (오픈소스 최강, GPT-5.2 5% 내)
  LLAMA41_MAVERICK: {
    id:            'llama-4-1-maverick',
    name:          'Llama 4.1 Maverick',
    provider:      'meta',
    tier:          'open',
    costPer1kTokens: 0.0000,
    avgLatencyMs:   2000,
    maxTokens:      32000,
    contextWindow:  '1M',
    benchmark: { overall: 85.8, MMLU: 88.5 },
    abilities: {
      reasoning:   9, creativity:  8, coding: 9,
      korean:       5, speed:       8, instruction: 9,
      longContext:  9, factual:     8
    },
    bestFor:    ['open_source', 'on_premise', 'fine_tuning', 'enterprise_base', 'cost_free'],
    weakAt:     ['frontier_reasoning', 'korean'],
    specialty:  '★ 오픈소스 최강 · GPT-5.2 5% 내 MMLU · 무료 자체 배포',
    tags:       ['open-source', 'free', 'latest', 'competitive'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Moonshot – Kimi 계열 (에이전트 특화)
  // ══════════════════════════════════════════════════════════

  // ★ Kimi K2.5 – 에이전트 스웜 마스터 (Elo ~1480)
  KIMI_K2_5: {
    id:            'kimi-k2-5',
    name:          'Kimi K2.5',
    provider:      'moonshot',
    tier:          'flagship',
    costPer1kTokens: 0.0025,
    avgLatencyMs:   3000,
    maxTokens:      32000,
    contextWindow:  '128k',
    benchmark: { overall: 88.7, intelligenceIndex: 47, eloEst: 1480 },
    abilities: {
      reasoning:  10, creativity:  7, coding: 9,
      korean:      5, speed:        5, instruction: 10,
      longContext:  9, factual:     9
    },
    bestFor:    ['agentic_tasks', 'research_automation', 'tool_use', 'multi_agent', 'coding'],
    weakAt:     ['korean', 'creative_writing', 'fast_response'],
    specialty:  '★ 에이전트 스웜 최강 · GPT-5.2 능가 에이전틱 벤치 · 1.04T MoE',
    tags:       ['flagship', 'agentic', 'latest', 'research'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Google – Gemini 3 Flash (초고속 최신)
  // ══════════════════════════════════════════════════════════

  // ★ Gemini 3 Flash – 2026년 최신 실시간 <1s
  GEMINI_3_FLASH: {
    id:            'gemini-3-flash',
    name:          'Gemini 3 Flash',
    provider:      'google',
    tier:          'mini',
    costPer1kTokens: 0.00020,
    avgLatencyMs:   200,
    maxTokens:      8000,
    contextWindow:  '1M',
    benchmark: { overall: 81.2 },
    abilities: {
      reasoning:   7, creativity:  7, coding: 7,
      korean:       7, speed:      10, instruction: 8,
      longContext:  9, factual:     7
    },
    bestFor:    ['real_time', 'streaming', 'voice', 'translation', 'cost_efficient'],
    weakAt:     ['deep_reasoning', 'enterprise_code'],
    specialty:  '★ <1s 실시간 · 번역·음성·스트리밍 최강 · 초저비용',
    tags:       ['ultra-fast', 'real-time', 'latest', 'ultra-cheap'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ Mistral – EU 오픈웨이트
  // ══════════════════════════════════════════════════════════

  MISTRAL_LARGE_3: {
    id:            'mistral-large-3',
    name:          'Mistral Large 3',
    provider:      'mistral',
    tier:          'standard',
    costPer1kTokens: 0.004,
    avgLatencyMs:   2000,
    maxTokens:      16000,
    contextWindow:  '131k',
    benchmark: { overall: 82.4 },
    abilities: {
      reasoning:   8, creativity: 8, coding: 8,
      korean:       6, speed:      8, instruction: 9,
      longContext:  8, factual:    8
    },
    bestFor:    ['eu_compliance', 'open_weight', 'multilingual', 'general'],
    weakAt:     ['korean_nuance', 'frontier_code'],
    specialty:  'EU 오픈웨이트 · 675B MoE · GDPR 친화적',
    tags:       ['eu', 'open-weight', 'multilingual'],
    available:  false
  },

  // ══════════════════════════════════════════════════════════
  // ■ GenSpark 프록시 지원 모델 (실제 사용 가능)
  // ══════════════════════════════════════════════════════════

  // ※ GenSpark LLM Proxy 실제 지원 모델 (2026.03 기준)
  // gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano
  // gpt-5-codex, gpt-5.2-codex
  // 위 ID들이 GPT5, GPT5_1, GPT5_2, GPT5_MINI, GPT5_NANO, GPT5_CODEX, GPT5_2_CODEX에 매핑됨

  // ══════════════════════════════════════════════════════════
  // ■ 분야별 최고 모델 참조 맵 (external – 현재 미지원)
  // ══════════════════════════════════════════════════════════
  // 코딩:       CLAUDE_OPUS_45   (gpt-5.2-codex로 대체)
  // 수학:       GEMINI_3_PRO     (gpt-5.2로 대체)
  // 글쓰기:     GPT5_1           (직접 지원)
  // 속도:       GEMINI_25_FLASH  (gpt-5-nano로 대체)
  // 가성비:     DEEPSEEK_V3_2    (gpt-5-mini로 대체)
  // 장문:       LLAMA4_SCOUT     (gpt-5.2로 대체)
  // 검증:       GPT5_MINI        (직접 지원)
};

// ============================================================
// COMBO_ROLES  –  파이프라인 역할별 능력치 가중치
// ============================================================
const COMBO_ROLES = {

  planner: {
    name:    '기획자',
    icon:    '🧠',
    weights: { reasoning: 0.30, instruction: 0.25, factual: 0.20, longContext: 0.15, creativity: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',   // 종합 1위
    description: '전체 전략·구조·목차 설계 – 논리력 핵심'
  },

  researcher: {
    name:    '리서처',
    icon:    '🔍',
    weights: { factual: 0.35, reasoning: 0.25, longContext: 0.20, instruction: 0.20 },
    preferTier:  ['flagship'],
    preferModel: 'GEMINI_3_PRO',   // 사실·멀티모달 최강
    description: '사실 기반 정보 수집, 데이터 정확성 우선'
  },

  writer: {
    name:    '라이터',
    icon:    '✍️',
    weights: { korean: 0.35, creativity: 0.30, reasoning: 0.20, factual: 0.15 },
    preferTier:  ['flagship', 'standard'],
    preferModel: 'GPT5_1',         // 창의 글쓰기 1위
    description: '자연스러운 한국어, 창의적 문체, 독자 공감'
  },

  coder: {
    name:    '코더',
    icon:    '💻',
    weights: { coding: 0.40, instruction: 0.25, longContext: 0.20, reasoning: 0.15 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_2_CODEX',   // SWE-bench 81%
    description: '동작하는 코드, 에러 없는 구현'
  },

  reviewer: {
    name:    '리뷰어',
    icon:    '🔬',
    weights: { coding: 0.35, reasoning: 0.30, factual: 0.25, instruction: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_CODEX',     // 코드 리뷰 특화
    description: '코드 품질, 버그, 보안 취약점 검토'
  },

  designer: {
    name:    '디자이너',
    icon:    '🎨',
    weights: { creativity: 0.35, reasoning: 0.25, instruction: 0.25, korean: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',         // 창의성 1위
    description: '색상, 레이아웃, 사용자 경험 설계'
  },

  analyst: {
    name:    '분석가',
    icon:    '📊',
    weights: { reasoning: 0.35, factual: 0.30, longContext: 0.20, instruction: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',         // MMLU·GPQA 최강
    description: 'SWOT·트렌드·인사이트 도출, 데이터 해석'
  },

  validator: {
    name:    '검증자',
    icon:    '✅',
    weights: { speed: 0.30, instruction: 0.30, factual: 0.25, reasoning: 0.15 },
    preferTier:  ['mini', 'nano'],
    preferModel: 'GPT5_MINI',      // 저비용 고속
    description: '빠른 품질 검증, 사실 확인 – 속도 우선'
  },

  router: {
    name:    '라우터',
    icon:    '🔀',
    weights: { speed: 0.35, instruction: 0.30, reasoning: 0.25, factual: 0.10 },
    preferTier:  ['mini', 'nano'],
    preferModel: 'GPT5_NANO',      // 초고속
    description: '사용자 의도 빠르게 파악, 작업 분류'
  },

  assembler: {
    name:    '조립자',
    icon:    '🔧',
    weights: { instruction: 0.30, reasoning: 0.25, longContext: 0.25, creativity: 0.20 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5',           // 범용 오케스트레이터
    description: '모든 스텝 결과 통합, 최종 결과물 완성'
  },

  critic: {
    name:    '크리틱',
    icon:    '⚖️',
    weights: { reasoning: 0.35, factual: 0.30, instruction: 0.25, speed: 0.10 },
    preferTier:  ['mini', 'flagship'],
    preferModel: 'GPT5_MINI',
    description: 'AI 결과물 비판적 검토, 개선 방향 제시'
  },

  // ── 크리에이티브 전문 역할 ─────────────────────────────────
  illustrator: {
    name:    '일러스트레이터',
    icon:    '🖌️',
    weights: { creativity: 0.40, instruction: 0.30, reasoning: 0.20, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: 'SVG/CSS 일러스트, 2D 비주얼 아트 디자인'
  },

  animator: {
    name:    '애니메이터',
    icon:    '🎬',
    weights: { creativity: 0.35, coding: 0.30, instruction: 0.25, reasoning: 0.10 },
    preferTier:  ['flagship', 'specialized'],
    preferModel: 'GPT5_1',
    description: 'CSS/JS/Lottie/GSAP 애니메이션 구현'
  },

  artist3d: {
    name:    '3D 아티스트',
    icon:    '🧊',
    weights: { coding: 0.35, creativity: 0.30, instruction: 0.25, reasoning: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_2_CODEX',
    description: 'Three.js / WebGL / CSS 3D 씬 제작'
  },

  ux_architect: {
    name:    'UX 아키텍트',
    icon:    '🗂️',
    weights: { reasoning: 0.35, creativity: 0.30, instruction: 0.25, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '사용자 플로우, 와이어프레임, 정보 구조 설계'
  },

  composer: {
    name:    '작곡가',
    icon:    '🎵',
    weights: { creativity: 0.40, reasoning: 0.25, instruction: 0.25, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '음악 구조, 코드 진행, 가사·편곡 가이드 생성'
  },

  game_designer: {
    name:    '게임 디자이너',
    icon:    '🎮',
    weights: { creativity: 0.35, reasoning: 0.30, coding: 0.25, instruction: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '게임 메커닉, 레벨 디자인, 밸런스 기획'
  },

  game_coder: {
    name:    '게임 코더',
    icon:    '👾',
    weights: { coding: 0.40, instruction: 0.30, creativity: 0.20, reasoning: 0.10 },
    preferTier:  ['specialized'],
    preferModel: 'GPT5_2_CODEX',
    description: 'Canvas/WebGL 게임 엔진 코드 구현'
  },

  // ── 전문직 역할 ────────────────────────────────────────────
  legal_expert: {
    name:    '법률 전문가',
    icon:    '⚖️',
    weights: { factual: 0.40, reasoning: 0.30, instruction: 0.20, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '계약서, 법률 문서, 리스크 분석'
  },

  medical_writer: {
    name:    '의료 작가',
    icon:    '🏥',
    weights: { factual: 0.40, reasoning: 0.30, instruction: 0.20, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '의료 콘텐츠, 임상 문서, 헬스케어 가이드'
  },

  financial_analyst: {
    name:    '재무 분석가',
    icon:    '💹',
    weights: { reasoning: 0.35, factual: 0.35, instruction: 0.20, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '재무 모델링, 투자 분석, 리스크 평가'
  },

  educator: {
    name:    '교육 설계자',
    icon:    '🎓',
    weights: { instruction: 0.35, creativity: 0.25, korean: 0.25, reasoning: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '커리큘럼 설계, 강의안, 학습 콘텐츠 제작'
  },

  // ── 마케팅 역할 ────────────────────────────────────────────
  strategist: {
    name:    '마케팅 전략가',
    icon:    '📣',
    weights: { reasoning: 0.35, creativity: 0.30, factual: 0.20, korean: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '마케팅 전략, 캠페인 기획, 타겟 분석'
  },

  copywriter: {
    name:    '카피라이터',
    icon:    '✨',
    weights: { creativity: 0.40, korean: 0.30, instruction: 0.20, reasoning: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '광고 카피, 슬로건, 세일즈 문구 작성'
  },

  brand_strategist: {
    name:    '브랜드 전략가',
    icon:    '💎',
    weights: { creativity: 0.35, reasoning: 0.30, korean: 0.20, instruction: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '브랜드 아이덴티티, 포지셔닝, 스토리텔링'
  },

  // ── 데이터/자동화 역할 ─────────────────────────────────────
  data_scientist: {
    name:    '데이터 과학자',
    icon:    '📊',
    weights: { coding: 0.35, reasoning: 0.30, factual: 0.25, instruction: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_2_CODEX',
    description: '데이터 분석, 시각화 코드, 통계 해석'
  },

  automation_engineer: {
    name:    '자동화 엔지니어',
    icon:    '🤖',
    weights: { coding: 0.40, instruction: 0.30, reasoning: 0.20, speed: 0.10 },
    preferTier:  ['specialized'],
    preferModel: 'GPT5_2_CODEX',
    description: '업무 자동화, RPA, API 연동 스크립트'
  },

  // ── 스토리텔링 역할 ────────────────────────────────────────
  novelist: {
    name:    '소설가',
    icon:    '📖',
    weights: { creativity: 0.45, korean: 0.30, instruction: 0.15, reasoning: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '소설, 단편, 세계관 구축, 캐릭터 설계'
  },

  scenario_writer: {
    name:    '시나리오 작가',
    icon:    '🎭',
    weights: { creativity: 0.40, reasoning: 0.25, korean: 0.25, instruction: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '영화/드라마/게임 시나리오, 대사 작성'
  },

  translator: {
    name:    '번역가',
    icon:    '🌐',
    weights: { korean: 0.40, factual: 0.30, instruction: 0.20, reasoning: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'QWEN35_MAX',
    description: '전문 번역, 현지화, 문화적 뉘앙스 반영'
  },

  // ── 신규 특화 역할 (테스트케이스 분석 후 추가) ────────────
  ocr_specialist: {
    name:    'OCR 전문가',
    icon:    '📄',
    weights: { factual: 0.40, instruction: 0.30, reasoning: 0.20, coding: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '이미지/PDF 텍스트 추출, 구조화, 표/수식 인식'
  },

  stt_engineer: {
    name:    '음성처리 전문가',
    icon:    '🎤',
    weights: { factual: 0.35, reasoning: 0.30, instruction: 0.25, coding: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '음성→텍스트 변환, 화자 분리, 억양/감성 분석'
  },

  ml_engineer: {
    name:    'ML 엔지니어',
    icon:    '🤖',
    weights: { coding: 0.35, reasoning: 0.30, factual: 0.25, instruction: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_2_CODEX',
    description: '머신러닝 모델 설계·학습·배포, 데이터 파이프라인'
  },

  security_expert: {
    name:    '보안 전문가',
    icon:    '🔒',
    weights: { coding: 0.35, reasoning: 0.30, factual: 0.25, instruction: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_CODEX',
    description: '취약점 분석, OWASP 검토, 보안 코드 패치'
  },

  ux_researcher: {
    name:    'UX 리서처',
    icon:    '🔍',
    weights: { reasoning: 0.35, creativity: 0.25, factual: 0.25, instruction: 0.15 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_1',
    description: '사용자 조사, 페르소나 설계, 사용성 평가 인사이트'
  },

  video_editor: {
    name:    '영상 편집가',
    icon:    '🎬',
    weights: { creativity: 0.35, instruction: 0.30, reasoning: 0.25, coding: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: 'AI 영상 편집, 하이라이트 추출, 클립 합성'
  },

  db_architect: {
    name:    'DB 아키텍트',
    icon:    '🗄️',
    weights: { coding: 0.35, reasoning: 0.30, factual: 0.25, instruction: 0.10 },
    preferTier:  ['specialized', 'flagship'],
    preferModel: 'GPT5_CODEX',
    description: '데이터베이스 설계, 쿼리 최적화, 마이그레이션'
  },

  compliance_officer: {
    name:    '컴플라이언스 담당',
    icon:    '⚖️',
    weights: { factual: 0.40, reasoning: 0.30, instruction: 0.20, korean: 0.10 },
    preferTier:  ['flagship'],
    preferModel: 'GPT5_2',
    description: '규정 준수, 법적 리스크 관리, 감사 대응'
  },

  image_generator: {
    name: '이미지 생성기',
    icon: '🎨',
    weight: {
      creativity: 0.45,
      instruction: 0.30,
      reasoning: 0.15,
      korean: 0.10
    },
    preferredTier: ['flagship'],
    preferredModel: 'GPT5_1',
    description: 'AI 이미지 생성 및 편집 파이프라인'
  },

  web_scraper: {
    name: '웹 스크래퍼',
    icon: '🕷️',
    weight: {
      reasoning: 0.35,
      instruction: 0.30,
      factual: 0.25,
      speed: 0.10
    },
    preferredTier: ['flagship'],
    preferredModel: 'GPT5_2_CODEX',
    description: '웹 크롤링 및 데이터 추출 자동화'
  }
};

// KNOWN_COMBOS  –  검증된 AI 조합 레시피
// ============================================================
// ※ available=false 모델은 GenSpark 지원 모델로 자동 대체됨
//   Claude Opus 4.5 → GPT5_2_CODEX (코딩)
//   Gemini 3.1 Pro  → GPT5_2       (분석·수학)
//   GPT-5.1         → GPT5_1       (창의 글쓰기)
// ============================================================
const KNOWN_COMBOS = {

  // ── PPT ──────────────────────────────────────────────────
  ppt_balanced: {
    name:      'PPT 밸런스',
    taskType:  'ppt',
    strategy:  'quality',
    description: '기획력 + 문서력 균형 조합',
    winRate:   0.88, avgScore: 87,
    roles: { researcher: 'GPT5',   planner: 'GPT5',   writer: 'GPT5_1', validator: 'GPT5_MINI', assembler: 'GPT5' }
  },

  ppt_deep: {
    name:      'PPT 심층 분석',
    taskType:  'ppt',
    strategy:  'quality',
    description: '데이터 밀도 높은 전문 PPT – 분석가 투입',
    winRate:   0.92, avgScore: 92,
    roles: { researcher: 'GPT5_2', planner: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI', assembler: 'GPT5_2' }
    // 실제: researcher=Gemini 3 Pro (사실 최강), planner=GPT-5.2 (종합 1위)
  },

  ppt_fast: {
    name:      'PPT 빠른 초안',
    taskType:  'ppt',
    strategy:  'speed',
    description: '빠른 시간 내 초안 생성',
    winRate:   0.80, avgScore: 79,
    roles: { researcher: 'GPT5_MINI', planner: 'GPT5', writer: 'GPT5_MINI', validator: 'GPT5_NANO', assembler: 'GPT5_MINI' }
  },

  // ── Website ──────────────────────────────────────────────
  website_premium: {
    name:      '홈페이지 프리미엄',
    taskType:  'website',
    strategy:  'quality',
    description: '완성도 최우선 – 코딩 전문 AI 투입',
    winRate:   0.93, avgScore: 93,
    roles: { planner: 'GPT5_2', writer: 'GPT5_1', designer: 'GPT5_1', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
    // 실제: coder=Claude Opus 4.5 (SWE-bench 80.9%)
  },

  website_balanced: {
    name:      '홈페이지 밸런스',
    taskType:  'website',
    strategy:  'quality',
    description: '품질과 속도 균형',
    winRate:   0.87, avgScore: 87,
    roles: { planner: 'GPT5', writer: 'GPT5_1', designer: 'GPT5', coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  website_fast: {
    name:      '홈페이지 빠른 제작',
    taskType:  'website',
    strategy:  'speed',
    description: '빠른 프로토타입',
    winRate:   0.78, avgScore: 78,
    roles: { planner: 'GPT5_MINI', writer: 'GPT5_MINI', coder: 'GPT5', validator: 'GPT5_NANO' }
  },

  // ── Blog ─────────────────────────────────────────────────
  blog_seo: {
    name:      '블로그 SEO 최적화',
    taskType:  'blog',
    strategy:  'quality',
    description: '검색 노출 + 가독성 최적화',
    winRate:   0.89, avgScore: 89,
    roles: { researcher: 'GPT5', planner: 'GPT5_MINI', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  blog_creative: {
    name:      '블로그 창의 글쓰기',
    taskType:  'blog',
    strategy:  'quality',
    description: '개성 있는 문체, 독자 몰입 – 창의력 1위 투입',
    winRate:   0.91, avgScore: 91,
    roles: { researcher: 'GPT5', planner: 'GPT5', writer: 'GPT5_1', validator: 'GPT5_MINI' }
    // 실제: writer=Claude Sonnet 4.6 (창의성·한국어 최강)
  },

  blog_fast: {
    name:      '블로그 빠른 작성',
    taskType:  'blog',
    strategy:  'speed',
    description: '빠른 초안',
    winRate:   0.80, avgScore: 80,
    roles: { researcher: 'GPT5_MINI', writer: 'GPT5', validator: 'GPT5_NANO' }
  },

  // ── Report ───────────────────────────────────────────────
  report_analyst: {
    name:      '리포트 심층 분석',
    taskType:  'report',
    strategy:  'quality',
    description: '데이터 기반 SWOT · 인사이트 – 종합 1위 투입',
    winRate:   0.92, avgScore: 92,
    roles: { researcher: 'GPT5_2', analyst: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
    // 실제: researcher=Gemini 3 Pro (사실 최강), analyst=GPT-5.2 (종합 1위)
  },

  report_fast: {
    name:      '리포트 빠른 요약',
    taskType:  'report',
    strategy:  'speed',
    description: '핵심만 빠르게',
    winRate:   0.82, avgScore: 82,
    roles: { researcher: 'GPT5_MINI', writer: 'GPT5', validator: 'GPT5_NANO' }
  },

  // ── Code ─────────────────────────────────────────────────
  code_enterprise: {
    name:      '코드 엔터프라이즈',
    taskType:  'code',
    strategy:  'quality',
    description: '대규모 코드 · 아키텍처 – 코딩 1위급 투입',
    winRate:   0.94, avgScore: 94,
    roles: { planner: 'GPT5_2', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
    // 실제: coder=Claude Opus 4.5 (SWE-bench 80.9%)
  },

  code_standard: {
    name:      '코드 스탠다드',
    taskType:  'code',
    strategy:  'quality',
    description: '실용적 코드 개발',
    winRate:   0.88, avgScore: 88,
    roles: { planner: 'GPT5', coder: 'GPT5_CODEX', reviewer: 'GPT5', validator: 'GPT5_MINI' }
  },

  code_fast: {
    name:      '코드 빠른 구현',
    taskType:  'code',
    strategy:  'speed',
    description: '간단한 스크립트 · 빠른 구현',
    winRate:   0.84, avgScore: 84,
    roles: { planner: 'GPT5_MINI', coder: 'GPT5', validator: 'GPT5_MINI' }
  },

  // ── Email ────────────────────────────────────────────────
  email_professional: {
    name:      '이메일 전문가',
    taskType:  'email',
    strategy:  'quality',
    description: '격식체 비즈니스 이메일',
    winRate:   0.94, avgScore: 94,
    roles: { writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  email_quick: {
    name:      '이메일 빠른 작성',
    taskType:  'email',
    strategy:  'speed',
    description: '간단한 이메일 즉시 작성',
    winRate:   0.90, avgScore: 90,
    roles: { writer: 'GPT5_MINI', validator: 'GPT5_NANO' }
  },

  // ── Resume ───────────────────────────────────────────────
  resume_premium: {
    name:      '자소서 프리미엄',
    taskType:  'resume',
    strategy:  'quality',
    description: '설득력 · 스토리텔링 – 창의 글쓰기 최강 투입',
    winRate:   0.92, avgScore: 92,
    roles: { planner: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  resume_standard: {
    name:      '자소서 스탠다드',
    taskType:  'resume',
    strategy:  'quality',
    description: '균형잡힌 자소서',
    winRate:   0.87, avgScore: 87,
    roles: { planner: 'GPT5_MINI', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Illustration ──────────────────────────────────────────
  illustration_premium: {
    name:      '일러스트 프리미엄',
    taskType:  'illustration',
    strategy:  'quality',
    description: 'SVG/CSS 아트 + 색상 시스템 완전 설계',
    winRate:   0.91, avgScore: 91,
    roles: { planner: 'GPT5_2', designer: 'GPT5_1', illustrator: 'GPT5_1', coder: 'GPT5_2_CODEX', validator: 'GPT5_MINI' }
  },
  illustration_fast: {
    name:      '일러스트 빠른 제작',
    taskType:  'illustration',
    strategy:  'speed',
    description: '아이콘·배지·배너 즉시 생성',
    winRate:   0.82, avgScore: 82,
    roles: { illustrator: 'GPT5_1', coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── Animation ─────────────────────────────────────────────
  animation_premium: {
    name:      '애니메이션 프리미엄',
    taskType:  'animation',
    strategy:  'quality',
    description: 'GSAP/Lottie/CSS 풀 애니메이션 – 60fps 최적화',
    winRate:   0.92, avgScore: 92,
    roles: { planner: 'GPT5_2', designer: 'GPT5_1', animator: 'GPT5_1', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },
  animation_fast: {
    name:      '애니메이션 빠른 제작',
    taskType:  'animation',
    strategy:  'speed',
    description: 'CSS transition/keyframe 빠른 구현',
    winRate:   0.83, avgScore: 83,
    roles: { animator: 'GPT5_1', coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── 3D ────────────────────────────────────────────────────
  threed_premium: {
    name:      '3D 프리미엄',
    taskType:  '3d',
    strategy:  'quality',
    description: 'Three.js WebGL 3D 씬 – 조명·쉐이더·인터랙션 완전 구현',
    winRate:   0.90, avgScore: 90,
    roles: { planner: 'GPT5_2', designer: 'GPT5_1', artist3d: 'GPT5_2_CODEX', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },
  threed_standard: {
    name:      '3D 스탠다드',
    taskType:  '3d',
    strategy:  'quality',
    description: 'Three.js 기본 3D 씬 + 인터랙션',
    winRate:   0.84, avgScore: 84,
    roles: { planner: 'GPT5', artist3d: 'GPT5_CODEX', coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── UX/UI Design ──────────────────────────────────────────
  ui_design_premium: {
    name:      'UX/UI 프리미엄',
    taskType:  'ui_design',
    strategy:  'quality',
    description: '전문 UX 리서치 → 와이어프레임 → 디자인 시스템 → HTML 완성',
    winRate:   0.94, avgScore: 94,
    roles: { ux_architect: 'GPT5_2', researcher: 'GPT5_2', designer: 'GPT5_1', illustrator: 'GPT5_1', coder: 'GPT5_2_CODEX', validator: 'GPT5_MINI' }
  },
  ui_design_standard: {
    name:      'UX/UI 스탠다드',
    taskType:  'ui_design',
    strategy:  'quality',
    description: '컴포넌트 중심 UI 설계 + 반응형 코드',
    winRate:   0.88, avgScore: 88,
    roles: { ux_architect: 'GPT5', designer: 'GPT5_1', coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── Video Script ──────────────────────────────────────────
  video_script_premium: {
    name:      '영상 스크립트 프리미엄',
    taskType:  'video_script',
    strategy:  'quality',
    description: '기획 → 콘티 → 대본 → 자막 완전 패키지',
    winRate:   0.91, avgScore: 91,
    roles: { researcher: 'GPT5_2', planner: 'GPT5_2', scenario_writer: 'GPT5_1', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  video_script_fast: {
    name:      '영상 스크립트 빠른 제작',
    taskType:  'video_script',
    strategy:  'speed',
    description: 'SNS/유튜브 쇼츠 스크립트 즉시 생성',
    winRate:   0.86, avgScore: 86,
    roles: { writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Music ─────────────────────────────────────────────────
  music_premium: {
    name:      '음악 프리미엄',
    taskType:  'music',
    strategy:  'quality',
    description: '장르분석 → 코드진행 → 편곡가이드 → 가사 완전 패키지',
    winRate:   0.89, avgScore: 89,
    roles: { researcher: 'GPT5_2', planner: 'GPT5_2', composer: 'GPT5_1', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  music_fast: {
    name:      '음악 빠른 제작',
    taskType:  'music',
    strategy:  'speed',
    description: '코드 진행 + 가사 즉시 생성',
    winRate:   0.82, avgScore: 82,
    roles: { composer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Podcast ───────────────────────────────────────────────
  podcast_premium: {
    name:      '팟캐스트 프리미엄',
    taskType:  'podcast',
    strategy:  'quality',
    description: '기획 → 리서치 → 스크립트 → 질문리스트 완전 패키지',
    winRate:   0.90, avgScore: 90,
    roles: { researcher: 'GPT5_2', planner: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Game ──────────────────────────────────────────────────
  game_premium: {
    name:      '게임 프리미엄',
    taskType:  'game',
    strategy:  'quality',
    description: '게임 기획 → 레벨 설계 → Canvas/WebGL 완전 구현',
    winRate:   0.91, avgScore: 91,
    roles: { game_designer: 'GPT5_2', planner: 'GPT5_2', scenario_writer: 'GPT5_1', game_coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },
  game_standard: {
    name:      '게임 스탠다드',
    taskType:  'game',
    strategy:  'quality',
    description: '미니게임 / 인터랙티브 Canvas 구현',
    winRate:   0.85, avgScore: 85,
    roles: { game_designer: 'GPT5', game_coder: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── AR/VR ─────────────────────────────────────────────────
  ar_vr_premium: {
    name:      'AR/VR 경험 설계',
    taskType:  'ar_vr',
    strategy:  'quality',
    description: 'WebXR/Three.js VR/AR 경험 + 인터랙션 설계',
    winRate:   0.88, avgScore: 88,
    roles: { ux_architect: 'GPT5_2', artist3d: 'GPT5_2_CODEX', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── Legal ─────────────────────────────────────────────────
  legal_premium: {
    name:      '법률 문서 프리미엄',
    taskType:  'legal',
    strategy:  'quality',
    description: '계약서/법률문서 – 조항 검토·리스크 분석·초안 작성',
    winRate:   0.93, avgScore: 93,
    roles: { researcher: 'GPT5_2', legal_expert: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  legal_fast: {
    name:      '법률 문서 빠른 작성',
    taskType:  'legal',
    strategy:  'speed',
    description: '표준 계약서 / 동의서 즉시 생성',
    winRate:   0.86, avgScore: 86,
    roles: { legal_expert: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Medical ───────────────────────────────────────────────
  medical_premium: {
    name:      '의료 콘텐츠 프리미엄',
    taskType:  'medical',
    strategy:  'quality',
    description: '의학 리서치 → 임상 근거 → 환자 안내문 / 의료 보고서',
    winRate:   0.92, avgScore: 92,
    roles: { researcher: 'GPT5_2', medical_writer: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Finance ───────────────────────────────────────────────
  finance_premium: {
    name:      '재무 분석 프리미엄',
    taskType:  'finance',
    strategy:  'quality',
    description: '데이터 수집 → 재무 모델링 → 투자 인사이트 → 보고서',
    winRate:   0.93, avgScore: 93,
    roles: { researcher: 'GPT5_2', financial_analyst: 'GPT5_2', analyst: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  finance_fast: {
    name:      '재무 분석 빠른 작성',
    taskType:  'finance',
    strategy:  'speed',
    description: '핵심 재무지표 분석 요약',
    winRate:   0.85, avgScore: 85,
    roles: { financial_analyst: 'GPT5_2', writer: 'GPT5_MINI', validator: 'GPT5_MINI' }
  },

  // ── Education ─────────────────────────────────────────────
  education_premium: {
    name:      '교육 커리큘럼 프리미엄',
    taskType:  'education',
    strategy:  'quality',
    description: '학습 목표 → 커리큘럼 → 강의안 → 퀴즈 완전 패키지',
    winRate:   0.92, avgScore: 92,
    roles: { researcher: 'GPT5_2', educator: 'GPT5_1', planner: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  education_fast: {
    name:      '강의안 빠른 제작',
    taskType:  'education',
    strategy:  'speed',
    description: '단일 강의 슬라이드+요약 즉시 생성',
    winRate:   0.85, avgScore: 85,
    roles: { educator: 'GPT5_1', writer: 'GPT5_MINI', validator: 'GPT5_NANO' }
  },

  // ── Marketing ─────────────────────────────────────────────
  marketing_premium: {
    name:      '마케팅 캠페인 프리미엄',
    taskType:  'marketing',
    strategy:  'quality',
    description: '시장 분석 → 타겟 설정 → 채널 전략 → 콘텐츠 캘린더',
    winRate:   0.93, avgScore: 93,
    roles: { researcher: 'GPT5_2', strategist: 'GPT5_2', copywriter: 'GPT5_1', designer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  marketing_fast: {
    name:      '마케팅 전략 빠른 제작',
    taskType:  'marketing',
    strategy:  'speed',
    description: '핵심 마케팅 전략 1페이지 요약',
    winRate:   0.86, avgScore: 86,
    roles: { strategist: 'GPT5', copywriter: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Brand ─────────────────────────────────────────────────
  brand_premium: {
    name:      '브랜드 아이덴티티 프리미엄',
    taskType:  'brand',
    strategy:  'quality',
    description: '브랜드 전략 → 네이밍 → 슬로건 → 비주얼 가이드라인',
    winRate:   0.92, avgScore: 92,
    roles: { researcher: 'GPT5_2', brand_strategist: 'GPT5_1', copywriter: 'GPT5_1', designer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Ad Copy ───────────────────────────────────────────────
  ad_copy_premium: {
    name:      '광고 카피 프리미엄',
    taskType:  'ad_copy',
    strategy:  'quality',
    description: '타겟 분석 → A/B 테스트용 멀티 카피 → CTA 최적화',
    winRate:   0.94, avgScore: 94,
    roles: { researcher: 'GPT5_2', strategist: 'GPT5_2', copywriter: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  ad_copy_fast: {
    name:      '광고 카피 즉시 제작',
    taskType:  'ad_copy',
    strategy:  'speed',
    description: '5가지 광고 카피 변형 즉시 생성',
    winRate:   0.89, avgScore: 89,
    roles: { copywriter: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── SNS ───────────────────────────────────────────────────
  sns_premium: {
    name:      'SNS 콘텐츠 프리미엄',
    taskType:  'sns',
    strategy:  'quality',
    description: '트렌드 분석 → 인스타/유튜브/틱톡 멀티플랫폼 콘텐츠 패키지',
    winRate:   0.91, avgScore: 91,
    roles: { researcher: 'GPT5_2', strategist: 'GPT5', copywriter: 'GPT5_1', designer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  sns_fast: {
    name:      'SNS 콘텐츠 빠른 제작',
    taskType:  'sns',
    strategy:  'speed',
    description: '플랫폼별 포스팅 5개 즉시 생성',
    winRate:   0.87, avgScore: 87,
    roles: { copywriter: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Data Analysis ─────────────────────────────────────────
  data_analysis_premium: {
    name:      '데이터 분석 프리미엄',
    taskType:  'data_analysis',
    strategy:  'quality',
    description: '데이터 수집 → 통계 분석 → 시각화 코드 → 인사이트 보고서',
    winRate:   0.93, avgScore: 93,
    roles: { researcher: 'GPT5_2', data_scientist: 'GPT5_2_CODEX', analyst: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  data_analysis_fast: {
    name:      '데이터 분석 빠른 제작',
    taskType:  'data_analysis',
    strategy:  'speed',
    description: '핵심 지표 분석 + Python/JS 시각화 코드',
    winRate:   0.86, avgScore: 86,
    roles: { data_scientist: 'GPT5_CODEX', analyst: 'GPT5', validator: 'GPT5_MINI' }
  },

  // ── Automation ────────────────────────────────────────────
  automation_premium: {
    name:      '자동화 프리미엄',
    taskType:  'automation',
    strategy:  'quality',
    description: '업무 흐름 분석 → RPA/API 설계 → 완전한 자동화 스크립트',
    winRate:   0.92, avgScore: 92,
    roles: { planner: 'GPT5_2', automation_engineer: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },
  automation_fast: {
    name:      '자동화 빠른 구현',
    taskType:  'automation',
    strategy:  'speed',
    description: '단순 반복 작업 자동화 스크립트 즉시 생성',
    winRate:   0.87, avgScore: 87,
    roles: { automation_engineer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── API Design ────────────────────────────────────────────
  api_design_premium: {
    name:      'API 설계 프리미엄',
    taskType:  'api_design',
    strategy:  'quality',
    description: 'RESTful/GraphQL API 설계 → OpenAPI Spec → 구현 코드',
    winRate:   0.93, avgScore: 93,
    roles: { planner: 'GPT5_2', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // ── Novel ─────────────────────────────────────────────────
  novel_premium: {
    name:      '소설 프리미엄',
    taskType:  'novel',
    strategy:  'quality',
    description: '세계관 → 캐릭터 → 플롯 → 완성된 단편소설',
    winRate:   0.91, avgScore: 91,
    roles: { planner: 'GPT5_2', novelist: 'GPT5_1', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  novel_fast: {
    name:      '소설 빠른 작성',
    taskType:  'novel',
    strategy:  'speed',
    description: '단편 스토리 즉시 생성',
    winRate:   0.84, avgScore: 84,
    roles: { novelist: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Scenario ──────────────────────────────────────────────
  scenario_premium: {
    name:      '시나리오 프리미엄',
    taskType:  'scenario',
    strategy:  'quality',
    description: '기획 → 세계관 → 씬 구성 → 대사 완성 시나리오',
    winRate:   0.92, avgScore: 92,
    roles: { planner: 'GPT5_2', scenario_writer: 'GPT5_1', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── Translation ───────────────────────────────────────────
  translation_premium: {
    name:      '전문 번역 프리미엄',
    taskType:  'translation',
    strategy:  'quality',
    description: '전문 용어 분석 → 번역 → 현지화 → 교정',
    winRate:   0.94, avgScore: 94,
    roles: { researcher: 'GPT5_2', translator: 'QWEN35_MAX', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },
  translation_fast: {
    name:      '번역 빠른 제작',
    taskType:  'translation',
    strategy:  'speed',
    description: '문서 즉시 번역',
    winRate:   0.90, avgScore: 90,
    roles: { translator: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ── 신규 특화 콤보 (테스트케이스 1005개 기반) ─────────────

  // OCR 분야
  ocr_standard: {
    name: 'OCR 스탠다드',
    taskType: 'ocr',
    strategy: 'quality',
    description: '이미지/PDF 텍스트 추출 및 구조화',
    winRate: 0.88, avgScore: 88,
    roles: { ocr_specialist: 'GPT5_2', analyst: 'GPT5_MINI', validator: 'GPT5_MINI' }
  },

  // STT 분야
  stt_standard: {
    name: 'STT 스탠다드',
    taskType: 'stt',
    strategy: 'quality',
    description: '음성→텍스트 변환 및 요약',
    winRate: 0.91, avgScore: 91,
    roles: { stt_engineer: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // 보안 분야
  security_standard: {
    name: '보안 분석 스탠다드',
    taskType: 'security',
    strategy: 'quality',
    description: '취약점 탐지 및 패치 코드 생성',
    winRate: 0.87, avgScore: 87,
    roles: { security_expert: 'GPT5_2', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', writer: 'GPT5_1' }
  },
  security_premium: {
    name: '보안 프리미엄',
    taskType: 'security',
    strategy: 'quality',
    description: '심층 보안 감사 + OWASP 전체 커버리지',
    winRate: 0.93, avgScore: 93,
    roles: { security_expert: 'GPT5_2', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', legal_expert: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // DB 설계 분야
  db_standard: {
    name: 'DB 설계 스탠다드',
    taskType: 'db_design',
    strategy: 'quality',
    description: '데이터베이스 ERD 설계 및 SQL 생성',
    winRate: 0.89, avgScore: 89,
    roles: { db_architect: 'GPT5_2', coder: 'GPT5_2_CODEX', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // 컴플라이언스 분야
  compliance_standard: {
    name: '컴플라이언스 스탠다드',
    taskType: 'compliance',
    strategy: 'quality',
    description: '법령 검토 및 감사 리포트',
    winRate: 0.85, avgScore: 85,
    roles: { researcher: 'GPT5_2', compliance_officer: 'GPT5_2', writer: 'GPT5_1', validator: 'GPT5_MINI' }
  },

  // ML 파이프라인 분야
  ml_standard: {
    name: 'ML 파이프라인 스탠다드',
    taskType: 'ml_pipeline',
    strategy: 'quality',
    description: 'ML 모델 설계 및 배포 자동화',
    winRate: 0.86, avgScore: 86,
    roles: { ml_engineer: 'GPT5_2', coder: 'GPT5_2_CODEX', automation_engineer: 'GPT5_2', reviewer: 'GPT5_CODEX', validator: 'GPT5_MINI' }
  },

  // 웹 스크래핑 분야
  scraping_standard: {
    name: '웹 스크래핑 스탠다드',
    taskType: 'web_scraping',
    strategy: 'quality',
    description: '웹 데이터 수집 및 구조화',
    winRate: 0.84, avgScore: 84,
    roles: { planner: 'GPT5_MINI', automation_engineer: 'GPT5_2', coder: 'GPT5_2_CODEX', db_architect: 'GPT5_2', validator: 'GPT5_MINI' }
  },

  // 실시간 모니터링 분야
  realtime_standard: {
    name: '실시간 모니터링 스탠다드',
    taskType: 'realtime',
    strategy: 'speed',
    description: '실시간 이상감지 및 알림 자동화',
    winRate: 0.88, avgScore: 88,
    roles: { planner: 'GPT5_MINI', ml_engineer: 'GPT5_2', automation_engineer: 'GPT5_2', writer: 'GPT5_MINI' }
  },

  // 영상 편집 분야
  video_edit_standard: {
    name: 'AI 영상 편집 스탠다드',
    taskType: 'video_edit',
    strategy: 'quality',
    description: 'AI 기반 하이라이트 추출 및 편집',
    winRate: 0.83, avgScore: 83,
    roles: { video_editor: 'GPT5_2', writer: 'GPT5_1', assembler: 'GPT5_2', validator: 'GPT5_MINI' }
  },

  image_generator_pipeline: {
    name: '이미지 생성기 자동화 파이프라인',
    roles: { image_generator: 'GPT5_2', analyst: 'GPT5_MINI', validator: 'GPT5_MINI' }
  },
  web_scraper_pipeline: {
    name: '웹 스크래퍼 자동화 파이프라인',
    roles: { web_scraper: 'GPT5_2', analyst: 'GPT5_MINI', validator: 'GPT5_MINI' }
  },
};

// ============================================================
// TASK_PIPELINES  –  작업 유형별 기본 파이프라인
// ============================================================
const TASK_PIPELINES = {
  [TASK_TYPES.PPT]: {
    name: 'PPT / 프레젠테이션',
    icon: '📊',
    defaultCombo: 'ppt_balanced',
    steps: [
      { id: 'research',  name: '리서치',     role: 'researcher', description: '최신 데이터 및 정보 수집' },
      { id: 'structure', name: '구성 설계',   role: 'planner',    description: '목차 및 슬라이드 구조 설계' },
      { id: 'content',   name: '콘텐츠 작성', role: 'writer',     description: '각 슬라이드 내용 작성' },
      { id: 'validate',  name: '검증',        role: 'validator',  description: '사실 확인 및 품질 검토' },
      { id: 'assemble',  name: '최종 조립',   role: 'assembler',  description: '완성된 PPT 구조 생성' }
    ],
    parallelGroups: [['research']],
    requiredInfo:   ['topic'],
    estimatedTime:  '3~5분'
  },

  [TASK_TYPES.WEBSITE]: {
    name: '홈페이지 / 웹사이트',
    icon: '🌐',
    defaultCombo: 'website_balanced',
    steps: [
      { id: 'plan',     name: '기획',        role: 'planner',   description: '사이트 구조 및 섹션 설계' },
      { id: 'copy',     name: '카피라이팅',  role: 'writer',    description: '헤드라인, 메뉴, 소개글 작성' },
      { id: 'design',   name: '디자인 설계', role: 'designer',  description: '색상, 레이아웃, 스타일 정의' },
      { id: 'code',     name: '코드 작성',   role: 'coder',     description: 'HTML/CSS/JS 코드 생성' },
      { id: 'validate', name: '코드 검증',   role: 'validator', description: '에러 확인 및 수정' }
    ],
    parallelGroups: [['copy', 'design']],
    requiredInfo:   ['industry'],
    estimatedTime:  '5~8분'
  },

  [TASK_TYPES.BLOG]: {
    name: '블로그 / 콘텐츠',
    icon: '📝',
    defaultCombo: 'blog_seo',
    steps: [
      { id: 'research', name: '리서치',    role: 'researcher', description: '주제 관련 최신 정보 수집' },
      { id: 'outline',  name: '개요 작성', role: 'planner',    description: '글 구조 및 목차 설계' },
      { id: 'write',    name: '본문 작성', role: 'writer',     description: '자연스러운 한국어 본문' },
      { id: 'validate', name: '검증',      role: 'validator',  description: '팩트체크 및 문법 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['topic'],
    estimatedTime:  '2~3분'
  },

  [TASK_TYPES.REPORT]: {
    name: '분석 리포트',
    icon: '📈',
    defaultCombo: 'report_analyst',
    steps: [
      { id: 'collect',  name: '데이터 수집', role: 'researcher', description: '관련 데이터 및 정보 수집' },
      { id: 'analyze',  name: '분석',        role: 'analyst',    description: 'SWOT, 트렌드, 인사이트 도출' },
      { id: 'write',    name: '리포트 작성', role: 'writer',     description: '전문적인 보고서 작성' },
      { id: 'validate', name: '검증',        role: 'validator',  description: '수치 교차 검증 및 사실 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['subject'],
    estimatedTime:  '5~7분'
  },

  [TASK_TYPES.CODE]: {
    name: '코드 / 앱 개발',
    icon: '💻',
    defaultCombo: 'code_standard',
    steps: [
      { id: 'design',   name: '설계',      role: 'planner',   description: '기능 정의 및 기술 스택 선택' },
      { id: 'code',     name: '코드 작성', role: 'coder',     description: '실제 코드 구현' },
      { id: 'review',   name: '코드 리뷰', role: 'reviewer',  description: '코드 품질 및 개선 사항 확인' },
      { id: 'validate', name: '검증',      role: 'validator', description: '에러 및 버그 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['description'],
    estimatedTime:  '8~12분'
  },

  [TASK_TYPES.EMAIL]: {
    name: '이메일 / 문서',
    icon: '✉️',
    defaultCombo: 'email_professional',
    steps: [
      { id: 'write',    name: '작성', role: 'writer',    description: '목적에 맞는 이메일 작성' },
      { id: 'validate', name: '검증', role: 'validator', description: '톤 및 내용 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['purpose'],
    estimatedTime:  '1~2분'
  },

  [TASK_TYPES.RESUME]: {
    name: '자기소개서 / 이력서',
    icon: '📄',
    defaultCombo: 'resume_standard',
    steps: [
      { id: 'structure', name: '구조 설계', role: 'planner',   description: '지원 직무에 맞는 구조 설계' },
      { id: 'write',     name: '작성',      role: 'writer',    description: '강점을 살린 자기소개서 작성' },
      { id: 'validate',  name: '검증',      role: 'validator', description: '맞춤법 및 내용 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['position'],
    estimatedTime:  '3~5분'
  },

  // ── 크리에이티브 비주얼 ────────────────────────────────────
  [TASK_TYPES.ILLUSTRATION]: {
    name: '일러스트 / 비주얼 아트',
    icon: '🖌️',
    defaultCombo: 'illustration_premium',
    steps: [
      { id: 'concept',   name: '콘셉트 기획',  role: 'planner',      description: '스타일·컬러·구도 기획' },
      { id: 'design',    name: '디자인 설계',  role: 'illustrator',  description: 'SVG 구조 및 아트 스타일 설계' },
      { id: 'code',      name: '코드 구현',    role: 'coder',        description: 'SVG/CSS 일러스트 코드 생성' },
      { id: 'validate',  name: '검증',         role: 'validator',    description: '시각적 완성도 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['theme'],
    estimatedTime:  '3~5분'
  },

  [TASK_TYPES.ANIMATION]: {
    name: '애니메이션 제작',
    icon: '🎬',
    defaultCombo: 'animation_premium',
    steps: [
      { id: 'concept',   name: '애니메이션 기획', role: 'planner',   description: '동작 흐름·타이밍·이징 설계' },
      { id: 'design',    name: '비주얼 설계',     role: 'designer',  description: '색상·레이아웃·키프레임 설계' },
      { id: 'animate',   name: '애니메이션 구현', role: 'animator',  description: 'GSAP/CSS/Lottie 코드 생성' },
      { id: 'code',      name: '최종 통합',       role: 'coder',     description: 'HTML+JS 완전 통합' },
      { id: 'validate',  name: '검증',            role: 'validator', description: '60fps 최적화 확인' }
    ],
    parallelGroups: [['design']],
    requiredInfo:   ['description'],
    estimatedTime:  '5~8분'
  },

  [TASK_TYPES.THREE_D]: {
    name: '3D 비주얼 / WebGL',
    icon: '🧊',
    defaultCombo: 'threed_premium',
    steps: [
      { id: 'concept',   name: '3D 씬 기획',   role: 'planner',   description: '오브젝트·조명·카메라 앵글 기획' },
      { id: 'design',    name: '아트 디렉션',  role: 'designer',  description: '색상·텍스처·분위기 설계' },
      { id: 'model',     name: '3D 모델링',    role: 'artist3d',  description: 'Three.js 지오메트리·쉐이더 설계' },
      { id: 'code',      name: '씬 구현',      role: 'coder',     description: 'WebGL/Three.js 완전 구현' },
      { id: 'review',    name: '최적화 리뷰',  role: 'reviewer',  description: '성능·렌더링 최적화' },
      { id: 'validate',  name: '검증',         role: 'validator', description: '크로스 브라우저 확인' }
    ],
    parallelGroups: [['design']],
    requiredInfo:   ['description'],
    estimatedTime:  '8~12분'
  },

  [TASK_TYPES.UI_DESIGN]: {
    name: 'UX/UI 전문 설계',
    icon: '🗂️',
    defaultCombo: 'ui_design_premium',
    steps: [
      { id: 'research',  name: 'UX 리서치',    role: 'ux_architect', description: '사용자 니즈·경쟁사 분석' },
      { id: 'wireframe', name: '와이어프레임', role: 'ux_architect', description: '정보 구조·사용자 플로우 설계' },
      { id: 'design',    name: '비주얼 디자인',role: 'designer',     description: '디자인 시스템·컬러·타이포' },
      { id: 'illustrate',name: '아이콘/일러스트', role: 'illustrator', description: 'UI 아이콘·일러스트 생성' },
      { id: 'code',      name: '컴포넌트 코드',role: 'coder',        description: '반응형 HTML/CSS 컴포넌트' },
      { id: 'validate',  name: '검증',         role: 'validator',    description: 'UX 기준 품질 검토' }
    ],
    parallelGroups: [['design', 'illustrate']],
    requiredInfo:   ['industry'],
    estimatedTime:  '8~12분'
  },

  [TASK_TYPES.VIDEO_SCRIPT]: {
    name: '영상 스크립트 / 콘티',
    icon: '🎥',
    defaultCombo: 'video_script_premium',
    steps: [
      { id: 'research',  name: '리서치',       role: 'researcher',      description: '트렌드·레퍼런스 분석' },
      { id: 'plan',      name: '기획',         role: 'planner',         description: '영상 구성·씬 분할' },
      { id: 'script',    name: '대본 작성',    role: 'scenario_writer', description: '씬별 대사·나레이션 작성' },
      { id: 'write',     name: '자막/카피',    role: 'writer',          description: '자막 텍스트·자막 최적화' },
      { id: 'validate',  name: '검증',         role: 'validator',       description: '흐름·길이 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['topic'],
    estimatedTime:  '5~7분'
  },

  // ── 오디오 & 음악 ──────────────────────────────────────────
  [TASK_TYPES.MUSIC]: {
    name: '음악 / 작곡 가이드',
    icon: '🎵',
    defaultCombo: 'music_premium',
    steps: [
      { id: 'research',  name: '장르 분석',    role: 'researcher', description: '장르·레퍼런스·BPM 분석' },
      { id: 'compose',   name: '작곡 설계',    role: 'composer',   description: '코드 진행·멜로디·편곡 가이드' },
      { id: 'lyrics',    name: '가사 작성',    role: 'writer',     description: '테마에 맞는 가사 작성' },
      { id: 'validate',  name: '검증',         role: 'validator',  description: '음악 이론 적합성 확인' }
    ],
    parallelGroups: [['compose', 'lyrics']],
    requiredInfo:   ['genre'],
    estimatedTime:  '4~6분'
  },

  [TASK_TYPES.PODCAST]: {
    name: '팟캐스트 스크립트',
    icon: '🎙️',
    defaultCombo: 'podcast_premium',
    steps: [
      { id: 'research',  name: '주제 리서치', role: 'researcher', description: '주제 심층 조사·통계 수집' },
      { id: 'plan',      name: '에피소드 기획', role: 'planner',  description: '구성·게스트 질문 설계' },
      { id: 'write',     name: '스크립트 작성', role: 'writer',   description: '인트로·본론·아웃트로 작성' },
      { id: 'validate',  name: '검증',         role: 'validator', description: '길이·흐름 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['topic'],
    estimatedTime:  '4~6분'
  },

  // ── 게임 & 인터랙티브 ──────────────────────────────────────
  [TASK_TYPES.GAME]: {
    name: '게임 / 인터랙티브',
    icon: '🎮',
    defaultCombo: 'game_premium',
    steps: [
      { id: 'design',    name: '게임 기획',    role: 'game_designer',  description: '메커닉·규칙·레벨 설계' },
      { id: 'scenario',  name: '스토리 기획',  role: 'scenario_writer',description: '게임 스토리·대사 작성' },
      { id: 'code',      name: '게임 구현',    role: 'game_coder',     description: 'Canvas/WebGL 게임 코드' },
      { id: 'review',    name: '코드 리뷰',    role: 'reviewer',       description: '성능·버그 검토' },
      { id: 'validate',  name: '검증',         role: 'validator',      description: '플레이어빌리티 확인' }
    ],
    parallelGroups: [['design', 'scenario']],
    requiredInfo:   ['genre'],
    estimatedTime:  '10~15분'
  },

  [TASK_TYPES.AR_VR]: {
    name: 'AR/VR 경험 설계',
    icon: '🥽',
    defaultCombo: 'ar_vr_premium',
    steps: [
      { id: 'ux',        name: 'XR UX 설계',  role: 'ux_architect', description: '공간 UX·인터랙션 설계' },
      { id: 'model',     name: '3D 공간 설계', role: 'artist3d',     description: 'WebXR 씬·오브젝트 구성' },
      { id: 'code',      name: 'XR 구현',     role: 'coder',        description: 'WebXR/Three.js 완전 구현' },
      { id: 'review',    name: '최적화',       role: 'reviewer',     description: 'XR 성능 최적화' },
      { id: 'validate',  name: '검증',         role: 'validator',    description: '디바이스 호환성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['description'],
    estimatedTime:  '10~15분'
  },

  // ── 전문직 도메인 ──────────────────────────────────────────
  [TASK_TYPES.LEGAL]: {
    name: '법률 문서 / 계약서',
    icon: '⚖️',
    defaultCombo: 'legal_premium',
    steps: [
      { id: 'research',  name: '법률 리서치',  role: 'researcher',  description: '관련 법령·판례 조사' },
      { id: 'draft',     name: '문서 초안',    role: 'legal_expert',description: '조항 구성·리스크 분석' },
      { id: 'write',     name: '문서 작성',    role: 'writer',      description: '정확한 법률 문서 작성' },
      { id: 'validate',  name: '검증',         role: 'validator',   description: '법적 완결성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['document_type'],
    estimatedTime:  '5~8분'
  },

  [TASK_TYPES.MEDICAL]: {
    name: '의료 / 헬스케어 콘텐츠',
    icon: '🏥',
    defaultCombo: 'medical_premium',
    steps: [
      { id: 'research',  name: '의학 리서치',  role: 'researcher',    description: '임상 근거·가이드라인 조사' },
      { id: 'analyze',   name: '의학 분석',    role: 'medical_writer',description: '의학적 정확성 분석' },
      { id: 'write',     name: '콘텐츠 작성',  role: 'writer',        description: '환자 친화적 내용 작성' },
      { id: 'validate',  name: '검증',         role: 'validator',     description: '의학 정확성 최종 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['topic'],
    estimatedTime:  '6~9분'
  },

  [TASK_TYPES.FINANCE]: {
    name: '재무 / 투자 분석',
    icon: '💹',
    defaultCombo: 'finance_premium',
    steps: [
      { id: 'collect',   name: '데이터 수집',  role: 'researcher',        description: '재무 데이터·시장 데이터 수집' },
      { id: 'analyze',   name: '재무 분석',    role: 'financial_analyst', description: '재무 모델링·지표 계산' },
      { id: 'insight',   name: '인사이트 도출',role: 'analyst',           description: 'SWOT·투자 시사점 도출' },
      { id: 'report',    name: '보고서 작성',  role: 'writer',            description: '경영진 보고서 형식 작성' },
      { id: 'validate',  name: '검증',         role: 'validator',         description: '수치 정확성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['subject'],
    estimatedTime:  '7~10분'
  },

  [TASK_TYPES.EDUCATION]: {
    name: '교육 커리큘럼 / 강의안',
    icon: '🎓',
    defaultCombo: 'education_premium',
    steps: [
      { id: 'research',  name: '학습 목표 설정', role: 'researcher', description: '대상·수준·목표 분석' },
      { id: 'curriculum',name: '커리큘럼 설계',  role: 'educator',   description: '단원·차시·평가 계획' },
      { id: 'plan',      name: '콘텐츠 기획',    role: 'planner',    description: '강의 흐름·예시 기획' },
      { id: 'write',     name: '강의안 작성',    role: 'writer',     description: '상세 강의 자료 작성' },
      { id: 'validate',  name: '검증',           role: 'validator',  description: '교육 효과 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['subject'],
    estimatedTime:  '6~9분'
  },

  // ── 마케팅 & 브랜딩 ────────────────────────────────────────
  [TASK_TYPES.MARKETING]: {
    name: '마케팅 캠페인 전략',
    icon: '📣',
    defaultCombo: 'marketing_premium',
    steps: [
      { id: 'research',  name: '시장 분석',    role: 'researcher', description: '경쟁사·트렌드·타겟 분석' },
      { id: 'strategy',  name: '전략 수립',    role: 'strategist', description: '캠페인 전략·채널 선정' },
      { id: 'copy',      name: '카피 작성',    role: 'copywriter', description: '핵심 메시지·카피 작성' },
      { id: 'design',    name: '크리에이티브', role: 'designer',   description: '비주얼 가이드라인 설계' },
      { id: 'validate',  name: '검증',         role: 'validator',  description: '일관성·효과 검토' }
    ],
    parallelGroups: [['copy', 'design']],
    requiredInfo:   ['product'],
    estimatedTime:  '6~9분'
  },

  [TASK_TYPES.BRAND]: {
    name: '브랜드 아이덴티티',
    icon: '💎',
    defaultCombo: 'brand_premium',
    steps: [
      { id: 'research',  name: '브랜드 리서치', role: 'researcher',       description: '시장·경쟁사·고객 분석' },
      { id: 'strategy',  name: '브랜드 전략',   role: 'brand_strategist', description: '포지셔닝·차별화 전략' },
      { id: 'identity',  name: '브랜드 아이덴티티', role: 'copywriter',  description: '네이밍·슬로건·보이스 톤' },
      { id: 'visual',    name: '비주얼 가이드',  role: 'designer',         description: '색상·폰트·로고 방향' },
      { id: 'validate',  name: '검증',           role: 'validator',        description: '일관성·차별성 확인' }
    ],
    parallelGroups: [['identity', 'visual']],
    requiredInfo:   ['brand_name'],
    estimatedTime:  '7~10분'
  },

  [TASK_TYPES.AD_COPY]: {
    name: '광고 카피라이팅',
    icon: '✨',
    defaultCombo: 'ad_copy_premium',
    steps: [
      { id: 'research',  name: '타겟 분석',    role: 'researcher', description: '고객 페르소나·니즈 분석' },
      { id: 'strategy',  name: '카피 전략',    role: 'strategist', description: 'USP·핵심 메시지 설정' },
      { id: 'copy',      name: '카피 작성',    role: 'copywriter', description: 'A/B 테스트용 다중 카피 생성' },
      { id: 'validate',  name: '검증',         role: 'validator',  description: '효과·일관성 검토' }
    ],
    parallelGroups: [],
    requiredInfo:   ['product'],
    estimatedTime:  '3~5분'
  },

  [TASK_TYPES.SNS]: {
    name: 'SNS 콘텐츠 패키지',
    icon: '📱',
    defaultCombo: 'sns_premium',
    steps: [
      { id: 'research',  name: '트렌드 분석',  role: 'researcher', description: '플랫폼별 트렌드·해시태그 분석' },
      { id: 'strategy',  name: '콘텐츠 전략',  role: 'strategist', description: '채널별 톤앤매너 설정' },
      { id: 'copy',      name: '포스팅 작성',  role: 'copywriter', description: '인스타·유튜브·틱톡 포스팅 생성' },
      { id: 'visual',    name: '비주얼 가이드',role: 'designer',   description: '이미지 컨셉·레이아웃 제안' },
      { id: 'validate',  name: '검증',         role: 'validator',  description: '플랫폼 최적화 확인' }
    ],
    parallelGroups: [['copy', 'visual']],
    requiredInfo:   ['brand'],
    estimatedTime:  '4~6분'
  },

  // ── 데이터 & 자동화 ────────────────────────────────────────
  [TASK_TYPES.DATA_ANALYSIS]: {
    name: '데이터 분석 / 시각화',
    icon: '📊',
    defaultCombo: 'data_analysis_premium',
    steps: [
      { id: 'collect',   name: '데이터 수집',  role: 'researcher',    description: '데이터 소스·수집 방법 설계' },
      { id: 'analyze',   name: '통계 분석',    role: 'data_scientist',description: '통계·패턴 분석 코드 생성' },
      { id: 'visualize', name: '시각화',       role: 'data_scientist',description: '차트·대시보드 코드 생성' },
      { id: 'insight',   name: '인사이트',     role: 'analyst',       description: '비즈니스 인사이트 도출' },
      { id: 'report',    name: '보고서',       role: 'writer',        description: '분석 보고서 작성' },
      { id: 'validate',  name: '검증',         role: 'validator',     description: '수치·결론 정확성 확인' }
    ],
    parallelGroups: [['analyze', 'visualize']],
    requiredInfo:   ['dataset'],
    estimatedTime:  '7~10분'
  },

  [TASK_TYPES.AUTOMATION]: {
    name: '업무 자동화',
    icon: '🤖',
    defaultCombo: 'automation_premium',
    steps: [
      { id: 'analyze',   name: '업무 흐름 분석', role: 'planner',              description: '자동화 대상 프로세스 분석' },
      { id: 'design',    name: '자동화 설계',    role: 'automation_engineer',  description: 'RPA/API 플로우 설계' },
      { id: 'code',      name: '스크립트 구현',  role: 'automation_engineer',  description: '자동화 코드 생성' },
      { id: 'review',    name: '코드 리뷰',      role: 'reviewer',             description: '안정성·보안 검토' },
      { id: 'validate',  name: '검증',           role: 'validator',            description: '실행 가능성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['process'],
    estimatedTime:  '6~9분'
  },

  [TASK_TYPES.API_DESIGN]: {
    name: 'API 설계 / 문서',
    icon: '🔌',
    defaultCombo: 'api_design_premium',
    steps: [
      { id: 'plan',      name: 'API 기획',      role: 'planner',   description: '엔드포인트·데이터 모델 설계' },
      { id: 'spec',      name: 'OpenAPI 스펙',  role: 'coder',     description: 'OpenAPI 3.0 스펙 문서 생성' },
      { id: 'implement', name: '구현 코드',     role: 'coder',     description: 'Express/FastAPI 구현 코드' },
      { id: 'review',    name: '리뷰',          role: 'reviewer',  description: 'REST 원칙·보안 검토' },
      { id: 'validate',  name: '검증',          role: 'validator', description: '완성도 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['service'],
    estimatedTime:  '6~9분'
  },

  // ── 스토리텔링 ─────────────────────────────────────────────
  [TASK_TYPES.NOVEL]: {
    name: '소설 / 단편 창작',
    icon: '📖',
    defaultCombo: 'novel_premium',
    steps: [
      { id: 'worldbuild', name: '세계관 구축',   role: 'planner',  description: '배경·세계관·규칙 설계' },
      { id: 'character',  name: '캐릭터 설계',   role: 'novelist', description: '주인공·조연 캐릭터 설계' },
      { id: 'plot',       name: '플롯 설계',     role: 'novelist', description: '기승전결·서브플롯 구성' },
      { id: 'write',      name: '본문 작성',     role: 'writer',   description: '완성된 소설 본문 작성' },
      { id: 'validate',   name: '검증',          role: 'validator',description: '일관성·문체 적절성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['genre'],
    estimatedTime:  '8~12분'
  },

  [TASK_TYPES.SCENARIO]: {
    name: '시나리오 / 스크립트',
    icon: '🎭',
    defaultCombo: 'scenario_premium',
    steps: [
      { id: 'concept',   name: '기획',         role: 'planner',         description: '장르·분위기·주제 기획' },
      { id: 'world',     name: '세계관',       role: 'scenario_writer', description: '배경·설정·시대적 맥락' },
      { id: 'scene',     name: '씬 구성',      role: 'scenario_writer', description: '장면 분할·전환 설계' },
      { id: 'dialogue',  name: '대사 작성',    role: 'writer',          description: '캐릭터별 대사·나레이션' },
      { id: 'validate',  name: '검증',         role: 'validator',       description: '드라마투르기 완성도 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['genre'],
    estimatedTime:  '7~10분'
  },

  [TASK_TYPES.TRANSLATION]: {
    name: '전문 번역 / 현지화',
    icon: '🌐',
    defaultCombo: 'translation_premium',
    steps: [
      { id: 'analyze',   name: '원문 분석',    role: 'researcher',  description: '전문 용어·맥락·톤 분석' },
      { id: 'translate', name: '번역',         role: 'translator',  description: '정확한 1차 번역' },
      { id: 'localize',  name: '현지화',       role: 'writer',      description: '문화적 뉘앙스 반영 및 교정' },
      { id: 'validate',  name: '검증',         role: 'validator',   description: '번역 정확성·자연스러움 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['source_language'],
    estimatedTime:  '3~5분'
  },

  // ── 신규 파이프라인 (테스트케이스 1005개 분석 기반 추가) ──────

  [TASK_TYPES.OCR]: {
    name: 'OCR / 문서 디지털화',
    icon: '📄',
    defaultCombo: 'ocr_standard',
    steps: [
      { id: 'preprocess', name: '이미지 전처리',  role: 'ocr_specialist',  description: '이미지 보정, 노이즈 제거' },
      { id: 'extract',    name: '텍스트 추출',    role: 'ocr_specialist',  description: 'OCR 실행 및 구조 인식' },
      { id: 'structure',  name: '데이터 구조화', role: 'analyst',          description: '표/항목 분류 및 정리' },
      { id: 'validate',   name: '검증',           role: 'validator',       description: '추출 정확도 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['document_type'],
    estimatedTime:  '2~4분'
  },

  [TASK_TYPES.STT]: {
    name: '음성 인식 / STT',
    icon: '🎤',
    defaultCombo: 'stt_standard',
    steps: [
      { id: 'transcribe', name: '음성 변환',  role: 'stt_engineer',   description: '음성→텍스트 Whisper 처리' },
      { id: 'diarize',    name: '화자 분리',  role: 'stt_engineer',   description: '화자별 발화 구분' },
      { id: 'summarize',  name: '요약 정리',  role: 'writer',         description: '핵심 내용 요약 및 포맷' },
      { id: 'validate',   name: '검증',       role: 'validator',      description: '전사 정확도 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['audio_type'],
    estimatedTime:  '3~6분'
  },

  [TASK_TYPES.SECURITY]: {
    name: '보안 분석 / 취약점 패치',
    icon: '🔒',
    defaultCombo: 'security_standard',
    steps: [
      { id: 'scan',    name: '취약점 스캔',   role: 'security_expert', description: '정적 분석 및 OWASP 매핑' },
      { id: 'analyze', name: '리스크 분석',   role: 'security_expert', description: '위험도 점수화 및 우선순위' },
      { id: 'patch',   name: '방어 코드 생성', role: 'coder',           description: '취약점 수정 코드 작성' },
      { id: 'review',  name: '코드 리뷰',     role: 'reviewer',        description: '패치 적용 후 재검증' },
      { id: 'report',  name: '보안 리포트',   role: 'writer',          description: '취약점 리포트 문서화' }
    ],
    parallelGroups: [],
    requiredInfo:   ['code_language'],
    estimatedTime:  '8~15분'
  },

  [TASK_TYPES.DB_DESIGN]: {
    name: 'DB 설계 / 쿼리 최적화',
    icon: '🗄️',
    defaultCombo: 'db_standard',
    steps: [
      { id: 'analyze',  name: '요구사항 분석', role: 'db_architect',    description: '데이터 모델 요구사항 파악' },
      { id: 'design',   name: 'ERD 설계',      role: 'db_architect',    description: '엔티티·관계 모델링' },
      { id: 'generate', name: 'SQL 생성',      role: 'coder',           description: '스키마·인덱스·제약 코드' },
      { id: 'optimize', name: '쿼리 최적화',   role: 'db_architect',    description: '실행계획 분석 및 최적화' },
      { id: 'validate', name: '검증',          role: 'reviewer',        description: '스키마 정합성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['db_type'],
    estimatedTime:  '5~10분'
  },

  [TASK_TYPES.COMPLIANCE]: {
    name: '규정 준수 / 감사 지원',
    icon: '⚖️',
    defaultCombo: 'compliance_standard',
    steps: [
      { id: 'collect',  name: '자료 수집',     role: 'researcher',         description: '관련 법령·규정 수집' },
      { id: 'review',   name: '컴플라이언스 검토', role: 'compliance_officer', description: '위반 여부 및 리스크 분석' },
      { id: 'report',   name: '감사 리포트',   role: 'writer',             description: '리스크 레포트 작성' },
      { id: 'plan',     name: '개선 계획',     role: 'planner',            description: '시정 조치 계획 수립' },
      { id: 'validate', name: '검증',          role: 'validator',          description: '법적 적합성 최종 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['regulation_type'],
    estimatedTime:  '7~12분'
  },

  [TASK_TYPES.ML_PIPELINE]: {
    name: 'ML 파이프라인 / 모델 배포',
    icon: '🤖',
    defaultCombo: 'ml_standard',
    steps: [
      { id: 'data_prep',  name: '데이터 전처리',  role: 'ml_engineer',       description: '피처 엔지니어링·정규화' },
      { id: 'model',      name: '모델 설계',      role: 'ml_engineer',       description: '알고리즘 선택·하이퍼파라미터' },
      { id: 'train',      name: '학습 코드',      role: 'coder',             description: '학습 스크립트 및 평가 코드' },
      { id: 'deploy',     name: '배포 파이프라인', role: 'automation_engineer', description: 'API 래핑·모니터링 설정' },
      { id: 'validate',   name: '검증',           role: 'reviewer',          description: '모델 성능·공정성 검토' }
    ],
    parallelGroups: [],
    requiredInfo:   ['ml_task_type'],
    estimatedTime:  '10~20분'
  },

  [TASK_TYPES.WEB_SCRAPING]: {
    name: '웹 스크래핑 / 데이터 수집',
    icon: '🕷️',
    defaultCombo: 'scraping_standard',
    steps: [
      { id: 'plan',     name: '수집 계획',    role: 'planner',             description: '타겟 URL·데이터 구조 설계' },
      { id: 'scrape',   name: '크롤링',       role: 'automation_engineer', description: 'Puppeteer/Playwright 실행' },
      { id: 'parse',    name: '파싱',         role: 'coder',               description: '데이터 구조화 및 정제' },
      { id: 'store',    name: '저장',         role: 'db_architect',        description: 'DB 저장 및 API 응답 설계' },
      { id: 'validate', name: '검증',         role: 'validator',           description: '수집 완전성 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['target_url'],
    estimatedTime:  '3~8분'
  },

  [TASK_TYPES.REALTIME]: {
    name: '실시간 모니터링 / 알림',
    icon: '⚡',
    defaultCombo: 'realtime_standard',
    steps: [
      { id: 'define',   name: '모니터링 기준 설계', role: 'planner',             description: '임계값·조건·알림 규칙' },
      { id: 'detect',   name: '이상 탐지',          role: 'ml_engineer',         description: '실시간 데이터 분석' },
      { id: 'alert',    name: '알림 발송',           role: 'automation_engineer', description: '다채널 알림 트리거' },
      { id: 'report',   name: '인시던트 리포트',     role: 'writer',              description: '장애·이벤트 자동 문서화' }
    ],
    parallelGroups: [],
    requiredInfo:   ['monitoring_target'],
    estimatedTime:  '실시간 (설정 3~5분)'
  },

  [TASK_TYPES.VIDEO_EDIT]: {
    name: 'AI 영상 편집 / 하이라이트',
    icon: '🎬',
    defaultCombo: 'video_edit_standard',
    steps: [
      { id: 'analyze',    name: '영상 분석',    role: 'video_editor',  description: '장면 분류·키프레임 추출' },
      { id: 'highlight',  name: '하이라이트',   role: 'video_editor',  description: '핵심 구간 자동 선택' },
      { id: 'script',     name: '자막/스크립트', role: 'writer',        description: 'STT 기반 자막 생성' },
      { id: 'assemble',   name: '편집 완성',    role: 'assembler',     description: '클립 합성 및 최종 출력' },
      { id: 'validate',   name: '검증',         role: 'validator',     description: '품질·싱크 확인' }
    ],
    parallelGroups: [],
    requiredInfo:   ['video_purpose'],
    estimatedTime:  '8~15분'
  }
};

// ── 하위 호환 AI_MODELS ───────────────────────────────────
const AI_MODELS = {
  GPT4O:         { id: MODEL_REGISTRY.GPT5.id,      name: MODEL_REGISTRY.GPT5.name,      provider: 'openai', strengths: MODEL_REGISTRY.GPT5.bestFor },
  GPT4O_MINI:    { id: MODEL_REGISTRY.GPT5_MINI.id, name: MODEL_REGISTRY.GPT5_MINI.name, provider: 'openai', strengths: MODEL_REGISTRY.GPT5_MINI.bestFor },
  GPT4_1:        { id: MODEL_REGISTRY.GPT5_1.id,    name: MODEL_REGISTRY.GPT5_1.name,    provider: 'openai', strengths: MODEL_REGISTRY.GPT5_1.bestFor },
  CLAUDE_SONNET: { id: MODEL_REGISTRY.GPT5.id,      name: MODEL_REGISTRY.GPT5.name,      provider: 'openai', strengths: ['korean', 'creative_writing'] }
};

// 질문 템플릿
const QUESTION_TEMPLATES = {
  // 기존
  [TASK_TYPES.PPT]:          '어떤 주제로 만들까요?',
  [TASK_TYPES.WEBSITE]:      '어떤 분야/업종인가요?',
  [TASK_TYPES.BLOG]:         '어떤 주제로 쓸까요?',
  [TASK_TYPES.REPORT]:       '무엇을 분석할까요?',
  [TASK_TYPES.CODE]:         '어떤 기능의 코드가 필요한가요?',
  [TASK_TYPES.EMAIL]:        '어떤 목적의 이메일인가요?',
  [TASK_TYPES.RESUME]:       '어떤 직무에 지원하시나요?',
  // 크리에이티브 비주얼
  [TASK_TYPES.ILLUSTRATION]: '어떤 스타일의 일러스트가 필요한가요?',
  [TASK_TYPES.ANIMATION]:    '어떤 애니메이션 효과가 필요한가요?',
  [TASK_TYPES.THREE_D]:      '어떤 3D 씬/오브젝트를 만들까요?',
  [TASK_TYPES.UI_DESIGN]:    '어떤 서비스/앱의 UX/UI를 설계할까요?',
  [TASK_TYPES.VIDEO_SCRIPT]: '어떤 영상의 스크립트가 필요한가요?',
  // 오디오 & 음악
  [TASK_TYPES.MUSIC]:        '어떤 장르/분위기의 음악인가요?',
  [TASK_TYPES.PODCAST]:      '어떤 주제의 팟캐스트인가요?',
  // 게임 & 인터랙티브
  [TASK_TYPES.GAME]:         '어떤 장르의 게임을 만들까요?',
  [TASK_TYPES.AR_VR]:        '어떤 AR/VR 경험을 설계할까요?',
  // 전문직 도메인
  [TASK_TYPES.LEGAL]:        '어떤 종류의 법률 문서가 필요한가요?',
  [TASK_TYPES.MEDICAL]:      '어떤 의료/헬스케어 주제인가요?',
  [TASK_TYPES.FINANCE]:      '어떤 재무/투자 분석이 필요한가요?',
  [TASK_TYPES.EDUCATION]:    '어떤 과목/주제의 강의안인가요?',
  // 마케팅 & 브랜딩
  [TASK_TYPES.MARKETING]:    '어떤 제품/서비스의 마케팅 전략인가요?',
  [TASK_TYPES.BRAND]:        '어떤 브랜드의 아이덴티티를 만들까요?',
  [TASK_TYPES.AD_COPY]:      '어떤 제품/서비스의 광고 카피인가요?',
  [TASK_TYPES.SNS]:          '어떤 브랜드/주제의 SNS 콘텐츠인가요?',
  // 데이터 & 자동화
  [TASK_TYPES.DATA_ANALYSIS]:'어떤 데이터를 분석할까요?',
  [TASK_TYPES.AUTOMATION]:   '어떤 업무를 자동화할까요?',
  [TASK_TYPES.API_DESIGN]:   '어떤 서비스의 API를 설계할까요?',
  // 스토리텔링
  [TASK_TYPES.NOVEL]:        '어떤 장르의 소설을 쓸까요?',
  [TASK_TYPES.SCENARIO]:     '어떤 장르의 시나리오인가요?',
  [TASK_TYPES.TRANSLATION]:  '어떤 언어로 번역할까요?',
  // ── 신규 분야 질문 템플릿 ─────────────────────────────────
  [TASK_TYPES.OCR]:          '어떤 문서/이미지에서 텍스트를 추출할까요?',
  [TASK_TYPES.STT]:          '어떤 음성/영상을 텍스트로 변환할까요?',
  [TASK_TYPES.VIDEO_EDIT]:   '어떤 영상을 편집하거나 하이라이트할까요?',
  [TASK_TYPES.SECURITY]:     '어떤 코드/시스템의 보안을 분석할까요?',
  [TASK_TYPES.DB_DESIGN]:    '어떤 서비스의 DB를 설계/최적화할까요?',
  [TASK_TYPES.COMPLIANCE]:   '어떤 법령/규정을 준수해야 하나요?',
  [TASK_TYPES.ML_PIPELINE]:  '어떤 ML 모델/파이프라인을 구축할까요?',
  [TASK_TYPES.REALTIME]:     '무엇을 실시간으로 모니터링할까요?',
  [TASK_TYPES.WEB_SCRAPING]: '어떤 웹사이트에서 데이터를 수집할까요?',
  [TASK_TYPES.UNKNOWN]:      '어떤 결과물이 필요하신가요?'
};

// ============================================================
// 분야별 최고 모델 요약 (참조용)
// ============================================================
const BEST_IN_CLASS = {
  // ── 2026년 3월 분야별 최고 ──────────────────────────────
  overall:      { model: 'GPT-5.4',           metric: 'Elo 1555 · Intel.Index 57 · S-tier', proxy: 'GPT5_2', modelKey: 'GPT5_4' },
  reasoning:    { model: 'Claude Opus 4.6',   metric: 'GPQA 91.9% · Adaptive Thinking',    proxy: 'GPT5_2', modelKey: 'CLAUDE_OPUS_46' },
  coding:       { model: 'Claude Sonnet 5',   metric: 'SWE-bench 82.1% · Dev Team 모드',   proxy: 'GPT5_2_CODEX', modelKey: 'CLAUDE_SONNET_5' },
  math:         { model: 'Gemini 3.1 Pro',    metric: 'AIME 95.0% · GPQA 94.3%',           proxy: 'GPT5_2', modelKey: 'GEMINI_3_PRO' },
  science:      { model: 'Gemini 3.1 Pro',    metric: 'GPQA Diamond 94.3% · 2M ctx',       proxy: 'GPT5_2', modelKey: 'GEMINI_3_PRO' },
  writing:      { model: 'GPT-5.1',           metric: 'Creative Writing v3 #1',            proxy: 'GPT5_1', modelKey: 'GPT5_1' },
  korean:       { model: 'Claude Sonnet 4.6', metric: '한국어 최자연스러움',                  proxy: 'GPT5_1', modelKey: 'CLAUDE_SONNET_46' },
  speed:        { model: 'Gemini 3 Flash',    metric: '<1s 실시간 · 1M ctx',               proxy: 'GPT5_NANO', modelKey: 'GEMINI_3_FLASH' },
  economy:      { model: 'DeepSeek V3.2',     metric: '성능/달러 310.86 · $0.28/1M',       proxy: 'GPT5_MINI', modelKey: 'DEEPSEEK_V3_2' },
  openSourceReasoning: { model: 'DeepSeek R2', metric: 'Elo 1515 · AIME 96% · GPT-5급',   proxy: 'GPT5_2', modelKey: 'DEEPSEEK_R2' },
  agentic:      { model: 'Kimi K2.5',         metric: '에이전트 스웜 · GPT-5.2 능가',       proxy: 'GPT5_2', modelKey: 'KIMI_K2_5' },
  longContext:  { model: 'Llama 4 Scout',     metric: '10M 컨텍스트',                      proxy: 'GPT5_2', modelKey: 'LLAMA4_SCOUT' },
  openSource:   { model: 'Llama 4.1 Maverick', metric: '무료 · GPT-5.2 5% 내 MMLU',       proxy: null, modelKey: 'LLAMA41_MAVERICK' },
  multimodal:   { model: 'Gemini 3.1 Pro',    metric: '2M ctx + 멀티모달 리더',             proxy: 'GPT5_2', modelKey: 'GEMINI_3_PRO' },
  image:        { model: 'Nano Banana Pro',   metric: '~150ms · 완벽 텍스트 렌더링',        proxy: null, modelKey: null },
  video:        { model: 'Sora 2',            metric: '물리 현실감 최고',                    proxy: null, modelKey: null }
};

module.exports = {
  TASK_TYPES,
  TASK_STATUS,
  MODEL_REGISTRY,
  COMBO_ROLES,
  KNOWN_COMBOS,
  TASK_PIPELINES,
  AI_MODELS,
  QUESTION_TEMPLATES,
  BEST_IN_CLASS
};

// ── 실제 운영 모델 화이트리스트에 추가 (MODEL_REGISTRY 보완) ────
// types/index.js의 MODEL_REGISTRY는 미래 모델 위주이므로
// 현재 실제로 사용 가능한 모델을 여기서 병합
const REAL_MODELS = {
  // OpenAI
  'gpt-4o': {
    id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', tier: 'flagship',
    available: true, contextWindow: '128K', avgLatencyMs: 1200,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    bestFor: ['analysis','code','vision'], benchmark: { overall: 87 }
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', tier: 'fast',
    available: true, contextWindow: '128K', avgLatencyMs: 600,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    bestFor: ['chat','fast','text'], benchmark: { overall: 78 }
  },
  // Anthropic
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001', provider: 'anthropic', name: 'Claude Haiku 4.5', tier: 'fast',
    available: true, contextWindow: '200K', avgLatencyMs: 500,
    costPer1kTokens: { input: 0.0008, output: 0.004 },
    bestFor: ['chat','fast'], benchmark: { overall: 76 }
  },
  'claude-sonnet-4-5-20250929': {
    id: 'claude-sonnet-4-5-20250929', provider: 'anthropic', name: 'Claude Sonnet 4.5', tier: 'balanced',
    available: true, contextWindow: '200K', avgLatencyMs: 1500,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    bestFor: ['analysis','code'], benchmark: { overall: 85 }
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', tier: 'flagship',
    available: true, contextWindow: '200K', avgLatencyMs: 1800,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    bestFor: ['creative','analysis'], benchmark: { overall: 88 }
  },
  // Google
  'gemini-1.5-flash': {
    id: 'gemini-1.5-flash', provider: 'google', name: 'Gemini 1.5 Flash', tier: 'fast',
    available: false, contextWindow: '1M', avgLatencyMs: 400,
    costPer1kTokens: { input: 0.000075, output: 0.0003 },
    bestFor: ['fast','chat'], benchmark: { overall: 75 }
  },
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash', provider: 'google', name: 'Gemini 2.0 Flash', tier: 'fast',
    available: false, contextWindow: '1M', avgLatencyMs: 400,
    costPer1kTokens: { input: 0.0001, output: 0.0004 },
    bestFor: ['fast','chat','analysis'], benchmark: { overall: 80 }
  },
  'gemini-3-flash-preview': {
    id: 'gemini-3-flash-preview', provider: 'google', name: 'Gemini 3 Flash Preview', tier: 'fast',
    available: true, contextWindow: '1M', avgLatencyMs: 400,
    costPer1kTokens: { input: 0.0001, output: 0.0004 },
    bestFor: ['fast','chat','analysis','code'], benchmark: { overall: 85 }
  },
  'gemini-2.0-flash-lite': {
    id: 'gemini-2.0-flash-lite', provider: 'google', name: 'Gemini 2.0 Flash Lite', tier: 'fast',
    available: true, contextWindow: '1M', avgLatencyMs: 300,
    costPer1kTokens: { input: 0.000075, output: 0.0003 },
    bestFor: ['fast'], benchmark: { overall: 75 }
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash', provider: 'google', name: 'Gemini 2.5 Flash', tier: 'flagship',
    available: true, contextWindow: '1M', avgLatencyMs: 600,
    costPer1kTokens: { input: 0.0003, output: 0.0012 },
    bestFor: ['analysis','code'], benchmark: { overall: 86 }
  },
  // DeepSeek
  'deepseek-chat': {
    id: 'deepseek-chat', provider: 'deepseek', name: 'DeepSeek Chat', tier: 'balanced',
    available: true, contextWindow: '64K', avgLatencyMs: 800,
    costPer1kTokens: { input: 0.00014, output: 0.00028 },
    bestFor: ['code','analysis'], benchmark: { overall: 82 }
  },
  // xAI
  // ⚠️ 2026-03-11: xAI 전체 임시 비활성화 — 크레딧 없음 (403 Forbidden)
  //    복원: https://console.x.ai/team/45126a65-5ffa-4147-9b1e-c1daa7e9c549 에서 크레딧 충전 후
  //    available: true 로 변경 및 재배포
  'grok-beta': {
    id: 'grok-beta', provider: 'xai', name: 'Grok Beta', tier: 'balanced',
    available: false, // 2026-03-11: xAI 크레딧 없음 (403) — 크레딧 충전 후 true로 변경
    contextWindow: '131K', avgLatencyMs: 300,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    bestFor: ['chat','creative'], benchmark: { overall: 80 }
  },
  'grok-3-mini': {
    id: 'grok-3-mini', provider: 'xai', name: 'Grok 3 Mini', tier: 'fast',
    available: false, // 2026-03-11: xAI 크레딧 없음 (403) — 크레딧 충전 후 true로 변경
    contextWindow: '131K', avgLatencyMs: 500,
    costPer1kTokens: { input: 0.0003, output: 0.0005 },
    bestFor: ['chat','fast'], benchmark: { overall: 78 }
  },
  'grok-3': {
    id: 'grok-3', provider: 'xai', name: 'Grok 3', tier: 'flagship',
    available: false, // 2026-03-11: xAI 크레딧 없음 (403) — 크레딧 충전 후 true로 변경
    contextWindow: '131K', avgLatencyMs: 800,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    bestFor: ['chat','analysis','code'], benchmark: { overall: 85 }
  },
  // Mistral
  'mistral-small-latest': {
    id: 'mistral-small-latest', provider: 'mistral', name: 'Mistral Small', tier: 'fast',
    available: true, contextWindow: '32K', avgLatencyMs: 500,
    costPer1kTokens: { input: 0.001, output: 0.003 },
    bestFor: ['chat','fast'], benchmark: { overall: 74 }
  },
  // Moonshot
  'moonshot-v1-8k': {
    id: 'moonshot-v1-8k', provider: 'moonshot', name: 'Moonshot v1 8K', tier: 'fast',
    available: true, contextWindow: '8K', avgLatencyMs: 1200,
    costPer1kTokens: { input: 0.012, output: 0.012 },
    bestFor: ['chat'], benchmark: { overall: 70 }
  },
  'moonshot-v1-32k': {
    id: 'moonshot-v1-32k', provider: 'moonshot', name: 'Moonshot v1 32K', tier: 'balanced',
    available: true, contextWindow: '32K', avgLatencyMs: 900,
    costPer1kTokens: { input: 0.024, output: 0.024 },
    bestFor: ['chat','analysis'], benchmark: { overall: 72 }
  },
  'kimi-k2-turbo-preview': {
    id: 'kimi-k2-turbo-preview', provider: 'moonshot', name: 'Kimi K2 Turbo', tier: 'fast',
    available: true, contextWindow: '128K', avgLatencyMs: 700,
    costPer1kTokens: { input: 0.004, output: 0.012 },
    bestFor: ['chat','fast'], benchmark: { overall: 78 }
  },
};

// MODEL_REGISTRY에 실제 모델 병합
Object.assign(MODEL_REGISTRY, REAL_MODELS);
module.exports.REAL_MODELS = REAL_MODELS;
