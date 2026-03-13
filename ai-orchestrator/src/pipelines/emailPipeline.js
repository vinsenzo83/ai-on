'use strict';
/**
 * emailPipeline.js — Phase 1
 * 이메일 자동화 파이프라인 (51건 커버)
 *
 * 기능: 템플릿 엔진 / 개인화 / 수신자 세그먼트 / 발송 계획 / A/B 테스트 설계
 * 실제 SMTP/API 호출 제외 — sendEmail() stub만 교체
 */

// ── 이메일 템플릿 라이브러리 ──────────────────────────────
const EMAIL_TEMPLATES = {

  marketing_promo: {
    name:     '마케팅 프로모션',
    subject:  '{{brand}}에서 특별 할인 {{discount}}% 혜택을 드립니다!',
    category: 'marketing',
    htmlBody: `
<div style="font-family:sans-serif;max-width:600px;margin:auto">
  <div style="background:{{brandColor}};padding:20px;text-align:center">
    <h1 style="color:#fff;margin:0">{{brand}}</h1>
  </div>
  <div style="padding:30px">
    <h2>안녕하세요, {{name}}님!</h2>
    <p>{{brand}}에서 특별한 혜택을 준비했습니다.</p>
    <div style="background:#f5f5f5;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
      <h2 style="color:{{brandColor}}">{{discount}}% 할인</h2>
      <p>{{offerDescription}}</p>
      <p><b>만료일: {{expiryDate}}</b></p>
    </div>
    <div style="text-align:center">
      <a href="{{ctaUrl}}" style="background:{{brandColor}};color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold">{{ctaText}}</a>
    </div>
  </div>
  <div style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#888">
    <p>수신 거부: <a href="{{unsubscribeUrl}}">여기를 클릭</a></p>
  </div>
</div>`,
    variables: ['brand','brandColor','name','discount','offerDescription','expiryDate','ctaUrl','ctaText','unsubscribeUrl'],
  },

  b2b_outreach: {
    name:     'B2B 영업 아웃리치',
    subject:  '{{senderCompany}} — {{recipientName}}님께 제안드립니다',
    category: 'b2b',
    htmlBody: `
<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px">
  <p>안녕하세요 {{recipientName}}님,</p>
  <p>저는 {{senderCompany}}의 {{senderName}}입니다.</p>
  <p>{{companyName}}에서 <b>{{painPoint}}</b> 문제를 해결하는 데 도움을 드릴 수 있을 것 같아 연락드렸습니다.</p>
  <p>저희 {{productName}}은(는) {{benefit1}}, {{benefit2}}, {{benefit3}} 을(를) 제공합니다.</p>
  <p>간단한 15분 미팅을 제안드려도 될까요?</p>
  <p><a href="{{calendarUrl}}" style="background:#0066cc;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">미팅 일정 잡기</a></p>
  <p>감사합니다,<br>{{senderName}}<br>{{senderTitle}} | {{senderCompany}}<br>{{senderPhone}}</p>
</div>`,
    variables: ['recipientName','companyName','senderName','senderCompany','senderTitle','senderPhone','painPoint','productName','benefit1','benefit2','benefit3','calendarUrl'],
  },

  transactional_order: {
    name:     '주문 확인',
    subject:  '[{{brand}}] 주문번호 {{orderId}} 확인 안내',
    category: 'transactional',
    htmlBody: `
<div style="font-family:sans-serif;max-width:600px;margin:auto">
  <div style="background:#333;padding:20px;text-align:center"><h2 style="color:#fff;margin:0">{{brand}}</h2></div>
  <div style="padding:30px">
    <h2>주문이 확인되었습니다!</h2>
    <p>{{name}}님, 주문해 주셔서 감사합니다.</p>
    <table style="width:100%;border-collapse:collapse">
      <tr style="background:#f5f5f5"><td style="padding:10px"><b>주문번호</b></td><td style="padding:10px">{{orderId}}</td></tr>
      <tr><td style="padding:10px"><b>상품</b></td><td style="padding:10px">{{productName}}</td></tr>
      <tr style="background:#f5f5f5"><td style="padding:10px"><b>금액</b></td><td style="padding:10px">{{amount}}</td></tr>
      <tr><td style="padding:10px"><b>배송 예정</b></td><td style="padding:10px">{{deliveryDate}}</td></tr>
    </table>
    <p style="margin-top:20px"><a href="{{trackingUrl}}" style="background:#ff6600;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">배송 추적</a></p>
  </div>
</div>`,
    variables: ['brand','name','orderId','productName','amount','deliveryDate','trackingUrl'],
  },

  newsletter: {
    name:     '뉴스레터',
    subject:  '{{brand}} 뉴스레터 — {{month}}월 주요 소식',
    category: 'newsletter',
    htmlBody: `
<div style="font-family:sans-serif;max-width:600px;margin:auto">
  <div style="background:{{brandColor}};padding:24px;text-align:center"><h1 style="color:#fff;margin:0">{{brand}} Newsletter</h1></div>
  <div style="padding:30px">
    <h2>이번 달 주요 소식</h2>
    <div style="border-left:4px solid {{brandColor}};padding-left:16px;margin-bottom:24px">
      <h3>{{headline1}}</h3><p>{{summary1}}</p>
      <a href="{{link1}}">자세히 보기 →</a>
    </div>
    <div style="border-left:4px solid #ccc;padding-left:16px;margin-bottom:24px">
      <h3>{{headline2}}</h3><p>{{summary2}}</p>
      <a href="{{link2}}">자세히 보기 →</a>
    </div>
    <div style="border-left:4px solid #ccc;padding-left:16px">
      <h3>{{headline3}}</h3><p>{{summary3}}</p>
      <a href="{{link3}}">자세히 보기 →</a>
    </div>
  </div>
  <div style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#888">
    수신 거부: <a href="{{unsubscribeUrl}}">여기</a>
  </div>
</div>`,
    variables: ['brand','brandColor','month','headline1','summary1','link1','headline2','summary2','link2','headline3','summary3','link3','unsubscribeUrl'],
  },

  hr_notification: {
    name:     'HR 공지',
    subject:  '[인사팀] {{subject}}',
    category: 'hr',
    htmlBody: `
<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px">
  <div style="background:#1a3a5c;padding:20px;border-radius:8px 8px 0 0"><h2 style="color:#fff;margin:0">인사 공지</h2></div>
  <div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>{{recipientName}} 님,</p>
    <p>{{body}}</p>
    {{#if deadline}}<p><b>기한: {{deadline}}</b></p>{{/if}}
    {{#if actionRequired}}<p style="background:#fff3cd;padding:12px;border-radius:4px">⚠️ {{actionRequired}}</p>{{/if}}
    <p>문의사항은 인사팀 {{hrContact}} 로 연락 주세요.</p>
    <p>감사합니다,<br>인사팀</p>
  </div>
</div>`,
    variables: ['recipientName','subject','body','deadline','actionRequired','hrContact'],
  },
};

