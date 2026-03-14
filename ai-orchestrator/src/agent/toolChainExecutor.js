// ============================================================
// ToolChainExecutor — STEP 11 + Phase 2 + Phase 4 + Phase 5
// 멀티 툴 체인 + Cost Controller + 병렬 실행 + Search Engine
// ============================================================
// 기능:
//   search → extract → summarize → analyze → generate document
//   각 툴 결과가 다음 툴의 입력으로 전달 (컨텍스트 누적)
//
// Phase 2: Cost Controller (budget tracking, graceful stop)
// Phase 3: Failure Recorder (failureStore 연동)
// Phase 4: Parallel Execution (parallelExecutor 위임)
//   - groupParallelizableTasks → 의존성 기반 웨이브 분리
//   - runParallelGroup → Promise.allSettled 병렬 실행
//   - mergeParallelResults → dedupe + ranking + normalize
//   - PARALLELIZABLE_TYPES: SEARCH, EXTRACT, TOOL, DATA_FETCH
//   - SEQUENTIAL_ONLY_TYPES: WRITE, SYNTHESIZE, PLAN, CODE, REVIEW
//   - max_parallel_tools = 3 (최대 5)
//   - 병렬 실패 → 전체 중단 없음 (Rule 4)
// Phase 5: Search Engine (Brave → SerpAPI → DDG fallback)
// ============================================================

'use strict';

const { TASK_STATE, TASK_TYPES } = require('./agentPlanner');
const costController     = require('./costController');     // Phase 2
const cacheLayer         = require('./cacheLayer');         // Phase 6: 캐시
const failureStore       = require('./failureStore');       // Phase 3: 실패 기록
const searchEngine       = require('./searchEngine');       // Phase 5: 멀티 프로바이더 검색
const parallelExecutor   = require('./parallelExecutor');   // Phase 4: 병렬 실행

// ─────────────────────────────────────────────────────────────
// § 체인 실행 설정
// ─────────────────────────────────────────────────────────────
const CHAIN_CONFIG = {
  MAX_CORRECTION_ROUNDS: 2,   // STEP 13: 최대 자기교정 횟수 (budget이 우선)
  MIN_QUALITY_SCORE:     70,  // 자기교정 트리거 기준 점수
  CORRECTION_THRESHOLD:  60,  // 이 점수 미만이면 재작성
  MAX_CHAIN_STEPS:       8,   // 체인 최대 스텝
  TOOL_TIMEOUT_MS:    15000,  // 툴 타임아웃
  // Phase 4: parallelExecutor 설정 미러 (하위 호환)
  get MAX_PARALLEL_TOOLS()   { return parallelExecutor.PARALLEL_CONFIG.MAX_PARALLEL_TOOLS; },
  get PARALLELIZABLE_TYPES() { return parallelExecutor.PARALLEL_CONFIG.PARALLELIZABLE_TYPES; },
};

// ─────────────────────────────────────────────────────────────
// § ToolChainExecutor 클래스
// ─────────────────────────────────────────────────────────────
class ToolChainExecutor {
  constructor(openaiClient, toolExecutor, taskStateEngine) {
    this.openai      = openaiClient;
    this.execTool    = toolExecutor;    // executeTool() from functionTools.js
    this.stateEngine = taskStateEngine;
  }

