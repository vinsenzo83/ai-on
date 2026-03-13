# ENGINE_IMPROVEMENT_REPORT.md
# AI 조합 엔진 Phase 13 — 개선 우선순위 Top 5 구현 완료 보고서

> 작성일: 2026-03-12  
> 기준: Phase 12 검증 결과 (종합점수 91.6/100, 라우팅 67%, 개선 필요)

---

## 📋 개선 항목 요약

| 우선순위 | 항목 | 상태 | 검증 결과 |
|--------|------|------|---------|
| P1 | fast strategy google/mistral 우선 라우팅 | ✅ 완료 | 코드 검사 PASS |
| P1 | xAI 429 런타임 폴백 체인 명시 | ✅ 완료 | 코드 검사 PASS |
| P3 | Redis 캐시 영속화 (파일 기반) | ✅ 완료 | 코드 검사 PASS |
| P4 | DeepSeek CB 임계값 5→3 | ✅ 완료 | 코드 검사 PASS |
| P5 | grok-3-mini 완전 비활성화 | ✅ 완료 | 코드 검사 PASS + 런타임 로그 확인 |

---

## 🔧 상세 변경 내역

### [P1] 라우팅 정확도 67% → 90%+ 목표

**문제**: fast strategy가 항상 OpenAI(gpt-4o-mini)를 첫 번째로 선택하여 google/mistral 우선 라우팅 불가능

**변경 내용** (`aiConnector.js`):

```javascript
// 기존 (Phase 12)
const MODEL_STRATEGY = {
  fast: { openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001' },
  ...
};
// 모델 결정: oai 있으면 바로 openai 선택
resolvedModel = oai ? strat.openai : (ant ? strat.anthropic : null);

// 개선 (Phase 13)
const MODEL_STRATEGY = {
  fast: {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    google: 'gemini-2.0-flash',   // ← 신규 추가
    mistral: 'mistral-small-latest' // ← 신규 추가
  },
  ...
};

// FAST_STRATEGY_PRIORITY: google → mistral → openai → anthropic 순서
const FAST_STRATEGY_PRIORITY = ['google', 'mistral', 'openai', 'anthropic'];

// fast 전략 시 우선순위 순회
if (strategy === 'fast') {
  for (const p of FAST_STRATEGY_PRIORITY) {
    if (_isCBOpen(p)) continue;
    const client = p === 'anthropic' ? _getAnthropic() : _getClient(p);
    if (client && strat[p]) { resolvedModel = strat[p]; break; }
  }
}
```

**FALLBACK_CHAIN 순서 변경**:
```javascript
// 기존: openai → anthropic → mistral → moonshot → deepseek → google
// 변경: google → mistral → openai → anthropic → moonshot → deepseek
const FALLBACK_CHAIN = ['google', 'mistral', 'openai', 'anthropic', 'moonshot', 'deepseek'];
```

**예상 효과**:
- Google/Mistral API 키가 등록된 환경에서 fast 라우팅 히트율 90%+ 달성
- 기존: gpt-4o-mini 독점 사용 → 변경: gemini-2.0-flash 또는 mistral-small 우선 사용
- 비용 절감: gemini-2.0-flash는 gpt-4o-mini 대비 ~40% 저렴, mistral-small은 ~50% 저렴

---

### [P1] xAI 429 런타임 폴백 체인 명시

**문제**: xAI 403/429 에러 시 폴백 체인이 `_pickFallbackProvider`에 의존 → openai가 먼저 선택될 수 있음

**변경 내용** (`aiConnector.js`, `_immediateProviderFallback`):

```javascript
// xAI 전용 폴백 체인 명시
const xaiPreferredChain = ['openai', 'mistral', 'google', 'anthropic'];

if (excludeProvider === 'xai' && (reason === 'RATE_LIMIT' || reason === 'AUTH_FAILED')) {
  console.warn(`[aiConnector][xAI-429] xAI ${reason} 감지 → 우선 폴백 체인: ...`);
  // xaiPreferredChain 순서로 가용 프로바이더 선택
  for (const p of xaiPreferredChain) {
    if (_isCBOpen(p)) continue;
    const client = ...;
    if (client) { fbProvider = p; break; }
  }
}
```

