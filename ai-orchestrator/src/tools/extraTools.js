'use strict';
/**
 * extraTools.js — 추가 AI 툴 모음
 * - YouTube 요약
 * - QR코드 생성
 * - 이미지 배경 제거
 * - 채팅 PDF 내보내기
 * - URL 단축 (무료 API)
 * - 텍스트 → 음성 (TTS)
 * - 색상 팔레트 생성
 * - 정규식 생성/설명
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ══════════════════════════════════════════════════════════════════
// [1] YouTube 자막 요약
// ══════════════════════════════════════════════════════════════════
async function summarizeYouTube(url) {
  // youtube-transcript 패키지로 자막 추출
  let transcript = '';
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&\n?#]+)/)?.[1];
    if (!videoId) throw new Error('유효한 YouTube URL이 아닙니다.');

    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ko' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId)); // 영어 fallback

    transcript = items.map(i => i.text).join(' ').slice(0, 8000);
  } catch (err) {
    return { success: false, error: `자막 추출 실패: ${err.message}. 자막이 없는 영상이거나 비공개 영상일 수 있습니다.` };
  }

  if (!transcript) {
    return { success: false, error: '이 영상의 자막을 가져올 수 없습니다.' };
  }

  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'system',
      content: '당신은 YouTube 영상 요약 전문가입니다. 핵심 내용을 구조화된 형태로 한국어 요약을 제공하세요.',
    }, {
      role: 'user',
      content: `다음 YouTube 영상 자막을 요약해주세요:\n\n${transcript}\n\n다음 형식으로 작성:\n## 핵심 요약\n(2-3줄)\n\n## 주요 내용\n- 포인트1\n- 포인트2\n...\n\n## 결론`,
    }],
    temperature: 0.5,
    max_tokens:  1500,
  });

  return {
    success:    true,
    summary:    resp.choices[0].message.content,
    url,
    charCount:  transcript.length,
  };
}

// ══════════════════════════════════════════════════════════════════
// [2] QR코드 생성
// ══════════════════════════════════════════════════════════════════
async function generateQRCode(text, opts = {}) {
  const QRCode = require('qrcode');
  const {
    size       = 300,
    darkColor  = '#1E3A5F',
    lightColor = '#FFFFFF',
    format     = 'png', // 'png' | 'svg' | 'dataurl'
  } = opts;

  try {
    const qrOpts = {
      width: size,
      margin: 2,
      color: { dark: darkColor, light: lightColor },
      errorCorrectionLevel: 'M',
    };

    if (format === 'svg') {
      const svg = await QRCode.toString(text, { ...qrOpts, type: 'svg' });
      return {
        success: true,
        data:    svg,
        mimeType:'image/svg+xml',
        fileName:`qr_${Date.now()}.svg`,
        text,
      };
    }

    if (format === 'dataurl') {
      const dataUrl = await QRCode.toDataURL(text, qrOpts);
      return { success: true, dataUrl, text };
    }

    // PNG buffer
    const buf = await QRCode.toBuffer(text, { ...qrOpts, type: 'png' });
    return {
      success:  true,
      fileBuf:  buf,
      mimeType: 'image/png',
      fileName: `qr_${Date.now()}.png`,
      dataUrl:  `data:image/png;base64,${buf.toString('base64')}`,
      text,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// [3] 이미지 배경 제거 (remove.bg API 또는 sharp 기반 임계값 처리)
// ══════════════════════════════════════════════════════════════════
async function removeBg(imageSource) {
  // remove.bg API 키가 있으면 사용
  const apiKey = process.env.REMOVE_BG_API_KEY;

  if (apiKey) {
    try {
      const FormData = require('form-data');
      const axios    = require('axios');

      let imageData;
      let isUrl = imageSource.startsWith('http');

      const form = new FormData();
      form.append('size', 'auto');

      if (isUrl) {
        form.append('image_url', imageSource);
      } else {
        // base64 또는 파일 경로
        const buf = Buffer.isBuffer(imageSource)
          ? imageSource
          : fs.existsSync(imageSource)
            ? fs.readFileSync(imageSource)
            : Buffer.from(imageSource.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        form.append('image_file', buf, { filename: 'image.png', contentType: 'image/png' });
      }

      const resp = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
        headers: { ...form.getHeaders(), 'X-Api-Key': apiKey },
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const buf = Buffer.from(resp.data);
      return {
        success:  true,
        fileBuf:  buf,
        mimeType: 'image/png',
        fileName: `nobg_${Date.now()}.png`,
        dataUrl:  `data:image/png;base64,${buf.toString('base64')}`,
        provider: 'remove.bg',
      };
    } catch (err) {
      console.error('[removeBg] remove.bg API 실패:', err.message);
    }
  }

  // Fallback: OpenAI 안내 메시지
  return {
    success: false,
    error: 'REMOVE_BG_API_KEY가 설정되지 않았습니다. remove.bg API 키를 .env에 추가하면 배경 제거 기능을 사용할 수 있습니다.',
    tip:   '무료 API 키: https://www.remove.bg/api',
  };
}

// ══════════════════════════════════════════════════════════════════
// [4] 채팅 대화 PDF 내보내기
// ══════════════════════════════════════════════════════════════════
async function exportChatToPdf(messages = [], title = '대화 내보내기') {
  let marked;
  try { marked = require('marked').marked; } catch (_) { marked = t => t; }

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: 'Malgun Gothic', Arial, sans-serif; padding: 30px 40px; background: #fff; color: #1a1a2e; }
  h1 { font-size: 24px; color: #1e3a5f; border-bottom: 3px solid #4a90d9; padding-bottom: 10px; }
  .meta { color: #6c757d; font-size: 12px; margin-bottom: 24px; }
  .msg { margin: 12px 0; padding: 14px 18px; border-radius: 10px; max-width: 85%; }
  .user { background: #1e3a5f; color: #fff; margin-left: auto; text-align: right; }
  .assistant { background: #f0f7ff; border: 1px solid #bee3f8; }
  .role { font-size: 11px; font-weight: bold; margin-bottom: 6px; opacity: 0.7; }
  .content p { margin: 4px 0; }
  .content code { background: rgba(0,0,0,0.1); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .content pre { background: #1a1a2e; color: #e0e0e0; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 11px; text-align: center; }
</style></head><body>
<h1>💬 ${title}</h1>
<div class="meta">내보낸 날짜: ${new Date().toLocaleString('ko-KR')} | 메시지 수: ${messages.length}개</div>
${messages.map(m => `
<div class="msg ${m.role}">
  <div class="role">${m.role === 'user' ? '👤 사용자' : '🤖 AI'}</div>
  <div class="content">${marked(m.content || '')}</div>
</div>`).join('')}
<div class="footer">AI Orchestrator | ${new Date().toLocaleDateString('ko-KR')}</div>
</body></html>`;

  // puppeteer로 PDF 변환 시도
  try {
    const puppeteer = require('puppeteer-core');
    const chromium  = require('@sparticuz/chromium');
    const tmpFile   = path.join(os.tmpdir(), `chat_${Date.now()}.pdf`);

    const browser = await puppeteer.launch({
      args:            chromium.args,
      executablePath:  await chromium.executablePath(),
      headless:        true,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: tmpFile, format: 'A4', printBackground: true,
                     margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' } });
    await browser.close();

    const buf = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    return { success: true, fileBuf: buf, mimeType: 'application/pdf',
             fileName: `chat_${Date.now()}.pdf` };
  } catch (_) {
    // HTML fallback
    return { success: true, fileBuf: Buffer.from(html), mimeType: 'text/html',
             fileName: `chat_${Date.now()}.html`, fallback: true };
  }
}

// ══════════════════════════════════════════════════════════════════
// [5] 텍스트 → 음성 (TTS) — OpenAI TTS API
// ══════════════════════════════════════════════════════════════════
async function textToSpeech(text, opts = {}) {
  const { voice = 'alloy', speed = 1.0, format = 'mp3' } = opts;
  // voice: alloy | echo | fable | onyx | nova | shimmer

  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const resp = await openai.audio.speech.create({
      model:  'tts-1',
      voice,
      input:  text.slice(0, 4096),
      speed,
      response_format: format,
    });

    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      success:  true,
      fileBuf:  buf,
      mimeType: `audio/${format}`,
      fileName: `tts_${Date.now()}.${format}`,
      dataUrl:  `data:audio/${format};base64,${buf.toString('base64')}`,
      charCount: text.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// [6] AI 색상 팔레트 생성
// ══════════════════════════════════════════════════════════════════
async function generateColorPalette(theme) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'system',
      content: '당신은 UI/UX 디자이너입니다. 색상 팔레트를 JSON 형식으로만 응답하세요.',
    }, {
      role: 'user',
      content: `"${theme}" 테마의 5가지 색상 팔레트를 생성해주세요.
JSON 형식:
{
  "name": "팔레트 이름",
  "description": "설명",
  "colors": [
    { "name": "Primary", "hex": "#1E3A5F", "usage": "주요 버튼, 헤더" },
    { "name": "Secondary", "hex": "#4A90D9", "usage": "링크, 포인트" },
    { "name": "Background", "hex": "#F8F9FA", "usage": "배경" },
    { "name": "Text", "hex": "#1A1A2E", "usage": "본문 텍스트" },
    { "name": "Accent", "hex": "#E94560", "usage": "강조, 알림" }
  ]
}`,
    }],
    temperature: 0.8,
    max_tokens:  600,
  });

  try {
    const jsonStr = resp.choices[0].message.content.replace(/```json?\n?|```/g, '').trim();
    const palette = JSON.parse(jsonStr);
    return { success: true, palette, theme };
  } catch {
    return { success: true, raw: resp.choices[0].message.content, theme };
  }
}

// ══════════════════════════════════════════════════════════════════
// [7] 정규식 생성 및 설명
// ══════════════════════════════════════════════════════════════════
async function generateRegex(description) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'system',
      content: '당신은 정규식 전문가입니다. 요청에 맞는 정규식을 JSON으로 응답하세요.',
    }, {
      role: 'user',
      content: `다음을 처리하는 정규식을 만들어주세요: "${description}"

JSON 형식:
{
  "pattern": "정규식 패턴",
  "flags": "gim 등 플래그",
  "explanation": "패턴 설명",
  "examples": {
    "match": ["매칭 예시1", "매칭 예시2"],
    "no_match": ["비매칭 예시1"]
  },
  "code": {
    "javascript": "const regex = /패턴/flags;",
    "python": "import re\\npattern = re.compile(r'패턴')"
  }
}`,
    }],
    temperature: 0.3,
    max_tokens:  800,
  });

  try {
    const jsonStr = resp.choices[0].message.content.replace(/```json?\n?|```/g, '').trim();
    const result  = JSON.parse(jsonStr);
    return { success: true, ...result, description };
  } catch {
    return { success: true, raw: resp.choices[0].message.content, description };
  }
}

// ══════════════════════════════════════════════════════════════════
// [8] 마크다운 → 이미지 카드 (SVG)
// ══════════════════════════════════════════════════════════════════
async function generateSummaryCard(content, opts = {}) {
  const {
    title      = 'AI 요약',
    theme      = 'blue',
    width      = 800,
    height     = 450,
  } = opts;

  const colors = {
    blue:   { bg: '#1E3A5F', accent: '#4A90D9', text: '#FFFFFF', sub: '#B8D4F0' },
    dark:   { bg: '#1A1A2E', accent: '#E94560', text: '#FFFFFF', sub: '#A8A8B3' },
    green:  { bg: '#1B4332', accent: '#52B788', text: '#FFFFFF', sub: '#B7E4C7' },
  }[theme] || { bg: '#1E3A5F', accent: '#4A90D9', text: '#FFFFFF', sub: '#B8D4F0' };

  // 텍스트 줄 나누기
  const lines = content.replace(/[#*`]/g, '').split('\n')
    .map(l => l.trim()).filter(Boolean).slice(0, 8);

  const svgLines = lines.map((line, i) => {
    const y  = 140 + i * 34;
    const fs = i === 0 ? 20 : 16;
    const fw = i === 0 ? 'bold' : 'normal';
    const fill = i === 0 ? colors.accent : colors.sub;
    const prefix = i > 0 ? '▸ ' : '';
    const text   = (prefix + line).slice(0, 70);
    return `<text x="40" y="${y}" font-size="${fs}" font-weight="${fw}" fill="${fill}">${escXml(text)}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${colors.bg}" rx="16"/>
  <rect width="${width}" height="6" fill="${colors.accent}" rx="3"/>
  <rect y="${height-6}" width="${width}" height="6" fill="${colors.accent}" rx="3"/>
  <text x="40" y="70" font-size="28" font-weight="bold" fill="${colors.text}" font-family="Arial">${escXml(title)}</text>
  <line x1="40" y1="90" x2="${width-40}" y2="90" stroke="${colors.accent}" stroke-width="2"/>
  ${svgLines}
  <text x="${width-20}" y="${height-20}" font-size="11" fill="${colors.sub}" text-anchor="end" font-family="Arial">AI Orchestrator | ${new Date().toLocaleDateString('ko-KR')}</text>
</svg>`;

  return {
    success:  true,
    data:     svg,
    mimeType: 'image/svg+xml',
    fileName: `card_${Date.now()}.svg`,
    dataUrl:  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  };
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ══════════════════════════════════════════════════════════════════
// 통합 라우터
// ══════════════════════════════════════════════════════════════════
async function run(toolName, opts = {}) {
  switch (toolName) {
    case 'youtube':      return summarizeYouTube(opts.url || opts.text);
    case 'qrcode':       return generateQRCode(opts.text || opts.content, opts);
    case 'removebg':     return removeBg(opts.imageUrl || opts.image);
    case 'chat2pdf':     return exportChatToPdf(opts.messages, opts.title);
    case 'tts':          return textToSpeech(opts.text || opts.content, opts);
    case 'palette':      return generateColorPalette(opts.theme || opts.text);
    case 'regex':        return generateRegex(opts.description || opts.text);
    case 'summarycard':  return generateSummaryCard(opts.content || opts.text, opts);
    default:             return { success: false, error: `알 수 없는 툴: ${toolName}` };
  }
}

module.exports = {
  run,
  summarizeYouTube,
  generateQRCode,
  removeBg,
  exportChatToPdf,
  textToSpeech,
  generateColorPalette,
  generateRegex,
  generateSummaryCard,
};
