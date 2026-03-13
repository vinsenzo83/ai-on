# AI 오케스트레이터 엔진 명세서 (ENGINE SPEC)
> 버전: v4.1 (2026-03-11) | 담당: 엔진팀  
> 상태: ✅ Production-ready (VPS: 144.172.93.226)

---

## 📐 엔진 아키텍처 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Orchestrator Engine                     │
│                       (v4 – 2026-03)                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────┐    ┌────────────────┐    ┌────────────┐  │
│  │  Layer 1      │    │  Layer 2       │    │  Layer 3   │  │
│  │  aiConnector  │◄───│ DynamicOrch    │◄───│ ComboOpti  │  │
│  │  (LLM Core)   │    │ (Pipeline Exec)│    │ mizer      │  │
│  └──────┬────────┘    └───────┬────────┘    └─────┬──────┘  │
│         │                    │                    │          │
│  ┌──────▼────────┐    ┌──────▼────────┐    ┌────▼───────┐  │
│  │  modelRegistry│    │ SharedContext  │    │ ModelBench │  │
│  │  costTracker  │    │ Buffer         │    │ mark       │  │
│  └───────────────┘    └───────────────┘    └────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │            39 Task Pipelines × 70 Known Combos           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────┐    ┌───────────────┐    ┌─────────────┐ │
│  │  authManager   │    │  database      │    │ cronScheduler│ │
│  │  (JWT/RBAC)    │    │  (SQLite)      │    │ (5min probe) │ │
│  └────────────────┘    └───────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 엔진 핵심 모듈 명세

### 1. `src/services/aiConnector.js` (753줄) — **LLM 코어**

#### 주요 함수

| 함수 | 역할 | 입력 | 출력 |
|------|------|------|------|
| `callLLM(opts)` | 단일 LLM 호출 | `{prompt, model, systemPrompt, maxTokens, temperature, responseFormat, userId, pipeline, comboId, step}` | `{content, usage, latency, provider, model, isFallback}` |
| `callLLMStream(opts)` | SSE 스트리밍 호출 | `{prompt, model, ...opts, onChunk, onDone, onError}` | Promise (void) |
| `callStructured(opts)` | JSON 강제 응답 | `{prompt, model, schema?, ...}` | Parsed JSON |
| `callVision(opts)` | 이미지 분석 | `{imageUrl, prompt, model}` | `{content, ...}` |
| `getEmbedding(text, model?)` | 임베딩 생성 | `text: string` | `{embedding: number[], ...}` |
| `getProviderStatus()` | 프로바이더 상태 | 없음 | provider status map |
| `getCacheStats()` | 캐시 통계 | 없음 | `{size, hits, misses, hitRate}` |
| `clearCache()` | 캐시 초기화 | 없음 | void |

#### 내부 플로우 (`callLLM`)
```
callLLM(opts)
  ├─ 1. 모델 선택: explicit → task-based → strategy-based
  ├─ 2. whitelist 확인 (modelRegistry.isModelAllowed)
  │     └─ 차단 시: fallback 모델로 전환, isFallback=true
  ├─ 3. 캐시 조회 (TTL 60s, max 200 items, LRU)
  │     └─ 히트 시: 즉시 반환
  ├─ 4. AbortController 타임아웃 설정 (기본 25s, fast모드 15s)
  ├─ 5. Exponential backoff 재시도 (1s → 2s, max 2회)
  ├─ 6. LLM API 호출 (OpenAI / Anthropic / Groq / Moonshot / 등)
  ├─ 7. 응답 파싱 및 캐시 저장
  ├─ 8. _logToDB(): inference_log 기록
  └─ 9. _recordCostToDB(): costs 테이블 기록
```

#### 지원 프로바이더

| Provider | 환경변수 | Base URL | 상태 |
|----------|----------|----------|------|
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL` or default | ✅ Ready |
| anthropic | `ANTHROPIC_API_KEY` | 내장 | ✅ Ready |
| groq | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | - |
| deepseek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | ✅ Ready |
| xai | `XAI_API_KEY` | `https://api.x.ai/v1` | ⚠️ Not Ready |
| moonshot | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` | ✅ Ready |
| mistral | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` | ✅ Ready |
| alibaba | `ALIBABA_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | - |
| google | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai` | ⚠️ clientReady=false |

