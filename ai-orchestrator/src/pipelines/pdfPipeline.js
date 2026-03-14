'use strict';
/**
 * PDF Pipeline — HTML/Markdown 콘텐츠를 PDF로 변환
 * puppeteer-core + @sparticuz/chromium 사용 (VPS 경량화)
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// marked: markdown → HTML
let marked;
try { marked = require('marked').marked; } catch (_) { marked = t => `<pre>${t}</pre>`; }

/**
 * Markdown 또는 HTML 텍스트를 완전한 HTML 문서로 변환
 */
function wrapHtml(content, title = 'AI 문서', isMarkdown = true) {
  const body = isMarkdown ? marked(content) : content;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', Arial, sans-serif;
    font-size: 14px; line-height: 1.8; color: #1a1a2e;
    padding: 40px 50px; background: #fff;
  }
  h1 { font-size: 28px; color: #1e3a5f; border-bottom: 3px solid #4a90d9; padding-bottom: 12px; margin: 24px 0 16px; }
  h2 { font-size: 22px; color: #1e3a5f; border-left: 4px solid #4a90d9; padding-left: 12px; margin: 20px 0 12px; }
  h3 { font-size: 18px; color: #2d6a4f; margin: 16px 0 10px; }
  p  { margin: 10px 0; }
  ul, ol { margin: 10px 0 10px 24px; }
  li { margin: 6px 0; }
  code { background: #f0f4ff; border-radius: 4px; padding: 2px 6px; font-size: 13px; font-family: monospace; }
  pre  { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 16px 0; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { border-left: 4px solid #4a90d9; padding: 10px 16px; background: #f0f7ff; margin: 16px 0; color: #495057; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #1e3a5f; color: white; padding: 10px 14px; text-align: left; }
  td { padding: 9px 14px; border-bottom: 1px solid #dee2e6; }
  tr:nth-child(even) td { background: #f8f9fa; }
  strong { color: #1e3a5f; }
  .header { border-bottom: 2px solid #4a90d9; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { border: none; margin: 0; font-size: 32px; }
  .header .meta { color: #6c757d; font-size: 13px; margin-top: 8px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px; text-align: center; }
  @media print { body { padding: 20px 30px; } }
</style>
</head>
<body>
<div class="header">
  <h1>${title}</h1>
  <div class="meta">생성일: ${new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' })} | AI Orchestrator</div>
</div>
${body}
<div class="footer">AI Orchestrator 자동 생성 문서 | ${new Date().toLocaleDateString('ko-KR')}</div>
</body>
</html>`;
}

/**
 * puppeteer-core로 HTML → PDF 변환
 */
async function htmlToPdf(html, outFile) {
  let browser;
  try {
    const puppeteer  = require('puppeteer-core');
    const chromium   = require('@sparticuz/chromium');

    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  await chromium.executablePath(),
      headless:        true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path:   outFile,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });
    return true;
  } catch (err) {
    // puppeteer 실패 시 HTML 파일 자체를 base64로 인코딩해 반환
    console.error('[pdfPipeline] puppeteer 실패, HTML fallback:', err.message);
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * 메인 실행 함수
 */
async function run(opts = {}) {
  const { content, title = 'AI 문서', topic, isMarkdown = true, aiGenerate = false } = opts;

  let docContent = content;

  // AI로 문서 생성
  if (aiGenerate || !docContent) {
    const subject = topic || title;
    const OpenAI  = require('openai');
    const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: '당신은 전문 문서 작성자입니다. Markdown 형식으로 구조화된 문서를 작성하세요. 제목(##), 소제목(###), 불릿(-)을 활용하세요.',
      }, {
        role: 'user',
        content: `"${subject}"에 대한 상세한 보고서/문서를 작성해주세요.`,
      }],
      temperature: 0.7,
      max_tokens:  3000,
    });
    docContent = resp.choices[0].message.content;
  }

  const html    = wrapHtml(docContent, title, isMarkdown);
  const tmpDir  = os.tmpdir();
  const outFile = path.join(tmpDir, `pdf_${Date.now()}.pdf`);
  const htmlFile = outFile.replace('.pdf', '.html');

  // HTML 파일 저장 (fallback용)
  fs.writeFileSync(htmlFile, html, 'utf8');

  const pdfOk = await htmlToPdf(html, outFile);

  if (pdfOk && fs.existsSync(outFile)) {
    const buf = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);
    fs.unlinkSync(htmlFile);
    return {
      success:  true,
      fileBuf:  buf,
      fileName: `${(title).replace(/[^a-zA-Z0-9가-힣]/g,'_')}_${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      content:  docContent,
    };
  }

  // fallback: HTML 반환
  const htmlBuf = fs.readFileSync(htmlFile);
  fs.unlinkSync(htmlFile);
  return {
    success:  true,
    fileBuf:  htmlBuf,
    fileName: `${(title).replace(/[^a-zA-Z0-9가-힣]/g,'_')}_${Date.now()}.html`,
    mimeType: 'text/html',
    content:  docContent,
    fallback: true,
  };
}

module.exports = { run, wrapHtml };
