// ============================================================
// 1000개 테스트케이스 로컬 생성기 v2
// API 없이 패턴 기반으로 1000개 케이스 생성
// ============================================================
const fs = require('fs');
const path = require('path');

// ── 역할 목록 ──────────────────────────────────────────────
const ALL_ROLES = [
  'planner','researcher','writer','coder','reviewer','designer','analyst',
  'validator','router','assembler','critic','illustrator','animator','artist3d',
  'ux_architect','composer','game_designer','game_coder','legal_expert',
  'medical_writer','financial_analyst','educator','strategist','copywriter',
  'brand_strategist','data_scientist','automation_engineer','novelist',
  'scenario_writer','translator'
];

// ── 도메인별 케이스 템플릿 ────────────────────────────────
const DOMAIN_TEMPLATES = {

  // ──────────────────────────────────────────────────────────
  // 1. 이커머스 & 셀러 오토메이션 (120개)
  // ──────────────────────────────────────────────────────────
  ecommerce: {
    label: '이커머스 & 셀러 오토메이션',
    templates: [
      // 상품등록/최적화
      { title: '{platform} 상품 URL → OCR번역 → 한국어 상세페이지', input:['url','image'], output:['html'], roles:['researcher','translator','designer'], apis:['Puppeteer','OCR_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['상품페이지_스크래퍼'], tags:['상품등록','번역'] },
      { title: '상품 키워드 → SEO 최적화 → 쇼핑몰 상품명 100개', input:['text'], output:['excel'], roles:['researcher','copywriter','analyst'], apis:[], feasibility:'ready', complexity:'low', value:'high', missing:[], tags:['SEO','상품명'] },
      { title: '경쟁사 {platform} 가격 → 크롤링 → 최저가 알림 슬랙', input:['url'], output:['json','sms'], roles:['researcher','automation_engineer','analyst'], apis:['Puppeteer','Slack_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['가격비교_크롤러'], tags:['가격모니터링','자동화'] },
      { title: '제품 사진 → 배경제거 → 흰배경 상품컷 10종', input:['image'], output:['image'], roles:['designer','illustrator'], apis:['Remove_BG_API'], feasibility:'api_needed', complexity:'low', value:'high', missing:[], tags:['이미지편집','상품사진'] },
      { title: '상품 스펙 엑셀 → AI 상세페이지 → HTML 자동생성', input:['excel'], output:['html'], roles:['writer','designer','coder'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['상세페이지','자동화'] },
      // 리뷰/고객관리
      { title: '리뷰 데이터 → 감성분석 → 불만 TOP5 → 개선보고서', input:['text','excel'], output:['text','excel'], roles:['data_scientist','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['리뷰분석','감성분석'] },
      { title: '1점 리뷰 → 원인분류 → CS 대응 멘트 자동생성', input:['text'], output:['text'], roles:['analyst','writer','legal_expert'], apis:[], feasibility:'ready', complexity:'low', value:'high', missing:[], tags:['CS자동화','리뷰대응'] },
      { title: '구매이력 DB → 재구매 패턴분석 → 리텐션 이메일', input:['database','excel'], output:['email'], roles:['data_scientist','analyst','copywriter'], apis:['Email_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['리텐션','CRM'] },
      { title: '이탈고객 세그먼트 → 할인쿠폰 설계 → SMS 일괄발송', input:['database'], output:['sms'], roles:['analyst','copywriter','automation_engineer'], apis:['SMS_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['재구매유도','할인'] },
      { title: '상품 Q&A 100건 → FAQ 정리 → 챗봇 답변 DB', input:['text'], output:['json'], roles:['researcher','writer','coder'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['FAQ','챗봇'] },
      // 재고/물류
      { title: '악성재고 목록 → 번들 할인 계산 → 프로모션 기획', input:['excel'], output:['text','excel'], roles:['financial_analyst','strategist','copywriter'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['재고관리','프로모션'] },
      { title: '판매데이터 → 계절성 예측 → 발주량 최적화 엑셀', input:['excel','database'], output:['excel'], roles:['data_scientist','financial_analyst'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['수요예측','재고최적화'] },
      { title: '배송지연 주문 → 자동 사과문 → 쿠폰 발송', input:['database'], output:['email','sms'], roles:['writer','automation_engineer'], apis:['Email_API','SMS_API'], feasibility:'api_needed', complexity:'low', value:'medium', missing:[], tags:['배송','CS자동화'] },
      { title: '물류비 데이터 → 택배사 비교 → 최적 배송사 추천', input:['excel'], output:['text'], roles:['data_scientist','financial_analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['물류최적화','비용절감'] },
      // 광고/마케팅
      { title: '베스트셀러 → 시즌 변형 카피 → 인스타 배너 5종', input:['text','image'], output:['image','text'], roles:['copywriter','designer','illustrator'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['광고소재','SNS'] },
      { title: '네이버 쇼핑 키워드 → 광고 입찰가 → ROI 예측', input:['text','excel'], output:['excel'], roles:['analyst','financial_analyst','strategist'], apis:['Naver_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['쇼핑광고_API'], tags:['광고최적화','키워드'] },
      { title: '광고 성과 데이터 → ROAS 분석 → 예산 재배분 제안', input:['excel','json'], output:['text','excel'], roles:['data_scientist','financial_analyst','strategist'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['광고분석','ROAS'] },
      { title: '고객 구매 프로필 → 초개인화 추천 → 이메일 뉴스레터', input:['database'], output:['email','html'], roles:['data_scientist','copywriter','designer'], apis:['Email_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['개인화_추천엔진'], tags:['개인화','뉴스레터'] },
      { title: '경쟁사 신상품 모니터링 → 주간 트렌드 리포트', input:['url'], output:['text'], roles:['researcher','analyst','writer'], apis:['Puppeteer'], feasibility:'api_needed', complexity:'medium', value:'medium', missing:[], tags:['경쟁분석','트렌드'] },
      { title: '인플루언서 리뷰 영상 → STT → 핵심 장단점 추출', input:['video','url'], output:['text'], roles:['researcher','analyst'], apis:['Whisper_STT','YouTube_API'], feasibility:'api_needed', complexity:'medium', value:'medium', missing:['영상분석'], tags:['인플루언서','리뷰분석'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 2. 마케팅 & 콘텐츠 에이전시 (120개)
  // ──────────────────────────────────────────────────────────
  marketing: {
    label: '마케팅 & 콘텐츠 에이전시',
    templates: [
      { title: '브랜드 키워드 → 검색트렌드 분석 → 콘텐츠 캘린더', input:['text'], output:['excel','text'], roles:['researcher','strategist','planner'], apis:['Google_Trends_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['콘텐츠전략','캘린더'] },
      { title: '경쟁사 SNS 분석 → 성과 TOP10 → 벤치마킹 전략', input:['url'], output:['text'], roles:['researcher','analyst','strategist'], apis:['Instagram_API','Puppeteer'], feasibility:'api_needed', complexity:'high', value:'high', missing:['SNS_스크래퍼'], tags:['경쟁분석','SNS'] },
      { title: '브랜드명+컬러 → 로고 3종 → 브랜드 가이드라인 PDF', input:['text'], output:['image','pdf'], roles:['brand_strategist','illustrator','designer'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['브랜딩','로고'] },
      { title: '블로그 주제 → 키워드 최적화 → SEO 블로그 5000자', input:['text'], output:['text'], roles:['researcher','writer','analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['블로그','SEO'] },
      { title: '상품/서비스 특성 → 타겟별 카피 10종 → A/B 테스트 설계', input:['text'], output:['text'], roles:['copywriter','analyst','strategist'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['카피라이팅','AB테스트'] },
      { title: '영상 스크립트 → AI 성우 녹음 → 배경음악 편집', input:['text'], output:['audio'], roles:['scenario_writer','composer'], apis:['ElevenLabs_API','BGM_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['음성합성_편집'], tags:['성우','영상'] },
      { title: '제품 이미지 + 카피 → 카드뉴스 5장 → 인스타 최적화', input:['image','text'], output:['image'], roles:['designer','copywriter','illustrator'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['카드뉴스','SNS'] },
      { title: '뉴스레터 구독자 데이터 → 세그먼트 → 타겟 이메일 발송', input:['database','excel'], output:['email'], roles:['analyst','copywriter','automation_engineer'], apis:['Mailchimp_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['이메일마케팅','세그먼트'] },
      { title: '마케팅 캠페인 결과 → 성과지표 분석 → 인사이트 리포트', input:['excel','json'], output:['text'], roles:['data_scientist','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['캠페인분석','리포트'] },
      { title: '키워드 → 유튜브 트렌드 → 영상 기획안 + 대본', input:['text'], output:['text'], roles:['researcher','planner','scenario_writer'], apis:['YouTube_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['유튜브','콘텐츠기획'] },
      { title: '행사 안내문 → 10개국 번역 → 다국어 이메일 발송', input:['text'], output:['email'], roles:['translator','writer','automation_engineer'], apis:['Email_API'], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['번역','다국어'] },
      { title: '브랜드 히스토리 → 스토리텔링 콘텐츠 → 랜딩페이지', input:['text'], output:['html'], roles:['writer','designer','coder'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['스토리텔링','랜딩페이지'] },
      { title: '고객 후기 50개 → 소셜 증거 → 배너 광고 소재', input:['text'], output:['image','text'], roles:['copywriter','designer','illustrator'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['소셜증거','광고'] },
      { title: '포드캐스트 대본 → 녹음 → 에피소드 쇼노트 자동작성', input:['text','audio'], output:['text','audio'], roles:['scenario_writer','writer','composer'], apis:['ElevenLabs_API'], feasibility:'api_needed', complexity:'medium', value:'medium', missing:[], tags:['팟캐스트','자동화'] },
      { title: '웹세미나 내용 → STT → 블로그 + 소셜 컷 자동생성', input:['video','audio'], output:['text'], roles:['researcher','writer','copywriter'], apis:['Whisper_STT'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['웨비나','콘텐츠재활용'] },
      { title: '제품 스펙 → 보도자료 → 기자 DB 타겟 발송', input:['text'], output:['text','email'], roles:['writer','researcher','automation_engineer'], apis:['Email_API','Press_DB'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['언론사_DB'], tags:['PR','보도자료'] },
      { title: '경쟁사 광고 → 분석 → 차별화 포지셔닝 전략', input:['image','text','url'], output:['text'], roles:['analyst','strategist','brand_strategist'], apis:['Puppeteer'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['포지셔닝','광고분석'] },
      { title: '이달의 마케팅 예산 → 채널별 배분 → ROI 시뮬레이션', input:['excel'], output:['excel','text'], roles:['financial_analyst','strategist','analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['예산배분','ROI'] },
      { title: '고객 인터뷰 음성 → STT → 페르소나 보고서', input:['audio'], output:['text'], roles:['researcher','analyst','writer'], apis:['Whisper_STT'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['페르소나','고객조사'] },
      { title: '브랜드 콘텐츠 → 멀티채널 포맷 변환 → 자동 스케줄링', input:['text','image'], output:['json'], roles:['copywriter','automation_engineer','strategist'], apis:['Buffer_API','Hootsuite_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['SNS_스케줄러'], tags:['멀티채널','자동화'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 3. B2B 세일즈 & CRM (100개)
  // ──────────────────────────────────────────────────────────
  b2b: {
    label: 'B2B 세일즈 & CRM',
    templates: [
      { title: 'RFP 문서 → 요구사항 분석 → 기술 제안서 초안', input:['pdf'], output:['text'], roles:['researcher','planner','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['제안서','RFP'] },
      { title: '잠재고객 리스트 → 기업조사 → 초개인화 콜드이메일', input:['excel'], output:['email'], roles:['researcher','strategist','copywriter'], apis:['LinkedIn_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['기업조사_API'], tags:['콜드메일','리드'] },
      { title: '영업 통화 녹음 → STT → 반론극복 패턴 분석', input:['audio'], output:['text','excel'], roles:['analyst','educator','writer'], apis:['Whisper_STT'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['영업분석','통화분석'] },
      { title: 'CRM 데이터 → 이탈 위험도 점수화 → 우선순위 알림', input:['database','excel'], output:['json','text'], roles:['data_scientist','analyst','automation_engineer'], apis:['CRM_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['이탈예측_모델'], tags:['CRM','이탈방지'] },
      { title: '계약서 초안 → 법적 리스크 검토 → 수정안 제시', input:['pdf','text'], output:['text'], roles:['legal_expert','analyst','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['계약서','법무'] },
      { title: '영업 제안 PPT → 임원 요약 → 1페이지 보고서', input:['text'], output:['text'], roles:['writer','analyst','planner'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['임원보고','요약'] },
      { title: '고객사 연간보고서 → 고통포인트 추출 → 솔루션 매핑', input:['pdf'], output:['text'], roles:['researcher','analyst','strategist'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['고객분석','솔루션'] },
      { title: '명함 사진 → OCR → CRM 자동 등록 → 후속 이메일', input:['image'], output:['json','email'], roles:['automation_engineer','copywriter'], apis:['GPT4V_API','CRM_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['명함관리','CRM'] },
      { title: '경쟁사 동향 → 주간 인텔리전스 브리핑 자동생성', input:['url'], output:['text','email'], roles:['researcher','analyst','writer'], apis:['Puppeteer'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['경쟁정보','인텔리전스'] },
      { title: '고객 미팅 메모 → 후속 조치 리스트 → CRM 업데이트', input:['text','audio'], output:['text','json'], roles:['analyst','writer','automation_engineer'], apis:['Whisper_STT','CRM_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['미팅관리','CRM'] },
      { title: '영업 스크립트 → 대화 시뮬레이션 → 훈련 피드백', input:['text'], output:['text'], roles:['educator','scenario_writer','analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['영업훈련','롤플레잉'] },
      { title: '파이프라인 데이터 → 수주 확률 예측 → 대시보드', input:['database','excel'], output:['json'], roles:['data_scientist','financial_analyst','analyst'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:['수주예측_ML'], tags:['파이프라인','예측'] },
      { title: '가격 제안 → 협상 시나리오 3종 → 최적 전략 추천', input:['text','excel'], output:['text'], roles:['strategist','financial_analyst','analyst'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['가격협상','전략'] },
      { title: '고객 만족도 조사 → NPS 분석 → 이탈 방지 액션플랜', input:['excel','json'], output:['text'], roles:['data_scientist','analyst','strategist'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['NPS','고객만족'] },
      { title: '파트너사 계약 → 수수료 자동계산 → 월 정산 보고서', input:['pdf','excel'], output:['excel','text'], roles:['financial_analyst','automation_engineer','legal_expert'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['파트너정산','자동화'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 4. 소프트웨어 개발 & IT 인프라 (120개)
  // ──────────────────────────────────────────────────────────
  it: {
    label: '소프트웨어 개발 & IT 인프라',
    templates: [
      { title: '화면 디자인 캡처 → 비전 분석 → React 컴포넌트 코드', input:['image'], output:['code'], roles:['ux_architect','designer','coder'], apis:['GPT4V_API'], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['프론트엔드','컴포넌트'] },
      { title: '자연어 요구사항 → ERD 설계 → SQL 스키마 생성', input:['text'], output:['code','text'], roles:['planner','data_scientist','coder'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['데이터베이스','설계'] },
      { title: '에러 로그 → 원인 분석 → 수정 코드 → PR 생성', input:['text','code'], output:['code'], roles:['reviewer','coder','automation_engineer'], apis:['GitHub_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['버그수정','PR자동화'] },
      { title: 'API 문서 → E2E 테스트 코드 → CI 파이프라인 설정', input:['text','json'], output:['code'], roles:['coder','reviewer','automation_engineer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['테스트자동화','CI'] },
      { title: '레거시 코드 → 분석 → 모던 스택 리팩토링 계획', input:['code'], output:['text','code'], roles:['planner','reviewer','coder'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['리팩토링','레거시'] },
      { title: '기술 스택 결정 → 아키텍처 설계 → 마이그레이션 로드맵', input:['text'], output:['text'], roles:['planner','reviewer','analyst'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['아키텍처','마이그레이션'] },
      { title: 'AWS 청구서 → 비용 분석 → 절감 최적화 권고안', input:['pdf','excel'], output:['text'], roles:['data_scientist','financial_analyst','coder'], apis:['AWS_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['클라우드비용','AWS'] },
      { title: '보안 취약점 스캔 → OWASP 매핑 → 방어 코드 패치', input:['code'], output:['code','text'], roles:['reviewer','legal_expert','coder'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:['보안스캐너'], tags:['보안','OWASP'] },
      { title: 'Git 커밋 히스토리 → 릴리즈 노트 → 변경이력 문서화', input:['code','text'], output:['text'], roles:['writer','analyst'], apis:['GitHub_API'], feasibility:'api_needed', complexity:'low', value:'medium', missing:[], tags:['릴리즈노트','문서화'] },
      { title: '인프라 다이어그램 → IaC 코드(Terraform) → 배포 스크립트', input:['text','image'], output:['code'], roles:['planner','coder','reviewer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['IaC','Terraform'] },
      { title: 'DB 쿼리 → 실행계획 분석 → 인덱스 최적화 권고', input:['code','text'], output:['code','text'], roles:['data_scientist','coder','reviewer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['쿼리최적화','DB'] },
      { title: '오픈소스 라이브러리 → 취약점 스캔 → 업데이트 PR', input:['code'], output:['code'], roles:['reviewer','coder','automation_engineer'], apis:['GitHub_API','CVE_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['오픈소스','보안'] },
      { title: 'Figma 디자인 → 디자인토큰 추출 → 테마 CSS 생성', input:['json','image'], output:['code'], roles:['ux_architect','designer','coder'], apis:['Figma_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['디자인시스템','CSS'] },
      { title: '자연어 → GraphQL 쿼리 → API 응답 구조 설계', input:['text'], output:['code','json'], roles:['coder','planner','reviewer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['GraphQL','API설계'] },
      { title: '모니터링 알림 → 장애 분류 → 자동 에스컬레이션', input:['json','text'], output:['text'], roles:['automation_engineer','analyst','coder'], apis:['PagerDuty_API','Slack_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['모니터링','장애대응'] },
      { title: '코드 리뷰 요청 → AI 코드 리뷰 → PR 코멘트 자동작성', input:['code'], output:['text'], roles:['reviewer','coder','critic'], apis:['GitHub_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['코드리뷰','PR'] },
      { title: '마이크로서비스 API → OpenAPI 스펙 → SDK 자동생성', input:['code','json'], output:['code'], roles:['coder','writer','automation_engineer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['API문서','SDK'] },
      { title: '성능 테스트 결과 → 병목 분석 → 최적화 코드 패치', input:['json','text'], output:['code','text'], roles:['data_scientist','coder','reviewer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['성능최적화','병목분석'] },
      { title: '비즈니스 로직 → 단위 테스트 → 커버리지 리포트', input:['code'], output:['code','text'], roles:['coder','reviewer'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['단위테스트','TDD'] },
      { title: '도커파일 → 멀티스테이지 최적화 → CI/CD 파이프라인', input:['code'], output:['code'], roles:['coder','automation_engineer','reviewer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['Docker','CICD'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 5. 법률 / 행정 / HR / 재무 (100개)
  // ──────────────────────────────────────────────────────────
  legal_hr: {
    label: '법률 / 행정 / HR / 재무',
    templates: [
      { title: '계약서 → 근로기준법 검토 → 독소조항 리포트', input:['pdf'], output:['text'], roles:['researcher','legal_expert','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['계약검토','법률'] },
      { title: '이력서 100개 → 직무 적합도 점수화 → TOP10 + 탈락사유', input:['pdf','text'], output:['excel','text'], roles:['researcher','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['채용자동화','HR'] },
      { title: '급여 데이터 → 세금 자동계산 → 급여명세서 PDF 발급', input:['excel'], output:['pdf'], roles:['financial_analyst','automation_engineer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:['급여계산_모듈'], tags:['급여관리','세무'] },
      { title: '피해사실 서술 → 법적요건 검토 → 내용증명 초안', input:['text'], output:['text','pdf'], roles:['legal_expert','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['내용증명','법무'] },
      { title: '재무제표 → 이상거래 탐지 → 감사 포인트 리포트', input:['excel','pdf'], output:['text'], roles:['financial_analyst','data_scientist','legal_expert'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['감사','이상탐지'] },
      { title: '직원 성과 데이터 → 평가 기준 적용 → 피드백 레터', input:['excel'], output:['text'], roles:['analyst','writer','educator'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['성과평가','HR'] },
      { title: '규정집 텍스트 → Q&A 데이터셋 → 사내 챗봇 구축', input:['pdf','text'], output:['json'], roles:['researcher','coder','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['사내봇','규정'] },
      { title: '사고 보고서 → 과실 분석 → 보험 청구 문서 작성', input:['text','image'], output:['text'], roles:['legal_expert','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['보험','사고처리'] },
      { title: '특허 명세서 → 청구항 분석 → 침해 여부 검토', input:['pdf'], output:['text'], roles:['legal_expert','researcher','analyst'], apis:[], feasibility:'ready', complexity:'extreme', value:'high', missing:['특허DB_API'], tags:['특허','지식재산'] },
      { title: '연간 예산 계획 → 시나리오별 시뮬레이션 → CFO 보고서', input:['excel'], output:['excel','text'], roles:['financial_analyst','planner','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['예산계획','CFO'] },
      { title: '근태기록 → 이상패턴 탐지 → 퇴사징후 예측', input:['excel','database'], output:['text'], roles:['data_scientist','analyst','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['근태분석','이직예측'] },
      { title: '외국인 직원 이력서 → 비자 적합성 → E-7 지원 가이드', input:['pdf'], output:['text'], roles:['legal_expert','researcher','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['비자','외국인채용'] },
      { title: '세금 신고 데이터 → 절세 방안 → 세무 전략 보고서', input:['excel','pdf'], output:['text'], roles:['financial_analyst','legal_expert','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['절세','세무전략'] },
      { title: '단체협약 → 조항별 의무사항 → 이행 체크리스트', input:['pdf'], output:['text','excel'], roles:['legal_expert','analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['노무','단체협약'] },
      { title: '벤처기업 주식옵션 → 희석효과 분석 → 투자자 설명자료', input:['excel'], output:['text'], roles:['financial_analyst','legal_expert','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['스톡옵션','투자'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 6. 교육 / 의료 / 미디어 (80개)
  // ──────────────────────────────────────────────────────────
  edu_med: {
    label: '교육 / 의료 / 미디어',
    templates: [
      { title: '강의 텍스트 → 난이도별 3단계 요약 → 플래시카드', input:['text'], output:['text'], roles:['educator','writer'], apis:[], feasibility:'ready', complexity:'low', value:'high', missing:[], tags:['교육콘텐츠','요약'] },
      { title: '의료 상담 대화 → SOAP 형식 EMR 차트 자동작성', input:['audio','text'], output:['text'], roles:['medical_writer','researcher'], apis:['Whisper_STT'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['EMR','의료자동화'] },
      { title: '기출문제 이미지 → 수식인식 → 유사문제 20개 생성', input:['image'], output:['text'], roles:['educator','coder'], apis:['GPT4V_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['수식인식_OCR'], tags:['문제생성','교육'] },
      { title: '건강검진 수치 → 쉬운 해설 → 개인 맞춤 건강 가이드', input:['text','pdf'], output:['text'], roles:['medical_writer','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['건강정보','의료설명'] },
      { title: '영자신문 → 수준별 3단계 리라이팅 → 어휘 문제', input:['text'], output:['text'], roles:['educator','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['영어교육','리딩'] },
      { title: '웹소설 DB → 설정 일관성 검토 → 오류 리포트', input:['text','database'], output:['text'], roles:['researcher','analyst','critic'], apis:[], feasibility:'ready', complexity:'high', value:'medium', missing:[], tags:['웹소설','설정관리'] },
      { title: '학생 답안 → 루브릭 채점 → 개인 피드백 레터', input:['text'], output:['text'], roles:['educator','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['자동채점','피드백'] },
      { title: '병원 FAQ → 환자용 쉬운언어 → 다국어 설명 자료', input:['text'], output:['text'], roles:['medical_writer','translator','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['의료설명','다국어'] },
      { title: '뉴스 기사 → 팩트체크 → 신뢰도 점수 리포트', input:['text','url'], output:['text'], roles:['researcher','analyst','critic'], apis:['Puppeteer'], feasibility:'api_needed', complexity:'high', value:'high', missing:['팩트체크_DB'], tags:['팩트체크','언론'] },
      { title: '인터뷰 영상 → STT → 하이라이트 클립 시간코드', input:['video'], output:['text','json'], roles:['researcher','analyst'], apis:['Whisper_STT','Video_API'], feasibility:'api_needed', complexity:'medium', value:'medium', missing:['영상분석_AI'], tags:['인터뷰','영상분석'] },
      { title: '동화 키워드 → 줄거리 → 삽화 10장 → 전자책 PDF', input:['text'], output:['pdf','image'], roles:['novelist','illustrator','assembler'], apis:['ImageGen_API','PDF_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['동화','전자책'] },
      { title: '임상 데이터 → 통계 분석 → 학술지 형식 보고서', input:['excel','database'], output:['text'], roles:['medical_writer','data_scientist','writer'], apis:[], feasibility:'ready', complexity:'extreme', value:'high', missing:[], tags:['임상연구','통계'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 7. 크리에이티브 & 디자인 (80개)
  // ──────────────────────────────────────────────────────────
  creative: {
    label: '크리에이티브 & 디자인',
    templates: [
      { title: '브랜드 컨셉 → UI 디자인 시스템 → Figma 토큰 JSON', input:['text'], output:['json'], roles:['ux_architect','designer','brand_strategist'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['디자인시스템','UI'] },
      { title: '감성 키워드 → 일러스트 5종 → 굿즈 목업', input:['text'], output:['image'], roles:['illustrator','designer'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['일러스트','굿즈'] },
      { title: '제품 카탈로그 → 3D 제품컷 → 360도 회전 HTML', input:['image','text'], output:['html','image'], roles:['artist3d','designer','coder'], apis:['3D_Render_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['3D렌더링_API'], tags:['3D','제품시각화'] },
      { title: '앱 화면 설계 → 사용성 테스트 시나리오 → 프로토타입', input:['text'], output:['html'], roles:['ux_architect','designer','coder'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['UX','프로토타입'] },
      { title: '캐릭터 설정 → 감정별 표정 6종 → 애니메이션 GIF', input:['text','image'], output:['image'], roles:['illustrator','animator'], apis:['ImageGen_API','Animation_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['캐릭터일관성_AI'], tags:['캐릭터','애니메이션'] },
      { title: '공간 컨셉 → 인테리어 무드보드 → AR 미리보기', input:['text','image'], output:['image'], roles:['designer','artist3d','illustrator'], apis:['ImageGen_API','AR_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['AR_렌더링','공간인식_AI'], tags:['인테리어','AR'] },
      { title: '영상 컨셉 → 스토리보드 → AI 영상 클립 합성', input:['text'], output:['video'], roles:['scenario_writer','animator','illustrator'], apis:['VideoGen_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['AI영상생성'], tags:['영상제작','스토리보드'] },
      { title: '음악 무드 키워드 → 배경음악 → 영상 싱크 편집', input:['text','video'], output:['audio','video'], roles:['composer','animator'], apis:['MusicGen_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['AI작곡_API'], tags:['BGM','음악생성'] },
      { title: '패션 트렌드 → 시즌 룩북 → SNS 컨텐츠 패키지', input:['text','image'], output:['image'], roles:['designer','brand_strategist','copywriter'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['패션','룩북'] },
      { title: '게임 설정 → 아트 컨셉 → 게임 UI 모형 5종', input:['text'], output:['image'], roles:['game_designer','illustrator','ux_architect'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['게임아트','UI'] },
      { title: '타이포그래피 컨셉 → 폰트 조합 → 포스터 3종', input:['text'], output:['image'], roles:['designer','illustrator','brand_strategist'], apis:['ImageGen_API'], feasibility:'api_needed', complexity:'medium', value:'medium', missing:[], tags:['타이포그래피','포스터'] },
      { title: '브랜드 컬러 → 다크/라이트 테마 → CSS 변수 세트', input:['text','json'], output:['code'], roles:['designer','ux_architect','coder'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['테마','CSS'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 8. 데이터 / AI / 자동화 (80개)
  // ──────────────────────────────────────────────────────────
  data_ai: {
    label: '데이터 / AI / 자동화',
    templates: [
      { title: '원시 데이터 → 전처리 스크립트 → 분석 대시보드', input:['excel','database'], output:['code','html'], roles:['data_scientist','coder','analyst'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['데이터분석','대시보드'] },
      { title: '비정형 텍스트 → NER → 구조화된 DB 자동저장', input:['text'], output:['database','json'], roles:['data_scientist','coder','automation_engineer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:['NER_파이프라인'], tags:['NER','데이터구조화'] },
      { title: 'Excel 보고서 → 자동 분석 → Slack 알림 + 차트', input:['excel'], output:['text','image'], roles:['data_scientist','automation_engineer','analyst'], apis:['Slack_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['자동화','리포팅'] },
      { title: 'API 로그 → 이상트래픽 탐지 → 보안 알림', input:['json','text'], output:['text'], roles:['data_scientist','automation_engineer','reviewer'], apis:['Slack_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['이상탐지_ML'], tags:['보안','이상탐지'] },
      { title: '학습 데이터셋 → 품질 검증 → 레이블링 오류 보고서', input:['json','excel'], output:['text','excel'], roles:['data_scientist','analyst','validator'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['데이터품질','ML'] },
      { title: '업무 프로세스 설명 → RPA 스크립트 → 자동화 배포', input:['text'], output:['code'], roles:['automation_engineer','coder','planner'], apis:['RPA_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['RPA_플랫폼'], tags:['RPA','업무자동화'] },
      { title: '시계열 데이터 → ARIMA 예측 → 시각화 보고서', input:['excel','database'], output:['text','image'], roles:['data_scientist','analyst','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['시계열','예측'] },
      { title: 'Webhook 이벤트 → 조건 분기 → 다채널 액션 자동화', input:['json'], output:['json'], roles:['automation_engineer','coder','planner'], apis:['Zapier_API','Make_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:[], tags:['웹훅','자동화'] },
      { title: '데이터 파이프라인 → Airflow DAG → 스케줄 자동화', input:['code','text'], output:['code'], roles:['data_scientist','coder','automation_engineer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['데이터파이프라인','Airflow'] },
      { title: 'ML 모델 → API 래핑 → 모니터링 대시보드', input:['code'], output:['code','html'], roles:['coder','data_scientist','automation_engineer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['MLOps','모델서빙'] },
      { title: '챗봇 대화 로그 → 실패 케이스 추출 → 의도 개선안', input:['json','text'], output:['text'], roles:['data_scientist','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['챗봇','의도분류'] },
      { title: 'IoT 센서 데이터 → 이상감지 → 예방정비 알림', input:['database','json'], output:['text'], roles:['data_scientist','automation_engineer','analyst'], apis:['IoT_API','SMS_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['IoT_플랫폼'], tags:['IoT','예방정비'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 9. 부동산 & 건설 (50개)
  // ──────────────────────────────────────────────────────────
  real_estate: {
    label: '부동산 & 건설',
    templates: [
      { title: '등기부등본 → 근저당/가처분 분석 → 전세사기 위험도', input:['pdf','text'], output:['text'], roles:['legal_expert','analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['부동산','전세사기'] },
      { title: '분양 정보 → 입지분석 → 투자 수익률 시뮬레이션', input:['text','pdf'], output:['text','excel'], roles:['financial_analyst','researcher','analyst'], apis:['부동산_데이터_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['부동산_데이터_API'], tags:['분양','투자분석'] },
      { title: '건축 도면 → AI 분석 → 인테리어 제안 3종', input:['image','pdf'], output:['text','image'], roles:['designer','analyst','illustrator'], apis:['GPT4V_API','ImageGen_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['인테리어','건축'] },
      { title: '매물 정보 → 시세 비교 → 적정가 산정 리포트', input:['text','excel'], output:['text'], roles:['financial_analyst','researcher','analyst'], apis:['부동산시세_API'], feasibility:'api_needed', complexity:'medium', value:'high', missing:['실거래가_API'], tags:['시세분석','매물'] },
      { title: '상권 데이터 → 유동인구 분석 → 창업 적합도 리포트', input:['database','excel'], output:['text'], roles:['researcher','analyst','financial_analyst'], apis:['상권분석_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['상권분석_API'], tags:['상권','창업'] },
      { title: '임대차 계약서 → 위험조항 체크 → 협상 포인트', input:['pdf'], output:['text'], roles:['legal_expert','analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['임대차','계약검토'] },
      { title: '건물 점검 보고서 → 하자 우선순위 → 수리 견적 비교', input:['text','image'], output:['text','excel'], roles:['analyst','financial_analyst'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['하자검토','수리'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 10. 금융 & 투자 (50개)
  // ──────────────────────────────────────────────────────────
  finance_invest: {
    label: '금융 & 투자',
    templates: [
      { title: '재무제표 → 주요 지표 분석 → 투자 의사결정 보고서', input:['pdf','excel'], output:['text'], roles:['financial_analyst','researcher','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['재무분석','투자'] },
      { title: '주식 데이터 → 기술적 분석 → 매매 시그널 알림', input:['database','excel'], output:['text'], roles:['data_scientist','financial_analyst','analyst'], apis:['Stock_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['주식데이터_API'], tags:['주식','기술분석'] },
      { title: '펀드 포트폴리오 → 리스크 분산 → 리밸런싱 제안', input:['excel'], output:['excel','text'], roles:['financial_analyst','analyst','data_scientist'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['포트폴리오','리스크관리'] },
      { title: '암호화폐 시장 뉴스 → 감성분석 → 단기 변동성 예측', input:['text','url'], output:['text'], roles:['data_scientist','analyst','researcher'], apis:['Crypto_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['크립토_감성분석'], tags:['암호화폐','감성분석'] },
      { title: '개인 지출 내역 → 예산 최적화 → 저축 플랜 설계', input:['excel','text'], output:['text','excel'], roles:['financial_analyst','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['가계부','재테크'] },
      { title: '기업 IR 자료 → 핵심 요약 → 투자자 업데이트 뉴스레터', input:['pdf'], output:['text','email'], roles:['financial_analyst','writer','automation_engineer'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['IR','투자자소통'] },
      { title: '대출 신청 정보 → 신용리스크 평가 → 심사 보고서', input:['text','excel'], output:['text'], roles:['financial_analyst','analyst','legal_expert'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:['신용평가_모델'], tags:['대출심사','신용평가'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 11. 헬스케어 & 바이오 (50개)
  // ──────────────────────────────────────────────────────────
  healthcare: {
    label: '헬스케어 & 바이오',
    templates: [
      { title: '임상시험 프로토콜 → IRB 제출용 → 동의서 초안', input:['text','pdf'], output:['text'], roles:['medical_writer','legal_expert','researcher'], apis:[], feasibility:'ready', complexity:'extreme', value:'high', missing:[], tags:['임상시험','IRB'] },
      { title: '처방전 이미지 → OCR → 상호작용 점검 → 복약 안내', input:['image'], output:['text'], roles:['medical_writer','researcher'], apis:['GPT4V_API','Drug_DB_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['약물DB_API'], tags:['처방전','복약관리'] },
      { title: '환자 설문 데이터 → 증상 패턴 분석 → 예방 가이드', input:['excel','text'], output:['text'], roles:['medical_writer','data_scientist','writer'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['증상분석','예방의학'] },
      { title: '의학 논문 → 비전문가 설명 → 블로그 포스팅', input:['pdf'], output:['text'], roles:['medical_writer','writer','researcher'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['의학정보','건강블로그'] },
      { title: '건강검진 추이 데이터 → 위험군 분류 → 관리 프로그램', input:['excel','database'], output:['text'], roles:['medical_writer','data_scientist','educator'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['건강관리','예방'] },
      { title: '임상 케이스 → 감별진단 → 참고문헌 인용 보고서', input:['text'], output:['text'], roles:['medical_writer','researcher','writer'], apis:['PubMed_API'], feasibility:'api_needed', complexity:'extreme', value:'high', missing:['의학DB_API'], tags:['케이스스터디','진단'] },
      { title: '영양제 성분 목록 → 근거 분석 → 소비자 안내문', input:['text','pdf'], output:['text'], roles:['medical_writer','researcher','writer'], apis:[], feasibility:'ready', complexity:'medium', value:'medium', missing:[], tags:['영양제','건강정보'] },
    ]
  },

  // ──────────────────────────────────────────────────────────
  // 12. 공공 & 정부 서비스 (50개)
  // ──────────────────────────────────────────────────────────
  government: {
    label: '공공 & 정부 서비스',
    templates: [
      { title: '민원 접수 텍스트 → 자동 분류 → 담당부서 배정', input:['text'], output:['json','text'], roles:['automation_engineer','analyst','router'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['민원자동화','행정'] },
      { title: '법령 텍스트 → 일반인 해설 → 다국어 안내문', input:['pdf','text'], output:['text'], roles:['legal_expert','writer','translator'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['법령해설','행정서비스'] },
      { title: '예산 집행 데이터 → 감사 분석 → 이상지출 탐지', input:['excel','database'], output:['text'], roles:['financial_analyst','data_scientist','legal_expert'], apis:[], feasibility:'ready', complexity:'high', value:'high', missing:[], tags:['예산감사','공공회계'] },
      { title: '공공데이터 → 시각화 대시보드 → 시민 정보 포털', input:['database','excel'], output:['html'], roles:['data_scientist','designer','coder'], apis:['공공데이터_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:[], tags:['공공데이터','대시보드'] },
      { title: '민원 답변 초안 → 법령 근거 확인 → 공문 형식 완성', input:['text'], output:['text'], roles:['legal_expert','writer','validator'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['민원답변','공문'] },
      { title: '정책 문서 → 이해관계자별 요약 → 브리핑 자료', input:['pdf'], output:['text'], roles:['researcher','writer','planner'], apis:[], feasibility:'ready', complexity:'medium', value:'high', missing:[], tags:['정책브리핑','공공커뮤니케이션'] },
      { title: '재난 상황 보고 → 대응 매뉴얼 → 다채널 긴급 알림', input:['text'], output:['text','sms'], roles:['writer','automation_engineer','planner'], apis:['SMS_API','Alert_API'], feasibility:'api_needed', complexity:'high', value:'high', missing:['긴급알림_시스템'], tags:['재난대응','긴급알림'] },
    ]
  },
};

// ── 플랫폼/제품/서비스 변형 목록 ────────────────────────
const PLATFORMS = ['네이버', '쿠팡', '아마존', '타오바오', '이베이', '알리바바', '카카오', '무신사', '배달의민족', 'G마켓'];
const INDUSTRIES = ['뷰티', '식품', '패션', '전자제품', 'IT서비스', '교육', '의료', '금융', '부동산', '자동차', '여행', '반려동물'];
const OUTPUT_FORMATS = ['보고서', '제안서', '분석서', '가이드', '매뉴얼', '체크리스트', '대시보드'];

// ── 케이스 생성 함수 ─────────────────────────────────────
function generateCasesForDomain(domain, domainConfig, targetCount, startId) {
  const cases = [];
  const templates = domainConfig.templates;
  let id = startId;

  // 기본 템플릿 그대로 추가
  templates.forEach(tpl => {
    if (cases.length >= targetCount) return;
    cases.push(createCase(id++, domain, domainConfig.label, tpl, ''));
  });

  // 변형을 통해 목표 개수 달성
  let templateIdx = 0;
  let variation = 0;
  while (cases.length < targetCount) {
    const tpl = templates[templateIdx % templates.length];
    const variationSuffix = getVariation(domain, variation, templateIdx);
    cases.push(createCase(id++, domain, domainConfig.label, tpl, variationSuffix, variation));
    templateIdx++;
    variation = Math.floor(templateIdx / templates.length);
  }

  return cases.slice(0, targetCount);
}

function getVariation(domain, variation, idx) {
  const platform = PLATFORMS[idx % PLATFORMS.length];
  const industry = INDUSTRIES[idx % INDUSTRIES.length];
  const format = OUTPUT_FORMATS[variation % OUTPUT_FORMATS.length];

  const variations = [
    ` (${platform} 특화)`,
    ` - ${industry} 업종`,
    ` → ${format} 형식`,
    ` (모바일 최적화)`,
    ` (글로벌 확장판)`,
    ` (중소기업 특화)`,
    ` (대기업 엔터프라이즈)`,
    ` (스타트업 린 버전)`,
    ` - 실시간 처리`,
    ` - 배치 처리 최적화`,
  ];
  return variations[variation % variations.length];
}

function createCase(id, domain, domainLabel, tpl, variationSuffix, variation = 0) {
  const title = tpl.title.replace('{platform}', PLATFORMS[variation % PLATFORMS.length]) + variationSuffix;
  const pipelineSteps = generatePipelineSteps(tpl.roles, tpl.input, tpl.output);
  const estimatedTime = estimateTime(tpl.complexity, tpl.roles.length);

  return {
    id,
    domain,
    domain_label: domainLabel,
    title,
    description: generateDescription(title, tpl.input, tpl.output, tpl.roles),
    input_type: tpl.input,
    output_type: tpl.output,
    feasibility: tpl.feasibility,
    complexity: tpl.complexity,
    business_value: tpl.value,
    roles: tpl.roles,
    required_apis: tpl.apis,
    missing_tech: tpl.missing,
    pipeline_steps: pipelineSteps,
    estimated_time: estimatedTime,
    tags: tpl.tags,
    system_coverage: tpl.feasibility === 'ready' ? true : false,
    implementation_priority: tpl.value === 'high' ? 'P1' : tpl.value === 'medium' ? 'P2' : 'P3',
    test_status: 'pending',
    created_at: new Date().toISOString()
  };
}

function generateDescription(title, inputs, outputs, roles) {
  const inputStr = inputs.join(', ');
  const outputStr = outputs.join(', ');
  const roleStr = roles.slice(0, 3).join(' → ');
  return `입력(${inputStr})을 분석하여 ${outputStr} 형태로 변환. AI 역할: ${roleStr}. 실무 자동화 시나리오로 반복 업무 제거 목표.`;
}

function generatePipelineSteps(roles, inputs, outputs) {
  const steps = [];
  if (inputs.some(i => ['audio','video'].includes(i))) steps.push('미디어 파일 전처리 (STT/프레임 추출)');
  if (inputs.some(i => ['image','pdf'].includes(i))) steps.push('문서/이미지 파싱 및 OCR');
  if (inputs.some(i => ['url'].includes(i))) steps.push('웹 크롤링 및 데이터 수집');
  roles.forEach((role, idx) => {
    const roleActions = {
      planner: '작업 계획 및 구조 설계',
      researcher: '데이터 조사 및 분석',
      writer: '콘텐츠 작성 및 편집',
      coder: '코드 생성 및 구현',
      reviewer: '검토 및 품질 확인',
      designer: 'UI/UX 디자인 설계',
      analyst: '데이터 분석 및 인사이트',
      validator: '결과물 검증 및 확인',
      assembler: '최종 결과물 통합',
      illustrator: '시각 요소 생성',
      animator: '애니메이션 제작',
      legal_expert: '법적 검토 및 컴플라이언스',
      medical_writer: '의학적 내용 검토 및 작성',
      financial_analyst: '재무 분석 및 계산',
      translator: '다국어 번역 처리',
      data_scientist: '데이터 과학 분석 및 모델링',
      automation_engineer: '자동화 파이프라인 구축',
      copywriter: '마케팅 카피 및 광고문구 작성',
      brand_strategist: '브랜드 전략 수립',
      strategist: '비즈니스 전략 분석',
      educator: '교육 콘텐츠 설계',
      novelist: '창작 스토리 작성',
      scenario_writer: '시나리오 및 대본 작성',
      composer: '음악 및 사운드 설계',
      game_designer: '게임 디자인 및 메카닉스',
      game_coder: '게임 로직 코딩',
      ux_architect: 'UX 아키텍처 및 정보구조 설계',
      artist3d: '3D 모델링 및 렌더링',
      critic: '비판적 검토 및 개선안 제시',
      router: '작업 분류 및 라우팅',
    };
    steps.push(`[${role}] ${roleActions[role] || role + ' 처리'}`);
  });
  if (outputs.some(o => ['pdf'].includes(o))) steps.push('PDF 생성 및 포맷 변환');
  if (outputs.some(o => ['email','sms'].includes(o))) steps.push('발송 준비 및 스케줄링');
  return steps;
}

function estimateTime(complexity, roleCount) {
  const baseTime = { low: 1, medium: 3, high: 8, extreme: 20 };
  const base = baseTime[complexity] || 3;
  const total = base * Math.ceil(roleCount / 2);
  if (total < 2) return '30초~1분';
  if (total < 5) return `${total}~${total+2}분`;
  if (total < 15) return `${total}~${total+5}분`;
  return `${total}~${total+10}분`;
}

// ── 시드 케이스 60개 ─────────────────────────────────────
const SEED_CASES = [
  { id:1, domain:'ecommerce', domain_label:'이커머스 & 셀러 오토메이션', title:'타오바오 URL → 스크래핑 → OCR번역 → 누끼 → 상세페이지', description:'타오바오 상품 URL을 입력받아 크롤링, 이미지 OCR 번역, 배경 제거 후 한국어 상세페이지 HTML 생성', input_type:['url','image'], output_type:['html'], feasibility:'api_needed', complexity:'high', business_value:'high', roles:['researcher','translator','designer','coder'], required_apis:['Puppeteer','OCR_API','Remove_BG'], missing_tech:['상품페이지_스크래퍼'], pipeline_steps:['URL 크롤링','이미지 수집 및 OCR','번역','배경 제거','HTML 조립'], estimated_time:'10~15분', tags:['이커머스','번역','OCR'], system_coverage:false, implementation_priority:'P1', test_status:'pending', created_at:new Date().toISOString() },
  { id:2, domain:'ecommerce', domain_label:'이커머스 & 셀러 오토메이션', title:'제품 사진 → 3D GLB 변환 → 360도 MP4', description:'제품 2D 사진으로 3D 모델 생성 후 360도 회전 영상 렌더링', input_type:['image'], output_type:['video'], feasibility:'external_only', complexity:'extreme', business_value:'high', roles:[], required_apis:['Tripo3D','Blender'], missing_tech:['3D모델생성_AI','렌더링엔진'], pipeline_steps:['이미지 전처리','3D 재구성','텍스처 매핑','360도 렌더링','MP4 인코딩'], estimated_time:'20~30분', tags:['3D','이커머스'], system_coverage:false, implementation_priority:'P1', test_status:'pending', created_at:new Date().toISOString() },
  { id:3, domain:'ecommerce', domain_label:'이커머스 & 셀러 오토메이션', title:'경쟁사 URL → 자정 크롤링 → 최저가 자동수정 → 슬랙 알림', description:'경쟁사 가격 모니터링 후 자동 가격 조정 및 Slack 통보', input_type:['url'], output_type:['json','sms'], feasibility:'api_needed', complexity:'medium', business_value:'high', roles:['automation_engineer','coder','analyst'], required_apis:['Puppeteer','Slack_API','cron'], missing_tech:['가격비교_크롤러'], pipeline_steps:['스케줄 트리거','경쟁사 가격 크롤링','최저가 비교','가격 자동수정','Slack 알림'], estimated_time:'자동(매일 자정)', tags:['가격모니터링','자동화'], system_coverage:false, implementation_priority:'P1', test_status:'pending', created_at:new Date().toISOString() },
  { id:4, domain:'ecommerce', domain_label:'이커머스 & 셀러 오토메이션', title:'리뷰 1만건 → 감성분석 → 불만 TOP3 → 기획전 카피', description:'대량 리뷰 데이터의 감성 분류 후 주요 불만 파악, 개선 강조 기획전 카피 작성', input_type:['text','excel'], output_type:['text'], feasibility:'ready', complexity:'medium', business_value:'high', roles:['data_scientist','analyst','copywriter'], required_apis:[], missing_tech:[], pipeline_steps:['리뷰 데이터 수집','감성분석','불만 키워드 추출','TOP3 도출','카피 작성'], estimated_time:'5~8분', tags:['리뷰분석','카피라이팅'], system_coverage:true, implementation_priority:'P1', test_status:'pending', created_at:new Date().toISOString() },
  { id:5, domain:'ecommerce', domain_label:'이커머스 & 셀러 오토메이션', title:'이탈고객 DB → 취향추론 → 초개인화 쿠폰 → SMS 발송', description:'구매 이탈 고객 데이터 분석 후 개인화 할인 쿠폰 설계 및 SMS 발송', input_type:['database'], output_type:['sms'], feasibility:'api_needed', complexity:'medium', business_value:'high', roles:['analyst','copywriter','automation_engineer'], required_apis:['SMS_API'], missing_tech:[], pipeline_steps:['이탈고객 세그먼트','취향 프로파일링','쿠폰 조건 설계','SMS 메시지 작성','일괄 발송'], estimated_time:'3~5분', tags:['CRM','개인화'], system_coverage:false, implementation_priority:'P1', test_status:'pending', created_at:new Date().toISOString() },
];

// ── 메인 생성 로직 ────────────────────────────────────────
function main() {
  console.log('🚀 1000개 테스트케이스 로컬 생성 시작...\n');

  const targetCounts = {
    ecommerce:      120,
    marketing:      120,
    b2b:            100,
    it:             120,
    legal_hr:       100,
    edu_med:         80,
    creative:        80,
    data_ai:         80,
    real_estate:     50,
    finance_invest:  50,
    healthcare:      50,
    government:      50,
  };

  const allCases = [...SEED_CASES];
  let currentId = SEED_CASES.length + 1;

  for (const [domain, config] of Object.entries(DOMAIN_TEMPLATES)) {
    const target = targetCounts[domain] || 50;
    console.log(`📂 [${config.label}] ${target}개 생성 중...`);
    const cases = generateCasesForDomain(domain, config, target, currentId);
    allCases.push(...cases);
    currentId += cases.length;
    console.log(`  ✅ ${cases.length}개 완료 (누적: ${allCases.length}개)`);
  }

  // 1000개 보장
  console.log(`\n📊 총 생성 케이스: ${allCases.length}개`);

  // ── 통계 계산 ──────────────────────────────────────────
  const stats = computeStats(allCases);

  // ── 부족 기술 분석 ─────────────────────────────────────
  const techAnalysis = analyzeMissingTech(allCases);

  // ── 최종 출력 ──────────────────────────────────────────
  const output = {
    meta: {
      generated_at: new Date().toISOString(),
      total_cases: allCases.length,
      version: '2.0.0',
      description: 'AI 오케스트레이터 1000개 테스트케이스 DB (v2 로컬생성)',
      generator: 'generateTestCasesLocal.js',
    },
    stats,
    tech_analysis: techAnalysis,
    cases: allCases,
  };

  const outDir = __dirname;
  const outputPath = path.join(outDir, 'testcases_db.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // 요약 리포트
  const summaryPath = path.join(outDir, 'coverage_report.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    meta: output.meta,
    stats,
    tech_analysis: { summary: techAnalysis.summary, top_missing_tech: techAnalysis.top_missing_tech.slice(0,20) }
  }, null, 2));

  console.log(`\n✅ 저장 완료: ${outputPath}`);
  console.log(`📈 커버리지 통계:`);
  console.log(`  ✅ 즉시 구현 가능 (ready):       ${stats.by_feasibility.ready}개 (${Math.round(stats.by_feasibility.ready/allCases.length*100)}%)`);
  console.log(`  ⚡ API 연동 필요 (api_needed):   ${stats.by_feasibility.api_needed}개 (${Math.round(stats.by_feasibility.api_needed/allCases.length*100)}%)`);
  console.log(`  🔧 커스텀 파이프라인:             ${stats.by_feasibility.custom_pipeline || 0}개`);
  console.log(`  ❌ 외부 전용 (external_only):     ${stats.by_feasibility.external_only}개`);
  console.log(`\n  📊 복잡도 분포:`);
  console.log(`  - low: ${stats.by_complexity.low}  medium: ${stats.by_complexity.medium}  high: ${stats.by_complexity.high}  extreme: ${stats.by_complexity.extreme}`);
  console.log(`\n  🔧 부족 기술 TOP 10:`);
  techAnalysis.top_missing_tech.slice(0,10).forEach((t,i) => console.log(`  ${i+1}. ${t[0]} (${t[1]}건)`));
  console.log(`\n  🏆 최다 사용 역할 TOP 10:`);
  stats.top_roles.slice(0,10).forEach((r,i) => console.log(`  ${i+1}. ${r[0]} (${r[1]}회)`));

  return output;
}

function computeStats(cases) {
  const stats = {
    total: cases.length,
    by_domain: {},
    by_feasibility: { ready:0, api_needed:0, custom_pipeline:0, external_only:0 },
    by_complexity: { low:0, medium:0, high:0, extreme:0 },
    by_business_value: { high:0, medium:0, low:0 },
    top_roles: {},
    top_apis: {},
    top_missing_tech: {},
    input_types: {},
    output_types: {},
  };

  cases.forEach(c => {
    stats.by_domain[c.domain] = (stats.by_domain[c.domain] || 0) + 1;
    if (c.feasibility) stats.by_feasibility[c.feasibility] = (stats.by_feasibility[c.feasibility] || 0) + 1;
    if (c.complexity) stats.by_complexity[c.complexity] = (stats.by_complexity[c.complexity] || 0) + 1;
    if (c.business_value) stats.by_business_value[c.business_value] = (stats.by_business_value[c.business_value] || 0) + 1;
    (c.roles || []).forEach(r => stats.top_roles[r] = (stats.top_roles[r] || 0) + 1);
    (c.required_apis || []).forEach(a => stats.top_apis[a] = (stats.top_apis[a] || 0) + 1);
    (c.missing_tech || []).forEach(t => stats.top_missing_tech[t] = (stats.top_missing_tech[t] || 0) + 1);
    (c.input_type || []).forEach(t => stats.input_types[t] = (stats.input_types[t] || 0) + 1);
    (c.output_type || []).forEach(t => stats.output_types[t] = (stats.output_types[t] || 0) + 1);
  });

  stats.top_roles = Object.entries(stats.top_roles).sort((a,b) => b[1]-a[1]);
  stats.top_apis = Object.entries(stats.top_apis).sort((a,b) => b[1]-a[1]);
  stats.top_missing_tech = Object.entries(stats.top_missing_tech).sort((a,b) => b[1]-a[1]);
  return stats;
}

function analyzeMissingTech(cases) {
  const missingSet = {};
  const apisNeeded = {};

  cases.forEach(c => {
    (c.missing_tech || []).forEach(t => missingSet[t] = (missingSet[t] || 0) + 1);
    (c.required_apis || []).forEach(a => apisNeeded[a] = (apisNeeded[a] || 0) + 1);
  });

  const top_missing_tech = Object.entries(missingSet).sort((a,b) => b[1]-a[1]);
  const top_apis = Object.entries(apisNeeded).sort((a,b) => b[1]-a[1]);

  const priorityIntegrations = [
    { name: 'Whisper STT', cases_affected: apisNeeded['Whisper_STT'] || 0, difficulty: 'easy', category: 'audio', description: '음성→텍스트 변환 (의료/B2B/교육 필수)' },
    { name: 'GPT-4V Vision', cases_affected: apisNeeded['GPT4V_API'] || 0, difficulty: 'easy', category: 'vision', description: '이미지 이해 (OCR/명함/화면분석)' },
    { name: 'Image Generation (Nano Banana)', cases_affected: apisNeeded['ImageGen_API'] || 0, difficulty: 'medium', category: 'image', description: 'AI 이미지 생성 (마케팅/크리에이티브)' },
    { name: 'Puppeteer Web Crawler', cases_affected: apisNeeded['Puppeteer'] || 0, difficulty: 'easy', category: 'web', description: '웹 스크래핑 (이커머스/마케팅)' },
    { name: 'PDF Parser + RAG', cases_affected: 0, difficulty: 'medium', category: 'document', description: 'PDF 파싱 및 벡터 검색 (법률/B2B)' },
    { name: 'SMS API', cases_affected: apisNeeded['SMS_API'] || 0, difficulty: 'easy', category: 'communication', description: 'SMS 발송 자동화' },
    { name: 'Email API (SendGrid/AWS SES)', cases_affected: apisNeeded['Email_API'] || 0, difficulty: 'easy', category: 'communication', description: '이메일 자동 발송' },
    { name: 'GitHub API', cases_affected: apisNeeded['GitHub_API'] || 0, difficulty: 'medium', category: 'development', description: 'PR/코드 자동화' },
    { name: 'ElevenLabs TTS', cases_affected: apisNeeded['ElevenLabs_API'] || 0, difficulty: 'easy', category: 'audio', description: 'AI 성우/TTS 생성' },
    { name: 'CRM API (Salesforce/HubSpot)', cases_affected: apisNeeded['CRM_API'] || 0, difficulty: 'hard', category: 'crm', description: 'CRM 자동 연동' },
  ];

  const new_roles_needed = [
    { role_key: 'ocr_specialist', role_name: 'OCR 전문가', icon: '📄', description: '이미지/PDF 텍스트 추출 및 구조화', preferred_model: 'GPT5_2', category: 'vision' },
    { role_key: 'stt_engineer', role_name: '음성처리 전문가', icon: '🎤', description: '음성 인식 및 화자 분리', preferred_model: 'GPT5_2', category: 'audio' },
    { role_key: 'ml_engineer', role_name: 'ML 엔지니어', icon: '🤖', description: '머신러닝 모델 설계 및 학습', preferred_model: 'GPT5_2', category: 'ml' },
    { role_key: 'security_expert', role_name: '보안 전문가', icon: '🔒', description: '취약점 분석 및 보안 코드 검토', preferred_model: 'GPT5_CODEX', category: 'security' },
    { role_key: 'ux_researcher', role_name: 'UX 리서처', icon: '🔍', description: '사용자 조사 및 인사이트 추출', preferred_model: 'GPT5_1', category: 'design' },
    { role_key: 'video_editor', role_name: '영상 편집가', icon: '🎬', description: 'AI 영상 편집 및 클립 합성', preferred_model: 'GPT5_2', category: 'video' },
    { role_key: 'db_architect', role_name: 'DB 아키텍트', icon: '🗄️', description: '데이터베이스 설계 및 최적화', preferred_model: 'GPT5_CODEX', category: 'database' },
    { role_key: 'compliance_officer', role_name: '컴플라이언스 담당', icon: '⚖️', description: '규정 준수 및 법적 리스크 관리', preferred_model: 'GPT5_2', category: 'legal' },
  ];

  return {
    summary: {
      total_missing_tech: top_missing_tech.length,
      total_apis_needed: top_apis.length,
      cases_ready: cases.filter(c => c.feasibility === 'ready').length,
      cases_api_needed: cases.filter(c => c.feasibility === 'api_needed').length,
      coverage_rate: Math.round(cases.filter(c => c.feasibility === 'ready').length / cases.length * 100) + '%',
    },
    top_missing_tech,
    top_apis_needed: top_apis,
    priority_integrations: priorityIntegrations,
    new_roles_needed,
  };
}

main();
