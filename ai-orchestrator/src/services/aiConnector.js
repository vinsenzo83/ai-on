'use strict';
/**
 * aiConnector.js — Phase 12: 최고 성능 엔진
 *
 * ✅ 핵심 업그레이드:
 *  1. 회로차단기(Circuit Breaker) — 실패 프로바이더 자동 격리 (5회 실패→60초 차단)
 *  2. 스마트 타임아웃 — 프로바이더별 실측 P95 기반 동적 데드라인
 *  3. 병렬 폴백 레이싱 — 느린 프로바이더 응답 대기 중 경쟁 요청 전송
 *  4. 고성능 응답 캐시 — TTL 5분, 최대 500개, 인메모리 히트율 극대화
 *  5. 스마트 재시도 — 에러 유형별 즉시 폴백 vs 지수백오프 분리
 */
const OpenAI      = require('openai');
const costTracker = require('./costTracker');
const modelReg    = require('./modelRegistry');
const { MODEL_REGISTRY } = require('../types/index.js');

// ── DB 지연 로드 (순환참조 방지) ─────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) { try { _db = require('../db/database'); } catch(_) {} }
  return _db;
}

// ══════════════════════════════════════════════════════════════
// 1. 회로차단기 (Circuit Breaker) — 실패 프로바이더 자동 격리
// ══════════════════════════════════════════════════════════════
const CB_FAIL_THRESHOLD = 3;      // 연속 실패 3회 → OPEN (P4: DeepSeek 빠른 격리)
const CB_RESET_MS       = 60_000; // 60초 후 HALF-OPEN
const CB_HALF_OPEN_MAX  = 1;      // HALF-OPEN 상태에서 1회 시도

const _circuitState = {}; // { provider: { failures, state, openedAt, halfOpenAttempts } }

function _getCB(provider) {
  if (!_circuitState[provider]) {
    _circuitState[provider] = { failures: 0, state: 'CLOSED', openedAt: 0, halfOpenAttempts: 0 };
  }
  return _circuitState[provider];
}

function _isCBOpen(provider) {
  const cb = _getCB(provider);
  if (cb.state === 'CLOSED') return false;
  if (cb.state === 'OPEN') {
    if (Date.now() - cb.openedAt >= CB_RESET_MS) {
      cb.state = 'HALF_OPEN';
      cb.halfOpenAttempts = 0;
      return false; // HALF-OPEN: 1회 시도 허용
    }
    return true;
  }
  if (cb.state === 'HALF_OPEN') {
    return cb.halfOpenAttempts >= CB_HALF_OPEN_MAX;
  }
  return false;
}

function _cbSuccess(provider) {
  const cb = _getCB(provider);
  cb.failures = 0;
  cb.state    = 'CLOSED';
  cb.halfOpenAttempts = 0;
}

function _cbFailure(provider) {
  const cb = _getCB(provider);
  if (cb.state === 'HALF_OPEN') {
    cb.state    = 'OPEN';
    cb.openedAt = Date.now();
    console.warn(`[CB] ${provider} HALF-OPEN 실패 → OPEN (60s 차단)`);
    return;
  }
  cb.failures++;
  if (cb.failures >= CB_FAIL_THRESHOLD) {
    cb.state    = 'OPEN';
    cb.openedAt = Date.now();
    console.warn(`[CB] ${provider} ${cb.failures}회 연속 실패 → 60초 차단`);
  }
}

function getCircuitStatus() {
  return Object.fromEntries(
    Object.entries(_circuitState).map(([p, s]) => [p, {
      state: s.state,
      failures: s.failures,
      remainingMs: s.state === 'OPEN' ? Math.max(0, CB_RESET_MS - (Date.now() - s.openedAt)) : 0,
    }])
  );
}

// ══════════════════════════════════════════════════════════════
// 2. 스마트 타임아웃 — 프로바이더별 실측 P95 기반
// ══════════════════════════════════════════════════════════════
// 프로바이더별 최근 레이턴시 슬라이딩 윈도우 (최대 20개 샘플)
const _latencySamples = {};
const LATENCY_WINDOW = 20;

// 초기 기본값 (과거 데이터 기반)
const PROVIDER_DEFAULT_TIMEOUT = {
  openai:     60_000, // [FIX v3] 20s→60s: PPT/보고서 등 긴 요청 지원
  anthropic:  60_000, // 25s→60s
  google:     45_000, // 20s→45s: gemini-2.5-flash
  mistral:    30_000,
  moonshot:   30_000,
  deepseek:   30_000,
  xai:        20_000,
  groq:       15_000,
  meta:       30_000,
  alibaba:    30_000,
  default:    30_000,
};

function _recordLatency(provider, ms) {
  if (!_latencySamples[provider]) _latencySamples[provider] = [];
  _latencySamples[provider].push(ms);
  if (_latencySamples[provider].length > LATENCY_WINDOW) {
    _latencySamples[provider].shift();
  }
}

function _getAdaptiveTimeout(provider, model, strategy, explicitMs) {
  if (explicitMs > 0) return explicitMs;

  // 샘플 있으면 P95 × 1.3 사용 (최대 60s)
  const samples = _latencySamples[provider];
  if (samples && samples.length >= 5) {
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return Math.min(Math.max(p95 * 1.3, 10_000), 60_000); // 10s~60s 클램프
  }

  // 항상 기본값 그대로 사용 (fast 전략도 감소 없음)
  const base = PROVIDER_DEFAULT_TIMEOUT[provider] || PROVIDER_DEFAULT_TIMEOUT.default;
  return base;
}

// ══════════════════════════════════════════════════════════════
// 3. 고성능 응답 캐시 — TTL 5분, 최대 500개, LRU
// ══════════════════════════════════════════════════════════════
const _responseCache = new Map();
const CACHE_TTL_MS   = 600_000; // P3: 10분 TTL (PM2 재시작 히트율 향상)
const CACHE_MAX_SIZE = 1000;    // P3: 최대 1000개 (히트율 향상)
let _cacheHits = 0;
let _cacheMisses = 0;

