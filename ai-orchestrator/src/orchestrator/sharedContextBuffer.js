// ============================================================
// SharedContextBuffer – 오케스트레이터가 관리하는 AI 간 공유 기억
// ============================================================
//
// 핵심 문제:
//   GPT(Step1) → Claude(Step2) → GPT(Step3) 으로 작업을 넘길 때
//   각 AI는 서로가 무엇을 했는지 전혀 모른다.
//   API 호출은 완전히 독립적이기 때문.
//
// 해결:
//   오케스트레이터가 "공유 칠판(Shared Blackboard)"을 유지한다.
//   모든 AI 호출 전에 오케스트레이터가 칠판을 보여주고,
//   AI가 작업을 마치면 칠판에 결과를 기록한다.
//
//   [칠판 구조]
//   ┌─────────────────────────────────────────┐
//   │ 작업 목표: 카페 홈페이지 제작            │
//   │                                         │
//   │ Step 1 (GPT-4o, 기획): ✅ 완료          │
//   │   → 섹션: Hero, About, Menu, Contact    │
//   │   → 색상: #6366f1 primary               │
//   │                                         │
//   │ Step 2 (Claude, 카피): ✅ 완료          │
//   │   → Hero: "커피 한 잔의 여유..."        │
//   │                                         │
//   │ Step 3 (Claude, 코드): 🔄 진행 중       │
//   │   → 위 기획+카피를 바탕으로 코드 작성   │
//   └─────────────────────────────────────────┘
//
//   토큰 제한 대응: 결과가 클 때 자동 압축(요약)
// ============================================================

const MAX_STEP_CHARS = 800;   // 스텝당 컨텍스트 최대 글자수
const MAX_TOTAL_CHARS = 4000; // 전체 컨텍스트 최대 글자수

class SharedContextBuffer {
  constructor(taskType, taskInfo, userMemoryPrompt = '') {
    this.taskType = taskType;
    this.taskInfo = taskInfo;
    this.userMemoryPrompt = userMemoryPrompt; // L2+L3 사용자 기억

    // 스텝별 실행 기록
    // { stepId, modelName, role, resultSummary, fullResult, ts }
    this.log = [];

    // 현재 진행 중인 스텝
    this.currentStep = null;
  }

  // ── 스텝 시작 기록 ─────────────────────────────────────────
  startStep(stepId, modelName, role) {
    this.currentStep = { stepId, modelName, role, startTs: Date.now() };
  }

  // ── 스텝 완료 기록 ─────────────────────────────────────────
  completeStep(stepId, modelName, role, result) {
    const entry = {
      stepId,
      modelName,
      role,
      resultSummary: this.compress(result),
      fullResult: result,
      durationMs: Date.now() - (this.currentStep?.startTs || Date.now())
    };
    this.log.push(entry);
    this.currentStep = null;
    return entry;
  }

