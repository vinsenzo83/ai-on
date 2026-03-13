// ============================================================
// API 어댑터 모듈 v1
// 테스트케이스 1005개 분석 기반 - TOP 10 우선 통합 API
// ============================================================
// 우선순위 통합:
// 1. Whisper STT      - 45건 케이스 커버
// 2. GPT-4V Vision    - 34건 케이스 커버
// 3. Image Generation - 76건 케이스 커버
// 4. Puppeteer Crawler - 45건 케이스 커버
// 5. PDF Parser       - RAG 기반 문서 처리
// 6. SMS API          - 26건 케이스 커버
// 7. Email API        - 30건 케이스 커버
// 8. GitHub API       - 24건 케이스 커버
// 9. ElevenLabs TTS   - TTS/성우 생성
// 10. CRM API         - 21건 케이스 커버
// ============================================================

const API_ADAPTERS = {

  // ──────────────────────────────────────────────────────────
  // 1. Whisper STT (음성 → 텍스트)
  // ──────────────────────────────────────────────────────────
  WHISPER_STT: {
    name: 'Whisper STT',
    icon: '🎤',
    category: 'audio',
    description: '음성 파일을 텍스트로 변환. 화자 분리, 타임스탬프 지원',
    cases_affected: 45,
    endpoints: {
      transcribe: 'POST /v1/audio/transcriptions',
      translate: 'POST /v1/audio/translations',
    },
    supported_formats: ['mp3', 'mp4', 'wav', 'm4a', 'webm', 'ogg'],
    max_file_size_mb: 25,
    languages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'],
    implementation_status: 'ready_to_integrate',
    difficulty: 'easy',
    monthly_cost_est: '$0.006/분',
    integration_code: `
// Whisper STT 통합 예시
async function transcribeAudio(client, audioBuffer, language = 'ko') {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.mp3' });
  formData.append('model', 'whisper-1');
  formData.append('language', language);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  
  const response = await client.audio.transcriptions.create({
    file: audioBuffer,
    model: 'whisper-1',
    language,
    response_format: 'verbose_json'
  });
  
  return {
    text: response.text,
    segments: response.segments,
    language: response.language,
    duration: response.duration
  };
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 2. GPT-4V Vision (이미지 이해)
  // ──────────────────────────────────────────────────────────
  GPT4V_VISION: {
    name: 'GPT-4V Vision',
    icon: '👁️',
    category: 'vision',
    description: '이미지 내용 분석, OCR, 도면 해석, UI 스크린샷 분석',
    cases_affected: 34,
    supported_formats: ['jpg', 'png', 'gif', 'webp'],
    max_image_size_mb: 20,
    implementation_status: 'ready_to_integrate',
    difficulty: 'easy',
    monthly_cost_est: '$0.00255/이미지 (1K tokens)',
    integration_code: `
// GPT-4V Vision 통합 예시
async function analyzeImage(client, imageUrl, instruction) {
  const response = await client.chat.completions.create({
    model: 'gpt-5.2',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        { type: 'text', text: instruction }
      ]
    }],
    max_tokens: 4000
  });
  return response.choices[0].message.content;
}

// 명함 OCR 예시
async function extractBusinessCard(client, imageUrl) {
  return analyzeImage(client, imageUrl, 
    '이 명함에서 이름, 직책, 회사, 이메일, 전화번호, 주소를 JSON으로 추출해줘');
}

// 화면 코드 변환 예시
async function screenToCode(client, imageUrl, framework = 'React') {
  return analyzeImage(client, imageUrl,
    \`이 UI 화면을 \${framework}/Tailwind CSS 코드로 변환해줘. 완전한 컴포넌트 코드를 작성해줘.\`);
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 3. Image Generation (AI 이미지 생성)
  // ──────────────────────────────────────────────────────────
  IMAGE_GENERATION: {
    name: 'Nano Banana Pro (Image Gen)',
    icon: '🎨',
    category: 'image',
    description: 'AI 이미지 생성 - 일러스트, 배너, 로고, 상품 이미지',
    cases_affected: 76,
    supported_sizes: ['1024x1024', '1792x1024', '1024x1792'],
    supported_styles: ['vivid', 'natural'],
    implementation_status: 'model_exists_needs_pipeline',
    difficulty: 'medium',
    monthly_cost_est: '$0.04~0.12/이미지',
    integration_code: `
// Image Generation 통합 예시 (DALL-E 3 호환)
async function generateImage(client, prompt, options = {}) {
  const { size = '1024x1024', style = 'vivid', n = 1 } = options;
  
  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    n,
    size,
    style,
    response_format: 'url'
  });
  
  return response.data.map(img => ({
    url: img.url,
    revised_prompt: img.revised_prompt
  }));
}

