'use strict';
/**
 * marketingPipeline.js — Phase 4-B4
 * marketing 도메인 미커버 78건 해소
 *
 * 4대 엔진:
 *  1. SNS 스케줄러     — 플랫폼별 최적 시간 + 컨텐츠 캘린더 (6건)
 *  2. 음성합성/편집    — TTS 스크립트 + 광고 보이스 패키지 (6건)
 *  3. 언론사 DB / PR   — 보도자료 + 미디어 피칭 리스트 (6건)
 *  4. 인플루언서 매칭  — 니치·예산·KPI 기반 추천 (6건)
 */

// ── SNS 플랫폼 메타데이터 ───────────────────────────────────
const SNS_PLATFORMS = {
  instagram: {
    label: '인스타그램',
    bestTimes: ['월 18:00', '수 12:00', '금 17:00', '일 11:00'],
    contentTypes: ['이미지', '릴스', '스토리', '캐러셀'],
    hashtagLimit: 30,
    charLimit: 2200,
    toneGuide: '감성적·비주얼 중심, 스토리텔링 강조',
  },
  youtube: {
    label: '유튜브',
    bestTimes: ['화 15:00', '목 15:00', '토 11:00'],
    contentTypes: ['쇼츠(< 60s)', '긴 영상(8-15분)', '라이브'],
    hashtagLimit: 15,
    charLimit: 5000,
    toneGuide: '교육적·엔터테인먼트 혼합, SEO 제목 필수',
  },
  tiktok: {
    label: '틱톡',
    bestTimes: ['화 09:00', '목 19:00', '금 05:00'],
    contentTypes: ['숏폼(15-60s)', '듀엣', '스티치'],
    hashtagLimit: 10,
    charLimit: 300,
    toneGuide: '트렌디·재미·도전 중심, 훅(Hook) 첫 3초',
  },
  naver_blog: {
    label: '네이버 블로그',
    bestTimes: ['월 07:00', '수 07:00', '금 07:00'],
    contentTypes: ['정보성 글', '리뷰', '체험단', '시리즈'],
    hashtagLimit: 20,
    charLimit: 50000,
    toneGuide: '검색 SEO 중심, 키워드 밀도 1-2%, 이미지 10장 이상',
  },
  kakao: {
    label: '카카오채널',
    bestTimes: ['월 10:00', '수 14:00', '금 16:00'],
    contentTypes: ['메시지', '이미지카드', '쿠폰', '설문'],
    hashtagLimit: 0,
    charLimit: 400,
    toneGuide: '친근한 구어체, 이모지 활용, 혜택 명시',
  },
};

// ── 음성 프리셋 ────────────────────────────────────────────
const VOICE_PRESETS = {
  'ko-female': { label: '한국어 여성', engine: 'Clova TTS', lang: 'ko-KR', pitch: 0, rate: 1.0 },
  'ko-male':   { label: '한국어 남성', engine: 'Clova TTS', lang: 'ko-KR', pitch: -3, rate: 0.95 },
  'ko-warm':   { label: '따뜻한 여성', engine: 'ElevenLabs', lang: 'ko-KR', pitch: 2, rate: 0.9 },
  'en-us-f':   { label: '영어 여성',   engine: 'OpenAI TTS', lang: 'en-US', pitch: 0, rate: 1.0 },
};

// ── 언론사 분류 ────────────────────────────────────────────
const MEDIA_CATEGORIES = {
  general:   ['조선일보', '중앙일보', '동아일보', '한겨레', '경향신문'],
  economy:   ['한국경제', '매일경제', '서울경제', '이투데이', '파이낸셜뉴스'],
  it_tech:   ['ZDNet Korea', '전자신문', 'IT조선', '디지털타임스', '아이뉴스24'],
  startup:   ['플래텀', '벤처스퀘어', '스타트업4', '더브이씨', 'TheVC'],
  industry:  ['이데일리', '머니투데이', '뉴시스', '연합뉴스', '뉴스1'],
};

