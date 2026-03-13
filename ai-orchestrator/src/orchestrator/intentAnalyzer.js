// ============================================================
// 의도 분석 엔진 - 사용자 입력을 분석하여 작업 타입과 필요 정보 파악
// v2: strategy 필드 추가 — fast / balanced / deep
// ============================================================

const { TASK_TYPES, QUESTION_TEMPLATES } = require('../types');

// ── Strategy 분류 기준 ──────────────────────────────────────
// fast     : 인사, 짧은 질문, 번역, 단순 사실 질문
// balanced : 일반 설명, 비교, 분석, 일반 대화
// deep     : 코딩, 시스템 설계, 전략, 복잡한 분석, 멀티스텝 추론

class IntentAnalyzer {
  constructor(openaiClient) {
    this.openai = openaiClient;
  }

  // 핵심: 사용자 입력 분석
  async analyze(userInput, conversationHistory = []) {
    const systemPrompt = `당신은 사용자의 요청을 분석하는 AI입니다.
사용자의 입력을 분석하여 JSON 형식으로 반환하세요.

작업 타입 (반드시 아래 기준으로 정확히 분류):
- ppt: 프레젠테이션, PPT, 발표자료, 슬라이드 만들기
- website: 홈페이지, 웹사이트, 랜딩페이지, 사이트 제작
- blog: 블로그, 글쓰기, 포스팅, 기사, 콘텐츠 작성
- report: 분석 리포트, 보고서, 조사 결과 작성
- code: 코드 작성/수정/리뷰, 프로그램/앱/함수/API 개발, 스크립트, 버그 수정. 반드시 실행 가능한 코드 결과물이 목적일 때만
- email: 이메일, 메일, 편지, 공문 작성
- resume: 자기소개서, 이력서, 자소서, 지원서 작성
- image: 이미지 생성, 그림 그리기, 로고 디자인, 시각적 결과물 요청
- crawl: 웹 크롤링, 스크래핑, URL 데이터 수집, 특정 사이트 정보 가져오기 (반드시 URL이 명시되거나 크롤링/스크래핑 단어가 있을 때만)
- vision: 이미지/사진 분석, OCR, 이미지 내용 인식, 비전 분석
- stt: 음성 인식, 음성→텍스트, 자막 생성, 오디오 파일 변환
- summarize: 요약, 정리, 핵심 정리, 간단히 설명, 요약해줘, 핵심만, 짧게 정리
- translate: 번역, 통역, ~로 번역해줘, 한국어로/영어로/일본어로 바꿔줘, 해석해줘
- analysis: 분석해줘, ~를 분석, 원인 분석, 현황 분석, 트렌드 분석 (리포트 작성이 아닌 분석 자체)
- extract: 정보 추출, 키워드 추출, 핵심어 추출, 개체명 인식, 데이터 추출
- classify: 분류, 카테고리 분류, 감정 분석, 긍부정 분류, 텍스트 분류
- ppt_file: .pptx 파일 다운로드, 파워포인트 파일 생성/저장, "pptx 만들어줘", "ppt 파일 다운"
- pdf: pdf 파일 생성/저장/변환, "pdf로 만들어줘", "pdf 저장해줘"
- excel: 엑셀 파일 생성, xlsx, 스프레드시트, "표 엑셀로", "엑셀 파일"
- youtube: 유튜브 영상 요약, youtube.com 또는 youtu.be URL + 요약
- qrcode: QR코드 생성, 큐알코드, "qr코드 만들어줘"
- tts: 텍스트를 음성으로, "읽어줘", "mp3로 변환", TTS, "목소리로"
- palette: 색상 팔레트 생성, 브랜드 색상 추천, "컬러 팔레트"
- regex: 정규식 생성/작성, "정규표현식", "패턴 만들어줘", regexp
- summarycard: 요약 카드 이미지, 카드뉴스, 인포그래픽, "카드로 만들어줘"
- chat2pdf: 채팅/대화 PDF 저장, "대화 내보내기", "채팅 저장"
- unknown: 일반 질문, 대화, 정보 조회, 위에 해당하지 않는 모든 것

중요 구분 규칙:
- "코드 짜줘", "함수 만들어줘", "스크립트 작성" → code
- "앱 만들어줘" 단독 → code (웹앱이면 website 고려)
- "이미지 분석해줘", "사진 분석해줘" → vision
- "그림 그려줘", "이미지 생성해줘", "이미지 만들어줘" → image
- "크롤링해줘", "스크래핑해줘", URL + "수집/가져와" → crawl (URL이 있거나 크롤링 단어 명시 시에만)
- "검색해줘", "찾아줘", URL 없이 정보 조회 → analysis 또는 unknown (crawl 절대 아님)
- "음성 인식", "받아쓰기", 오디오 파일 처리 → stt
- "요약해줘", "간단히 정리해줘", "핵심만 알려줘" → summarize
- "번역해줘", "~로 번역", "한국어로 바꿔줘" → translate
- "분석해줘" (결과물 작성이 아닌 분석 자체) → analysis
- "검색해줘", "찾아줘", "트렌드 검색", "최신 트렌드", "최신 뉴스", "뉴스 알려줘" → analysis (URL 없이 정보 조회 시; crawl 아님!)
- "크롤링해줘", "스크래핑해줘", URL + "수집/가져와/크롤" → crawl (반드시 URL이 있거나 크롤링을 명시할 때만)
- "키워드 추출", "개체명 인식" → extract
- "분류해줘", "감정 분석" → classify
- 일반 질문/대화/정보요청 → unknown
- "pptx 파일", "파워포인트 파일 다운" → ppt_file
- "pdf 만들어줘", "pdf로 저장" → pdf
- "엑셀 파일", "xlsx 만들어줘" → excel
- youtube.com/youtu.be URL + 요약/정리 → youtube
- "qr코드", "큐알코드" → qrcode
- "읽어줘", "tts", "음성으로 변환", "mp3로" → tts
- "색상 팔레트", "컬러 추천" → palette
- "정규식", "정규표현식", "regexp" → regex
- "요약 카드", "카드뉴스" → summarycard
- "채팅 저장", "대화 pdf" → chat2pdf

=== strategy 분류 기준 (반드시 포함) ===
fast — 아래 조건 중 하나라도 해당:
  - 인사말 (안녕, 안녕하세요, hi, hello 등)
  - 5단어 이하 짧은 질문
  - 단순 번역 (짧은 문장)
  - 단순 사실 질문 (예: "한국 수도가 어디야?", "오늘 날씨 어때?")
  - 감사/작별 인사
  - yes/no로 답할 수 있는 질문
  - taskType이 translate / qrcode / tts / palette / regex / qrcode 인 경우

balanced — 아래 조건 중 하나라도 해당:
  - 개념·기술 설명 요청 (예: "AI가 뭐야?", "클라우드 설명해줘")
  - 비교 질문 (예: "A와 B 차이가 뭐야?")
  - 일반적인 분석·요약 요청
  - 블로그·이메일·보고서·PPT 등 문서 작성
  - 2~5문장 수준의 일반 대화
  - taskType이 blog / email / resume / report / summarize / analysis / ppt / ppt_file / pdf / excel 인 경우

deep — 아래 조건 중 하나라도 해당:
  - 코드 작성·리뷰·디버깅·아키텍처 설계
  - 시스템 설계 / 인프라 설계
  - 비즈니스 전략 수립
  - 멀티스텝 추론이 필요한 복잡한 분석
  - 긴 글 생성 (논문, 기술 문서, 복잡한 보고서)
  - 수학·알고리즘 문제
  - 비교 + 심층 분석이 동시에 필요한 경우
  - taskType이 code / website / vision 인 경우
  - 메시지에 "설계", "아키텍처", "최적화", "알고리즘", "구현", "전략 수립", "심층" 포함

규칙:
1. 추론 가능한 정보는 직접 채워라
2. 반드시 필요한 정보가 없을 때만 needsQuestion을 true로
3. 질문은 딱 1개만
4. 한국어 구어체도 정확히 분석할 것
5. code와 image를 website/report로 절대 오분류하지 말 것
6. strategy는 반드시 "fast" | "balanced" | "deep" 중 하나

반환 형식:
{
  "taskType": "작업타입",
  "strategy": "fast|balanced|deep",
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
        model: 'gpt-4o-mini', // 분류 전용 — 빠르고 저렴
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.2,  // 분류 일관성을 위해 0.3 → 0.2
        max_tokens: 600    // strategy 필드 추가로 500 → 600
      });

      const result = JSON.parse(response.choices[0].message.content);

      // strategy 누락 시 규칙 기반 폴백으로 보정
      if (!result.strategy) {
        result.strategy = _inferStrategy(result.taskType, userInput);
      }

      // ── crawl 오분류 교정 ─────────────────────────────────────────────────
      // URL 없이 "검색해줘/트렌드/뉴스 알려줘" → crawl 아니라 analysis/chat
      if (result.taskType === 'crawl') {
        const hasUrl = /https?:\/\//.test(userInput);
        const CRAWL_ONLY_KEYWORDS = ['크롤링', '스크래핑', '스크랩', '웹 수집', 'crawl', 'scrape'];
        const isTrueCrawl = hasUrl || CRAWL_ONLY_KEYWORDS.some(k => userInput.toLowerCase().includes(k));
        if (!isTrueCrawl) {
          // URL도 없고 크롤링 명시어도 없으면 → analysis 또는 chat으로 교정
          const SEARCH_KEYWORDS = ['검색', '트렌드', '뉴스', '최신', '찾아', '알려'];
          result.taskType = SEARCH_KEYWORDS.some(k => userInput.includes(k)) ? 'analysis' : 'chat';
          result.strategy = result.strategy || 'balanced';
        }
      }

      // ── strategy 오분류 교정 (LLM이 잘못 분류한 경우 강제 보정) ──────────
      // taskType이 명백히 deep인데 fast/balanced로 분류된 경우
      const FORCE_DEEP_TYPES = new Set(['code', 'website', 'vision', 'report', 'analysis']);
      const DEEP_OVERRIDE_KEYWORDS = [
        '알고리즘', '구현', '아키텍처', '설계', '최적화', '시간복잡도', '공간복잡도',
        '빅오', 'big-o', '재귀', '트리', '그래프', '동적 프로그래밍', '자료구조',
        '마이크로서비스', '인프라', '데이터베이스 설계', 'saas', 'architecture',
        '전략 수립', '심층', '멀티스텝', '단계적 분석', '단계별'
      ];
      if (result.strategy !== 'deep') {
        const lowerInput = userInput.toLowerCase();
        const forceDeep = FORCE_DEEP_TYPES.has(result.taskType) ||
          DEEP_OVERRIDE_KEYWORDS.some(k => lowerInput.includes(k));
        if (forceDeep) {
          result.strategy = 'deep';
        }
      }

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
      // 먼저 구체적인 패턴 우선 처리
      { keywords: ['요약해', '요약 해', '요약 정리', '핵심만', '간단히 정리', '짧게 정리', '정리해줘', '요약'], type: 'summarize', infoKey: 'text' },
      { keywords: ['번역해', '번역 해', '로 번역', '로 바꿔', '통역', '해석해줘', '영어로', '한국어로', '일본어로', '중국어로', '번역'], type: 'translate', infoKey: 'text' },
      { keywords: ['원인 분석', '현황 분석', '트렌드 분석', '시장 분석', '경쟁 분석', '분석해줘', '분석해 줘', '를 분석', '트렌드 검색', '최신 트렌드', '최신 뉴스', '뉴스 알려', '검색해줘', '검색해 줘', '찾아줘', '찾아 줘'], type: 'analysis', infoKey: 'topic' },
      { keywords: ['키워드 추출', '개체명 인식', '핵심어 추출', '정보 추출', 'ner', '엔티티'], type: 'extract', infoKey: 'text' },
      { keywords: ['감정 분석', '긍부정', '텍스트 분류', '카테고리 분류', '분류해줘'], type: 'classify', infoKey: 'text' },
      { keywords: ['ppt', '발표', '프레젠테이션', '슬라이드'], type: 'ppt', infoKey: 'topic' },
      { keywords: ['홈페이지', '웹사이트', '사이트', '랜딩', '웹'], type: 'website', infoKey: 'industry' },
      { keywords: ['블로그', '포스팅', '글 써', '기사', '콘텐츠'], type: 'blog', infoKey: 'topic' },
      { keywords: ['분석 리포트', '리포트', '보고서', '조사 결과'], type: 'report', infoKey: 'subject' },
      { keywords: ['이메일', '메일', '편지', '공문'], type: 'email', infoKey: 'purpose' },
      { keywords: ['자기소개', '자소서', '이력서', '지원서'], type: 'resume', infoKey: 'position' },
      { keywords: ['코드', '개발', '프로그램', '함수', 'python', 'javascript', 'java', 'api', '스크립트', '버그', '디버그', '리뷰'], type: 'code', infoKey: 'description' },
      { keywords: ['이미지 생성', '그림 그려', '로고 만들', '디자인 만들', '이미지 만들', '사진 만들', '그림 만들', '이미지 그려', '사진 생성', '그림 생성'], type: 'image', infoKey: 'description' },
      { keywords: ['크롤링', '크롤', '스크래핑', '스크랩', '웹 수집', '데이터 수집', 'crawl', 'scrape'], type: 'crawl', infoKey: 'url' },
      { keywords: ['이미지 분석', '사진 분석', '이미지 인식', '비전 분석', 'vision', '이미지 보여', '사진 보여', '이미지 읽', '사진 읽'], type: 'vision', infoKey: 'imageUrl' },
      { keywords: ['음성 변환', '음성 텍스트', '음성 인식', '받아쓰기', 'stt', 'speech to text', '자막 생성', '오디오 변환'], type: 'stt', infoKey: 'audioUrl' },
      // ── 신규 툴 키워드 ────────────────────────────────────────────────────
      { keywords: ['pptx', 'ppt 파일', '파워포인트 파일', '슬라이드 파일', '발표 파일 만들', 'ppt 다운'], type: 'ppt_file', infoKey: 'topic' },
      { keywords: ['pdf 만들', 'pdf로 변환', 'pdf 저장', 'pdf 생성', '문서 pdf', 'pdf 파일'], type: 'pdf', infoKey: 'topic' },
      { keywords: ['엑셀', 'xlsx', '스프레드시트', '표 만들어', '엑셀 파일', 'excel'], type: 'excel', infoKey: 'topic' },
      { keywords: ['유튜브 요약', 'youtube 요약', 'yt 요약', '유튜브 영상 요약', 'youtu.be', 'youtube.com'], type: 'youtube', infoKey: 'url' },
      { keywords: ['qr코드', 'qr 코드', 'qrcode', 'qr 생성', '큐알코드', '큐알 코드'], type: 'qrcode', infoKey: 'text' },
      { keywords: ['배경 제거', '배경제거', '누끼', 'remove bg', 'removebg', '배경 없애'], type: 'removebg', infoKey: 'imageUrl' },
      { keywords: ['음성으로 읽어', 'tts', '텍스트 음성', '읽어줘', '목소리로', '음성 파일', 'mp3로'], type: 'tts', infoKey: 'text' },
      { keywords: ['색상 팔레트', '컬러 팔레트', '색깔 추천', '브랜드 색상', '색상 추천', 'color palette'], type: 'palette', infoKey: 'theme' },
      { keywords: ['정규식', '정규표현식', 'regex', 'regexp', '패턴 만들어'], type: 'regex', infoKey: 'description' },
      { keywords: ['요약 카드', '카드 이미지', 'summary card', '인포그래픽', '카드뉴스'], type: 'summarycard', infoKey: 'content' },
      { keywords: ['대화 저장', '채팅 저장', '대화 내보내기', '채팅 pdf', '대화 pdf'], type: 'chat2pdf', infoKey: 'title' },
    ];

    for (const rule of rules) {
      if (rule.keywords.some(k => lower.includes(k))) {
        const desc = userInput.replace(/만들어줘|만들어|써줘|작성해줘|해줘|작성|개발|제작/g, '').trim();
        const strategy = _inferStrategy(rule.type, userInput);
        return {
          taskType: rule.type,
          strategy,
          confidence: 75,
          extractedInfo: { [rule.infoKey]: desc, description: desc },
          inferredInfo: {},
          needsQuestion: false,
          question: null,
          reasoning: `규칙 기반 분석 (API 폴백) — strategy: ${strategy}`
        };
      }
    }

    return {
      taskType: TASK_TYPES.UNKNOWN,
      strategy: 'balanced',
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

// ── 규칙 기반 strategy 추론 (LLM 폴백 / 누락 보정용) ─────────────────
function _inferStrategy(taskType, userInput = '') {
  // deep: 코드·설계·복잡 분석
  const deepTypes = new Set(['code', 'website', 'vision', 'report', 'analysis']);
  const deepKeywords = [
    '설계', '아키텍처', '최적화', '알고리즘', '구현', '전략 수립', '심층',
    'architecture', 'design', 'optimize', 'implement',
    '시간복잡도', '공간복잡도', '빅오', '재귀', '트리', '그래프',
    '동적 프로그래밍', '자료구조', '마이크로서비스', '인프라', 'saas',
    '단계별', '단계적', '멀티스텝'
  ];

  // fast: 번역·단순 도구·인사말
  const fastTypes = new Set(['translate', 'qrcode', 'tts', 'palette', 'regex', 'removebg', 'stt']);
  const fastKeywords = ['안녕', '안녕하세요', 'hi', 'hello', '감사', '고마워', '수고', '잘가', 'bye'];

  const lower = userInput.toLowerCase();
  const wordCount = userInput.trim().split(/\s+/).length;

  if (deepTypes.has(taskType) || deepKeywords.some(k => lower.includes(k))) return 'deep';
  if (fastTypes.has(taskType) || fastKeywords.some(k => lower.includes(k))) return 'fast';
  if (wordCount <= 5) return 'fast';   // 5단어 이하 → fast
  if (wordCount >= 20) return 'deep';  // 20단어 이상 → deep

  // balanced: 문서 작성 계열
  const balancedTypes = new Set(['blog', 'email', 'resume', 'report', 'summarize', 'analysis', 'ppt', 'ppt_file', 'pdf', 'excel', 'extract', 'classify', 'youtube', 'summarycard', 'chat2pdf']);
  if (balancedTypes.has(taskType)) return 'balanced';

  return 'balanced'; // 기본값
}

module.exports = IntentAnalyzer;
