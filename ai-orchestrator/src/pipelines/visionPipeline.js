'use strict';
/**
 * visionPipeline.js — Phase 1
 * GPT-4V 이미지 이해 파이프라인 (46건 커버)
 *
 * 기능: 이미지 분석 / OCR / UI 스크린샷 분석 / 상품 인식 / 도면 해석 / 수식 인식
 * 실제 API 호출 제외 — callVisionAPI() stub만 교체
 */

// ── 분석 모드 정의 ────────────────────────────────────────
const VISION_MODES = {

  ocr: {
    name:        'OCR 텍스트 추출',
    description: '이미지 내 텍스트 추출, 구조화, 언어 감지',
    systemPrompt: '이미지에서 모든 텍스트를 정확하게 추출해주세요. 텍스트의 위치, 폰트 크기(대/중/소), 언어를 구분하여 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['text_blocks', 'detected_language', 'confidence', 'layout'],
  },

  product_analysis: {
    name:        '상품 분석',
    description: '상품명, 가격, 스펙, 브랜드, 카테고리 자동 인식',
    systemPrompt: '이미지 속 상품을 분석하여 상품명, 브랜드, 가격(있으면), 주요 특징 3가지, 예상 카테고리를 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['product_name', 'brand', 'price', 'features', 'category', 'condition'],
  },

  ui_analysis: {
    name:        'UI/UX 분석',
    description: 'UI 컴포넌트 식별, 레이아웃 분석, 접근성 평가',
    systemPrompt: '이 UI 스크린샷을 분석하여 주요 컴포넌트(버튼, 폼, 네비게이션 등), 레이아웃 구조, 색상 팔레트, 개선점을 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['components', 'layout', 'color_palette', 'accessibility_issues', 'improvements'],
  },

  formula_ocr: {
    name:        '수식 인식 (LaTeX)',
    description: '수학식/과학식을 LaTeX 코드로 변환',
    systemPrompt: '이미지에 있는 모든 수학식 또는 과학식을 LaTeX 형식으로 변환해주세요. 각 수식에 설명도 포함하세요. JSON 배열로 반환하세요.',
    outputFormat: 'json',
    fields:      ['formulas', 'latex_code', 'description', 'formula_type'],
  },

  document_analysis: {
    name:        '문서 구조 분석',
    description: '표, 차트, 인포그래픽 등 구조화된 데이터 추출',
    systemPrompt: '이 문서 이미지를 분석하여 제목, 섹션, 표 데이터, 핵심 수치를 JSON으로 구조화하세요.',
    outputFormat: 'json',
    fields:      ['title', 'sections', 'tables', 'key_numbers', 'document_type'],
  },

  scene_description: {
    name:        '장면 설명',
    description: '이미지의 전체적인 내용, 물체, 분위기 설명',
    systemPrompt: '이미지를 상세히 묘사해주세요. 주요 피사체, 배경, 분위기, 색감, 구도를 포함하여 한국어로 설명하세요.',
    outputFormat: 'text',
    fields:      ['description', 'objects', 'mood', 'colors', 'composition'],
  },

  quality_check: {
    name:        '이미지 품질 검수',
    description: '블러, 노이즈, 밝기, 구도 자동 품질 평가',
    systemPrompt: '이미지 품질을 평가하세요: 선명도(0-10), 밝기 적절성(0-10), 구도(0-10), 노이즈 수준(low/medium/high), 전반적 품질 점수(0-100), 개선 권고사항을 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['sharpness', 'brightness', 'composition', 'noise_level', 'overall_score', 'recommendations'],
  },

  chart_extraction: {
    name:        '차트 데이터 추출',
    description: '막대/선/파이 차트에서 수치 데이터 추출',
    systemPrompt: '이 차트 이미지에서 모든 데이터를 추출하세요. 차트 유형, x축/y축 레이블, 각 데이터 포인트의 값, 범례를 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['chart_type', 'title', 'x_axis', 'y_axis', 'data_points', 'legend'],
  },

  real_estate_analysis: {
    name:        '부동산 이미지 분석',
    description: '매물 사진에서 방 구조, 상태, 특징 자동 태깅',
    systemPrompt: '이 부동산 이미지를 분석하세요: 방 유형(거실/침실/욕실/주방/외관 등), 상태(신축/리모델링/노후), 주요 특징, 예상 면적 규모, 장단점을 JSON으로 반환하세요.',
    outputFormat: 'json',
    fields:      ['room_type', 'condition', 'features', 'pros', 'cons', 'estimated_size'],
  },
};

