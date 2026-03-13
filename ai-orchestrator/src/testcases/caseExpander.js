/**
 * caseExpander.js
 * 기존 케이스를 기반으로 매일 새 테스트케이스를 로컬 로직으로 생성
 * API 없이 패턴 조합 + 변형으로 다양한 케이스 생성
 */

'use strict';

// ─────────────────────────────────────────────
// 도메인별 확장 템플릿
// ─────────────────────────────────────────────
const DOMAIN_TEMPLATES = {
  ecommerce: {
    label: '이커머스 & 셀러 오토메이션',
    verbs: ['스크래핑', '분석', '최적화', '자동화', '생성', '번역', '모니터링', '비교', '예측', '추천'],
    nouns: ['상품 페이지', '가격 데이터', '리뷰', '재고', '이미지', '키워드', '경쟁사', '배송 정보', '판매 트렌드', 'SEO 메타'],
    outputs: ['html', 'json', 'csv', 'report', 'dashboard', 'alert'],
    apis: ['Puppeteer', 'OCR_API', 'Remove_BG', 'Translation_API', 'GPT4V_API', 'ImageGen_API'],
    roles: ['researcher', 'analyst', 'coder', 'designer', 'translator'],
    feasibilities: ['ready', 'api_needed', 'api_needed', 'api_needed'],
    complexities: ['medium', 'high', 'high', 'extreme'],
    business_values: ['high', 'high', 'very_high'],
    missing_techs: ['상품페이지_스크래퍼', '가격비교_크롤러', '이미지_최적화_AI', '리뷰_감성분석']
  },
  marketing: {
    label: '마케팅 & 콘텐츠',
    verbs: ['작성', '기획', '분석', '최적화', '생성', '배포', '측정', '개인화', '자동화', 'A/B 테스트'],
    nouns: ['SNS 콘텐츠', '이메일 캠페인', '블로그 포스트', '광고 카피', '브랜드 전략', '콘텐츠 캘린더', '인플루언서 분석', 'KPI 대시보드', '경쟁사 분석', '고객 세그먼트'],
    outputs: ['content', 'strategy', 'report', 'calendar', 'copy', 'dashboard'],
    apis: ['Email_API', 'Slack_API', 'ImageGen_API', 'GPT4V_API', 'YouTube_API', 'Instagram_API'],
    roles: ['copywriter', 'strategist', 'analyst', 'designer', 'brand_strategist'],
    feasibilities: ['ready', 'ready', 'api_needed', 'api_needed'],
    complexities: ['low', 'medium', 'medium', 'high'],
    business_values: ['high', 'high', 'very_high'],
    missing_techs: ['콘텐츠_성과_예측', 'A/B테스트_자동화', '인플루언서_매칭_AI']
  },
  b2b: {
    label: 'B2B & 영업 자동화',
    verbs: ['분석', '생성', '자동화', '추출', '모니터링', '예측', '세그먼트', '리포팅', '탐색', '검증'],
    nouns: ['기업 정보', '잠재 고객', '제안서', 'RFP', '계약서', '영업 파이프라인', 'CRM 데이터', '산업 분석', '경쟁 인텔리전스', '공급망'],
    outputs: ['proposal', 'report', 'database', 'pipeline', 'analysis', 'contract'],
    apis: ['CRM_API', 'LinkedIn_API', 'Email_API', 'GitHub_API', 'Slack_API'],
    roles: ['researcher', 'analyst', 'writer', 'strategist', 'financial_analyst'],
    feasibilities: ['ready', 'api_needed', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'high', 'extreme'],
    business_values: ['very_high', 'very_high', 'high'],
    missing_techs: ['기업조사_API', '이탈예측_모델', 'RFP_자동_파서']
  },
  it: {
    label: 'IT & 개발 자동화',
    verbs: ['분석', '생성', '리팩토링', '테스트', '모니터링', '배포', '최적화', '보안감사', '문서화', '자동화'],
    nouns: ['코드베이스', 'API 문서', '보안 취약점', '성능 병목', '테스트 커버리지', '아키텍처', 'CI/CD 파이프라인', '로그 데이터', 'DB 스키마', '마이크로서비스'],
    outputs: ['code', 'documentation', 'report', 'config', 'test_suite', 'diagram'],
    apis: ['GitHub_API', 'Jira_API', 'Slack_API', 'SMS_API', 'Email_API'],
    roles: ['coder', 'security_expert', 'db_architect', 'automation_engineer', 'reviewer'],
    feasibilities: ['ready', 'ready', 'api_needed', 'api_needed'],
    complexities: ['medium', 'high', 'high', 'extreme'],
    business_values: ['high', 'very_high'],
    missing_techs: ['취약점_스캐너', '코드_품질_AI', '자동_테스트_생성기']
  },
  legal_hr: {
    label: '법무 & HR 자동화',
    verbs: ['검토', '생성', '분석', '자동화', '모니터링', '추출', '검증', '요약', '번역', '분류'],
    nouns: ['계약서', '법률 문서', '채용 공고', '인사 정책', '규정 준수 보고서', '급여 명세', '노동법 조항', '특허', '법원 판례', '내부 감사'],
    outputs: ['document', 'summary', 'report', 'checklist', 'analysis'],
    apis: ['Email_API', 'Slack_API', 'PDF_API', 'OCR_API'],
    roles: ['legal_expert', 'compliance_officer', 'writer', 'analyst', 'translator'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'high'],
    business_values: ['high', 'very_high'],
    missing_techs: ['급여계산_모듈', '특허DB_API', '법률문서_파서']
  },
  edu_med: {
    label: '교육 & 의료',
    verbs: ['생성', '분석', '요약', '번역', '평가', '추천', '시뮬레이션', '모니터링', '교육', '검증'],
    nouns: ['강의 자료', '의료 보고서', '환자 데이터', '교육 커리큘럼', '연구 논문', '진단 결과', '학습 경로', '임상 프로토콜', '의약품 정보', '건강 데이터'],
    outputs: ['curriculum', 'report', 'summary', 'recommendation', 'analysis'],
    apis: ['Whisper_STT', 'GPT4V_API', 'OCR_API', 'PDF_API'],
    roles: ['educator', 'medical_writer', 'analyst', 'researcher', 'validator'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'extreme'],
    business_values: ['high', 'very_high'],
    missing_techs: ['수식인식_OCR', '의료영상_AI', '개인화_학습_AI']
  },
  creative: {
    label: '크리에이티브 & 미디어',
    verbs: ['생성', '편집', '합성', '변환', '최적화', '스타일링', '애니메이션', '작곡', '번역', '큐레이션'],
    nouns: ['이미지', '동영상', '음악', '3D 모델', 'AR 콘텐츠', '일러스트', '시나리오', '소설', '게임 자산', 'UI 디자인'],
    outputs: ['image', 'video', 'audio', '3d_model', 'script', 'design'],
    apis: ['ImageGen_API', 'ElevenLabs_TTS', 'Whisper_STT', 'VideoGen_API', 'Music_API'],
    roles: ['designer', 'animator', 'artist3d', 'composer', 'illustrator'],
    feasibilities: ['api_needed', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'extreme'],
    business_values: ['high', 'very_high'],
    missing_techs: ['캐릭터일관성_AI', 'AR_렌더링', 'AI_작곡_API', '3D렌더링_API']
  },
  data_ai: {
    label: '데이터 & AI 파이프라인',
    verbs: ['분석', '모델링', '파이프라인 구축', '시각화', '예측', '이상 탐지', '분류', '클러스터링', '최적화', '자동화'],
    nouns: ['데이터셋', 'ML 모델', 'ETL 파이프라인', '대시보드', '예측 모델', '이상 탐지 시스템', 'NLP 파이프라인', '추천 시스템', '시계열 데이터', 'A/B 테스트'],
    outputs: ['model', 'pipeline', 'dashboard', 'report', 'prediction', 'visualization'],
    apis: ['GitHub_API', 'Slack_API', 'Email_API', 'Database_API'],
    roles: ['data_scientist', 'ml_engineer', 'analyst', 'automation_engineer', 'coder'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'extreme'],
    business_values: ['high', 'very_high'],
    missing_techs: ['NER_파이프라인', '이상탐지_ML', 'AutoML_플랫폼']
  },
  real_estate: {
    label: '부동산 & 공간 분석',
    verbs: ['분석', '예측', '시각화', '검색', '평가', '모니터링', '보고', '매칭', '최적화', '자동화'],
    nouns: ['매물 정보', '시세 데이터', '입지 분석', '투자 수익', '임대 관리', '건물 도면', '지역 통계', '공실 현황', '권리 분석', '개발 가능성'],
    outputs: ['report', 'map', 'analysis', 'recommendation', 'dashboard'],
    apis: ['Puppeteer', 'Email_API', 'GPT4V_API', 'Map_API'],
    roles: ['analyst', 'researcher', 'financial_analyst', 'data_scientist'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high'],
    business_values: ['high', 'very_high'],
    missing_techs: ['공간인식_AI', '부동산_시세_API', 'GIS_분석_모듈']
  },
  finance_invest: {
    label: '금융 & 투자 분석',
    verbs: ['분석', '예측', '백테스팅', '모니터링', '최적화', '리스크 관리', '보고', '시뮬레이션', '자동화', '알림'],
    nouns: ['포트폴리오', '주가 데이터', '재무제표', '시장 트렌드', '리스크 지표', '배당 분석', '채권 수익률', '환율', '옵션 가격', '크립토 데이터'],
    outputs: ['report', 'model', 'dashboard', 'alert', 'prediction'],
    apis: ['Finance_API', 'Email_API', 'Slack_API', 'SMS_API'],
    roles: ['financial_analyst', 'data_scientist', 'analyst', 'automation_engineer'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'extreme'],
    business_values: ['very_high'],
    missing_techs: ['실시간_시세_API', '옵션_프라이싱_모델', '크립토_분석_엔진']
  },
  healthcare: {
    label: '헬스케어 & 웰니스',
    verbs: ['분석', '모니터링', '예측', '추천', '자동화', '요약', '교육', '경고', '관리', '최적화'],
    nouns: ['환자 기록', '건강 지표', '약물 데이터', '임상 시험', '진단 이미지', '운동 계획', '식단 분석', '정신건강 평가', '원격진료', '의료비 청구'],
    outputs: ['report', 'plan', 'alert', 'summary', 'recommendation'],
    apis: ['Whisper_STT', 'GPT4V_API', 'OCR_API', 'Email_API'],
    roles: ['medical_writer', 'analyst', 'ml_engineer', 'validator'],
    feasibilities: ['ready', 'api_needed', 'custom_pipeline'],
    complexities: ['medium', 'high', 'extreme'],
    business_values: ['high', 'very_high'],
    missing_techs: ['의료영상_AI', 'PHR_연동_API', '임상결정_지원_AI']
  },
  government: {
    label: '공공 & 정부 서비스',
    verbs: ['분석', '생성', '자동화', '모니터링', '보고', '번역', '검증', '공개', '관리', '최적화'],
    nouns: ['공공 데이터', '민원 서류', '정책 문서', '예산 보고서', '환경 데이터', '교통 데이터', '선거 데이터', '행정 절차', '공공 안전', '인프라 현황'],
    outputs: ['report', 'document', 'dashboard', 'analysis', 'summary'],
    apis: ['Email_API', 'SMS_API', 'OCR_API', 'PDF_API'],
    roles: ['analyst', 'writer', 'compliance_officer', 'translator', 'researcher'],
    feasibilities: ['ready', 'api_needed'],
    complexities: ['medium', 'high'],
    business_values: ['high'],
    missing_techs: ['공공데이터_API_연동', '행정_문서_파서', '다국어_번역_엔진']
  }
};

// ─────────────────────────────────────────────
// 파이프라인 패턴 (입력→처리→출력)
// ─────────────────────────────────────────────
const PIPELINE_PATTERNS = [
  ['수집', '전처리', '분석', '리포트 생성'],
  ['크롤링', 'OCR', '번역', 'HTML 생성'],
  ['데이터 수집', '정제', 'ML 모델 적용', '결과 저장'],
  ['API 연동', '데이터 파싱', '인사이트 추출', '알림 발송'],
  ['문서 파싱', '요약', '분류', '데이터베이스 저장'],
  ['이미지 분석', '객체 인식', '메타데이터 추출', '태깅'],
  ['음성 입력', 'STT 변환', '의도 분석', '결과 생성'],
  ['요청 수신', '컨텍스트 파악', '다중 에이전트 처리', '결과 조합'],
  ['시장 데이터 수집', '트렌드 분석', '예측 모델 실행', '보고서 출력'],
  ['계획 수립', '리서치', '초안 작성', '검토 & 최종화']
];

// ─────────────────────────────────────────────
// 태그 풀
// ─────────────────────────────────────────────
const TAG_POOL = {
  ecommerce: ['이커머스', '셀러', '쇼핑몰', '자동화', '크롤링', '번역', 'OCR', '이미지처리'],
  marketing: ['마케팅', 'SNS', '콘텐츠', '캠페인', '광고', '브랜딩', 'ROI', 'KPI'],
  b2b: ['B2B', '영업', 'CRM', '제안서', '기업분석', '파이프라인', 'SaaS'],
  it: ['개발', 'DevOps', '보안', '코드', 'API', 'CI/CD', '모니터링', '자동화'],
  legal_hr: ['법무', 'HR', '계약', '규정준수', '급여', '채용', '법률'],
  edu_med: ['교육', '의료', '연구', '학습', '진단', '커리큘럼', 'E러닝'],
  creative: ['크리에이티브', '디자인', '이미지', '영상', '음악', '3D', 'AR'],
  data_ai: ['데이터', 'AI', 'ML', '파이프라인', '분석', '예측', '시각화'],
  real_estate: ['부동산', '투자', '입지분석', '시세', '임대', '공간'],
  finance_invest: ['금융', '투자', '포트폴리오', '주식', '리스크', '수익률'],
  healthcare: ['헬스케어', '건강', '의료', '진료', '환자', '웰니스'],
  government: ['공공', '정부', '행정', '민원', '정책', '공개데이터']
};

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

function pickUnique(arr, n) {
  return [...new Set(pickN(arr, n + 2))].slice(0, n);
}

// ─────────────────────────────────────────────
// 단일 케이스 생성
// ─────────────────────────────────────────────
function generateSingleCase(domain, tmpl, existingTitles, cycleNum) {
  const verb = pick(tmpl.verbs);
  const noun = pick(tmpl.nouns);
  const output = pick(tmpl.outputs);
  const feasibility = pick(tmpl.feasibilities);
  const complexity = pick(tmpl.complexities);
  const business_value = pick(tmpl.business_values);
  const roles = pickUnique(tmpl.roles, Math.floor(Math.random() * 3) + 2); // 2~4개
  const pipeline = pick(PIPELINE_PATTERNS);
  const tags = pickUnique(TAG_POOL[domain] || TAG_POOL.data_ai, 3);
  const missingTech = feasibility !== 'ready' ? [pick(tmpl.missing_techs)] : [];
  const apis = feasibility !== 'ready' ? pickN(tmpl.apis, Math.floor(Math.random() * 2) + 1) : [];

  // 기존 타이틀과 중복 방지 (verb+noun 조합)
  let attempts = 0;
  let title = `${noun} ${verb} 자동화 (사이클 ${cycleNum})`;
  while (existingTitles.has(title) && attempts < 10) {
    const v2 = pick(tmpl.verbs);
    const n2 = pick(tmpl.nouns);
    title = `${n2} ${v2} → ${output} 파이프라인`;
    attempts++;
  }

  return {
    domain,
    domain_label: tmpl.label,
    title,
    description: `${noun}을(를) 입력받아 ${verb} 처리 후 ${output} 형태로 출력하는 자동화 파이프라인`,
    input_type: ['text'],
    output_type: [output],
    feasibility,
    complexity,
    business_value,
    roles,
    required_apis: apis,
    missing_tech: missingTech,
    pipeline_steps: pipeline,
    estimated_time: complexity === 'low' ? '1~3분' : complexity === 'medium' ? '3~7분' : complexity === 'high' ? '7~15분' : '15분 이상',
    tags,
    system_coverage: feasibility === 'ready',
    implementation_priority: business_value === 'very_high' ? 'P1' : business_value === 'high' ? 'P2' : 'P3',
    test_status: 'pending'
  };
}

// ─────────────────────────────────────────────
// 메인 확장 함수
// ─────────────────────────────────────────────
function caseExpander(existingCases, targetCount = 50) {
  const existingTitles = new Set(existingCases.map(c => c.title));
  const domains = Object.keys(DOMAIN_TEMPLATES);
  const cycleNum = Math.floor(Date.now() / 86400000); // 일 단위 고유 번호
  const newCases = [];

  // 도메인별 부족 케이스 계산
  const domainCounts = {};
  for (const c of existingCases) domainCounts[c.domain] = (domainCounts[c.domain] || 0) + 1;

  // 가중치: 케이스 수가 적은 도메인에 더 많이 배분
  const totalExisting = existingCases.length;
  const weights = domains.map(d => {
    const existing = domainCounts[d] || 0;
    // 비율이 낮을수록 가중치 높음
    return Math.max(1, totalExisting * 0.1 - existing + 1);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // 각 도메인에 targetCount 배분
  const perDomain = domains.map((d, i) =>
    Math.max(1, Math.round((weights[i] / totalWeight) * targetCount))
  );

  // 배분 합 맞추기
  const allocated = perDomain.reduce((a, b) => a + b, 0);
  if (allocated < targetCount) {
    // 나머지 첫 도메인에 추가
    perDomain[0] += targetCount - allocated;
  }

  // 케이스 생성
  domains.forEach((domain, i) => {
    const tmpl = DOMAIN_TEMPLATES[domain];
    for (let j = 0; j < perDomain[i]; j++) {
      try {
        const c = generateSingleCase(domain, tmpl, existingTitles, cycleNum);
        existingTitles.add(c.title);
        newCases.push(c);
      } catch (e) {
        // 생성 실패 시 스킵
      }
    }
  });

  return newCases.slice(0, targetCount);
}

// ─────────────────────────────────────────────
// 기존 caseExpander.js 호환성 (이미 있을 수 있음)
// ─────────────────────────────────────────────
module.exports = { caseExpander, DOMAIN_TEMPLATES, generateSingleCase };

// CLI 직접 실행
if (require.main === module) {
  const existing = [];
  const cases = caseExpander(existing, 10);
  console.log(`생성된 케이스 ${cases.length}개:`);
  cases.forEach((c, i) => console.log(`  [${i+1}] [${c.domain}] ${c.title}`));
}