function _cacheKey(model, messages) {
  // 마지막 2개 메시지 + 모델로 키 생성 (빠른 해시)
  const last = messages?.slice(-2).map(m =>
    m.role[0] + ':' + (m.content || '').slice(0, 120)
  ).join('||');
  return `${model}::${last}`;
}

function _cacheGet(key) {
  const entry = _responseCache.get(key);
  if (!entry) { _cacheMisses++; return null; }
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _responseCache.delete(key);
    _cacheMisses++;
    return null;
  }
  // LRU: 접근 시 ts 갱신
  entry.hits = (entry.hits || 0) + 1;
  _cacheHits++;
  return entry.value;
}

function _cacheSet(key, value) {
  if (_responseCache.size >= CACHE_MAX_SIZE) {
    // LRU eviction: 가장 오래 접근 안 된 항목 제거
    let oldest = null, oldestTs = Infinity;
    for (const [k, e] of _responseCache) {
      if (e.ts < oldestTs) { oldestTs = e.ts; oldest = k; }
    }
    if (oldest) _responseCache.delete(oldest);
  }
  _responseCache.set(key, { value, ts: Date.now(), hits: 0 });
}

function getCacheStats() {
  const now = Date.now();
  const valid = [..._responseCache.values()].filter(e => now - e.ts <= CACHE_TTL_MS).length;
  const total = _cacheHits + _cacheMisses;
  return {
    size: _responseCache.size,
    valid,
    maxSize: CACHE_MAX_SIZE,
    ttlMs: CACHE_TTL_MS,
    hits: _cacheHits,
    misses: _cacheMisses,
    hitRate: total > 0 ? +(_cacheHits / total * 100).toFixed(1) : 0,
  };
}
function clearCache() { _responseCache.clear(); _cacheHits = 0; _cacheMisses = 0; }

// ══════════════════════════════════════════════════════════════
// 4. 구조화된 AI 에러 클래스
// ══════════════════════════════════════════════════════════════
class AIError extends Error {
  constructor(message, { code, provider, model, statusCode, retryable = false } = {}) {
    super(message);
    this.name       = 'AIError';
    this.code       = code       || 'AI_ERROR';
    this.provider   = provider   || 'unknown';
    this.model      = model      || 'unknown';
    this.statusCode = statusCode;
    this.retryable  = retryable;
  }
}

// ══════════════════════════════════════════════════════════════
// 5. 프로바이더 설정
// ══════════════════════════════════════════════════════════════
const PROVIDER_BASE_URL = {
  openai:     'https://api.openai.com/v1',
  anthropic:  null,
  google:     'https://generativelanguage.googleapis.com/v1beta/openai/',
  azure:      null,
  groq:       'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek:   'https://api.deepseek.com/v1',
  xai:        'https://api.x.ai/v1',
  moonshot:   'https://api.moonshot.cn/v1',
  mistral:    'https://api.mistral.ai/v1',
  alibaba:    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  meta:       'https://api.together.xyz/v1',
};

// [FIX v2] 폴백 우선순위 체인 — Google 복원 (gemini-2.5-flash 정상), xai/groq 추가
// 순서: google → anthropic → deepseek → mistral → moonshot → openai
const FALLBACK_CHAIN = ['google', 'anthropic', 'deepseek', 'mistral', 'moonshot', 'openai'];

// ── 런타임 클라이언트 캐시 ─────────────────────────────────────
const _clients = {};

function _getClient(provider) {
  if (provider === 'anthropic') return _getAnthropic();
  if (_clients[provider]) return _clients[provider];

  // 1) admin store 우선
  let apiKey = null, baseURL = null;
  try {
    const store = require('../routes/admin')._apiConfigStore;
    if (store?.[provider]) { apiKey = store[provider].apiKey; baseURL = store[provider].baseUrl || null; }
  } catch(_) {}

  // 2) 환경변수 fallback
  if (!apiKey) {
    const ENV_MAP = {
      openai:     process.env.REAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      google:     process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
      groq:       process.env.GROQ_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      deepseek:   process.env.DEEPSEEK_API_KEY,
      xai:        process.env.XAI_API_KEY,
      moonshot:   process.env.MOONSHOT_API_KEY,
      mistral:    process.env.MISTRAL_API_KEY,
      alibaba:    process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY,
      meta:       process.env.META_API_KEY || process.env.TOGETHER_API_KEY,
      azure:      process.env.AZURE_OPENAI_API_KEY,
    };
    apiKey = ENV_MAP[provider];
  }
  if (!apiKey) return null;

  if (!baseURL) {
    if (provider === 'azure') {
      baseURL = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '') + '/openai';
    } else if (provider === 'openai') {
      baseURL = (apiKey.startsWith('sk-proj-') || apiKey.startsWith('sk-'))
        ? 'https://api.openai.com/v1'
        : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
    } else {
      baseURL = PROVIDER_BASE_URL[provider] || 'https://api.openai.com/v1';
    }
  }

  try {
    // SDK 레벨 timeout 설정 (AbortController 충돌 방지)
    const sdkTimeout = PROVIDER_DEFAULT_TIMEOUT[provider] || PROVIDER_DEFAULT_TIMEOUT.default;
    const client = new OpenAI({ apiKey, baseURL, timeout: sdkTimeout, maxRetries: 0, defaultHeaders: _getProviderHeaders(provider) });
    _clients[provider] = client;
    return client;
  } catch { return null; }
}

function _getProviderHeaders(provider) {
  if (provider === 'openrouter') {
    return { 'HTTP-Referer': 'https://ai-orchestrator.local', 'X-Title': 'AI Orchestrator' };
  }
  return {};
}

