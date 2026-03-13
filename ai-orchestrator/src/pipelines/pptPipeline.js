'use strict';
/**
 * PPT Pipeline — AI가 슬라이드 구조를 생성하고 pptxgenjs로 .pptx 파일 출력
 */
const pptx = require('pptxgenjs');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── 테마 색상 ────────────────────────────────────────────────
const THEMES = {
  blue:   { bg: '1E3A5F', accent: '4A90D9', text: 'FFFFFF', sub: 'B8D4F0' },
  dark:   { bg: '1A1A2E', accent: 'E94560', text: 'FFFFFF', sub: 'A8A8B3' },
  green:  { bg: '1B4332', accent: '52B788', text: 'FFFFFF', sub: 'B7E4C7' },
  white:  { bg: 'FFFFFF', accent: '2D6A4F', text: '1A1A2E', sub: '495057' },
  purple: { bg: '240046', accent: 'C77DFF', text: 'FFFFFF', sub: 'E0AAFF' },
};

/**
 * AI 응답 텍스트를 슬라이드 배열로 파싱
 * 입력 형식:
 *   ## 슬라이드 1: 제목
 *   - 내용1
 *   - 내용2
 */
function parseSlides(text) {
  const slides = [];
  const blocks = text.split(/(?=##\s*슬라이드\s*\d+|##\s*Slide\s*\d+)/i).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n').filter(l => l.trim());
    if (!lines.length) continue;

    // 제목 라인 추출
    const titleLine = lines[0].replace(/^#+\s*(슬라이드|Slide)\s*\d+\s*[:\-]?\s*/i, '').trim();
    const bullets   = [];
    let   note      = '';

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith('---') || l.startsWith('===')) continue;
      if (l.toLowerCase().startsWith('note:') || l.toLowerCase().startsWith('노트:')) {
        note = l.replace(/^(note|노트):\s*/i, '');
      } else if (l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• ')) {
        bullets.push(l.replace(/^[-*•]\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1'));
      } else if (l.match(/^\d+\.\s/)) {
        bullets.push(l.replace(/^\d+\.\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1'));
      } else if (l && !l.startsWith('#')) {
        // 일반 텍스트도 bullet으로
        bullets.push(l.replace(/\*\*(.*?)\*\*/g, '$1'));
      }
    }
    slides.push({ title: titleLine, bullets, note });
  }

  // 파싱 실패 시 fallback
  if (!slides.length) {
    slides.push({ title: '프레젠테이션', bullets: [text.slice(0, 200)], note: '' });
  }
  return slides;
}

/**
 * pptxgenjs로 .pptx 파일 생성
 */
async function buildPptx(topic, slides, theme = 'blue') {
  const t   = THEMES[theme] || THEMES.blue;
  const prs = new pptx();

  // 문서 메타
  prs.author  = 'AI Orchestrator';
  prs.company = 'AI Platform';
  prs.subject = topic;
  prs.title   = topic;

  // 슬라이드 마스터 레이아웃
  prs.defineLayout({ name: 'LAYOUT_WIDE', width: 13.33, height: 7.5 });
  prs.layout = 'LAYOUT_WIDE';

  // ── 표지 슬라이드 ───────────────────────────────────────────
  const cover = prs.addSlide();
  cover.background = { color: t.bg };

  // 상단 장식 바
  cover.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: t.accent }, line: { color: t.accent },
  });

  // 메인 제목
  cover.addText(topic, {
    x: 0.8, y: 2.2, w: 11.7, h: 1.8,
    fontSize: 40, bold: true, color: t.text,
    fontFace: 'Arial', align: 'center', valign: 'middle',
    wrap: true,
  });

  // 부제
  cover.addText('AI 생성 프레젠테이션', {
    x: 0.8, y: 4.2, w: 11.7, h: 0.6,
    fontSize: 18, color: t.sub, fontFace: 'Arial', align: 'center',
  });

  // 날짜
  const today = new Date().toLocaleDateString('ko-KR');
  cover.addText(today, {
    x: 0.8, y: 6.6, w: 11.7, h: 0.4,
    fontSize: 13, color: t.sub, fontFace: 'Arial', align: 'center',
  });

  // 하단 장식 바
  cover.addShape(prs.ShapeType.rect, {
    x: 0, y: 7.35, w: 13.33, h: 0.15, fill: { color: t.accent }, line: { color: t.accent },
  });

  // ── 콘텐츠 슬라이드 ─────────────────────────────────────────
  slides.forEach((slide, idx) => {
    const s = prs.addSlide();
    s.background = { color: t.bg };

    // 상단 색상 바
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: t.accent }, line: { color: t.accent },
    });

    // 슬라이드 번호 배지
    s.addShape(prs.ShapeType.rect, {
      x: 0.5, y: 0.25, w: 0.55, h: 0.55,
      fill: { color: t.accent }, line: { color: t.accent }, rounding: true,
    });
    s.addText(String(idx + 1), {
      x: 0.5, y: 0.25, w: 0.55, h: 0.55,
      fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
    });

    // 제목
    s.addText(slide.title, {
      x: 1.2, y: 0.22, w: 11.5, h: 0.65,
      fontSize: 26, bold: true, color: t.text, fontFace: 'Arial',
      valign: 'middle',
    });

    // 구분선
    s.addShape(prs.ShapeType.line, {
      x: 0.5, y: 1.05, w: 12.33, h: 0,
      line: { color: t.accent, width: 1.5 },
    });

    // 불릿 포인트
    const bulletRows = slide.bullets.slice(0, 8);
    if (bulletRows.length) {
      const bulletObjs = bulletRows.map(b => ({
        text: b,
        options: { bullet: { type: 'bullet', characterCode: '25B6', color: t.accent }, indentLevel: 0 },
      }));
      s.addText(bulletObjs, {
        x: 0.6, y: 1.25, w: 12.1, h: 5.8,
        fontSize: 18, color: t.text, fontFace: 'Arial',
        valign: 'top', lineSpacingMultiple: 1.4,
        wrap: true,
      });
    }

    // 슬라이드 노트
    if (slide.note) s.addNotes(slide.note);

    // 하단 바
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 7.35, w: 13.33, h: 0.15, fill: { color: t.accent }, line: { color: t.accent },
    });
    s.addText(`${idx + 1} / ${slides.length}`, {
      x: 11.8, y: 7.1, w: 1.3, h: 0.3,
      fontSize: 11, color: t.sub, align: 'right',
    });
  });

  // ── 마지막 감사 슬라이드 ────────────────────────────────────
  const end = prs.addSlide();
  end.background = { color: t.bg };
  end.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: t.accent }, line: { color: t.accent },
  });
  end.addText('감사합니다', {
    x: 0.8, y: 2.8, w: 11.7, h: 1.2,
    fontSize: 48, bold: true, color: t.text, align: 'center', valign: 'middle',
  });
  end.addText('Thank You', {
    x: 0.8, y: 4.3, w: 11.7, h: 0.7,
    fontSize: 24, color: t.sub, align: 'center',
  });

  // 임시 파일로 저장
  const tmpDir  = os.tmpdir();
  const outFile = path.join(tmpDir, `ppt_${Date.now()}.pptx`);
  await prs.writeFile({ fileName: outFile });
  return outFile;
}

