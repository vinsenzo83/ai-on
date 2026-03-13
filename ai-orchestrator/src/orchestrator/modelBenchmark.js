// ============================================================
// modelBenchmark.js  –  AI 조합 실행 성능 누적 DB + 자동 학습
// ============================================================
//
// 핵심 기능:
//   1. record()       : 실제 실행 결과를 DB에 저장
//   2. getBestCombo() : 축적된 데이터 기반 최고 조합 반환
//   3. getInsights()  : 조합 성능 통계 및 인사이트
//   4. autoAdjust()   : 승률 데이터를 KNOWN_COMBOS에 역반영
//   5. export/import  : 데이터 영속성 (JSON 파일)
//
// 학습 메커니즘:
//   - 각 실행마다 (comboKey, taskType, score, latency, feedback)를 기록
//   - 충분한 데이터(N>=5) 누적 시 가중이동평균으로 승률 자동 업데이트
//   - 조합 간 상대 성능 비교 → 최고 조합 선별
//   - 시간 흐름에 따른 성능 트렌드 분석
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// 학습 파라미터
const MIN_SAMPLES_FOR_UPDATE = 5;     // 최소 샘플 수 (업데이트 활성화)
const EMA_ALPHA              = 0.2;   // 지수이동평균 계수 (최근 데이터 가중)
const BENCHMARK_FILE         = path.join(__dirname, '../../data/benchmark.json');

class ModelBenchmark {
  constructor() {
    this.db = this._load();
    this._ensureDataDir();
  }

