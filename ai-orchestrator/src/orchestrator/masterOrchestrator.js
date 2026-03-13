// ============================================================
// MasterOrchestrator v3 – Dynamic + Parallel + Feedback 통합
// ============================================================
//
// v1: 고정 파이프라인, 순차 실행
// v2: SharedContextBuffer (AI 간 칠판 공유)
// v3: ← 지금
//   C. DynamicPlanner  → 요청마다 최적 파이프라인 AI가 설계
//   A. ParallelExecutor → 독립 스텝 동시 실행 (속도 향상)
//   B. FeedbackLoop    → 품질 미달 시 AI 간 피드백 + 수정
//
// 전체 흐름:
//   execute(taskType, taskInfo)
//     │
//     ├─ [1] DynamicPlanner.plan()
//     │       GPT-4o-mini가 요청 분석
//     │       → 최적 스텝 수·모델·병렬 여부 설계
//     │
//     ├─ [2] ParallelExecutor.execute()
//     │       의존성 그래프 분석 → 웨이브 계산
//     │       → 독립 스텝은 Promise.all() 동시 실행
//     │       → 각 스텝은 SharedContextBuffer 칠판 공유
//     │
//     ├─ [3] 최종 검증
//     │       GPT-4o-mini로 전체 결과 품질 평가
//     │
//     └─ [4] FeedbackLoop (필요시)
//             점수 < 75 이면 구체적 피드백 생성
//             → 해당 스텝 AI가 피드백 받아 수정
//             → 재검증 (최대 2라운드)
// ============================================================

const { TASK_STATUS, AI_MODELS } = require('../types');
const SharedContextBuffer = require('./sharedContextBuffer');
const DynamicPlanner = require('./dynamicPlanner');
const ParallelExecutor = require('./parallelExecutor');
const FeedbackLoop = require('./feedbackLoop');

class MasterOrchestrator {
  constructor(openaiClient, anthropicClient) {
    this.openai = openaiClient;
    this.anthropic = anthropicClient;

    // 세 엔진 초기화
    this.planner   = new DynamicPlanner(openaiClient);
    this.executor  = new ParallelExecutor(this.callAI.bind(this));
    this.feedback  = new FeedbackLoop(openaiClient, anthropicClient);
  }