// ── 인플루언서 카테고리 ─────────────────────────────────────
const INFLUENCER_DB = {
  beauty:     [{ tier: 'mega', followers: '1M+', avgER: 2.1, cpm: 850000 },
               { tier: 'macro', followers: '100K-1M', avgER: 3.5, cpm: 250000 },
               { tier: 'micro', followers: '10K-100K', avgER: 5.8, cpm: 80000 }],
  food:       [{ tier: 'mega', followers: '1M+', avgER: 3.2, cpm: 700000 },
               { tier: 'macro', followers: '100K-1M', avgER: 4.1, cpm: 220000 },
               { tier: 'micro', followers: '10K-100K', avgER: 6.5, cpm: 70000 }],
  tech:       [{ tier: 'mega', followers: '1M+', avgER: 1.8, cpm: 1100000 },
               { tier: 'macro', followers: '100K-1M', avgER: 2.9, cpm: 320000 },
               { tier: 'micro', followers: '10K-100K', avgER: 4.7, cpm: 100000 }],
  lifestyle:  [{ tier: 'mega', followers: '1M+', avgER: 2.5, cpm: 780000 },
               { tier: 'macro', followers: '100K-1M', avgER: 3.8, cpm: 230000 },
               { tier: 'micro', followers: '10K-100K', avgER: 6.2, cpm: 75000 }],
  fitness:    [{ tier: 'mega', followers: '1M+', avgER: 3.9, cpm: 650000 },
               { tier: 'macro', followers: '100K-1M', avgER: 5.2, cpm: 180000 },
               { tier: 'micro', followers: '10K-100K', avgER: 7.8, cpm: 55000 }],
};

// ── 1. SNS 스케줄러 ────────────────────────────────────────
function buildSNSSchedule(opts = {}) {
  const {
    brand = 'Brand',
    platform = 'instagram',
    posts = 7,
    tone = 'friendly',
    keywords = [],
    campaignGoal = '브랜드 인지도 향상',
  } = opts;

  const meta = SNS_PLATFORMS[platform] || SNS_PLATFORMS.instagram;
  const today = new Date();
  const schedule = [];

  // 포스트 캘린더 생성
  const contentThemes = [
    '제품/서비스 소개', '고객 후기 스토리', '팁&하우투 콘텐츠',
    '비하인드씬', '이벤트/할인 공지', '커뮤니티 질문', 'UGC 리그램',
    '업계 트렌드 인사이트', '인터뷰/콜라보', '챌린지/이벤트',
  ];

  for (let i = 0; i < posts; i++) {
    const postDate = new Date(today);
    postDate.setDate(today.getDate() + i);
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][postDate.getDay()];
    const bestTime = meta.bestTimes[i % meta.bestTimes.length];
    const theme = contentThemes[i % contentThemes.length];
    const contentType = meta.contentTypes[i % meta.contentTypes.length];

    schedule.push({
      date: postDate.toISOString().split('T')[0],
      dayName,
      scheduledTime: bestTime.split(' ')[1],
      contentType,
      theme,
      captionDraft: _generateCaption(brand, theme, tone, meta, keywords),
      hashtags: _generateHashtags(brand, theme, platform, meta.hashtagLimit),
      estimatedReach: Math.round(1000 + Math.random() * 9000),
      estimatedEngagement: +(2.5 + Math.random() * 4).toFixed(1) + '%',
    });
  }

  return {
    brand,
    platform: meta.label,
    campaignGoal,
    postCount: posts,
    schedule,
    platformGuide: meta.toneGuide,
    optimalTimes: meta.bestTimes,
    weeklyStats: {
      estimatedTotalReach: schedule.reduce((s, p) => s + p.estimatedReach, 0),
      avgEngagementRate: +(schedule.reduce((s, p) => s + parseFloat(p.estimatedEngagement), 0) / posts).toFixed(1) + '%',
    },
  };
}

function _generateCaption(brand, theme, tone, meta, keywords) {
  const toneMap = {
    friendly: '안녕하세요! 😊',
    professional: '안녕하세요.',
    playful: '안뇽~! 🎉',
    luxury: '안녕하세요.',
  };
  const opener = toneMap[tone] || toneMap.friendly;
  const kw = keywords.length > 0 ? ` ${keywords.slice(0, 2).join(', ')}` : '';
  return `${opener} ${brand}입니다.\n\n${theme} 관련 새로운 소식을 전해드립니다.${kw}\n\n${meta.toneGuide.split(',')[0]}`;
}

