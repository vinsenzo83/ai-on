'use strict';
/**
 * sttPipeline.js — Phase 1
 * 음성 → 텍스트 파이프라인 (55건 커버)
 *
 * 기능: 파일 검증 / 청크 분할 계획 / 화자 분리 매핑 / 자막 생성 / 요약
 * 실제 API 호출 제외 — callWhisperAPI() stub만 교체하면 됨
 */

// ── 지원 포맷 & 제한 ──────────────────────────────────────
const SUPPORTED_FORMATS = ['mp3', 'mp4', 'wav', 'm4a', 'webm', 'ogg', 'flac'];
const MAX_FILE_MB       = 25;        // Whisper API 한계
const CHUNK_DURATION_S  = 600;       // 10분 단위 분할
const SUPPORTED_LANGS   = {
  ko: '한국어', en: 'English', ja: '日本語',
  zh: '中文',  es: 'Español', fr: 'Français',
  de: 'Deutsch', pt: 'Português', ar: 'العربية',
};

// ─────────────────────────────────────────────────────────
// 파일 검증
// ─────────────────────────────────────────────────────────
function validateInput(opts = {}) {
  const errors = [];
  const warnings = [];

  const ext = (opts.filename || '').split('.').pop()?.toLowerCase();
  if (ext && !SUPPORTED_FORMATS.includes(ext)) {
    errors.push(`지원하지 않는 포맷: .${ext} — 지원: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const sizeMB = opts.fileSizeMB || 0;
  if (sizeMB > MAX_FILE_MB) {
    warnings.push(`파일 크기 ${sizeMB}MB > ${MAX_FILE_MB}MB — 자동 청크 분할 적용`);
  }

  if (opts.language && !SUPPORTED_LANGS[opts.language]) {
    warnings.push(`언어 코드 '${opts.language}' 미확인 — 자동 감지로 폴백`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────
// 청크 분할 계획 (25MB 초과 파일용)
// ─────────────────────────────────────────────────────────
function planChunks(durationSec = 0, fileSizeMB = 0) {
  if (fileSizeMB <= MAX_FILE_MB) {
    return [{ index: 0, startSec: 0, endSec: durationSec, sizeMB: fileSizeMB, needsSplit: false }];
  }
  const chunkCount = Math.ceil(durationSec / CHUNK_DURATION_S);
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({
      index:    i,
      startSec: i * CHUNK_DURATION_S,
      endSec:   Math.min((i + 1) * CHUNK_DURATION_S, durationSec),
      sizeMB:   (fileSizeMB / chunkCount).toFixed(1),
      needsSplit: true,
    });
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────
// 화자 분리 매핑 (diarization)
// segments: [{ start, end, text }] → speakerMap 적용
// ─────────────────────────────────────────────────────────
function applyDiarization(segments = [], speakerMap = {}) {
  // stub: 실제 diarization은 pyannote.audio 또는 AssemblyAI 화자분리 API 필요
  return segments.map((seg, i) => ({
    ...seg,
    speaker: speakerMap[i] ?? `SPEAKER_${(i % 2) + 1}`,  // 기본: 2인 교차
    stubDiarization: true,
  }));
}

// ─────────────────────────────────────────────────────────
// 자막 포맷 변환
// ─────────────────────────────────────────────────────────
function toSRT(segments = []) {
  return segments.map((seg, i) => {
    const fmt = s => {
      const h  = Math.floor(s / 3600);
      const m  = Math.floor((s % 3600) / 60);
      const sc = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
    };
    return `${i + 1}\n${fmt(seg.start || 0)} --> ${fmt(seg.end || 0)}\n${seg.text || ''}\n`;
  }).join('\n');
}

function toVTT(segments = []) {
  const header = 'WEBVTT\n\n';
  const body = segments.map((seg, i) => {
    const fmt = s => {
      const h  = Math.floor(s / 3600);
      const m  = Math.floor((s % 3600) / 60);
      const sc = (s % 60).toFixed(3);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(6,'0')}`;
    };
    return `${i + 1}\n${fmt(seg.start || 0)} --> ${fmt(seg.end || 0)}\n${seg.text || ''}\n`;
  }).join('\n');
  return header + body;
}

function toJSON(segments = []) {
  return JSON.stringify({ segments, generatedAt: new Date().toISOString() }, null, 2);
}

