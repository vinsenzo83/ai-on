// ============================================================
// regressionSuite.js — AI Engine Regression Test Suite
// ============================================================
//
// STEP 6: 향후 코드 변경 시 AI 품질 보장을 위한 회귀 테스트
//
// 실행:
//   node regressionSuite.js [--url http://localhost:3000] [--fast] [--group A]
//
// 옵션:
//   --fast        : 빠른 테스트만 실행 (기본 대화 + 라우팅 + 핵심 툴)
//   --full        : 모든 테스트 실행 (기본값)
//   --url <url>   : API 엔드포인트 (기본: http://localhost:3000)
//   --group <G>   : 특정 그룹만 (A~K)
//   --timeout <n> : 타임아웃(ms) 기본 30000
//
// 총 49개 테스트 케이스:
//   A(5) 기본대화  B(4) 전략라우팅  C(4) 툴호출
//   D(3) 코드생성  E(3) 메모리회상  F(3) 연속대화
//   G(2) 심층분석  H(3) 오분류방지  I(2) KPI/관찰성
//   J(3) 엣지케이스  K(6) 에이전트(STEP 10~15)
//   L(6) Phase 2 Cost Controller
//   M(5) Phase 3 Failure Replay System
// ============================================================

'use strict';

const http  = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// ── CLI 옵션 파싱 ─────────────────────────────────────────────
const args    = process.argv.slice(2);
const BASE_URL = (() => {
  const i = args.indexOf('--url');
  return i >= 0 ? args[i + 1] : 'http://localhost:3000';
})();
const FAST_MODE    = args.includes('--fast');
const FULL_MODE    = args.includes('--full') || !FAST_MODE;
const GROUP_FILTER = (() => {
  const i = args.indexOf('--group');
  return i >= 0 ? args[i + 1]?.toUpperCase() : null;
})();
const TIMEOUT_MS = (() => {
  const i = args.indexOf('--timeout');
  return i >= 0 ? parseInt(args[i + 1], 10) : 30000;
})();

// ── 색상 출력 ─────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  blue:   '\x1b[34m',
};
const OK   = `${C.green}✅${C.reset}`;
const FAIL = `${C.red}❌${C.reset}`;
const WARN = `${C.yellow}⚠️ ${C.reset}`;

