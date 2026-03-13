'use strict';
/**
 * multimodalPipeline.js — Phase 7F: 멀티모달 파이프라인
 * - 이미지 + 텍스트 분석 (GPT-4V)
 * - 음성 → STT → 요약 → 이메일
 * - PDF → OCR → NER → 계약서 분석 → CRM
 * - 비디오 분석 (프레임 추출)
 */
'use strict';
const aiConnector = require('../services/aiConnector');

// ── 1. 이미지 + 텍스트 멀티모달 분석 ─────────────────────────
async function analyzeImageWithText({ imageUrl, imageBase64, question, context, pipeline = 'multimodal' }) {
  const prompt = `${context ? `컨텍스트: ${context}\n\n` : ''}질문: ${question}`;
  const result = await aiConnector.callVision({ imageUrl, imageBase64, prompt, pipeline });
  return {
    pipeline: 'multimodal/image-analysis',
    question, imageUrl: imageUrl || '[base64]',
    analysis: result.content,
    model: result.model, ms: result.ms,
    provider: result.provider,
  };
}

// ── 2. 음성 → STT → 요약 → 이메일 자동화 ────────────────────
async function voiceToEmail({ transcribedText, recipientName, recipientEmail, context, userId }) {
  // Step 1: 요약
  const summaryResult = await aiConnector.callLLM({
    strategy: 'fast', pipeline: 'multimodal', userId,
    messages: [{ role: 'user', content: `다음 음성 내용을 핵심만 3-5줄로 요약해주세요:\n\n${transcribedText}` }],
  });

  // Step 2: 이메일 초안 작성
  const emailResult = await aiConnector.callLLM({
    strategy: 'fast', pipeline: 'multimodal', userId,
    messages: [{ role: 'user', content: `다음 내용을 바탕으로 비즈니스 이메일을 작성해주세요.\n수신자: ${recipientName}\n내용 요약: ${summaryResult.content}\n\n정중하고 전문적인 이메일 형식으로 작성하세요.` }],
  });

  return {
    pipeline: 'multimodal/voice-to-email',
    steps: ['STT', '요약', '이메일 초안'],
    originalText: transcribedText.slice(0, 200) + '...',
    summary: summaryResult.content,
    emailDraft: emailResult.content,
    recipient: { name: recipientName, email: recipientEmail },
    totalMs: (summaryResult.ms || 0) + (emailResult.ms || 0),
  };
}

// ── 3. PDF/문서 → OCR → NER → 계약서 분석 ───────────────────
async function documentToCRM({ documentText, documentType = '계약서', userId }) {
  // Step 1: NER (개체명 추출)
  const nerResult = await aiConnector.callStructured({
    strategy: 'fast', pipeline: 'multimodal', userId,
    prompt: `다음 ${documentType}에서 핵심 정보를 추출하세요:\n\n${documentText}\n\n반드시 JSON으로 반환하세요.`,
    schema: {
      parties: '계약 당사자 목록',
      dates: '주요 날짜들',
      amounts: '금액 정보들',
      keyTerms: '핵심 조항들',
      risks: '주요 리스크',
    },
  });

  // Step 2: CRM 데이터 생성
  const crmResult = await aiConnector.callLLM({
    strategy: 'fast', pipeline: 'multimodal', userId,
    messages: [{ role: 'user', content: `다음 추출 정보를 바탕으로 CRM 입력용 요약을 작성해주세요:\n${JSON.stringify(nerResult.parsed, null, 2)}` }],
  });

  return {
    pipeline:     'multimodal/document-to-crm',
    documentType,
    steps:        ['문서 분석', 'NER 추출', 'CRM 데이터 생성'],
    extracted:    nerResult.parsed,
    crmSummary:   crmResult.content,
    crmFields: {
      company:    nerResult.parsed?.parties?.[0] || '추출 중',
      contract:   documentType,
      status:     'review_required',
      createdAt:  new Date().toISOString(),
    },
  };
}

