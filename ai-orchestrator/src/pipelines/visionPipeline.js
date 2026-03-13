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
// URL 접근 가능 여부 사전 체크 + base64 변환
// ─────────────────────────────────────────────────────────
async function _fetchImageAsBase64(url) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} — URL 접근 불가`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf    = Buffer.concat(chunks);
        const mime   = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('URL fetch timeout')); });
  });
}

// ─────────────────────────────────────────────────────────
// Anthropic Claude Vision 폴백
// ─────────────────────────────────────────────────────────
async function _callAnthropicVision(imageBase64OrUrl, prompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 없음');

  const client = new Anthropic({ apiKey });

  // base64이면 그대로, URL이면 url source 사용
  let imageSource;
  if (imageBase64OrUrl.startsWith('data:')) {
    const [header, data] = imageBase64OrUrl.split(',');
    const mediaType = header.replace('data:', '').replace(';base64', '');
    imageSource = { type: 'base64', media_type: mediaType, data };
  } else {
    imageSource = { type: 'url', url: imageBase64OrUrl };
  }

  const res = await client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens:  1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: imageSource },
        { type: 'text',  text: prompt + '\n\n반드시 한국어로 응답하세요.' },
      ],
    }],
  });

  return {
    stub:     false,
    text:     res.content[0]?.text || '',
    model:    'claude-haiku-4-5',
    tokens:   { prompt: res.usage?.input_tokens || 0, completion: res.usage?.output_tokens || 0, total: (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0) },
    ms:       0,
    provider: 'anthropic',
  };
}

// ─────────────────────────────────────────────────────────
// Vision API — OpenAI 우선, URL 차단 시 base64 재시도, 최종 폴백 Anthropic
// ─────────────────────────────────────────────────────────
async function callVisionAPI(imageInput, mode, additionalPrompt, _apiKey) {
  const modeInfo = VISION_MODES[mode] || VISION_MODES.scene_description;

  // aiConnector 지연 로드 (순환참조 방지)
  let aiConnector;
  try {
    aiConnector = require('../services/aiConnector');
  } catch (e) {
    throw new Error('aiConnector 로드 실패: ' + e.message);
  }

  const prompt = modeInfo.systemPrompt +
    (additionalPrompt ? '\n\n추가 지시: ' + additionalPrompt : '') +
    '\n\n반드시 한국어로 응답하세요.';

  // ── 시도 1: OpenAI — URL 직접 전달
  if (imageInput.type === 'url') {
    try {
      const result = await aiConnector.callVision({
        imageUrl:  imageInput.value,
        prompt,
        userId:    'pipeline',
        pipeline:  'vision',
      });
      return {
        stub:     false,
        text:     result.content || result.text || '',
        model:    result.model   || 'gpt-4o',
        tokens:   result.usage   || { prompt: 0, completion: 0, total: 0 },
        ms:       result.ms      || 0,
        provider: result.provider || 'openai',
      };
    } catch (e1) {
      const msg = (e1.message || '').toLowerCase();
      const isUrlBlocked = msg.includes('400') || msg.includes('download') ||
                           msg.includes('fetch') || msg.includes('url') ||
                           msg.includes('invalid_image_url') || msg.includes('timeout');

      if (!isUrlBlocked) throw e1; // 다른 에러면 그냥 throw

      console.warn(`[Vision] OpenAI URL 직접 접근 실패 (${e1.message}) → base64 변환 시도`);

      // ── 시도 2: OpenAI — URL→base64 변환 후 재시도
      try {
        const base64Data = await _fetchImageAsBase64(imageInput.value);
        const result2 = await aiConnector.callVision({
          imageBase64: base64Data.split(',')[1],
          prompt,
          userId:      'pipeline',
          pipeline:    'vision',
        });
        return {
          stub:     false,
          text:     result2.content || result2.text || '',
          model:    result2.model   || 'gpt-4o',
          tokens:   result2.usage   || { prompt: 0, completion: 0, total: 0 },
          ms:       result2.ms      || 0,
          provider: result2.provider || 'openai',
          note:     'base64 변환 후 OpenAI 성공',
        };
      } catch (e2) {
        console.warn(`[Vision] base64 변환 후 OpenAI도 실패 (${e2.message}) → Anthropic 폴백`);

        // ── 시도 3: Anthropic Claude Vision 폴백
        try {
          const base64Fallback = await _fetchImageAsBase64(imageInput.value).catch(() => imageInput.value);
          return await _callAnthropicVision(base64Fallback, prompt);
        } catch (e3) {
          throw new Error(`Vision 모든 시도 실패: OpenAI(${e1.message}), base64(${e2.message}), Anthropic(${e3.message})`);
        }
      }
    }
  }

  // ── base64 입력인 경우 — OpenAI 직접 호출
  try {
    const result = await aiConnector.callVision({
      imageBase64: imageInput.value,
      prompt,
      userId:      'pipeline',
      pipeline:    'vision',
    });
    return {
      stub:     false,
      text:     result.content || result.text || '',
      model:    result.model   || 'gpt-4o',
      tokens:   result.usage   || { prompt: 0, completion: 0, total: 0 },
      ms:       result.ms      || 0,
      provider: result.provider || 'openai',
    };
  } catch (e) {
    console.warn(`[Vision] base64 OpenAI 실패 (${e.message}) → Anthropic 폴백`);
    return await _callAnthropicVision(imageInput.value.startsWith('data:') ? imageInput.value : `data:image/jpeg;base64,${imageInput.value}`, prompt);
  }
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
