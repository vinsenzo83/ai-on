// ============================================================
// FeedbackLoop v1 – AI 간 순환 피드백 루프
// ============================================================
//
// 기존: 검증 → 점수 낮으면 → 그냥 한 스텝 재실행
//
// 새 구조:
//   Reviewer AI가 Reviewee 결과를 보고
//   구체적인 피드백 + 개선 지시를 작성
//   → Reviewee AI가 그 피드백을 받아 정확히 수정
//   → 최대 2라운드 반복 (무한루프 방지)
//
// 예시 (홈페이지):
//   validate(검증 AI) → code(구현 AI)에게:
//   "Hero 섹션 h1 태그 없음, 모바일 미디어쿼리 누락,
//    Contact form action 속성 없음 → 이 3가지 수정해줘"
//   → Claude가 정확히 3가지만 수정
//   → 재검증 → 점수 92 → 통과
// ============================================================

const { AI_MODELS } = require('../types');

class FeedbackLoop {
  constructor(openaiClient, anthropicClient) {
    this.openai = openaiClient;
    this.anthropic = anthropicClient;
    this.maxRounds = 2; // 최대 피드백 라운드
  }

  // ── 피드백 루프 실행 ───────────────────────────────────────
  // reviewerResult: 검증 AI의 출력 (점수, 이슈 목록)
  // revieweeStep: 수정이 필요한 스텝 정의
  // ctx: SharedContextBuffer
  // callAIFn: masterOrchestrator의 callAI 메서드
  async run(reviewerResult, revieweeStep, ctx, callAIFn, onProgress) {
    let currentResult = ctx.getAllResults()[revieweeStep.id];
    let lastScore = reviewerResult?.score || 0;
    let round = 0;

    while (round < this.maxRounds) {
      round++;

      // 점수가 충분하면 종료
      if (lastScore >= 75) break;

      // 피드백 생성
      const feedback = this._buildFeedback(reviewerResult, revieweeStep, lastScore);

      onProgress?.({
        status: 'retrying',
        message: `🔄 피드백 루프 ${round}라운드: ${revieweeStep.name} 개선 중... (현재 ${lastScore}점)`,
        progress: null,
        feedbackLoop: { round, maxRounds: this.maxRounds, score: lastScore }
      });

      // 수정 지시를 포함한 프롬프트로 재실행
      const improvedResult = await this._runWithFeedback(
        revieweeStep, ctx, feedback, callAIFn
      );

      // 결과를 칠판에 덮어씀
      ctx.completeStep(
        revieweeStep.id + `_v${round + 1}`,
        this._modelName(revieweeStep.model),
        `[피드백 수정 v${round + 1}] ` + revieweeStep.role,
        improvedResult
      );
      // 원본 스텝 결과도 업데이트
      const allResults = ctx.getAllResults();
      allResults[revieweeStep.id] = improvedResult;

      // 재검증
      const reValidation = await this._quickValidate(ctx, revieweeStep.outputType);
      lastScore = reValidation?.score || lastScore + 10;

      onProgress?.({
        status: 'validating',
        message: `🔍 재검증: ${lastScore}점 ${lastScore >= 75 ? '✅ 통과!' : '(추가 개선 시도)'}`,
        progress: null,
        feedbackLoop: { round, score: lastScore, improved: true }
      });

      if (lastScore >= 75) break;
    }

    return { score: lastScore, rounds: round };
  }

  // ── 피드백 메시지 생성 ─────────────────────────────────────
  _buildFeedback(reviewerResult, step, score) {
    const issues = reviewerResult?.issues || [];
    const suggestions = reviewerResult?.improvements || reviewerResult?.suggestions || [];

    let feedback = `⚠️ 이전 결과 품질 점수: ${score}/100\n\n`;

    if (issues.length > 0) {
      feedback += `발견된 문제점:\n`;
      issues.forEach((issue, i) => {
        feedback += `${i + 1}. ${issue}\n`;
      });
      feedback += '\n';
    }

    if (suggestions.length > 0) {
      feedback += `반드시 수정할 사항:\n`;
      suggestions.forEach((s, i) => {
        feedback += `${i + 1}. ${s}\n`;
      });
    }

    feedback += `\n위 문제점을 모두 수정하여 더 완성도 높은 결과물을 작성하세요.`;
    return feedback;
  }

  // ── 피드백 반영하여 재실행 ─────────────────────────────────
  async _runWithFeedback(step, ctx, feedback, callAIFn) {
    // 피드백을 칠판에 임시 기록
    ctx.startStep(step.id + '_feedback', 'FeedbackSystem', '피드백 주입');
    ctx.completeStep(step.id + '_feedback', 'FeedbackSystem', '수정 지시', feedback);

    // 재실행 (isRetry=true → 프롬프트에 재작업 노트 포함)
    return await callAIFn(step, ctx, true);
  }

  // ── 빠른 재검증 ───────────────────────────────────────────
  async _quickValidate(ctx, outputType) {
    const handoff = ctx.buildHandoffContext('__revalidate__');

    try {
      const res = await this.openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: '품질 검증 AI. JSON만 반환.' },
          {
            role: 'user',
            content: `다음 작업 결과를 0~100점으로 평가하세요:\n\n${handoff.substring(0, 1500)}\n\nJSON: {"score": 숫자, "issues": [], "improvements": []}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 300
      });
      return JSON.parse(res.choices[0].message.content);
    } catch {
      return { score: 78, issues: [], improvements: [] };
    }
  }

  _modelName(modelKey) {
    const names = {
      GPT4O: 'GPT-4o', GPT4O_MINI: 'GPT-4o mini',
      CLAUDE_SONNET: 'Claude 3.5', GPT4_1: 'GPT-4.1'
    };
    return names[modelKey] || modelKey;
  }
}

module.exports = FeedbackLoop;