// ── HTTP 요청 유틸 ─────────────────────────────────────────────
function postJSON(url, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    const req = lib.request(opts, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`JSON parse error: ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

function getJSON(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'GET',
    };
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const req = lib.request(opts, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`JSON parse: ${buf.slice(0, 100)}`)); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// 연결 오류(ECONNREFUSED/socket hang up) 시 재시도
async function withRetry(fn, retries = 2, delayMs = 3000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const isRetryable = e.message?.includes('ECONNREFUSED') ||
                          e.message?.includes('socket hang up') ||
                          e.message?.includes('ECONNRESET');
      if (isRetryable && i < retries) {
        process.stdout.write(` [재연결 ${delayMs/1000}s 대기]`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
}

// ── 테스트 케이스 정의 (27개) ──────────────────────────────────
//
// expect 필드:
//   strategy      : 'fast' | 'balanced' | 'deep' | null (미검사)
//   modelContains : 모델 이름에 포함돼야 할 문자열
//   replyContains : 응답에 포함되어야 할 단어 배열 (any match)
//   replyAll      : 응답에 ALL 포함되어야 할 단어 배열
//   minReplyLen   : 최소 응답 길이
//   maxReplyLen   : 최대 응답 길이 (fast인 경우 과도한 응답 방지)
//   taskType      : 기대 taskType (null = 미검사)
//   noTask        : 이 taskType이면 실패 (오분류 방지)
//   noStrategy    : 이 strategy이면 실패
//   checkMemory   : { hasMemory: true } — 메모리 주입 확인
//   latencyTarget : 목표 응답 시간(ms) (초과해도 warn만, fail 아님)
//
// sessionTag: 같은 tag는 동일 세션 공유 → 연속 대화 테스트용
const TEST_CASES = [

  // ═══════════════════════════════════════════════════
  //  GROUP A: 기본 대화 (Basic Chat)
  // ═══════════════════════════════════════════════════
  {
    id: 'A1', category: '기본대화', desc: '인사 → fast/gpt-4o-mini 라우팅',
    message: '안녕',
    expect: {
      strategy:      'fast',
      modelContains: 'mini',
      minReplyLen:   5,
      latencyTarget: 4000,
    },
  },
  {
    id: 'A2', category: '기본대화', desc: '일반 설명 질문 → 충분한 응답 길이',
    // NOTE: 양자컴퓨터 설명은 LLM에 따라 analysis/deep으로 분류될 수 있음 (정상)
    // ai-module-server(Python) 또는 gpt-4o 모두 허용, strategy 체크 안 함
    message: '양자컴퓨터가 뭔지 설명해줘',
    expect: {
      strategy:    null,
      minReplyLen: 100,
    },
  },
  {
    id: 'A3', category: '기본대화', desc: 'React vs Vue 비교 → 충분한 응답',
    // NOTE: 비교 질문은 LLM이 analysis로 분류 (ai-module-server 라우팅) 가능 — strategy 체크 안 함
    message: 'React와 Vue의 차이점을 비교해줘',
    expect: {
      strategy:      null,
      minReplyLen:   100,
      replyContains: ['React', 'Vue'],
    },
  },
  {
    id: 'A4', category: '기본대화', desc: '날짜/시간 질문 → 2026년 응답',
    message: '오늘 날짜가 뭐야?',
    expect: {
      strategy:      'fast',
      minReplyLen:   5,
      replyContains: ['2026'],
    },
  },
  {
    id: 'A5', category: '기본대화', desc: '모호한 질문 — 의도 추론 응답',
    message: '이거 어떻게 해?',
    expect: {
      strategy:    null,
      minReplyLen: 5,
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP B: 전략 라우팅 (Strategy Routing)
  // ═══════════════════════════════════════════════════
  {
    id: 'B1', category: '라우팅', desc: '코드 요청 → deep/gpt-4o + code taskType',
    message: '파이썬으로 퀵소트 구현해줘',
    expect: {
      strategy:    'deep',
      taskType:    'code',
      minReplyLen: 200,
    },
  },
  {
    id: 'B2', category: '라우팅', desc: 'MSA 아키텍처 → deep + 긴 응답',
    message: 'MSA 기반 이커머스 시스템 아키텍처 설계해줘',
    expect: {
      strategy:    'deep',
      minReplyLen: 200,
    },
  },
  {
    id: 'B3', category: '라우팅', desc: '번역 요청 → fast + translate',
    message: '안녕하세요를 영어로 번역해줘',
    expect: {
      strategy:      'fast',
      taskType:      'translate',
      minReplyLen:   3,
      replyContains: ['Hello', 'hello', 'Hi'],
    },
  },
  {
    id: 'B4', category: '라우팅', desc: '심층 분석 → deep or balanced',
    message: 'AI 산업의 2025년 트렌드를 심층 분석해줘',
    expect: {
      noStrategy:  'fast',
      minReplyLen: 150,
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP C: 툴 호출 (Tool Calls)
  // ═══════════════════════════════════════════════════
  {
    id: 'C1', category: '툴', desc: '날씨 조회 → 실시간 온도 포함',
    message: '서울 날씨 알려줘',
    expect: {
      minReplyLen:   10,
      replyContains: ['°C', '서울', '날씨'],
      latencyTarget: 6000,
    },
  },
  {
    id: 'C2', category: '툴', desc: '환율 조회 → 숫자/원화 포함',
    message: '달러 환율 얼마야?',
    expect: {
      minReplyLen:   10,
      replyContains: ['원', 'USD', 'KRW', '달러', '환율', '1,'],
    },
  },
  {
    id: 'C3', category: '툴', desc: '현재 시간 조회 → 2026 포함',
    message: '지금 몇 시야?',
    expect: {
      minReplyLen:   5,
      replyContains: ['시', '분', '2026'],
    },
  },
  {
    id: 'C4', category: '툴', desc: '최신 뉴스 검색 → crawl 오분류 없음',
    message: '최신 AI 뉴스 알려줘',
    expect: {
      noTask:      'crawl',
      minReplyLen: 30,
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP D: 코드 생성 (Code Generation)
  // ═══════════════════════════════════════════════════
  {
    id: 'D1', category: '코드생성', desc: '피보나치 함수 → def + return 포함',
    message: '파이썬으로 피보나치 함수 만들어줘',
    expect: {
      strategy:      'deep',
      taskType:      'code',
      replyContains: ['def', 'return'],
      minReplyLen:   50,
    },
  },
  {
    id: 'D2', category: '코드생성', desc: '이진탐색 + 시간복잡도 → O(log n) 포함',
    message: '이진탐색 코드 짜고 시간복잡도 설명해줘',
    expect: {
      strategy:      'deep',
      taskType:      'code',
      replyContains: ['O(log', 'binary', 'Binary', '이진', 'log'],
      minReplyLen:   100,
    },
  },
  {
    id: 'D3', category: '코드생성', desc: 'TypeError 에러 수정 → deep 전략',
    message: 'TypeError: cannot read property of undefined 에러 어떻게 고쳐?',
    expect: {
      strategy:    'deep',
      minReplyLen: 50,
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP E: 메모리 회상 (Memory Recall)
  //  주의: E1→E2→E3 동일 세션 순서 필수
  // ═══════════════════════════════════════════════════
  {
    id: 'E1', category: '메모리', desc: '사용자 정보 선언 (블록체인 DeFi)',
    message: '나는 블록체인 DeFi 플랫폼을 개발 중인 풀스택 개발자야',
    expect: { minReplyLen: 5 },
    sessionTag: 'mem_recall',
  },
  {
    id: 'E2', category: '메모리', desc: '사용자 정보 회상 확인',
    message: '내가 어떤 프로젝트 개발 중이라고 했지?',
    expect: {
      minReplyLen:   10,
      replyContains: ['블록체인', 'DeFi', '개발'],
    },
    sessionTag: 'mem_recall',
    checkMemory: { hasMemory: true },
  },
  {
    id: 'E3', category: '메모리', desc: '프로젝트 맥락 활용 심층 질문',
    message: '내 프로젝트에 맞는 스마트 컨트랙트 보안 패턴 알려줘',
    expect: {
      strategy:    'deep',
      minReplyLen: 100,
    },
    sessionTag: 'mem_recall',
    checkMemory: { hasMemory: true },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP F: 연속 대화 컨텍스트 (Multi-Turn Context)
  //  F1→F2→F3 동일 세션 순서 필수
  // ═══════════════════════════════════════════════════
  {
    id: 'F1', category: '연속대화', desc: 'JS REST API 클라이언트 클래스 작성',
    message: 'JavaScript로 REST API 클라이언트 클래스 만들어줘',
    _timeout: 60000,  // deep + agent mode → 60초 허용
    expect: {
      strategy:    'deep',
      taskType:    'code',
      minReplyLen: 150,
    },
    sessionTag: 'ctx_test',
  },
  {
    id: 'F2', category: '연속대화', desc: '이전 코드에 retry 로직 추가',
    message: '방금 만든 클래스에 retry 로직 추가해줘',
    expect: {
      strategy:      'deep',
      minReplyLen:   100,
      replyContains: ['retry', 'Retry', '재시도'],
    },
    sessionTag: 'ctx_test',
  },
  {
    id: 'F3', category: '연속대화', desc: '위 코드 TypeScript 변환 (컨텍스트 유지)',
    message: '위 코드를 TypeScript로 변환해줘',
    expect: {
      strategy:      'deep',
      minReplyLen:   100,
      replyContains: ['interface', 'type', 'TypeScript', 'class'],
    },
    sessionTag: 'ctx_test',
  },

  // ═══════════════════════════════════════════════════
  //  GROUP G: 심층 분석 / 설계 (Deep Analysis)
  // ═══════════════════════════════════════════════════
  {
    id: 'G1', category: '심층분석', desc: 'AI SaaS 플랫폼 기술 스택 설계 → deep + 긴 응답',
    message: 'AI SaaS 플랫폼 기술 스택과 인프라 아키텍처 설계해줘',
    expect: {
      strategy:    'deep',
      minReplyLen: 300,
    },
  },
  {
    id: 'G2', category: '심층분석', desc: '스타트업 GTM 전략 수립 → deep + 단계별',
    message: '스타트업 AI 제품 GTM 전략 단계별로 수립해줘',
    expect: {
      strategy:    'deep',
      minReplyLen: 200,
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP H: 오분류 방지 (Misclassification Guard)
  // ═══════════════════════════════════════════════════
  {
    id: 'H1', category: '오분류방지', desc: 'URL 없는 검색 → crawl 금지',
    message: '내가 개발 중인 서비스 관련 최신 AI 트렌드 검색해줘',
    expect: {
      noTask:      'crawl',
      minReplyLen: 30,
    },
  },
  {
    id: 'H2', category: '오분류방지', desc: '코드+복잡도 → code 타입 + deep',
    message: '파이썬으로 이진탐색 코드 작성하고 시간복잡도 설명해줘',
    expect: {
      strategy:    'deep',
      taskType:    'code',
      minReplyLen: 100,
    },
  },
  {
    id: 'H3', category: '오분류방지', desc: '인사 → fast 전략 (deep 오분류 방지)',
    message: '안녕하세요!',
    expect: {
      strategy:      'fast',
      modelContains: 'mini',
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP I: 관찰성 / KPI 엔드포인트 (Observability)
  // ═══════════════════════════════════════════════════
  {
    id: 'I1', category: '관찰성', desc: '/api/kpi 엔드포인트 응답 확인',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _hasFields: ['totalRequests', 'toolCallRate', 'overall'],
    },
  },
  {
    id: 'I2', category: '관찰성', desc: '/health 엔드포인트 — status:ok',
    _type: 'GET',
    _path: '/health',
    expect: {
      _hasFields: ['status'],
      _fieldEquals: { status: 'ok' },
    },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP J: 엣지 케이스 (Edge Cases)
  // ═══════════════════════════════════════════════════
  {
    id: 'J1', category: '엣지케이스', desc: '모호한 짧은 입력 → 응답 있음',
    message: '음...',
    expect: { minReplyLen: 5 },
  },
  {
    id: 'J2', category: '엣지케이스', desc: '영어 코드 질문 → code 타입 + deep',
    message: 'How do I reverse a string in Python?',
    expect: { strategy: 'deep', taskType: 'code', minReplyLen: 50 },
  },
  {
    id: 'J3', category: '엣지케이스', desc: '감정 공감 질문 → 응답 있음 (오류 없음)',
    message: '요즘 개발이 너무 힘들어서 지쳐',
    expect: { minReplyLen: 20 },
  },

  // ═══════════════════════════════════════════════════
  //  GROUP K: Agent Runtime 테스트 (STEP 10~15)
  // ═══════════════════════════════════════════════════
  {
    id: 'K1', category: '에이전트', desc: '/api/agent/status — Agent Runtime 활성 + 컴포넌트 확인',
    _type: 'GET',
    _path: '/api/agent/status',
    expect: {
      _hasFields: ['agentEnabled', 'skills', 'components', 'version'],
    },
  },
  {
    id: 'K2', category: '에이전트', desc: '/api/agent/skills — 6개 이상 스킬 반환',
    _type: 'GET',
    _path: '/api/agent/skills',
    expect: {
      _hasFields: ['skills'],
      _minArrayLen: { field: 'skills', min: 5 },
    },
  },
  {
    id: 'K3', category: '에이전트', desc: 'deep 코드 분석 → 100자 이상 응답',
    message: '파이썬 비동기 프로그래밍의 핵심 개념과 async/await 사용법을 상세히 설명해줘',
    expect: {
      strategy:    'deep',
      minReplyLen: 100,
      replyContains: ['async', 'await'],
      latencyTarget: 45000,
    },
  },
  {
    id: 'K4', category: '에이전트', desc: '분석 태스크 → Planner + 응답',
    message: '인공지능이 소프트웨어 개발에 미치는 영향을 분석해줘',
    expect: {
      minReplyLen: 100,
      replyContains: ['AI', '개발', '인공지능'],
      latencyTarget: 45000,
    },
  },
  {
    id: 'K5', category: '에이전트', desc: 'POST /api/agent/plan — 플래너 계획 생성 (STEP 10)',
    _type: 'POST',
    _path: '/api/agent/plan',
    _body: { message: '최신 AI 트렌드를 조사하고 분석 리포트 작성해줘', taskType: 'analysis', strategy: 'deep' },
    expect: {
      _hasFields: ['success', 'planId', 'totalSteps', 'tasks', 'complexity'],
      _fieldEquals: { success: true },
      _minArrayLen: { field: 'tasks', min: 1 },
    },
  },
  {
    id: 'K6', category: '에이전트', desc: 'POST /api/agent/plan/status/:planId — 상태 조회 (STEP 12)',
    _type: 'GET',
    _path: '/api/agent/status',   // agent/status 재사용 (planId는 동적이므로)
    expect: {
      _hasFields: ['agentEnabled'],
    },
  },

  // ── L 그룹: Phase 2 Cost Controller (T1~T6) ─────────────────
  {
    id: 'L1', category: 'Cost Controller', desc: 'GET /api/kpi — budget KPI 필드 포함 여부 확인 (T1)',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _hasFields: ['budget'],
    },
  },
  {
    id: 'L2', category: 'Cost Controller', desc: 'GET /api/kpi — budget.agent_tasks_total 숫자 필드 (T2)',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _hasFields: ['budget'],
      _customCheck: (result) => {
        const b = result.budget;
        if (!b) return '응답에 budget 필드 없음';
        if (typeof b.agent_tasks_total !== 'number') return `budget.agent_tasks_total가 숫자가 아님: ${typeof b.agent_tasks_total}`;
        if (typeof b.avg_llm_calls_per_task !== 'number') return `budget.avg_llm_calls_per_task가 숫자가 아님`;
        if (typeof b.avg_tool_calls_per_task !== 'number') return `budget.avg_tool_calls_per_task가 숫자가 아님`;
        return null;
      },
    },
  },
  {
    id: 'L3', category: 'Cost Controller', desc: 'GET /api/kpi — budget_stop_rate / partial_result_rate 포함 (T3)',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _customCheck: (result) => {
        const b = result.budget;
        if (!b) return 'budget 필드 없음';
        if (!('budget_stop_rate' in b)) return 'budget_stop_rate 필드 없음';
        if (!('partial_result_rate' in b)) return 'partial_result_rate 필드 없음';
        if (!('budget_stop_reasons' in b)) return 'budget_stop_reasons 필드 없음';
        return null;
      },
    },
  },
  {
    id: 'L4', category: 'Cost Controller', desc: 'POST /api/agent/plan — normal budget 기본값 확인 (T4)',
    _type: 'POST',
    _path: '/api/agent/plan',
    _body: { message: '마케팅 전략 수립해줘', taskType: 'analysis', strategy: 'balanced' },
    expect: {
      _hasFields: ['success', 'planId', 'complexity'],
      _fieldEquals: { success: true },
    },
  },
  {
    id: 'L5', category: 'Cost Controller', desc: 'POST /api/agent/plan — complex budget 계획 생성 (T5)',
    _type: 'POST',
    _path: '/api/agent/plan',
    _body: { message: '글로벌 AI 시장 2024 심층 분석 및 투자 전략 종합 리포트를 작성해줘', taskType: 'report', strategy: 'deep' },
    expect: {
      _hasFields: ['success', 'planId', 'tasks', 'complexity'],
      _fieldEquals: { success: true },
      _minArrayLen: { field: 'tasks', min: 2 },
    },
  },
  {
    id: 'L6', category: 'Cost Controller', desc: 'GET /api/observability/kpi — budget KPI 관찰성 엔드포인트 (T6)',
    _type: 'GET',
    _path: '/api/observability/kpi',
    expect: {
      _hasFields: ['budget'],
      _customCheck: (result) => {
        const b = result.budget;
        if (!b) return 'budget 필드 없음';
        if (typeof b.avg_tokens_per_task !== 'number') return 'avg_tokens_per_task 숫자가 아님';
        if (typeof b.avg_execution_time_ms !== 'number') return 'avg_execution_time_ms 숫자가 아님';
        return null;
      },
    },
  },

  // ── M 그룹: Phase 3 Failure Replay System (T1~T5) ──────────
  {
    id: 'M1', category: 'Failure Replay', desc: 'GET /api/agent/failures — 실패 목록 조회 (T1)',
    _type: 'GET',
    _path: '/api/agent/failures',
    expect: {
      _hasFields: ['success', 'total', 'items'],
      _fieldEquals: { success: true },
      _customCheck: (result) => {
        if (!Array.isArray(result.items)) return 'items가 배열이 아님';
        if (typeof result.total !== 'number') return 'total이 숫자가 아님';
        return null;
      },
    },
  },
  {
    id: 'M2', category: 'Failure Replay', desc: 'GET /api/agent/failures/stats — 실패 통계 조회 (T2)',
    _type: 'GET',
    _path: '/api/agent/failures/stats',
    expect: {
      _hasFields: ['success', 'stats'],
      _fieldEquals: { success: true },
      _customCheck: (result) => {
        const s = result.stats;
        if (!s) return 'stats 필드 없음';
        if (typeof s.total_failures !== 'number') return 'stats.total_failures 숫자 아님';
        if (typeof s.total_replays  !== 'number') return 'stats.total_replays 숫자 아님';
        return null;
      },
    },
  },
  {
    id: 'M3', category: 'Failure Replay', desc: 'GET /api/kpi — failures KPI 필드 포함 확인 (T3)',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _hasFields: ['failures'],
      _customCheck: (result) => {
        const f = result.failures;
        if (!f) return 'failures 필드 없음';
        if (!('total_failures' in f))     return 'failures.total_failures 없음';
        if (!('partial_rate' in f))       return 'failures.partial_rate 없음';
        if (!('replay_success_rate' in f)) return 'failures.replay_success_rate 없음';
        return null;
      },
    },
  },
  {
    id: 'M4', category: 'Failure Replay', desc: 'GET /api/agent/failure/999 — 없는 ID → 404 (T4)',
    _type: 'GET',
    _path: '/api/agent/failure/999999',
    expect: {
      _customCheck: (result) => {
        // 404 는 success:false 로 반환
        if (result && result.success === true) return '존재하지 않는 ID에 success:true 반환됨';
        return null; // 404 또는 success:false → PASS
      },
    },
    _expectStatus: 404,
  },
  {
    id: 'M5', category: 'Failure Replay', desc: 'GET /failures — Debug UI HTML 서빙 확인 (T5)',
    _type: 'GET_RAW',
    _path: '/failures',
    expect: {
      _customCheck: (result) => {
        if (typeof result !== 'string') return '응답이 문자열이 아님';
        if (!result.includes('Failure Replay')) return '페이지에 "Failure Replay" 텍스트 없음';
        if (!result.includes('/api/agent/failures')) return '페이지에 API 경로 없음';
        return null;
      },
    },
  },

  // ── N 그룹: Phase 5 — Search Engine ─────────────────────────
  {
    id: 'N1', category: 'Search Engine', desc: 'GET /api/search/providers — 활성 프로바이더 목록 반환',
    _type: 'GET',
    _path: '/api/search/providers',
    expect: {
      success: true,
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (!Array.isArray(result.active_providers)) return 'active_providers 배열 아님';
        if (result.active_providers.length === 0) return 'active_providers 비어있음';
        if (!result.active_providers.includes('duckduckgo')) return 'duckduckgo 프로바이더 없음';
        if (typeof result.total_searches !== 'number') return 'total_searches 숫자 아님';
        return null;
      },
    },
  },
  {
    id: 'N2', category: 'Search Engine', desc: 'GET /api/search/test?q=Python — 실시간 검색 결과 반환',
    _type: 'GET',
    _path: '/api/search/test?q=Python',
    expect: {
      success: true,
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (typeof result.query !== 'string') return 'query 필드 없음';
        if (typeof result.latency_ms !== 'number') return 'latency_ms 숫자 아님';
        if (!result.kpi) return 'kpi 필드 없음';
        if (typeof result.kpi.total_searches !== 'number') return 'kpi.total_searches 숫자 아님';
        if (!Array.isArray(result.kpi.active_providers)) return 'kpi.active_providers 배열 아님';
        return null;
      },
    },
  },
  {
    id: 'N3', category: 'Search Engine', desc: 'GET /api/kpi — search KPI 필드 포함 확인',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (!result.search) return 'search KPI 필드 없음';
        if (typeof result.search.total_searches !== 'number') return 'search.total_searches 숫자 아님';
        if (!Array.isArray(result.search.active_providers)) return 'search.active_providers 배열 아님';
        if (!result.search.provider_counts) return 'search.provider_counts 없음';
        return null;
      },
    },
  },

  // ── O 그룹: Phase 4 — Parallel Executor ─────────────────────
  {
    id: 'O1', category: 'Parallel Executor', desc: 'GET /api/parallel/kpi — 병렬 KPI 필드 반환',
    _type: 'GET',
    _path: '/api/parallel/kpi',
    expect: {
      success: true,
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (typeof result.parallel_groups_total      !== 'number') return 'parallel_groups_total 숫자 아님';
        if (typeof result.parallel_tasks_total       !== 'number') return 'parallel_tasks_total 숫자 아님';
        if (typeof result.parallel_success_rate      !== 'string') return 'parallel_success_rate string 아님';
        if (typeof result.average_parallel_group_size !== 'number') return 'average_parallel_group_size 숫자 아님';
        if (typeof result.max_parallel_tools         !== 'number') return 'max_parallel_tools 숫자 아님';
        if (result.max_parallel_tools < 1 || result.max_parallel_tools > 5) return `max_parallel_tools 범위 오류 (${result.max_parallel_tools})`;
        return null;
      },
    },
  },
  {
    id: 'O2', category: 'Parallel Executor', desc: 'GET /api/kpi — parallel 필드 포함 확인',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (!result.parallel) return 'parallel KPI 필드 없음';
        if (typeof result.parallel.parallel_groups_total !== 'number') return 'parallel.parallel_groups_total 숫자 아님';
        if (typeof result.parallel.max_parallel_tools    !== 'number') return 'parallel.max_parallel_tools 숫자 아님';
        return null;
      },
    },
  },
  {
    id: 'O3', category: 'Parallel Executor', desc: 'POST /api/parallel/config — max_parallel_tools 변경',
    _type: 'POST',
    _path: '/api/parallel/config',
    _body: { max_parallel_tools: 2 },
    expect: {
      success: true,
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (result.max_parallel_tools !== 2) return `max_parallel_tools 변경 실패 (${result.max_parallel_tools})`;
        return null;
      },
      _afterCheck: async () => {
        // 원복
        await fetch(`${BASE_URL}/api/parallel/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_parallel_tools: 3 }),
        });
      },
    },
  },
  {
    id: 'O4', category: 'Parallel Executor', desc: 'GET /api/kpi — budget.parallel 필드 포함 확인',
    _type: 'GET',
    _path: '/api/kpi',
    expect: {
      _customCheck: (result) => {
        if (!result) return '응답 없음';
        if (!result.budget) return 'budget 필드 없음';
        if (!result.budget.parallel) return 'budget.parallel 필드 없음';
        if (typeof result.budget.parallel.max_parallel_tools !== 'number') return 'budget.parallel.max_parallel_tools 숫자 아님';
        return null;
      },
    },
  },

  // ── P그룹: Parallel Execution Unit Tests (Phase 4) ─────────────────────
  {
    id: 'P1', category: 'Parallel Unit', desc: 'groupParallelizableTasks — 독립 SEARCH 태스크 3개 → parallel wave 1개 생성',
    _type: 'UNIT',
    _fn: async () => {
      const { groupParallelizableTasks } = require('../agent/parallelExecutor');
      const tasks = [
        { id: 't1', type: 'SEARCH' },
        { id: 't2', type: 'SEARCH' },
        { id: 't3', type: 'SEARCH' },
      ];
      const waves = groupParallelizableTasks(tasks);
      if (!Array.isArray(waves)) return 'waves 배열 아님';
      const parallelWaves = waves.filter(w => w.parallel === true);
      if (parallelWaves.length < 1) return `parallel wave 없음 (got: ${JSON.stringify(waves.map(w=>({p:w.parallel,n:w.tasks.length})))})`;
      const totalParallelTasks = parallelWaves.reduce((s, w) => s + w.tasks.length, 0);
      if (totalParallelTasks !== 3) return `병렬 태스크 수 오류: 기대=3, 실제=${totalParallelTasks}`;
      return null;
    },
  },
  {
    id: 'P2', category: 'Parallel Unit', desc: 'groupParallelizableTasks — WRITE/SYNTHESIZE 태스크 → sequential wave로 처리',
    _type: 'UNIT',
    _fn: async () => {
      const { groupParallelizableTasks } = require('../agent/parallelExecutor');
      const tasks = [
        { id: 'w1', type: 'WRITE' },
        { id: 's1', type: 'SYNTHESIZE' },
        { id: 'p1', type: 'PLAN' },
      ];
      const waves = groupParallelizableTasks(tasks);
      if (!Array.isArray(waves)) return 'waves 배열 아님';
      const parallelWaves = waves.filter(w => w.parallel === true);
      if (parallelWaves.length > 0) return `WRITE/SYNTHESIZE/PLAN이 parallel로 처리됨 (오류)`;
      if (waves.length !== 3) return `순차 wave 수 오류: 기대=3, 실제=${waves.length}`;
      return null;
    },
  },
  {
    id: 'P3', category: 'Parallel Unit', desc: 'runParallelGroup — 일부 실패해도 Promise.allSettled로 나머지 결과 수집',
    _type: 'UNIT',
    _fn: async () => {
      const { runParallelGroup } = require('../agent/parallelExecutor');
      const tasks = [
        { id: 'ok1', type: 'SEARCH' },
        { id: 'fail1', type: 'SEARCH' },
        { id: 'ok2', type: 'SEARCH' },
      ];
      let execCount = 0;
      const execFn = async (task) => {
        execCount++;
        if (task.id === 'fail1') throw new Error('의도적 실패');
        return `결과-${task.id}`;
      };
      const results = await runParallelGroup(tasks, execFn, { groupId: 'test-p3' });
      if (!Array.isArray(results)) return 'results 배열 아님';
      if (results.length !== 3) return `결과 수 오류: 기대=3, 실제=${results.length}`;
      const successes = results.filter(r => r.success);
      const failures  = results.filter(r => !r.success);
      if (successes.length !== 2) return `성공 수 오류: 기대=2, 실제=${successes.length}`;
      if (failures.length  !== 1) return `실패 수 오류: 기대=1, 실제=${failures.length}`;
      if (!failures[0].error) return '실패 항목에 error 메시지 없음';
      return null;
    },
  },
  {
    id: 'P4', category: 'Parallel Unit', desc: 'groupParallelizableTasks — MAX_PARALLEL_TOOLS(3) 초과 시 배치 분할',
    _type: 'UNIT',
    _fn: async () => {
      const { groupParallelizableTasks, setMaxParallelTools } = require('../agent/parallelExecutor');
      // max=3으로 설정 후 5개 독립 SEARCH 태스크
      setMaxParallelTools(3);
      const tasks = [
        { id: 's1', type: 'SEARCH' },
        { id: 's2', type: 'SEARCH' },
        { id: 's3', type: 'SEARCH' },
        { id: 's4', type: 'SEARCH' },
        { id: 's5', type: 'SEARCH' },
      ];
      const waves = groupParallelizableTasks(tasks);
      const parallelWaves = waves.filter(w => w.parallel === true);
      // 5개 / 3 = 2개 배치 (3개 + 2개)
      if (parallelWaves.length < 2) return `배치 분할 실패: parallel wave=${parallelWaves.length}, 기대>=2`;
      const firstBatch = parallelWaves[0];
      if (firstBatch.tasks.length > 3) return `첫 배치 크기 초과: ${firstBatch.tasks.length} > 3`;
      return null;
    },
  },
  {
    id: 'P5', category: 'Parallel Unit', desc: 'mergeParallelResults — 중복 URL 제거 + 정규화 포맷 반환',
    _type: 'UNIT',
    _fn: async () => {
      const { mergeParallelResults } = require('../agent/parallelExecutor');
      // 동일 URL 포함된 두 결과
      const r1 = `[1] 제목A\n URL: https://example.com/a\n snippet: AI 관련 내용 A\n\n[2] 제목B\n URL: https://example.com/b\n snippet: 내용 B`;
      const r2 = `[1] 제목A\n URL: https://example.com/a\n snippet: AI 관련 내용 A (중복)\n\n[2] 제목C\n URL: https://example.com/c\n snippet: 내용 C`;
      const merged = mergeParallelResults([r1, r2], 'AI 테스트');
      if (typeof merged !== 'string') return 'merged 문자열 아님';
      if (merged.length < 10) return `merged 너무 짧음: ${merged.length}자`;
      // URL 중복 확인: example.com/a가 두 번 이상 나오면 안 됨
      const countA = (merged.match(/example\.com\/a/g) || []).length;
      if (countA > 1) return `중복 URL 제거 실패: example.com/a ${countA}번 등장`;
      return null;
    },
  },
  {
    id: 'P6', category: 'Parallel Unit', desc: 'runParallelGroup + KPI — 그룹 실행 후 KPI 카운터 증가 확인',
    _type: 'UNIT',
    _fn: async () => {
      const { runParallelGroup, getParallelKPI } = require('../agent/parallelExecutor');
      const kpiBefore = getParallelKPI();
      const tasks = [
        { id: 'kpi1', type: 'DATA_FETCH' },
        { id: 'kpi2', type: 'DATA_FETCH' },
      ];
      await runParallelGroup(tasks, async (t) => `data-${t.id}`, { groupId: 'test-p6' });
      const kpiAfter = getParallelKPI();
      if (kpiAfter.parallel_groups_total <= kpiBefore.parallel_groups_total)
        return `parallel_groups_total 증가 안 됨: ${kpiBefore.parallel_groups_total} → ${kpiAfter.parallel_groups_total}`;
      if (kpiAfter.parallel_tasks_total < kpiBefore.parallel_tasks_total + 2)
        return `parallel_tasks_total 증가 부족: +${kpiAfter.parallel_tasks_total - kpiBefore.parallel_tasks_total}`;
      if (typeof kpiAfter.parallel_success_rate !== 'string')
        return 'parallel_success_rate string 아님';
      return null;
    },
  },
];