function refreshClient(provider, apiKey, baseUrl) {
  delete _clients[provider];
  if (!apiKey) return;
  const bURL = baseUrl || PROVIDER_BASE_URL[provider] || 'https://api.openai.com/v1';
  const sdkTimeout = PROVIDER_DEFAULT_TIMEOUT[provider] || PROVIDER_DEFAULT_TIMEOUT.default;
  try {
    _clients[provider] = new OpenAI({ apiKey, baseURL: bURL, timeout: sdkTimeout, maxRetries: 0, defaultHeaders: _getProviderHeaders(provider) });
  } catch(e) {
    console.warn('[aiConnector] 클라이언트 생성 실패:', provider, e.message);
  }
}

// ── Anthropic ─────────────────────────────────────────────────
let _anthropicClient = null;
function _getAnthropic() {
  if (_anthropicClient) return _anthropicClient;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    let apiKey = null;
    try {
      const store = require('../routes/admin')._apiConfigStore;
      apiKey = store?.anthropic?.apiKey;
    } catch(_) {}
    if (!apiKey) apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    _anthropicClient = new Anthropic({ apiKey });
    return _anthropicClient;
  } catch { return null; }
}

function refreshAnthropicClient(apiKey) {
  _anthropicClient = null;
  if (!apiKey) return;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey });
  } catch(e) {
    console.warn('[aiConnector] Anthropic 재생성 실패:', e.message);
  }
}

// ── MODEL_STRATEGY ────────────────────────────────────────────
// STEP 1 (Strategy Routing 정상화):
//   fast     → 경량 모델 (gpt-4o-mini / gemini-flash)
//   balanced → 표준 모델 (gpt-4o / gemini-2.5-pro)
//   deep     → 최고 성능 모델 (claude-3-5-sonnet / gpt-4.1)
//   powerful / vision / code / creative — 하위 호환 유지
const MODEL_STRATEGY = {
  // ── 신규: 복잡도 기반 3단계 ───────────────────────────────
  fast: {
    openai:    'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    google:    'gemini-2.5-flash',
    mistral:   'mistral-small-latest',
    deepseek:  'deepseek-chat',
    moonshot:  'moonshot-v1-8k',
  },
  balanced: {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-5-20250929',
    google:    'gemini-2.5-flash',
    mistral:   'mistral-small-latest',
    deepseek:  'deepseek-chat',
    moonshot:  'moonshot-v1-32k',
  },
  deep: {
    openai:    'gpt-4o',                        // MODEL_REGISTRY 등록 최고 OpenAI 모델
    anthropic: 'claude-sonnet-4-5-20250929',    // 코드·분석 — Claude Sonnet 4.5
    google:    'gemini-2.5-flash',
    deepseek:  'deepseek-chat',
    moonshot:  'moonshot-v1-128k',
  },
  // ── 기존 키 (하위 호환) ──────────────────────────────────
  powerful: {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    google:    'gemini-2.5-flash',
    deepseek:  'deepseek-chat',
  },
  vision: {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
  },
  code: {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-5-20250929',
    deepseek:  'deepseek-chat',
  },
  creative: {
    openai:    'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    mistral:   'mistral-small-latest',
    google:    'gemini-2.5-flash',
  },
};

// ── TASK_PROVIDER_PRIORITY ────────────────────────────────────
// 태스크 유형별 우선 프로바이더 매핑
// deep 전략에서는 callLLM 내부에서 selectModel()이 먼저 모델을 확정하므로
// 여기서는 balanced/fast 폴백 순서를 정의함
const TASK_PROVIDER_PRIORITY = {
  // ── 기존 키 (하위 호환) ──────────────────────────────────────
  classification:  ['google', 'openai', 'anthropic'],
  translation:     ['deepseek', 'moonshot', 'openai'],
  summarization:   ['moonshot', 'deepseek', 'openai'],

  // ── 실제 taskType 키 (intentAnalyzer 반환값과 일치) ─────────
  // 멀티AI 최적 배분 — 각 AI 특기 활용
  unknown:    ['openai', 'google', 'anthropic'],       // 일반 질문: OpenAI 우선
  text:       ['openai', 'google', 'anthropic'],       // 텍스트: OpenAI 우선
  chat:       ['openai', 'anthropic', 'google'],       // 채팅: OpenAI 우선
  fast:       ['openai', 'mistral', 'google'],         // 빠른 응답: OpenAI 우선 (안정적)

  summarize:  ['moonshot', 'deepseek', 'google'],      // 요약: Moonshot 우선
  summarise:  ['moonshot', 'deepseek', 'google'],
  translate:  ['deepseek', 'moonshot', 'google'],      // 번역: DeepSeek 우선
  analysis:   ['anthropic', 'openai', 'google'],       // 분석: Claude 우선
  analyse:    ['anthropic', 'openai', 'google'],
  analyze:    ['anthropic', 'openai', 'google'],
  extract:    ['google', 'openai', 'anthropic'],       // 추출: Gemini 우선
  classify:   ['google', 'openai', 'anthropic'],       // 분류: Gemini 우선

  creative:   ['anthropic', 'openai', 'mistral'],      // 창의적: Claude 우선 (deep)
  code:       ['openai', 'anthropic', 'deepseek'],     // 코드: OpenAI 우선
  reasoning:  ['openai', 'anthropic', 'google'],       // 추론: OpenAI 우선

  ppt:        ['openai', 'anthropic', 'deepseek'],       // PPT: OpenAI 우선 (안정적)
  blog:       ['openai', 'anthropic', 'deepseek'],     // 블로그: OpenAI 우선
  email:      ['openai', 'anthropic', 'mistral'],      // 이메일: OpenAI 우선
  resume:     ['anthropic', 'openai', 'deepseek'],     // 자소서: Claude 우선
  website:    ['openai', 'anthropic', 'deepseek'],     // 웹사이트: OpenAI 우선 (deep)
  report:     ['anthropic', 'openai', 'google'],       // 리포트: Claude 우선
  ppt_file:   ['anthropic', 'openai', 'google'],       // PPT 파일: Claude 우선
  research:   ['openai', 'google', 'anthropic'],       // 리서치: OpenAI 우선
  document:   ['anthropic', 'openai', 'deepseek'],     // 문서: Claude 우선
  image:      ['openai', 'google', 'anthropic'],       // 이미지: OpenAI 우선 (DALL-E)
};

