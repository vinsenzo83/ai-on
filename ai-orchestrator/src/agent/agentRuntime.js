// ============================================================
// AgentRuntime — STEP 15 + Phase 2: 자율 태스크 모드 + Cost Controller
//              + Phase 3: Failure Replay System
// ============================================================
// 역할:
//   User Input → Intent Analyze → Planner → Skill Selection
//   → Tool Chain Execution → Result Synthesis → Self-Correction
//   → Memory Update → Final Response
//
// Phase 2 추가:
//   - complexity별 execution budget 생성
//   - 실행 시간 초과 시 graceful stop + partial result 반환
//   - KPI에 budget 사용량 기록
//
// Phase 3 추가:
//   - 실패 시 failureStore.captureFailure()로 상세 데이터 저장
// ============================================================

'use strict';

const { AgentPlanner, taskStateEngine, TASK_STATE, COMPLEXITY } = require('./agentPlanner');
const { ToolChainExecutor } = require('./toolChainExecutor');
const { skillLibrary } = require('./skillLibrary');
const costController   = require('./costController');
const failureStore     = require('./failureStore');
const parallelExecutor = require('./parallelExecutor');  // Phase 4

// ─────────────────────────────────────────────────────────────
// § 에이전트 실행 설정
// ─────────────────────────────────────────────────────────────
const AGENT_CONFIG = {
  // Autonomous mode 트리거 조건 (deep + complex)
  AUTONOMOUS_STRATEGIES:   ['deep', 'balanced'],
  AUTONOMOUS_MIN_COMPLEXITY: COMPLEXITY.NORMAL,  // simple은 직접 응답

  // 성능 제한 (Phase 2: costController로 위임, 여기선 하드 상한만)
  MAX_AUTONOMOUS_MS:  90_000,  // 전체 실행 최대 90초 (하드 리밋)
  PLAN_TIMEOUT_MS:    15_000,  // 계획 생성 최대 15초 (LLM 응답 지연 대비 상향)

  // 자율 모드 활성화 태스크 타입 (code는 제외 — 직접 LLM이 더 빠름)
  // [FIX] 자율 모드 활성화 타입 확대 - parallel KPI 0% 개선
  AUTONOMOUS_TASK_TYPES: new Set([
    'analysis', 'report', 'blog', 'research',
    'deep_analysis', 'comprehensive', 'strategy',
    'summarize', 'extract', 'classify', 'unknown',
  ]),

  // 자율 모드 비활성화 태스크 타입
  SKIP_AUTONOMOUS_TYPES: new Set([
    'chat', 'greeting', 'translation', 'tts', 'image',
    'vision', 'stt', 'qrcode', 'ppt_file', 'pdf',
    'excel', 'removebg', 'chat2pdf', 'summarycard',
    'code',  // [FIX #6] code는 balanced/deep 전략이고 복잡 키워드 있을 때만 제외 완화 → 아래 조건으로 처리
  ]),
};

// ─────────────────────────────────────────────────────────────
// § AgentRuntime 클래스
// ─────────────────────────────────────────────────────────────
class AgentRuntime {
  constructor(openaiClient, toolExecutor) {
    this.openai       = openaiClient;
    this.planner      = new AgentPlanner(openaiClient);
    this.chainExec    = new ToolChainExecutor(openaiClient, toolExecutor, taskStateEngine);
    this.stateEngine  = taskStateEngine;
    this.io           = null;  // Socket.IO 인스턴스 (옵션)
  }

  // ── Socket.IO 연결 ────────────────────────────────────────────
  setIO(io) {
    this.io = io;
  }