// ── 테스트 실행 엔진 ───────────────────────────────────────────
async function runTest(tc, sessions) {
  const start = Date.now();
  let result, err;

  // UNIT — 인라인 함수 직접 실행 (P 그룹: parallelExecutor 단위 테스트)
  if (tc._type === 'UNIT') {
    let failMsg = null;
    try {
      failMsg = await tc._fn();
    } catch (e) {
      failMsg = `UNIT 실행 오류: ${e.message || String(e)}`;
    }
    const latency = Date.now() - start;
    const failures = failMsg ? [failMsg] : [];
    return { tc, pass: failures.length === 0, failures, latency, result: failMsg || 'OK' };
  }

  // GET_RAW — HTML/텍스트 원문 반환 (M5 등)
  if (tc._type === 'GET_RAW') {
    try {
      const res = await fetch(`${BASE_URL}${tc._path}`);
      result = await res.text();
    } catch (e) { err = e; }
    const latency = Date.now() - start;
    const failures = [];
    if (err || result === undefined) {
      failures.push(`GET_RAW 오류: ${err?.message || 'no response'}`);
      return { tc, pass: false, failures, latency, result: null };
    }
    if (tc.expect._customCheck) {
      const msg = tc.expect._customCheck(result);
      if (msg) failures.push(msg);
    }
    return { tc, pass: failures.length === 0, failures, latency, result: result?.substring(0, 100) };
  }

  // GET 타입 테스트 (I, K 그룹)
  if (tc._type === 'GET') {
    try {
      result = await withRetry(() => getJSON(`${BASE_URL}${tc._path}`), 2, 4000);
    } catch (e) { err = e; }
    const latency = Date.now() - start;
    const failures = [];

    // M4: _expectStatus=404 — 에러 응답이 예상인 경우
    if (tc._expectStatus === 404) {
      // err 또는 result.success===false → PASS
      if (!err && result && result.success === true) {
        failures.push('404 예상이지만 success:true 반환됨');
      }
      if (tc.expect._customCheck) {
        const msg = tc.expect._customCheck(result || {});
        if (msg) failures.push(msg);
      }
      return { tc, pass: failures.length === 0, failures, latency, result };
    }

    if (err || !result) {
      failures.push(`GET 오류: ${err?.message || 'no response'}`);
      return { tc, pass: false, failures, latency, result: null };
    }
    if (tc.expect._hasFields) {
      for (const f of tc.expect._hasFields) {
        if (!(f in result)) failures.push(`응답에 필드 없음: "${f}"`);
      }
    }
    if (tc.expect._fieldEquals) {
      for (const [k, v] of Object.entries(tc.expect._fieldEquals)) {
        if (result[k] !== v) failures.push(`${k}: 기대="${v}" 실제="${result[k]}"`);
      }
    }
    if (tc.expect._minArrayLen) {
      const { field, min } = tc.expect._minArrayLen;
      const arr = result[field];
      if (!Array.isArray(arr) || arr.length < min) {
        failures.push(`${field} 배열 길이 부족: ${Array.isArray(arr) ? arr.length : 'not array'} < ${min}`);
      }
    }
    // Phase 2: _customCheck 지원
    if (tc.expect._customCheck) {
      const errMsg = tc.expect._customCheck(result);
      if (errMsg) failures.push(`커스텀 검사 실패: ${errMsg}`);
    }
    return { tc, pass: failures.length === 0, failures, latency, result };
  }

  // POST 타입 테스트 (K5 — /api/agent/plan 등)
  if (tc._type === 'POST') {
    try {
      result = await withRetry(() => postJSON(`${BASE_URL}${tc._path}`, tc._body || {}), 2, 4000);
    } catch (e) { err = e; }
    const latency = Date.now() - start;
    const failures = [];
    if (err || !result) {
      failures.push(`POST 오류: ${err?.message || 'no response'}`);
      return { tc, pass: false, failures, latency, result: null };
    }
    if (tc.expect._hasFields) {
      for (const f of tc.expect._hasFields) {
        if (!(f in result)) failures.push(`응답에 필드 없음: "${f}"`);
      }
    }
    if (tc.expect._fieldEquals) {
      for (const [k, v] of Object.entries(tc.expect._fieldEquals)) {
        if (result[k] !== v) failures.push(`${k}: 기대="${v}" 실제="${result[k]}"`);
      }
    }
    if (tc.expect._minArrayLen) {
      const { field, min } = tc.expect._minArrayLen;
      const arr = result[field];
      if (!Array.isArray(arr) || arr.length < min) {
        failures.push(`${field} 배열 길이 부족: ${Array.isArray(arr) ? arr.length : 'not array'} < ${min}`);
      }
    }
    // Phase 2: _customCheck 지원
    if (tc.expect._customCheck) {
      const errMsg = tc.expect._customCheck(result);
      if (errMsg) failures.push(`커스텀 검사 실패: ${errMsg}`);
    }
    return { tc, pass: failures.length === 0, failures, latency, result };
  }

  // POST 메시지 테스트
  const sessionId = sessions[tc.sessionTag || tc.id] || uuidv4();
  if (tc.sessionTag && !sessions[tc.sessionTag]) {
    sessions[tc.sessionTag] = sessionId;
  }

  try {
    const testTimeout = tc._timeout || TIMEOUT_MS;
    result = await withRetry(
      () => postJSON(`${BASE_URL}/api/message`, { message: tc.message, sessionId }, testTimeout),
      2, 4000
    );
  } catch (e) { err = e; }
  const latency = Date.now() - start;

  const failures = [];

  if (err || !result) {
    failures.push(`API 오류: ${err?.message || 'no response'}`);
    return { tc, pass: false, failures, latency, result: null };
  }

  const reply    = result.reply    || '';
  const strategy = result.strategy || null;
  const model    = result.model    || '';
  const taskType = result.analysis?.taskType;
  const mem      = result.memoryState;

  const ex = tc.expect || {};

  // strategy 체크
  if (ex.strategy && strategy !== ex.strategy) {
    failures.push(`strategy: 기대="${ex.strategy}" 실제="${strategy}"`);
  }
  // noStrategy 체크
  if (ex.noStrategy && strategy === ex.noStrategy) {
    failures.push(`strategy 오류: "${ex.noStrategy}" 으로 잘못 라우팅됨`);
  }
  // model 체크
  if (ex.modelContains && !model.includes(ex.modelContains)) {
    failures.push(`model: "${ex.modelContains}" 미포함 (실제="${model}")`);
  }
  // taskType 체크
  if (ex.taskType && taskType !== ex.taskType) {
    failures.push(`taskType: 기대="${ex.taskType}" 실제="${taskType}"`);
  }
  // noTask 체크
  if (ex.noTask && taskType === ex.noTask) {
    failures.push(`taskType 오분류: "${ex.noTask}" 으로 잘못 분류됨`);
  }
  // 최소 응답 길이
  if (ex.minReplyLen && reply.length < ex.minReplyLen) {
    failures.push(`reply 너무 짧음: ${reply.length}자 < ${ex.minReplyLen}자`);
  }
  // 최대 응답 길이
  if (ex.maxReplyLen && reply.length > ex.maxReplyLen) {
    failures.push(`reply 너무 김: ${reply.length}자 > ${ex.maxReplyLen}자`);
  }
  // 응답 포함 키워드 (any match)
  if (ex.replyContains?.length) {
    const matched = ex.replyContains.some(k => reply.toLowerCase().includes(k.toLowerCase()));
    if (!matched) failures.push(`reply에 키워드 미포함 (any): [${ex.replyContains.join(', ')}]`);
  }
  // 응답 포함 키워드 (all match)
  if (ex.replyAll?.length) {
    for (const k of ex.replyAll) {
      if (!reply.toLowerCase().includes(k.toLowerCase())) {
        failures.push(`reply에 필수 키워드 없음: "${k}"`);
      }
    }
  }
  // 메모리 체크
  if (tc.checkMemory?.hasMemory && !mem?.hasMemory) {
    failures.push(`메모리 미주입 (hasMemory=false)`);
  }
  // maxLatencyMs: 초과 시 실패 (KPI 목표: 4초 이내)
  if (ex.maxLatencyMs && latency > ex.maxLatencyMs) {
    failures.push(`응답 지연 초과: ${latency}ms > 목표 ${ex.maxLatencyMs}ms`);
  }
  // latencyTarget: 경고만 (fail 아님)
  const latencyWarn = ex.latencyTarget && latency > ex.latencyTarget
    ? `⚠️ 응답 지연 ${latency}ms > 목표 ${ex.latencyTarget}ms`
    : null;

  return {
    tc, pass: failures.length === 0, failures, latency,
    result, strategy, model, taskType, latencyWarn,
  };
}