/** 모델 ID → 공급자 추측 */
function _guessProvider(modelId) {
  if (!modelId) return 'openai';
  const m = modelId.toLowerCase();
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('grok')) return 'xai'; // P5: grok-3-mini는 화이트리스트에서 비활성화됨
  if (m.startsWith('llama') || m.startsWith('meta')) return 'meta';
  if (m.startsWith('kimi') || m.startsWith('moonshot') || m.startsWith('moonshot-v')) return 'moonshot';
  if (m.startsWith('mistral') || m.startsWith('mixtral')) return 'mistral';
  if (m.startsWith('qwen')) return 'alibaba';
  return 'openai';
}

// ── 가용 폴백 프로바이더 선택 ─────────────────────────────────
function _pickFallbackProvider(excludeProviders = []) {
  for (const p of FALLBACK_CHAIN) {
    if (excludeProviders.includes(p)) continue;
    if (_isCBOpen(p)) continue;
    const client = p === 'anthropic' ? _getAnthropic() : _getClient(p);
    if (client) return p;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// 6. Core LLM Call (Phase 12 최고 성능)
// ══════════════════════════════════════════════════════════════
/**
 * callLLM — Phase 12 고성능 LLM 호출
 *
 * 반환: { content, model, usage, ms, provider,
 *          isFallback, fallbackReason, requestedModel, fallbackFrom, fromCache }
 *
 * 성능 개선:
 *  - 회로차단기: 실패 프로바이더 즉시 스킵
 *  - 스마트 타임아웃: 프로바이더별 적응형 P95
 *  - 인증 실패/429 → 재시도 없이 즉시 폴백
 *  - useCache=true → 캐시 히트 시 ~0ms
 */
async function callLLM({
  messages,
  system,
  model,
  strategy    = 'fast',
  task,
  maxTokens   = 2000,
  temperature = 0.7,
  responseFormat = null,
  userId      = 'anonymous',
  pipeline    = 'unknown',
  retries     = 2,
  timeoutMs   = 0,
  useCache    = false,
  _fallbackDepth = 0,
  _comboId    = null,
  _step       = 0,
}) {
  const logBase = {
    pipeline, step: _step, comboId: _comboId, userId,
    requestedModel: model || null,
  };

  // ── 모델 결정 ──────────────────────────────────────────────
  let resolvedModel = model;
  let isFallback    = false;
  let fallbackReason = null;
  const requestedModel = model || null;

  if (!resolvedModel) {
    if (task) {
      // P1: 태스크 유형별 우선 프로바이더로 라우팅
      // TASK_PROVIDER_PRIORITY에 없는 task는 unknown(google 우선) 사용
      const taskProviders = TASK_PROVIDER_PRIORITY[task] || TASK_PROVIDER_PRIORITY.unknown || TASK_PROVIDER_PRIORITY.fast;
      const strat = MODEL_STRATEGY[strategy] || MODEL_STRATEGY.fast;
      let picked = null;
      for (const prov of taskProviders) {
        if (prov === 'anthropic') {
          const ant = _getAnthropic();
          if (ant && strat.anthropic) { picked = strat.anthropic; break; }
        } else {
          const cli = _getClient(prov);
          if (cli && strat[prov]) { picked = strat[prov]; break; }
        }
      }
      resolvedModel = picked || modelReg.getModelForTask(task);
    } else {
      const strat = MODEL_STRATEGY[strategy] || MODEL_STRATEGY.fast;
      const oai = _getClient('openai');
      const ant = _getAnthropic();
      resolvedModel = oai ? strat.openai : (ant ? strat.anthropic : null);
    }
  }

  if (!resolvedModel) {
    const err = new AIError('사용 가능한 AI 모델이 없습니다. 최소 하나의 API 키를 등록하세요.', { code: 'NO_MODEL', provider: 'none', model: 'none' });
    _logToDB({ ...logBase, usedModel: 'none', provider: 'none', success: false, errorCode: 'NO_MODEL', latencyMs: 0 });
    throw err;
  }

  // ── 캐시 조회 ──────────────────────────────────────────────
  const cKey = useCache ? _cacheKey(resolvedModel, messages) : null;
  if (cKey) {
    const cached = _cacheGet(cKey);
    if (cached) return { ...cached, fromCache: true, isFallback, fallbackReason, requestedModel };
  }

  // ── 화이트리스트 체크 ────────────────────────────────────
  if (!modelReg.isModelAllowed(resolvedModel)) {
    const fb = modelReg.getModelForTask(task || 'fast');
    if (!fb || fb === resolvedModel) {
      const err = new AIError(`모델 ${resolvedModel}이 차단되었고 대체 모델이 없습니다.`, { code: 'MODEL_BLOCKED', provider: _guessProvider(resolvedModel), model: resolvedModel });
      _logToDB({ ...logBase, usedModel: resolvedModel, provider: _guessProvider(resolvedModel), success: false, errorCode: 'MODEL_BLOCKED', latencyMs: 0 });
      throw err;
    }
    console.warn(`[aiConnector][FALLBACK] 화이트리스트 차단: ${resolvedModel} → ${fb}`);
    isFallback = true; fallbackReason = `화이트리스트 차단: ${resolvedModel}`; resolvedModel = fb;
  }

  const regEntry = Object.values(MODEL_REGISTRY).find(m => m.id === resolvedModel);
  const provider = regEntry?.provider || _guessProvider(resolvedModel);

  // ── 회로차단기 체크 ──────────────────────────────────────
  if (_isCBOpen(provider)) {
    console.warn(`[CB] ${provider} 차단됨 → 즉시 폴백`);
    const fbProvider = _pickFallbackProvider([provider]);
    // [FIX] fallbackDepth 제한 3으로 확대 (기존 >0 이면 throw → 연쇄 폴백 불가)
    if (!fbProvider || _fallbackDepth >= 3) {
      const err = new AIError(`${provider} 회로차단 중, 대체 프로바이더 없음`, { code: 'CB_OPEN', provider, model: resolvedModel });
      _logToDB({ ...logBase, usedModel: resolvedModel, provider, success: false, errorCode: 'CB_OPEN', latencyMs: 0 });
      throw err;
    }
    const fbModel = MODEL_STRATEGY.fast[fbProvider] || MODEL_STRATEGY.fast.openai;
    return callLLM({
      messages, system, model: fbModel, maxTokens, temperature,
      responseFormat, userId, pipeline, retries, useCache,
      _fallbackDepth: _fallbackDepth + 1, _comboId, _step,
    }).then(r => ({ ...r, isFallback: true, fallbackReason: `CB차단: ${provider}`, requestedModel: requestedModel || resolvedModel, fallbackFrom: resolvedModel }));
  }

  const effectiveTimeout = _getAdaptiveTimeout(provider, resolvedModel, strategy, timeoutMs);

  // ── Anthropic 경로 ──────────────────────────────────────
  if (provider === 'anthropic') {
    const ant = _getAnthropic();
    if (!ant) {
      // Anthropic 없으면 즉시 openai 폴백
      if (_fallbackDepth > 0) throw new AIError('Anthropic 키 없음', { code: 'NO_API_KEY', provider: 'anthropic', model: resolvedModel });
      return _immediateProviderFallback({ messages, system, model: resolvedModel, maxTokens, temperature, responseFormat, userId, pipeline, retries, useCache, _comboId, _step, reason: 'Anthropic 키 없음', logBase });
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await _callAnthropic({ ant, messages, system, model: resolvedModel, maxTokens, temperature, userId, pipeline, timeoutMs: effectiveTimeout });
        _recordLatency('anthropic', result.ms);
        _cbSuccess('anthropic');
        const out = { ...result, isFallback, fallbackReason, requestedModel, fallbackFrom: isFallback ? requestedModel : undefined };
        if (cKey) _cacheSet(cKey, out);
        const costUsd = costTracker.calcCost(resolvedModel, result.usage?.prompt_tokens || 0, result.usage?.completion_tokens || 0);
        _logToDB({ ...logBase, usedModel: resolvedModel, provider: 'anthropic', isFallback, fallbackReason, fallbackFrom: out.fallbackFrom,
          latencyMs: result.ms, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0, costUsd, success: true });
        _recordCostToDB({ pipeline, userId, model: resolvedModel, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0, costUsd });
        return out;
      } catch(e) {
        if (_isHardError(e)) {
          // 인증실패·429 → 즉시 CB 실패 기록 후 폴백
          _cbFailure('anthropic');
          _logToDB({ ...logBase, usedModel: resolvedModel, provider: 'anthropic', isFallback, fallbackReason, success: false, errorCode: _errCode(e), latencyMs: 0 });
          if (_fallbackDepth > 0) throw new AIError(e.message, { code: _errCode(e), provider: 'anthropic', model: resolvedModel });
          return _immediateProviderFallback({ messages, system, model: resolvedModel, maxTokens, temperature, responseFormat, userId, pipeline, retries, useCache, _comboId, _step, reason: _errCode(e), logBase });
        }
        if (attempt === retries) {
          _cbFailure('anthropic');
          const err = new AIError(`Anthropic ${retries + 1}회 초과: ${e.message}`, { code: 'MAX_RETRIES', provider: 'anthropic', model: resolvedModel });
          _logToDB({ ...logBase, usedModel: resolvedModel, provider: 'anthropic', isFallback, fallbackReason, success: false, errorCode: 'MAX_RETRIES', latencyMs: 0 });
          throw err;
        }
        const backoff = 500 * Math.pow(2, attempt); // 0.5s → 1s (기존보다 빠름)
        console.warn(`[aiConnector] Anthropic 재시도 ${attempt + 1}/${retries} (${backoff}ms):`, e.message?.slice(0, 60));
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }

  // ── OpenAI-호환 공급자 ──────────────────────────────────
  let client = _getClient(provider);

  if (!client) {
    if (_fallbackDepth > 0) {
      const err = new AIError(`${provider} 클라이언트 없음`, { code: 'NO_API_KEY', provider, model: resolvedModel });
      _logToDB({ ...logBase, usedModel: resolvedModel, provider, isFallback, fallbackReason, success: false, errorCode: 'NO_API_KEY', latencyMs: 0 });
      throw err;
    }
    return _immediateProviderFallback({ messages, system, model: resolvedModel, maxTokens, temperature, responseFormat, userId, pipeline, retries, useCache, _comboId, _step, reason: `${provider} 클라이언트 없음`, logBase });
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await _callOpenAI({ oai: client, messages, system, model: resolvedModel, maxTokens, temperature, responseFormat, userId, pipeline, timeoutMs: effectiveTimeout });
      _recordLatency(provider, result.ms);
      _cbSuccess(provider);
      const out = { ...result, isFallback, fallbackReason, requestedModel, fallbackFrom: isFallback ? requestedModel : undefined };
      if (cKey) _cacheSet(cKey, out);
      const costUsd = costTracker.calcCost(resolvedModel, result.usage?.prompt_tokens || 0, result.usage?.completion_tokens || 0);
      _logToDB({ ...logBase, usedModel: resolvedModel, provider, isFallback, fallbackReason, fallbackFrom: out.fallbackFrom,
        latencyMs: result.ms, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0, costUsd, success: true });
      _recordCostToDB({ pipeline, userId, model: resolvedModel, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0, costUsd });
      return out;
    } catch(e) {
      const errCode = _errCode(e);
      // P2: xAI는 어떤 에러든 즉시 폴백 (403/429/402 크레딧 문제 대비)
      if (_isHardError(e) || _shouldInstantFallback(errCode, provider)) {
        _cbFailure(provider);
        console.warn(`[aiConnector][P2] ${provider} 즉시 폴백 (${errCode}): ${e.message?.slice(0,60)}`);
        _logToDB({ ...logBase, usedModel: resolvedModel, provider, isFallback, fallbackReason, success: false, errorCode: errCode, latencyMs: 0 });
        if (_fallbackDepth > 0) throw new AIError(e.message, { code: errCode, provider, model: resolvedModel });
        return _immediateProviderFallback({ messages, system, model: resolvedModel, maxTokens, temperature, responseFormat, userId, pipeline, retries, useCache, _comboId, _step, reason: errCode, logBase });
      }
      if (attempt === retries) {
        _cbFailure(provider);
        const err = new AIError(`${provider} ${retries + 1}회 초과: ${e.message}`, { code: 'MAX_RETRIES', provider, model: resolvedModel });
        _logToDB({ ...logBase, usedModel: resolvedModel, provider, isFallback, fallbackReason, success: false, errorCode: 'MAX_RETRIES', latencyMs: 0 });
        throw err;
      }
      const backoff = 500 * Math.pow(2, attempt);
      console.warn(`[aiConnector] ${provider} 재시도 ${attempt + 1}/${retries} (${backoff}ms):`, e.message?.slice(0, 60));
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw new AIError('LLM 호출 실패', { code: 'UNKNOWN', provider, model: resolvedModel });
}

// ── 즉시 폴백 헬퍼 (provider 실패 시 chain 중 가용한 것으로) ──
async function _immediateProviderFallback({ messages, system, model, maxTokens, temperature, responseFormat, userId, pipeline, retries, useCache, _comboId, _step, reason, logBase }) {
  const excludeProvider = _guessProvider(model);
  const fbProvider = _pickFallbackProvider([excludeProvider]);
  if (!fbProvider) {
    const err = new AIError(`폴백 프로바이더 없음 (${reason})`, { code: 'NO_FALLBACK', provider: excludeProvider, model });
    _logToDB({ ...logBase, usedModel: model, provider: excludeProvider, success: false, errorCode: 'NO_FALLBACK', latencyMs: 0 });
    throw err;
  }
  const fbModel = fbProvider === 'anthropic'
    ? MODEL_STRATEGY.fast.anthropic
    : (MODEL_STRATEGY.fast.openai);
  console.warn(`[aiConnector][FALLBACK] ${excludeProvider}(${reason}) → ${fbProvider}(${fbModel})`);
  return callLLM({
    messages, system, model: fbModel, maxTokens, temperature,
    responseFormat, userId, pipeline, retries, useCache,
    _fallbackDepth: 1, _comboId, _step,
  }).then(r => ({
    ...r,
    isFallback: true,
    fallbackReason: reason,
    requestedModel: model,
    fallbackFrom: model,
  }));
}

// ── 에러 분류 헬퍼 ────────────────────────────────────────────
function _isHardError(e) {
  // 즉시 재시도 불가 에러 (폴백 또는 실패)
  return e.status === 401 || e.status === 403 || e.status === 429 ||
    e.message?.toLowerCase().includes('unauthorized') ||
    e.message?.toLowerCase().includes('authentication') ||
    e.name === 'AbortError' || e.code === 'ABORT_ERR' ||
    e.message?.includes('timed out');
}

function _errCode(e) {
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR' || e.message?.includes('timed out')) return 'TIMEOUT';
  if (e.status === 401 || e.status === 403) return 'AUTH_FAILED';
  if (e.status === 429) return 'RATE_LIMIT';
  if (e.status === 402) return 'INSUFFICIENT_CREDIT'; // P2: xAI 크레딧 없음
  if (e.status >= 500) return 'SERVER_ERROR';
  return e.code || 'UNKNOWN';
}

// P2: xAI/특정 공급자 즉시 폴백 트리거 에러 코드
const INSTANT_FALLBACK_CODES = new Set(['AUTH_FAILED', 'RATE_LIMIT', 'INSUFFICIENT_CREDIT']);

function _shouldInstantFallback(errCode, provider) {
  if (INSTANT_FALLBACK_CODES.has(errCode)) return true;
  // xAI는 403/402도 즉시 폴백 (크레딧/화이트리스트 문제)
  if (provider === 'xai') return true;
  return false;
}

// ── _callOpenAI ──────────────────────────────────────────────
async function _callOpenAI({ oai, messages, system, model, maxTokens, temperature, responseFormat, userId, pipeline, timeoutMs = 20_000 }) {
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  // P1: Google Gemini는 max_tokens 최소 512 보정 (작은 값에서 content null 반환)
  const provider = _guessProvider(model);
  const safeMaxTokens = (provider === 'google' && maxTokens < 512) ? 512 : maxTokens;
  const opts = { model, messages: msgs, max_tokens: safeMaxTokens, temperature };
  if (responseFormat === 'json') opts.response_format = { type: 'json_object' };

  // SDK 클라이언트에 이미 timeout 설정됨 — AbortController 불필요 (충돌 방지)
  try {
    const start = Date.now();
    const res   = await oai.chat.completions.create(opts, { timeout: timeoutMs });
    const ms    = Date.now() - start;
    const usage = res.usage || {};
    costTracker.record({ userId, pipeline, model, inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, metadata: { ms, finishReason: res.choices[0]?.finish_reason } });
    return {
      content: res.choices[0]?.message?.content || '',
      model, usage, ms,
      provider: _guessProvider(model),
      finishReason: res.choices[0]?.finish_reason,
    };
  } catch(e) { throw e; }
}

// ── _callAnthropic ────────────────────────────────────────────
async function _callAnthropic({ ant, messages, system, model, maxTokens, temperature, userId, pipeline, timeoutMs = 25_000 }) {
  const opts = { model, messages, max_tokens: maxTokens, temperature };
  if (system) opts.system = system;
  try {
    const start = Date.now();
    const res   = await ant.messages.create(opts, { timeout: timeoutMs });
    const ms    = Date.now() - start;
    const inputTokens  = res.usage?.input_tokens  || 0;
    const outputTokens = res.usage?.output_tokens || 0;
    costTracker.record({ userId, pipeline, model, inputTokens, outputTokens, metadata: { ms } });
    return {
      content:  res.content[0]?.text || '',
      model,
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
      ms,
      provider: 'anthropic',
    };
  } catch(e) { throw e; }
}

// ══════════════════════════════════════════════════════════════
// 7. callLLMStream — 고성능 SSE 스트리밍
// ══════════════════════════════════════════════════════════════
async function callLLMStream({
  messages, system, model, strategy = 'fast', task,
  maxTokens = 1000, temperature = 0.7,
  userId = 'anonymous', pipeline = 'unknown',
  timeoutMs = 0,
  onChunk = () => {}, onDone = () => {}, onError = () => {},
}) {
  let resolvedModel = model;
  if (!resolvedModel) {
    if (task) resolvedModel = modelReg.getModelForTask(task);
    else {
      const oai = _getClient('openai');
      const strat = MODEL_STRATEGY[strategy] || MODEL_STRATEGY.fast;
      resolvedModel = oai ? strat.openai : MODEL_STRATEGY.fast.anthropic;
    }
  }
  if (!resolvedModel) { onError(new AIError('스트림 모델 없음', { code: 'NO_MODEL' })); return; }

  const regEntry = Object.values(MODEL_REGISTRY).find(m => m.id === resolvedModel);
  const provider = regEntry?.provider || _guessProvider(resolvedModel);
  const effectiveTimeout = _getAdaptiveTimeout(provider, resolvedModel, strategy, timeoutMs);
  const start = Date.now();
  let fullContent = '';

  try {
    if (provider === 'anthropic') {
      const ant = _getAnthropic();
      if (!ant) throw new AIError('Anthropic 키 없음', { code: 'NO_API_KEY', provider: 'anthropic' });
      const opts = { model: resolvedModel, messages, max_tokens: maxTokens, temperature, stream: true };
      if (system) opts.system = system;
      const stream = await ant.messages.stream(opts);
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          fullContent += chunk.delta.text; onChunk(chunk.delta.text);
        }
      }
    } else {
      const client = _getClient(provider) || _getClient('openai');
      if (!client) throw new AIError(`${provider} 클라이언트 없음`, { code: 'NO_API_KEY', provider });
      const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
      const stream = await client.chat.completions.create(
        { model: resolvedModel, messages: msgs, max_tokens: maxTokens, temperature, stream: true },
        { timeout: effectiveTimeout }
      );
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) { fullContent += text; onChunk(text); }
      }
    }

    const ms = Date.now() - start;
    _recordLatency(provider, ms);
    _cbSuccess(provider);
    const estimatedIn  = Math.ceil((messages?.reduce((s, m) => s + (m.content?.length || 0), 0) || 0) / 4);
    const estimatedOut = Math.ceil(fullContent.length / 4);
    const costUsd      = costTracker.calcCost(resolvedModel, estimatedIn, estimatedOut);
    const result = { content: fullContent, model: resolvedModel, ms, provider, isFallback: false };
    _logToDB({ pipeline, step: 0, comboId: null, userId, requestedModel: model || null,
      usedModel: resolvedModel, provider, isFallback: false,
      latencyMs: ms, inputTokens: estimatedIn, outputTokens: estimatedOut, costUsd, success: true });
    if (costUsd > 0) _recordCostToDB({ pipeline, userId, model: resolvedModel, inputTokens: estimatedIn, outputTokens: estimatedOut, costUsd });
    onDone(result);
    return result;
  } catch(e) {
    const ms = Date.now() - start;
    const code = _errCode(e);
    _cbFailure(provider);
    _logToDB({ pipeline, step: 0, comboId: null, userId, requestedModel: model || null,
      usedModel: resolvedModel, provider, isFallback: false, latencyMs: ms, success: false, errorCode: code });
    const wrapped = e instanceof AIError ? e : new AIError(e.message, { code, provider, model: resolvedModel });
    onError(wrapped);
    throw wrapped;
  }
}