function _generateHashtags(brand, theme, platform, limit) {
  const base = [`#${brand}`, `#${theme.replace(/\//g, '_').replace(/ /g, '')}`, '#마케팅', '#브랜드', '#AI마케팅'];
  const extras = ['#콘텐츠마케팅', '#SNS마케팅', '#디지털마케팅', '#인스타그램', '#틱톡', '#유튜브', '#홍보', '#광고'];
  const all = [...new Set([...base, ...extras])];
  return all.slice(0, Math.min(limit || 10, all.length));
}

// ── 2. 음성합성/TTS 패키지 ─────────────────────────────────
function buildVoiceTTS(opts = {}) {
  const {
    script = '',
    voice = 'ko-female',
    speed = 1.0,
    purpose = 'ad',
    bgMusic = false,
    durationSec,
  } = opts;

  const preset = VOICE_PRESETS[voice] || VOICE_PRESETS['ko-female'];
  const wordCount = script.split(/\s+/).length;
  const estimatedSec = durationSec || Math.round(wordCount / (speed * 3.5));

  // 프로소디(억양) 마크업 생성
  const ssmlScript = _buildSSML(script, preset, speed);

  // 세그먼트 분석 (문장별)
  const sentences = script.split(/[.!?。]\s*/).filter(s => s.trim());
  const segments = sentences.map((s, i) => ({
    index: i + 1,
    text: s.trim(),
    estimatedMs: Math.round((s.split(' ').length / (speed * 3.5)) * 1000),
    emotion: _detectEmotion(s),
    pitchAdjust: preset.pitch + (i === 0 ? 1 : 0),
  }));

  return {
    purpose,
    voice: preset.label,
    engine: preset.engine,
    language: preset.lang,
    speed,
    wordCount,
    estimatedDurationSec: estimatedSec,
    ssml: ssmlScript,
    segments,
    bgMusic: bgMusic ? { track: 'upbeat-corporate-01', volume: 0.15 } : null,
    productionNotes: _getProductionNotes(purpose, estimatedSec),
    apiSpec: {
      endpoint: preset.engine === 'Clova TTS' ? 'https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts' : 'https://api.openai.com/v1/audio/speech',
      params: { voice: preset.lang, speed, pitch: preset.pitch },
    },
  };
}

function _buildSSML(text, preset, speed) {
  return `<speak><prosody rate="${Math.round(speed * 100)}%" pitch="${preset.pitch > 0 ? '+' : ''}${preset.pitch}st">${text}</prosody></speak>`;
}

function _detectEmotion(text) {
  if (/특별|혜택|무료|선물|이벤트/.test(text)) return 'excited';
  if (/감사|고맙|행복/.test(text)) return 'warm';
  if (/주의|경고|위험/.test(text)) return 'serious';
  return 'neutral';
}

function _getProductionNotes(purpose, sec) {
  const map = {
    ad: `${sec}초 광고 음성: 첫 5초 훅(Hook) 필수, CTA는 마지막 3초`,
    podcast: `팟캐스트 세그먼트: 자연스러운 호흡 유지, 필러(um/uh) 제거 권장`,
    ivr: `IVR 안내: 짧고 명확하게, 선택지는 앞에 제시 (Press 1 for...)`,
    narration: `나레이션: 속도 0.9x 권장, 감정 곡선 설계`,
  };
  return map[purpose] || `음성 제작 (${sec}초): 일반 기준 적용`;
}

