# AI 오케스트레이터 — 팀 협업 구조 가이드
> 작성일: 2026-03-11 | 버전: v1.0  
> 4파트 병렬 개발 체계

---

## 🏗️ 팀 구조 개요

```
┌─────────────────────────────────────────────────┐
│             AI Orchestrator 개발팀               │
├──────────┬──────────┬──────────┬────────────────┤
│  엔진팀  │  어드민팀 │  프론트팀 │  배포/QA팀     │
│ (Engine) │  (Admin) │  (Front) │  (DevOps/QA)   │
│          │          │          │                │
│ AI 조합  │ 관리자   │ 사용자   │ CI/CD          │
│ 파이프라인│ 대시보드 │ UI/UX    │ 모니터링        │
│ 모델관리 │ 설정관리 │ 채팅 UI  │ 자동테스트      │
└──────────┴──────────┴──────────┴────────────────┘
```

---

## 📦 파트 1: 엔진팀 (Engine Team)

### 담당 범위
- AI LLM 호출 코어 (`aiConnector.js`)
- 파이프라인 실행 엔진 (`dynamicOrchestrator.js`)
- 조합 최적화 (`comboOptimizer.js`)
- 모델 레지스트리 & 비용 추적
- DB 스키마 및 로깅 레이어

### 소유 파일
```
ai-orchestrator/src/services/aiConnector.js
ai-orchestrator/src/orchestrator/dynamicOrchestrator.js
ai-orchestrator/src/orchestrator/comboOptimizer.js
ai-orchestrator/src/orchestrator/modelBenchmark.js
ai-orchestrator/src/orchestrator/sharedContextBuffer.js
ai-orchestrator/src/orchestrator/parallelExecutor.js
ai-orchestrator/src/services/modelRegistry.js
ai-orchestrator/src/services/costTracker.js
ai-orchestrator/src/types/index.js
ai-orchestrator/src/db/database.js
ENGINE_SPEC.md  ← 이 팀이 유지
```

### 타 팀에 제공하는 인터페이스

#### → 어드민팀에 제공
```
GET  /api/admin/inference/stats     추론 통계
GET  /api/admin/inference/summary   파이프라인 요약
GET  /api/admin/inference/recent    최근 로그
GET  /api/admin/health/dashboard    프로바이더 상태
POST /api/admin/health/check        헬스체크 강제
GET  /api/admin/models/whitelist    모델 활성화 상태
PUT  /api/admin/models/whitelist    모델 활성화 토글
```

#### → 프론트팀에 제공
```
POST /api/ai/chat                   단일 AI 호출
POST /api/ai/chat/stream            SSE 스트리밍
POST /api/ai/structured             JSON 응답
POST /api/pipelines/run             파이프라인 실행
GET  /api/task-types                태스크 타입 목록
POST /api/combo/recommend           조합 추천
```

#### → QA팀에 제공
```
GET  /health                        서비스 상태
POST /api/autotest/run              자동 테스트 실행
GET  /api/benchmark/stats           벤치마크 통계
```

### 브랜치 전략
- 메인 브랜치: `genspark_ai_developer`
- 엔진 기능 개발: `engine/feature-name`
- 긴급 버그픽스: `engine/hotfix-name`

### 테스트 기준
- 각 커밋 전: `callLLM` 단일 호출 테스트 통과
- 파이프라인 변경 시: `blog` 4단계 파이프라인 테스트 통과
- DB 로그 기록 여부 반드시 확인

---

## 📊 파트 2: 어드민팀 (Admin Team)

### 담당 범위
- 어드민 대시보드 UI (`public/admin.html`)
- 어드민 API 라우트 (`src/routes/admin.js`)
- 프로바이더 설정 관리
- 사용자 관리 및 RBAC
- 베타 사용자 관리

### 소유 파일
```
ai-orchestrator/src/routes/admin.js
ai-orchestrator/public/admin.html
ai-orchestrator/src/auth/authManager.js
ai-orchestrator/src/middleware/security.js
```

### 엔진팀으로부터 사용하는 API (읽기전용)

```javascript
// 인증 방법
const token = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'admin@ai-orch.local', password: '...' })
}).then(r => r.json()).then(d => d.token);

// 어드민 API 호출
const stats = await fetch('/api/admin/inference/stats?days=7', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// 모델 토글
await fetch('/api/admin/models/whitelist', {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ updates: [{ modelId: 'gpt-4o', enabled: true }] })
});
```

### 어드민 UI 현재 상태
```
public/admin.html        ← 메인 어드민 패널 (132KB)
public/health-dashboard.html ← 헬스 대시보드 (22KB)
public/current-state.html    ← 현재 상태 뷰
public/status-report.html    ← 상태 리포트
```

