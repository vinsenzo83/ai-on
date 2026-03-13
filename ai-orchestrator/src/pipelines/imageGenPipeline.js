'use strict';
/**
 * imageGenPipeline.js — Phase 1
 * AI 이미지 생성 파이프라인 (80건 커버)
 *
 * 실제 API 호출 제외 — 프롬프트 설계 / 스타일 선택 / 배치 계획 / 후처리 로직 완비
 * 실제 연동 시 execute() 내 callImageAPI() 만 교체하면 됨
 */

// ── 스타일 프리셋 ──────────────────────────────────────────
const STYLE_PRESETS = {
  photorealistic:  { suffix: 'photorealistic, 8k, studio lighting, sharp focus',      negPrompt: 'cartoon, painting, blurry, watermark' },
  product:         { suffix: 'product photography, white background, commercial, clean', negPrompt: 'shadow, messy, dark, watermark' },
  illustration:    { suffix: 'digital illustration, flat design, vector style',          negPrompt: 'photo, 3d render, noisy' },
  ecommerce:       { suffix: 'ecommerce product shot, high detail, professional',        negPrompt: 'watermark, text overlay, blurry' },
  marketing:       { suffix: 'marketing banner, vibrant colors, brand feel',             negPrompt: 'boring, low quality, pixelated' },
  infographic:     { suffix: 'clean infographic, data visualization, minimal',           negPrompt: 'cluttered, noisy, hard to read' },
  thumbnail:       { suffix: 'youtube thumbnail style, bold text area, eye-catching',    negPrompt: 'boring, dark, unreadable' },
  avatar:          { suffix: 'profile avatar, centered subject, clean bg',               negPrompt: 'crowd, busy background, blurry' },
  banner:          { suffix: 'wide banner 16:9, promotional, bold composition',          negPrompt: 'portrait, square, blurry' },
  logo_concept:    { suffix: 'logo concept, clean vector look, minimal, iconic',         negPrompt: 'complex, photo, realistic, noisy' },
  social_post:     { suffix: 'social media post, square 1:1, engaging, modern',          negPrompt: 'boring, low contrast, pixelated' },
  background:      { suffix: 'seamless background texture, subtle pattern',              negPrompt: 'busy, noisy, too dark' },
};

// ── 크기 프리셋 ──────────────────────────────────────────
const SIZE_PRESETS = {
  square:    { w: 1024, h: 1024, ratio: '1:1',   use: 'SNS, 아이콘, 프로필' },
  landscape: { w: 1792, h: 1024, ratio: '16:9',  use: '배너, 썸네일, 발표자료' },
  portrait:  { w: 1024, h: 1792, ratio: '9:16',  use: '스토리, 모바일 배경' },
  wide:      { w: 2048, h: 512,  ratio: '4:1',   use: '웹 헤더, 와이드 배너' },
};

// ── 도메인별 기본 스타일 매핑 ─────────────────────────────
const DOMAIN_STYLE_MAP = {
  ecommerce:     'product',
  marketing:     'marketing',
  creative:      'illustration',
  b2b:           'infographic',
  edu_med:       'infographic',
  data_ai:       'infographic',
  real_estate:   'photorealistic',
  finance:       'infographic',
  healthcare:    'illustration',
  government:    'illustration',
  default:       'photorealistic',
};

// ─────────────────────────────────────────────────────────
// 프롬프트 빌더
// ─────────────────────────────────────────────────────────
function buildPrompt(opts = {}) {
  const {
    subject   = '',
    style     = 'product',
    context   = '',
    brand     = '',
    colorHint = '',
    language  = 'ko',
  } = opts;

  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.photorealistic;

  const parts = [subject];
  if (context)   parts.push(context);
  if (brand)     parts.push(`brand: ${brand}`);
  if (colorHint) parts.push(`color scheme: ${colorHint}`);
  parts.push(preset.suffix);

  // 한국어 주제면 영어 번역 힌트 추가
  const hasKorean = /[가-힣]/.test(subject);
  const finalPrompt = parts.filter(Boolean).join(', ');

  return {
    prompt:       finalPrompt,
    negPrompt:    preset.negPrompt,
    style,
    hasKorean,
    note: hasKorean ? '한국어 주제 감지 — 실제 API 호출 전 영어 번역 권장' : null,
  };
}

// ─────────────────────────────────────────────────────────
// 배치 계획 (여러 이미지 일괄 생성 플랜)
// ─────────────────────────────────────────────────────────
function planBatch(items = [], globalStyle = 'product', sizeKey = 'square') {
  const size = SIZE_PRESETS[sizeKey] || SIZE_PRESETS.square;
  return items.map((item, idx) => ({
    index:      idx + 1,
    subject:    typeof item === 'string' ? item : item.subject,
    style:      item.style || globalStyle,
    size,
    prompt:     buildPrompt({ subject: item.subject || item, style: item.style || globalStyle }),
    status:     'planned',    // planned → queued → done | failed
    outputKey:  `img_${Date.now()}_${idx}`,
  }));
}

