// ============================================================
// 의도 분석 엔진 - 사용자 입력을 분석하여 작업 타입과 필요 정보 파악
// ============================================================

const { TASK_TYPES, QUESTION_TEMPLATES } = require('../types');

class IntentAnalyzer {
  constructor(openaiClient) {
    this.openai = openaiClient;
  }

  // 핵심: 사용자 입력 분석
  async analyze(userInput, conversationHistory = []) {
    const systemPrompt = `당신은 사용자의 요청을 분석하는 AI입니다.
사용자의 입력을 분석하여 JSON 형식으로 반환하세요.

작업 타입:
- ppt: 프레젠테이션, PPT, 발표자료, 슬라이드
- website: 홈페이지, 웹사이트, 랜딩페이지, 사이트
- blog: 블로그, 글쓰기, 포스팅, 기사, 콘텐츠
- report: 분석, 리포트, 보고서, 조사
- code: 코드, 앱, 프로그램, 개발, 만들어줘(기능적)
- email: 이메일, 메일, 편지, 공문
- resume: 자기소개서, 이력서, 자소서, 지원서
- image: 이미지, 사진, 그림, 로고
- unknown: 위에 해당하지 않음

규칙:
1. 추론 가능한 정보는 직접 채워라
2. 반드시 필요한 정보가 없을 때만 needsQuestion을 true로
3. 질문은 딱 1개만
4. 한국어 구어체도 정확히 분석할 것

반환 형식:
{
  "taskType": "작업타입",
  "confidence": 0~100,
  "extractedInfo": {
    "topic": "주제 (있으면)",
    "industry": "업종 (있으면)",
    "description": "설명 (있으면)",
    "style": "스타일 (추론 가능하면)",
    "tone": "톤 (추론 가능하면)"
  },
  "inferredInfo": {
    "audience": "추론된 대상",
    "purpose": "추론된 목적",
    "length": "추론된 분량"
  },
  "needsQuestion": true/false,
  "question": "필요시 1개 질문",
  "reasoning": "분석 근거"
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-4), // 최근 4개 대화만 참고
      { role: 'user', content: userInput }
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5-mini', // 빠르고 저렴한 모델로 분류
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 500
      });

      const result = JSON.parse(response.choices[0].message.content);

      // 신뢰도 낮으면 질문 필요
      if (result.confidence < 60 && !result.needsQuestion) {
        result.needsQuestion = true;
        result.question = QUESTION_TEMPLATES[result.taskType] || QUESTION_TEMPLATES.unknown;
      }

      return result;
    } catch (error) {
      console.error('의도 분석 오류:', error.message || error);
      // API 실패 시 규칙 기반 폴백 분석
      return this.ruleBasedAnalyze(userInput);
    }
  }

  // 규칙 기반 의도 분석 (API 실패 시 폴백)
  ruleBasedAnalyze(userInput) {
    const lower = userInput.toLowerCase();

    const rules = [
      { keywords: ['ppt', '발표', '프레젠테이션', '슬라이드'], type: 'ppt', infoKey: 'topic' },
      { keywords: ['홈페이지', '웹사이트', '사이트', '랜딩', '웹'], type: 'website', infoKey: 'industry' },
      { keywords: ['블로그', '포스팅', '글 써', '기사', '콘텐츠'], type: 'blog', infoKey: 'topic' },
      { keywords: ['분석', '리포트', '보고서', '조사'], type: 'report', infoKey: 'subject' },
      { keywords: ['이메일', '메일', '편지', '공문'], type: 'email', infoKey: 'purpose' },
      { keywords: ['자기소개', '자소서', '이력서', '지원서'], type: 'resume', infoKey: 'position' },
      { keywords: ['코드', '개발', '프로그램', '함수', 'python', 'javascript', 'java', 'api'], type: 'code', infoKey: 'description' },
    ];

    for (const rule of rules) {
      if (rule.keywords.some(k => lower.includes(k))) {
        // 입력에서 주요 정보 추출 (첫 어절들)
        const desc = userInput.replace(/만들어줘|만들어|써줘|작성해줘|해줘|작성|개발|제작/g, '').trim();
        return {
          taskType: rule.type,
          confidence: 75,
          extractedInfo: { [rule.infoKey]: desc, description: desc },
          inferredInfo: {},
          needsQuestion: false,
          question: null,
          reasoning: '규칙 기반 분석 (API 폴백)'
        };
      }
    }

    return {
      taskType: TASK_TYPES.UNKNOWN,
      confidence: 0,
      extractedInfo: {},
      inferredInfo: {},
      needsQuestion: true,
      question: '어떤 결과물이 필요하신가요? 조금 더 자세히 말씀해 주세요.',
      reasoning: '분류 불가'
    };
  }

  // 추가 답변으로 정보 보완
  async supplement(originalInput, question, answer, previousAnalysis) {
    const combined = `원래 요청: ${originalInput}\n질문: ${question}\n답변: ${answer}`;
    const result = await this.analyze(combined);

    // 이전 분석 정보 병합
    return {
      ...result,
      extractedInfo: {
        ...previousAnalysis.extractedInfo,
        ...result.extractedInfo
      },
      inferredInfo: {
        ...previousAnalysis.inferredInfo,
        ...result.inferredInfo
      }
    };
  }
}

module.exports = IntentAnalyzer;