#### MODEL_ALIAS 매핑 (현재 15개)
```javascript
const MODEL_ALIAS = {
  'gpt-5':           'gpt-4o',
  'gpt-5.1':         'gpt-4o',
  'gpt-5.2':         'gpt-4o',
  'gpt-5.4':         'gpt-4o',
  'gpt-5.4-pro':     'gpt-4o',
  'gpt-4.5':         'gpt-4o',
  'gpt-5-mini':      'gpt-4o-mini',
  'gpt-5-nano':      'gpt-4o-mini',
  'gpt-5-codex':     'gpt-4o',
  'gpt-5.2-codex':   'gpt-4o',
  'gpt-5.3-codex':   'gpt-4o',
  'gpt-5.1-codex':   'gpt-4o',
  'o3':              'o3-mini',
  'o4-mini':         'gpt-4o-mini',
  // ... (dynamicOrchestrator._callAI에도 별도 alias 존재)
};
```

---

### 2. `src/orchestrator/dynamicOrchestrator.js` (817줄) — **파이프라인 실행 엔진**

#### 클래스 구조
```javascript
class DynamicOrchestrator {
  constructor(openaiClient, anthropicClient)
  
  // Public API
  async execute(task, options)  // ← 유일한 공개 진입점
  
  // Internal
  _groupSteps(pipeline)
  _execParallel(group, context, ...)
  _execSequential(group, context, ...)
  _callAI(model, prompt, systemPrompt, ...)  // MODEL_ALIAS 적용
  _criticCheck(result, taskType)
  _rework(stepIds, ...)
  _validate(result)
  _finalRework(pipeline, context, ...)
  _inferStrategy(userPreferences, taskDesc)
  _inferComplexity(taskDesc)
  _buildComboPipeline(combo)
  _fallbackPipeline(taskType)
  _buildResult(context, pipeline, combo)
}
```

#### `execute()` 입력/출력

**입력 (task)**
```javascript
{
  taskType: string,         // TASK_TYPES 중 하나 (예: 'blog', 'code', 'analysis')
  prompt: string,           // 사용자 요청 텍스트
  userId: string,           // 사용자 ID (비용 추적)
  sessionId?: string,       // 세션 ID
  userPreferences?: {       // 실행 전략 힌트
    strategy?: 'quality'|'speed'|'economy',
    complexity?: 'low'|'medium'|'high'|'enterprise'
  },
  onProgress?: Function     // (phase, detail) => void  ← 실시간 진행 콜백
}
```

**출력**
```javascript
{
  content: string,          // 최종 생성 결과
  contentType: 'html'|'code'|'markdown'|'text',
  quality: number,          // 0-100 점수
  combo: {
    id: string,             // 'blog_seo', 'code_architect' 등
    name: string,
    score: number
  },
  pipeline: Step[],         // 실행된 파이프라인 단계들
  latency: number,          // 총 실행 시간 (ms)
  cost: number,             // 총 비용 (USD)
  feedbackRounds: number,   // CriticAI 피드백 횟수
  comboId: string           // 고유 실행 ID (DB 추적용)
}
```

#### 실행 흐름
```
execute(task)
  ├─ 1. ComboOptimizer.selectCombo()  → 최적 AI 조합 선택
  ├─ 2. _buildComboPipeline()         → 실행 가능 파이프라인 생성
  ├─ 3. _groupSteps()                 → 병렬/순차 그룹 분류
  ├─ 4. 그룹별 실행:
  │     ├─ 병렬: Promise.allSettled()
  │     └─ 순차: await each step
  │         └─ SharedContextBuffer에 결과 저장
  ├─ 5. CriticAI 피드백 (각 그룹 후)
  │     └─ 점수 < 72 시: rework (최대 2라운드)
  ├─ 6. _validate() 최종 품질 검증
  ├─ 7. ModelBenchmark.record() DB 기록
  └─ 8. _buildResult() 최종 결과 조립
```

#### 상수
```javascript
FEEDBACK_THRESHOLD = 72    // CriticAI 재작업 기준 점수
MAX_FEEDBACK_ROUNDS = 2    // 최대 피드백 라운드
MAX_STEP_RETRIES = 2       // 단계별 최대 재시도
TOKEN_BUDGET = 3500        // 기본 토큰 예산
```

---

### 3. `src/orchestrator/comboOptimizer.js` (395줄) — **조합 자동 선택**

#### 주요 메서드

| 메서드 | 역할 |
|--------|------|
| `selectCombo(taskType, strategy, complexity, prompt)` | 최적 조합 자동 선택 |
| `scoreCombo(combo, strategy, complexity)` | 단일 조합 점수 계산 |
| `rankCombos(taskType)` | 전체 조합 순위 반환 |
| `buildDynamicCombo(taskType, prompt)` | 동적 조합 생성 (GPT) |