// ─────────────────────────────────────────────────────────
// 텍스트 후처리 (오류 보정, 키워드 추출)
// ─────────────────────────────────────────────────────────
function postProcessText(rawText = '', opts = {}) {
  let text = rawText;

  // 기본 정제
  text = text.replace(/\s+/g, ' ').trim();

  // 필러 제거 옵션
  if (opts.removeFillers) {
    const fillers = ['어', '음', '아', 'uh', 'um', 'like', 'you know'];
    const re = new RegExp(`\\b(${fillers.join('|')})\\b`, 'gi');
    text = text.replace(re, '').replace(/\s+/g, ' ').trim();
  }

  // 키워드 추출 (간단 빈도 기반 stub)
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const freq  = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return { cleanText: text, keywords, originalLength: rawText.length, cleanLength: text.length };
}

// ─────────────────────────────────────────────────────────
// Whisper API stub
// ─────────────────────────────────────────────────────────
async function callWhisperAPI(audioInput, language, _apiKey) {
  // 실제 연동 시 교체:
  // const formData = new FormData();
  // formData.append('file', audioBuffer, { filename: 'audio.mp3' });
  // const res = await openai.audio.transcriptions.create({ file: audioBuffer, model: 'whisper-1', language, response_format: 'verbose_json' });
  // return { text: res.text, segments: res.segments, language: res.language, duration: res.duration };
  return {
    stub: true,
    text: `[Whisper STT stub] 입력: "${audioInput?.filename || 'audio'}", 언어: ${language || 'auto'}`,
    segments: [
      { start: 0.0,  end: 3.2,  text: '[stub] 안녕하세요, 이것은 테스트 전사입니다.' },
      { start: 3.2,  end: 6.8,  text: '[stub] Whisper STT API 키 설정 후 실제 전사가 활성화됩니다.' },
      { start: 6.8,  end: 10.0, text: '[stub] 화자 분리, 타임스탬프, 자막 생성이 모두 지원됩니다.' },
    ],
    language:   language || 'ko',
    duration:   10.0,
    model:      'whisper-1 (stub)',
    message:    'STT stub — OPENAI_API_KEY 설정 후 실제 전사 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 파이프라인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    filename        = 'audio.mp3',
    fileSizeMB      = 0,
    durationSec     = 0,
    language        = 'ko',
    outputFormats   = ['json', 'srt'],  // json | srt | vtt | text
    diarization     = false,
    speakerMap      = {},
    removeFillers   = false,
    apiKey          = null,
  } = opts;

  const startMs = Date.now();

  // 1. 검증
  const validation = validateInput({ filename, fileSizeMB, language });
  if (!validation.valid) {
    return { success: false, errors: validation.errors, warnings: validation.warnings };
  }

  // 2. 청크 계획
  const chunks = planChunks(durationSec, fileSizeMB);

  // 3. STT 실행 (청크별)
  const transcriptions = [];
  for (const chunk of chunks) {
    const result = await callWhisperAPI({ filename, chunk }, language, apiKey);
    transcriptions.push({ chunk, result });
  }

  // 4. 전체 텍스트 병합
  const fullText = transcriptions.map(t => t.result.text).join(' ');
  const allSegments = transcriptions.flatMap(t => t.result.segments || []);

  // 5. 화자 분리 적용
  const segments = diarization ? applyDiarization(allSegments, speakerMap) : allSegments;

  // 6. 후처리
  const processed = postProcessText(fullText, { removeFillers });

  // 7. 출력 포맷 생성
  const outputs = {};
  if (outputFormats.includes('srt'))  outputs.srt  = toSRT(segments);
  if (outputFormats.includes('vtt'))  outputs.vtt  = toVTT(segments);
  if (outputFormats.includes('json')) outputs.json = toJSON(segments);
  if (outputFormats.includes('text')) outputs.text = processed.cleanText;

  return {
    success:      true,
    pipeline:     'stt',
    input:        { filename, fileSizeMB, durationSec, language },
    validation,
    chunks:       chunks.length,
    transcription: {
      fullText:    processed.cleanText,
      keywords:    processed.keywords,
      segments,
      language:    transcriptions[0]?.result?.language || language,
      duration:    transcriptions.reduce((s, t) => s + (t.result?.duration || 0), 0),
    },
    outputs,
    durationMs:   Date.now() - startMs,
    readyToUse:   !transcriptions[0]?.result?.stub,
    meta: { supportedFormats: SUPPORTED_FORMATS, supportedLangs: SUPPORTED_LANGS, maxFileMB: MAX_FILE_MB },
  };
}

module.exports = {
  execute,
  validateInput,
  planChunks,
  applyDiarization,
  postProcessText,
  toSRT,
  toVTT,
  toJSON,
  SUPPORTED_FORMATS,
  SUPPORTED_LANGS,
};