// ── 발송 제공자 설정 ──────────────────────────────────────
const EMAIL_PROVIDERS = {
  smtp: {
    name: 'SMTP (Nodemailer)',
    config: { host: 'smtp.example.com', port: 587, secure: false },
    note: 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS 환경변수 필요',
  },
  sendgrid: {
    name: 'SendGrid',
    apiEndpoint: 'https://api.sendgrid.com/v3/mail/send',
    note: 'SENDGRID_API_KEY 환경변수 필요',
  },
  ses: {
    name: 'AWS SES',
    note: 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION 필요',
  },
  mailgun: {
    name: 'Mailgun',
    note: 'MAILGUN_API_KEY, MAILGUN_DOMAIN 필요',
  },
};

// ─────────────────────────────────────────────────────────
// 템플릿 렌더 (변수 치환)
// ─────────────────────────────────────────────────────────
function renderTemplate(templateKey, vars = {}) {
  const tmpl = EMAIL_TEMPLATES[templateKey];
  if (!tmpl) return { success: false, error: `템플릿 없음: ${templateKey}` };

  let subject  = tmpl.subject;
  let htmlBody = tmpl.htmlBody;

  // 변수 치환
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`{{${k}}}`, 'g');
    subject  = subject.replace(re, v);
    htmlBody = htmlBody.replace(re, v);
  }

  // 미치환 변수 탐지
  const missing = (subject + htmlBody).match(/{{(\w+)}}/g)?.map(m => m.slice(2, -2)) || [];

  return {
    success:        true,
    templateKey,
    templateName:   tmpl.name,
    subject,
    htmlBody,
    missingVars:    [...new Set(missing)],
    category:       tmpl.category,
    requiredVars:   tmpl.variables,
  };
}

// ─────────────────────────────────────────────────────────
// 수신자 세그먼트
// ─────────────────────────────────────────────────────────
function segmentRecipients(recipients = [], rules = {}) {
  const {
    minEngagement = 0,
    domains       = [],
    tags          = [],
    limit         = 1000,
  } = rules;

  let filtered = recipients;
  if (domains.length)    filtered = filtered.filter(r => domains.some(d => (r.email || '').endsWith(d)));
  if (tags.length)       filtered = filtered.filter(r => tags.some(t => (r.tags || []).includes(t)));
  if (minEngagement > 0) filtered = filtered.filter(r => (r.engagementScore || 0) >= minEngagement);

  return {
    total:     recipients.length,
    matched:   Math.min(filtered.length, limit),
    filtered:  filtered.slice(0, limit),
    excluded:  recipients.length - filtered.length,
  };
}