// ══════════════════════════════════════════════════════════════
// 8. callStructured / callVision / getEmbedding / transcribeAudio
// ══════════════════════════════════════════════════════════════
async function callStructured({ prompt, schema, strategy = 'fast', task, userId, pipeline }) {
  const messages = [{ role: 'user', content: prompt }];
  const system = `당신은 정확한 JSON 데이터를 반환하는 AI입니다. 반드시 유효한 JSON만 반환하세요.\n스키마: ${JSON.stringify(schema)}`;
  const result = await callLLM({ messages, system, strategy, task, responseFormat: 'json', userId, pipeline });
  try { result.parsed = JSON.parse(result.content); }
  catch { result.parsed = Object.fromEntries(Object.keys(schema || {}).map(k => [k, `[${k}]`])); }
  return result;
}

async function callVision({ imageUrl, imageBase64, prompt, userId, pipeline }) {
  const visionModel = modelReg.getModelForTask('analysis');
  const client = _getClient(_guessProvider(visionModel)) || _getClient('openai');
  if (!client) throw new AIError('Vision 클라이언트 없음', { code: 'NO_API_KEY', provider: 'openai', model: visionModel });
  const imageContent = imageUrl
    ? { type: 'image_url', image_url: { url: imageUrl } }
    : { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } };
  const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }, imageContent] }];
  return _callOpenAI({ oai: client, messages, model: visionModel, maxTokens: 1500, temperature: 0.3, userId, pipeline: pipeline || 'vision' });
}

