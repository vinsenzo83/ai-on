// ============================================================
// 1000개 테스트케이스 자동 생성기
// AI (GPT-5.2)가 60개 시드 케이스를 기반으로 확장 생성
// ============================================================
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

// ── OpenAI 클라이언트 초기화 ──────────────────────────────
function initClient() {
  const configPath = path.join(os.homedir(), '.genspark_llm.yaml');
  let apiKey = process.env.OPENAI_API_KEY;
  let baseURL = process.env.OPENAI_BASE_URL;
  if (fs.existsSync(configPath)) {
    const cfg = yaml.load(fs.readFileSync(configPath, 'utf8'));
    // yaml의 값이 ${...} 형식(미치환 템플릿)이면 env 값 사용
    const yamlKey = cfg?.openai?.api_key;
    const yamlUrl = cfg?.openai?.base_url;
    if (yamlKey && !yamlKey.startsWith('${')) apiKey = yamlKey;
    if (yamlUrl && !yamlUrl.startsWith('${')) baseURL = yamlUrl;
  }
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  console.log(`🔑 API Key: ${apiKey.substring(0,15)}... | Base URL: ${baseURL}`);
  return new OpenAI({ apiKey, baseURL });
}

// ── 60개 시드 케이스 (기존 분석된 케이스) ────────────────
const SEED_CASES = [
  // 이커머스
  { id:1,  domain:'ecommerce', title:'타오바오 URL → 스크래핑 → OCR번역 → 누끼 → 상세페이지', feasibility:'api_needed', apis:['Puppeteer','OCR','Remove.bg'], roles:['researcher','translator','designer','coder'] },
  { id:2,  domain:'ecommerce', title:'제품 사진 → 3D GLB 변환 → 360도 MP4', feasibility:'external_only', apis:['Tripo3D','Blender'], roles:[] },
  { id:3,  domain:'ecommerce', title:'경쟁사 URL → 자정 크롤링 → 최저가 자동수정 → 슬랙', feasibility:'api_needed', apis:['Puppeteer','cron','Slack'], roles:['automation_engineer','coder'] },
  { id:4,  domain:'ecommerce', title:'리뷰 1만건 → 감성분석 → 불만 TOP3 → 기획전 카피', feasibility:'ready', apis:[], roles:['data_scientist','analyst','copywriter'] },
  { id:5,  domain:'ecommerce', title:'이탈고객 DB → 취향추론 → 초개인화 쿠폰 → SMS', feasibility:'api_needed', apis:['SMS_API'], roles:['analyst','copywriter','automation_engineer'] },
  { id:6,  domain:'ecommerce', title:'악성재고 → 묶음할인 계산 → 인스타 배너 5종', feasibility:'api_needed', apis:['ImageGen'], roles:['financial_analyst','designer','illustrator'] },
  { id:7,  domain:'ecommerce', title:'환불요청 → PDF RAG → CS 방어 멘트', feasibility:'ready', apis:[], roles:['researcher','legal_expert','writer'] },
  { id:8,  domain:'ecommerce', title:'로고 → 구글 비전 → 도용 URL 추출', feasibility:'external_only', apis:['Google Vision'], roles:[] },
  { id:9,  domain:'ecommerce', title:'상품매뉴얼 → AI 아바타 → 튜토리얼 영상', feasibility:'api_needed', apis:['HeyGen'], roles:['scenario_writer','educator'] },
  { id:10, domain:'ecommerce', title:'여름의류 → 계절변경 → 가을/겨울 합성', feasibility:'api_needed', apis:['ImageEdit'], roles:['designer','illustrator'] },
  // 마케팅
  { id:11, domain:'marketing', title:'키워드 → 웹트렌드 → 블로그 → 워드프레스 포스팅', feasibility:'api_needed', apis:['Perplexity','WordPress'], roles:['researcher','planner','writer'] },
  { id:12, domain:'marketing', title:'브랜드명 → SVG 로고 3종 → 명함 목업', feasibility:'api_needed', apis:['ImageGen'], roles:['brand_strategist','illustrator','designer'] },
  { id:13, domain:'marketing', title:'메인카피 → 연령별 10개 → A/B 배너 10장', feasibility:'api_needed', apis:['ImageGen_parallel'], roles:['copywriter','designer','illustrator'] },
  { id:14, domain:'marketing', title:'경쟁사 인스타 → 30일 크롤링 → 반응분석 리포트', feasibility:'api_needed', apis:['Instagram_Scraper'], roles:['researcher','analyst','strategist'] },
  { id:15, domain:'marketing', title:'웨비나 영상 → STT → 하이라이트 → SRT', feasibility:'api_needed', apis:['Whisper'], roles:['researcher','analyst','writer'] },
  { id:16, domain:'marketing', title:'이벤트 경품 → 카피 → 랜딩페이지 React', feasibility:'ready', apis:[], roles:['copywriter','designer','coder'] },
  { id:17, domain:'marketing', title:'스펙 PDF → 보도자료 → 기자 이메일 일괄발송', feasibility:'api_needed', apis:['PDF','SendGrid'], roles:['researcher','writer','automation_engineer'] },
  { id:18, domain:'marketing', title:'뉴스 URL → 요약 → 논평 → 링크드인 포스팅', feasibility:'api_needed', apis:['LinkedIn_API'], roles:['researcher','writer','automation_engineer'] },
  { id:19, domain:'marketing', title:'유튜브 댓글 → 불만추출 → 다음영상 기획+대본', feasibility:'ready', apis:['YouTube_Data_API'], roles:['analyst','planner','scenario_writer'] },
  { id:20, domain:'marketing', title:'행사안내문 → 다국어 번역 → AI 성우 MP3', feasibility:'api_needed', apis:['ElevenLabs'], roles:['translator','composer'] },
  // B2B
  { id:21, domain:'b2b', title:'RFP PDF → 솔루션 DB 대조 → 제안서 목차+체크리스트', feasibility:'ready', apis:[], roles:['researcher','legal_expert','planner'] },
  { id:22, domain:'b2b', title:'통화녹음 → STT → 반론극복비율 → 화법교정 리포트', feasibility:'api_needed', apis:['Whisper'], roles:['analyst','educator','writer'] },
  { id:23, domain:'b2b', title:'링크드인 URL → 뉴스크롤링 → 초개인화 콜드메일', feasibility:'api_needed', apis:['LinkedIn_Scraper'], roles:['researcher','strategist','copywriter'] },
  { id:24, domain:'b2b', title:'명함사진 → OCR → 기업정보 → 감사이메일 예약', feasibility:'api_needed', apis:['GPT4V','Email_Scheduler'], roles:['researcher','copywriter','automation_engineer'] },
  { id:25, domain:'b2b', title:'CRM 엑셀 → 오타교정/중복병합 → SQL DB 스키마', feasibility:'ready', apis:[], roles:['data_scientist','coder','reviewer'] },
  { id:26, domain:'b2b', title:'인건비 데이터 → 절감계산(o3급) → B2B 품의서', feasibility:'ready', apis:[], roles:['financial_analyst','planner','writer'] },
  { id:27, domain:'b2b', title:'진상고객 이메일 → 감정분석 → 정중한 거절', feasibility:'ready', apis:[], roles:['analyst','legal_expert','writer'] },
  { id:28, domain:'b2b', title:'영업매뉴얼 → Realtime API → 롤플레잉 훈련', feasibility:'custom_pipeline', apis:['Realtime_API'], roles:['educator','scenario_writer'] },
  { id:29, domain:'b2b', title:'방문객 리스트 → 직급분류 → 실무자/임원 분기발송', feasibility:'ready', apis:[], roles:['analyst','copywriter','automation_engineer'] },
  { id:30, domain:'b2b', title:'가맹문의 → 상권데이터 → 매출시뮬레이션 PDF', feasibility:'api_needed', apis:['Commercial_Data_API','PDF_Gen'], roles:['financial_analyst','researcher','writer'] },
  // IT
  { id:31, domain:'it', title:'화면캡처 → 비전판독 → React/Tailwind 코드', feasibility:'ready', apis:['GPT4V'], roles:['ux_architect','designer','coder'] },
  { id:32, domain:'it', title:'자연어 → DB스키마 RAG → SQL → 차트', feasibility:'ready', apis:[], roles:['researcher','data_scientist'] },
  { id:33, domain:'it', title:'에러로그 → GitHub검색 → 수정코드 → PR', feasibility:'api_needed', apis:['GitHub_API'], roles:['reviewer','coder','automation_engineer'] },
  { id:34, domain:'it', title:'Postman JSON → E2E Playwright 테스트', feasibility:'ready', apis:[], roles:['reviewer','coder'] },
  { id:35, domain:'it', title:'AWS 청구서 → 사용패턴 → 최적화 리포트', feasibility:'ready', apis:[], roles:['data_scientist','financial_analyst','writer'] },
  { id:36, domain:'it', title:'Java/JSP → Node.js/React 리팩토링', feasibility:'ready', apis:[], roles:['planner','coder','reviewer'] },
  { id:37, domain:'it', title:'Git Diff → 커밋메시지 → 릴리즈노트', feasibility:'ready', apis:[], roles:['analyst','writer'] },
  { id:38, domain:'it', title:'인프라 설명 → Mermaid.js → SVG 다이어그램', feasibility:'ready', apis:[], roles:['planner','coder','illustrator'] },
  { id:39, domain:'it', title:'보안취약점 → OWASP Top10 → 방어코드', feasibility:'ready', apis:[], roles:['reviewer','legal_expert','coder'] },
  { id:40, domain:'it', title:'예시텍스트 → 예외방어 정규식 → 테스트케이스', feasibility:'ready', apis:[], roles:['coder','reviewer'] },
  // 법률/HR/재무
  { id:41, domain:'legal_hr', title:'계약서 → 근로기준법 RAG → 독소조항 하이라이트', feasibility:'ready', apis:[], roles:['researcher','legal_expert','writer'] },
  { id:42, domain:'legal_hr', title:'사건개요 → 판례 스크래핑 → 유리/불리 리포트', feasibility:'api_needed', apis:['Court_DB'], roles:['researcher','legal_expert','writer'] },
  { id:43, domain:'legal_hr', title:'영수증 사진 → OCR → ERP 연동 엑셀', feasibility:'api_needed', apis:['GPT4V','ERP_API'], roles:['data_scientist','automation_engineer'] },
  { id:44, domain:'legal_hr', title:'이력서 100개 → 매칭 점수화 → TOP5 + 탈락사유서', feasibility:'ready', apis:[], roles:['researcher','analyst','writer'] },
  { id:45, domain:'legal_hr', title:'합격자 이력서 → 약점추론 → 압박면접 질문 5개', feasibility:'ready', apis:[], roles:['analyst','educator'] },
  { id:46, domain:'legal_hr', title:'블랙박스 묘사 → 과실비율 → 합의 논리', feasibility:'ready', apis:[], roles:['legal_expert','analyst','writer'] },
  { id:47, domain:'legal_hr', title:'슬랙 질문 → 사내위키 RAG → 매뉴얼 봇', feasibility:'ready', apis:['Slack_API'], roles:['researcher','writer'] },
  { id:48, domain:'legal_hr', title:'피해사실 → 법적요건 → 내용증명 PDF', feasibility:'ready', apis:[], roles:['legal_expert','writer'] },
  { id:49, domain:'legal_hr', title:'외국인 이력서 → 비자요건 → E-7 진단', feasibility:'ready', apis:[], roles:['legal_expert','researcher','writer'] },
  { id:50, domain:'legal_hr', title:'근태패턴 → 이상탐지 → 퇴사징후 대시보드', feasibility:'ready', apis:[], roles:['data_scientist','analyst','designer'] },
  // 교육/의료/미디어
  { id:51, domain:'edu_med', title:'의사-환자 대화 → STT → SOAP EMR 차트', feasibility:'api_needed', apis:['Whisper'], roles:['medical_writer','researcher'] },
  { id:52, domain:'edu_med', title:'건강검진 수치 → 비유적용 쉬운 해설지', feasibility:'ready', apis:[], roles:['medical_writer','writer'] },
  { id:53, domain:'edu_med', title:'기출문제 사진 → 수식인식 → 변형문제 20개', feasibility:'api_needed', apis:['GPT4V'], roles:['educator','coder'] },
  { id:54, domain:'edu_med', title:'영어발음 녹음 → 억양분석 → 토플 피드백', feasibility:'api_needed', apis:['Whisper','Pronunciation_API'], roles:['educator','analyst'] },
  { id:55, domain:'edu_med', title:'영자신문 → 3단계 난이도별 리라이팅', feasibility:'ready', apis:[], roles:['researcher','educator','writer'] },
  { id:56, domain:'edu_med', title:'등기부등본 → 근저당 분석 → 전세사기 위험도', feasibility:'ready', apis:[], roles:['legal_expert','analyst','writer'] },
  { id:57, domain:'edu_med', title:'빈방 사진 → 3D 공간추정 → 인테리어 렌더링', feasibility:'external_only', apis:['ControlNet','3D_Space'], roles:[] },
  { id:58, domain:'edu_med', title:'웹소설 최신화 → 과거 DB → 설정붕괴 검출', feasibility:'ready', apis:[], roles:['researcher','analyst','critic'] },
  { id:59, domain:'edu_med', title:'스포츠 영상 → 하이라이트 → 스포츠 기사', feasibility:'api_needed', apis:['Video_Analysis'], roles:['analyst','scenario_writer','writer'] },
  { id:60, domain:'edu_med', title:'키워드+아이이름 → 동화 → 삽화10장 → PDF', feasibility:'api_needed', apis:['ImageGen','PDF_Merge'], roles:['novelist','illustrator','assembler'] },
];