  // ── 자율 모드 활성화 여부 결정 ───────────────────────────────
  shouldRunAutonomous(strategy, taskType, message) {
    // [FIX #6] code 타입: deep/balanced + 복잡 키워드일 때만 에이전트 사용
    if (taskType === 'code') {
      const codeComplex = /설계|아키텍처|리팩|최적화|분석|비교|단계별|전체|시스템/i;
      return (strategy === 'deep' || strategy === 'balanced') && codeComplex.test(message);
    }
    if (AGENT_CONFIG.SKIP_AUTONOMOUS_TYPES.has(taskType)) return false;
    if (!AGENT_CONFIG.AUTONOMOUS_STRATEGIES.includes(strategy))  return false;

    // 복잡성 키워드 체크
    const complexKeywords = /심층|상세|전문|comprehensive|in-depth|analyze deeply|최신.*분석|검색.*후.*작성|단계별|설계|아키텍처/i;
    // [FIX #7] 30자 기준 제거 - '오늘 날씨 분석해줘'(11자)도 차단되던 문제 수정
    const simpleKeywords  = /^(안녕|하이|hi|hello|고마워|고맙다|감사|응|ㄱㄱ|ㄱㄱㄱ|ㅅㅅ|ㅅㅅㅅ|ㅎㅎ|ㅎㅎㅎ|잘있어|줘봐|ok|okay|네|아니|맞아|올케)$/i;

    // 매우 짧거나 단순한 메시지는 자율 모드 건너뜀
    if (simpleKeywords.test(message)) return false;

    // AUTONOMOUS_TASK_TYPES에 포함된 경우 → 자율 모드
    if (AGENT_CONFIG.AUTONOMOUS_TASK_TYPES.has(taskType)) return true;

    // deep 전략 + 복잡 키워드 → 자율 모드
    if (strategy === 'deep' && complexKeywords.test(message)) return true;

    // deep 전략 + 메시지 80자 이상 + 분석/리서치 키워드 → 자율 모드
    if (strategy === 'deep' && message.length >= 80 && /분석|조사|리서치|리포트|정리|설명해줘/i.test(message)) return true;

    return false;
  }

  // ── 핵심: 자율 태스크 실행 ───────────────────────────────────
  async run(params) {
    const {
      message,
      taskType,
      strategy,
      sessionId,
      systemPrompt,
      selectedModel,
      maxTokens,
      temperature,
      memoryContext,
    } = params;

    const runStart = Date.now();
    console.log(`[AgentRuntime] 자율 실행 시작: "${message.substring(0,60)}" strategy=${strategy} taskType=${taskType}`);

    // ── PHASE 1: 계획 수립 (STEP 10) ─────────────────────────
    this._emit(sessionId, 'agent:planning', { message: '계획 수립 중...', step: 0 });

    let plan;
    try {
      plan = await Promise.race([
        this.planner.createPlan(message, taskType, strategy, {
          memoryHint: memoryContext?.memoryPrompt,
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('plan timeout')), AGENT_CONFIG.PLAN_TIMEOUT_MS)),
      ]);
    } catch (err) {
      console.warn('[AgentRuntime] 계획 실패:', err.message);
      // 폴백: 스킬 라이브러리 기반 계획
      plan = this._buildSkillBasedPlan(message, taskType, strategy);
    }

    console.log(`[AgentRuntime] 계획 완료: ${plan.totalSteps}스텝, 복잡도=${plan.complexity}`);

    // simple 복잡도는 자율 실행 생략 (직접 LLM 응답)
    if (plan.complexity === COMPLEXITY.SIMPLE) {
      console.log('[AgentRuntime] simple 복잡도 — 직접 응답으로 전환');
      return null; // 상위에서 일반 LLM 응답 사용
    }

    // ── Phase 2: execution budget 생성 ───────────────────────
    const budget = costController.createExecutionBudget(plan.complexity);
    console.log(`[CostController] budget 생성: complexity=${plan.complexity}`, budget.limits);

    // ── PHASE 2: 상태 엔진 등록 (STEP 12) ──────────────────────
    const stateObj = this.stateEngine.register(plan);
    this._emit(sessionId, 'agent:plan_ready', {
      planId:     plan.planId,
      totalSteps: plan.totalSteps,
      complexity: plan.complexity,
      tasks:      plan.tasks.map(t => ({ id: t.id, name: t.name, type: t.type })),
      budget:     {
        maxLLMCalls:         budget.limits.maxLLMCalls,
        maxToolCalls:        budget.limits.maxToolCalls,
        maxExecutionTimeMs:  budget.limits.maxExecutionTimeMs,
      },
    });

    // 상태 변경 → Socket emit
    this.stateEngine.on(plan.planId, (state) => {
      this._emit(sessionId, 'agent:state_update', {
        planId:       state.planId,
        task_state:   state.task_state,
        current_step: state.current_step,
        total_steps:  state.total_steps,
        progress:     this.stateEngine.getProgress(state.planId),
      });
    });