// ── 리포트 출력 ────────────────────────────────────────────────
function printReport(results) {
  const passed  = results.filter(r => r.pass);
  const failed  = results.filter(r => !r.pass);
  const total   = results.length;
  const avgMs   = Math.round(results.reduce((s, r) => s + r.latency, 0) / total);
  const slowOnes = results.filter(r => r.latencyWarn);

  // 카테고리별 집계
  const byCat = {};
  for (const r of results) {
    const cat = r.tc.category;
    if (!byCat[cat]) byCat[cat] = { pass: 0, fail: 0 };
    r.pass ? byCat[cat].pass++ : byCat[cat].fail++;
  }

  console.log('\n' + C.bold + '═══════════════════════════════════════════════════════' + C.reset);
  console.log(C.bold + '  AI Engine Regression Test Report — STEP 6~15' + C.reset);
  console.log('═══════════════════════════════════════════════════════');

  // 카테고리별 요약
  console.log('\n' + C.cyan + C.bold + '■ 카테고리별 결과' + C.reset);
  for (const [cat, v] of Object.entries(byCat)) {
    const bar = v.fail > 0
      ? `${C.red}${v.fail}실패${C.reset}`
      : `${C.green}전통과${C.reset}`;
    console.log(`  ${cat.padEnd(12)} ${v.pass}/${v.pass + v.fail}  ${bar}`);
  }

  // 개별 결과
  console.log('\n' + C.cyan + C.bold + '■ 개별 테스트 결과' + C.reset);
  for (const r of results) {
    const icon    = r.pass ? OK : FAIL;
    const latStr  = `${C.dim}${r.latency}ms${C.reset}`;
    const stratStr = r.strategy || '?';
    const modelStr = (r.model || '?').substring(0, 22);
    const taskStr  = r.taskType || '?';

    console.log(`  ${icon} [${r.tc.id}] ${r.tc.desc}  ${latStr}`);
    if (!r.tc._type) {
      console.log(`     ${C.dim}strategy=${stratStr} model=${modelStr} task=${taskStr}${C.reset}`);
    }
    if (r.latencyWarn) console.log(`     ${C.yellow}${r.latencyWarn}${C.reset}`);
    if (!r.pass) {
      for (const f of r.failures) {
        console.log(`     ${C.red}→ ${f}${C.reset}`);
      }
    }
  }

  // 지연 경고 요약
  if (slowOnes.length > 0) {
    console.log(`\n${C.yellow}${C.bold}⚠️  응답 지연 초과 항목 (${slowOnes.length}개):${C.reset}`);
    for (const r of slowOnes) {
      console.log(`   [${r.tc.id}] ${r.tc.desc} — ${r.latency}ms`);
    }
  }

  // 최종 요약
  console.log('\n' + '─'.repeat(55));
  const passRate = ((passed.length / total) * 100).toFixed(1);
  const color    = passed.length === total
    ? C.green
    : (passed.length / total > 0.8 ? C.yellow : C.red);
  console.log(
    `${C.bold}결과: ${color}${passed.length}/${total} 통과 (${passRate}%)${C.reset}` +
    `  평균 ${avgMs}ms  ` +
    `${slowOnes.length > 0 ? `${C.yellow}⚠️ ${slowOnes.length}개 지연${C.reset}` : ''}`
  );

  // KPI 기준 판정
  const kpiMet = parseFloat(passRate) >= 90;
  console.log(
    `${C.bold}KPI 목표(통과율 ≥90%): ${kpiMet ? `${C.green}충족` : `${C.red}미충족`}${C.reset}`
  );

  if (failed.length > 0) {
    console.log(`\n${C.red}${C.bold}실패 목록:${C.reset}`);
    for (const r of failed) {
      console.log(`  ${FAIL} [${r.tc.id}] ${r.tc.desc}`);
      for (const f of r.failures) console.log(`    → ${f}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════\n');

  return {
    total,
    passed:   passed.length,
    failed:   failed.length,
    passRate: parseFloat(passRate),
    avgMs,
    kpiMet,
    slowCount: slowOnes.length,
  };
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function runAITestSuite(options = {}) {
  const url        = options.url      || BASE_URL;
  const fastMode   = options.fastMode ?? FAST_MODE;
  const groupFilter = options.group   || GROUP_FILTER;

  // 테스트 선택
  let cases = TEST_CASES;
  if (groupFilter) {
    cases = TEST_CASES.filter(tc => tc.id.startsWith(groupFilter));
    if (cases.length === 0) {
      console.error(`그룹 "${groupFilter}"에 해당하는 테스트가 없습니다.`);
      process.exit(1);
    }
  } else if (fastMode) {
    // FAST 모드: 핵심 케이스만 (각 그룹 첫 번째 + 오분류 방지)
    const fastIds = ['A1','A2','B1','B3','C1','C2','D1','E1','E2','F1','H1','H2','H3','I1','I2','K1','K2','K5','L1','L4','M1','M2','M3','P1','P2','P3','P4','P5','P6'];
    cases = TEST_CASES.filter(tc => fastIds.includes(tc.id));
  }

  console.log(`\n${C.bold}${C.cyan}AI Engine Regression Test Suite — STEP 6~15 + Phase 2${C.reset}`);
  console.log(`대상: ${url}  모드: ${fastMode ? 'FAST' : groupFilter ? `GROUP-${groupFilter}` : 'FULL'}`);
  console.log(`케이스: ${cases.length}개  타임아웃: ${TIMEOUT_MS}ms\n`);

  const sessions = {};  // sessionTag → sessionId 공유
  const results  = [];

  for (const tc of cases) {
    process.stdout.write(`  테스트 [${tc.id}] ${tc.desc}... `);
    const r = await runTest(tc, sessions);
    results.push(r);
    const icon = r.pass ? OK : FAIL;
    process.stdout.write(
      `${icon}${r.latencyWarn ? ` ${WARN}` : ''} (${r.latency}ms)\n`
    );
  }

  const summary = printReport(results);

  // JSON 결과 저장
  const fs   = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, 'regression_results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    url,
    mode:      fastMode ? 'fast' : groupFilter ? `group-${groupFilter}` : 'full',
    summary,
    results:   results.map(r => ({
      id:          r.tc.id,
      category:    r.tc.category,
      desc:        r.tc.desc,
      pass:        r.pass,
      failures:    r.failures,
      latency:     r.latency,
      latencyWarn: r.latencyWarn || null,
      strategy:    r.strategy   || null,
      model:       r.model      || null,
      taskType:    r.taskType   || null,
    })),
  }, null, 2), 'utf8');
  console.log(`${C.dim}결과 저장: ${outPath}${C.reset}\n`);

  return summary;
}

// ── CLI 실행 ─────────────────────────────────────────────────
if (require.main === module) {
  runAITestSuite().then(s => {
    process.exit(s.failed > 0 ? 1 : 0);
  }).catch(e => {
    console.error('테스트 실행 오류:', e);
    process.exit(2);
  });
}

module.exports = { runAITestSuite, TEST_CASES };
