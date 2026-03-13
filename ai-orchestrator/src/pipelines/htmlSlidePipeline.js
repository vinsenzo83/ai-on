'use strict';
/**
 * htmlSlidePipeline.js
 * AI → 아름다운 HTML 슬라이드 → Puppeteer 캡처 → PPTX
 *
 * 디자인 수준: Gamma.app / Beautiful.ai 급
 *   - 그라데이션 배경
 *   - 카드 레이아웃
 *   - 아이콘 (Unicode 이모지 기반)
 *   - 차트 (SVG 인라인)
 *   - 섹션별 다른 레이아웃 타입
 *   - 반응형 타이포그래피
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const pptx = require('pptxgenjs');

// ── 디자인 테마 ───────────────────────────────────────────────
const DESIGN_THEMES = {
  modern: {
    bg:       'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    card:     'rgba(255,255,255,0.08)',
    accent:   '#7c3aed',
    accent2:  '#06b6d4',
    text:     '#ffffff',
    subtext:  'rgba(255,255,255,0.7)',
    border:   'rgba(124,58,237,0.4)',
    coverBg:  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  },
  corporate: {
    bg:       'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)',
    card:     'rgba(255,255,255,0.06)',
    accent:   '#e94560',
    accent2:  '#0f3460',
    text:     '#ffffff',
    subtext:  'rgba(255,255,255,0.65)',
    border:   'rgba(233,69,96,0.35)',
    coverBg:  'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)',
  },
  nature: {
    bg:       'linear-gradient(135deg, #0d1b2a, #1b4332, #081c15)',
    card:     'rgba(255,255,255,0.07)',
    accent:   '#52b788',
    accent2:  '#74c69d',
    text:     '#ffffff',
    subtext:  'rgba(255,255,255,0.7)',
    border:   'rgba(82,183,136,0.35)',
    coverBg:  'linear-gradient(135deg, #0d1b2a 0%, #1b4332 100%)',
  },
  executive: {
    bg:       'linear-gradient(135deg, #1c1c1e, #2c2c2e, #3a3a3c)',
    card:     'rgba(255,255,255,0.06)',
    accent:   '#ff9f0a',
    accent2:  '#ff6b35',
    text:     '#ffffff',
    subtext:  'rgba(255,255,255,0.65)',
    border:   'rgba(255,159,10,0.35)',
    coverBg:  'linear-gradient(135deg, #1c1c1e 0%, #3a3a3c 100%)',
  },
};

// ── 슬라이드 HTML 생성기 ──────────────────────────────────────
function buildSlideHtml(slide, theme, slideNum, totalSlides) {
  const t = DESIGN_THEMES[theme] || DESIGN_THEMES.modern;

  const baseStyle = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1280px; height: 720px; overflow: hidden;
      font-family: 'Segoe UI', 'Noto Sans KR', Arial, sans-serif;
      background: ${t.bg};
      color: ${t.text};
      position: relative;
    }
    .slide { width: 1280px; height: 720px; position: relative; padding: 48px 60px; display: flex; flex-direction: column; }
    .accent-bar { position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, ${t.accent}, ${t.accent2}); }
    .bottom-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${t.accent2}, ${t.accent}); opacity: 0.5; }
    .slide-num { position: absolute; bottom: 18px; right: 60px; font-size: 12px; color: ${t.subtext}; letter-spacing: 2px; }
    .tag { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; background: ${t.accent}22; color: ${t.accent}; border: 1px solid ${t.border}; margin-bottom: 14px; }
    .title { font-size: 42px; font-weight: 800; line-height: 1.15; margin-bottom: 10px; background: linear-gradient(90deg, ${t.text}, ${t.subtext}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { font-size: 18px; color: ${t.subtext}; margin-bottom: 32px; line-height: 1.5; }
    .card { background: ${t.card}; border: 1px solid ${t.border}; border-radius: 16px; padding: 20px 24px; backdrop-filter: blur(10px); }
    .bullet-list { display: flex; flex-direction: column; gap: 12px; }
    .bullet-item { display: flex; align-items: flex-start; gap: 12px; font-size: 17px; line-height: 1.5; color: ${t.text}; }
    .bullet-dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.accent}; margin-top: 8px; flex-shrink: 0; }
    .highlight-box { background: linear-gradient(135deg, ${t.accent}22, ${t.accent2}11); border-left: 4px solid ${t.accent}; border-radius: 0 12px 12px 0; padding: 16px 20px; margin-top: 20px; font-size: 16px; color: ${t.text}; font-style: italic; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
    .stat-card { background: ${t.card}; border: 1px solid ${t.border}; border-radius: 12px; padding: 20px; text-align: center; }
    .stat-value { font-size: 36px; font-weight: 800; background: linear-gradient(135deg, ${t.accent}, ${t.accent2}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-label { font-size: 13px; color: ${t.subtext}; margin-top: 6px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; }
    .icon { font-size: 28px; margin-bottom: 8px; }
    .divider { height: 1px; background: ${t.border}; margin: 16px 0; }
  `;

  // 슬라이드 타입별 레이아웃
  const { type = 'overview', title, content, bullets = [], stat, highlight } = slide;

  let bodyHtml = '';

  if (type === 'stats' && stat) {
    // 통계 강조 레이아웃
    bodyHtml = `
      <div class="card" style="flex:1; display:flex; flex-direction:column; justify-content:center;">
        <div class="bullet-list">${(bullets || []).slice(0, 4).map(b => `
          <div class="bullet-item">
            <div class="bullet-dot"></div>
            <span>${b}</span>
          </div>`).join('')}
        </div>
        <div class="stat-grid" style="margin-top:24px;">
          <div class="stat-card">
            <div class="stat-value">${stat.value || '—'}</div>
            <div class="stat-label">${stat.label || ''}</div>
          </div>
          <div class="stat-card">
            <div style="font-size:40px; margin-bottom:4px;">${stat.trend === 'up' ? '📈' : stat.trend === 'down' ? '📉' : '📊'}</div>
            <div class="stat-label">트렌드</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="font-size:24px;">${stat.trend === 'up' ? '↑ 성장' : stat.trend === 'down' ? '↓ 감소' : '→ 유지'}</div>
            <div class="stat-label">방향</div>
          </div>
        </div>
      </div>`;
  } else if (type === 'comparison') {
    // 2단 비교 레이아웃
    const half = Math.ceil((bullets || []).length / 2);
    const left = (bullets || []).slice(0, half);
    const right = (bullets || []).slice(half);
    bodyHtml = `
      <div class="two-col" style="flex:1;">
        <div class="card">
          <div style="font-size:14px; font-weight:700; color:${t.accent}; margin-bottom:14px; letter-spacing:1px;">▶ 핵심 강점</div>
          <div class="bullet-list">${left.map(b => `
            <div class="bullet-item"><div class="bullet-dot"></div><span>${b}</span></div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div style="font-size:14px; font-weight:700; color:${t.accent2}; margin-bottom:14px; letter-spacing:1px;">▶ 주요 과제</div>
          <div class="bullet-list">${right.map(b => `
            <div class="bullet-item"><div class="bullet-dot" style="background:${t.accent2}"></div><span>${b}</span></div>`).join('')}
          </div>
        </div>
      </div>`;
  } else if (type === 'conclusion') {
    // 결론 강조 레이아웃
    bodyHtml = `
      <div class="card" style="flex:1; display:flex; flex-direction:column; justify-content:center; text-align:center; align-items:center;">
        <div style="font-size:60px; margin-bottom:20px;">💡</div>
        <div style="font-size:22px; font-weight:700; color:${t.text}; line-height:1.6; max-width:800px;">${content || ''}</div>
        ${highlight ? `<div style="margin-top:28px; padding:14px 28px; background:${t.accent}22; border:1px solid ${t.border}; border-radius:50px; font-size:16px; color:${t.accent}; font-weight:600;">${highlight}</div>` : ''}
      </div>`;
  } else {
    // 기본 overview/insight 레이아웃
    bodyHtml = `
      <div class="card" style="flex:1; overflow:hidden;">
        ${content ? `<div style="font-size:16px; color:${t.subtext}; line-height:1.7; margin-bottom:18px;">${content}</div>` : ''}
        ${content && bullets?.length ? '<div class="divider"></div>' : ''}
        <div class="bullet-list">${(bullets || []).slice(0, 5).map(b => `
          <div class="bullet-item">
            <div class="bullet-dot"></div>
            <span>${b}</span>
          </div>`).join('')}
        </div>
        ${highlight ? `<div class="highlight-box">${highlight}</div>` : ''}
      </div>`;
  }

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>${baseStyle}</style>
</head><body>
<div class="slide">
  <div class="accent-bar"></div>
  <div class="tag">${String(slideNum).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}</div>
  <div class="title">${title || ''}</div>
  ${bodyHtml}
  <div class="bottom-bar"></div>
  <div class="slide-num">${slideNum} · ${totalSlides}</div>
</div>
</body></html>`;
}

// ── 표지 슬라이드 HTML ────────────────────────────────────────
function buildCoverHtml(data, theme) {
  const t = DESIGN_THEMES[theme] || DESIGN_THEMES.modern;
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1280px; height:720px; overflow:hidden; font-family:'Segoe UI','Noto Sans KR',Arial,sans-serif; background:${t.coverBg}; color:${t.text}; }
  .cover { width:1280px; height:720px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:60px 80px; position:relative; }
  .bg-circle1 { position:absolute; width:600px; height:600px; border-radius:50%; background:${t.accent}18; top:-100px; right:-100px; }
  .bg-circle2 { position:absolute; width:400px; height:400px; border-radius:50%; background:${t.accent2}12; bottom:-80px; left:-60px; }
  .eyebrow { font-size:13px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:${t.accent}; margin-bottom:24px; }
  .main-title { font-size:56px; font-weight:900; line-height:1.15; background:linear-gradient(135deg, #ffffff, ${t.accent}, ${t.accent2}); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:20px; max-width:900px; }
  .sub-title { font-size:20px; color:rgba(255,255,255,0.65); margin-bottom:48px; max-width:700px; line-height:1.6; }
  .divider-line { width:80px; height:3px; background:linear-gradient(90deg,${t.accent},${t.accent2}); border-radius:2px; margin:0 auto 32px; }
  .meta { display:flex; gap:40px; align-items:center; }
  .meta-item { font-size:13px; color:rgba(255,255,255,0.5); letter-spacing:1px; }
  .meta-sep { width:4px; height:4px; border-radius:50%; background:${t.accent}; }
  .bar-top { position:absolute; top:0; left:0; right:0; height:5px; background:linear-gradient(90deg,${t.accent},${t.accent2}); }
</style>
</head><body>
<div class="cover">
  <div class="bg-circle1"></div>
  <div class="bg-circle2"></div>
  <div class="bar-top"></div>
  <div class="eyebrow">AI Research Report</div>
  <div class="main-title">${data.title || '리서치 리포트'}</div>
  <div class="divider-line"></div>
  <div class="sub-title">${data.subtitle || data.keyMessage || ''}</div>
  <div class="meta">
    <div class="meta-item">${today}</div>
    <div class="meta-sep"></div>
    <div class="meta-item">AI Generated</div>
    <div class="meta-sep"></div>
    <div class="meta-item">${data.dataSource || 'Web Research'}</div>
  </div>
</div>
</body></html>`;
}

// ── 마지막 슬라이드 HTML ─────────────────────────────────────
function buildEndHtml(data, theme) {
  const t = DESIGN_THEMES[theme] || DESIGN_THEMES.modern;
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1280px; height:720px; overflow:hidden; font-family:'Segoe UI','Noto Sans KR',Arial,sans-serif; background:${t.coverBg}; color:${t.text}; }
  .end { width:1280px; height:720px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; position:relative; }
  .bg-circle { position:absolute; width:500px; height:500px; border-radius:50%; background:${t.accent}15; }
  .conclusion-box { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:20px; padding:40px 60px; max-width:800px; margin-bottom:40px; }
  .conclusion-text { font-size:19px; color:rgba(255,255,255,0.8); line-height:1.7; }
  .thanks { font-size:64px; font-weight:900; background:linear-gradient(135deg, #ffffff, ${t.accent}, ${t.accent2}); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:16px; }
  .bar { position:absolute; bottom:0; left:0; right:0; height:4px; background:linear-gradient(90deg,${t.accent},${t.accent2}); }
</style>
</head><body>
<div class="end">
  <div class="bg-circle"></div>
  <div class="thanks">감사합니다</div>
  ${data.conclusion ? `<div class="conclusion-box"><div class="conclusion-text">${data.conclusion}</div></div>` : ''}
  <div style="font-size:14px; color:rgba(255,255,255,0.35); letter-spacing:2px;">AI RESEARCH · GENERATED REPORT</div>
  <div class="bar"></div>
</div>
</body></html>`;
}

// ── Puppeteer로 HTML → 이미지 캡처 ───────────────────────────
async function captureSlides(htmlPages) {
  let browser = null;
  const images = [];

  // Chromium 경로 탐색
  const chromiumPaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];

  let executablePath = null;
  for (const p of chromiumPaths) {
    try {
      if (require('fs').existsSync(p)) { executablePath = p; break; }
    } catch {}
  }

  if (!executablePath) {
    console.warn('[htmlSlidePipeline] Chromium 없음 → PNG 스킵, HTML만 반환');
    return null;
  }

  try {
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });

    for (let i = 0; i < htmlPages.length; i++) {
      await page.setContent(htmlPages[i], { waitUntil: 'networkidle0', timeout: 10000 });
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      images.push(buf);
      console.log(`[htmlSlidePipeline] 캡처 ${i + 1}/${htmlPages.length}`);
    }
  } catch (e) {
    console.error('[htmlSlidePipeline] Puppeteer 에러:', e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return images.length > 0 ? images : null;
}

// ── 이미지 배열 → PPTX ───────────────────────────────────────
async function imagesToPptx(images, topic) {
  const prs = new pptx();
  prs.defineLayout({ name: 'WIDESCREEN', width: 13.33, height: 7.5 });
  prs.layout = 'WIDESCREEN';
  prs.title  = topic;

  for (const imgBuf of images) {
    const slide = prs.addSlide();
    slide.addImage({
      data:   'image/png;base64,' + imgBuf.toString('base64'),
      x: 0, y: 0, w: 13.33, h: 7.5,
    });
  }

  const tmpFile = path.join(os.tmpdir(), `html_ppt_${Date.now()}.pptx`);
  await prs.writeFile({ fileName: tmpFile });
  const buf = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return buf;
}

// ── HTML 저장 (Puppeteer 없을 때 fallback) ───────────────────
function saveHtmlFiles(htmlPages, topic) {
  const tmpDir = path.join(os.tmpdir(), `slides_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  htmlPages.forEach((html, i) => {
    fs.writeFileSync(path.join(tmpDir, `slide_${i + 1}.html`), html, 'utf8');
  });
  return tmpDir;
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function run(opts = {}) {
  const {
    structured,   // researchPipeline의 결과
    topic  = '',
    theme  = 'modern',
    usePuppeteer = true,
  } = opts;

  if (!structured?.sections?.length) {
    throw new Error('structured 데이터가 없습니다. researchPipeline을 먼저 실행하세요.');
  }

  const data = structured;
  const totalSlides = data.sections.length + 2; // 표지 + 섹션들 + 마지막
  console.log(`[htmlSlidePipeline] HTML 슬라이드 ${totalSlides}장 생성 시작`);

  // HTML 페이지 생성
  const htmlPages = [
    buildCoverHtml(data, theme),
    ...data.sections.map((sec, i) => buildSlideHtml(sec, theme, i + 1, data.sections.length)),
    buildEndHtml(data, theme),
  ];

  // Puppeteer 캡처 시도
  let pptxBuf = null;
  let method  = 'html_only';

  if (usePuppeteer) {
    const images = await captureSlides(htmlPages);
    if (images) {
      pptxBuf = await imagesToPptx(images, topic || data.title);
      method  = 'puppeteer_pptx';
      console.log(`[htmlSlidePipeline] ✅ PPTX 생성 완료 (Puppeteer) ${pptxBuf.length} bytes`);
    }
  }

  // fallback: pptxgenjs 기반 텍스트 PPTX (기존 방식)
  if (!pptxBuf) {
    console.log('[htmlSlidePipeline] Puppeteer 스킵 → pptxgenjs fallback');
    const { buildPptx, parseSlides } = require('./pptPipeline');

    // structured → 텍스트 형식으로 변환
    const slideText = data.sections.map((sec, i) =>
      `## 슬라이드 ${i + 1}: ${sec.title}\n${(sec.bullets || []).map(b => `- ${b}`).join('\n')}`
    ).join('\n\n');

    const slides = parseSlides(slideText);
    const tmpFile = await buildPptx(topic || data.title, slides, 'dark');
    pptxBuf = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    method = 'pptxgenjs_fallback';
  }

  const fileName = `${(topic || data.title || 'report').replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${Date.now()}.pptx`;

  return {
    success:     true,
    fileBuf:     pptxBuf,
    fileName,
    slideCount:  totalSlides,
    method,
    htmlPages,   // 미리보기용
    topic:       topic || data.title,
    structured:  data,
  };
}

module.exports = { run, buildCoverHtml, buildSlideHtml, buildEndHtml, captureSlides, DESIGN_THEMES };