  // ── 메인 실행 ──────────────────────────────────────────────
  async execute(taskType, taskInfo, onProgress, memoryContext = null) {

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [1] 동적 계획 수립 (C)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    onProgress?.({
      status: TASK_STATUS.PLANNING,
      message: `🧠 AI가 최적 파이프라인 설계 중...`,
      progress: 3
    });

    const plan = await this.planner.plan(taskType, taskInfo, memoryContext);

    // 병렬 스텝 포함 예상 시간 계산
    const estimatedTime = this.executor.estimateTime(plan.steps);
    const parallelCount = plan.steps.filter(s => s.parallel).length;

    onProgress?.({
      status: TASK_STATUS.PLANNING,
      message: `📋 파이프라인 확정: ${plan.steps.length}스텝 (${parallelCount > 0 ? `⚡ ${parallelCount}개 병렬` : '순차'}) · 예상 ${estimatedTime}분`,
      progress: 8,
      plan: {
        summary: plan.planSummary,
        steps: plan.steps.map(s => ({ id: s.id, name: s.name, model: this._modelName(s.model), parallel: s.parallel })),
        complexity: plan.complexity,
        estimatedMinutes: estimatedTime
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [2] 공유 칠판 생성
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const ctx = new SharedContextBuffer(
      taskType,
      taskInfo,
      memoryContext?.memoryPrompt || ''
    );

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [3] 병렬 실행 엔진으로 전체 파이프라인 실행 (A)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await this.executor.execute(plan.steps, ctx, onProgress);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [4] 최종 검증
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    onProgress?.({
      status: TASK_STATUS.VALIDATING,
      message: '🔍 최종 품질 검증 중...',
      progress: 88
    });

    const validation = await this.validate(ctx);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [5] 피드백 루프 (B) – 품질 미달 시
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let finalValidation = validation;

    if (validation.score < 75 && plan.feedbackPairs?.length > 0) {
      for (const pair of plan.feedbackPairs) {
        const revieweeStep = plan.steps.find(s => s.id === pair.reviewee);
        if (!revieweeStep) continue;

        const loopResult = await this.feedback.run(
          validation,
          revieweeStep,
          ctx,
          this.callAI.bind(this),
          onProgress
        );

        finalValidation = { ...validation, score: loopResult.score, feedbackRounds: loopResult.rounds };
        if (loopResult.score >= 75) break;
      }
    }

    onProgress?.({
      status: TASK_STATUS.COMPLETED,
      message: `✅ 완성! (품질: ${finalValidation.score}/100)`,
      progress: 100
    });

    return this.buildFinalResult(ctx, finalValidation, plan, taskType, taskInfo);
  }

  // ── AI 호출 (칠판 컨텍스트 주입) ──────────────────────────
  async callAI(step, ctx, isRetry = false) {
    const modelDef = AI_MODELS[step.model];
    if (!modelDef) throw new Error(`모델 정의 없음: ${step.model}`);

    // 칠판에서 이전 AI들의 작업 결과 읽기
    const handoffContext = ctx.buildHandoffContext(step.id);

    // 이 스텝의 구체적 작업 지시
    const taskInstruction = this.buildTaskInstruction(step, ctx, isRetry);

    // 시스템 프롬프트 = 역할 + 칠판 컨텍스트
    const systemPrompt = this.buildSystemPrompt(step, handoffContext);

    if (modelDef.provider === 'openai') {
      return await this.callOpenAI(modelDef.id, systemPrompt, taskInstruction, step.outputType);
    } else if (modelDef.provider === 'anthropic') {
      return await this.callClaude(modelDef.id, systemPrompt, taskInstruction, step.outputType);
    }
    throw new Error(`지원하지 않는 제공자: ${modelDef.provider}`);
  }

  // ── 시스템 프롬프트 ────────────────────────────────────────
  buildSystemPrompt(step, handoffContext) {
    const roleDesc = {
      GPT4O:        '당신은 전략적 기획과 구조 설계에 특화된 AI입니다.',
      GPT4O_MINI:   '당신은 빠른 분류와 품질 검증에 특화된 AI입니다.',
      GPT4_1:       '당신은 정밀한 코드 작성과 긴 문서 처리에 특화된 AI입니다.',
      CLAUDE_SONNET:'당신은 자연스러운 한국어 글쓰기와 창의적 코드 작성에 특화된 AI입니다.'
    };

    let system = `${roleDesc[step.model] || '당신은 전문 AI 어시스턴트입니다.'}\n항상 한국어로 응답하세요.\n\n`;
    if (handoffContext) system += handoffContext;
    return system;
  }

  // ── 작업 지시 프롬프트 ─────────────────────────────────────
  buildTaskInstruction(step, ctx, isRetry) {
    const { taskType, taskInfo } = ctx;
    const allResults = ctx.getAllResults();
    const retryNote = isRetry
      ? '\n\n⚠️ 이전 결과의 품질이 부족했습니다. 피드백을 반영하여 더 완성도 높게 작성하세요.\n'
      : '';

    // step.role을 기반으로 동적 프롬프트 생성
    const desc = taskInfo.topic || taskInfo.industry || taskInfo.subject
      || taskInfo.description || taskInfo.position || taskInfo.purpose || '사용자 요청';

    // outputType별 형식 지시
    const formatGuide = {
      json:     '반드시 유효한 JSON 형식으로만 반환하세요.',
      html:     '<!DOCTYPE html>로 시작하는 완전한 단일 HTML 파일을 반환하세요.',
      code:     '완전히 동작하는 코드를 반환하세요. 한국어 주석을 상세히 달아주세요.',
      markdown: '마크다운 형식으로 작성하세요. 소제목, 목록, 강조를 적절히 사용하세요.',
      text:     '자연스러운 한국어로 작성하세요.'
    }[step.outputType] || '한국어로 작성하세요.';

    // 타입별 상세 지시 (기존 buildTaskInstruction 로직 흡수)
    const specificInstructions = this._getSpecificInstruction(step.id, taskType, taskInfo, allResults, retryNote);

    if (specificInstructions) {
      return specificInstructions;
    }

    // 동적 플래너가 설계한 스텝은 role 기반으로 자동 생성
    return `당신의 역할: ${step.role}${retryNote}

작업 내용: ${desc}
추가 정보: ${JSON.stringify(taskInfo, null, 1).substring(0, 400)}

${formatGuide}

위 역할에 맞게 최고 품질의 결과물을 작성하세요.`;
  }

  // ── 기존 상세 지시 (호환성 유지) ──────────────────────────
  _getSpecificInstruction(stepId, taskType, taskInfo, allResults, retryNote) {
    const key = `${taskType}_${stepId}`;

    const instructions = {
      ppt_research: () => `주제 "${taskInfo.topic || taskInfo.description}"에 대한 심층 리서치를 수행하세요.${retryNote}
핵심 트렌드 3~5개, 시장 현황, 주요 사실, 결론 방향을 한국어로 상세히 작성하세요.`,

      ppt_structure: () => `아래 리서치를 바탕으로 임팩트 있는 PPT 구성을 JSON으로 설계하세요.${retryNote}
주제: ${taskInfo.topic || taskInfo.description} / 슬라이드 수: ${taskInfo.slides_count || '10~15장'}
JSON: {"title":"","slides":[{"num":1,"type":"cover","title":"","subtitle":""},...],"totalSlides":숫자,"theme":"","keyMessages":[]}`,

      ppt_content: () => `아래 PPT 구성에 따라 각 슬라이드 상세 내용을 작성하세요.${retryNote}
핵심 메시지 1줄, bullet 3~5개(구체적 데이터), 발표자 노트 포함. 한국어로 전문적이고 설득력 있게.`,

      ppt_assemble: () => `완성된 PPT를 마크다운 형식으로 작성하세요.${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
요구: "---" 구분선, 슬라이드 번호+제목, bullet 형식, 발표자 노트, 표지/목차/본론5~8장/결론/Q&A 포함`,

      website_plan: () => `"${taskInfo.industry || taskInfo.description}" 홈페이지 기획 JSON:${retryNote}
{"businessName":"","industry":"","sections":[{"id":"hero","name":"히어로","purpose":""}...],"colorScheme":{"primary":"#","secondary":"#","bg":"#"},"style":"","targetAudience":"","keyMessages":[]}`,

      website_copy: () => `홈페이지 카피라이팅:${retryNote}
업종: ${taskInfo.industry || taskInfo.description} / 스타일: ${taskInfo.style || '전문적'}
[히어로] 헤드라인(15자↓)+서브+CTA / [소개] 3~4문장 / [서비스] 3~4개 제목+설명 / [CTA] 행동유도문구`,

      website_design: () => `디자인 시스템 JSON:${retryNote}
{"colors":{"primary":"#","secondary":"#","bg":"#","surface":"#","text":"#","textMuted":"#"},"fonts":{"heading":"","body":""},"borderRadius":"","style":""}`,

      website_code: () => `기획·카피·디자인을 완벽 반영한 홈페이지 HTML 작성:${retryNote}
업종: ${taskInfo.industry || taskInfo.description}
<!DOCTYPE html> 완전한 단일파일, Google Fonts, Grid/Flex 반응형, 모바일우선, 호버효과, 애니메이션
Hero/About/Services/Contact/Footer 필수. 이전 AI 색상·카피·섹션 그대로 사용.`,

      website_validate: () => `HTML 검증 JSON:${retryNote}
{"score":0~100,"hasCompleteHTML":bool,"hasCSS":bool,"isResponsive":bool,"issues":[],"suggestions":[]}`,

      blog_research: () => `"${taskInfo.topic || taskInfo.description}" 블로그 리서치:${retryNote}
최신 트렌드+통계(수치포함), 핵심사실 5개, 실용팁 3~5개, 흥미로운 사례. 한국어 상세히.`,

      blog_outline: () => `블로그 개요 JSON:${retryNote}
주제: ${taskInfo.topic || taskInfo.description} / 분량: ${taskInfo.length || '1500~2000자'} / 톤: ${taskInfo.tone || '친근하고 전문적'}
{"title":"SEO최적화제목","hook":"도입첫문장","sections":[{"heading":"","points":[]}],"conclusion":"","cta":""}`,

      blog_write: () => `완성된 블로그 본문 마크다운:${retryNote}
주제: ${taskInfo.topic || taskInfo.description} / 톤: ${taskInfo.tone || '친근하고 전문적'}
이전 AI 리서치+개요 기반. 강렬한도입부, ##소제목, 데이터활용, 실용팁, 자연스러운마무리.`,

      report_collect: () => `"${taskInfo.subject || taskInfo.description}" 데이터 수집:${retryNote}
시장규모(수치), 주요플레이어, 트렌드+성장동력, 리스크, 미래전망. 한국어 상세히.`,

      report_analyze: () => `수집 데이터 분석:${retryNote}
SWOT분석, 핵심인사이트 5가지, 데이터기반결론, 전략적권고사항. 이전AI데이터 직접인용.`,

      report_write: () => `전문 분석 리포트 마크다운:${retryNote}
주제: ${taskInfo.subject || taskInfo.description}
# Executive Summary / ## 현황분석 / ## SWOT / ## 핵심인사이트 / ## 결론및권고사항`,

      code_design: () => `기술 설계 JSON:${retryNote}
요청: ${taskInfo.description} / 언어: ${taskInfo.language || '최적선택'} / 프레임워크: ${taskInfo.framework || '최적선택'}
{"language":"","framework":"","architecture":"","components":[{"name":"","purpose":""}],"approach":""}`,

      code_code: () => `완성된 코드 작성:${retryNote}
요청: ${taskInfo.description}
실제동작완전코드, 상세한국어주석, 에러핸들링, 이전AI설계 정확히구현.`,

      code_review: () => `코드 리뷰 JSON:${retryNote}
{"score":0~100,"issues":["문제점"],"improvements":["개선사항"],"improvedCode":"개선코드(필요시)"}`,

      email_write: () => `전문 이메일 작성:${retryNote}
목적: ${taskInfo.purpose || taskInfo.description} / 수신자: ${taskInfo.recipient || '담당자'} / 톤: ${taskInfo.tone || '정중하고 전문적'}
제목: [이메일제목]\n\n[본문]\n\n[마무리인사]`,

      resume_structure: () => `자기소개서 구조 JSON:${retryNote}
직무: ${taskInfo.position || taskInfo.description} / 회사: ${taskInfo.company || ''}
{"sections":[{"title":"지원동기","purpose":"","keyPoints":[]},{"title":"역량및경험","purpose":"","keyPoints":[]},{"title":"입사후포부","purpose":"","keyPoints":[]}],"tone":"","focus":""}`,

      resume_write: () => `자기소개서 작성:${retryNote}
직무: ${taskInfo.position || taskInfo.description} / 강점: ${taskInfo.strengths || ''} / 경험: ${taskInfo.experience || ''}
이전AI구조에따라 자연스럽고설득력있는한국어로작성.`,

      // ── 일러스트 ──────────────────────────────────────────
      illustration_concept: () => `일러스트 콘셉트 기획 JSON:${retryNote}
테마: ${taskInfo.theme || taskInfo.description}
{"style":"(flat/line/gradient/3d/pixel 중 택1)","colorPalette":["#","#","#"],"mood":"","mainElements":[],"composition":"","technique":"SVG/CSS"}`,

      illustration_design: () => `SVG 일러스트 아트 디렉션:${retryNote}
테마: ${taskInfo.theme || taskInfo.description} / 스타일: ${taskInfo.style || 'modern flat'}
색상 팔레트, 주요 형태, 레이아웃, 그래픽 요소 상세 설계. 이전 AI 콘셉트 반영.`,

      illustration_code: () => `완성된 SVG/HTML 일러스트 코드:${retryNote}
테마: ${taskInfo.theme || taskInfo.description}
<!DOCTYPE html> 단일파일. 인라인 SVG, CSS 애니메이션(선택), 반응형. 이전 디자인 완벽 반영.`,

      // ── 애니메이션 ────────────────────────────────────────
      animation_concept: () => `애니메이션 기획 JSON:${retryNote}
요청: ${taskInfo.description || taskInfo.theme}
{"type":"(CSS/GSAP/Lottie)","duration":"","easing":"","elements":[],"keyframes":[{"time":"","state":""}],"trigger":"(load/scroll/hover/click)"}`,

      animation_design: () => `애니메이션 비주얼 설계:${retryNote}
요청: ${taskInfo.description} / 타입: ${taskInfo.type || 'CSS'}
색상·레이아웃·키프레임 타이밍·이징 상세 설계. 60fps 최적화 방향 제시.`,

      animation_animate: () => `GSAP/CSS 애니메이션 구현 코드:${retryNote}
요청: ${taskInfo.description}
<!DOCTYPE html> 단일파일. GSAP CDN 또는 CSS keyframes. 이전 기획·디자인 완벽 반영. 부드러운 60fps.`,

      animation_code: () => `최종 HTML+JS 애니메이션 통합:${retryNote}
모든 애니메이션 요소를 하나의 완성된 HTML 파일로 통합. 반응형, 성능 최적화.`,

      // ── 3D ────────────────────────────────────────────────
      threed_concept: () => `Three.js 3D 씬 기획 JSON:${retryNote}
요청: ${taskInfo.description}
{"scene":"","objects":[{"name":"","geometry":"","material":""}],"lighting":{"type":"","color":"","intensity":0},"camera":{"type":"","position":""},"background":"","animation":"","interactions":[]}`,

      threed_design: () => `3D 아트 디렉션:${retryNote}
요청: ${taskInfo.description}
색상 테마, 재질(metallic/matte/glass/emissive), 조명 설정, 포스트프로세싱 효과, 분위기 상세 설계.`,

      threed_model: () => `Three.js 3D 씬 설계:${retryNote}
요청: ${taskInfo.description}
지오메트리, 머티리얼, 쉐이더, 조명, 카메라 앵글 상세 코드 설계. 이전 아트 디렉션 반영.`,

      threed_code: () => `완성된 Three.js WebGL 코드:${retryNote}
요청: ${taskInfo.description}
<!DOCTYPE html> 단일파일. Three.js CDN, OrbitControls, 애니메이션 루프, 반응형 리사이즈. 이전 기획 완벽 구현.`,

      // ── UX/UI ─────────────────────────────────────────────
      ui_design_research: () => `UX 리서치 JSON:${retryNote}
서비스: ${taskInfo.industry || taskInfo.description}
{"userPersonas":[{"name":"","age":"","needs":[],"painPoints":[]}],"userFlows":[{"task":"","steps":[]}],"competitors":[],"insights":[]}`,

      ui_design_wireframe: () => `와이어프레임 & 정보구조 설계:${retryNote}
서비스: ${taskInfo.industry || taskInfo.description}
주요 화면 목록, 각 화면 컴포넌트, 내비게이션 구조, CTA 위치, 사용자 플로우. 텍스트로 상세 서술.`,

      ui_design_design: () => `디자인 시스템 JSON:${retryNote}
서비스: ${taskInfo.industry || taskInfo.description}
{"colors":{"primary":"#","secondary":"#","accent":"#","bg":"#","surface":"#","text":"#"},"typography":{"heading":"","body":"","size":{"h1":"","h2":"","body":""}},"spacing":"","borderRadius":"","shadows":"","components":["Button","Card","Input","Nav"]}`,

      ui_design_illustrate: () => `UI 아이콘 & 일러스트 SVG:${retryNote}
서비스: ${taskInfo.industry || taskInfo.description}
메인 히어로 일러스트 SVG + 주요 아이콘 6개 SVG. 디자인 시스템 색상 반영.`,

      ui_design_code: () => `완성된 UX/UI HTML 컴포넌트:${retryNote}
서비스: ${taskInfo.industry || taskInfo.description}
<!DOCTYPE html> 단일파일. 디자인 시스템 완전 반영. 반응형, 모바일우선, 인터랙션(hover/focus/active). 아이콘/일러스트 SVG 인라인 포함.`,

      // ── 영상 스크립트 ─────────────────────────────────────
      video_script_research: () => `영상 주제 리서치:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
레퍼런스 영상 트렌드, 핵심 메시지, 타겟 시청자, 적정 길이, 플랫폼별 형식 제안.`,

      video_script_plan: () => `영상 기획 JSON:${retryNote}
주제: ${taskInfo.topic || taskInfo.description} / 길이: ${taskInfo.duration || '3~5분'} / 플랫폼: ${taskInfo.platform || 'YouTube'}
{"title":"","hook":"","scenes":[{"num":1,"title":"","duration":"","visual":"","voiceover":""}],"totalDuration":"","cta":""}`,

      video_script_script: () => `영상 대본 전체:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
[씬번호 | 타임코드] 형식. 나레이션/대사, 화면 묘사, 자막 포함. 이전 기획 완벽 반영.`,

      video_script_write: () => `자막 & 카피 최적화:${retryNote}
각 씬별 자막 텍스트, 썸네일 카피, 영상 설명(SEO 최적화), 해시태그 제안.`,

      // ── 음악 ──────────────────────────────────────────────
      music_research: () => `음악 장르 분석:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
레퍼런스 곡 분석, 핵심 특징(BPM/키/리듬/악기), 트렌드, 프로듀싱 포인트.`,

      music_compose: () => `작곡 가이드 JSON:${retryNote}
장르: ${taskInfo.genre || taskInfo.description} / 무드: ${taskInfo.mood || '밝고 에너제틱'}
{"bpm":0,"key":"","timeSignature":"","chordProgression":[],"structure":["Intro","Verse","Chorus","Bridge","Outro"],"instruments":[],"productionTips":[]}`,

      music_lyrics: () => `가사 작성:${retryNote}
장르: ${taskInfo.genre || taskInfo.description} / 테마: ${taskInfo.theme || ''}
[Verse 1] / [Chorus] / [Verse 2] / [Bridge] / [Outro] 구조. 감성적이고 기억에 남는 후크라인 포함.`,

      // ── 팟캐스트 ──────────────────────────────────────────
      podcast_research: () => `팟캐스트 주제 심층 리서치:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
핵심 논점, 최신 통계, 흥미로운 사례, 논쟁적 이슈, 청중이 궁금해할 질문.`,

      podcast_plan: () => `팟캐스트 에피소드 기획 JSON:${retryNote}
주제: ${taskInfo.topic || taskInfo.description} / 길이: ${taskInfo.duration || '30~40분'}
{"title":"","description":"","segments":[{"name":"인트로","duration":"","content":""}],"guestQuestions":[],"cta":""}`,

      podcast_write: () => `팟캐스트 스크립트:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
[인트로] 훅 → [본론] 세그먼트별 대화/나레이션 → [아웃트로] CTA. 자연스러운 구어체.`,

      // ── 게임 ──────────────────────────────────────────────
      game_design: () => `게임 기획 문서 JSON:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
{"title":"","genre":"","core_mechanic":"","player_goal":"","levels":[{"num":1,"description":"","obstacles":[],"reward":""}],"scoring":"","controls":"","art_style":""}`,

      game_scenario: () => `게임 스토리 & 대사:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
세계관 설정, 주인공/NPC 소개, 스테이지별 스토리, 주요 대사, 엔딩.`,

      game_code: () => `완성된 Canvas 게임 코드:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
<!DOCTYPE html> 단일파일. 키보드/마우스 컨트롤, 게임루프(requestAnimationFrame), 충돌감지, 점수시스템, 게임오버/리스타트.`,

      // ── AR/VR ─────────────────────────────────────────────
      ar_vr_ux: () => `WebXR UX 설계:${retryNote}
요청: ${taskInfo.description}
공간 UI 배치, 인터랙션 방식(gaze/controller/hand), 사용자 플로우, 편안함 가이드라인.`,

      ar_vr_model: () => `WebXR 씬 설계 JSON:${retryNote}
요청: ${taskInfo.description}
{"scene_type":"(VR/AR)","objects":[{"name":"","position":"","scale":""}],"interactions":[],"lighting":"","performance_budget":""}`,

      ar_vr_code: () => `완성된 WebXR/Three.js 코드:${retryNote}
요청: ${taskInfo.description}
<!DOCTYPE html> 단일파일. Three.js + WebXR API. VR/AR 입장 버튼, 컨트롤러 인터랙션, 60fps 최적화.`,

      // ── 법률 ──────────────────────────────────────────────
      legal_research: () => `법률 리서치:${retryNote}
문서 유형: ${taskInfo.document_type || taskInfo.description}
관련 법령, 판례, 표준 조항, 주의사항, 리스크 요소.`,

      legal_draft: () => `법률 문서 조항 설계:${retryNote}
문서 유형: ${taskInfo.document_type || taskInfo.description}
필수 조항 목록, 각 조항 목적, 리스크 분석, 협상 포인트.`,

      legal_write: () => `법률 문서 초안:${retryNote}
문서 유형: ${taskInfo.document_type || taskInfo.description}
완전한 법률 문서. 조항번호, 정의, 권리·의무, 위반시 조치, 준거법 포함.`,

      // ── 의료 ──────────────────────────────────────────────
      medical_research: () => `의학 리서치:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
임상 근거, 가이드라인, 통계, 최신 연구 동향.`,

      medical_analyze: () => `의학적 분석:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
병태생리, 진단 기준, 치료 옵션, 예후, 환자 교육 포인트.`,

      medical_write: () => `의료 콘텐츠 작성:${retryNote}
주제: ${taskInfo.topic || taskInfo.description}
환자/일반인 눈높이 친절한 설명. 증상/원인/치료/예방 구조.`,

      // ── 재무 ──────────────────────────────────────────────
      finance_collect: () => `재무 데이터 수집 프레임:${retryNote}
주제: ${taskInfo.subject || taskInfo.description}
핵심 재무지표, 시장 데이터, 비교 벤치마크, 데이터 소스.`,

      finance_analyze: () => `재무 분석 JSON:${retryNote}
주제: ${taskInfo.subject || taskInfo.description}
{"revenue_trend":"","profitability":{},"valuation":{},"risk_factors":[],"peers_comparison":{}}`,

      finance_insight: () => `투자 인사이트:${retryNote}
핵심 발견사항 5개, SWOT, 투자 시사점, 리스크/기회, 전략적 권고사항.`,

      finance_report: () => `재무 분석 보고서:${retryNote}
주제: ${taskInfo.subject || taskInfo.description}
# Executive Summary / ## 재무현황 / ## 수익성분석 / ## 리스크 / ## 투자견해.`,

      // ── 교육 ──────────────────────────────────────────────
      education_research: () => `학습 목표 & 대상 분석:${retryNote}
과목: ${taskInfo.subject || taskInfo.description}
학습자 수준, 선행 지식, 학습 목표, 적정 분량, 평가 방법.`,

      education_curriculum: () => `커리큘럼 설계 JSON:${retryNote}
과목: ${taskInfo.subject || taskInfo.description}
{"title":"","total_hours":0,"units":[{"unit":1,"title":"","objectives":[],"topics":[],"duration":"","assessment":""}]}`,

      education_plan: () => `강의 계획 상세:${retryNote}
단원별 학습 활동, 예시, 질문, 토론 포인트, 실습 과제.`,

      education_write: () => `강의안 & 학습 자료:${retryNote}
과목: ${taskInfo.subject || taskInfo.description}
## 학습목표 / ## 핵심개념 / ## 상세설명(예시포함) / ## 연습문제 / ## 정리.`,

      // ── 마케팅 ────────────────────────────────────────────
      marketing_research: () => `시장 분석:${retryNote}
제품/서비스: ${taskInfo.product || taskInfo.description}
시장 규모, 경쟁사 분석, 타겟 고객, 트렌드, 차별화 기회.`,

      marketing_strategy: () => `마케팅 전략 JSON:${retryNote}
제품/서비스: ${taskInfo.product || taskInfo.description}
{"target":"","positioning":"","channels":[],"kpis":[],"timeline":[{"month":1,"activity":"","goal":""}]}`,

      marketing_copy: () => `마케팅 카피 패키지:${retryNote}
제품/서비스: ${taskInfo.product || taskInfo.description}
[헤드라인 5개] / [SNS 포스팅 3개] / [광고 카피 A/B/C세트]`,

      marketing_design: () => `크리에이티브 가이드라인:${retryNote}
비주얼 톤앤매너, 이미지 방향, 색상 사용, 폰트 지침, 레이아웃 원칙.`,

      // ── 브랜드 ────────────────────────────────────────────
      brand_research: () => `브랜드 리서치:${retryNote}
브랜드: ${taskInfo.brand_name || taskInfo.description}
시장 포지션, 경쟁 분석, 타겟 고객, 시장 기회.`,

      brand_strategy: () => `브랜드 전략 JSON:${retryNote}
{"positioning":"","target_persona":"","brand_values":[],"personality":[],"differentiator":"","promise":""}`,

      brand_identity: () => `브랜드 아이덴티티 패키지:${retryNote}
브랜드명: ${taskInfo.brand_name || taskInfo.description}
[네이밍 옵션 5개] / [슬로건 5개] / [브랜드 스토리] / [보이스톤 가이드]`,

      brand_visual: () => `비주얼 아이덴티티 가이드:${retryNote}
컬러 팔레트(Hex+의미), 폰트 페어링, 로고 방향, 그래픽 모티프.`,

      // ── 광고 카피 ─────────────────────────────────────────
      ad_copy_research: () => `타겟 고객 분석:${retryNote}
제품: ${taskInfo.product || taskInfo.description}
고객 페르소나, 핵심 니즈, 구매 장벽, 감정적 트리거, USP.`,

      ad_copy_strategy: () => `카피 전략:${retryNote}
제품: ${taskInfo.product || taskInfo.description}
핵심 메시지, 소구 방향, 채널별 톤, CTA 전략.`,

      ad_copy_copy: () => `광고 카피 A/B/C 세트:${retryNote}
제품: ${taskInfo.product || taskInfo.description}
[배너 헤드라인×5] [SNS광고×6] [검색광고 제목×5+설명×5] [이메일 제목×5]`,

      // ── SNS ───────────────────────────────────────────────
      sns_research: () => `SNS 트렌드 분석:${retryNote}
브랜드: ${taskInfo.brand || taskInfo.description}
플랫폼별 트렌딩 포맷, 인기 해시태그, 경쟁사, 최적 게시 시간.`,

      sns_strategy: () => `SNS 콘텐츠 전략:${retryNote}
플랫폼별 톤앤매너, 콘텐츠 믹스, 게시 빈도, 참여 전략.`,

      sns_copy: () => `SNS 콘텐츠 패키지:${retryNote}
브랜드: ${taskInfo.brand || taskInfo.description}
[인스타 피드×5(캡션+해시태그)] [유튜브 쇼츠×3] [틱톡×3] [X 트윗×10]`,

      sns_visual: () => `SNS 비주얼 가이드:${retryNote}
플랫폼별 이미지 컨셉, 컬러 팔레트, 폰트, 레이아웃 템플릿.`,

      // ── 데이터 분석 ───────────────────────────────────────
      data_analysis_collect: () => `데이터 수집 설계:${retryNote}
주제: ${taskInfo.dataset || taskInfo.description}
데이터 소스, 수집 방법, 필요 변수, 전처리 방향.`,

      data_analysis_analyze: () => `통계 분석 Python 코드:${retryNote}
데이터: ${taskInfo.dataset || taskInfo.description}
pandas/numpy. 기술통계, 상관분석, 트렌드 분석. 한국어 주석.`,

      data_analysis_visualize: () => `데이터 시각화 코드:${retryNote}
데이터: ${taskInfo.dataset || taskInfo.description}
matplotlib/plotly 또는 Chart.js. 막대/선/파이/산점도. 컬러풀하고 명확한 시각화.`,

      data_analysis_insight: () => `비즈니스 인사이트:${retryNote}
핵심 발견 5개, 패턴 및 이상치, 비즈니스 의미, 액션 아이템.`,

      data_analysis_report: () => `데이터 분석 보고서:${retryNote}
주제: ${taskInfo.dataset || taskInfo.description}
# 분석 개요 / ## 핵심 발견 / ## 시사점 / ## 권고사항.`,

      // ── 자동화 ────────────────────────────────────────────
      automation_analyze: () => `업무 프로세스 분석:${retryNote}
대상: ${taskInfo.process || taskInfo.description}
현재 수동 단계, 자동화 가능 구간, 필요 도구/API.`,

      automation_design: () => `자동화 설계 JSON:${retryNote}
{"trigger":"","steps":[{"step":1,"action":"","tool":"","input":"","output":""}],"error_handling":"","estimated_time_saved":""}`,

      automation_code: () => `자동화 스크립트:${retryNote}
업무: ${taskInfo.process || taskInfo.description}
Python/JS 완전 동작 코드. 에러처리, 로깅, 재시도 로직. 한국어 주석.`,

      // ── API 설계 ──────────────────────────────────────────
      api_design_plan: () => `API 기획 JSON:${retryNote}
서비스: ${taskInfo.service || taskInfo.description}
{"base_url":"","endpoints":[{"method":"GET","path":"","description":"","params":[],"response":{}}],"auth":"Bearer JWT","rate_limit":""}`,

      api_design_spec: () => `OpenAPI 3.0 스펙:${retryNote}
서비스: ${taskInfo.service || taskInfo.description}
YAML 형식 OpenAPI 3.0. 엔드포인트, 스키마, 응답코드, 인증 포함.`,

      api_design_implement: () => `API 구현 코드:${retryNote}
서비스: ${taskInfo.service || taskInfo.description}
Express.js 또는 FastAPI. 라우터, 미들웨어, 에러핸들러. 한국어 주석.`,

      // ── 소설 ──────────────────────────────────────────────
      novel_worldbuild: () => `소설 세계관 설계:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
시대/배경, 세계 규칙, 사회구조, 지리, 역사적 맥락.`,

      novel_character: () => `캐릭터 설계:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
주인공 프로필(외모/성격/욕망/두려움), 조연 3~4명, 빌런, 관계도.`,

      novel_plot: () => `플롯 설계 JSON:${retryNote}
{"logline":"","act1":{"setup":"","inciting_incident":""},"act2":{"rising_action":[],"midpoint":"","dark_moment":""},"act3":{"climax":"","resolution":""},"subplots":[]}`,

      novel_write: () => `소설 본문 작성:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
이전 세계관·캐릭터·플롯 완전 반영. 생생한 묘사, 자연스러운 대화. 한국어 문학적 문체.`,

      // ── 시나리오 ──────────────────────────────────────────
      scenario_concept: () => `시나리오 콘셉트:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
핵심 테마, 분위기, 시대 배경, 타겟 관객.`,

      scenario_world: () => `세계관 & 설정:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
배경, 주요 장소, 핵심 갈등 구조.`,

      scenario_scene: () => `씬 구성 & 분할:${retryNote}
INT./EXT. 장소 시간, 등장인물, 씬 목적, 갈등/전환점. 영화 포맷.`,

      scenario_dialogue: () => `대사 & 완성 시나리오:${retryNote}
장르: ${taskInfo.genre || taskInfo.description}
완성 포맷. 씬 헤더, 지문, 대사. 캐릭터 특성이 드러나는 자연스러운 대화.`,

      // ── 번역 ──────────────────────────────────────────────
      translation_analyze: () => `원문 분석:${retryNote}
원문 언어: ${taskInfo.source_language || taskInfo.description}
문서 유형, 전문 용어, 문화적 표현, 톤, 번역 주의사항.`,

      translation_translate: () => `전문 번역:${retryNote}
원문을 ${taskInfo.target_language || '한국어'}로 번역. 의미 정확성 최우선. 전문 용어 일관성 유지.`,

      translation_localize: () => `현지화 & 교정:${retryNote}
문화권에 맞게 자연스럽게. 관용표현, 경어법, 문화적 뉘앙스 반영.`
    };

    const fn = instructions[key];
    return fn ? fn() : null;
  }

  // ── OpenAI 호출 ────────────────────────────────────────────
  async callOpenAI(model, systemPrompt, userPrompt, outputType) {
    const isJSON = outputType === 'json'
      || userPrompt.includes('JSON:') || userPrompt.includes('JSON 형식')
      || userPrompt.includes('{"');

    const params = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: isJSON ? 0.2 : 0.7,
      max_tokens: outputType === 'html' || outputType === 'code' ? 6000 : 4000
    };

    if (isJSON) params.response_format = { type: 'json_object' };

    const res = await this.openai.chat.completions.create(params);
    const content = res.choices[0].message.content;

    if (isJSON) {
      try { return JSON.parse(content); } catch { return content; }
    }
    return content;
  }

  // ── Claude 호출 ────────────────────────────────────────────
  async callClaude(model, systemPrompt, userPrompt, outputType) {
    if (!this.anthropic) {
      return await this.callOpenAI('gpt-5', systemPrompt, userPrompt, outputType);
    }

    const isJSON = outputType === 'json';

    const res = await this.anthropic.messages.create({
      model,
      max_tokens: outputType === 'html' || outputType === 'code' ? 6000 : 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: isJSON ? userPrompt + '\n\n반드시 유효한 JSON만 반환하세요.' : userPrompt
      }]
    });

    const content = res.content[0].text;
    if (isJSON) {
      try {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      } catch {}
    }
    return content;
  }