#### 점수 가중치 (전략별)
```
quality:  abilityScore 45% + winRate 35% + avgScore 20%
speed:    speedBonus 20% + abilityScore 25% + winRate 25% + avgScore 20% - costPenalty 10%
economy:  abilityScore 30% + winRate 25% + avgScore 15% - costPenalty 30%
```

---

### 4. `src/types/index.js` (2829줄) — **모델 레지스트리 & 파이프라인 정의**

#### TASK_TYPES (39개)
```
PPT, WEBSITE, CODE, ILLUSTRATION, MUSIC, GAME, LEGAL, MARKETING,
DATA_ANALYSIS, NOVEL, OCR, TRANSLATION, EMAIL, SUMMARY, RESEARCH,
FINANCE, HEALTHCARE, REALESTATE, GOVERNMENT, B2B, ECOMMERCE,
CREATIVE, BLOG, ANALYSIS, CHAT, CUSTOM, ...
```

#### KNOWN_COMBOS (70개) — 예시
```javascript
// blog 파이프라인의 3가지 조합
blog_seo:     { researcher: GPT5, planner: GPT5_MINI, writer: GPT5_1, validator: GPT5_MINI }
blog_creative:{ researcher: GPT5, planner: GPT5,      writer: GPT5_1, validator: GPT5_MINI }
blog_fast:    { researcher: GPT5_MINI, writer: GPT5, validator: GPT5_NANO }
```

#### MODEL_REGISTRY (주요 모델)
```
gpt-5.2 (flagship)    → 실제: gpt-4o  | $0.030/1k | 점수: 90.3
gpt-5.1 (creative)    → 실제: gpt-4o  | $0.025/1k | 점수: 87.4
gpt-5   (orchestrator)→ 실제: gpt-4o  | $0.015/1k | 점수: 85.7
gpt-5-mini            → 실제: gpt-4o-mini | $0.0006/1k | 점수: 78.5
gpt-5-nano            → 실제: gpt-4o-mini | $0.0002/1k | 점수: 68.0
gpt-5-codex           → 실제: gpt-4o  | $0.020/1k | 점수: 86.5
```

---

## 🗄️ 데이터베이스 스키마

### inference_log 테이블
```sql
id            TEXT PRIMARY KEY
pipeline      TEXT     -- 파이프라인명 (예: 'blog', 'code')
step          INTEGER  -- 단계 번호
combo_id      TEXT     -- 조합 ID (예: 'blog_seo-1773225911')
requested_model TEXT   -- 요청한 모델 ID
used_model    TEXT     -- 실제 사용한 모델
provider      TEXT     -- 프로바이더 (openai, mistral, ...)
is_fallback   INTEGER  -- 0/1
fallback_reason TEXT
latency_ms    INTEGER
input_tokens  INTEGER
output_tokens INTEGER
cost_usd      REAL
success       INTEGER  -- 0/1
error_code    TEXT
error_category TEXT
user_id       TEXT
created_at    DATETIME
```

### costs 테이블
```sql
id        TEXT PRIMARY KEY
pipeline  TEXT
user_id   TEXT
model     TEXT
input_tokens  INTEGER
output_tokens INTEGER
cost_usd  REAL
created_at DATETIME
```

### 현재 DB 통계 (2026-03-11)
- inference_log: 151 행
- costs: 136 행
- combo_id 있는 행: 46 개

---

## 🌐 API 엔드포인트 명세

### 공개 AI API (인증 불필요)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/health` | 서비스 상태 확인 |
| GET | `/api/ai/status` | AI 프로바이더 상태 |
| POST | `/api/ai/chat` | 단일 LLM 호출 |
| GET/POST | `/api/ai/chat/stream` | SSE 스트리밍 호출 |
| POST | `/api/ai/structured` | JSON 구조화 응답 |
| POST | `/api/ai/vision` | 이미지 분석 |
| POST | `/api/ai/embed` | 임베딩 생성 |
| POST | `/api/message` | 세션 기반 대화 |
| GET | `/api/task-types` | 지원 태스크 타입 목록 |
| GET | `/api/models` | 모델 목록 |
| POST | `/api/combo/recommend` | 조합 추천 |
| GET | `/api/combo/report` | 조합 성과 리포트 |
| POST | `/api/pipelines/run` | 파이프라인 실행 |