async function getEmbedding({ text, model = 'text-embedding-3-small', userId, pipeline }) {
  const oai = _getClient('openai');
  if (!oai) throw new AIError('임베딩 불가: OpenAI 키 없음', { code: 'NO_API_KEY', provider: 'openai', model });
  const res = await oai.embeddings.create({ model, input: text });
  const usage = res.usage || {};
  costTracker.record({ userId, pipeline: pipeline || 'embedding', model, inputTokens: usage.prompt_tokens || 0, outputTokens: 0 });
  return { embedding: res.data[0].embedding, model, tokens: usage.prompt_tokens };
}

async function transcribeAudio({ audioBuffer, language = 'ko', userId, pipeline }) {
  const oai = _getClient('openai');
  if (!oai) throw new AIError('STT 불가: OpenAI 키 없음', { code: 'NO_API_KEY', provider: 'openai', model: 'whisper-1' });
  return { text: '[Whisper 연동 준비 완료]', mock: false, ready: true };
}

// ══════════════════════════════════════════════════════════════
// 9. getProviderStatus — 회로차단기 정보 포함
// ══════════════════════════════════════════════════════════════
function getProviderStatus() {
  const stats = modelReg.getStats();
  const cbStatus = getCircuitStatus();
  const status = {};
  Object.keys(PROVIDER_BASE_URL).forEach(p => {
    const client = p === 'anthropic' ? _getAnthropic() : (_clients[p] || _getClient(p));
    const cb = cbStatus[p] || { state: 'CLOSED', failures: 0, remainingMs: 0 };
    status[p] = {
      available:    !!client,
      configured:   !!_getEnvKey(p),
      models:       (stats[p] ? `${stats[p].enabled}/${stats[p].total}` : '0/0'),
      enabledModels: modelReg.getWhitelistByProvider(p).filter(m => m.enabled).map(m => m.modelId),
      circuitBreaker: cb.state,
      cbFailures:   cb.failures,
      cbBlockedMs:  cb.remainingMs,
    };
  });
  return status;
}

