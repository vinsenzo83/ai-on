// ============================================================
// comboOptimizer.js  –  AI 조합 자동 최적화 엔진
// ============================================================
//
// 핵심 기능:
//   1. selectBestCombo()   : 작업/컨텍스트에 맞는 최적 조합 자동 선택
//   2. scoreCombo()        : 조합의 능력치 점수 계산
//   3. buildDynamicCombo() : GPT 분석으로 완전 새 조합 생성
//   4. rankCombos()        : 후보 조합 전체 랭킹
//
// 선택 알고리즘:
//   Step 1. taskType과 strategy 조건으로 후보 조합 필터링
//   Step 2. 각 조합 점수 = Σ(role 가중치 × 모델 능력치)
//   Step 3. winRate + avgScore + abilityScore 가중합
//   Step 4. ModelBenchmark 실제 실행 데이터로 보정
//   Step 5. 최고점 조합 선택 → 없으면 dynamicCombo 생성
// ============================================================

'use strict';

const { MODEL_REGISTRY, COMBO_ROLES, KNOWN_COMBOS, TASK_PIPELINES } = require('../types/index');

// 전략별 우선순위 가중치
const STRATEGY_WEIGHTS = {
  quality:  { abilityScore: 0.45, winRate: 0.35, avgScore: 0.20, costPenalty: 0.00 },
  speed:    { abilityScore: 0.25, winRate: 0.25, avgScore: 0.20, costPenalty: 0.10, speedBonus: 0.20 },
  economy:  { abilityScore: 0.30, winRate: 0.25, avgScore: 0.15, costPenalty: 0.30 }
};

class ComboOptimizer {
  constructor(openaiClient) {
    this.openai    = openaiClient;
    this.benchData = null;   // ModelBenchmark 연동 후 주입
  }

  // ── 벤치마크 데이터 연동 ──────────────────────────────────
  injectBenchmark(benchmarkData) {
    this.benchData = benchmarkData;
  }

  // ============================================================
  // [핵심] selectBestCombo  –  최적 조합 자동 선택
  // ============================================================
  //
  // @param {Object} context
  //   .taskType   : 작업 유형 ('ppt', 'code', ...)
  //   .strategy   : 'quality' | 'speed' | 'economy'
  //   .complexity : 'low' | 'medium' | 'high' | 'enterprise'
  //   .userPrefs  : { style, tone, ... }
  //   .sessionId  : 세션 ID (히스토리 참조용)
  //
  // @return {Object} selectedCombo
  //   .comboKey   : KNOWN_COMBOS 키
  //   .combo      : 조합 상세 정보
  //   .scores     : { total, ability, winRate, avgScore }
  //   .reason     : 선택 이유 설명
  //   .alternatives: 차선 조합 목록
  // ============================================================
  selectBestCombo(context) {
    const { taskType, strategy = 'quality', complexity = 'medium' } = context;

    // 1. 후보 조합 필터링
    const candidates = this._filterCandidates(taskType, strategy, complexity);

    if (candidates.length === 0) {
      // 폴백: taskType만 맞는 조합
      const fallback = Object.entries(KNOWN_COMBOS)
        .filter(([, c]) => c.taskType === taskType);
      if (fallback.length === 0) return this._buildDefaultCombo(taskType, strategy);
      candidates.push(...fallback);
    }

    // 2. 각 후보 점수 계산
    const scored = candidates.map(([key, combo]) => ({
      comboKey: key,
      combo,
      scores: this._scoreCombo(combo, taskType, strategy, complexity)
    }));

    // 3. 정렬
    scored.sort((a, b) => b.scores.total - a.scores.total);

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map(s => ({
      comboKey:    s.comboKey,
      name:        s.combo.name,
      description: s.combo.description,
      score:       Math.round(s.scores.total * 100)
    }));

    // 4. 선택 이유 생성
    const reason = this._explainSelection(best, context);

    return {
      comboKey:     best.comboKey,
      combo:        best.combo,
      scores:       best.scores,
      reason,
      alternatives,
      modelMap:     this._resolveModelMap(best.combo)
    };
  }

  // ============================================================
  // _filterCandidates  –  후보 조합 필터링
  // ============================================================
  _filterCandidates(taskType, strategy, complexity) {
    return Object.entries(KNOWN_COMBOS).filter(([, combo]) => {
      if (combo.taskType !== taskType) return false;

      // 복잡도 기반 전략 필터
      if (complexity === 'enterprise' && combo.strategy !== 'quality') return false;
      if (complexity === 'low'        && combo.strategy === 'quality')  {
        // 낮은 복잡도면 quality도 허용하되 speed 우선
      }
      if (strategy && combo.strategy !== strategy) {
        // strategy가 명시된 경우 일치하지 않는 조합도 후보에는 포함
        // (점수에서 패널티 적용)
      }
      return true;
    });
  }

