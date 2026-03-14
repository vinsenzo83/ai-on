// ============================================================
// functionTools.js — OpenAI Function Calling 툴 정의
// ============================================================
//
// STEP 5: LLM이 자율적으로 도구를 선택하여 호출
//
// 툴 목록:
//   - web_search       : 최신 정보·뉴스·가격·검색
//   - get_weather      : 도시 날씨 조회
//   - get_exchange_rate: 환율 조회
//   - get_datetime     : 현재 날짜/시간 (KST)
//
// 사용 예:
//   const { TOOL_DEFINITIONS, executeTool } = require('./functionTools');
//   // callLLM 호출 시 tools: TOOL_DEFINITIONS 추가
//   // tool_calls 응답 시 executeTool(name, args) 실행
// ============================================================

'use strict';

// Phase 5: searchEngine 직접 사용 (멀티 프로바이더 폴백)
let _searchEngine = null;
try {
  _searchEngine = require('../agent/searchEngine');
} catch (e) {
  // searchEngine 미로드 시 _webSearch helpers 폴백
}

// ── 1. OpenAI function-calling 스키마 정의 ─────────────────
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '웹을 검색하여 최신 정보, 뉴스, 가격, 이벤트 등을 조회합니다. 학습 데이터 이후의 최신 정보가 필요할 때 사용하세요.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '검색어 (한국어 또는 영어)',
          },
          max_results: {
            type: 'integer',
            description: '검색 결과 최대 개수 (기본 5, 최대 10)',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '특정 도시의 현재 날씨와 예보를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '도시 이름 (영어 또는 한국어, 예: Seoul, 서울, Tokyo)',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exchange_rate',
      description: '현재 환율 정보를 조회합니다 (USD 기준).',
      parameters: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: '기준 통화 코드 (예: USD, EUR, KRW)',
            default: 'USD',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: '현재 날짜와 시간을 한국 표준시(KST)로 반환합니다.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ── 2. 한국어 도시명 → 영어 변환 맵 ────────────────────────
const CITY_MAP = {
  '서울':'Seoul','부산':'Busan','인천':'Incheon','대구':'Daegu','대전':'Daejeon',
  '광주':'Gwangju','울산':'Ulsan','제주':'Jeju','수원':'Suwon','성남':'Seongnam',
  '춘천':'Chuncheon','청주':'Cheongju','전주':'Jeonju','포항':'Pohang','창원':'Changwon',
  '도쿄':'Tokyo','오사카':'Osaka','베이징':'Beijing','상하이':'Shanghai',
  '뉴욕':'New+York','런던':'London','파리':'Paris','LA':'Los+Angeles',
  '싱가포르':'Singapore','방콕':'Bangkok','홍콩':'Hong+Kong','타이베이':'Taipei',
};

// ── 3. 툴 실행 함수 ─────────────────────────────────────────
/**
 * executeTool — LLM이 요청한 툴을 실행하고 결과 문자열 반환
 * @param {string}  name  — 툴 이름
 * @param {object}  args  — 툴 인수
 * @param {object}  helpers — { _webSearch } server.js에서 주입
 * @returns {Promise<string>}
 */
async function executeTool(name, args, helpers = {}) {
  try {
    switch (name) {

      // ── web_search ───────────────────────────────────────
      // Phase 5: searchEngine 직접 사용 (Brave → SerpAPI → Serper → Tavily → DDG)
      case 'web_search': {
        const query = args.query || '';
        const maxResults = Math.min(args.max_results || 5, 10);
        if (!query) return '검색어가 비어있습니다.';

        // 1. searchEngine 직접 호출 (멀티 프로바이더)
        if (_searchEngine) {
          const result = await _searchEngine.search(query, { maxResults });
          if (result) return result;
        }

        // 2. helpers._webSearch 폴백 (server.js 주입)
        if (typeof helpers._webSearch === 'function') {
          const result = await helpers._webSearch(query, maxResults);
          if (result) return result;
        }

        // STEP 9: 검색 결과 없을 때 불확실성 명시
        return `[웹 검색 결과 없음] "${query}"에 대한 검색 결과를 가져올 수 없습니다.\n⚠️ 이 정보는 실시간 데이터가 아니며, 내부 학습 데이터 기반으로 불확실할 수 있습니다.`;
      }

      // ── get_weather ──────────────────────────────────────
      case 'get_weather': {
        const cityInput = args.city || 'Seoul';
        // 한국어 → 영어 변환
        const cityEn = CITY_MAP[cityInput] || cityInput;

        try {
          const res = await fetch(`https://wttr.in/${encodeURIComponent(cityEn)}?format=j1`, {
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = await res.json();
            const cur  = data.current_condition?.[0];
            const area = data.nearest_area?.[0];
            const detectedCity = area?.areaName?.[0]?.value || cityInput;
            const country      = area?.country?.[0]?.value || '';
            const tempC   = cur?.temp_C;
            const feelsC  = cur?.FeelsLikeC;
            const desc    = cur?.weatherDesc?.[0]?.value || '';
            const humidity = cur?.humidity;
            const windKmph = cur?.windspeedKmph;

            const forecasts = (data.weather || []).slice(0, 3).map(day => {
              const avgTmp = day.hourly
                ? Math.round(day.hourly.reduce((s, h) => s + Number(h.tempC), 0) / day.hourly.length)
                : '?';
              const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value || '';
              return `${day.date}: 평균 ${avgTmp}°C, ${dayDesc}`;
            }).join(' | ');

            return `[날씨: ${detectedCity}, ${country}]\n현재 ${tempC}°C (체감 ${feelsC}°C), ${desc}\n습도 ${humidity}%, 풍속 ${windKmph}km/h\n예보: ${forecasts}`;
          }
        } catch (e) {
          console.warn('[functionTool:get_weather] 실패:', e.message);
        }

        // wttr.in 실패 시 웹 검색 폴백
        if (typeof helpers._webSearch === 'function') {
          const result = await helpers._webSearch(`${cityInput} 날씨 오늘`);
          if (result) return `[날씨 (웹 검색): ${cityInput}]\n${result}`;
        }
        return `[날씨 조회 실패] "${cityInput}" 날씨를 가져올 수 없습니다.`;
      }

      // ── get_exchange_rate ────────────────────────────────
      case 'get_exchange_rate': {
        const base = (args.base || 'USD').toUpperCase();
        try {
          const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = await res.json();
            const now  = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            const rates = data.rates || {};
            const krw = rates.KRW?.toFixed(0) || '?';
            const jpy = rates.JPY?.toFixed(2) || '?';
            const eur = rates.EUR?.toFixed(4) || '?';
            const cny = rates.CNY?.toFixed(4) || '?';
            const usd = rates.USD?.toFixed(4) || '?';
            return `[환율 (${now})]\n1 ${base} = ${base === 'USD' ? '' : `${usd} USD | `}${krw} KRW | ${jpy} JPY | ${eur} EUR | ${cny} CNY\n출처: exchangerate-api.com`;
          }
        } catch (e) {
          console.warn('[functionTool:get_exchange_rate] 실패:', e.message);
        }
        return '[환율 조회 실패] 환율 API를 사용할 수 없습니다.';
      }

      // ── get_datetime ─────────────────────────────────────
      case 'get_datetime': {
        const now  = new Date();
        const kst  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const days = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
        const y    = kst.getFullYear();
        const mo   = kst.getMonth() + 1;
        const d    = kst.getDate();
        const day  = days[kst.getDay()];
        const h    = kst.getHours();
        const mi   = String(kst.getMinutes()).padStart(2, '0');
        const ampm = h < 12 ? '오전' : '오후';
        const h12  = h % 12 || 12;
        return `[현재 날짜/시간 (KST)]\n날짜: ${y}년 ${mo}월 ${d}일 (${day})\n시각: ${ampm} ${h12}시 ${mi}분`;
      }

      default:
        return `[알 수 없는 툴] "${name}"`;
    }
  } catch (err) {
    console.error(`[functionTool:${name}] 예외:`, err.message);
    return `[툴 실행 오류: ${name}] ${err.message}`;
  }
}

// ── 4. 툴-사용 전략 결정 ────────────────────────────────────
// [FIX] fast 전략도 tool 허용 — chat 모드(=fast) 에서도 날씨/환율/검색 툴 동작해야 함
// 이전: deep/balanced 만 허용 → 대부분의 대화(chat 모드) 에서 toolCallRate = 0% 유발
const TOOL_ENABLED_STRATEGIES  = new Set(['deep', 'balanced', 'fast']); // fast 추가
const TOOL_DISABLED_TASK_TYPES = new Set([
  'ppt', 'ppt_file', 'pdf', 'excel', 'website', 'blog',
  'email', 'resume', 'image', 'vision', 'stt', 'crawl',
  'tts', 'qrcode', 'palette', 'regex', 'summarycard', 'chat2pdf', 'removebg',
]);

// [FIX] tool 호출이 특히 유용한 taskType: 이 목록에 포함되면 fast 전략이어도 tool 우선 활성화
const TOOL_PRIORITY_TASK_TYPES = new Set([
  'chat', 'text', 'unknown', 'analysis', 'search', 'research',
  'summarize', 'translate', 'classify',
]);

/**
 * shouldUseTools — 이 요청에 function-calling을 사용할지 판단
 * [FIX] fast 전략에서도 TOOL_PRIORITY_TASK_TYPES는 tool 허용
 * @param {string} strategy — fast | balanced | deep
 * @param {string} taskType — intentAnalyzer 반환값
 * @returns {boolean}
 */
function shouldUseTools(strategy, taskType) {
  // 명시적 비활성화 타입은 항상 false
  if (TOOL_DISABLED_TASK_TYPES.has(taskType)) return false;
  // deep/balanced 는 모든 타입 허용
  if (TOOL_ENABLED_STRATEGIES.has(strategy)) return true;
  // fast 전략: 툴 우선 타입(chat, text, analysis 등)은 예외 허용
  if (strategy === 'fast' && TOOL_PRIORITY_TASK_TYPES.has(taskType)) return true;
  return false;
}

// ── 5. STEP 9: Tool Priority Rules ───────────────────────────
// 질문 유형에 따라 어떤 툴을 우선 사용해야 하는지 힌트 제공
// LLM 시스템 프롬프트에 주입되어 툴 선택 정확도 향상

/**
 * TOOL_PRIORITY_RULES — 질문 키워드 → 툴 우선순위 매핑
 * 우선순위: 구체적 패턴이 일반 패턴보다 먼저 매칭됨
 * [FIX] chat/text/unknown taskType 에서도 툴이 활성화되도록 패턴 보강
 */
const TOOL_PRIORITY_RULES = [
  // 1. 날씨 (최우선 — "날씨" 단어 포함)
  {
    pattern:  /날씨|기온|온도|비\s*오|눈\s*오|맑음|흐림|습도|풍속|바람|우산/,
    tool:     'get_weather',
    hint:     '날씨 관련 질문에는 반드시 get_weather 툴을 먼저 호출하세요.',
    priority: 1,
  },
  // 2. 환율 (구체적 통화 코드 또는 환율 단어) — [FIX] 패턴 대폭 확장
  {
    pattern:  /환율|달러|엔화|유로|위안|환전|USD|KRW|EUR|JPY|CNY|\$|원화|원짜리|단위환산|구매력|업비트|빗썸/,
    tool:     'get_exchange_rate',
    hint:     '환율·통화 질문에는 반드시 get_exchange_rate 툴을 먼저 호출하세요.',
    priority: 2,
  },
  // 3. 현재 날짜/시간 (명시적 시간 질문)
  {
    pattern:  /지금\s*몇\s*시|현재\s*시간|지금\s*시각|날짜가\s*뭐|오늘\s*날짜|요일이\s*뭐|몇\s*월\s*며칠/,
    tool:     'get_datetime',
    hint:     '현재 시간·날짜·요일 질문에는 반드시 get_datetime 툴을 먼저 호출하세요.',
    priority: 3,
  },
  // 4. 최신 정보 검색 (웹 검색) — [FIX] 패턴 대폭 확장
  {
    pattern:  /최신|뉴스|트렌드|검색해|찾아줘|알려줘|소식|업데이트|출시|발표|현재.*상황|지금.*어떻|최근|요즘|어떻게\s*됐|얼마야|가격|주가|시세|현황|GPT|ChatGPT|AI.*모델|클로드|제미나이|라마|코파일럿|스타트업|기업|서비스|제품|사건|사고|정책|법안|선거|스포츠|경기|결과|순위|날씨.*내일|내일.*날씨|이번주|다음주/,
    tool:     'web_search',
    hint:     '최신 정보·뉴스·트렌드가 필요할 때는 web_search 툴을 먼저 호출하세요. 검색 결과를 내부 지식보다 우선하세요.',
    priority: 4,
  },
  // 5. 코드 실행 요청 — 직접 실행 불가 안내
  {
    pattern:  /코드\s*실행|\실행\s*결과를\s*보여|실제\s*실행해줘/,
    tool:     null,
    hint:     'AI는 코드를 직접 실행하지 않습니다. 코드를 작성하고 "로컬 환경에서 실행하세요" 라고 안내하세요.',
    priority: 5,
  },
];

/**
 * getToolPriorityHint — 사용자 질문을 분석하여 툴 우선 사용 힌트 반환
 * STEP 9: 툴 우선순위 규칙 + 불확실성 명시 지침
 * @param {string} userMessage
 * @returns {string} 시스템 프롬프트에 추가할 힌트 문자열 (없으면 '')
 */
function getToolPriorityHint(userMessage) {
  if (!userMessage) return '';
  const hints = [];
  // 우선순위 순으로 정렬하여 매칭
  const sorted = [...TOOL_PRIORITY_RULES].sort((a, b) => (a.priority || 9) - (b.priority || 9));
  for (const rule of sorted) {
    if (rule.pattern.test(userMessage)) {
      hints.push(rule.hint);
    }
  }
  if (hints.length === 0) return '';
  return (
    '\n\n[Tool Priority Rules — 반드시 준수]\n' +
    hints.map(h => `• ${h}`).join('\n') +
    '\n• 툴 검색 결과가 있으면 내부 학습 데이터보다 검색 결과를 우선하세요.' +
    '\n• 툴 실행 실패 또는 결과 없음 시: "[실시간 데이터 조회 실패] 확실한 정보를 가져올 수 없어 불확실할 수 있습니다" 라고 명시하세요.' +
    '\n• 내부 지식만으로 답할 때 정보가 불확실하면 "(2026년 3월 기준으로, 더 정확한 정보는 직접 확인해 주세요)" 를 부기하세요.' +
    '\n• 추측이나 가정으로 답하지 말고, 모르는 정보는 \"확인이 필요합니다\" 고 명시하세요.'
  );
}

/**
 * selectPriorityTool — 질문에서 가장 적합한 툴 1개 반환 (없으면 null)
 */
function selectPriorityTool(userMessage) {
  if (!userMessage) return null;
  for (const rule of TOOL_PRIORITY_RULES) {
    if (rule.pattern.test(userMessage)) return rule.tool;
  }
  return null;
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  shouldUseTools,
  getToolPriorityHint,
  selectPriorityTool,
  TOOL_PRIORITY_RULES,
  TOOL_PRIORITY_TASK_TYPES,  // 외부 참조용 (테스트/관찰)
};