**폴백 모델 맵 개선** (기존에는 anthropic/openai만 있었음):
```javascript
const fbModelMap = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google:    'gemini-2.0-flash',
  mistral:   'mistral-small-latest',
  deepseek:  'deepseek-chat',
  moonshot:  'moonshot-v1-8k',
};
```

**fallbackReason 개선**: `'xai:RATE_LIMIT→openai'` 형식으로 상세 체인 정보 기록

---

### [P3] 캐시 파일 영속화 (PM2 재시작 후 히트율 유지)

**문제**: 인메모리 캐시만 사용하여 PM2 재시작/크래시 시 모든 캐시 손실

**변경 내용** (`aiConnector.js`):

```javascript
const fs   = require('fs');    // ← 신규 추가
const path = require('path'); // ← 신규 추가

const CACHE_PERSIST_PATH = path.join(__dirname, '../../.cache/response_cache.json');
const CACHE_PERSIST_INTERVAL_MS = 60_000; // 1분마다 저장

// 서버 시작 시 캐시 복원
_loadCacheFromDisk(); // 유효한(TTL 이내) 항목만 복원

// 주기적 저장 (1분 간격)
const _cachePersistTimer = setInterval(_saveCacheToDisk, CACHE_PERSIST_INTERVAL_MS);
if (_cachePersistTimer.unref) _cachePersistTimer.unref(); // graceful shutdown

// PM2 종료 시 최종 저장
process.on('SIGTERM', () => { _saveCacheToDisk(); });
process.on('SIGINT',  () => { _saveCacheToDisk(); });
```

**예상 효과**:
- PM2 재시작 후 TTL(5분) 이내 캐시 항목 자동 복원
- 캐시 히트율 유지: 재시작 직후에도 50%+ 히트율 유지 가능
- 파일 경로: `/opt/ai-orchestrator/app/ai-orchestrator/.cache/response_cache.json`

---

### [P4] DeepSeek CB 임계값 5 → 3

**문제**: DeepSeek가 불안정할 때 5회 실패 후에야 차단 → 불필요한 에러 노출

**변경 내용** (`aiConnector.js`):

```javascript
// 기존: 모든 프로바이더 동일하게 CB_FAIL_THRESHOLD = 5
// 변경: 프로바이더별 임계값 오버라이드

const CB_FAIL_THRESHOLD_BY_PROVIDER = {
  deepseek: 3,  // [P4] 3회 실패 → 즉시 차단 (기존 5회)
  xai:      2,  // xAI 신뢰도 낮음 → 2회 실패 시 차단
};

// _cbFailure 내에서 프로바이더별 임계값 적용
const threshold = CB_FAIL_THRESHOLD_BY_PROVIDER[provider] || CB_FAIL_THRESHOLD;
if (cb.failures >= threshold) {
  cb.state = 'OPEN';
  ...
}
```

---

### [P5] xAI grok-3-mini 완전 비활성화

**문제**: grok-3-mini가 whitelist에서 `available: false`이지만 일부 경로로 선택될 가능성 존재

**변경 내용** (`aiConnector.js`):

```javascript
// DISABLED_MODELS: 어떤 경로로도 사용 불가 (화이트리스트보다 선행 체크)
const DISABLED_MODELS = new Set([
  'grok-3-mini',  // xAI 크레딧 없음 + 신뢰도 낮음
  'grok-beta',    // xAI 크레딧 없음
  'grok-3',       // xAI 크레딧 없음
]);

// callLLM 내 모델 결정 직후 블랙리스트 체크
if (resolvedModel && DISABLED_MODELS.has(resolvedModel)) {
  console.warn(`[aiConnector][DISABLED] ${resolvedModel}은 완전 비활성화됨 → 즉시 폴백`);
  // fast 전략 폴백 모델로 즉시 교체
  isFallback = true;
  fallbackReason = `DISABLED: ${resolvedModel}`;
  resolvedModel = fbModel; // openai/google/mistral 중 가용한 것
}
```

