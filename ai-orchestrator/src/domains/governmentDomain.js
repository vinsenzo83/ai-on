'use strict';
/**
 * governmentDomain.js — Phase 3-4
 * 정부/공공 도메인 심화 엔진 (18건 미커버 → 커버)
 *
 * 핵심 기능:
 *  - 긴급알림_시스템: CBS/WEA 재난문자 + 다채널 발송
 *  - 공공데이터_API_연동: data.go.kr 오픈 API 파싱
 *  - 다국어_번역_엔진: 공공문서 다국어 자동 번역
 *  - 정책 문서 파싱 + 요약 자동화
 *  - 시민 서비스 포털 자동화
 */

// ── 재난 유형 코드 ────────────────────────────────────────
const DISASTER_TYPES = {
  earthquake: { code: 'EQ', name: '지진',     cbs: true,  wea: true,  icon: '🌍', severity: ['경계', '주의', '심각'] },
  typhoon:    { code: 'TY', name: '태풍',     cbs: true,  wea: true,  icon: '🌀', severity: ['예비', '주의보', '경보'] },
  flood:      { code: 'FL', name: '홍수',     cbs: true,  wea: false, icon: '🌊', severity: ['주의보', '경보', '특보'] },
  fire:       { code: 'FI', name: '산불',     cbs: true,  wea: false, icon: '🔥', severity: ['초기', '확산', '대형'] },
  nuclear:    { code: 'NU', name: '방사능',   cbs: true,  wea: true,  icon: '☢️', severity: ['경계', '비상', '긴급'] },
  covid:      { code: 'PH', name: '감염병',   cbs: true,  wea: false, icon: '🦠', severity: ['관심', '주의', '경계', '심각'] },
  heatwave:   { code: 'HW', name: '폭염',     cbs: false, wea: false, icon: '🌡️', severity: ['주의보', '경보'] },
  cold:       { code: 'CW', name: '한파',     cbs: false, wea: false, icon: '🥶', severity: ['주의보', '경보'] },
  air:        { code: 'AQ', name: '미세먼지', cbs: false, wea: false, icon: '😷', severity: ['나쁨', '매우나쁨'] },
};

// ── CBS 재난문자 템플릿 ────────────────────────────────────
const CBS_TEMPLATES = {
  earthquake: (severity, location, magnitude) =>
    `[긴급재난문자] ${location} 규모 ${magnitude} 지진 발생. 야외 대피, 튼튼한 탁자 아래 대기. 여진 주의. 행안부`,
  typhoon: (severity, location, eta) =>
    `[긴급재난문자] 태풍 ${location} 접근 중. ${eta} 예상. 실내 대피, 창문 강화, 불필요한 외출 자제. 기상청`,
  flood: (severity, location) =>
    `[긴급재난문자] ${location} ${severity} 발효. 저지대·하천변 즉시 대피. 119 신고. 행안부`,
  fire: (severity, location) =>
    `[긴급재난문자] ${location} 산불 ${severity}. 인근 주민 즉시 대피. 119 신고. 산림청`,
  air: (level, location) =>
    `[대기오염 알림] ${location} 미세먼지 ${level}. 야외활동 자제, 마스크 착용 권고. 환경부`,
  heatwave: (location) =>
    `[폭염 경보] ${location} 폭염경보 발령. 야외활동 자제. 수분 충분히 섭취. 행안부`,
};

// ── 공공 API 카탈로그 (data.go.kr) ───────────────────────
const PUBLIC_API_CATALOG = {
  real_transaction:  { name: '아파트 실거래가',     provider: '국토교통부', endpoint: '/RTMSDataSvcAptTradeDev', rateLimit: '1000/day' },
  bus_arrival:       { name: '버스 도착 정보',      provider: '교통안전공단', endpoint: '/BusArrivalService', rateLimit: '1000/day' },
  weather_forecast:  { name: '기상예보',            provider: '기상청',    endpoint: '/VilageFcstInfoService', rateLimit: '10000/day' },
  food_safety:       { name: '식품 안전 정보',      provider: '식약처',    endpoint: '/FoodSftyInfo', rateLimit: '500/day' },
  public_holiday:    { name: '공휴일 정보',         provider: '한국천문연구원', endpoint: '/SpcdeInfoService', rateLimit: 'unlimited' },
  birth_death:       { name: '출생/사망 통계',      provider: '통계청',    endpoint: '/VitalStatisticsService', rateLimit: '1000/day' },
  job_posting:       { name: '고용 공고 (워크넷)',   provider: '한국고용정보원', endpoint: '/JobOpenInfo', rateLimit: '2000/day' },
  patent:            { name: '특허 검색',           provider: '특허청',    endpoint: '/PatentSearch', rateLimit: '1000/day' },
  company_info:      { name: '기업 정보',           provider: '금융감독원', endpoint: '/OpenDartService', rateLimit: '10000/day' },
  population_stat:   { name: '인구 통계',           provider: '통계청',    endpoint: '/PopulationStatService', rateLimit: '1000/day' },
};