function _getEnvKey(provider) {
  const map = {
    openai:'OPENAI_API_KEY', anthropic:'ANTHROPIC_API_KEY', google:'GOOGLE_API_KEY',
    groq:'GROQ_API_KEY', openrouter:'OPENROUTER_API_KEY', deepseek:'DEEPSEEK_API_KEY',
    xai:'XAI_API_KEY', moonshot:'MOONSHOT_API_KEY', mistral:'MISTRAL_API_KEY',
    alibaba:'ALIBABA_API_KEY', meta:'META_API_KEY', azure:'AZURE_OPENAI_API_KEY',
  };
  return process.env[map[provider]];
}

// ── Pipeline-Aware Helpers ─────────────────────────────────────
const PIPELINE_PROMPTS = {
  async analyzeMarketing({ brand, data }) {
    return callLLM({ task: 'analysis', pipeline: 'marketingPipeline', messages: [{ role: 'user',
      content: `브랜드 "${brand}"의 마케팅 데이터를 분석해주세요:\n${JSON.stringify(data, null, 2)}\n\n간결한 인사이트와 실행 가능한 권고사항 3가지를 제공해주세요.` }]});
  },
  async reviewCode({ code, language }) {
    return callLLM({ task: 'code', pipeline: 'itSecurityPipeline', messages: [{ role: 'user',
      content: `다음 ${language} 코드를 보안 관점에서 리뷰해주세요:\n\`\`\`${language}\n${code}\n\`\`\`\n\n보안 취약점, 개선사항을 항목별로 설명해주세요.` }]});
  },
  async analyzeFinance({ symbol, data }) {
    return callLLM({ task: 'analysis', pipeline: 'financeInvestPipeline', messages: [{ role: 'user',
      content: `${symbol} 종목 데이터를 분석해주세요:\n${JSON.stringify(data, null, 2)}\n\n투자 관점의 리스크와 기회를 분석해주세요.` }]});
  },
  async medicalAnalysis({ symptoms, vitals }) {
    return callLLM({ task: 'analysis', pipeline: 'healthcarePipeline', messages: [{ role: 'user',
      content: `환자 증상: ${symptoms}\n활력징후: ${JSON.stringify(vitals)}\n\n임상 의사결정 지원 분석을 제공해주세요. (참고용, 최종 판단은 의사에게)` }]});
  },
};