// ─────────────────────────────────────────────────────────
// A/B 테스트 설계
// ─────────────────────────────────────────────────────────
function designABTest(variants = [], splitPct = 20) {
  if (variants.length < 2) return { error: '최소 2개 변형 필요' };
  const winnerPct = 100 - splitPct * variants.length;
  return {
    variants: variants.map((v, i) => ({ ...v, label: `Variant_${String.fromCharCode(65 + i)}`, splitPct })),
    winnerPct: Math.max(0, winnerPct),
    metric:   'open_rate',   // open_rate | click_rate | conversion
    minSamplePerVariant: 100,
    testDurationHours: 24,
    note: `각 변형에 ${splitPct}% 발송 → 24시간 후 승자에게 나머지 ${winnerPct}% 발송`,
  };
}

// ─────────────────────────────────────────────────────────
// 발송 계획 (스케줄링)
// ─────────────────────────────────────────────────────────
function planSend(recipientCount = 0, opts = {}) {
  const { batchSize = 500, intervalMs = 1000, sendAt = null } = opts;
  const batches = Math.ceil(recipientCount / batchSize);
  const totalMs = (batches - 1) * intervalMs;
  return {
    recipientCount,
    batchSize,
    batches,
    intervalMs,
    estimatedDurationMs: totalMs,
    sendAt: sendAt || new Date().toISOString(),
    ratePerSec: Math.floor(1000 / intervalMs * batchSize),
  };
}

// ─────────────────────────────────────────────────────────
// 이메일 전송 stub
// ─────────────────────────────────────────────────────────
async function sendEmail(to, subject, htmlBody, provider, _apiKey) {
  // 실제 연동 시 교체 예시 (SendGrid):
  // const res = await axios.post('https://api.sendgrid.com/v3/mail/send',
  //   { personalizations:[{to:[{email:to}]}], from:{email:from}, subject, content:[{type:'text/html',value:htmlBody}] },
  //   { headers:{ Authorization:`Bearer ${apiKey}` } });
  // return { success: true, messageId: res.headers['x-message-id'] };
  return {
    stub:      true,
    to,
    subject,
    provider:  provider || 'smtp',
    sentAt:    new Date().toISOString(),
    messageId: `stub-${Date.now()}`,
    message:   `Email stub — ${EMAIL_PROVIDERS[provider]?.note || 'API 키 설정 후 실제 발송 활성화'}`,
  };
}

// ─────────────────────────────────────────────────────────
// 파이프라인 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    templateKey  = 'marketing_promo',
    vars         = {},
    recipients   = [],
    provider     = 'smtp',
    schedule     = null,
    abTest       = null,
    segmentRules = {},
    apiKey       = null,
  } = opts;

  const startMs = Date.now();

  // 1. 템플릿 렌더
  const rendered = renderTemplate(templateKey, vars);
  if (!rendered.success) return { success: false, error: rendered.error };

  // 2. 수신자 세그먼트
  const segment = segmentRecipients(recipients, segmentRules);

  // 3. 발송 계획
  const plan = planSend(segment.matched, { sendAt: schedule });

  // 4. A/B 설계 (있으면)
  const ab = abTest ? designABTest(abTest.variants, abTest.splitPct) : null;

  // 5. 발송 (stub)
  const sendResults = [];
  const sampleRecipients = segment.filtered.slice(0, 3); // 최대 3명 샘플만 stub 실행
  for (const r of sampleRecipients) {
    const personalized = renderTemplate(templateKey, { ...vars, name: r.name || '고객', ...r });
    const res = await sendEmail(r.email, personalized.subject, personalized.htmlBody, provider, apiKey);
    sendResults.push({ email: r.email, ...res });
  }

  return {
    success:      true,
    pipeline:     'email',
    template:     { key: templateKey, name: rendered.templateName, category: rendered.category },
    rendered:     { subject: rendered.subject, missingVars: rendered.missingVars },
    segment,
    plan,
    abTest:       ab,
    sampleSends:  sendResults,
    durationMs:   Date.now() - startMs,
    readyToUse:   false,   // provider 설정 후 활성화
    meta: {
      templates:  Object.keys(EMAIL_TEMPLATES),
      providers:  Object.keys(EMAIL_PROVIDERS),
      providerInfo: EMAIL_PROVIDERS,
    },
  };
}

module.exports = {
  execute,
  renderTemplate,
  segmentRecipients,
  planSend,
  designABTest,
  EMAIL_TEMPLATES,
  EMAIL_PROVIDERS,
};
