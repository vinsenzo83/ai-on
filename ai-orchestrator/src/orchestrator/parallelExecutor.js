// ============================================================
// ParallelExecutor v1 – 독립 스텝 동시 실행
// ============================================================
//
// DynamicPlanner가 parallel: true로 표시한 스텝들을
// Promise.all()로 동시에 실행한다.
//
// 실행 순서 계산 예시:
//   plan(depends: [])           → 1라운드 (단독)
//   copy(depends: [plan])       → 2라운드 ┐ 동시
//   design(depends: [plan])     → 2라운드 ┘
//   code(depends: [copy,design])→ 3라운드 (단독)
//   validate(depends: [code])   → 4라운드 (단독)
//
// 결과: 5스텝이지만 실질 라운드는 4 → 약 20% 시간 단축
// ============================================================

class ParallelExecutor {
  constructor(callAIFn) {
    // callAIFn(step, ctx, isRetry) → Promise<result>
    this.callAI = callAIFn;
  }

  // ── 파이프라인 전체 실행 ───────────────────────────────────
  async execute(steps, ctx, onProgress) {
    // 실행 라운드(웨이브) 계산
    const waves = this.buildWaves(steps);
    const totalSteps = steps.length;
    let completedCount = 0;

    for (let wi = 0; wi < waves.length; wi++) {
      const wave = waves[wi];
      const isParallel = wave.length > 1;

      if (isParallel) {
        // ── 병렬 실행 ────────────────────────────────────────
        onProgress?.({
          status: 'executing',
          message: `⚡ [병렬] ${wave.map(s => s.name).join(' + ')} 동시 실행 중...`,
          progress: Math.round(10 + (completedCount / totalSteps) * 72),
          parallel: true,
          parallelSteps: wave.map(s => s.name)
        });

        const results = await Promise.allSettled(
          wave.map(step => this._runStep(step, ctx, onProgress))
        );

        // 결과 처리
        for (let i = 0; i < wave.length; i++) {
          const step = wave[i];
          const res = results[i];

          if (res.status === 'fulfilled') {
            ctx.completeStep(step.id, step.model, step.role, res.value);
          } else {
            // 병렬 스텝 실패 → 단독 재시도
            console.warn(`병렬 스텝 실패 (${step.name}), 단독 재시도:`, res.reason?.message);
            try {
              const retryResult = await this._runStep(step, ctx, onProgress, true);
              ctx.completeStep(step.id, step.model, step.role, retryResult);
            } catch (err) {
              throw new Error(`[${step.name}] 실패: ${err.message}`);
            }
          }
          completedCount++;
        }

      } else {
        // ── 순차 실행 ────────────────────────────────────────
        const step = wave[0];
        const progress = Math.round(10 + (completedCount / totalSteps) * 72);

        onProgress?.({
          status: 'executing',
          message: `[${this._modelName(step.model)}] ${step.name} 중...`,
          step: step.id,
          stepIndex: completedCount + 1,
          totalSteps,
          model: this._modelName(step.model),
          progress
        });

        ctx.startStep(step.id, this._modelName(step.model), step.role);
        const result = await this._runStep(step, ctx, onProgress);
        ctx.completeStep(step.id, this._modelName(step.model), step.role, result);
        completedCount++;
      }
    }
  }

  // ── 단일 스텝 실행 (재시도 포함) ─────────────────────────
  async _runStep(step, ctx, onProgress, isRetry = false) {
    const MAX_RETRIES = 3;
    let attempts = 0;

    // 병렬 스텝 시작 기록
    if (!isRetry) {
      ctx.startStep(step.id, this._modelName(step.model), step.role);
    }

    while (attempts < MAX_RETRIES) {
      try {
        return await this.callAI(step, ctx, attempts > 0 || isRetry);
      } catch (err) {
        attempts++;
        if (attempts >= MAX_RETRIES) throw err;

        onProgress?.({
          status: 'retrying',
          message: `🔄 [${step.name}] 재시도 ${attempts}/${MAX_RETRIES}...`,
          progress: null
        });
        await this._sleep(600 * attempts);
      }
    }
  }

  // ── 실행 웨이브 계산 ──────────────────────────────────────
  // 의존성 그래프를 분석해서 동시에 실행 가능한 스텝 묶음 계산
  buildWaves(steps) {
    const waves = [];
    const completed = new Set();
    const remaining = [...steps];

    while (remaining.length > 0) {
      // 이번 라운드에 실행 가능한 스텝: 의존성이 모두 완료된 것
      const ready = remaining.filter(step => {
        const deps = step.dependsOn || [];
        return deps.every(dep => completed.has(dep));
      });

      if (ready.length === 0) {
        // 의존성 사이클 방지: 나머지 전부 강제 실행
        waves.push(remaining.splice(0));
        break;
      }

      // parallel: true인 것들만 묶어서 동시 실행
      // parallel: false는 단독 실행
      const parallelGroup = ready.filter(s => s.parallel);
      const sequentialSteps = ready.filter(s => !s.parallel);

      // sequential은 하나씩
      for (const step of sequentialSteps) {
        waves.push([step]);
        completed.add(step.id);
        const idx = remaining.indexOf(step);
        if (idx >= 0) remaining.splice(idx, 1);
      }

      // parallel은 한 번에
      if (parallelGroup.length > 0) {
        waves.push(parallelGroup);
        parallelGroup.forEach(s => {
          completed.add(s.id);
          const idx = remaining.indexOf(s);
          if (idx >= 0) remaining.splice(idx, 1);
        });
      }
    }

    return waves;
  }

  // ── 예상 시간 계산 ────────────────────────────────────────
  // 병렬 실행을 고려한 실제 예상 시간
  estimateTime(steps, secondsPerStep = 25) {
    const waves = this.buildWaves(steps);
    // 각 웨이브는 가장 긴 스텝 기준 (병렬이므로)
    const totalSeconds = waves.length * secondsPerStep;
    return Math.round(totalSeconds / 60 * 10) / 10; // 분 단위
  }

  _modelName(modelKey) {
    const names = {
      GPT4O: 'GPT-4o', GPT4O_MINI: 'GPT-4o mini',
      CLAUDE_SONNET: 'Claude 3.5', GPT4_1: 'GPT-4.1'
    };
    return names[modelKey] || modelKey;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = ParallelExecutor;