// ── 도메인 목록 (1000개 균등 분배) ──────────────────────
const DOMAINS = [
  { key:'ecommerce',     label:'이커머스 & 셀러 오토메이션',  count:120 },
  { key:'marketing',     label:'마케팅 & 콘텐츠 에이전시',    count:120 },
  { key:'b2b',           label:'B2B 세일즈 & CRM',            count:100 },
  { key:'it',            label:'소프트웨어 개발 & IT 인프라',  count:120 },
  { key:'legal_hr',      label:'법률 / 행정 / HR / 재무',     count:100 },
  { key:'edu_med',       label:'교육 / 의료 / 미디어',        count:80  },
  { key:'creative',      label:'크리에이티브 & 디자인',        count:80  },
  { key:'data_ai',       label:'데이터 / AI / 자동화',         count:80  },
  { key:'real_estate',   label:'부동산 & 건설',               count:50  },
  { key:'finance_invest',label:'금융 & 투자',                 count:50  },
  { key:'healthcare',    label:'헬스케어 & 바이오',           count:50  },
  { key:'government',    label:'공공 & 정부 서비스',           count:50  },
];

// ── 역할 전체 목록 ────────────────────────────────────────
const ALL_ROLES = [
  'planner','researcher','writer','coder','reviewer','designer','analyst',
  'validator','router','assembler','critic','illustrator','animator','artist3d',
  'ux_architect','composer','game_designer','game_coder','legal_expert',
  'medical_writer','financial_analyst','educator','strategist','copywriter',
  'brand_strategist','data_scientist','automation_engineer','novelist',
  'scenario_writer','translator'
];