    // ── PHASE 3: 툴 체인 실행 (STEP 11 + 13) ────────────────────
    this._emit(sessionId, 'agent:executing', { message: '실행 중...' });

    // Phase 2: 시간 초과 체크용 interval
    const timeCheckInterval = setInterval(() => {
      const timeCheck = costController.checkTimeLimit(budget);
      if (!timeCheck.ok) {
        clearInterval(timeCheckInterval);
        console.warn(`[CostController] 시간 초과 감지 — 체인 진행 중 budget 플래그 설정`);
      }
    }, 5000);

    let chainResult;
    let partialOnTimeout = null;

    try {
      chainResult = await Promise.race([
        this.chainExec.executeChain(plan, systemPrompt, {
          userMessage:   message,
          sessionId,
          maxTokens,
          temperature,
          selectedModel,
          budget,        // Phase 2: budget 전달
          onProgress: (progress) => {
            this._emit(sessionId, 'agent:task_progress', progress);
          },
        }),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error('chain timeout')),
          AGENT_CONFIG.MAX_AUTONOMOUS_MS - (Date.now() - runStart)
        )),
      ]);
    } catch (err) {
      clearInterval(timeCheckInterval);
      console.error('[AgentRuntime] 체인 실행 실패:', err.message);

      // Phase 2: budget 초과인 경우 partial result 수집
      if (budget.isExceeded || err.message === 'chain timeout') {
        if (!budget.isExceeded) {
          costController.checkTimeLimit(budget); // 강제 exceeded 처리
        }
        const stopReason = budget.stopReason || 'max_execution_time_exceeded';
        costController.finalizeBudget(budget);
        costController.recordPartialResult();

        // Phase 3: 실패 기록 저장
        failureStore.captureFailure({
          planId:           plan.planId,
          sessionId,
          userMessage:      message,
          strategy,
          model:            selectedModel,
          complexity:       plan.complexity,
          plan,
          tasks:            plan.tasks,
          taskStates:       this.stateEngine.getSummary(plan.planId),
          toolCalls:        null,
          correctionRounds: budget.correctionRounds,
          finalError:       err.message,
          errorType:        'budget_exceeded',
          budget:           costController.getBudgetSummary(budget),
          partialResult:    null,
        });

        // partial result 프론트 알림
        this._emit(sessionId, 'agent:budget_exceeded', {
          reason:  stopReason,
          message: costController.buildBudgetExceededResult(stopReason).message,
          budget:  costController.getBudgetSummary(budget),
        });

        this.stateEngine.updatePlanState(plan.planId, TASK_STATE.FAILED);
        return null; // 폴백으로 일반 LLM 사용
      }

      // Phase 3: 일반 chain 오류 기록
      failureStore.captureFailure({
        planId:           plan.planId,
        sessionId,
        userMessage:      message,
        strategy,
        model:            selectedModel,
        complexity:       plan.complexity,
        plan,
        tasks:            plan.tasks,
        taskStates:       this.stateEngine.getSummary(plan.planId),
        toolCalls:        null,
        correctionRounds: budget.correctionRounds,
        finalError:       err.message,
        errorType:        'chain_error',
        budget:           costController.getBudgetSummary(budget),
        partialResult:    null,
      });

      this.stateEngine.updatePlanState(plan.planId, TASK_STATE.FAILED);
      return null;
    }

    clearInterval(timeCheckInterval);

    // ── Phase 2: chain 완료 후 budget 초과 여부 확인 ─────────
    if (chainResult?.isBudgetStop) {
      // ToolChainExecutor가 budget stop 결과를 반환한 경우
      const stopReason = chainResult.reason || budget.stopReason;
      costController.finalizeBudget(budget);
      costController.recordPartialResult();

      const partial = chainResult.partialResult;

      // Phase 3: budget stop 실패 기록
      failureStore.captureFailure({
        planId:           plan.planId,
        sessionId,
        userMessage:      message,
        strategy,
        model:            selectedModel,
        complexity:       plan.complexity,
        plan,
        tasks:            plan.tasks,
        taskStates:       this.stateEngine.getSummary(plan.planId),
        toolCalls:        chainResult.chainLog,
        correctionRounds: budget.correctionRounds,
        finalError:       stopReason,
        errorType:        'budget_exceeded',
        budget:           costController.getBudgetSummary(budget),
        partialResult:    (typeof partial === 'string' ? partial : null),
      });

      this._emit(sessionId, 'agent:budget_exceeded', {
        reason:  stopReason,
        message: costController.buildBudgetExceededResult(stopReason).message,
        budget:  costController.getBudgetSummary(budget),
      });

      if (partial && typeof partial === 'string' && partial.length >= 20) {
        const totalMs = Date.now() - runStart;
        this._emit(sessionId, 'agent:complete', {
          planId:      plan.planId,
          totalMs,
          corrections: 0,
          isPartial:   true,
        });
        return {
          content:      partial,
          planId:       plan.planId,
          plan:         plan,
          chainLog:     chainResult.chainLog || [],
          corrections:  [],
          stateSummary: this.stateEngine.getSummary(plan.planId),
          totalMs,
          isAgentMode:  true,
          isPartial:    true,
          budgetSummary: costController.getBudgetSummary(budget),
        };
      }
      this.stateEngine.updatePlanState(plan.planId, TASK_STATE.FAILED);
      return null;
    }

    // ── PHASE 4: 결과 수집 ────────────────────────────────────────
    const finalResponse = chainResult.finalResult;
    if (!finalResponse || (typeof finalResponse === 'string' && finalResponse.length < 20)) {
      console.warn('[AgentRuntime] 유효하지 않은 결과, 폴백');
      costController.finalizeBudget(budget);
      return null;
    }

    const totalMs = Date.now() - runStart;
    console.log(`[AgentRuntime] 완료: ${totalMs}ms, 교정=${chainResult.corrections.length}회, 체인=${chainResult.chainLog.length}스텝`);
    console.log(`[CostController] 사용량: llm=${budget.llmCalls} tool=${budget.toolCalls} tokens=${budget.totalTokens} ms=${totalMs}`);

    // Phase 2: budget KPI 기록
    costController.finalizeBudget(budget);

    this._emit(sessionId, 'agent:complete', {
      planId:     plan.planId,
      totalMs,
      corrections: chainResult.corrections.length,
      budget:     costController.getBudgetSummary(budget),
      parallel:   parallelExecutor.getParallelKPI(),  // Phase 4
    });

    return {
      content:     typeof finalResponse === 'string' ? finalResponse : JSON.stringify(finalResponse, null, 2),
      planId:      plan.planId,
      plan:        plan,
      chainLog:    chainResult.chainLog,
      corrections: chainResult.corrections,
      stateSummary: this.stateEngine.getSummary(plan.planId),
      totalMs,
      isAgentMode: true,
      budgetSummary:   costController.getBudgetSummary(budget),
      parallelSummary: parallelExecutor.getParallelKPI(), // Phase 4
    };
  }

  // ── 스킬 기반 계획 (LLM 플래너 폴백) ────────────────────────
  _buildSkillBasedPlan(message, taskType, strategy) {
    const skill = skillLibrary.selectSkill(message, taskType, strategy);
    const tasks = skillLibrary.buildTasks(skill);
    return {
      planId:      `plan_skill_${Date.now()}`,
      message:     message.substring(0, 100),
      taskType,
      complexity:  strategy === 'deep' ? COMPLEXITY.COMPLEX : COMPLEXITY.NORMAL,
      reasoning:   `스킬 기반 계획: ${skill.name}`,
      tasks,
      totalSteps:  tasks.length,
      currentStep: 0,
      task_state:  TASK_STATE.PLANNING,
      planMs:      0,
      createdAt:   new Date().toISOString(),
    };
  }

  // ── Socket.IO emit (없으면 콘솔 로그) ───────────────────────
  _emit(sessionId, event, data) {
    if (this.io) {
      try {
        this.io.to(sessionId).emit(event, data);
      } catch (_) {}
    }
    // 개발 디버그 로그
    if (process.env.AGENT_DEBUG === 'true') {
      console.log(`[AgentEmit] ${event}:`, JSON.stringify(data).substring(0, 120));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// § 팩토리 함수
// ─────────────────────────────────────────────────────────────
function createAgentRuntime(openaiClient, toolExecutor) {
  return new AgentRuntime(openaiClient, toolExecutor);
}

module.exports = {
  AgentRuntime,
  createAgentRuntime,
  AGENT_CONFIG,
  taskStateEngine,
};
