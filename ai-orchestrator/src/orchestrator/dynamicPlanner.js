// ============================================================
// DynamicPlanner v1 – AI가 파이프라인을 실시간 설계
// ============================================================
//
// 기존 방식:
//   types/index.js에 파이프라인이 하드코딩됨
//   "홈페이지 요청" → 항상 동일한 6스텝
//
// 새 방식:
//   GPT-4o-mini가 요청을 보고 최적 파이프라인을 그때그때 설계
//   "간단한 카페 홈페이지" → 4스텝
//   "복잡한 쇼핑몰 홈페이지" → 8스텝
//   "블로그 1편" → 3스텝 (리서치 생략)
//   "심층 분석 리포트" → 6스텝 (검증 2회)
//
// 병렬 가능 여부도 AI가 판단:
//   { id: 'copy', parallel: true, dependsOn: ['plan'] }
//   → plan 완료 후 copy와 design을 동시 실행 가능
// ============================================================

const { AI_MODELS } = require('../types');

// 사용 가능한 AI 모델 설명 (플래너에게 전달)
const MODEL_PROFILES = `
사용 가능한 AI 모델:
- GPT4O: 전략 기획, 구조 설계, 데이터 분석, JSON 출력에 강함. 비용 보통.
- GPT4O_MINI: 빠른 분류, 검증, 간단한 판단. 매우 저렴, 빠름.
- CLAUDE_SONNET: 자연스러운 한국어 글쓰기, 창의적 카피, 코드 구현에 강함.
- GPT4_1: 매우 긴 문서 처리, 정밀한 코드 리뷰. 비용 높음, 복잡한 작업 전용.
`;

class DynamicPlanner {
  constructor(openaiClient) {
    this.openai = openaiClient;
  }

  // ── 핵심: 요청을 보고 파이프라인 설계 ─────────────────────
  async plan(taskType, taskInfo, memoryContext = null) {
    const memoryHint = memoryContext?.memoryPrompt
      ? `\n사용자 이전 작업 기억:\n${memoryContext.memoryPrompt.substring(0, 300)}`
      : '';

    const taskDesc = taskInfo.topic || taskInfo.industry || taskInfo.subject
      || taskInfo.description || taskInfo.position || taskInfo.purpose || '사용자 요청';

    const systemPrompt = `당신은 AI 오케스트레이션 전문가입니다.
사용자 요청을 분석하여 최적의 AI 실행 파이프라인을 JSON으로 설계하세요.

${MODEL_PROFILES}

설계 원칙:
1. 요청 복잡도에 따라 스텝 수를 조절하세요 (단순: 2~3스텝, 복잡: 5~7스텝)
2. 서로 의존성 없는 스텝은 parallel: true로 표시해 동시 실행 가능하게
3. 각 스텝에 가장 적합한 모델을 배정하세요
4. 마지막 스텝은 항상 assemble 또는 validate (GPT4O_MINI)
5. 한국어 출력이 중요한 스텝은 CLAUDE_SONNET 우선

반환 JSON 형식:
{
  "planSummary": "파이프라인 설계 이유 한 줄",
  "complexity": "simple|normal|complex",
  "estimatedMinutes": 숫자,
  "steps": [
    {
      "id": "스텝고유ID",
      "name": "스텝 이름",
      "model": "GPT4O|GPT4O_MINI|CLAUDE_SONNET|GPT4_1",
      "role": "이 스텝에서 AI의 역할 한 줄",
      "parallel": false,
      "dependsOn": [],
      "outputType": "json|text|html|code|markdown"
    }
  ],
  "feedbackPairs": [
    {"reviewer": "스텝ID", "reviewee": "스텝ID", "condition": "점수<80이면"}
  ]
}`;

    const userPrompt = `작업 타입: ${taskType}
요청 내용: ${taskDesc}
추가 정보: ${JSON.stringify(taskInfo)}${memoryHint}

이 요청에 최적화된 AI 파이프라인을 설계하세요.`;

    try {
      const res = await this.openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1200
      });

      const plan = JSON.parse(res.choices[0].message.content);