// ── 신규 필요 기술 추적 ───────────────────────────────────
const MISSING_TECH_TRACKER = new Map();

// ── GPT-5.2로 케이스 배치 생성 ────────────────────────────
async function generateBatch(client, domain, domainLabel, seedExamples, batchSize, startId) {
  const systemPrompt = `당신은 AI 자동화 시스템의 테스트케이스 설계 전문가입니다.
주어진 도메인에서 실제 비즈니스 현장에서 발생하는 AI 자동화 케이스를 생성하세요.

각 케이스는 반드시 다음 JSON 형식을 따르세요:
{
  "id": number,
  "domain": "${domain}",
  "domain_label": "${domainLabel}",
  "title": "케이스 제목 (입력→처리→출력 형식)",
  "description": "3줄 이내 상세 설명",
  "input_type": ["text"|"image"|"pdf"|"excel"|"audio"|"video"|"url"|"database"|"code"|"json"],
  "output_type": ["text"|"html"|"code"|"pdf"|"image"|"video"|"audio"|"excel"|"json"|"email"|"sms"],
  "feasibility": "ready"|"api_needed"|"custom_pipeline"|"external_only",
  "complexity": "low"|"medium"|"high"|"extreme",
  "roles": [역할 배열 - 반드시 아래 목록에서만 선택],
  "required_apis": ["필요한 외부 API/서비스 목록"],
  "missing_tech": ["현재 시스템에 없는 기술 (있으면 빈 배열)"],
  "pipeline_steps": ["단계1", "단계2", "단계3"],
  "estimated_time": "예상 소요 시간",
  "business_value": "high"|"medium"|"low",
  "tags": ["태그1", "태그2"]
}

사용 가능한 역할 목록: ${ALL_ROLES.join(', ')}

중요:
- title은 반드시 [입력] → [처리] → [출력] 형식
- 실제 비즈니스 현장에서 실용적인 케이스만
- 중복 없이 다양한 시나리오
- missing_tech에는 현재 시스템에 없는 새로운 AI/기술 명시`;

  const userPrompt = `도메인: ${domainLabel}

참고 예시 케이스들:
${JSON.stringify(seedExamples.slice(0, 5), null, 2)}

위 스타일을 참고하되 완전히 새로운 케이스 ${batchSize}개를 생성하세요.
ID는 ${startId}부터 시작.
반드시 JSON 배열로만 반환: [{ ... }, { ... }]`;

  const res = await client.chat.completions.create({
    model: 'gpt-5.2',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.8,
    max_tokens: 8000,
    response_format: { type: 'json_object' }
  });

  let content = res.choices[0].message.content;
  try {
    const parsed = JSON.parse(content);
    // json_object 모드에서 배열이 래핑될 수 있음
    if (Array.isArray(parsed)) return parsed;
    if (parsed.cases) return parsed.cases;
    if (parsed.test_cases) return parsed.test_cases;
    if (parsed.items) return parsed.items;
    // 첫 번째 배열 값 찾기
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) return v;
    }
    return [];
  } catch (e) {
    console.error('JSON 파싱 오류:', e.message);
    return [];
  }
}