  // ── 현재 AI에게 전달할 "칠판 컨텍스트" 생성 ───────────────
  // currentStepId: 지금 실행하려는 스텝 (자기 자신은 제외)
  buildHandoffContext(currentStepId) {
    const completedSteps = this.log.filter(e => e.stepId !== currentStepId);

    if (completedSteps.length === 0 && !this.userMemoryPrompt) return '';

    const lines = [];

    // ① 사용자 기억 (L2+L3, 있을 때만)
    if (this.userMemoryPrompt) {
      lines.push('【사용자 기억】');
      lines.push(this.userMemoryPrompt.substring(0, 600));
      lines.push('');
    }

    // ② 작업 목표
    lines.push('【현재 작업 목표】');
    const taskDesc = this.taskInfo.topic
      || this.taskInfo.industry
      || this.taskInfo.subject
      || this.taskInfo.description
      || '사용자 요청';
    lines.push(`${this.getTaskTypeName(this.taskType)}: ${taskDesc}`);
    if (this.taskInfo.style)    lines.push(`스타일: ${this.taskInfo.style}`);
    if (this.taskInfo.tone)     lines.push(`톤: ${this.taskInfo.tone}`);
    if (this.taskInfo.audience) lines.push(`대상: ${this.taskInfo.audience}`);
    lines.push('');

    // ③ 이전 AI들의 작업 결과 (핵심)
    if (completedSteps.length > 0) {
      lines.push('【이전 AI들의 작업 결과 – 반드시 이어받아 작업하세요】');
      completedSteps.forEach((entry, idx) => {
        lines.push(`▶ Step ${idx + 1} | ${entry.modelName} | [${entry.role}]`);
        lines.push(entry.resultSummary);
        lines.push('');
      });
    }

    // ④ 현재 내 역할 강조
    lines.push('【지금 당신의 역할】');
    lines.push('위 내용을 정확히 이어받아 다음 단계를 수행하세요.');
    lines.push('이전 AI가 정의한 구조/내용/스타일을 유지하면서 당신의 전문성을 발휘하세요.');

    const full = lines.join('\n');

    // 전체 길이 제한
    if (full.length > MAX_TOTAL_CHARS) {
      return this.truncateContext(full);
    }
    return full;
  }

  // ── 결과 압축 (토큰 절약) ──────────────────────────────────
  compress(result) {
    if (!result) return '(결과 없음)';

    // 이미 짧으면 그대로
    if (typeof result === 'string' && result.length <= MAX_STEP_CHARS) {
      return result;
    }

    // JSON 객체인 경우 핵심 필드만 추출
    if (typeof result === 'object') {
      return this.compressJSON(result);
    }

    // 긴 텍스트: 앞 400자 + ... + 끝 200자
    const s = String(result);
    if (s.length > MAX_STEP_CHARS) {
      const head = s.substring(0, 500);
      const tail = s.substring(s.length - 200);
      return `${head}\n...(중략)...\n${tail}`;
    }
    return s;
  }

  compressJSON(obj) {
    // 주요 필드만 추출
    const important = {};
    const keysToCopy = [
      'title', 'businessName', 'industry', 'sections', 'colorScheme',
      'keyMessages', 'targetAudience', 'language', 'framework',
      'architecture', 'components', 'theme', 'totalSlides', 'slides',
      'structure', 'sections', 'tone', 'focus', 'headline', 'subheadline'
    ];

    for (const k of keysToCopy) {
      if (obj[k] !== undefined) {
        important[k] = obj[k];
      }
    }

    const str = JSON.stringify(Object.keys(important).length > 0 ? important : obj, null, 1);
    if (str.length > MAX_STEP_CHARS) {
      return str.substring(0, MAX_STEP_CHARS) + '\n...(생략)';
    }
    return str;
  }

  truncateContext(text) {
    // 중간 부분을 축약
    const lines = text.split('\n');
    const head = lines.slice(0, 15).join('\n');
    const tail = lines.slice(-10).join('\n');
    return head + '\n...(중략)...\n' + tail;
  }

  // ── 전체 스텝 결과 반환 (최종 조립용) ─────────────────────
  getAllResults() {
    const results = {};
    this.log.forEach(entry => {
      results[entry.stepId] = entry.fullResult;
    });
    return results;
  }

  // ── 디버그 덤프 ────────────────────────────────────────────
  dump() {
    return {
      taskType: this.taskType,
      steps: this.log.map(e => ({
        stepId: e.stepId,
        model: e.modelName,
        role: e.role,
        durationMs: e.durationMs,
        resultLength: String(e.fullResult || '').length
      }))
    };
  }

  getTaskTypeName(type) {
    const n = { ppt:'PPT', website:'홈페이지', blog:'블로그',
                report:'분석리포트', code:'코드개발', email:'이메일', resume:'자기소개서' };
    return n[type] || type;
  }
}

module.exports = SharedContextBuffer;