  // ── 핵심: 태스크 목록 순차 실행 ─────────────────────────────
  async executeChain(plan, systemPrompt, options = {}) {
    const { planId, tasks } = plan;
    const {
      userMessage   = '',
      sessionId     = 'anon',
      maxTokens     = 3000,
      temperature   = 0.7,
      selectedModel = 'gpt-4o-mini',
      onProgress    = null,
      budget        = null,   // Phase 2: CostController budget
    } = options;

    // 누적 컨텍스트 (이전 태스크 결과가 다음에 전달)
    const chainContext = {
      originalMessage: userMessage,
      results:         {},    // taskId → result
      toolOutputs:     [],    // 모든 툴 출력
      searchResults:   null,  // 웹 검색 결과
      analysisResult:  null,  // 분석 결과
      corrections:     [],    // 자기교정 기록 (STEP 13)
    };

    let finalResult = null;
    const chainLog  = [];

    console.log(`[ToolChain] 체인 시작 planId=${planId} tasks=${tasks.length}`);

    // ── Phase 4: 태스크를 실행 웨이브로 그룹화 ──────────────────
    const waves = this._buildExecutionWaves(tasks);
    const parallelWaveCount = waves.filter(w => w.parallel && w.tasks.length > 1).length;
    console.log(`[ToolChain] 실행 웨이브: ${waves.length}개 (병렬 그룹: ${parallelWaveCount}개)`);
    waves.forEach((w, i) => {
      console.log(`  웨이브[${i}] parallel=${w.parallel} tasks=${w.tasks.map(t => `${t.id}(${t.type})`).join(',')}`);
    });

    for (const wave of waves) {
      // ── Phase 2: 매 wave 시작 전 시간 제한 확인 ────────────
      if (budget) {
        const timeCheck = costController.checkTimeLimit(budget);
        if (!timeCheck.ok) {
          console.warn(`[CostController] 시간 초과 → wave 중단`);
          return this._buildPartialResult(finalResult, chainLog, chainContext, budget.stopReason);
        }
      }

      if (wave.parallel && wave.tasks.length > 1) {
        // ── Phase 4: parallelExecutor 위임 병렬 실행 ──────────
        console.log(`[ToolChain][Parallel] 그룹 ${wave.groupId}: ${wave.tasks.length}개 병렬 실행: ${wave.tasks.map(t => t.id).join(', ')}`);

        // 각 태스크 상태 → running 전환
        for (const task of wave.tasks) {
          if (planId) this.stateEngine?.startTask(planId, task.id);
          if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'running', groupIndex: wave.groupId });
        }

        // parallelExecutor.runParallelGroup 실행
        const groupResults = await parallelExecutor.runParallelGroup(
          wave.tasks,
          (task) => this._executeTask(task, chainContext, systemPrompt, {
            userMessage, selectedModel, maxTokens, temperature, budget,
          }),
          { maxParallel: parallelExecutor.PARALLEL_CONFIG.MAX_PARALLEL_TOOLS, groupId: wave.groupId }
        );

        // 결과 병합 — Phase 4: mergeParallelResults 사용
        const searchResultsThisWave = [];
        for (const gr of groupResults) {
          const { task, result, error, success, ms } = gr;
          if (!task) continue;

          if (!success || error) {
            console.error(`[ToolChain][Parallel] ${task.id} 실패: ${error}`);
            if (planId) this.stateEngine?.failTask(planId, task.id, error);
            chainLog.push({ taskId: task.id, taskName: task.name, type: task.type,
              success: false, ms, error, parallel: true, groupId: wave.groupId });
            if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'failed' });
          } else {
            chainContext.results[task.id] = result;
            if (task.type === TASK_TYPES.SEARCH && result) {
              searchResultsThisWave.push(result);
            }
            if (task.type === TASK_TYPES.ANALYZE) chainContext.analysisResult = result;
            if (task.tool) chainContext.toolOutputs.push({ tool: task.tool, result });
            if (planId) this.stateEngine?.completeTask(planId, task.id, result);
            finalResult = result;
            chainLog.push({ taskId: task.id, taskName: task.name, type: task.type,
              success: true, ms, parallel: true, groupId: wave.groupId });
            if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'done', result });
          }
        }

        // Phase 4: 병렬 검색 결과 병합 (dedupe + rank)
        if (searchResultsThisWave.length > 1) {
          chainContext.searchResults = parallelExecutor.mergeParallelResults(
            searchResultsThisWave, chainContext.originalMessage
          );
          // 마지막 SEARCH task의 결과도 병합 결과로 업데이트
          const searchTasks = wave.tasks.filter(t => t.type === TASK_TYPES.SEARCH);
          if (searchTasks.length > 0) {
            chainContext.results[searchTasks[searchTasks.length - 1].id] = chainContext.searchResults;
            finalResult = chainContext.searchResults;
          }
        } else if (searchResultsThisWave.length === 1) {
          chainContext.searchResults = searchResultsThisWave[0];
        }

        // Phase 2: budget 초과 체크
        if (budget?.isExceeded) {
          console.warn(`[CostController] budget 초과 → wave 중단`);
          return this._buildPartialResult(finalResult, chainLog, chainContext, budget.stopReason);
        }

      } else {
        // ── 순차 실행 (단일 또는 의존성 있는 태스크) ────────────
        for (const task of wave.tasks) {
          parallelExecutor.recordSequentialTask();
          const cont = await this._runSequentialTask(task, chainContext, systemPrompt,
            { userMessage, selectedModel, maxTokens, temperature, budget, onProgress, planId, chainLog },
            (r) => { finalResult = r; }
          );
          if (budget?.isExceeded) return this._buildPartialResult(finalResult, chainLog, chainContext, budget.stopReason);
          if (!cont) break; // SYNTHESIZE/WRITE 실패 시 중단
        }
      }
    }

    // ── Phase 2: self-correction 전 budget 체크 ────────────────
    if (finalResult && this._needsCorrection(finalResult, chainContext)) {
      finalResult = await this._selfCorrectionLoop(
        finalResult, chainContext, systemPrompt,
        { userMessage, selectedModel, maxTokens, temperature, budget },
      );
      // correction 중 budget 초과
      if (budget?.isExceeded && !finalResult) {
        if (planId) this.stateEngine?.completePlan(planId);
        return this._buildPartialResult(
          Object.values(chainContext.results).filter(v => typeof v === 'string').pop() || null,
          chainLog, chainContext, budget.stopReason,
        );
      }
    }

    if (planId) this.stateEngine?.completePlan(planId);

    return {
      finalResult,
      chainContext,
      chainLog,
      corrections: chainContext.corrections,
    };
  }

  // ── Phase 4: parallelExecutor 위임 — 실행 웨이브 계산 ───────
  _buildExecutionWaves(tasks) {
    return parallelExecutor.groupParallelizableTasks(tasks);
  }

  // ── Phase 4: parallelExecutor 위임 — 검색 결과 병합 ─────────
  _mergeSearchResults(resultsArr) {
    return parallelExecutor.mergeParallelResults(resultsArr);
  }

  // ── Phase 2: partial result 빌더 ─────────────────────────────
  _buildPartialResult(partialResult, chainLog, chainContext, reason) {
    return {
      finalResult:  partialResult,
      chainContext,
      chainLog,
      corrections:  chainContext.corrections,
      isBudgetStop: true,
      reason:       reason || 'budget_exceeded',
      partialResult,
    };
  }

  // ── Phase 3+4: 순차 태스크 실행 헬퍼 ────────────────────────
  // 반환: true = 계속 진행, false = SYNTHESIZE/WRITE 실패 → 중단
  async _runSequentialTask(task, chainContext, systemPrompt, opts, setFinal) {
    const { userMessage, selectedModel, maxTokens, temperature, budget,
            onProgress, planId, chainLog } = opts;

    // 의존성 체크
    if (!task.dependsOn.every(dep => chainContext.results[dep] !== undefined)) {
      console.warn(`[ToolChain] ${task.id} 의존성 미충족, 건너뜀`);
      return true;
    }

    if (planId) this.stateEngine?.startTask(planId, task.id);
    if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'running' });

    const stepStart = Date.now();
    let stepResult  = null;
    let stepError   = null;

    try {
      stepResult = await this._executeTask(task, chainContext, systemPrompt, {
        userMessage, selectedModel, maxTokens, temperature, budget,
      });
      chainContext.results[task.id] = stepResult;

      if (task.type === TASK_TYPES.SEARCH)  chainContext.searchResults  = stepResult;
      if (task.type === TASK_TYPES.ANALYZE) chainContext.analysisResult = stepResult;
      if (task.tool) chainContext.toolOutputs.push({ tool: task.tool, result: stepResult });

      if (planId) this.stateEngine?.completeTask(planId, task.id, stepResult);
      setFinal(stepResult);

      // Phase 2: budget 초과 감지
      if (budget?.isExceeded) {
        chainLog.push({ taskId: task.id, taskName: task.name, type: task.type, success: true, ms: Date.now() - stepStart });
        if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'done' });
        return true;
      }

    } catch (err) {
      stepError = err.message || String(err);
      console.error(`[ToolChain] ${task.id} 실패: ${stepError}`);
      if (planId) this.stateEngine?.failTask(planId, task.id, stepError);

      // Phase 3: 치명적 태스크 실패 — failureStore에 기록
      if (task.type === TASK_TYPES.SYNTHESIZE || task.type === TASK_TYPES.WRITE) {
        _captureToolFailure(chainContext, task, stepError, budget);
      }

      chainLog.push({ taskId: task.id, taskName: task.name, type: task.type, success: false, ms: Date.now() - stepStart, error: stepError });
      if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'failed' });

      // SYNTHESIZE/WRITE 실패 → 중단 신호
      if (task.type === TASK_TYPES.SYNTHESIZE || task.type === TASK_TYPES.WRITE) return false;
      return true;
    }

    chainLog.push({ taskId: task.id, taskName: task.name, type: task.type, success: true, ms: Date.now() - stepStart });
    if (onProgress) onProgress({ taskId: task.id, taskName: task.name, status: 'done', result: stepResult });
    return true;
  }

  // ── 개별 태스크 실행 ──────────────────────────────────────────
  async _executeTask(task, chainContext, systemPrompt, opts) {
    const { userMessage, selectedModel, maxTokens, temperature, budget } = opts;

    switch (task.type) {
      case TASK_TYPES.SEARCH:
        return this._runSearch(task, chainContext, userMessage, budget);

      case TASK_TYPES.EXTRACT:
        return this._runExtract(task, chainContext);

      case TASK_TYPES.TOOL:
        return this._runTool(task, chainContext, userMessage, budget);

      case TASK_TYPES.ANALYZE:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'analyze');

      case TASK_TYPES.SUMMARIZE:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'summarize');

      case TASK_TYPES.PLAN:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'plan');

      case TASK_TYPES.CODE:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'code');

      case TASK_TYPES.WRITE:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'write');

      case TASK_TYPES.REVIEW:
        return this._runReview(task, chainContext, systemPrompt, opts);

      case TASK_TYPES.SYNTHESIZE:
        return this._runSynthesize(task, chainContext, systemPrompt, opts);

      default:
        return this._runLLMTask(task, chainContext, systemPrompt, opts, 'write');
    }
  }

  // ── 웹 검색 태스크 ────────────────────────────────────────────
  // Phase 5: searchEngine (Brave → SerpAPI → Serper → Tavily → DDG) 직접 사용
  async _runSearch(task, chainContext, userMessage, budget = null) {
    // Phase 2: tool call tracking
    if (budget) {
      const check = costController.trackToolCall(budget, 'web_search');
      if (!check.ok) {
        console.warn(`[CostController] tool 한도 초과 → search 건너뜀`);
        return `[검색 건너뜀: ${check.reason}]`;
      }
    }

    // search1/2/3 병렬 실행 시 각각 다른 각도로 쿼리 다변화
    let query = task.searchQuery || userMessage;
    if (!task.searchQuery) {
      const taskNum = task.id === 'search2' ? 2 : task.id === 'search3' ? 3 : 1;
      if (taskNum === 2) query = `${userMessage} 최신 동향 분석`;
      if (taskNum === 3) query = `${userMessage} 사례 비교`;
    }

    // Phase 6: 캐시 확인
    const cached = cacheLayer.get('search', query);
    if (cached) {
      console.log(`[Cache] search 히트: "${query.substring(0, 50)}"`);
      return cached;
    }

    try {
      // Phase 5: searchEngine 직접 호출 (멀티 프로바이더 폴백)
      const result = await searchEngine.search(query, { maxResults: 5 });
      if (result) {
        cacheLayer.set('search', query, result);
        return result;
      }

      // searchEngine 실패 시 execTool 폴백
      if (this.execTool) {
        const fallback = await Promise.race([
          this.execTool('web_search', { query, max_results: 5 }, {}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CHAIN_CONFIG.TOOL_TIMEOUT_MS)),
        ]);
        const fallbackVal = fallback || '[검색 결과 없음]';
        if (fallback) cacheLayer.set('search', query, fallbackVal);
        return fallbackVal;
      }

      return '[검색 결과 없음]';
    } catch (err) {
      return `[검색 실패: ${err.message}]`;
    }
  }

  // ── URL 추출 태스크 ───────────────────────────────────────────
  async _runExtract(task, chainContext) {
    const searchResult = chainContext.searchResults || '';
    if (!searchResult) return '[추출할 검색 결과 없음]';
    const urls = (searchResult.match(/https?:\/\/[^\s\)]+/g) || []).slice(0, 3);
    return `추출된 URL: ${urls.join(', ') || '없음'}\n검색 요약: ${searchResult.substring(0, 500)}`;
  }

  // ── 특수 툴 태스크 ────────────────────────────────────────────
  async _runTool(task, chainContext, userMessage, budget = null) {
    // Phase 2: tool call tracking
    if (budget) {
      const check = costController.trackToolCall(budget, task.tool || 'unknown');
      if (!check.ok) {
        console.warn(`[CostController] tool 한도 초과 → ${task.tool} 건너뜀`);
        return `[툴 건너뜀: ${check.reason}]`;
      }
    }
    if (!this.execTool || !task.tool) return '[툴 미정의]';

    // Phase 6: weather/exchange/datetime 캐시
    const _cacheTypeMap = {
      get_weather:      'weather',
      get_exchange_rate: 'exchange',
      get_datetime:     'datetime',
    };
    const cacheType = _cacheTypeMap[task.tool] || null;
    if (cacheType) {
      const cacheKey = `${task.tool}:${userMessage.substring(0, 60)}`;
      const cached   = cacheLayer.get(cacheType, cacheKey);
      if (cached) {
        console.log(`[Cache] ${task.tool} 히트`);
        return cached;
      }
    }

    try {
      const cityMatch = userMessage.match(/([가-힣a-zA-Z]+(?:시|도|gu|city)?)\s*날씨/i);
      const args = task.tool === 'get_weather'
        ? { city: cityMatch?.[1] || 'Seoul' }
        : {};
      const result = await Promise.race([
        this.execTool(task.tool, args, {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CHAIN_CONFIG.TOOL_TIMEOUT_MS)),
      ]);
      const resultVal = result || '[툴 결과 없음]';
      // Phase 6: 캐시 저장
      if (cacheType && result) {
        const cacheKey = `${task.tool}:${userMessage.substring(0, 60)}`;
        cacheLayer.set(cacheType, cacheKey, resultVal);
      }
      return resultVal;
    } catch (err) {
      return `[툴 실패: ${err.message}]`;
    }
  }

  // ── LLM 기반 태스크 (analyze/summarize/write/code/plan) ────────
  async _runLLMTask(task, chainContext, systemPrompt, opts, mode) {
    const { selectedModel, maxTokens, temperature, budget } = opts;

    // Phase 2: LLM call tracking (호출 전 체크)
    if (budget) {
      const check = costController.trackLLMCall(budget, selectedModel, 0);
      if (!check.ok) {
        console.warn(`[CostController] LLM 한도 초과 → ${mode} 건너뜀`);
        return `[LLM 호출 건너뜀: ${check.reason}]`;
      }
    }

    const prevContext = this._buildPrevContext(task, chainContext);

    const modeInstructions = {
      analyze:   '아래 정보를 분석하여 핵심 인사이트를 도출하세요.',
      summarize: '아래 정보를 간결하게 요약하세요 (핵심만).',
      plan:      '아래 요구사항을 바탕으로 구체적인 계획을 수립하세요.',
      code:      '아래 명세에 따라 완전하고 실행 가능한 코드를 작성하세요.',
      write:     '아래 정보를 바탕으로 요청에 맞는 내용을 작성하세요.',
    };

    const taskPrompt = `${modeInstructions[mode] || '태스크를 수행하세요.'}

원래 요청: ${chainContext.originalMessage}
${prevContext ? `\n이전 결과:\n${prevContext}` : ''}

${task.name} 태스크를 수행하세요.`;

    try {
      const res = await this.openai.chat.completions.create({
        model: selectedModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: taskPrompt },
        ],
        temperature: mode === 'code' ? 0.3 : temperature,
        max_tokens:  Math.min(maxTokens, mode === 'code' ? 2000 : 1500),
      });

      // Phase 2: 실제 token 사용량 반영
      if (budget && res.usage) {
        const tokensUsed = res.usage.total_tokens || 0;
        // 이미 trackLLMCall에서 +1 했으므로 token만 추가
        budget.totalTokens += tokensUsed;
        if (budget.totalTokens > budget.limits.maxTokens && !budget.isExceeded) {
          costController.trackLLMCall(budget, selectedModel, 0); // exceeded 처리용
        }
      }

      return res.choices[0].message.content;
    } catch (err) {
      throw new Error(`LLM 태스크 실패 (${mode}): ${err.message}`);
    }
  }

  // ── 검토 태스크 (STEP 13 자기교정 준비) ─────────────────────
  async _runReview(task, chainContext, systemPrompt, opts) {
    const { selectedModel, budget } = opts;

    // Phase 2: LLM tracking
    if (budget) {
      const check = costController.trackLLMCall(budget, selectedModel, 0);
      if (!check.ok) {
        return { score: 75, issues: [], improvements: [], needsRevision: false, summary: '검토 건너뜀 (budget 초과)' };
      }
    }

    const targetResult = chainContext.results[task.dependsOn[0]] || '';
    const reviewPrompt = `아래 결과물을 검토하고 JSON 형식으로 평가하세요.

원래 요청: ${chainContext.originalMessage}
결과물:
${String(targetResult).substring(0, 2000)}

다음 형식으로 평가:
{
  "score": 0~100,
  "issues": ["문제점1", "문제점2"],
  "improvements": ["개선사항1", "개선사항2"],
  "needsRevision": true/false,
  "summary": "평가 요약 한 줄"
}`;

    try {
      const res = await this.openai.chat.completions.create({
        model: selectedModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '당신은 엄격하고 객관적인 품질 검토자입니다. JSON만 반환하세요.' },
          { role: 'user',   content: reviewPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens:  400,
      });
      if (budget && res.usage) budget.totalTokens += res.usage.total_tokens || 0;
      return JSON.parse(res.choices[0].message.content);
    } catch (err) {
      return { score: 75, issues: [], improvements: [], needsRevision: false, summary: '검토 완료' };
    }
  }

  // ── 결과 통합 태스크 ──────────────────────────────────────────
  async _runSynthesize(task, chainContext, systemPrompt, opts) {
    const { selectedModel, maxTokens, temperature, budget } = opts;

    // Phase 2: LLM tracking
    if (budget) {
      const check = costController.trackLLMCall(budget, selectedModel, 0);
      if (!check.ok) {
        // synthesize 실패 시 마지막 결과 반환
        const vals = Object.values(chainContext.results).filter(v => v && typeof v === 'string');
        return vals[vals.length - 1] || `[통합 건너뜀: ${check.reason}]`;
      }
    }

    const allResults = Object.entries(chainContext.results)
      .filter(([id]) => id !== task.id)
      .map(([id, res]) => `[${id}]\n${String(res).substring(0, 600)}`)
      .join('\n\n');

    const synthPrompt = `아래 여러 단계의 결과물을 통합하여 최종 답변을 생성하세요.

원래 요청: ${chainContext.originalMessage}

수집된 결과:
${allResults}

위 모든 정보를 종합하여 완성된 최종 답변을 한국어로 작성하세요.`;

    try {
      const res = await this.openai.chat.completions.create({
        model: selectedModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: synthPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      });
      if (budget && res.usage) budget.totalTokens += res.usage.total_tokens || 0;
      return res.choices[0].message.content;
    } catch (err) {
      const vals = Object.values(chainContext.results).filter(v => v && typeof v === 'string');
      return vals[vals.length - 1] || '[결과 통합 실패]';
    }
  }

  // ── 이전 태스크 결과 컨텍스트 빌드 ─────────────────────────
  _buildPrevContext(task, chainContext) {
    const deps = task.dependsOn || [];
    if (deps.length === 0) return '';
    return deps
      .map(dep => {
        const res = chainContext.results[dep];
        if (!res) return '';
        const text = typeof res === 'object' ? JSON.stringify(res) : String(res);
        return `[${dep}]: ${text.substring(0, 800)}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  // ── STEP 13: 자기교정 필요 여부 판단 ────────────────────────
  _needsCorrection(result, chainContext) {
    if (!result || typeof result !== 'string') return false;
    if (result.length < 50) return true;

    const reviewResult = Object.values(chainContext.results).find(
      r => r && typeof r === 'object' && typeof r.score === 'number'
    );
    if (reviewResult && reviewResult.score < CHAIN_CONFIG.MIN_QUALITY_SCORE) {
      return true;
    }
    return false;
  }

  // ── STEP 13 + Phase 2: 자기교정 루프 ────────────────────────
  async _selfCorrectionLoop(draft, chainContext, systemPrompt, opts) {
    let current = draft;
    const { selectedModel, maxTokens, temperature, budget } = opts;

    for (let round = 0; round < CHAIN_CONFIG.MAX_CORRECTION_ROUNDS; round++) {
      // Phase 2: correction 실행 가능 여부 확인
      if (budget) {
        const corrCheck = costController.canRunCorrection(budget);
        if (!corrCheck.ok) {
          console.warn(`[CostController] correction 한도 초과 → 루프 중단 (round=${round})`);
          break;
        }
      }

      console.log(`[SelfCorrection] 교정 라운드 ${round + 1}/${CHAIN_CONFIG.MAX_CORRECTION_ROUNDS}`);

      // 1. 문제 감지 (LLM 호출 → budget tracking)
      if (budget) {
        const check = costController.trackLLMCall(budget, selectedModel, 0);
        if (!check.ok) { break; }
      }
      const issues = await this._detectIssues(current, chainContext.originalMessage, selectedModel);
      if (!issues.needsRevision) {
        console.log(`[SelfCorrection] 교정 불필요 (점수: ${issues.score})`);
        break;
      }

      // 2. 재검색 (정보 부족 시) → tool budget
      let additionalContext = '';
      if (issues.needsMoreSearch && this.execTool) {
        if (budget) {
          const toolCheck = costController.trackToolCall(budget, 'web_search_correction');
          if (!toolCheck.ok) {
            console.warn(`[CostController] tool 한도로 재검색 건너뜀`);
          } else {
            try {
              additionalContext = await this._runSearch(
                { searchQuery: issues.searchQuery || chainContext.originalMessage },
                chainContext,
                chainContext.originalMessage,
                null, // 이미 위에서 체크함
              );
            } catch (_) {}
          }
        } else {
          try {
            additionalContext = await this._runSearch(
              { searchQuery: issues.searchQuery || chainContext.originalMessage },
              chainContext,
              chainContext.originalMessage,
            );
          } catch (_) {}
        }
      }

      // 3. 개선 LLM 호출
      if (budget) {
        const check = costController.trackLLMCall(budget, selectedModel, 0);
        if (!check.ok) { break; }
      }

      const improvedPrompt = `아래 초안에는 다음 문제가 있습니다:
${issues.issues.join('\n')}
${issues.improvements ? `개선 방향:\n${issues.improvements.join('\n')}` : ''}
${additionalContext ? `\n추가 정보:\n${additionalContext.substring(0, 500)}` : ''}

원래 요청: ${chainContext.originalMessage}

초안:
${String(current).substring(0, 2000)}

위 문제를 해결하여 더 나은 답변을 작성하세요.`;

      try {
        const res = await this.openai.chat.completions.create({
          model: selectedModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: improvedPrompt },
          ],
          temperature: Math.max(0.3, temperature - 0.1 * round),
          max_tokens:  maxTokens,
        });
        if (budget && res.usage) budget.totalTokens += res.usage.total_tokens || 0;
        const improved = res.choices[0].message.content;
        chainContext.corrections.push({
          round:    round + 1,
          issues:   issues.issues,
          score:    issues.score,
          improved: improved.substring(0, 100),
        });
        current = improved;
      } catch (err) {
        console.warn(`[SelfCorrection] 라운드 ${round + 1} 실패: ${err.message}`);
        break;
      }

      if (issues.score >= CHAIN_CONFIG.MIN_QUALITY_SCORE) break;
    }

    return current;
  }

  // ── STEP 13: 문제 감지 ────────────────────────────────────────
  async _detectIssues(text, originalMessage, model) {
    try {
      const res = await this.openai.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: '당신은 AI 답변 품질 검증자입니다. JSON만 반환하세요.',
          },
          {
            role: 'user',
            content: `원래 요청: ${originalMessage}

답변:
${String(text).substring(0, 1500)}

다음 기준으로 평가하세요:
- 요청에 충분히 답하고 있는가?
- 사실 오류나 논리적 모순이 있는가?
- 불완전하거나 너무 짧지는 않은가?

JSON 반환:
{
  "score": 0~100,
  "needsRevision": true/false,
  "issues": ["문제1"],
  "improvements": ["개선점1"],
  "needsMoreSearch": true/false,
  "searchQuery": "추가 검색어 (필요시)"
}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens:  300,
      });
      return JSON.parse(res.choices[0].message.content);
    } catch (_) {
      return { score: 80, needsRevision: false, issues: [], improvements: [], needsMoreSearch: false };
    }
  }
}

// ── Phase 3: 모듈 레벨 tool 실패 캡처 헬퍼 ──────────────────
function _captureToolFailure(chainContext, task, errorMsg, budget) {
  try {
    failureStore.captureFailure({
      planId:           chainContext.planId   || null,
      sessionId:        chainContext.sessionId || null,
      userMessage:      chainContext.originalMessage || '',
      strategy:         null,
      model:            null,
      complexity:       null,
      plan:             null,
      tasks:            null,
      taskStates:       null,
      toolCalls:        chainContext.toolOutputs || [],
      correctionRounds: chainContext.corrections?.length || 0,
      finalError:       `[${task.type}:${task.id}] ${errorMsg}`,
      errorType:        'chain_error',
      budget:           budget ? {
        llm_calls_used:  budget.llmCalls,
        tool_calls_used: budget.toolCalls,
        is_partial:      budget.isExceeded,
      } : null,
      partialResult:    null,
    });
  } catch (_) { /* 실패 저장 실패는 무시 */ }
}

module.exports = { ToolChainExecutor, CHAIN_CONFIG };