### 개발 규칙
- 어드민 라우트에 새 엔드포인트 추가 시 → 엔진팀에 알림
- API 키 수정/삭제는 반드시 `/api/admin/apiconfig/:provider/test` 후 진행
- JWT 토큰 만료 기본 `JWT_EXPIRES` (환경변수) 설정 확인

### 브랜치 전략
- 어드민 개발: `admin/feature-name`
- PR 대상: `genspark_ai_developer`

---

## 🖥️ 파트 3: 프론트엔드팀 (Frontend Team)

### 담당 범위
- 사용자 대화 UI (`public/index.html`)
- 사용자 경험 및 인터랙션
- AI 채팅 인터페이스
- 파이프라인 선택 UI

### 소유 파일
```
ai-orchestrator/public/index.html   ← 메인 사용자 UI (93KB)
ai-orchestrator/public/css/
ai-orchestrator/public/js/
```

### 엔진팀 API 사용 가이드

#### 기본 AI 채팅
```javascript
// POST /api/ai/chat
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '사용자 메시지',
    model: 'gpt-5',           // MODEL_ALIAS 사용 가능
    taskType: 'chat',          // 선택적
    userId: 'user-123',
    pipeline: 'chat',
    sessionId: 'session-abc'   // 메모리 컨텍스트
  })
});
const { content, usage, latency, isFallback } = await response.json();
```

#### SSE 스트리밍 채팅
```javascript
// POST /api/ai/chat/stream
const res = await fetch('/api/ai/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '...', model: 'gpt-5', stream: true })
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.chunk) updateUI(data.chunk);
      if (data.done) finalizeUI(data.content);
    }
  }
}
```

#### 파이프라인 실행 (DynamicOrchestrator)
```javascript
// POST /api/pipelines/run
const result = await fetch('/api/pipelines/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    taskType: 'blog',          // GET /api/task-types 에서 목록 확인
    prompt: '블로그 주제',
    userId: 'user-123',
    strategy: 'quality',       // 'quality'|'speed'|'economy'
    complexity: 'medium'       // 'low'|'medium'|'high'|'enterprise'
  })
});
// 응답: { content, contentType, quality, combo, latency, cost }
```

#### 조합 추천 (UI 표시용)
```javascript
// POST /api/combo/recommend
const { combo, alternatives, reason } = await fetch('/api/combo/recommend', {
  method: 'POST',
  body: JSON.stringify({ taskType: 'blog', strategy: 'quality' })
}).then(r => r.json());
```

### onProgress 실시간 업데이트 처리
파이프라인 실행 시 진행 상황을 실시간으로 받으려면 SSE 버전 사용:
```
GET /api/ai/chat/stream?taskType=blog&prompt=...&stream=true
```

### 프론트 개발 규칙
- API 변경사항은 엔진팀에 요청 (직접 수정 불가)
- 에러 처리: `{ success: false, error: '...' }` 형식 응답 항상 처리
- `isFallback: true` 응답 시 UI에 표시 여부 결정 필요

### 브랜치 전략
- 프론트 개발: `front/feature-name`
- PR 대상: `genspark_ai_developer`

---

## 🚀 파트 4: 배포/QA팀 (DevOps/QA Team)

### 담당 범위
- VPS 서버 관리 및 배포
- CI/CD 파이프라인 (GitHub Actions)
- 자동화 테스트
- 모니터링 및 알림

### 소유 파일
```
.github/workflows/
Makefile
ecosystem.config.cjs
infra/
scripts/
ai-orchestrator/src/testcases/
ai-orchestrator/src/services/cronScheduler.js
```

### 배포 체크리스트

#### 일반 배포
```bash
# 1. 브랜치 최신화
cd /opt/ai-orchestrator/app
git fetch origin genspark_ai_developer
git pull origin genspark_ai_developer

# 2. 의존성 업데이트
cd ai-orchestrator
npm ci --only=production --quiet

# 3. PM2 재시작
pm2 reload ai-orchestrator --update-env

# 4. 헬스체크
sleep 3 && curl -sf http://localhost:3000/health
# 기대: {"status":"ok","hasOpenAI":true,"hasAnthropic":true,"demoMode":false}

# 5. DB 상태 확인
sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM inference_log;"
```

#### 긴급 롤백
```bash
cd /opt/ai-orchestrator/app
git log --oneline -5
git checkout <이전 커밋 해시>
pm2 reload ai-orchestrator --update-env
```

