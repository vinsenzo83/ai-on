'use strict';
// ============================================================
// toolRoutes.js — /api/tools/* 엔드포인트
// server.js에서 분리
// ============================================================

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function _sendFile(res, result, fallbackMsg = '생성 완료') {
  if (!result.success) return res.status(500).json({ success: false, error: result.error });
  if (result.fileBuf) {
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    return res.send(result.fileBuf);
  }
  return res.json({ success: true, ...result, message: fallbackMsg });
}

module.exports = function registerToolRoutes(app, { pptPipeline, pdfPipeline, excelPipeline, researchPipeline, htmlSlidePipeline, extraTools }) {

  app.post('/api/tools/ppt', async (req, res) => {
    try { _sendFile(res, await pptPipeline.run(req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── research_ppt: URL/주제 리서치 → 고품질 HTML 슬라이드 PPT ──────────
  app.post('/api/tools/research-ppt', async (req, res) => {
    try {
      const { topic = '', url = null, theme = 'modern' } = req.body;
      const researchResult = await researchPipeline.run({ topic, url, query: topic, outputType: 'ppt' });
      if (!researchResult?.success) throw new Error('리서치 실패');
      const result = await htmlSlidePipeline.run({ structured: researchResult.structured, topic, theme, usePuppeteer: true });
      _sendFile(res, result);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/pdf', async (req, res) => {
    try { _sendFile(res, await pdfPipeline.run(req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/excel', async (req, res) => {
    try { _sendFile(res, await excelPipeline.run(req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/youtube', async (req, res) => {
    try { res.json(await extraTools.run('youtube', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/qrcode', async (req, res) => {
    try { _sendFile(res, await extraTools.run('qrcode', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/removebg', async (req, res) => {
    try {
      const r = await extraTools.run('removebg', req.body);
      if (r.fileBuf) _sendFile(res, r); else res.json(r);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/tts', async (req, res) => {
    try { _sendFile(res, await extraTools.run('tts', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/palette', async (req, res) => {
    try { res.json(await extraTools.run('palette', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/regex', async (req, res) => {
    try { res.json(await extraTools.run('regex', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/summarycard', async (req, res) => {
    try { res.json(await extraTools.run('summarycard', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/chat2pdf', async (req, res) => {
    try { _sendFile(res, await extraTools.run('chat2pdf', req.body)); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/analyze-image', upload.single('image'), async (req, res) => {
    try {
      if (!req.file && !req.body.imageUrl)
        return res.status(400).json({ success: false, error: '이미지 파일 또는 imageUrl 필요' });
      const question = req.body.question || '이 이미지를 자세히 설명해주세요.';
      let imageUrl = req.body.imageUrl;
      if (req.file) {
        imageUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${req.file.buffer.toString('base64')}`;
      }
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp   = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: question }
        ]}],
        max_tokens: 1000,
      });
      res.json({ success: true, analysis: resp.choices[0]?.message?.content || '분석 실패' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/tools/stt', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: '오디오 파일 필요' });
      const OpenAI    = require('openai');
      const { Readable } = require('stream');
      const client    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const stream    = Readable.from(req.file.buffer);
      stream.path     = req.file.originalname || 'audio.mp3';
      const t = await client.audio.transcriptions.create({
        file: stream, model: 'whisper-1', response_format: 'verbose_json',
      });
      res.json({ success: true, text: t.text, language: t.language,
        duration: t.duration, segments: t.segments?.length || 0 });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/tools/list', (_req, res) => {
    res.json({ success: true, tools: [
      { id: 'ppt',           name: 'PPT 생성',      icon: '📊', endpoint: 'POST /api/tools/ppt' },
      { id: 'pdf',           name: 'PDF 생성',      icon: '📄', endpoint: 'POST /api/tools/pdf' },
      { id: 'excel',         name: 'Excel 생성',    icon: '📈', endpoint: 'POST /api/tools/excel' },
      { id: 'youtube',       name: 'YouTube 요약',  icon: '🎬', endpoint: 'POST /api/tools/youtube' },
      { id: 'qrcode',        name: 'QR코드',        icon: '📱', endpoint: 'POST /api/tools/qrcode' },
      { id: 'removebg',      name: '배경 제거',     icon: '✂️', endpoint: 'POST /api/tools/removebg' },
      { id: 'tts',           name: 'TTS',           icon: '🔊', endpoint: 'POST /api/tools/tts' },
      { id: 'palette',       name: '색상 팔레트',   icon: '🎨', endpoint: 'POST /api/tools/palette' },
      { id: 'regex',         name: '정규식 생성',   icon: '🔍', endpoint: 'POST /api/tools/regex' },
      { id: 'summarycard',   name: '요약 카드',     icon: '🃏', endpoint: 'POST /api/tools/summarycard' },
      { id: 'chat2pdf',      name: '대화 PDF',      icon: '💾', endpoint: 'POST /api/tools/chat2pdf' },
      { id: 'analyze-image', name: '이미지 분석',   icon: '🖼️', endpoint: 'POST /api/tools/analyze-image' },
      { id: 'stt',           name: '음성 인식',     icon: '🎤', endpoint: 'POST /api/tools/stt' },
    ]});
  });
};