// 배너 생성 예시
async function generateBanner(client, productName, style, targetAudience) {
  const prompt = \`프로페셔널 마케팅 배너: \${productName}, 스타일: \${style}, 
    대상: \${targetAudience}, 고해상도, 텍스트 없음, 상업용 사진 품질\`;
  return generateImage(client, prompt, { size: '1792x1024' });
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 4. Puppeteer Web Crawler (웹 크롤링)
  // ──────────────────────────────────────────────────────────
  PUPPETEER_CRAWLER: {
    name: 'Puppeteer Web Crawler',
    icon: '🕷️',
    category: 'web',
    description: '동적 웹 스크래핑, JS 렌더링 지원, 스크린샷, PDF 생성',
    cases_affected: 45,
    implementation_status: 'needs_server_installation',
    difficulty: 'easy',
    monthly_cost_est: '무료 (서버 비용만)',
    integration_code: `
// Puppeteer 크롤러 통합 예시
const puppeteer = require('puppeteer');

async function crawlPage(url, options = {}) {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // 봇 탐지 우회
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // 데이터 추출
  const data = await page.evaluate(() => ({
    title: document.title,
    content: document.body.innerText,
    links: [...document.querySelectorAll('a')].map(a => a.href),
    images: [...document.querySelectorAll('img')].map(img => img.src),
  }));
  
  await browser.close();
  return data;
}

// 가격 모니터링 예시
async function extractPrice(url, priceSelector) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  const price = await page.$eval(priceSelector, el => el.textContent.trim());
  await browser.close();
  return price;
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 5. PDF Parser + RAG (문서 처리)
  // ──────────────────────────────────────────────────────────
  PDF_RAG: {
    name: 'PDF Parser + RAG',
    icon: '📑',
    category: 'document',
    description: 'PDF 파싱, 청크 분할, 벡터 임베딩, 시맨틱 검색',
    cases_affected: 40,
    implementation_status: 'needs_vector_db',
    difficulty: 'medium',
    monthly_cost_est: '$0.0001/1K tokens (임베딩)',
    integration_code: `
// PDF RAG 파이프라인 예시
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');

async function parsePDF(pdfBuffer) {
  const data = await pdf(pdfBuffer);
  return {
    text: data.text,
    pages: data.numpages,
    info: data.info
  };
}

function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  return chunks;
}

async function createEmbeddings(client, chunks) {
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks
  });
  return response.data.map((e, i) => ({
    text: chunks[i],
    embedding: e.embedding
  }));
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

async function searchRAG(client, query, embeddings, topK = 5) {
  const queryEmbedding = await client.embeddings.create({
    model: 'text-embedding-3-small', input: [query]
  });
  const qVec = queryEmbedding.data[0].embedding;
  
  return embeddings
    .map(e => ({ ...e, score: cosineSimilarity(qVec, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 6. SMS API (문자 발송)
  // ──────────────────────────────────────────────────────────
  SMS_API: {
    name: 'SMS API (Twilio/NCP)',
    icon: '📱',
    category: 'communication',
    description: '국내외 SMS/LMS 발송 자동화',
    cases_affected: 26,
    providers: ['Twilio', 'NCP SMS', 'CoolSMS', 'Solapi'],
    implementation_status: 'needs_api_key',
    difficulty: 'easy',
    monthly_cost_est: '₩6~10/건 (국내)',
    integration_code: `
// SMS 발송 예시 (Twilio)
const twilio = require('twilio');

async function sendSMS(to, message, options = {}) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID, 
    process.env.TWILIO_AUTH_TOKEN
  );
  
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to
  });
  
  return { messageId: result.sid, status: result.status };
}