### 자동 테스트 실행
```bash
# 엔진 통합 테스트
curl -X POST http://localhost:3000/api/autotest/run \
  -H "Content-Type: application/json" \
  -d '{"suite": "engine", "quick": true}'

# 결과 확인
curl http://localhost:3000/api/autotest/status
```

### 모니터링 엔드포인트

| 엔드포인트 | 주기 | 정상 기준 |
|-----------|------|----------|
| GET /health | 1분 | `status: "ok"` |
| GET /api/ai/status | 5분 | 1개 이상 provider ready |
| GET /api/metrics/dashboard | 10분 | errorRate < 20% |
| GET /api/admin/health/dashboard | 30분 | openai clientReady=true |

### PM2 관리
```bash
pm2 status                    # 상태 확인
pm2 logs ai-orchestrator --lines 100  # 로그 확인
pm2 reload ai-orchestrator    # 무중단 재시작
pm2 restart ai-orchestrator   # 강제 재시작
```

### GitHub Actions CI 트리거
```yaml
# .github/workflows/tests.yml
branches: [main, genspark_ai_developer]
on: [push, pull_request]
```

### 환경변수 관리
```
필수 키 목록 (.env):
  OPENAI_API_KEY       ← 가장 중요
  ANTHROPIC_API_KEY
  MISTRAL_API_KEY
  MOONSHOT_API_KEY
  DEEPSEEK_API_KEY
  JWT_SECRET
  ADMIN_EMAIL
  ADMIN_PASSWORD
  
미해결:
  GOOGLE_API_KEY       ← clientReady=false 상태
  XAI_API_KEY          ← API 차단 상태
```

### 브랜치 전략
- 인프라 변경: `devops/feature-name`
- PR 대상: `genspark_ai_developer`

---

## 🔄 팀 간 협업 워크플로우

### 기능 개발 흐름
```
1. 각 팀이 자신의 브랜치에서 개발
   engine/feature → genspark_ai_developer (PR)
   admin/feature  → genspark_ai_developer (PR)
   front/feature  → genspark_ai_developer (PR)
   devops/feature → genspark_ai_developer (PR)

2. 교차 팀 의존성 변경 시:
   - 슬랙/이슈에 변경사항 알림
   - ENGINE_SPEC.md 업데이트 (엔진팀)
   - API 계약 변경은 반드시 공지 후 진행

3. 배포 흐름:
   genspark_ai_developer → PR → main → VPS 배포
```

### API 변경 프로토콜

| 변경 유형 | 담당 | 공지 방법 |
|----------|------|----------|
| 새 엔드포인트 추가 | 엔진팀 | ENGINE_SPEC.md 업데이트 |
| 기존 응답 형식 변경 | 엔진팀 | 전체 팀 공지 + 마이그레이션 가이드 |
| 인증 방식 변경 | 어드민팀 | 전체 팀 공지 |
| DB 스키마 변경 | 엔진팀 | migration 파일 제공 |
| 환경변수 추가 | 배포팀 | .env.sample 업데이트 |

### PR 리뷰 기준
- 엔진 코어 변경 → 엔진팀 + 배포팀 리뷰
- 어드민 UI 변경 → 어드민팀 자체 리뷰
- 프론트 변경 → 프론트팀 자체 리뷰
- 배포 스크립트 → 배포팀 + 엔진팀 리뷰

---

## 📌 현재 미해결 이슈 (우선순위 별)

### 🔴 즉시 처리 필요
1. **Google Gemini clientReady=false**
   - 담당: 엔진팀
   - 원인: baseURL 설정 문제
   - 해결: GOOGLE_API_KEY + 올바른 base URL 설정

2. **xAI API 전체 에러 (4/4 실패)**
   - 담당: 엔진팀
   - 원인: API 엔드포인트 차단
   - 해결: xAI API 상태 확인 후 whitelist에서 임시 비활성화

### 🟡 다음 스프린트
3. **costs vs inference_log 15개 불일치**
   - 담당: 엔진팀
   - 원인: 이전 데이터 (수정 전 costTracker 동작)
   - 해결: 신규 데이터는 정합성 확인됨, 기존 데이터 정리 배치 작성

4. **어드민 대시보드 Google/xAI 상태 표시 개선**
   - 담당: 어드민팀
   - 원인: clientReady=false 상태가 UI에서 불분명
   - 해결: 상태 배지 명확화

### ℹ️ 참고 사항
5. **GPT-5.3-codex, GPT-5.4, o3 — available=false**
   - 의도적 설정 (GenSpark 프록시 미지원 모델)
   - 별도 조치 불필요

---

*이 문서는 팀 리더가 관리합니다. 구조 변경 시 모든 팀에 공지 필요.*