/**
 * 메인 실행 함수 — AI로 슬라이드 내용 생성 후 .pptx 빌드
 */
async function run(opts = {}) {
  const { topic = '프레젠테이션', slideCount = 8, theme = 'blue', aiContent = null } = opts;

  let slideText = aiContent;

  // AI 콘텐츠가 없으면 OpenAI로 생성
  if (!slideText) {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `당신은 전문 프레젠테이션 디자이너입니다. 
다음 형식으로 정확히 ${slideCount}개의 슬라이드를 한국어로 작성하세요:

## 슬라이드 1: [제목]
- [핵심 내용 1]
- [핵심 내용 2]
- [핵심 내용 3]

## 슬라이드 2: [제목]
- [핵심 내용 1]
...

각 슬라이드는 3~5개의 간결한 불릿 포인트를 포함하세요. 마크다운 볼드(**) 사용 가능.`,
      }, {
        role: 'user',
        content: `주제: "${topic}"에 대한 ${slideCount}장 프레젠테이션을 만들어주세요.`,
      }],
      temperature: 0.7,
      max_tokens: 3000,
    });
    slideText = resp.choices[0].message.content;
  }

  const slides  = parseSlides(slideText);
  const outFile = await buildPptx(topic, slides, theme);
  const buf     = fs.readFileSync(outFile);
  fs.unlinkSync(outFile);

  return {
    success:    true,
    fileBuf:    buf,
    fileName:   `${topic.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${Date.now()}.pptx`,
    slideCount: slides.length,
    slides,
    topic,
  };
}

module.exports = { run, buildPptx, parseSlides };