// ── 이미지 입력 타입 ──────────────────────────────────────
const INPUT_TYPES = {
  url:     'HTTP URL (공개 접근 가능)',
  base64:  'Base64 인코딩 이미지',
  path:    '로컬 파일 경로 (서버 사이드)',
  buffer:  'Buffer 객체',
};

const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const MAX_IMAGE_MB       = 20;

// ─────────────────────────────────────────────────────────
// 입력 검증
// ─────────────────────────────────────────────────────────
function validateInput(opts = {}) {
  const errors   = [];
  const warnings = [];

  if (!opts.image) errors.push('image 파라미터 필수 (URL 또는 base64)');
  if (opts.mode && !VISION_MODES[opts.mode]) {
    warnings.push(`알 수 없는 모드: ${opts.mode} — scene_description으로 폴백`);
  }
  if (opts.fileSizeMB > MAX_IMAGE_MB) {
    errors.push(`이미지 크기 ${opts.fileSizeMB}MB > ${MAX_IMAGE_MB}MB 초과`);
  }

  const ext = (opts.filename || '').split('.').pop()?.toLowerCase();
  if (ext && !SUPPORTED_FORMATS.includes(ext)) {
    warnings.push(`포맷 .${ext} 미지원 — ${SUPPORTED_FORMATS.join(', ')} 권장`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────
// 이미지 URL 정규화
// ─────────────────────────────────────────────────────────
function normalizeImageInput(image = '') {
  if (typeof image === 'string') {
    if (image.startsWith('http')) return { type: 'url',    value: image };
    if (image.startsWith('data:image')) return { type: 'base64', value: image };
    if (image.startsWith('/') || image.includes('\\')) return { type: 'path', value: image };
  }
  if (Buffer.isBuffer(image)) return { type: 'buffer', value: image.toString('base64') };
  return { type: 'unknown', value: String(image) };
}

// ─────────────────────────────────────────────────────────
// 응답 파싱 (JSON 추출)
// ─────────────────────────────────────────────────────────
function parseVisionResponse(rawText = '', outputFormat = 'json') {
  if (outputFormat === 'text') return { parsed: rawText, type: 'text' };

  // JSON 블록 추출
  const jsonMatch = rawText.match(/```json\n?([\s\S]*?)\n?```/) ||
                    rawText.match(/\{[\s\S]*\}/) ||
                    rawText.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return { parsed: JSON.parse(jsonMatch[1] || jsonMatch[0]), type: 'json' };
    } catch { /* fallthrough */ }
  }
  return { parsed: rawText, type: 'text', note: 'JSON 파싱 실패 — 텍스트로 반환' };
}

// ─────────────────────────────────────────────────────────
// Vision API stub
// ─────────────────────────────────────────────────────────
async function callVisionAPI(imageInput, mode, additionalPrompt, _apiKey) {
  const modeInfo = VISION_MODES[mode] || VISION_MODES.scene_description;
  // 실제 연동 시 교체:
  // const res = await openai.chat.completions.create({
  //   model: 'gpt-4o',
  //   messages: [{ role: 'user', content: [
  //     { type: 'image_url', image_url: { url: imageInput.type==='url' ? imageInput.value : `data:image/jpeg;base64,${imageInput.value}` } },
  //     { type: 'text', text: modeInfo.systemPrompt + (additionalPrompt ? '\n\n추가 지시: ' + additionalPrompt : '') }
  //   ]}],
  //   max_tokens: 1500,
  // });
  // return { text: res.choices[0].message.content, tokens: res.usage };

  const stubOutputs = {
    ocr:               { text_blocks: ['[stub] 추출된 텍스트 1', '[stub] 추출된 텍스트 2'], detected_language: 'ko', confidence: 0.95, layout: 'multi-column' },
    product_analysis:  { product_name: '[stub] 스마트폰 케이스', brand: '[stub] Brand', price: null, features: ['방수', '슬림', '충격흡수'], category: '전자기기 액세서리' },
    ui_analysis:       { components: ['NavBar', 'SearchBar', 'ProductGrid', 'Footer'], layout: 'responsive-grid', color_palette: ['#fff', '#0066cc', '#ff6600'], accessibility_issues: ['contrast_low'], improvements: ['폰트 크기 확대', '버튼 터치 영역 증가'] },
    formula_ocr:       { formulas: [{ latex_code: 'E = mc^{2}', description: '질량-에너지 등가 공식', formula_type: 'physics' }] },
    document_analysis: { title: '[stub] 문서 제목', sections: ['서론', '본론', '결론'], tables: [], key_numbers: ['42%', '$1.2M', '3.8x'] },
    scene_description: '[stub] 야외 공원에서 사람들이 산책하는 장면입니다. 푸른 하늘과 나무들이 배경에 있습니다.',
    quality_check:     { sharpness: 8, brightness: 7, composition: 9, noise_level: 'low', overall_score: 82, recommendations: ['밝기 약간 증가'] },
    chart_extraction:  { chart_type: 'bar', title: '[stub] 월별 매출', x_axis: ['1월','2월','3월'], y_axis: '매출(만원)', data_points: [{ label: '1월', value: 1200 }, { label: '2월', value: 1450 }, { label: '3월', value: 1380 }] },
    real_estate_analysis: { room_type: '거실', condition: '리모델링', features: ['넓은 공간', '자연채광', '원목마루'], pros: ['채광 우수', '넓은 거실'], cons: ['주차 협소'], estimated_size: '30평대' },
  };

  const stubOutput = stubOutputs[mode] || '[stub] 이미지 분석 결과';
  return {
    stub:    true,
    text:    typeof stubOutput === 'string' ? stubOutput : JSON.stringify(stubOutput, null, 2),
    rawData: stubOutput,
    mode,
    model:   'gpt-4o (stub)',
    tokens:  { prompt: 800, completion: 200, total: 1000 },
    message: 'Vision stub — OPENAI_API_KEY 설정 후 실제 이미지 분석 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 파이프라인 실행 (단일)
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    image           = '',
    mode            = 'scene_description',
    additionalPrompt = '',
    filename        = '',
    fileSizeMB      = 0,
    apiKey          = null,
  } = opts;

  const startMs = Date.now();

  // 1. 검증
  const validation = validateInput({ image, mode, filename, fileSizeMB });
  if (!validation.valid) return { success: false, errors: validation.errors };

  // 2. 입력 정규화
  const imageInput = normalizeImageInput(image);

  // 3. 모드 결정
  const activeMode = VISION_MODES[mode] ? mode : 'scene_description';
  const modeInfo   = VISION_MODES[activeMode];

  // 4. API 호출
  const apiResult = await callVisionAPI(imageInput, activeMode, additionalPrompt, apiKey);

  // 5. 응답 파싱
  const parsed = parseVisionResponse(apiResult.text, modeInfo.outputFormat);

  return {
    success:     true,
    pipeline:    'vision',
    mode:        { key: activeMode, name: modeInfo.name, description: modeInfo.description },
    imageInput:  { type: imageInput.type, filename, fileSizeMB },
    validation,
    result:      parsed.parsed,
    resultType:  parsed.type,
    rawText:     apiResult.text,
    tokens:      apiResult.tokens,
    durationMs:  Date.now() - startMs,
    readyToUse:  !apiResult.stub,
    meta: {
      modes:            Object.keys(VISION_MODES),
      supportedFormats: SUPPORTED_FORMATS,
      maxImageMB:       MAX_IMAGE_MB,
    },
  };
}

// 배치 실행 (여러 이미지)
async function executeBatch(images = [], sharedOpts = {}) {
  const results = [];
  for (const img of images) {
    const r = await execute({ ...sharedOpts, ...(typeof img === 'string' ? { image: img } : img) });
    results.push(r);
  }
  return {
    total: results.length,
    succeeded: results.filter(r => r.success).length,
    results,
  };
}

module.exports = {
  execute,
  executeBatch,
  validateInput,
  normalizeImageInput,
  parseVisionResponse,
  VISION_MODES,
  SUPPORTED_FORMATS,
};