### 어드민 API (`/api/admin/*` — JWT 필요)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/admin/stats` | 시스템 통계 |
| GET | `/api/admin/users` | 사용자 목록 |
| GET | `/api/admin/inference/stats` | 추론 통계 (7일) |
| GET | `/api/admin/inference/summary` | 파이프라인별 요약 |
| GET | `/api/admin/inference/recent` | 최근 추론 로그 |
| GET | `/api/admin/health/dashboard` | 프로바이더 헬스 |
| POST | `/api/admin/health/check` | 헬스체크 강제 실행 |
| GET | `/api/admin/models/whitelist` | 모델 화이트리스트 |
| PUT | `/api/admin/models/whitelist` | 모델 활성화/비활성화 |
| GET | `/api/admin/apiconfig` | API 키 설정 목록 |
| POST | `/api/admin/apiconfig` | API 키 등록 |
| POST | `/api/admin/apiconfig/:provider/test` | API 키 테스트 |

### 인증 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/register` | 사용자 등록 |
| POST | `/api/auth/login` | 로그인 (JWT 발급) |
| GET | `/api/auth/profile` | 프로필 조회 |
| POST | `/api/beta/register` | 베타 등록 |

---

## 📡 이벤트/콜백 인터페이스

### `onProgress` 콜백 (DynamicOrchestrator.execute)
```javascript
onProgress(phase, detail)
// phase 예시:
//   'analyzing'  → { taskType, strategy, complexity }
//   'combo_selected' → { comboName, expectedScore }
//   'step_start' → { stepIndex, stepName, model }
//   'step_done'  → { stepIndex, latency, tokens }
//   'feedback'   → { round, score, needsRework }
//   'validating' → { score }
//   'complete'   → { totalLatency, totalCost }
```

### `onChunk` 콜백 (callLLMStream)
```javascript
onChunk(text: string)   // 토큰 단위 청크
onDone(fullText: string, usage: object)
onError(error: AIError)
```

---

## ⚠️ 알려진 이슈 및 TODO

| 우선순위 | 이슈 | 상태 |
|----------|------|------|
| 높음 | Google Gemini `clientReady=false` — baseURL 설정 필요 | 🔴 미해결 |
| 높음 | xAI API `clientReady=false` — API 차단 상태 | 🔴 미해결 |
| 중간 | costs vs inference_log 15개 불일치 (기존 데이터) | 🟡 모니터링 |
| 낮음 | GPT-5.3-codex, GPT-5.4, o3 — available=false (프록시 미지원) | ℹ️ 정상 |

---

## 🔌 외부 파트와의 협업 인터페이스

### 어드민 팀이 사용하는 API
```
JWT 인증 → POST /api/auth/login
프로바이더 관리 → GET/POST /api/admin/apiconfig
모델 관리 → GET/PUT /api/admin/models/whitelist
추론 모니터링 → GET /api/admin/inference/stats
헬스 대시보드 → GET /api/admin/health/dashboard
```

### 프론트엔드 팀이 사용하는 API
```
단일 AI 호출 → POST /api/ai/chat
스트리밍 → POST /api/ai/chat/stream  (SSE)
파이프라인 실행 → POST /api/pipelines/run
태스크 타입 → GET /api/task-types
조합 추천 → POST /api/combo/recommend
세션 관리 → POST /api/session
```

### 배포/QA 팀이 사용하는 인터페이스
```
헬스체크 → GET /health  → {"status":"ok","hasOpenAI":true,...}
자동 테스트 → POST /api/autotest/run
스케줄러 → GET /api/scheduler/jobs
메트릭 → GET /api/metrics/dashboard
```

---

## 🚀 엔진 배포 정보

```
VPS: 144.172.93.226 (Ubuntu 24.04)
경로: /opt/ai-orchestrator/app/ai-orchestrator
브랜치: genspark_ai_developer
PM2: ai-orchestrator (cluster mode)
포트: 3000

배포 명령:
  cd /opt/ai-orchestrator/app && git pull origin genspark_ai_developer
  cd ai-orchestrator && npm ci --only=production --quiet
  pm2 reload ai-orchestrator --update-env
  curl -sf http://localhost:3000/health
```

---

## 📋 엔진팀 소유 파일 목록

```
src/services/aiConnector.js          ← LLM 코어 (753줄)
src/orchestrator/dynamicOrchestrator.js  ← 파이프라인 실행 (817줄)
src/orchestrator/comboOptimizer.js   ← 조합 선택 (395줄)
src/orchestrator/modelBenchmark.js   ← 성능 벤치마크
src/orchestrator/sharedContextBuffer.js ← 공유 컨텍스트
src/orchestrator/parallelExecutor.js ← 병렬 실행
src/services/modelRegistry.js        ← 모델 화이트리스트
src/services/costTracker.js          ← 비용 추적
src/types/index.js                   ← 모델/파이프라인 정의
src/db/database.js                   ← DB 레이어
```

---

*이 문서는 엔진팀이 관리합니다. 변경 시 PR에 반영 필수.*
