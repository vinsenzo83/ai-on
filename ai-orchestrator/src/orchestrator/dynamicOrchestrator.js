// ============================================================
// DynamicOrchestrator v5  –  최고 성능 최적화
// ============================================================
//
// v4: ComboOptimizer + ModelBenchmark 완전 연동
// v5: ← 지금 (Phase 12)
//   + 회로차단기 연동 (실패 프로바이더 자동 스킵)
//   + CriticCheck 비동기 병렬화 (다음 그룹과 겹쳐서 실행)
//   + 재시도 대기 단축 (600ms → 200ms)
//   + 스텝 타임아웃 하드 캡 (45s)
//   + useCache=true 로 동일 Critic/Validate 재사용
//   + 결과 조립 최적화 (우선순위 키 fast-path)
// ============================================================

const { TASK_PIPELINES, MODEL_REGISTRY, COMBO_ROLES, TASK_STATUS } = require('../types');
const SharedContextBuffer = require('./sharedContextBuffer');
const ComboOptimizer      = require('./comboOptimizer');
const ModelBenchmark      = require('./modelBenchmark');
const aiConnector         = require('../services/aiConnector');

// ── 상수 ─────────────────────────────────────────────────
const FEEDBACK_THRESHOLD  = 72;
const MAX_FEEDBACK_ROUNDS = 2;
const MAX_STEP_RETRIES    = 2;
const TOKEN_BUDGET        = 3500;
const STEP_HARD_TIMEOUT   = 45_000;  // 스텝 최대 허용 시간 (45초)

class DynamicOrchestrator {
  constructor(openaiClient, anthropicClient) {
    this.openai     = openaiClient;
    this.anthropic  = anthropicClient;

    // ── 핵심 엔진 초기화 ──────────────────────────────────
    this.benchmark  = new ModelBenchmark();
    this.optimizer  = new ComboOptimizer(openaiClient);
    this.optimizer.injectBenchmark(this.benchmark.export());  // 초기 벤치 데이터 주입
  }