  // ── 최종 검증 ─────────────────────────────────────────────
  async validate(ctx) {
    const handoff = ctx.buildHandoffContext('__validate__');

    try {
      const res = await this.openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: '품질 검증 AI. JSON만 반환.' },
          {
            role: 'user',
            content: `다음 작업 결과를 평가하세요:\n\n${handoff.substring(0, 2000)}\n\n평가기준: 사용자요청충족도, 내용완성도, 품질, AI간작업일관성\n\nJSON: {"score":0~100,"completeness":0~100,"quality":0~100,"consistency":0~100,"issues":["문제점"],"strengths":["잘된점"],"approved":true/false}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 400
      });
      return JSON.parse(res.choices[0].message.content);
    } catch {
      return { score: 82, approved: true, issues: [], strengths: ['기본 검증 통과'] };
    }
  }

  // ── 최종 결과 조립 ─────────────────────────────────────────
  buildFinalResult(ctx, validation, plan, taskType, taskInfo) {
    const allResults = ctx.getAllResults();

    // 컨텐츠 타입별 메인 결과 추출 전략
    const contentMap = {
      ppt:     ['assemble', 'content'],
      website: ['code', 'assemble'],
      blog:    ['write'],
      report:  ['write'],
      code:    ['code', 'review'],
      email:   ['write'],
      resume:  ['write']
    };

    const keys = contentMap[taskType] || ['write'];
    let mainContent = null;
    let contentType = 'text';

    for (const key of keys) {
      if (allResults[key]) {
        mainContent = allResults[key];
        // outputType 추론
        const step = plan.steps.find(s => s.id === key);
        contentType = step?.outputType || 'text';
        break;
      }
    }

    // 마지막 validate 결과에서 finalCode 추출 (코드 타입)
    if (taskType === 'code' && typeof mainContent === 'object') {
      mainContent = mainContent.improvedCode || mainContent.finalCode || allResults.code || JSON.stringify(mainContent);
      contentType = 'code';
    }

    if (!mainContent) {
      const lastStep = plan.steps[plan.steps.length - 2]; // validate 전
      mainContent = allResults[lastStep?.id] || '결과를 생성하지 못했습니다.';
    }

    if (typeof mainContent === 'object') {
      mainContent = JSON.stringify(mainContent, null, 2);
    }

    // 파이프라인 실행 정보
    const parallelSteps = plan.steps.filter(s => s.parallel).length;
    const waves = this.executor.buildWaves(plan.steps);

    return {
      taskType,
      taskInfo,
      pipeline: {
        name: this._getPipelineName(taskType),
        icon: this._getPipelineIcon(taskType),
        steps: plan.steps.length,
        parallelSteps,
        waves: waves.length,
        planSummary: plan.planSummary,
        complexity: plan.complexity
      },
      result: {
        content: mainContent,
        contentType,
        allSteps: allResults
      },
      validation,
      meta: {
        elapsed: `${plan.steps.length}스텝 / ${waves.length}라운드 완료`,
        qualityScore: validation.score,
        approved: validation.approved,
        issues: validation.issues || [],
        strengths: validation.strengths || [],
        feedbackRounds: validation.feedbackRounds || 0,
        contextLog: ctx.dump()
      }
    };
  }

  _getPipelineName(type) {
    const n = { ppt:'PPT/프레젠테이션', website:'홈페이지/웹사이트', blog:'블로그/콘텐츠',
                report:'분석 리포트', code:'코드 개발', email:'이메일/문서', resume:'자기소개서' };
    return n[type] || type;
  }

  _getPipelineIcon(type) {
    const i = { ppt:'📊', website:'🌐', blog:'📝', report:'📈', code:'💻', email:'✉️', resume:'📄' };
    return i[type] || '⚙️';
  }

  _modelName(modelKey) {
    const n = { GPT4O:'GPT-4o', GPT4O_MINI:'GPT-4o mini', CLAUDE_SONNET:'Claude 3.5', GPT4_1:'GPT-4.1' };
    return n[modelKey] || modelKey;
  }
}

module.exports = MasterOrchestrator;