// ── 다국어 번역 언어 지원 ─────────────────────────────────
const SUPPORTED_LANGUAGES = {
  ko: { name: '한국어', nativeName: '한국어', flag: '🇰🇷', cbs: true },
  en: { name: '영어',   nativeName: 'English', flag: '🇺🇸', cbs: true },
  zh: { name: '중국어', nativeName: '中文',   flag: '🇨🇳', cbs: true },
  ja: { name: '일본어', nativeName: '日本語', flag: '🇯🇵', cbs: true },
  vi: { name: '베트남어', nativeName: 'Tiếng Việt', flag: '🇻🇳', cbs: false },
  th: { name: '태국어', nativeName: 'ภาษาไทย', flag: '🇹🇭', cbs: false },
  ru: { name: '러시아어', nativeName: 'Русский', flag: '🇷🇺', cbs: false },
  ar: { name: '아랍어', nativeName: 'العربية', flag: '🇸🇦', cbs: false },
};

// ── CBS/긴급 알림 발송 ────────────────────────────────────
async function sendEmergencyAlert(opts = {}) {
  const {
    disasterType = 'earthquake',
    severity     = '경계',
    location     = '서울',
    details      = {},
    channels     = ['cbs', 'sms', 'app', 'web'],
    languages    = ['ko', 'en', 'zh'],
    targetArea   = { code: '11', name: '서울' },
    _apiKey,
  } = opts;

  // ※ 실제 연동:
  // CBS (안전디딤돌 API):
  //   POST https://m.safekorea.go.kr/idsiSFK/neo/main/main.html
  //   body: { disasterType, severity, message, targetArea }
  // 공공 알림 API (행안부):
  //   POST https://www.nts.go.kr/notify/v1/...

  const disaster     = DISASTER_TYPES[disasterType];
  const msgTemplate  = CBS_TEMPLATES[disasterType];
  const korMessage   = msgTemplate
    ? msgTemplate(severity, location, details.magnitude || details.eta || '')
    : `[긴급재난문자] ${location} ${disaster?.name || disasterType} ${severity}. 안전에 주의하세요. 행안부`;

  // 다국어 번역 stub
  const SAMPLE_TRANSLATIONS = {
    en: `[Emergency Alert] ${disasterType} ${severity} in ${location}. Please take safety measures immediately.`,
    zh: `[紧急灾难短信] ${location}发生${disaster?.name || disasterType}。请立即采取安全措施。`,
    ja: `[緊急災害SMS] ${location}で${disaster?.name || disasterType}が発生しました。安全に注意してください。`,
    vi: `[Cảnh báo khẩn cấp] Xảy ra ${disasterType} tại ${location}. Hãy cẩn thận an toàn ngay lập tức.`,
  };

  const translations = {};
  for (const lang of languages) {
    if (lang === 'ko') translations[lang] = korMessage;
    else translations[lang] = SAMPLE_TRANSLATIONS[lang] || `[ALERT] ${disasterType} at ${location}`;
  }

  // 채널별 발송 결과 stub
  const channelResults = {};
  for (const ch of channels) {
    channelResults[ch] = {
      sent:      true,
      stub:      true,
      recipients: ch === 'cbs' ? `${targetArea.name} 전체 (약 ${Math.floor(Math.random() * 500) + 100}만명)`
                : ch === 'app' ? `앱 알림 발송`
                : `${ch} 발송`,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    stub:         true,
    alertId:      `ALERT-${Date.now()}`,
    disasterType: disaster?.name || disasterType,
    severity,
    location,
    targetArea,
    messages:     translations,
    channels:     channelResults,
    totalChannels: channels.length,
    languages:    languages.length,
    issuedAt:     new Date().toISOString(),
    message:      '긴급 알림 stub — 행안부 CBS API 연동 후 실제 발송 활성화',
  };
}

// ── 공공 데이터 조회 ──────────────────────────────────────
async function fetchPublicData(opts = {}) {
  const {
    apiKey     = 'weather_forecast',
    params     = {},
    format     = 'json',
    _serviceKey,
  } = opts;

  const apiInfo = PUBLIC_API_CATALOG[apiKey];
  if (!apiInfo) {
    return {
      success: false,
      error:   `지원하지 않는 API: ${apiKey}`,
      available: Object.keys(PUBLIC_API_CATALOG),
    };
  }

  // ※ 실제 연동:
  // 공공 데이터 포털 (data.go.kr):
  //   GET https://apis.data.go.kr/1360000/VilageFcstInfoService02/getVilageFcst
  //   params: serviceKey (URL인코딩), base_date, base_time, nx, ny

  // stub: API별 샘플 응답
  const STUB_RESPONSES = {
    weather_forecast: {
      items: [
        { category: 'TMP', value: '18', unit: '℃', fcstTime: '1200', fcstDate: '20260310' },
        { category: 'SKY', value: '1', unit: '', fcstTime: '1200', fcstDate: '20260310' },
        { category: 'PTY', value: '0', unit: '', fcstTime: '1200', fcstDate: '20260310' },
        { category: 'REH', value: '65', unit: '%', fcstTime: '1200', fcstDate: '20260310' },
        { category: 'WSD', value: '3.5', unit: 'm/s', fcstTime: '1200', fcstDate: '20260310' },
      ],
      parsed: { temp: '18℃', sky: '맑음', rain: '없음', humidity: '65%', wind: '3.5m/s' },
    },
    bus_arrival: {
      items: [
        { routeNo: '370', arrTime: 2, prevCnt: 2, vehicleNo: 'bus-1234' },
        { routeNo: '370', arrTime: 15, prevCnt: 7, vehicleNo: 'bus-5678' },
      ],
    },
    public_holiday: {
      items: [
        { locdate: '20260301', dateName: '삼일절', isHoliday: 'Y' },
        { locdate: '20260505', dateName: '어린이날', isHoliday: 'Y' },
        { locdate: '20260815', dateName: '광복절', isHoliday: 'Y' },
      ],
    },
  };

  const stubData = STUB_RESPONSES[apiKey] || { items: [], message: '샘플 데이터 없음' };

  return {
    stub:        true,
    api:         apiInfo,
    params,
    totalCount:  stubData.items?.length || 0,
    data:        stubData,
    fetchedAt:   new Date().toISOString(),
    message:     `공공 데이터 stub — data.go.kr serviceKey 발급 후 실제 조회 활성화 (${apiInfo.name})`,
  };
}

// ── 정책 문서 파싱 + 요약 ─────────────────────────────────
async function parsePolicyDocument(opts = {}) {
  const {
    text         = '',
    docType      = 'law',    // law | ordinance | notice | bid | policy
    targetLangs  = ['ko', 'en'],
    extractItems = ['summary', 'keywords', 'dates', 'entities', 'requirements'],
    _apiKey,
  } = opts;

  if (!text || text.length < 10) {
    return { success: false, error: '문서 텍스트가 너무 짧습니다' };
  }

  const DOC_SCHEMAS = {
    law:      { structure: ['전문', '본문', '부칙'], idPattern: /제\d+조/ },
    bid:      { structure: ['개요', '입찰조건', '서류'], idPattern: /공고번호/ },
    policy:   { structure: ['배경', '목적', '내용', '일정'], idPattern: /정책명/ },
    notice:   { structure: ['제목', '본문', '공고일'], idPattern: /공고/ },
    ordinance:{ structure: ['의결일', '조례내용'], idPattern: /조례/ },
  };

  const schema   = DOC_SCHEMAS[docType] || DOC_SCHEMAS.policy;
  const words    = text.split(/\s+/).length;
  const sentences= text.split(/[.!?。]/).length;

  // 간단한 키워드 추출 (stub)
  const keywordsRaw = text.match(/[가-힣]{2,6}/g) || [];
  const keywordFreq = {};
  keywordsRaw.forEach(w => { keywordFreq[w] = (keywordFreq[w] || 0) + 1; });
  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);

  // 날짜 추출
  const dates = (text.match(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{4}-\d{2}-\d{2}/g) || []).slice(0, 5);

  // 금액 추출
  const amounts = (text.match(/\d+(?:,\d{3})*(?:\.\d+)?\s*(?:원|억원|만원)/g) || []).slice(0, 5);

  // 요약 생성 (stub)
  const summary = text.slice(0, 200) + (text.length > 200 ? '...' : '');

  // 다국어 번역 stub
  const translations = {};
  for (const lang of targetLangs) {
    if (lang === 'ko') translations[lang] = summary;
    else translations[lang] = `[${SUPPORTED_LANGUAGES[lang]?.name || lang} 번역 stub] ${summary.slice(0, 100)}...`;
  }

  return {
    docType,
    stats:      { chars: text.length, words, sentences },
    structure:  schema.structure,
    extracted: {
      summary,
      keywords:  topKeywords,
      dates,
      amounts,
    },
    translations,
    requirements: text.match(/(?:필수|의무|제출|기한)[^.。]{0,30}/g)?.slice(0, 5) || [],
    stub:         true,
    message:      '정책 문서 파싱 stub — GPT-4 API 연동 후 정확한 구조화 활성화',
  };
}