**런타임 검증 (로컬 테스트)**:
```
[aiConnector][DISABLED] grok-3-mini은 완전 비활성화됨 → 즉시 폴백
```
→ 로그 출력 확인 ✅

---

## 📊 검증 결과

### 코드 정적 검사 (5/5 PASS)

| task_id | 항목 | 결과 | 비고 |
|--------|------|------|------|
| P5-grok-disabled-code | DISABLED_MODELS 구조 | ✅ PASS | Set + grok-3-mini + 차단로직 모두 확인 |
| P4-deepseek-cb-3 | CB_FAIL_THRESHOLD=3 | ✅ PASS | ThresholdMap + deepseek=3 + 적용로직 확인 |
| P3-cache-persist-code | 캐시 파일 영속화 | ✅ PASS | fs/path/load/save/interval/SIGTERM 전부 확인 |
| P1-fast-routing-code | fast 우선순위 배열 | ✅ PASS | Priority배열 + gemini + mistral + fast분기 확인 |
| P1-xai-fallback-code | xAI 폴백 체인 | ✅ PASS | xaiChain + RATE_LIMIT분기 + modelMap 확인 |

### 런타임 검증 (서버 환경 필요)

> 서버(144.172.93.226)에서 `pm2 restart ai-orchestrator` 후 재검증 필요

예상 개선 결과:
- **라우팅 적중률**: 67% → 90%+ (Google/Mistral API 키 등록 시)
- **grok-3-mini 차단**: 런타임 `[DISABLED]` 로그 확인됨
- **캐시 영속화**: PM2 재시작 후 `.cache/response_cache.json` 복원
- **DeepSeek CB**: 3회 연속 실패 시 즉시 차단 (기존 5회)

---

## 🚀 서버 배포 절차

```bash
# 서버에서 실행
cd /opt/ai-orchestrator/app
git fetch origin
git checkout genspark_ai_developer
git pull origin genspark_ai_developer

# 캐시 디렉토리 생성
mkdir -p /opt/ai-orchestrator/app/.cache

# 재시작
pm2 restart ai-orchestrator

# 재검증
node /opt/ai-orchestrator/app/ai-orchestrator/engine_improvement_val.js
```

---

## 📈 Phase 12 → Phase 13 비교

| 지표 | Phase 12 | Phase 13 (예상) | 개선 |
|------|---------|----------------|------|
| 라우팅 정확도 | 67% (14/21) | **90%+** | +23%p |
| grok-3-mini 차단 | 부분적 | **완전 차단** | ✅ |
| xAI 폴백 체인 | 미정의 | **명시적 체인** | ✅ |
| 캐시 영속화 | 없음 (인메모리) | **파일 기반 영속화** | ✅ |
| DeepSeek CB 임계값 | 5회 | **3회** | -40% |
| 종합 점수 | 91.6/100 | **예상 95+/100** | +3.4 |
| 판정 | PASS | **PASS (강화)** | ✅ |

---

## 📝 다음 단계 권장사항

1. **서버 배포 + 재검증**: git pull → pm2 restart → engine_improvement_val.js 실행
2. **Google/Mistral 키 확인**: Admin 패널에서 google/mistral API 키 활성 상태 확인 (라우팅 90% 달성 전제)
3. **캐시 디렉토리 생성**: `/opt/ai-orchestrator/app/.cache/` 디렉토리 생성
4. **CB 모니터링**: 24시간 후 DeepSeek/xAI CB 차단 빈도 확인
5. **라우팅 대시보드**: Admin 패널에 모델별 라우팅 히트율 위젯 추가 (Phase 14 권장)

---

*Phase 13 개선 완료 | 코드 변경: aiConnector.js (+76줄, -18줄) | 검증: 5/5 PASS*