  // ============================================================
  // _scoreCombo  –  조합 종합 점수 계산
  // ============================================================
  _scoreCombo(combo, taskType, strategy, complexity) {
    const weights = STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.quality;
    const pipeline = TASK_PIPELINES[taskType];

    // 능력치 점수: 각 role에서 배정된 모델의 능력치 × 가중치
    let abilityScore = 0;
    let totalWeight  = 0;
    let totalCost    = 0;
    let avgSpeed     = 0;
    let roleCount    = 0;

    for (const [roleName, modelKey] of Object.entries(combo.roles)) {
      const roleSpec  = COMBO_ROLES[roleName];
      const modelSpec = MODEL_REGISTRY[modelKey];
      if (!roleSpec || !modelSpec) continue;

      let roleScore = 0;
      let wSum = 0;
      for (const [ability, w] of Object.entries(roleSpec.weights)) {
        roleScore += (modelSpec.abilities[ability] || 5) * w;
        wSum += w;
      }
      roleScore /= wSum;          // 정규화 (0~10)
      abilityScore += roleScore;
      totalWeight  += 1;
      totalCost    += modelSpec.costPer1kTokens;
      avgSpeed     += (modelSpec.abilities.speed || 5);
      roleCount++;
    }

    if (totalWeight > 0) {
      abilityScore /= totalWeight;   // 0~10 → 정규화
      abilityScore  = abilityScore / 10;  // 0~1
    }

    // 비용 패널티 (0~1, 낮을수록 좋음)
    const avgCost = roleCount > 0 ? totalCost / roleCount : 0.01;
    const costNorm = Math.min(avgCost / 0.03, 1);   // 0.03이 최대 기준

    // 속도 보너스 (strategy=speed일 때)
    const avgSpeedNorm = roleCount > 0 ? (avgSpeed / roleCount) / 10 : 0.5;

    // 전략 패널티/보너스
    let strategyBonus = 0;
    if (combo.strategy === strategy) strategyBonus = 0.05;

    // 복잡도 보정
    let complexityBonus = 0;
    if (complexity === 'enterprise' && combo.name.includes('엔터프라이즈')) complexityBonus = 0.08;
    if (complexity === 'enterprise' && combo.name.includes('심층'))         complexityBonus = 0.06;
    if (complexity === 'low'        && combo.name.includes('빠른'))         complexityBonus = 0.05;

    // 벤치마크 보정
    let benchBonus = 0;
    if (this.benchData) {
      const bData = this.benchData[combo.taskType]?.[Object.keys(combo.roles).join('_')];
      if (bData && bData.executions >= 3) {
        benchBonus = (bData.avgScore / 100) * 0.10;  // 최대 0.10
      }
    }

    // 종합 점수
    const total =
      abilityScore      * weights.abilityScore +
      combo.winRate     * weights.winRate +
      (combo.avgScore / 100) * weights.avgScore -
      costNorm          * (weights.costPenalty || 0) +
      avgSpeedNorm      * (weights.speedBonus  || 0) +
      strategyBonus + complexityBonus + benchBonus;

    return {
      total:        Math.min(total, 1),
      ability:      Math.round(abilityScore * 100),
      winRate:      Math.round(combo.winRate * 100),
      avgScore:     combo.avgScore,
      costPerRole:  Math.round(avgCost * 10000) / 10000,
      speedScore:   Math.round(avgSpeedNorm * 100)
    };
  }

  // ============================================================
  // rankCombos  –  전체 후보 조합 랭킹 반환
  // ============================================================
  rankCombos(taskType, strategy = 'quality', complexity = 'medium') {
    return Object.entries(KNOWN_COMBOS)
      .filter(([, c]) => c.taskType === taskType)
      .map(([key, combo]) => ({
        comboKey:    key,
        name:        combo.name,
        description: combo.description,
        strategy:    combo.strategy,
        scores:      this._scoreCombo(combo, taskType, strategy, complexity),
        roles:       combo.roles,
        modelMap:    this._resolveModelMap(combo)
      }))
      .sort((a, b) => b.scores.total - a.scores.total);
  }

  // ============================================================
  // buildDynamicCombo  –  GPT가 완전 새 조합을 설계
  // ============================================================
  // 알려진 조합이 없거나 특수한 요구사항이 있을 때 호출
  async buildDynamicCombo(context) {
    const { taskType, taskDescription, strategy = 'quality', complexity = 'medium' } = context;

    const modelList = Object.entries(MODEL_REGISTRY).map(([key, m]) =>
      `- ${key}: ${m.id} | 강점: ${m.bestFor.join(', ')} | 티어: ${m.tier}`
    ).join('\n');

    const roleList = Object.entries(COMBO_ROLES).map(([key, r]) =>
      `- ${key}: ${r.icon} ${r.name} – ${r.description}`
    ).join('\n');

    const prompt = `
당신은 AI 파이프라인 설계 전문가입니다.
다음 작업에 가장 적합한 AI 모델 조합을 설계하세요.

[작업 정보]
- 작업 유형: ${taskType}
- 작업 설명: ${taskDescription || '(없음)'}
- 전략: ${strategy} (quality=품질 최우선 / speed=속도 최우선 / economy=비용 최우선)
- 복잡도: ${complexity}

[사용 가능한 역할]
${roleList}

[사용 가능한 모델]
${modelList}

[설계 규칙]
1. 각 역할에 가장 적합한 모델을 배정하세요
2. 핵심 창작/분석 역할은 flagship 모델, 검증/라우팅은 mini/nano 모델
3. strategy가 speed이면 mini 모델을 최대한 활용
4. 역할은 최소 2개, 최대 6개

JSON 형식으로만 응답하세요:
{
  "name": "조합 이름 (한국어)",
  "description": "이 조합의 특징 (1줄)",
  "strategy": "${strategy}",
  "reasoning": "이 조합을 선택한 이유 (2~3줄)",
  "roles": {
    "역할명": "MODEL_REGISTRY 키",
    ...
  },
  "estimatedScore": 75,
  "estimatedWinRate": 0.82
}`;

    try {
      const resp = await this.openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 600,
        temperature: 0.3
      });