// ── 시민 서비스 자동화 ────────────────────────────────────
function buildCitizenServiceGuide(opts = {}) {
  const {
    serviceType = 'birth_registration',
    region      = '서울시',
    language    = 'ko',
  } = opts;

  const SERVICES = {
    birth_registration: {
      name:      '출생신고',
      agency:    '주민센터',
      deadline:  '출생 후 1개월 이내',
      documents: ['출생증명서', '신분증', '가족관계증명서'],
      fee:       '무료',
      online:    'https://www.gov.kr',
      steps: ['1. 병원 출생증명서 수령', '2. 주민센터 방문 또는 온라인 신청', '3. 가족관계증명서 업데이트 확인'],
    },
    business_registration: {
      name:      '사업자등록',
      agency:    '국세청 홈택스',
      deadline:  '사업 개시일로부터 20일 이내',
      documents: ['신분증', '임대차계약서', '사업장 도면 (해당시)'],
      fee:       '무료',
      online:    'https://www.hometax.go.kr',
      steps: ['1. 홈택스 로그인', '2. 사업자등록 신청', '3. 인허가 업종 확인', '4. 등록증 발급 (1~3일 소요)'],
    },
    driver_license: {
      name:      '운전면허 갱신',
      agency:    '도로교통공단 운전면허시험장',
      deadline:  '만료일 전 1년 이내',
      documents: ['신분증', '사진 1매', '시력검사 결과'],
      fee:       '9,000원',
      online:    'https://www.safedriving.or.kr',
      steps: ['1. 신체검사 (시력 등)', '2. 온라인/방문 신청', '3. 수수료 납부', '4. 면허증 발급'],
    },
  };

  const service = SERVICES[serviceType] || SERVICES.birth_registration;

  // 다국어 지원
  const nameTranslations = {
    en: { birth_registration: 'Birth Registration', business_registration: 'Business Registration', driver_license: "Driver's License Renewal" },
    zh: { birth_registration: '出生登记', business_registration: '营业执照注册', driver_license: '驾驶证更新' },
    ja: { birth_registration: '出生届', business_registration: '事業者登録', driver_license: '運転免許証更新' },
  };

  const localizedName = language !== 'ko' && nameTranslations[language]
    ? nameTranslations[language][serviceType] || service.name
    : service.name;

  return {
    serviceType,
    localizedName,
    region,
    language,
    service,
    guide: {
      name:      localizedName,
      agency:    `${region} ${service.agency}`,
      deadline:  service.deadline,
      documents: service.documents,
      fee:       service.fee,
      online:    service.online,
      steps:     service.steps,
    },
    tip: '온라인 신청 시 대기 없이 편리하게 처리 가능합니다.',
    availableServices: Object.keys(SERVICES),
  };
}

