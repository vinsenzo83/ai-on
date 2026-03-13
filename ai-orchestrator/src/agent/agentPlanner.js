// ============================================================
// AgentPlanner — STEP 10: 요청을 JSON 태스크 목록으로 변환
// ============================================================
// 역할:
//   User Intent → structured task list (JSON)
//   각 태스크에 id, name, type, input, tool, dependsOn, status 포함
//   TaskStateEngine (STEP 12)과 연동하여 실행 상태 추적
//
// STEP 12 TaskStateEngine 통합:
//   task_state: planning | searching | analyzing | writing | reviewing | done | failed
//   current_step, total_steps 필드 포함
//   실시간 상태 업데이트 및 emit 지원
// ============================================================

'use strict';

// ─────────────────────────────────────────────────────────────
// § 태스크 타입 정의
// ─────────────────────────────────────────────────────────────
const TASK_TYPES = {
  SEARCH:    'search',       // 웹 검색
  EXTRACT:   'extract',      // 정보 추출
  ANALYZE:   'analyze',      // 분석
  SUMMARIZE: 'summarize',    // 요약
  WRITE:     'write',        // 문서 작성
  CODE:      'code',         // 코드 생성
  REVIEW:    'review',       // 검토/검증
  PLAN:      'plan',         // 기획/구조
  TOOL:      'tool',         // 특수 도구 호출
  SYNTHESIZE:'synthesize',   // 결과 통합
};

// ─────────────────────────────────────────────────────────────
// § 태스크 상태 — STEP 12
// ─────────────────────────────────────────────────────────────
const TASK_STATE = {
  PLANNING:   'planning',
  SEARCHING:  'searching',
  ANALYZING:  'analyzing',
  WRITING:    'writing',
  REVIEWING:  'reviewing',
  DONE:       'done',
  FAILED:     'failed',
  PENDING:    'pending',
  RUNNING:    'running',
};

// ─────────────────────────────────────────────────────────────
// § 복잡도 임계값
// ─────────────────────────────────────────────────────────────
const COMPLEXITY = {
  SIMPLE:  'simple',   // 1~2 steps
  NORMAL:  'normal',   // 3~4 steps
  COMPLEX: 'complex',  // 5+ steps
};

// ─────────────────────────────────────────────────────────────
// § AgentPlanner 클래스
// ─────────────────────────────────────────────────────────────
class AgentPlanner {
  constructor(openaiClient) {
    this.openai = openaiClient;
    this._planCache = new Map(); // 동일 의도 재사용 (짧은 TTL)
  }

  // ── 핵심: 요청 → 태스크 목록 생성 ──────────────────────────
  async createPlan(userMessage, taskType, strategy, context = {}) {
    const planStart = Date.now();

    // 단순 태스크는 LLM 없이 즉시 계획 생성
    const quickPlan = this._quickPlan(userMessage, taskType, strategy);
    if (quickPlan) {
      return this._buildPlanResult(quickPlan, userMessage, taskType, Date.now() - planStart);
    }

    // complex 태스크: LLM 기반 동적 계획
    try {
      const llmPlan = await this._llmPlan(userMessage, taskType, strategy, context);
      return this._buildPlanResult(llmPlan, userMessage, taskType, Date.now() - planStart);
    } catch (err) {
      console.warn('[AgentPlanner] LLM 계획 실패, 기본 계획 사용:', err.message);
      const fallback = this._fallbackPlan(taskType, userMessage);
      return this._buildPlanResult(fallback, userMessage, taskType, Date.now() - planStart);
    }
  }