      // 검증 및 보완
      return this.validateAndFix(plan, taskType);

    } catch (err) {
      console.warn('DynamicPlanner 실패, 기본 파이프라인 사용:', err.message);
      return this.getDefaultPlan(taskType, taskInfo);
    }
  }

  // ── 설계된 파이프라인 검증 + 보완 ─────────────────────────
  validateAndFix(plan, taskType) {
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return this.getDefaultPlan(taskType, {});
    }

    // 모델 ID 검증
    const validModels = Object.keys(AI_MODELS);
    plan.steps = plan.steps.map((step, i) => ({
      id: step.id || `step_${i}`,
      name: step.name || `스텝 ${i + 1}`,
      model: validModels.includes(step.model) ? step.model : 'GPT4O',
      role: step.role || step.name || '작업 수행',
      parallel: Boolean(step.parallel),
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      outputType: step.outputType || 'text'
    }));

    // 마지막 스텝이 validate/assemble이 아니면 추가
    const last = plan.steps[plan.steps.length - 1];
    if (!['validate', 'assemble', 'finalize'].includes(last.id)) {
      plan.steps.push({
        id: 'validate',
        name: '품질 검증',
        model: 'GPT4O_MINI',
        role: '전체 결과물 품질 검증',
        parallel: false,
        dependsOn: [last.id],
        outputType: 'json'
      });
    }

    plan.feedbackPairs = plan.feedbackPairs || [];
    plan.complexity = plan.complexity || 'normal';
    plan.estimatedMinutes = plan.estimatedMinutes || plan.steps.length * 1.5;

    return plan;
  }

  // ── 기본 파이프라인 (API 실패 폴백) ───────────────────────
  getDefaultPlan(taskType, taskInfo) {
    const defaults = {
      ppt: {
        planSummary: 'PPT 기본 파이프라인: 리서치 → 구조 → 작성 → 검증',
        complexity: 'normal', estimatedMinutes: 4,
        steps: [
          { id: 'research', name: '리서치', model: 'GPT4O', role: '주제 관련 정보 수집', parallel: false, dependsOn: [], outputType: 'text' },
          { id: 'structure', name: '구조 설계', model: 'GPT4O', role: '슬라이드 목차 및 구성 설계', parallel: false, dependsOn: ['research'], outputType: 'json' },
          { id: 'content', name: '내용 작성', model: 'CLAUDE_SONNET', role: '각 슬라이드 상세 내용', parallel: false, dependsOn: ['structure'], outputType: 'markdown' },
          { id: 'assemble', name: '최종 조립', model: 'GPT4O', role: '완성된 PPT 마크다운', parallel: false, dependsOn: ['content'], outputType: 'markdown' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: '품질 검증', parallel: false, dependsOn: ['assemble'], outputType: 'json' }
        ],
        feedbackPairs: [{ reviewer: 'validate', reviewee: 'assemble', condition: '점수<75이면' }]
      },
      website: {
        planSummary: '홈페이지 기본 파이프라인: 기획 → 카피+디자인(병렬) → 코드 → 검증',
        complexity: 'normal', estimatedMinutes: 5,
        steps: [
          { id: 'plan', name: '기획', model: 'GPT4O', role: '사이트 구조·섹션·색상 설계', parallel: false, dependsOn: [], outputType: 'json' },
          { id: 'copy', name: '카피라이팅', model: 'CLAUDE_SONNET', role: '헤드라인·소개글·CTA 작성', parallel: true, dependsOn: ['plan'], outputType: 'text' },
          { id: 'design', name: '디자인 시스템', model: 'GPT4O', role: '색상·폰트·스타일 정의', parallel: true, dependsOn: ['plan'], outputType: 'json' },
          { id: 'code', name: 'HTML 코드', model: 'CLAUDE_SONNET', role: '완전한 HTML/CSS 작성', parallel: false, dependsOn: ['copy', 'design'], outputType: 'html' },
          { id: 'validate', name: '코드 검증', model: 'GPT4O_MINI', role: 'HTML 구조·반응형 검증', parallel: false, dependsOn: ['code'], outputType: 'json' }
        ],
        feedbackPairs: [{ reviewer: 'validate', reviewee: 'code', condition: '점수<75이면' }]
      },
      blog: {
        planSummary: '블로그 기본 파이프라인: 리서치 → 개요 → 작성 → 검증',
        complexity: 'simple', estimatedMinutes: 2.5,
        steps: [
          { id: 'research', name: '리서치', model: 'GPT4O', role: '최신 정보·통계 수집', parallel: false, dependsOn: [], outputType: 'text' },
          { id: 'outline', name: '개요', model: 'GPT4O', role: '글 구조·소제목 설계', parallel: false, dependsOn: ['research'], outputType: 'json' },
          { id: 'write', name: '본문 작성', model: 'CLAUDE_SONNET', role: '자연스러운 블로그 본문', parallel: false, dependsOn: ['outline'], outputType: 'markdown' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: 'SEO·가독성 검증', parallel: false, dependsOn: ['write'], outputType: 'json' }
        ],
        feedbackPairs: []
      },
      report: {
        planSummary: '리포트 기본 파이프라인: 수집 → 분석 → 작성 → 검증',
        complexity: 'normal', estimatedMinutes: 5,
        steps: [
          { id: 'collect', name: '데이터 수집', model: 'GPT4O', role: '시장 데이터·통계 수집', parallel: false, dependsOn: [], outputType: 'text' },
          { id: 'analyze', name: '분석', model: 'GPT4O', role: 'SWOT·인사이트 도출', parallel: false, dependsOn: ['collect'], outputType: 'text' },
          { id: 'write', name: '리포트 작성', model: 'CLAUDE_SONNET', role: '전문적 보고서 작성', parallel: false, dependsOn: ['analyze'], outputType: 'markdown' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: '수치·논리 검증', parallel: false, dependsOn: ['write'], outputType: 'json' }
        ],
        feedbackPairs: []
      },
      code: {
        planSummary: '코드 기본 파이프라인: 설계 → 구현 → 리뷰 → 검증',
        complexity: 'normal', estimatedMinutes: 6,
        steps: [
          { id: 'design', name: '설계', model: 'GPT4O', role: '아키텍처·기술스택 설계', parallel: false, dependsOn: [], outputType: 'json' },
          { id: 'code', name: '코드 구현', model: 'CLAUDE_SONNET', role: '완전한 코드 작성', parallel: false, dependsOn: ['design'], outputType: 'code' },
          { id: 'review', name: '코드 리뷰', model: 'GPT4O', role: '버그·개선사항 검토', parallel: false, dependsOn: ['code'], outputType: 'json' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: '최종 코드 품질 검증', parallel: false, dependsOn: ['review'], outputType: 'json' }
        ],
        feedbackPairs: [{ reviewer: 'review', reviewee: 'code', condition: '점수<80이면' }]
      },
      email: {
        planSummary: '이메일 파이프라인: 작성 → 검증',
        complexity: 'simple', estimatedMinutes: 1.5,
        steps: [
          { id: 'write', name: '이메일 작성', model: 'CLAUDE_SONNET', role: '목적에 맞는 이메일', parallel: false, dependsOn: [], outputType: 'text' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: '톤·내용 검증', parallel: false, dependsOn: ['write'], outputType: 'json' }
        ],
        feedbackPairs: []
      },
      resume: {
        planSummary: '자소서 파이프라인: 구조 설계 → 작성 → 검증',
        complexity: 'normal', estimatedMinutes: 3,
        steps: [
          { id: 'structure', name: '구조 설계', model: 'GPT4O', role: '직무 맞춤 자소서 구조', parallel: false, dependsOn: [], outputType: 'json' },
          { id: 'write', name: '자소서 작성', model: 'CLAUDE_SONNET', role: '설득력 있는 자소서', parallel: false, dependsOn: ['structure'], outputType: 'markdown' },
          { id: 'validate', name: '검증', model: 'GPT4O_MINI', role: '설득력·맞춤법 검증', parallel: false, dependsOn: ['write'], outputType: 'json' }
        ],
        feedbackPairs: []
      }
    };

    return defaults[taskType] || defaults['blog'];
  }
}

module.exports = DynamicPlanner;