// ── 4. 멀티스텝 상품 설명 생성 (이커머스) ────────────────────
async function productDescriptionPipeline({ productName, features, targetAudience, imageUrl, userId }) {
  // Step 1: 이미지 분석 (있는 경우)
  let imageAnalysis = '';
  if (imageUrl) {
    const imgResult = await aiConnector.callVision({
      imageUrl, pipeline: 'multimodal', userId,
      prompt: '상품의 주요 특징을 간략히 설명해주세요.',
    });
    imageAnalysis = imgResult.content;
  }

  // Step 2: 상품 설명 생성
  const descResult = await aiConnector.callLLM({
    strategy: 'balanced', pipeline: 'multimodal', userId,
    messages: [{ role: 'user', content: `상품명: ${productName}\n특징: ${features.join(', ')}\n타깃: ${targetAudience}\n${imageAnalysis ? `이미지 분석: ${imageAnalysis}` : ''}\n\n매력적인 상품 설명문, SNS 캡션, 키워드 태그를 작성해주세요.` }],
  });

  // Step 3: SEO 메타데이터 생성
  const seoResult = await aiConnector.callStructured({
    strategy: 'fast', pipeline: 'multimodal', userId,
    prompt: `상품명: ${productName}\n설명: ${descResult.content.slice(0, 200)}\n\nSEO 메타데이터를 JSON으로 반환하세요.`,
    schema: { title: 'SEO 제목 (60자 이내)', description: '메타 설명 (160자 이내)', keywords: '키워드 배열' },
  });

  return {
    pipeline:    'multimodal/product-description',
    productName, steps: ['이미지분석', '설명생성', 'SEO최적화'],
    description: descResult.content,
    seoMeta:     seoResult.parsed,
    imageAnalysis: imageAnalysis || null,
  };
}

// ── 5. 영상 스크립트 → 스토리보드 → SNS 컨텐츠 ──────────────
async function videoContentPipeline({ topic, duration, platform, brand, userId }) {
  const scriptResult = await aiConnector.callLLM({
    strategy: 'balanced', pipeline: 'multimodal', userId,
    messages: [{ role: 'user', content: `브랜드: ${brand}\n주제: ${topic}\n영상 길이: ${duration}초\n플랫폼: ${platform}\n\n영상 스크립트와 장면 구성(스토리보드)을 작성해주세요.` }],
  });

  const captionResult = await aiConnector.callStructured({
    strategy: 'fast', pipeline: 'multimodal', userId,
    prompt: `다음 스크립트에서 ${platform} 최적화 캡션과 해시태그를 JSON으로 추출하세요:\n${scriptResult.content.slice(0, 500)}`,
    schema: { caption: '캡션 텍스트', hashtags: '해시태그 배열', bestPostTime: '최적 게시 시간' },
  });

  return {
    pipeline: 'multimodal/video-content',
    topic, platform, brand, duration,
    script:     scriptResult.content,
    captions:   captionResult.parsed,
    storyboard: { scenes: Math.ceil(duration / 10), estimatedProdTime: `${Math.ceil(duration / 60)}일` },
  };
}

// ── 6. 의료 상담 → SOAP 노트 → EMR 자동화 ────────────────────
async function medicalConsultationToEMR({ consultationText, patientId, userId }) {
  const soapResult = await aiConnector.callStructured({
    strategy: 'powerful', pipeline: 'multimodal', userId,
    prompt: `다음 의료 상담 내용을 SOAP 형식 EMR 노트로 변환해주세요:\n\n${consultationText}\n\nJSON으로 반환하세요.`,
    schema: {
      S: 'Subjective - 주관적 증상',
      O: 'Objective - 객관적 소견',
      A: 'Assessment - 평가/진단',
      P: 'Plan - 치료 계획',
    },
  });

  return {
    pipeline: 'multimodal/medical-consultation-emr',
    patientId: patientId || 'PT-' + Date.now(),
    soapNote:  soapResult.parsed,
    emrEntry: {
      visitDate: new Date().toISOString().slice(0, 10),
      provider:  'AI 보조 시스템',
      status:    'draft',
      note:      soapResult.content,
    },
    disclaimer: '⚠️ AI 생성 초안입니다. 담당 의사의 검토가 필요합니다.',
  };
}

// ── Execute Dispatcher ────────────────────────────────────────
async function execute(action, params) {
  switch (action) {
    case 'analyze-image':       return analyzeImageWithText(params);
    case 'voice-to-email':      return voiceToEmail(params);
    case 'document-to-crm':     return documentToCRM(params);
    case 'product-description': return productDescriptionPipeline(params);
    case 'video-content':       return videoContentPipeline(params);
    case 'medical-emr':         return medicalConsultationToEMR(params);
    default: throw new Error(`알 수 없는 멀티모달 액션: ${action}`);
  }
}

module.exports = {
  execute,
  analyzeImageWithText, voiceToEmail, documentToCRM,
  productDescriptionPipeline, videoContentPipeline, medicalConsultationToEMR,
};