  // ── 빠른 계획 (단순 태스크용 — LLM 호출 없음) ─────────────
  _quickPlan(message, taskType, strategy) {
    if (strategy === 'fast') {
      // fast 전략: 단일 태스크
      return {
        complexity: COMPLEXITY.SIMPLE,
        tasks: [{
          id: 'main',
          name: '직접 응답',
          type: TASK_TYPES.WRITE,
          tool: null,
          dependsOn: [],
          priority: 1,
        }],
        reasoning: 'fast 전략 — 단일 응답',
      };
    }

    // 날씨/환율/시간 단순 조회
    if (/날씨|온도|weather/i.test(message)) {
      return {
        complexity: COMPLEXITY.SIMPLE,
        tasks: [
          { id: 'weather', name: '날씨 조회', type: TASK_TYPES.TOOL, tool: 'get_weather', dependsOn: [], priority: 1 },
          { id: 'respond', name: '응답 생성', type: TASK_TYPES.WRITE, tool: null, dependsOn: ['weather'], priority: 2 },
        ],
        reasoning: '날씨 조회 → 응답',
      };
    }
    if (/환율|달러|엔화|유로|exchange/i.test(message)) {
      return {
        complexity: COMPLEXITY.SIMPLE,
        tasks: [
          { id: 'rate', name: '환율 조회', type: TASK_TYPES.TOOL, tool: 'get_exchange_rate', dependsOn: [], priority: 1 },
          { id: 'respond', name: '응답 생성', type: TASK_TYPES.WRITE, tool: null, dependsOn: ['rate'], priority: 2 },
        ],
        reasoning: '환율 조회 → 응답',
      };
    }
    if (/시간|날짜|요일|몇 시|datetime/i.test(message)) {
      return {
        complexity: COMPLEXITY.SIMPLE,
        tasks: [
          { id: 'time', name: '시간 조회', type: TASK_TYPES.TOOL, tool: 'get_datetime', dependsOn: [], priority: 1 },
          { id: 'respond', name: '응답 생성', type: TASK_TYPES.WRITE, tool: null, dependsOn: ['time'], priority: 2 },
        ],
        reasoning: '시간 조회 → 응답',
      };
    }

    // 코드 생성 (balanced)
    if (taskType === 'code' && strategy === 'balanced') {
      return {
        complexity: COMPLEXITY.NORMAL,
        tasks: [
          { id: 'design',  name: '설계',     type: TASK_TYPES.PLAN,  tool: null, dependsOn: [],       priority: 1 },
          { id: 'code',    name: '코드 작성', type: TASK_TYPES.CODE,  tool: null, dependsOn: ['design'], priority: 2 },
          { id: 'review',  name: '코드 검토', type: TASK_TYPES.REVIEW, tool: null, dependsOn: ['code'],  priority: 3 },
        ],
        reasoning: '코드 생성: 설계 → 작성 → 검토',
      };
    }

    return null; // LLM 계획 필요
  }