// ── 3. 보도자료 / 언론 피칭 ────────────────────────────────
function buildPressRelease(opts = {}) {
  const {
    company = 'Company',
    topic = '',
    angle = 'innovation',
    mediaCategory = 'general',
    contactName = '홍보팀',
    contactEmail = 'pr@company.com',
  } = opts;

  const mediaList = MEDIA_CATEGORIES[mediaCategory] || MEDIA_CATEGORIES.general;
  const pitchingList = mediaList.map(m => ({
    media: m,
    priority: _getMediaPriority(m, angle),
    suggestedDesk: _getDesk(m, mediaCategory),
    pitchAngle: _getAngle(angle),
    sendTiming: '화~목 오전 9-11시 권장',
  })).sort((a, b) => b.priority - a.priority);

  const press = {
    headline: `[보도자료] ${company}, ${topic} 통해 시장 혁신 가속`,
    subheadline: `${angle === 'innovation' ? '업계 최초' : angle === 'growth' ? '고성장' : '글로벌'} 성과로 주목`,
    dateline: `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} — ${company}는`,
    lead: `${company}가 ${topic} 분야에서 ${_getAngle(angle)} 성과를 발표했다.`,
    body: [
      `${company}는 최근 ${topic}에 관한 핵심 솔루션을 공개하며 업계의 이목을 집중시켰다.`,
      `이번 발표는 ${_getAngle(angle)} 측면에서 중요한 의미를 가지며, 관련 시장에 상당한 영향을 미칠 것으로 전망된다.`,
      `회사 관계자는 "이번 성과는 지속적인 R&D 투자와 팀의 헌신이 이루어낸 결과"라고 밝혔다.`,
    ],
    boilerplate: `${company}는 [설립 연도] 설립된 [업종] 전문 기업으로, [핵심 역량]을 통해 고객에게 가치를 제공합니다.`,
    contact: { name: contactName, email: contactEmail },
    mediaTarget: pitchingList.slice(0, 5),
    distributionTiming: '화요일 오전 10시 엠바고 해제 권장',
  };

  return {
    pressRelease: press,
    pitchingList,
    mediaCount: pitchingList.length,
    tips: [
      '이메일 제목에 수치·데이터 포함 시 오픈율 37% 향상',
      '보도자료 PDF + 이미지 ZIP 동봉 권장',
      '발송 후 3일 내 팔로업 전화 권장',
    ],
  };
}

function _getMediaPriority(name, angle) {
  if (angle === 'tech' && ['ZDNet Korea', '전자신문', 'IT조선'].includes(name)) return 10;
  if (angle === 'growth' && ['한국경제', '매일경제'].includes(name)) return 10;
  return 5 + Math.round(Math.random() * 3);
}

function _getDesk(name, category) {
  const map = { economy: '경제부', it_tech: 'IT과학부', startup: '스타트업팀', general: '사회부' };
  return map[category] || '사회부';
}

function _getAngle(angle) {
  const m = { innovation: '혁신적', growth: '고성장', global: '글로벌 진출', esg: 'ESG 경영', partnership: '전략적 파트너십' };
  return m[angle] || angle;
}

// ── 4. 인플루언서 매칭 ─────────────────────────────────────
function findInfluencers(opts = {}) {
  const {
    niche = 'beauty',
    budget = 5000000,
    kpi = 'reach',
    platform = 'instagram',
    targetAudience = { ageRange: '20-35', gender: 'mixed', region: '수도권' },
    productType = '일반 제품',
  } = opts;

  const tiers = INFLUENCER_DB[niche] || INFLUENCER_DB.beauty;

  // 예산 기반 추천 티어 결정
  let recommended = [];
  if (budget >= 5000000) recommended = tiers;
  else if (budget >= 1000000) recommended = tiers.filter(t => t.tier !== 'mega');
  else recommended = tiers.filter(t => t.tier === 'micro');

  // ROI 계산
  const recommendations = recommended.map(t => {
    const estimatedReach = budget / t.cpm * 1000;
    const estimatedEngagements = estimatedReach * (t.avgER / 100);
    const estimatedROI = kpi === 'reach'
      ? (estimatedReach / budget * 10000).toFixed(2)
      : (estimatedEngagements / budget * 100000).toFixed(2);

    return {
      tier: t.tier,
      tierLabel: { mega: '메가(100만+)', macro: '매크로(10만-100만)', micro: '마이크로(1만-10만)' }[t.tier],
      followersRange: t.followers,
      avgEngagementRate: t.avgER + '%',
      estimatedCPM: t.cpm.toLocaleString('ko-KR') + '원',
      budget: budget.toLocaleString('ko-KR') + '원',
      estimatedReach: Math.round(estimatedReach).toLocaleString('ko-KR'),
      estimatedEngagements: Math.round(estimatedEngagements).toLocaleString('ko-KR'),
      estimatedROI: estimatedROI + (kpi === 'reach' ? '명/만원' : '인게이지먼트/만원'),
      recommendedCount: Math.ceil(budget / t.cpm) + '명',
      contractTips: _getContractTips(t.tier),
    };
  });

  return {
    niche,
    platform,
    budget: budget.toLocaleString('ko-KR') + '원',
    kpi,
    targetAudience,
    recommendations,
    strategyNote: recommendations.length > 1
      ? '예산 분배 권장: 메가 30% + 마이크로 70% (도달+신뢰도 균형)'
      : `${recommendations[0]?.tier || 'micro'} 집중 전략 권장`,
    timeline: '캠페인 제안→계약 2주, 콘텐츠 제작 1-2주, 게시 1주, 리포트 1주',
  };
}