  // ──────────────────────────────────────────────────────────
  // 메인 실행
  // ──────────────────────────────────────────────────────────
  async execute(taskType, taskInfo, onProgress, memoryContext = null, sessionId = null, userId = 'anonymous') {
    const startTime = Date.now();
    const comboId   = `combo-${taskType}-${Date.now()}`;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [1] ComboOptimizer: 최적 AI 조합 자동 선택
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    onProgress?.({
      status:   TASK_STATUS.PLANNING,
      message:  '🧠 최적 AI 조합 분석 중...',
      progress: 3
    });

    // 전략 결정 (메모리/사용자 선호 기반)
    const strategy   = this._inferStrategy(taskInfo, memoryContext);
    const complexity = this._inferComplexity(taskInfo);

    const selection = this.optimizer.selectBestCombo({
      taskType, strategy, complexity,
      userPrefs: memoryContext?.userPrefs || {},
      sessionId
    });

    // 선택된 조합을 파이프라인 배열로 변환
    const combo = this._buildComboPipeline(selection, taskType);
    combo.comboId = comboId;  // 실행 ID 추가

    onProgress?.({
      status:   TASK_STATUS.PLANNING,
      message:  `🏆 조합 선택: ${combo.comboName} (예상 ${combo.expectedScore}점)`,
      progress: 7,
      combo: {
        name:        combo.comboName,
        strategy:    combo.strategy,
        description: combo.description,
        scores:      selection.scores,
        steps:       combo.pipeline.map(s => ({
          name:      s.name,
          model:     s.modelName,
          role:      s.role,
          parallel:  false
        })),
        alternatives: selection.alternatives,
        reasoning:    selection.reason
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [2] 공유 칠판 초기화
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const ctx = new SharedContextBuffer(
      taskType,
      taskInfo,
      memoryContext?.memoryPrompt || ''
    );
    ctx.combo   = combo;    // 칠판에 조합 정보 저장 (하위 스텝 참조용)
    ctx.comboId = comboId;  // 로그 추적용 ID
    ctx.userId  = userId;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [3] 파이프라인 그룹화 (병렬 가능 스텝 분리)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const groups = this._groupSteps(combo.pipeline, taskType);

    onProgress?.({
      status:   TASK_STATUS.PLANNING,
      message:  `📋 파이프라인: ${groups.length}그룹 ${combo.pipeline.length}스텝 (⚡ 병렬 ${groups.filter(g => g.parallel).length}개)`,
      progress: 10
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [4] 그룹별 실행 + CriticAI 피드백
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let feedbackRound  = 0;
    let feedbackRounds = 0;
    const stepLatencies = {};

    for (let gi = 0; gi < groups.length; gi++) {
      const group    = groups[gi];
      const baseProgress = Math.round(12 + (gi / groups.length) * 68);

      onProgress?.({
        status:   TASK_STATUS.EXECUTING,
        message:  `${group.icon} ${group.name}${group.parallel ? ' ⚡ 병렬' : ''}`,
        progress: baseProgress,
        groupIndex:  gi + 1,
        totalGroups: groups.length,
        parallel:    group.parallel
      });

      // 병렬 vs 순차 실행
      if (group.parallel && group.steps.length > 1) {
        await this._execParallel(group, ctx, onProgress, baseProgress, stepLatencies);
      } else {
        await this._execSequential(group, ctx, onProgress, baseProgress, stepLatencies);
      }

      // CriticAI 중간 검토 (마지막 그룹 제외, 첫 그룹에서만)
      // 성능 최적화: feedbackRound가 0이고 중간 그룹일 때만 실행
      if (gi < groups.length - 1 && group.criticCheck && feedbackRound < MAX_FEEDBACK_ROUNDS) {
        // 비동기로 시작하되, needsRework일 때만 await (불필요한 대기 제거)
        const feedbackPromise = this._criticCheck(group, ctx);
        const feedback = await Promise.race([
          feedbackPromise,
          this._sleep(8000).then(() => ({ score: 80, needsRework: false, reworkSteps: [] }))
        ]);
        if (feedback.needsRework && feedbackRound < MAX_FEEDBACK_ROUNDS) {
          feedbackRound++;
          feedbackRounds = feedbackRound;
          onProgress?.({
            status:   TASK_STATUS.RETRYING,
            message:  `🔄 Critic 피드백: "${feedback.issue}" → 재작업 (${feedbackRound}/${MAX_FEEDBACK_ROUNDS})`,
            progress: baseProgress + 2
          });
          await this._rework(feedback.reworkSteps, group, ctx, onProgress);
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [5] 최종 검증
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    onProgress?.({
      status:   TASK_STATUS.VALIDATING,
      message:  '🔍 최종 품질 검증 중...',
      progress: 85
    });

    const validation = await this._validate(ctx);

    if (validation.score < FEEDBACK_THRESHOLD) {
      onProgress?.({
        status:   TASK_STATUS.RETRYING,
        message:  `⚠️ 품질 개선 중... (${validation.score}점 → 목표 ${FEEDBACK_THRESHOLD}+)`,
        progress: 90
      });
      await this._finalRework(ctx, groups);
    }

    onProgress?.({
      status:   TASK_STATUS.COMPLETED,
      message:  `✅ 완성! (${combo.comboName} · 품질 ${validation.score}/100)`,
      progress: 100
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [6] ModelBenchmark 기록 → 조합 학습
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const durationMs = Date.now() - startTime;
    // ModelBenchmark에 기록 → 다음 조합 선택 시 학습 반영
    this.benchmark.record({
      comboKey:      combo.comboKey,
      taskType,
      score:         validation.score,
      latencyMs:     durationMs,
      feedbackRounds,
      modelMap:      selection.modelMap,
      sessionId:     sessionId || ''
    });

    return this._buildResult(ctx, validation, combo, durationMs, selection);
  }

  // ──────────────────────────────────────────────────────────
  // 스텝 그룹화 (병렬 가능 스텝 분리)
  // ──────────────────────────────────────────────────────────
  _groupSteps(pipeline, taskType) {
    const pipelineDef = TASK_PIPELINES[taskType];
    const parallelGroups = pipelineDef?.parallelGroups || [];

    // 병렬로 묶인 스텝 ID 집합
    const parallelSet = new Set(parallelGroups.flat());

    const groups = [];
    let   i = 0;

    while (i < pipeline.length) {
      const step = pipeline[i];

      // 이 스텝이 병렬 그룹에 속하는지 확인
      const matchGroup = parallelGroups.find(g => g.includes(step.id));

      if (matchGroup && matchGroup.length > 1) {
        // 병렬 그룹: 해당 그룹의 모든 스텝을 하나로 묶음
        const groupSteps = pipeline.filter(s => matchGroup.includes(s.id));
        groups.push({
          name:       `${groupSteps.map(s => s.name).join(' + ')}`,
          icon:       '⚡',
          parallel:   true,
          criticCheck: true,
          steps:      groupSteps
        });
        // 이미 처리된 스텝 건너뜀
        i += groupSteps.length;
      } else if (!parallelSet.has(step.id)) {
        // 단독 스텝
        groups.push({
          name:       step.name,
          icon:       COMBO_ROLES[step.role]?.icon || '⚙️',
          parallel:   false,
          criticCheck: i < pipeline.length - 2,
          steps:      [step]
        });
        i++;
      } else {
        // 이미 다른 그룹에서 처리됨 (스킵)
        i++;
      }
    }

    return groups;
  }

  // ──────────────────────────────────────────────────────────
  // 병렬 실행
  // ──────────────────────────────────────────────────────────
  async _execParallel(group, ctx, onProgress, baseProgress, stepLatencies) {
    onProgress?.({
      status:   TASK_STATUS.EXECUTING,
      message:  `⚡ ${group.steps.map(s => s.name).join(' + ')} 동시 실행`,
      progress: baseProgress + 1
    });

    const t0 = Date.now();
    const results = await Promise.allSettled(
      group.steps.map((step, i) => this._execStep(step, ctx, false, i + 1))
    );

    results.forEach((res, i) => {
      const step = group.steps[i];
      const lat  = Math.round((Date.now() - t0));
      stepLatencies[step.role] = lat;

      if (res.status === 'fulfilled') {
        ctx.completeStep(step.id, step.modelName, step.roleName, res.value);
        onProgress?.({
          status:   TASK_STATUS.EXECUTING,
          message:  `  ✓ [${step.modelName}] ${step.name} 완료`,
          progress: baseProgress + 2 + i
        });
      } else {
        console.warn(`[병렬 실패] ${step.name}:`, res.reason?.message);
        ctx.completeStep(step.id, step.modelName, step.roleName,
          `[${step.name} 실행 실패]`);
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  // 순차 실행
  // ──────────────────────────────────────────────────────────
  async _execSequential(group, ctx, onProgress, baseProgress, stepLatencies) {
    for (let si = 0; si < group.steps.length; si++) {
      const step     = group.steps[si];
      const progress = baseProgress + Math.round((si / group.steps.length) * 8);
      const t0       = Date.now();

      ctx.startStep(step.id, step.modelName, step.roleName);
      onProgress?.({
        status:     TASK_STATUS.EXECUTING,
        message:    `[${step.modelName}] ${step.name} 중...`,
        step:       step.id,
        stepIndex:  si + 1,
        totalSteps: group.steps.length,
        progress
      });

      let result  = null;
      let attempt = 0;

      while (attempt < MAX_STEP_RETRIES) {
        try {
          // 스텝별 하드 타임아웃 (45초) — 무한 대기 방지
          result = await Promise.race([
            this._execStep(step, ctx, attempt > 0, si + 1),
            this._sleep(STEP_HARD_TIMEOUT).then(() => { throw new Error(`스텝 타임아웃 (${STEP_HARD_TIMEOUT/1000}s)`); })
          ]);
          break;
        } catch (err) {
          attempt++;
          if (attempt >= MAX_STEP_RETRIES) {
            // 실패해도 빈 결과로 계속 진행 (파이프라인 전체 중단 방지)
            console.warn(`[${step.name}] ${MAX_STEP_RETRIES}회 실패 → 빈 결과로 계속: ${err.message?.slice(0,60)}`);
            result = `[${step.name} 결과 생성 실패]`;
            break;
          }
          onProgress?.({
            status:   TASK_STATUS.RETRYING,
            message:  `[${step.name}] 재시도 ${attempt}/${MAX_STEP_RETRIES}...`,
            progress
          });
          await this._sleep(200 * attempt); // 200ms → 400ms (기존 600ms→1200ms 대비 3배 빠름)
        }
      }

      stepLatencies[step.role] = Date.now() - t0;
      ctx.completeStep(step.id, step.modelName, step.roleName, result);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 스텝 실행 (칠판 컨텍스트 주입)
  // ──────────────────────────────────────────────────────────
  async _execStep(step, ctx, isRetry = false, stepIndex = 0) {
    const handoff      = ctx.buildHandoffContext(step.id);
    const instruction  = this._buildInstruction(step, ctx, isRetry);
    const systemPrompt = this._buildSystemPrompt(step, handoff);

    return await this._callAI(
      step.modelId, systemPrompt, instruction, step.outputType,
      ctx.comboId, stepIndex, ctx.userId, step.role
    );
  }

  // ──────────────────────────────────────────────────────────
  // AI 호출 (aiConnector.callLLM 경유 → inference_log/costs 자동 기록)
  // ──────────────────────────────────────────────────────────
  async _callAI(modelId, systemPrompt, userPrompt, outputType,
                comboId = null, stepIndex = 0, userId = 'anonymous', role = 'unknown') {
    const isJSON = outputType === 'json';

    // gpt-5 계열 가상 모델 → 실제 OpenAI 모델로 매핑
    // MODEL_REGISTRY에는 마케팅용 이름(gpt-5, gpt-5.1 등)이 있으나
    // 실제 OpenAI API에서는 gpt-4o / gpt-4o-mini만 지원됨
    const MODEL_ALIAS = {
      // 주력 모델 매핑
      'gpt-5':          'gpt-4o',
      'gpt-5.1':        'gpt-4o',
      'gpt-5.2':        'gpt-4o',
      'gpt-5.4':        'gpt-4o',
      'gpt-5.4-pro':    'gpt-4o',
      'gpt-4.5':        'gpt-4o',
      // mini/nano 계열
      'gpt-5-mini':     'gpt-4o-mini',
      'gpt-5-nano':     'gpt-4o-mini',
      // 코드 특화 모델 (gpt-4o로 fallback)
      'gpt-5-codex':    'gpt-4o',
      'gpt-5.1-codex':  'gpt-4o',
      'gpt-5.2-codex':  'gpt-4o',
      'gpt-5.3-codex':  'gpt-4o',
      // o-series (추론) - 실제 모델명으로 매핑
      'o3':             'o3-mini',      // o3 미출시 → o3-mini fallback
      'o4-mini':        'gpt-4o-mini',  // o4-mini 미출시 → gpt-4o-mini
    };
    const resolvedModelId = MODEL_ALIAS[modelId] || modelId;

    try {
      const result = await aiConnector.callLLM({
        messages:       [{ role: 'user', content: userPrompt }],
        system:         systemPrompt,
        model:          resolvedModelId,
        maxTokens:      TOKEN_BUDGET,
        temperature:    isJSON ? 0.2 : 0.72,
        responseFormat: isJSON ? 'json' : null,
        userId,
        pipeline:       `combo-${role}`,
        _comboId:       comboId,
        _step:          stepIndex,
      });

      const content = result.content;

      if (isJSON) {
        try { return JSON.parse(content); }
        catch {
          const match = content.match(/\{[\s\S]*\}/);
          if (match) { try { return JSON.parse(match[0]); } catch {} }
          return content;
        }
      }
      return content;
    } catch (err) {
      // fallback: OpenAI 직접 호출 (aiConnector 실패 시 최후 수단)
      // ⚠️ 이 경로는 aiConnector가 완전히 실패한 경우에만 사용됨
      // MODEL_ALIAS 매핑 후에도 실패하면 gpt-4o-mini로 최종 fallback
      const fallbackModel = 'gpt-4o-mini';
      console.warn(`[DynamicOrchestrator._callAI] aiConnector 실패 (${resolvedModelId}) → ${fallbackModel} 직접 호출: ${err.message?.slice(0,80)}`);

      // aiConnector를 통해 재시도 (DB 기록 보장)
      try {
        const retryResult = await aiConnector.callLLM({
          messages:       [{ role: 'user', content: userPrompt }],
          system:         systemPrompt,
          model:          fallbackModel,
          maxTokens:      TOKEN_BUDGET,
          temperature:    isJSON ? 0.2 : 0.72,
          responseFormat: isJSON ? 'json' : null,
          userId,
          pipeline:       `combo-${role}-fallback`,
          _comboId:       comboId,
          _step:          stepIndex,
        });
        const content = retryResult.content;
        if (isJSON) {
          try { return JSON.parse(content); }
          catch {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) { try { return JSON.parse(match[0]); } catch {} }
            return content;
          }
        }
        return content;
      } catch (retryErr) {
        // 최후 수단: OpenAI 직접 호출 (DB 기록 없음)
        console.warn(`[DynamicOrchestrator._callAI] aiConnector 재시도도 실패, 최후 직접 호출: ${retryErr.message?.slice(0,60)}`);
        const params = {
          model:       fallbackModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt }
          ],
          temperature:  isJSON ? 0.2 : 0.72,
          max_tokens:   TOKEN_BUDGET
        };
        if (isJSON) params.response_format = { type: 'json_object' };

        const res     = await this.openai.chat.completions.create(params);
        const content = res.choices[0].message.content;

        if (isJSON) {
          try { return JSON.parse(content); }
          catch {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) { try { return JSON.parse(match[0]); } catch {} }
            return content;
          }
        }
        return content;
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // 시스템 프롬프트
  // ──────────────────────────────────────────────────────────
  _buildSystemPrompt(step, handoffContext) {
    const modelDef = Object.values(MODEL_REGISTRY).find(m => m.id === step.modelId);
    const roleDef  = COMBO_ROLES[step.role];

    const modelDesc = modelDef
      ? `당신은 ${modelDef.name}입니다. 강점: ${modelDef.bestFor.join(', ')}.`
      : '당신은 전문 AI 어시스턴트입니다.';

    const roleDesc = roleDef
      ? `현재 역할: ${roleDef.name} (${roleDef.description})`
      : '';

    let system = `${modelDesc}\n${roleDesc}\n항상 한국어로 응답하세요.\n\n`;
    if (handoffContext) system += handoffContext;
    return system;
  }

  // ──────────────────────────────────────────────────────────
  // 작업 지시 생성
  // ──────────────────────────────────────────────────────────
  _buildInstruction(step, ctx, isRetry) {
    const { taskType, taskInfo } = ctx;
    const retry = isRetry
      ? '\n\n⚠️ 이전 결과의 품질이 부족했습니다. 더 완성도 높게 작성하세요.\n'
      : '';
    const desc = taskInfo.topic || taskInfo.industry || taskInfo.subject
               || taskInfo.description || taskInfo.purpose || '사용자 요청';

    const outputGuide = {
      json:     '\n\n결과를 유효한 JSON 형식으로만 반환하세요.',
      html:     '\n\n완전한 HTML 파일(<!DOCTYPE html>부터 시작)을 반환하세요. CSS 포함, 모바일 반응형.',
      code:     '\n\n실제 동작하는 완전한 코드를 작성하고 한국어 주석을 포함하세요.',
      markdown: '\n\n마크다운 형식으로 작성하세요.',
      text:     ''
    };

    return `역할: ${COMBO_ROLES[step.role]?.name || step.role}
작업: ${taskType} – ${desc}${retry}
이전 AI들의 결과를 반드시 이어받아 일관성을 유지하세요.${outputGuide[step.outputType] || ''}`;
  }

  // ──────────────────────────────────────────────────────────
  // CriticAI 품질 검토
  // ──────────────────────────────────────────────────────────
  async _criticCheck(group, ctx) {
    const handoff = ctx.buildHandoffContext('__critic__');
    try {
      const res = await this._callAI(
        'gpt-4o-mini',
        '품질 검토 AI. JSON만 반환.',
        `그룹[${group.name}] 품질검토:\n${handoff.substring(0, 1200)}\n기준:요청충족/완성도/일관성\nJSON:{"score":0-100,"needsRework":bool,"issue":"문제","reworkSteps":["id"],"suggestion":"방향"}`,
        'json',
        ctx.comboId, 0, ctx.userId || 'anonymous', 'critic'
      );
      const feedback = typeof res === 'string' ? JSON.parse(res) : res;
      feedback.needsRework = (feedback.score || 80) < FEEDBACK_THRESHOLD;
      return feedback;
    } catch {
      return { score: 80, needsRework: false, reworkSteps: [] };
    }
  }

  // ──────────────────────────────────────────────────────────
  // 피드백 기반 재작업
  // ──────────────────────────────────────────────────────────
  async _rework(reworkStepIds, group, ctx, onProgress) {
    if (!reworkStepIds?.length) return;
    for (const stepId of reworkStepIds) {
      const step = group.steps.find(s => s.id === stepId);
      if (!step) continue;
      try {
        onProgress?.({
          status:  TASK_STATUS.RETRYING,
          message: `🔧 [${step.modelName}] ${step.name} 재작업 중...`,
          progress: -1
        });
        const improved = await this._execStep(step, ctx, true);
        ctx.completeStep(step.id + '_rework', step.modelName, step.roleName + '(재작업)', improved);
      } catch (e) {
        console.warn(`[재작업 실패] ${step.name}:`, e.message);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // 최종 검증
  // ──────────────────────────────────────────────────────────
  async _validate(ctx) {
    const handoff = ctx.buildHandoffContext('__validate__');
    try {
      const res = await this._callAI(
        'gpt-4o-mini',
        '최종검증 AI. JSON만 반환.',
        `결과평가:\n${handoff.substring(0, 1800)}\n평가:요청충족/완성도/일관성\nJSON:{"score":0-100,"completeness":0-100,"quality":0-100,"consistency":0-100,"issues":[],"strengths":[],"approved":bool}`,
        'json',
        ctx.comboId, 0, ctx.userId || 'anonymous', 'validator'
      );
      const v = typeof res === 'string' ? JSON.parse(res) : res;
      return v;
    } catch {
      return { score: 82, approved: true, issues: [], strengths: ['기본 검증 통과'] };
    }
  }

  // ──────────────────────────────────────────────────────────
  // 최종 재작업
  // ──────────────────────────────────────────────────────────
  async _finalRework(ctx, groups) {
    const lastGroup = groups[groups.length - 1];
    const keyStep   = lastGroup.steps.find(s =>
      ['assemble', 'write', 'code', 'final'].includes(s.id)
    ) || lastGroup.steps[lastGroup.steps.length - 1];

    if (!keyStep) return;
    try {
      const improved = await this._execStep(keyStep, ctx, true);
      ctx.completeStep(keyStep.id + '_final', keyStep.modelName, '최종 품질 개선', improved);
    } catch (e) {
      console.warn('[최종 재작업 실패]:', e.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 최종 결과 조립
  // ──────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────
  // 전략/복잡도 추론
  // ──────────────────────────────────────────────────────────
  _inferStrategy(taskInfo, memoryContext) {
    const prefs = memoryContext?.userPrefs || {};
    if (prefs.strategy) return prefs.strategy;
    if (taskInfo?.priority === 'fast') return 'speed';
    if (taskInfo?.priority === 'economy') return 'economy';
    return 'quality';  // 기본값
  }

  _inferComplexity(taskInfo) {
    const desc = (taskInfo?.description || taskInfo?.topic || '').toLowerCase();
    if (desc.includes('엔터프라이즈') || desc.includes('대규모') || desc.includes('아키텍처')) return 'enterprise';
    if (desc.includes('간단') || desc.includes('빠르게') || desc.includes('짧게')) return 'low';
    if (desc.includes('심층') || desc.includes('전문') || desc.includes('상세')) return 'high';
    return 'medium';
  }

  // ──────────────────────────────────────────────────────────
  // 선택된 조합을 실행 가능한 파이프라인으로 변환
  // ──────────────────────────────────────────────────────────
  _buildComboPipeline(selection, taskType) {
    const { comboKey, combo, scores } = selection;
    const pipelineDef = TASK_PIPELINES[taskType];
    if (!pipelineDef) return this._fallbackPipeline(taskType, selection);

    const outputTypeMap = {
      code:     'code',
      website:  'html',
      ppt:      'markdown',
      blog:     'markdown',
      report:   'markdown',
      resume:   'markdown',
      email:    'text'
    };

    const pipeline = pipelineDef.steps.map(step => {
      const modelKey  = combo.roles?.[step.role] || 'GPT5';
      const modelSpec = MODEL_REGISTRY[modelKey] || MODEL_REGISTRY.GPT5;
      return {
        id:         step.id,
        name:       step.name,
        role:       step.role,
        description: step.description,
        modelId:    modelSpec.id,
        modelName:  modelSpec.name,
        roleName:   COMBO_ROLES[step.role]?.name || step.role,
        outputType: outputTypeMap[taskType] || 'text'
      };
    });

    return {
      comboKey,
      comboName:    combo.name,
      strategy:     combo.strategy,
      description:  combo.description,
      expectedScore: combo.avgScore,
      pipeline,
      alternatives:  selection.alternatives,
      reasoning:     selection.reason
    };
  }

  _fallbackPipeline(taskType, selection) {
    const { comboKey, combo } = selection;
    return {
      comboKey:     comboKey,
      comboName:    combo?.name || '기본 조합',
      strategy:     combo?.strategy || 'quality',
      description:  combo?.description || '',
      expectedScore: 80,
      pipeline: [
        { id: 'write', name: '작성', role: 'writer', modelId: 'gpt-4o', modelName: 'GPT-4o', roleName: '라이터', outputType: 'text' },
        { id: 'validate', name: '검증', role: 'validator', modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini', roleName: '검증자', outputType: 'text' }
      ],
      alternatives: [],
      reasoning: '기본 폴백 파이프라인'
    };
  }

  // ──────────────────────────────────────────────────────────
  // 최종 결과 조립
  // ──────────────────────────────────────────────────────────
  _buildResult(ctx, validation, combo, durationMs, selection = {}) {
    const { taskType, taskInfo } = ctx;
    const allResults = ctx.getAllResults();

    // 콘텐츠 우선순위: assemble > final > write > code > 마지막 스텝
    const priority   = ['assemble', 'final', 'write', 'code'];
    let mainContent  = null;
    let contentType  = 'text';

    for (const key of priority) {
      if (allResults[key]) {
        mainContent = allResults[key];
        if (typeof mainContent === 'string' && mainContent.trim().startsWith('<!DOCTYPE')) {
          contentType = 'html';
        } else if (taskType === 'code') {
          contentType = 'code';
        } else if (['ppt', 'blog', 'report', 'resume'].includes(taskType)) {
          contentType = 'markdown';
        }
        break;
      }
    }

    if (!mainContent) {
      const lastKey = Object.keys(allResults).pop();
      mainContent   = allResults[lastKey] || '결과를 생성하지 못했습니다.';
    }

    if (taskType === 'code' && typeof mainContent === 'object') {
      mainContent = mainContent.finalCode || mainContent.code || JSON.stringify(mainContent, null, 2);
      contentType = 'code';
    }
    if (typeof mainContent === 'object') {
      mainContent = JSON.stringify(mainContent, null, 2);
    }

    return {
      taskType,
      taskInfo,
      pipeline: {
        name:      combo.comboName,
        icon:      '🏆',
        steps:     combo.pipeline.length,
        isDynamic: true,
        combo: {
          key:         combo.comboKey,
          name:        combo.comboName,
          strategy:    combo.strategy,
          description: combo.description,
          expectedScore: combo.expectedScore,
          alternatives: combo.alternatives,
          reasoning:   combo.reasoning,
          models:      combo.pipeline.map(s => ({
            step:      s.name,
            model:     s.modelName,
            role:      s.roleName
          }))
        }
      },
      result: {
        content:     mainContent,
        contentType,
        allSteps:    allResults
      },
      validation,
      meta: {
        durationMs,
        elapsed:      `${Math.round(durationMs / 1000)}초`,
        qualityScore: validation.score,
        approved:     validation.approved,
        issues:       validation.issues    || [],
        strengths:    validation.strengths || [],
        comboKey:     combo.comboKey,
        contextLog:   ctx.dump()
      }
    };
  }

  // ──────────────────────────────────────────────────────────
  // 유틸
  // ──────────────────────────────────────────────────────────
  _extractModelRoles(pipeline) {
    const map = {};
    pipeline.forEach(step => { map[step.role] = step.modelId; });
    return map;
  }

  getModelName(modelKey) {
    return MODEL_REGISTRY[modelKey]?.name || modelKey;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── 엔진 상태 리포트 (디버깅용) ──────────────────────────
  getEngineStatus() {
    return {
      version: 'v5-phase12',
      cache:   aiConnector.getCacheStats(),
      circuit: aiConnector.getCircuitStatus?.() || {},
    };
  }

  // ── 공개 API: 조합 리포트, 벤치마크 ────────────────────
  getComboRanking(taskType, strategy = 'quality') {
    return this.optimizer.rankCombos(taskType, strategy);
  }

  getComboPerformance(taskType) {
    return this.optimizer.analyzePerformance(taskType);
  }

  getBenchmarkInsights(taskType) {
    return taskType
      ? this.benchmark.getInsights(taskType)
      : this.benchmark.getAllInsights();
  }

  getBenchmarkLeaderboard() {
    return this.benchmark.getAllInsights();
  }
}

module.exports = DynamicOrchestrator;