// ── 메인 실행 ─────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    mode = 'alert',   // alert | public_data | policy | citizen_service
    ...rest
  } = opts;

  const startMs = Date.now();
  let result    = {};

  switch (mode) {
    case 'alert':
      result = await sendEmergencyAlert(rest);
      break;
    case 'public_data':
      result = await fetchPublicData(rest);
      break;
    case 'policy':
      result = await parsePolicyDocument(rest);
      break;
    case 'citizen_service':
      result = buildCitizenServiceGuide(rest);
      break;
    default:
      return { success: false, error: `알 수 없는 모드: ${mode}` };
  }

  return {
    success:    true,
    domain:     'government',
    mode,
    ...result,
    durationMs: Date.now() - startMs,
    meta: {
      availableModes:    ['alert','public_data','policy','citizen_service'],
      disasterTypes:     Object.keys(DISASTER_TYPES),
      publicAPIs:        Object.keys(PUBLIC_API_CATALOG),
      supportedLanguages:Object.keys(SUPPORTED_LANGUAGES),
    },
  };
}

module.exports = {
  execute,
  sendEmergencyAlert,
  fetchPublicData,
  parsePolicyDocument,
  buildCitizenServiceGuide,
  DISASTER_TYPES,
  PUBLIC_API_CATALOG,
  SUPPORTED_LANGUAGES,
  CBS_TEMPLATES,
};