  // ── 데이터 디렉토리 보장 ────────────────────────────────
  _ensureDataDir() {
    const dir = path.dirname(BENCHMARK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ============================================================
  // record  –  실행 결과 기록
  // ============================================================
  //
  // @param {Object} entry
  //   .comboKey    : 조합 키 ('ppt_balanced', 'dynamic_...')
  //   .taskType    : 작업 유형
  //   .score       : 품질 점수 (0~100)
  //   .latencyMs   : 실제 실행 시간 (ms)
  //   .tokenUsed   : 사용 토큰 수
  //   .feedbackRounds : 피드백 재실행 횟수
  //   .userSatisfied  : boolean (명시적 만족 표현 시)
  //   .modelMap    : { role: { modelId, modelName } }
  //   .sessionId   : 세션 ID
  // ============================================================
  record(entry) {
    const {
      comboKey, taskType, score = 0, latencyMs = 0,
      tokenUsed = 0, feedbackRounds = 0, userSatisfied = null,
      modelMap = {}, sessionId = ''
    } = entry;

    if (!comboKey || !taskType) return;

    // DB 구조 초기화
    if (!this.db[taskType])          this.db[taskType] = {};
    if (!this.db[taskType][comboKey]) {
      this.db[taskType][comboKey] = {
        comboKey,
        taskType,
        executions:      0,
        totalScore:      0,
        avgScore:        0,
        avgLatencyMs:    0,
        avgTokenUsed:    0,
        avgFeedbackRounds: 0,
        satisfactions:   0,
        winRate:         0,
        recentScores:    [],   // 최근 20개
        history:         [],   // 전체 기록 (최대 100)
        modelMap,
        lastUpdated:     null
      };
    }

    const rec = this.db[taskType][comboKey];

    // EMA 업데이트
    rec.executions++;
    rec.totalScore   += score;
    rec.avgScore      = this._ema(rec.avgScore, score, rec.executions);
    rec.avgLatencyMs  = this._ema(rec.avgLatencyMs, latencyMs, rec.executions);
    rec.avgTokenUsed  = this._ema(rec.avgTokenUsed, tokenUsed, rec.executions);
    rec.avgFeedbackRounds = this._ema(rec.avgFeedbackRounds, feedbackRounds, rec.executions);

    if (userSatisfied === true)  rec.satisfactions++;

    // 최근 스코어 (순환 버퍼)
    rec.recentScores.push(score);
    if (rec.recentScores.length > 20) rec.recentScores.shift();

    // 히스토리 (최대 100)
    rec.history.push({
      ts:     Date.now(),
      score,
      latencyMs,
      tokenUsed,
      feedbackRounds,
      userSatisfied,
      sessionId
    });
    if (rec.history.length > 100) rec.history.shift();

    // 승률 계산 (타 조합 대비 이 taskType 최고 성과 비율)
    rec.winRate = rec.avgScore / 100;

    rec.lastUpdated = new Date().toISOString();

    // 자동 학습: N개 이상 샘플이면 KNOWN_COMBOS 역반영
    if (rec.executions >= MIN_SAMPLES_FOR_UPDATE) {
      this._autoAdjustCombo(taskType, comboKey, rec);
    }

    this._save();
    return rec;
  }

  // ============================================================
  // getBestCombo  –  타입별 실제 성능 1위 조합 반환
  // ============================================================
  getBestCombo(taskType, strategy = 'any') {
    const taskDb = this.db[taskType];
    if (!taskDb || Object.keys(taskDb).length === 0) return null;

    const candidates = Object.values(taskDb)
      .filter(r => r.executions >= MIN_SAMPLES_FOR_UPDATE);

    if (candidates.length === 0) return null;

    return candidates.sort((a, b) => b.avgScore - a.avgScore)[0];
  }

  // ============================================================
  // getInsights  –  성능 통계 및 인사이트
  // ============================================================
  getInsights(taskType) {
    const taskDb = this.db[taskType] || {};
    const recs   = Object.values(taskDb);

    if (recs.length === 0) {
      return { taskType, message: '아직 실행 데이터가 없습니다.', records: [] };
    }

    const ranked = recs
      .filter(r => r.executions > 0)
      .sort((a, b) => b.avgScore - a.avgScore);

    const totalExecs = recs.reduce((s, r) => s + r.executions, 0);
    const overallAvg = recs.reduce((s, r) => s + r.avgScore * r.executions, 0) / (totalExecs || 1);

    return {
      taskType,
      totalExecutions: totalExecs,
      overallAvgScore: Math.round(overallAvg),
      bestCombo:    ranked[0]?.comboKey || 'N/A',
      worstCombo:   ranked[ranked.length - 1]?.comboKey || 'N/A',
      ranking: ranked.map((r, i) => ({
        rank:         i + 1,
        comboKey:     r.comboKey,
        executions:   r.executions,
        avgScore:     Math.round(r.avgScore),
        avgLatencyMs: Math.round(r.avgLatencyMs),
        winRate:      Math.round(r.winRate * 100),
        trend:        this._scoreTrend(r.recentScores),
        satisfactions: r.satisfactions
      }))
    };
  }

  // ============================================================
  // getAllInsights  –  전체 작업 유형 통합 리포트
  // ============================================================
  getAllInsights() {
    const taskTypes = Object.keys(this.db);
    const report    = {};

    for (const tt of taskTypes) {
      report[tt] = this.getInsights(tt);
    }

    // 글로벌 베스트 조합
    const allRecs = Object.values(this.db).flatMap(t => Object.values(t));
    const topRec  = allRecs.sort((a, b) => b.avgScore - a.avgScore)[0];

    return {
      taskTypes: report,
      globalBest: topRec ? { comboKey: topRec.comboKey, taskType: topRec.taskType, avgScore: Math.round(topRec.avgScore) } : null,
      totalExecutions: allRecs.reduce((s, r) => s + r.executions, 0)
    };
  }

  // ============================================================
  // getComboStats  –  특정 조합 상세 통계
  // ============================================================
  getComboStats(taskType, comboKey) {
    const rec = this.db[taskType]?.[comboKey];
    if (!rec) return null;

    const recent = rec.recentScores;
    const trend  = this._scoreTrend(recent);

    return {
      ...rec,
      trend,
      improvement: recent.length >= 4
        ? Math.round(
            (recent.slice(-2).reduce((s,v) => s+v,0)/2) -
            (recent.slice(0,2).reduce((s,v) => s+v,0)/2)
          )
        : 0,
      recentAvg: recent.length > 0
        ? Math.round(recent.reduce((s,v) => s+v,0) / recent.length)
        : 0
    };
  }

  // ============================================================
  // _autoAdjustCombo  –  KNOWN_COMBOS winRate / avgScore 자동 반영
  // ============================================================
  _autoAdjustCombo(taskType, comboKey, rec) {
    try {
      const types = require('../types/index');
      const combo = types.KNOWN_COMBOS[comboKey];
      if (!combo) return;

      // 실제 데이터로 점진적 업데이트 (EMA)
      const alpha = EMA_ALPHA;
      combo.winRate = combo.winRate * (1 - alpha) + rec.winRate * alpha;
      combo.avgScore = Math.round(combo.avgScore * (1 - alpha) + rec.avgScore * alpha);

      // console.log(`[Benchmark] Auto-adjusted ${comboKey}: winRate=${combo.winRate.toFixed(3)}, avgScore=${combo.avgScore}`);
    } catch (e) {
      // ignore
    }
  }

  // ============================================================
  // compareCombo  –  두 조합 직접 비교
  // ============================================================
  compareCombo(taskType, comboKeyA, comboKeyB) {
    const recA = this.db[taskType]?.[comboKeyA];
    const recB = this.db[taskType]?.[comboKeyB];

    if (!recA && !recB) return { message: '비교 데이터 없음' };

    return {
      comboA: recA ? {
        key:       comboKeyA,
        avgScore:  Math.round(recA.avgScore),
        executions: recA.executions,
        trend:     this._scoreTrend(recA.recentScores),
        latencyMs: Math.round(recA.avgLatencyMs)
      } : { key: comboKeyA, message: '데이터 없음' },
      comboB: recB ? {
        key:       comboKeyB,
        avgScore:  Math.round(recB.avgScore),
        executions: recB.executions,
        trend:     this._scoreTrend(recB.recentScores),
        latencyMs: Math.round(recB.avgLatencyMs)
      } : { key: comboKeyB, message: '데이터 없음' },
      winner: recA && recB
        ? (recA.avgScore >= recB.avgScore ? comboKeyA : comboKeyB)
        : (recA ? comboKeyA : comboKeyB),
      scoreDiff: recA && recB ? Math.round(recA.avgScore - recB.avgScore) : 0
    };
  }

  // ── EMA 유틸 ────────────────────────────────────────────
  _ema(prev, current, n) {
    if (n <= 1) return current;
    const alpha = Math.min(EMA_ALPHA, 2 / (n + 1));
    return prev * (1 - alpha) + current * alpha;
  }

  // ── 스코어 트렌드 (최근 점수 기울기) ──────────────────────
  _scoreTrend(scores) {
    if (scores.length < 3) return 'neutral';
    const recent3 = scores.slice(-3).reduce((s,v) => s+v, 0) / 3;
    const older3  = scores.slice(0, 3).reduce((s,v) => s+v, 0) / 3;
    const diff = recent3 - older3;
    if (diff >= 5)  return 'improving';
    if (diff <= -5) return 'declining';
    return 'stable';
  }

  // ── 영속성: 로드 ────────────────────────────────────────
  _load() {
    try {
      if (fs.existsSync(BENCHMARK_FILE)) {
        return JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return {};
  }

  // ── 영속성: 저장 ────────────────────────────────────────
  _save() {
    try {
      fs.writeFileSync(BENCHMARK_FILE, JSON.stringify(this.db, null, 2));
    } catch (e) { /* ignore */ }
  }

  // ── 데이터 초기화 ─────────────────────────────────────
  reset(taskType) {
    if (taskType) {
      delete this.db[taskType];
    } else {
      this.db = {};
    }
    this._save();
  }

  // ── 원시 데이터 export ─────────────────────────────────
  export() {
    return JSON.parse(JSON.stringify(this.db));
  }
}

module.exports = ModelBenchmark;