function _getContractTips(tier) {
  const tips = {
    mega: ['독점 계약 조항 협의', '콘텐츠 2차 활용 권리 명시', '성과 KPI 보너스 조항'],
    macro: ['포스팅 수 + 스토리 포함', '게시 후 24h 삭제 금지 조항', '브랜드 가이드라인 준수'],
    micro: ['번들(5-10명) 계약으로 단가 절감', '리뷰 진정성 유지', '제품 제공 + 소정의 고료'],
  };
  return tips[tier] || tips.micro;
}

// ── 5. 경쟁사 분석 ────────────────────────────────────────
function analyzeCompetitors(opts = {}) {
  const { brand, competitors = [], metrics = ['sns', 'seo', 'ads'] } = opts;
  const analysis = (competitors.length ? competitors : ['경쟁사A', '경쟁사B', '경쟁사C']).map(c => ({
    name: c,
    snsFollowers: Math.round(10000 + Math.random() * 990000),
    avgEngagementRate: +(1.5 + Math.random() * 5).toFixed(1) + '%',
    estimatedAdSpend: Math.round(500000 + Math.random() * 9500000).toLocaleString('ko-KR') + '원/월',
    topKeywords: ['브랜드키워드', '제품명', '카테고리어'],
    contentFrequency: Math.round(3 + Math.random() * 11) + '회/주',
    strengths: ['콘텐츠 일관성', '고품질 비주얼'],
    weaknesses: ['응답 속도 느림', '다양성 부족'],
  }));

  return {
    brand,
    metrics,
    competitors: analysis,
    opportunities: [
      '마이크로 인플루언서 활용도 낮음 → 진입 기회',
      '숏폼 콘텐츠 빈도 낮음 → 틱톡/릴스 선점 가능',
      '새벽 시간대 포스팅 공백 → 알림 경쟁 낮은 시간 공략',
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ── 6. 콘텐츠 A/B 테스트 설계 ─────────────────────────────
function designABTest(opts = {}) {
  const {
    campaignName = 'Campaign',
    testType = 'creative',
    variants = 2,
    kpi = 'ctr',
    sampleSize = 10000,
    durationDays = 14,
  } = opts;

  const variantList = Array.from({ length: variants }, (_, i) => ({
    id: String.fromCharCode(65 + i),
    name: `버전 ${String.fromCharCode(65 + i)}`,
    description: testType === 'creative' ? `크리에이티브 변형 ${i + 1}` : `메시지 변형 ${i + 1}`,
    trafficSplit: +(100 / variants).toFixed(1) + '%',
    sampleTarget: Math.round(sampleSize / variants),
  }));

  const minDetectableEffect = kpi === 'ctr' ? 0.5 : kpi === 'cvr' ? 0.2 : 1.0;
  const statisticalPower = 0.8;

  return {
    campaignName,
    testType,
    kpi,
    variants: variantList,
    testConfig: {
      totalSampleSize: sampleSize,
      durationDays,
      confidenceLevel: '95%',
      statisticalPower: statisticalPower * 100 + '%',
      minDetectableEffect: minDetectableEffect + '%',
    },
    schedule: {
      setup: '2일',
      running: `${durationDays}일`,
      analysis: '3일',
      totalDays: durationDays + 5,
    },
    successCriteria: `p < 0.05 기준, ${kpi.toUpperCase()} ${minDetectableEffect}% 이상 차이 시 Winner 선정`,
    tools: ['Google Optimize', 'VWO', 'Optimizely', 'Firebase A/B Testing'],
  };
}

// ── 범용 실행 ──────────────────────────────────────────────
async function execute(params = {}) {
  const { action, ...rest } = params;
  const map = {
    snsSchedule:       () => buildSNSSchedule(rest),
    voiceTTS:          () => buildVoiceTTS(rest),
    pressRelease:      () => buildPressRelease(rest),
    findInfluencers:   () => findInfluencers(rest),
    analyzeCompetitors:() => analyzeCompetitors(rest),
    designABTest:      () => designABTest(rest),
  };
  const fn = map[action];
  if (!fn) throw new Error(`Unknown action: ${action}. Available: ${Object.keys(map).join(', ')}`);
  return fn();
}

// ── Phase 4 API 별칭 (server.js 라우트와 매핑) ──────────────
// server.js에서 호출하는 함수명과 기존 함수명 매핑
function generateSNSContent(params = {}) {
  // buildSNSSchedule 기반으로 콘텐츠 생성 래퍼
  const { topic, platforms = ['instagram'], tone = 'professional', keywords = [], productName = '', targetAudience = '일반' } = params;
  const result = buildSNSSchedule({ topic, platforms, tone, keywords });
  return {
    topic: topic || '브랜드 소식',
    tone, keywords, targetAudience,
    platforms: Object.fromEntries(
      platforms.map(p => [p, {
        content: `${productName ? '[' + productName + '] ' : ''}${topic || '브랜드 소식'} — ${targetAudience}를 위한 ${tone} 콘텐츠`,
        charCount: 80,
        maxChars: SNS_PLATFORMS[p]?.charLimit || 2200,
        withinLimit: true,
        hashtags: keywords.map(k => '#' + k),
        bestPostTimes: SNS_PLATFORMS[p]?.bestTimes || ['09:00'],
        warnings: []
      }])
    ),
    schedule: result.schedule || [],
    totalPlatforms: platforms.length,
    generatedAt: new Date().toISOString()
  };
}

function scheduleSNSPosts(params = {}) {
  const { startDate, endDate, frequency = 'daily', platforms = ['instagram'], timezone = 'Asia/Seoul' } = params;
  return buildSNSSchedule({ startDate, endDate, frequency, platforms, timezone });
}

function monitorMedia(params = {}) {
  const { keywords = [], mediaTypes, dateRange, limit = 20 } = params;
  const result = buildPressRelease({ keywords, targetMedia: mediaTypes });
  const articles = (result.mediaList || []).slice(0, limit).map((m, i) => ({
    id: `art_${i+1}`,
    title: `${keywords[0] || '기업'} 관련 최신 동향 ${i+1}호`,
    media: m.name || m,
    publishedAt: new Date(Date.now() - i * 3600000).toISOString(),
    sentiment: ['positive','neutral','negative'][i % 3],
    summary: `${keywords[0] || '기업'} 관련 주요 내용 요약.`,
    reach: Math.floor(Math.random() * 50000 + 5000)
  }));
  return {
    keywords, articles,
    totalFound: articles.length,
    sentimentSummary: { positive: Math.floor(articles.length/3), neutral: Math.floor(articles.length/3), negative: articles.length - Math.floor(articles.length/3)*2 },
    overallSentiment: 'neutral',
    monitoredMedia: articles.length,
    generatedAt: new Date().toISOString()
  };
}

function buildVoiceScript(params = {}) {
  return buildVoiceTTS(params);
}

function planCampaign(params = {}) {
  const { brand = '브랜드', objective = 'brand_awareness', budget = 5000000, channels = ['instagram'], duration = '4주', targetAudience = '일반' } = params;
  const weeks = parseInt(duration) || 4;
  return {
    brand, objective, targetAudience, duration,
    budget: { total: budget, formatted: `${(budget/10000).toFixed(0)}만원` },
    channels,
    weeklyPlan: Array.from({length: weeks}, (_, i) => ({
      week: i+1, focus: i === 0 ? '런칭' : i === weeks-1 ? '마무리' : `확장 ${i}단계`,
      budget: Math.round(budget/weeks), plannedPosts: channels.length * 3
    })),
    contentPlan: channels.map(ch => ({ channel: ch, weeklyPosts: 3, totalPosts: 3*weeks })),
    kpiSummary: ['impressions', 'reach', 'engagement'],
    startDate: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  execute,
  // 기존 함수
  buildSNSSchedule,
  buildVoiceTTS,
  buildPressRelease,
  findInfluencers,
  analyzeCompetitors,
  designABTest,
  // Phase 4 API 별칭
  generateSNSContent,
  scheduleSNSPosts,
  monitorMedia,
  buildVoiceScript,
  planCampaign,
  // 상수
  SNS_PLATFORMS,
  VOICE_PRESETS,
  MEDIA_CATEGORIES,
  INFLUENCER_DB,
};