// ─────────────────────────────────────────────────────────
// 후처리 파이프라인 (생성 후 적용할 수 있는 단계 정의)
// ─────────────────────────────────────────────────────────
const POST_PROCESSORS = {
  removeBg: {
    name:        '배경 제거',
    description: 'Remove.bg / rembg 기반 누끼 처리',
    inputFormats:  ['png', 'jpg'],
    outputFormat:  'png',
    avgMs:         1200,
    // stub: 실제 연동 시 교체
    process: async (imageBuffer, _opts) => ({
      success: true,
      stub:    true,
      message: 'removeBg stub — Remove.bg API 키 설정 후 활성화',
      output:  imageBuffer,
    }),
  },
  resize: {
    name:        '리사이즈',
    description: '목적별 해상도 최적화',
    process: async (imageBuffer, opts = {}) => {
      const { targetW = 800, targetH = 800 } = opts;
      return { success: true, stub: true, message: `resize stub → ${targetW}×${targetH}`, output: imageBuffer };
    },
  },
  addWatermark: {
    name:        '워터마크',
    description: '브랜드 로고/텍스트 오버레이',
    process: async (imageBuffer, opts = {}) => {
      const { text = '© Brand' } = opts;
      return { success: true, stub: true, message: `watermark stub: "${text}"`, output: imageBuffer };
    },
  },
  convertFormat: {
    name:        '포맷 변환',
    description: 'PNG → WebP / AVIF 변환 (웹 최적화)',
    process: async (imageBuffer, opts = {}) => {
      const { format = 'webp' } = opts;
      return { success: true, stub: true, message: `format convert stub → ${format}`, output: imageBuffer };
    },
  },
};

// ─────────────────────────────────────────────────────────
// 실제 이미지 API 호출 stub (연동 시 교체)
// ─────────────────────────────────────────────────────────
async function callImageAPI(prompt, negPrompt, size, _apiKey) {
  // ※ 실제 연동 시 이 함수만 교체
  // DALL-E 3 예시:
  //   const res = await openai.images.generate({ model:'dall-e-3', prompt, size:`${size.w}x${size.h}`, quality:'hd', n:1 });
  //   return { url: res.data[0].url, revisedPrompt: res.data[0].revised_prompt };
  return {
    stub:          true,
    url:           `https://placeholder.img/${size.w}x${size.h}?text=STUB`,
    prompt,
    negPrompt,
    size,
    model:         'dall-e-3 (stub)',
    generatedAt:   new Date().toISOString(),
    message:       'ImageGen stub — OPENAI_API_KEY 설정 후 실제 생성 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 파이프라인 실행 (단일)
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    subject      = '',
    style        = 'product',
    sizeKey      = 'square',
    context      = '',
    brand        = '',
    colorHint    = '',
    postProcess  = [],   // ['removeBg', 'resize', 'addWatermark']
    apiKey       = null,
  } = opts;

  const startMs = Date.now();
  const size    = SIZE_PRESETS[sizeKey] || SIZE_PRESETS.square;
  const built   = buildPrompt({ subject, style, context, brand, colorHint });

  // Step 1: 이미지 생성
  const genResult = await callImageAPI(built.prompt, built.negPrompt, size, apiKey);

  // Step 2: 후처리 순차 적용
  const ppResults = [];
  for (const ppKey of postProcess) {
    const pp = POST_PROCESSORS[ppKey];
    if (!pp) { ppResults.push({ key: ppKey, skipped: true, reason: '알 수 없는 후처리' }); continue; }
    const ppOut = await pp.process(genResult.url, opts[ppKey + 'Opts'] || {});
    ppResults.push({ key: ppKey, name: pp.name, ...ppOut });
  }

  return {
    success:      true,
    pipeline:     'imageGen',
    input:        { subject, style, sizeKey, context, brand, colorHint },
    promptBuilt:  built,
    generation:   genResult,
    postProcess:  ppResults,
    durationMs:   Date.now() - startMs,
    readyToUse:   !genResult.stub,
    meta: {
      stylePresets:  Object.keys(STYLE_PRESETS),
      sizePresets:   Object.keys(SIZE_PRESETS),
      postProcessors: Object.keys(POST_PROCESSORS),
    },
  };
}

// ─────────────────────────────────────────────────────────
// 배치 실행
// ─────────────────────────────────────────────────────────
async function executeBatch(items = [], globalOpts = {}) {
  const plan = planBatch(items, globalOpts.style, globalOpts.sizeKey);
  const results = [];
  for (const item of plan) {
    const r = await execute({ ...globalOpts, subject: item.subject, style: item.style });
    results.push({ ...item, result: r, status: r.success ? 'done' : 'failed' });
  }
  const succeeded = results.filter(r => r.status === 'done').length;
  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
    durationMs: results.reduce((s, r) => s + (r.result?.durationMs || 0), 0),
  };
}

// ─────────────────────────────────────────────────────────
// 도메인 자동 스타일 추천
// ─────────────────────────────────────────────────────────
function recommendStyle(domain = 'default') {
  const style     = DOMAIN_STYLE_MAP[domain] || DOMAIN_STYLE_MAP.default;
  const preset    = STYLE_PRESETS[style];
  return { domain, recommendedStyle: style, preset, allStyles: Object.keys(STYLE_PRESETS) };
}

module.exports = {
  execute,
  executeBatch,
  buildPrompt,
  planBatch,
  recommendStyle,
  STYLE_PRESETS,
  SIZE_PRESETS,
  POST_PROCESSORS,
  DOMAIN_STYLE_MAP,
};