      const data = JSON.parse(resp.choices[0].message.content);
      return {
        comboKey:  `dynamic_${taskType}_${Date.now()}`,
        combo:     { ...data, taskType, winRate: data.estimatedWinRate || 0.80, avgScore: data.estimatedScore || 80 },
        scores:    { total: (data.estimatedScore || 80) / 100, ability: data.estimatedScore || 80 },
        reason:    data.reasoning,
        modelMap:  this._resolveModelMap(data),
        isDynamic: true
      };
    } catch (e) {
      console.warn('[ComboOptimizer] Dynamic combo failed, using default:', e.message);
      return this._buildDefaultCombo(taskType, strategy);
    }
  }

  // ============================================================
  // _resolveModelMap  –  역할→모델 ID 매핑 해석
  // ============================================================
  _resolveModelMap(combo) {
    const map = {};
    for (const [roleName, modelKey] of Object.entries(combo.roles || {})) {
      const model = MODEL_REGISTRY[modelKey];
      if (model) {
        map[roleName] = {
          modelId:   model.id,
          modelName: model.name,
          tier:      model.tier,
          icon:      COMBO_ROLES[roleName]?.icon || '🤖'
        };
      }
    }
    return map;
  }

  // ============================================================
  // _explainSelection  –  선택 이유 자연어 생성
  // ============================================================
  _explainSelection(best, context) {
    const { combo, scores, comboKey } = best;
    const modelNames = Object.entries(combo.roles)
      .map(([role, key]) => `${COMBO_ROLES[role]?.icon || '🤖'} ${MODEL_REGISTRY[key]?.name || key}(${role})`)
      .join(' → ');

    return `[${combo.name}] 선택 이유: ` +
      `능력치 점수 ${scores.ability}점, 예상 승률 ${scores.winRate}%, ` +
      `평균 품질 ${scores.avgScore}점. ` +
      `구성: ${modelNames}`;
  }

  // ============================================================
  // _buildDefaultCombo  –  기본 폴백 조합
  // ============================================================
  _buildDefaultCombo(taskType, strategy) {
    const pipeline = TASK_PIPELINES[taskType];
    if (!pipeline) {
      return {
        comboKey: 'fallback',
        combo: { name: '기본 조합', roles: { planner: 'GPT5', writer: 'GPT5', validator: 'GPT5_MINI' } },
        scores: { total: 0.75, ability: 75, winRate: 75, avgScore: 75 },
        reason: '기본 폴백 조합',
        modelMap: {}
      };
    }

    const roles = {};
    for (const step of pipeline.steps) {
      if (!roles[step.role]) {
        const isValidator = step.role === 'validator' || step.role === 'router';
        roles[step.role] = isValidator ? 'GPT5_MINI' : 'GPT5';
      }
    }

    return {
      comboKey: `default_${taskType}`,
      combo:    { name: `${pipeline.name} 기본`, taskType, strategy, roles, winRate: 0.80, avgScore: 80 },
      scores:   { total: 0.80, ability: 80, winRate: 80, avgScore: 80 },
      reason:   '기본 폴백 조합',
      modelMap: this._resolveModelMap({ roles })
    };
  }

  // ============================================================
  // analyzePerformance  –  조합 성능 분석 리포트 생성
  // ============================================================
  analyzePerformance(taskType) {
    const ranking = this.rankCombos(taskType);

    return {
      taskType,
      totalCombos:  ranking.length,
      bestCombo:    ranking[0]?.name || 'N/A',
      worstCombo:   ranking[ranking.length - 1]?.name || 'N/A',
      avgWinRate:   Math.round(
        ranking.reduce((s, c) => s + c.combo?.winRate || 0, 0) / (ranking.length || 1) * 100
      ),
      ranking: ranking.map(r => ({
        rank:     ranking.indexOf(r) + 1,
        name:     r.name,
        score:    Math.round(r.scores.total * 100),
        winRate:  r.scores.winRate,
        avgScore: r.scores.avgScore,
        strategy: r.strategy,
        models:   Object.entries(r.roles).map(([role, key]) =>
          `${role}:${MODEL_REGISTRY[key]?.name || key}`
        ).join(', ')
      }))
    };
  }
}

module.exports = ComboOptimizer;