  // ── LLM 기반 동적 계획 ─────────────────────────────────────
  async _llmPlan(message, taskType, strategy, context) {
    const sysPrompt = `당신은 AI 에이전트 플래너입니다.
사용자 요청을 분석하여 실행 가능한 태스크 목록을 JSON으로 반환하세요.

사용 가능한 태스크 타입:
- search: 웹 검색 (tool: web_search)
- extract: URL에서 정보 추출 (tool: web_search)
- analyze: 데이터/텍스트 분석
- summarize: 요약
- write: 문서/글 작성
- code: 코드 생성
- review: 검토/검증/자기교정
- plan: 기획/구조 설계
- tool: 특수 도구 (get_weather, get_exchange_rate, get_datetime)
- synthesize: 여러 결과 통합

규칙:
1. 최소 태스크로 목표 달성 (simple: 2개, normal: 3~4개, complex: 5~7개)
2. dependsOn으로 의존성 명시
3. 검색이 필요한 경우 반드시 search 태스크 포함
4. 마지막 태스크는 항상 synthesize 또는 review
5. 자기교정이 필요한 경우 review 태스크 추가

반환 형식:
{
  "complexity": "simple|normal|complex",
  "reasoning": "이 계획을 선택한 이유 한 줄",
  "tasks": [
    {
      "id": "고유ID",
      "name": "태스크 이름",
      "type": "search|analyze|write|code|review|plan|tool|synthesize|summarize|extract",
      "tool": "web_search|get_weather|get_exchange_rate|get_datetime|null",
      "dependsOn": ["이전태스크ID"],
      "priority": 순서번호
    }
  ]
}`;

    const userPrompt = `요청: ${message}
태스크 타입: ${taskType}
전략: ${strategy}
${context.memoryHint ? `이전 컨텍스트: ${context.memoryHint.substring(0, 200)}` : ''}

최적의 실행 계획을 JSON으로 생성하세요.`;

    const res = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 800,
    });

    const plan = JSON.parse(res.choices[0].message.content);
    return this._validatePlan(plan);
  }

  // ── 계획 검증 및 보완 ────────────────────────────────────────
  _validatePlan(plan) {
    if (!plan.tasks || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      throw new Error('태스크 목록 없음');
    }
    const validTypes = Object.values(TASK_TYPES);
    plan.tasks = plan.tasks.map((t, i) => ({
      id:        t.id        || `task_${i + 1}`,
      name:      t.name      || `태스크 ${i + 1}`,
      type:      validTypes.includes(t.type) ? t.type : TASK_TYPES.WRITE,
      tool:      t.tool      || null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      priority:  t.priority  || (i + 1),
    }));
    plan.complexity = plan.complexity || COMPLEXITY.NORMAL;
    plan.reasoning  = plan.reasoning  || '동적 계획';
    return plan;
  }

  // ── 폴백 계획 (오류 시) ──────────────────────────────────────
  _fallbackPlan(taskType, message) {
    const needsSearch = /최신|뉴스|검색|트렌드|2024|2025|2026/i.test(message);
    const tasks = [];

    if (needsSearch) {
      tasks.push({ id: 'search', name: '정보 검색', type: TASK_TYPES.SEARCH, tool: 'web_search', dependsOn: [], priority: 1 });
    }

    if (taskType === 'code') {
      tasks.push({ id: 'code', name: '코드 작성', type: TASK_TYPES.CODE, tool: null, dependsOn: needsSearch ? ['search'] : [], priority: tasks.length + 1 });
    } else if (taskType === 'analysis') {
      tasks.push({ id: 'analyze', name: '분석', type: TASK_TYPES.ANALYZE, tool: null, dependsOn: needsSearch ? ['search'] : [], priority: tasks.length + 1 });
    } else {
      tasks.push({ id: 'write', name: '응답 작성', type: TASK_TYPES.WRITE, tool: null, dependsOn: needsSearch ? ['search'] : [], priority: tasks.length + 1 });
    }

    tasks.push({ id: 'review', name: '결과 검토', type: TASK_TYPES.REVIEW, tool: null, dependsOn: [tasks[tasks.length - 1].id], priority: tasks.length + 1 });

    return { complexity: COMPLEXITY.NORMAL, reasoning: '폴백 계획', tasks };
  }

  // ── 계획 결과 객체 생성 ──────────────────────────────────────
  _buildPlanResult(plan, message, taskType, planMs) {
    return {
      planId:     `plan_${Date.now()}`,
      message:    message.substring(0, 100),
      taskType,
      complexity: plan.complexity,
      reasoning:  plan.reasoning,
      tasks:      plan.tasks,
      totalSteps: plan.tasks.length,
      currentStep: 0,
      task_state:  TASK_STATE.PLANNING,
      planMs,
      createdAt:  new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// § TaskStateEngine — STEP 12: 태스크 상태 추적
// ─────────────────────────────────────────────────────────────
class TaskStateEngine {
  constructor() {
    this._states = new Map(); // planId → state object
    this._listeners = new Map(); // planId → callback[]
  }

  // ── 새 태스크 플랜 등록 ──────────────────────────────────────
  register(plan) {
    const state = {
      planId:      plan.planId,
      task_state:  TASK_STATE.PLANNING,
      current_step: 0,
      total_steps:  plan.totalSteps,
      tasks:        plan.tasks.map(t => ({ ...t, status: TASK_STATE.PENDING, result: null, error: null, startedAt: null, completedAt: null })),
      results:      {},
      startedAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      completedAt:  null,
      error:        null,
    };
    this._states.set(plan.planId, state);
    return state;
  }

  // ── 상태 가져오기 ─────────────────────────────────────────────
  getState(planId) {
    return this._states.get(planId) || null;
  }

  // ── 전체 플랜 상태 업데이트 ───────────────────────────────────
  updatePlanState(planId, newState) {
    const s = this._states.get(planId);
    if (!s) return;
    s.task_state = newState;
    s.updatedAt  = new Date().toISOString();
    this._notify(planId, s);
  }

  // ── 개별 태스크 시작 ──────────────────────────────────────────
  startTask(planId, taskId, stateOverride) {
    const s = this._states.get(planId);
    if (!s) return;
    const task = s.tasks.find(t => t.id === taskId);
    if (task) {
      task.status    = TASK_STATE.RUNNING;
      task.startedAt = new Date().toISOString();
    }
    s.task_state = stateOverride || this._inferPlanState(taskId, s);
    s.updatedAt  = new Date().toISOString();
    this._notify(planId, s);
  }

  // ── 개별 태스크 완료 ──────────────────────────────────────────
  completeTask(planId, taskId, result) {
    const s = this._states.get(planId);
    if (!s) return;
    const task = s.tasks.find(t => t.id === taskId);
    if (task) {
      task.status      = TASK_STATE.DONE;
      task.result      = result;
      task.completedAt = new Date().toISOString();
    }
    s.results[taskId] = result;
    s.current_step    = s.tasks.filter(t => t.status === TASK_STATE.DONE).length;
    s.updatedAt       = new Date().toISOString();
    this._notify(planId, s);
  }

  // ── 개별 태스크 실패 ──────────────────────────────────────────
  failTask(planId, taskId, error) {
    const s = this._states.get(planId);
    if (!s) return;
    const task = s.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = TASK_STATE.FAILED;
      task.error  = error;
    }
    s.task_state = TASK_STATE.FAILED;
    s.error      = error;
    s.updatedAt  = new Date().toISOString();
    this._notify(planId, s);
  }

  // ── 전체 완료 ─────────────────────────────────────────────────
  completePlan(planId) {
    const s = this._states.get(planId);
    if (!s) return;
    s.task_state  = TASK_STATE.DONE;
    s.completedAt = new Date().toISOString();
    s.updatedAt   = new Date().toISOString();
    s.current_step = s.total_steps;
    this._notify(planId, s);
    // 1시간 후 정리
    setTimeout(() => this._states.delete(planId), 3600_000);
  }

  // ── 상태 변경 리스너 ──────────────────────────────────────────
  on(planId, callback) {
    if (!this._listeners.has(planId)) this._listeners.set(planId, []);
    this._listeners.get(planId).push(callback);
  }

  _notify(planId, state) {
    const listeners = this._listeners.get(planId) || [];
    for (const cb of listeners) {
      try { cb({ ...state }); } catch (_) {}
    }
  }

  // ── 태스크 ID로 플랜 상태 추론 ───────────────────────────────
  _inferPlanState(taskId, s) {
    if (/search|find|fetch/i.test(taskId))   return TASK_STATE.SEARCHING;
    if (/analyz|inspect/i.test(taskId))      return TASK_STATE.ANALYZING;
    if (/write|generat|creat/i.test(taskId)) return TASK_STATE.WRITING;
    if (/review|check|verify/i.test(taskId)) return TASK_STATE.REVIEWING;
    if (/plan|design/i.test(taskId))         return TASK_STATE.PLANNING;
    return TASK_STATE.RUNNING;
  }

  // ── 진행률 퍼센트 ─────────────────────────────────────────────
  getProgress(planId) {
    const s = this._states.get(planId);
    if (!s || s.total_steps === 0) return 0;
    return Math.round((s.current_step / s.total_steps) * 100);
  }

  // ── 상태 요약 (API 응답용) ────────────────────────────────────
  getSummary(planId) {
    const s = this._states.get(planId);
    if (!s) return null;
    return {
      planId:      s.planId,
      task_state:  s.task_state,
      current_step: s.current_step,
      total_steps:  s.total_steps,
      progress:    this.getProgress(planId),
      tasks:       s.tasks.map(t => ({ id: t.id, name: t.name, status: t.status })),
      startedAt:   s.startedAt,
      completedAt: s.completedAt,
      error:       s.error,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// § 싱글턴 인스턴스
// ─────────────────────────────────────────────────────────────
const taskStateEngine = new TaskStateEngine();

module.exports = {
  AgentPlanner,
  TaskStateEngine,
  taskStateEngine,
  TASK_STATE,
  TASK_TYPES,
  COMPLEXITY,
};