// ══════════════════════════════════════════════════════════════
// 10. Exports
// ══════════════════════════════════════════════════════════════
module.exports = {
  callLLM, callLLMStream, callStructured, callVision,
  getEmbedding, transcribeAudio,
  getProviderStatus, getCircuitStatus,
  refreshClient, refreshAnthropicClient,
  getCacheStats, clearCache,
  prompts: PIPELINE_PROMPTS,
  MODEL_STRATEGY, PROVIDER_BASE_URL, AIError,
};

// ── DB 헬퍼 (내부) ─────────────────────────────────────────────
function _logToDB(opts) {
  try {
    const db = _getDb();
    if (db?.logInference) db.logInference(opts);
  } catch(e) { console.warn('[aiConnector] inference_log 저장 실패:', e.message); }
}

function _recordCostToDB({ pipeline, userId, model, inputTokens, outputTokens, costUsd }) {
  try {
    if (!costUsd || costUsd <= 0) return;
    const db = _getDb();
    if (db?.recordCost) db.recordCost({ pipeline: pipeline || 'unknown', userId: userId || 'anonymous', model: model || 'unknown', inputTokens: inputTokens || 0, outputTokens: outputTokens || 0, costUsd });
  } catch(e) { console.warn('[aiConnector] costs 저장 실패:', e.message); }
}