// ── 부족한 기술 분석 ──────────────────────────────────────
async function analyzeMissingTech(client, allCases) {
  const missingTechs = new Set();
  const newRoles = new Set();

  allCases.forEach(c => {
    (c.missing_tech || []).forEach(t => missingTechs.add(t));
    (c.roles || []).forEach(r => {
      if (!ALL_ROLES.includes(r)) newRoles.add(r);
    });
  });

  const techList = [...missingTechs];
  const roleList = [...newRoles];

  if (techList.length === 0) return { newTechs: [], newRoles: [], modelSuggestions: [] };

  const res = await client.chat.completions.create({
    model: 'gpt-5.2',
    messages: [{
      role: 'system',
      content: '당신은 AI 시스템 아키텍트입니다. 부족한 기술 목록을 분석하고 해결책을 제시하세요.'
    }, {
      role: 'user',
      content: `다음 부족한 기술들을 분석하고 각각에 대해 최적의 AI 모델/API/역할을 제안하세요:

부족한 기술: ${techList.join(', ')}
필요한 새 역할: ${roleList.join(', ')}

JSON 형식으로 반환:
{
  "new_technologies": [
    {
      "tech_name": "기술명",
      "category": "vision|audio|video|3d|database|automation|communication",
      "best_api": "추천 API/서비스",
      "alternative_apis": ["대안1", "대안2"],
      "new_role_needed": "필요한 새 역할명 (없으면 null)",
      "implementation_difficulty": "easy|medium|hard",
      "monthly_cost_estimate": "예상 월비용"
    }
  ],
  "new_roles": [
    {
      "role_key": "역할 키",
      "role_name": "역할 이름",
      "icon": "이모지",
      "description": "역할 설명",
      "preferred_model": "GPT5_2 또는 GPT5_1 등",
      "weights": {"reasoning": 0.3, "creativity": 0.2, "coding": 0.3, "factual": 0.2}
    }
  ],
  "priority_integrations": ["우선순위 통합 TOP 10"]
}`
    }],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return { new_technologies: [], new_roles: [], priority_integrations: [] };
  }
}

// ── 통계 계산 ─────────────────────────────────────────────
function computeStats(allCases) {
  const stats = {
    total: allCases.length,
    by_domain: {},
    by_feasibility: { ready: 0, api_needed: 0, custom_pipeline: 0, external_only: 0 },
    by_complexity: { low: 0, medium: 0, high: 0, extreme: 0 },
    by_business_value: { high: 0, medium: 0, low: 0 },
    top_roles: {},
    top_apis: {},
    top_missing_tech: {},
    input_types: {},
    output_types: {}
  };

  allCases.forEach(c => {
    // 도메인
    stats.by_domain[c.domain] = (stats.by_domain[c.domain] || 0) + 1;
    // 구현가능성
    if (c.feasibility) stats.by_feasibility[c.feasibility] = (stats.by_feasibility[c.feasibility] || 0) + 1;
    // 복잡도
    if (c.complexity) stats.by_complexity[c.complexity] = (stats.by_complexity[c.complexity] || 0) + 1;
    // 비즈니스 가치
    if (c.business_value) stats.by_business_value[c.business_value] = (stats.by_business_value[c.business_value] || 0) + 1;
    // 역할
    (c.roles || []).forEach(r => stats.top_roles[r] = (stats.top_roles[r] || 0) + 1);
    // API
    (c.required_apis || []).forEach(a => stats.top_apis[a] = (stats.top_apis[a] || 0) + 1);
    // 부족 기술
    (c.missing_tech || []).forEach(t => stats.top_missing_tech[t] = (stats.top_missing_tech[t] || 0) + 1);
    // 입출력 타입
    (c.input_type || []).forEach(t => stats.input_types[t] = (stats.input_types[t] || 0) + 1);
    (c.output_type || []).forEach(t => stats.output_types[t] = (stats.output_types[t] || 0) + 1);
  });

  // 정렬
  stats.top_roles = Object.entries(stats.top_roles).sort((a,b)=>b[1]-a[1]).slice(0,15);
  stats.top_apis = Object.entries(stats.top_apis).sort((a,b)=>b[1]-a[1]).slice(0,20);
  stats.top_missing_tech = Object.entries(stats.top_missing_tech).sort((a,b)=>b[1]-a[1]).slice(0,20);

  return stats;
}

// ── 메인 실행 ─────────────────────────────────────────────
async function main() {
  console.log('🚀 1000개 테스트케이스 생성 시작...\n');
  const client = initClient();
  const outDir = path.join(__dirname);
  const allCases = [...SEED_CASES]; // 시드 60개로 시작

  let currentId = 61;

  for (const domain of DOMAINS) {
    const needed = domain.count;
    const batchSize = 20; // 한 번에 20개씩 생성
    const batches = Math.ceil(needed / batchSize);
    const domainSeeds = SEED_CASES.filter(s => s.domain === domain.key);
    const fallbackSeeds = SEED_CASES.slice(0, 5);

    console.log(`\n📂 [${domain.label}] ${needed}개 생성 중...`);

    let domainGenerated = 0;
    for (let b = 0; b < batches; b++) {
      const thisBatch = Math.min(batchSize, needed - domainGenerated);
      if (thisBatch <= 0) break;

      process.stdout.write(`  배치 ${b+1}/${batches} (${thisBatch}개)... `);

      try {
        const cases = await generateBatch(
          client,
          domain.key,
          domain.label,
          domainSeeds.length > 0 ? domainSeeds : fallbackSeeds,
          thisBatch,
          currentId
        );

        // ID 재설정 및 필드 보정
        cases.forEach((c, idx) => {
          c.id = currentId + idx;
          c.domain = c.domain || domain.key;
          c.domain_label = c.domain_label || domain.label;
          c.feasibility = c.feasibility || 'api_needed';
          c.complexity = c.complexity || 'medium';
          c.business_value = c.business_value || 'medium';
          c.roles = (c.roles || []).filter(r => ALL_ROLES.includes(r));
          c.missing_tech = c.missing_tech || [];
          c.required_apis = c.required_apis || [];
          c.pipeline_steps = c.pipeline_steps || [];
          c.tags = c.tags || [];
        });

        allCases.push(...cases);
        currentId += cases.length;
        domainGenerated += cases.length;
        console.log(`✅ ${cases.length}개 완료 (총 ${allCases.length}개)`);

        // 중간 저장
        if (allCases.length % 100 === 0) {
          fs.writeFileSync(
            path.join(outDir, 'testcases_partial.json'),
            JSON.stringify(allCases, null, 2)
          );
        }

        // API 레이트 리밋 방지
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.log(`❌ 오류: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // 1000개 목표 달성 확인
  console.log(`\n📊 총 생성된 케이스: ${allCases.length}개`);

  // ── 부족한 기술 분석 ────────────────────────────────────
  console.log('\n🔍 부족한 기술 분석 중...');
  const techAnalysis = await analyzeMissingTech(client, allCases);

  // ── 통계 계산 ───────────────────────────────────────────
  const stats = computeStats(allCases);

  // ── 최종 DB 파일 저장 ───────────────────────────────────
  const output = {
    meta: {
      generated_at: new Date().toISOString(),
      total_cases: allCases.length,
      version: '1.0.0',
      description: 'AI 오케스트레이터 1000개 테스트케이스 DB'
    },
    stats,
    tech_analysis: techAnalysis,
    cases: allCases
  };

  const outputPath = path.join(outDir, 'testcases_db.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ 저장 완료: ${outputPath}`);
  console.log(`📈 통계:`);
  console.log(`  - 즉시 가능 (ready): ${stats.by_feasibility.ready}개`);
  console.log(`  - API 연동 필요: ${stats.by_feasibility.api_needed}개`);
  console.log(`  - 커스텀 필요: ${stats.by_feasibility.custom_pipeline}개`);
  console.log(`  - 외부 전용: ${stats.by_feasibility.external_only}개`);
  console.log(`  - 신규 기술 필요: ${(techAnalysis.new_technologies||[]).length}개`);
  console.log(`  - 신규 역할 필요: ${(techAnalysis.new_roles||[]).length}개`);

  // 부족 기술 요약 저장
  fs.writeFileSync(
    path.join(outDir, 'missing_tech_analysis.json'),
    JSON.stringify(techAnalysis, null, 2)
  );

  // 부분 저장 파일 삭제
  const partial = path.join(outDir, 'testcases_partial.json');
  if (fs.existsSync(partial)) fs.unlinkSync(partial);

  return output;
}

main().catch(console.error);