// 대량 SMS 발송
async function sendBulkSMS(recipients, messageTemplate, data) {
  const results = [];
  for (const recipient of recipients) {
    const message = messageTemplate.replace(/\\{(\\w+)\\}/g, (_, key) => data[recipient.id]?.[key] || '');
    const result = await sendSMS(recipient.phone, message);
    results.push({ recipient: recipient.id, ...result });
    await new Promise(r => setTimeout(r, 100)); // 레이트 리밋
  }
  return results;
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 7. Email API (이메일 자동 발송)
  // ──────────────────────────────────────────────────────────
  EMAIL_API: {
    name: 'Email API (SendGrid/AWS SES)',
    icon: '📧',
    category: 'communication',
    description: '이메일 자동 발송, 템플릿 관리, 트래킹',
    cases_affected: 30,
    providers: ['SendGrid', 'AWS SES', 'Mailchimp', 'Resend'],
    implementation_status: 'needs_api_key',
    difficulty: 'easy',
    monthly_cost_est: '무료 100건/일 (SendGrid)',
    integration_code: `
// 이메일 발송 예시 (SendGrid)
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(to, subject, htmlContent, options = {}) {
  const msg = {
    to,
    from: process.env.SENDER_EMAIL,
    subject,
    html: htmlContent,
    text: htmlContent.replace(/<[^>]*>/g, ''), // 플레인텍스트 fallback
    ...options
  };
  
  const [response] = await sgMail.send(msg);
  return { statusCode: response.statusCode, messageId: response.headers['x-message-id'] };
}

// 뉴스레터 일괄 발송
async function sendNewsletter(recipients, subject, template, variables) {
  const personalizations = recipients.map(r => ({
    to: r.email,
    dynamic_template_data: { name: r.name, ...variables }
  }));
  
  await sgMail.send({
    from: process.env.SENDER_EMAIL,
    personalizations,
    template_id: template
  });
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 8. GitHub API (코드 자동화)
  // ──────────────────────────────────────────────────────────
  GITHUB_API: {
    name: 'GitHub API',
    icon: '💻',
    category: 'development',
    description: 'PR 자동 생성, 코드 리뷰 코멘트, 이슈 관리',
    cases_affected: 24,
    implementation_status: 'needs_token',
    difficulty: 'medium',
    monthly_cost_est: '무료',
    integration_code: `
// GitHub API 통합 예시
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// PR 자동 생성
async function createPullRequest(owner, repo, options) {
  const { title, body, head, base = 'main', draft = false } = options;
  
  const { data } = await octokit.pulls.create({
    owner, repo, title, body, head, base, draft
  });
  
  return { prNumber: data.number, url: data.html_url };
}

// 코드 리뷰 코멘트 추가
async function addReviewComment(owner, repo, pullNumber, comment) {
  await octokit.pulls.createReview({
    owner, repo, pull_number: pullNumber,
    event: 'COMMENT',
    body: comment
  });
}

// 에러 로그 → 이슈 자동 생성
async function createIssueFromError(owner, repo, errorLog, analysis) {
  const { data } = await octokit.issues.create({
    owner, repo,
    title: \`[자동생성] \${analysis.errorType}: \${analysis.summary}\`,
    body: \`## 에러 분석\\n\${analysis.detail}\\n\\n## 원본 로그\\n\\\`\\\`\\\`\\n\${errorLog}\\n\\\`\\\`\\\`\`,
    labels: ['bug', 'ai-generated']
  });
  return { issueNumber: data.number, url: data.html_url };
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 9. ElevenLabs TTS (AI 성우)
  // ──────────────────────────────────────────────────────────
  ELEVENLABS_TTS: {
    name: 'ElevenLabs TTS',
    icon: '🔊',
    category: 'audio',
    description: 'AI 성우 생성, 다국어 지원, 감정 표현',
    cases_affected: 15,
    supported_languages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'it', 'pt'],
    implementation_status: 'needs_api_key',
    difficulty: 'easy',
    monthly_cost_est: '$5/월 (10만자)',
    integration_code: `
// ElevenLabs TTS 통합 예시
async function generateVoice(text, options = {}) {
  const { 
    voiceId = '21m00Tcm4TlvDq8ikWAM', // Rachel (영어)
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75
  } = options;
  
  const response = await fetch(
    \`https://api.elevenlabs.io/v1/text-to-speech/\${voiceId}\`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability, similarity_boost: similarityBoost }
      })
    }
  );
  
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer);
}
`
  },

  // ──────────────────────────────────────────────────────────
  // 10. Slack API (팀 커뮤니케이션)
  // ──────────────────────────────────────────────────────────
  SLACK_API: {
    name: 'Slack API',
    icon: '💬',
    category: 'communication',
    description: '채널 메시지 발송, 알림 자동화, 워크플로우 트리거',
    cases_affected: 27,
    implementation_status: 'needs_token',
    difficulty: 'easy',
    monthly_cost_est: '무료',
    integration_code: `
// Slack API 통합 예시
const { WebClient } = require('@slack/web-api');
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// 메시지 전송
async function sendSlackMessage(channel, text, blocks = null) {
  const result = await slack.chat.postMessage({
    channel,
    text,
    blocks: blocks || [{ type: 'section', text: { type: 'mrkdwn', text } }]
  });
  return result.ts;
}

// 가격 모니터링 알림 예시
async function alertPriceChange(channel, productName, oldPrice, newPrice, competitor) {
  const change = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
  const emoji = newPrice < oldPrice ? '📉' : '📈';
  
  await sendSlackMessage(channel, \`가격 변동 감지: \${productName}\`, [
    { type: 'header', text: { type: 'plain_text', text: \`\${emoji} 가격 변동 알림\` }},
    { type: 'section', fields: [
      { type: 'mrkdwn', text: \`*상품:* \${productName}\` },
      { type: 'mrkdwn', text: \`*경쟁사:* \${competitor}\` },
      { type: 'mrkdwn', text: \`*변동:* \${oldPrice}원 → \${newPrice}원 (\${change}%)\` }
    ]}
  ]);
}
`
  }
};

// ── 통합 우선순위 매트릭스 ──────────────────────────────────
const INTEGRATION_PRIORITY = [
  {
    rank: 1,
    adapter: 'WHISPER_STT',
    cases: 45,
    difficulty: 'easy',
    business_impact: 'high',
    effort_days: 1,
    roi_score: 95,
    reason: '의료/B2B/마케팅 음성처리 케이스 즉시 활성화'
  },
  {
    rank: 2,
    adapter: 'IMAGE_GENERATION',
    cases: 76,
    difficulty: 'medium',
    business_impact: 'high',
    effort_days: 2,
    roi_score: 92,
    reason: '마케팅/이커머스 이미지 자동생성 - 최다 케이스 커버'
  },
  {
    rank: 3,
    adapter: 'GPT4V_VISION',
    cases: 34,
    difficulty: 'easy',
    business_impact: 'high',
    effort_days: 1,
    roi_score: 90,
    reason: 'OCR/명함/화면분석 즉시 활성화 - 기존 모델 활용'
  },
  {
    rank: 4,
    adapter: 'EMAIL_API',
    cases: 30,
    difficulty: 'easy',
    business_impact: 'high',
    effort_days: 1,
    roi_score: 88,
    reason: 'B2B/마케팅 이메일 자동화 파이프라인 완성'
  },
  {
    rank: 5,
    adapter: 'PUPPETEER_CRAWLER',
    cases: 45,
    difficulty: 'easy',
    business_impact: 'medium',
    effort_days: 2,
    roi_score: 85,
    reason: '이커머스 가격모니터링/마케팅 트렌드 분석'
  },
  {
    rank: 6,
    adapter: 'SLACK_API',
    cases: 27,
    difficulty: 'easy',
    business_impact: 'medium',
    effort_days: 1,
    roi_score: 83,
    reason: '알림 자동화 - 모니터링/가격변동/보고서 배포'
  },
  {
    rank: 7,
    adapter: 'SMS_API',
    cases: 26,
    difficulty: 'easy',
    business_impact: 'medium',
    effort_days: 1,
    roi_score: 80,
    reason: '이커머스 CRM - 쿠폰/배송알림 자동화'
  },
  {
    rank: 8,
    adapter: 'PDF_RAG',
    cases: 40,
    difficulty: 'medium',
    business_impact: 'high',
    effort_days: 3,
    roi_score: 78,
    reason: '법률/B2B 문서 분석 - RAG 기반 정확도 향상'
  },
  {
    rank: 9,
    adapter: 'GITHUB_API',
    cases: 24,
    difficulty: 'medium',
    business_impact: 'medium',
    effort_days: 2,
    roi_score: 75,
    reason: 'IT/개발 자동화 - PR/코드리뷰 파이프라인'
  },
  {
    rank: 10,
    adapter: 'ELEVENLABS_TTS',
    cases: 15,
    difficulty: 'easy',
    business_impact: 'medium',
    effort_days: 1,
    roi_score: 70,
    reason: '마케팅 영상 성우, 팟캐스트 자동 제작'
  }
];

// ── 부족 기술 해결 로드맵 ───────────────────────────────────
const MISSING_TECH_SOLUTIONS = {
  '상품페이지_스크래퍼':  { solution: 'Puppeteer + AI 파싱', adapter: 'PUPPETEER_CRAWLER', timeline: '1주' },
  '가격비교_크롤러':     { solution: 'Puppeteer + 스케줄러', adapter: 'PUPPETEER_CRAWLER', timeline: '1주' },
  '기업조사_API':        { solution: 'LinkedIn API + Puppeteer', adapter: 'PUPPETEER_CRAWLER', timeline: '2주' },
  '이탈예측_모델':       { solution: 'ML 파이프라인 + 시계열 분석', adapter: null, timeline: '3주' },
  '급여계산_모듈':       { solution: '세금 계산 로직 + PDF 생성', adapter: 'PDF_RAG', timeline: '1주' },
  '특허DB_API':          { solution: 'KIPRIS API 연동', adapter: null, timeline: '2주' },
  '수식인식_OCR':        { solution: 'GPT-4V + LaTeX 파싱', adapter: 'GPT4V_VISION', timeline: '1주' },
  '3D렌더링_API':        { solution: 'Three.js + WebGL (웹 3D)', adapter: null, timeline: '4주' },
  '캐릭터일관성_AI':     { solution: 'Image Gen + 레퍼런스 이미지', adapter: 'IMAGE_GENERATION', timeline: '2주' },
  'AR_렌더링':           { solution: 'WebXR + AR.js', adapter: null, timeline: '4주' },
  '공간인식_AI':         { solution: '외부 전용 (ControlNet)', adapter: null, timeline: '외부서비스' },
  'AI영상생성':          { solution: 'Sora API (출시 예정)', adapter: null, timeline: '미정' },
  'AI작곡_API':          { solution: 'MusicGen + Suno API', adapter: null, timeline: '2주' },
  'NER_파이프라인':      { solution: 'GPT-5 프롬프트 + JSON 파싱', adapter: 'GPT4V_VISION', timeline: '3일' },
  '이상탐지_ML':         { solution: 'Isolation Forest + 실시간 스트림', adapter: null, timeline: '3주' },
  'RPA_플랫폼':          { solution: 'Playwright + 스케줄러', adapter: 'PUPPETEER_CRAWLER', timeline: '2주' },
  'IoT_플랫폼':          { solution: 'MQTT + Node-RED', adapter: null, timeline: '3주' },
  '부동산_데이터_API':   { solution: '국토부 API + 공공데이터', adapter: null, timeline: '2주' },
  '주식데이터_API':      { solution: 'KIS Open API + Alpha Vantage', adapter: null, timeline: '1주' },
  '약물DB_API':          { solution: 'DUR API + 식약처 DB', adapter: null, timeline: '2주' },
};

module.exports = {
  API_ADAPTERS,
  INTEGRATION_PRIORITY,
  MISSING_TECH_SOLUTIONS
};
