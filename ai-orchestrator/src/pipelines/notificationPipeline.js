'use strict';
/**
 * notificationPipeline.js — Phase 1
 * SMS + Slack + GitHub 통합 알림 파이프라인 (96건 커버)
 *
 * 실제 API 호출 제외 — 각 send*() stub만 교체하면 됨
 */

// ── SMS 템플릿 ─────────────────────────────────────────────
const SMS_TEMPLATES = {
  order_confirm:   '[{{brand}}] 주문({{orderId}}) 확인. 금액: {{amount}}. 배송: {{deliveryDate}}',
  otp:             '[{{brand}}] 인증번호 {{code}} (5분 유효). 타인 노출 금지.',
  alert:           '[긴급] {{title}}: {{message}} — {{actionUrl}}',
  marketing:       '[{{brand}}] {{message}} 자세히보기: {{url}} 수신거부 {{unsubUrl}}',
  delivery:        '[{{brand}}] 배송 {{status}}: {{trackingNum}} / {{deliveryInfo}}',
  reminder:        '[{{brand}}] 알림: {{message}} ({{dateTime}})',
  payment:         '[{{brand}}] {{amount}} 결제 완료. 승인번호: {{approvalNum}}',
};

// ── Slack Block Kit 템플릿 ────────────────────────────────
const SLACK_TEMPLATES = {
  alert: (opts) => ({
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${opts.emoji || '🚨'} ${opts.title}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: opts.message } },
      ...(opts.fields ? [{
        type: 'section',
        fields: opts.fields.map(f => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` }))
      }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: `<!date^${Math.floor(Date.now()/1000)}^{date_pretty} {time}|${new Date().toISOString()}>  ·  ${opts.source || 'AI Orchestrator'}` }] }
    ]
  }),

  report: (opts) => ({
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `📊 ${opts.title}`, emoji: true } },
      { type: 'divider' },
      ...(opts.sections || []).map(s => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${s.title}*\n${s.content}` }
      })),
      ...(opts.actions ? [{
        type: 'actions',
        elements: opts.actions.map(a => ({
          type: 'button', text: { type: 'plain_text', text: a.label, emoji: true },
          url: a.url, style: a.style || 'primary'
        }))
      }] : []),
    ]
  }),

  deployment: (opts) => ({
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `${opts.success ? '✅' : '❌'} *${opts.service}* 배포 ${opts.success ? '성공' : '실패'}` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*버전*\n${opts.version || 'N/A'}` },
        { type: 'mrkdwn', text: `*환경*\n${opts.env || 'production'}` },
        { type: 'mrkdwn', text: `*배포자*\n${opts.deployer || 'CI/CD'}` },
        { type: 'mrkdwn', text: `*소요*\n${opts.durationSec || 0}초` },
      ]},
      ...(opts.commitUrl ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `<${opts.commitUrl}|커밋 보기>` }] }] : []),
    ]
  }),

  task_done: (opts) => ({
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `✅ *작업 완료*: ${opts.taskName}` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*소요*\n${opts.durationMs ? (opts.durationMs / 1000).toFixed(1) + 's' : 'N/A'}` },
        { type: 'mrkdwn', text: `*결과*\n${opts.result || 'success'}` },
      ]},
    ]
  }),
};

// ── GitHub 작업 타입 ──────────────────────────────────────
const GITHUB_ACTIONS = {
  create_issue:   { method: 'POST',  path: '/repos/{owner}/{repo}/issues' },
  create_pr:      { method: 'POST',  path: '/repos/{owner}/{repo}/pulls' },
  comment_issue:  { method: 'POST',  path: '/repos/{owner}/{repo}/issues/{number}/comments' },
  create_label:   { method: 'POST',  path: '/repos/{owner}/{repo}/labels' },
  close_issue:    { method: 'PATCH', path: '/repos/{owner}/{repo}/issues/{number}' },
  get_repo_info:  { method: 'GET',   path: '/repos/{owner}/{repo}' },
  list_issues:    { method: 'GET',   path: '/repos/{owner}/{repo}/issues' },
  create_release: { method: 'POST',  path: '/repos/{owner}/{repo}/releases' },
  trigger_workflow: { method: 'POST', path: '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches' },
};

// ─────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────
function renderSMS(templateKey, vars = {}) {
  let text = SMS_TEMPLATES[templateKey] || templateKey;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
  }
  const missing = (text.match(/{{(\w+)}}/g) || []).map(m => m.slice(2,-2));
  return { text, byteLen: Buffer.byteLength(text, 'utf8'), missing, valid: missing.length === 0 };
}

async function sendSMS(to, text, provider, _apiKey) {
  // 실제 연동 예시 (Twilio):
  // const client = require('twilio')(accountSid, authToken);
  // const msg = await client.messages.create({ body: text, from: '+1234567890', to });
  // return { success: true, sid: msg.sid };
  const providers = {
    twilio:   'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM 필요',
    coolsms:  'COOLSMS_API_KEY, COOLSMS_API_SECRET, COOLSMS_FROM 필요',
    aligo:    'ALIGO_API_KEY, ALIGO_SENDER 필요',
  };
  return {
    stub: true, to, text: text.slice(0, 30) + '...', provider: provider || 'twilio',
    messageId: `stub-sms-${Date.now()}`,
    message: `SMS stub — ${providers[provider] || '제공자 설정 필요'}`,
  };
}

// ─────────────────────────────────────────────────────────
// Slack
// ─────────────────────────────────────────────────────────
function buildSlackPayload(templateKey, opts = {}) {
  const builder = SLACK_TEMPLATES[templateKey];
  if (!builder) {
    return { text: opts.text || '[메시지 없음]', blocks: [] };
  }
  return builder(opts);
}

async function sendSlack(channel, payload, webhookUrl, _botToken) {
  // 실제 연동 (Webhook):
  // await axios.post(webhookUrl, { channel, ...payload });
  // 실제 연동 (Bot Token):
  // await axios.post('https://slack.com/api/chat.postMessage', { channel, ...payload }, { headers: { Authorization: `Bearer ${botToken}` } });
  return {
    stub: true, channel, template: payload._templateKey,
    messageId: `stub-slack-${Date.now()}`,
    message: 'Slack stub — SLACK_WEBHOOK_URL 또는 SLACK_BOT_TOKEN 설정 후 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────
function buildGitHubPayload(action, opts = {}) {
  const actionDef = GITHUB_ACTIONS[action];
  if (!actionDef) return { error: `알 수 없는 GitHub 작업: ${action}` };

  const path = actionDef.path
    .replace('{owner}', opts.owner || '')
    .replace('{repo}',  opts.repo  || '')
    .replace('{number}', opts.issueNumber || '')
    .replace('{workflow_id}', opts.workflowId || '');

  const bodies = {
    create_issue:   { title: opts.title, body: opts.body || '', labels: opts.labels || [], assignees: opts.assignees || [] },
    create_pr:      { title: opts.title, body: opts.body || '', head: opts.head || '', base: opts.base || 'main', draft: opts.draft || false },
    comment_issue:  { body: opts.body || '' },
    create_label:   { name: opts.name, color: opts.color || 'f29513', description: opts.description || '' },
    close_issue:    { state: 'closed' },
    create_release: { tag_name: opts.tag, name: opts.name || opts.tag, body: opts.body || '', draft: false, prerelease: opts.prerelease || false },
    trigger_workflow: { ref: opts.ref || 'main', inputs: opts.inputs || {} },
  };

  return {
    method:  actionDef.method,
    url:     `https://api.github.com${path}`,
    body:    bodies[action] || {},
    headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer {GITHUB_TOKEN}' },
  };
}

async function callGitHub(action, opts, _token) {
  const payload = buildGitHubPayload(action, opts);
  if (payload.error) return { success: false, error: payload.error };
  // 실제 연동:
  // const res = await axios({ method: payload.method, url: payload.url, data: payload.body,
  //   headers: { ...payload.headers, Authorization: `Bearer ${token}` } });
  // return { success: true, data: res.data };
  return {
    stub: true, action, url: payload.url, method: payload.method, body: payload.body,
    response: { id: 99999, html_url: `https://github.com/${opts.owner}/${opts.repo}/issues/99999`, number: 99999, state: 'open' },
    message: 'GitHub stub — GITHUB_TOKEN 환경변수 설정 후 실제 API 활성화',
  };
}

// ─────────────────────────────────────────────────────────
// 라우터: 채널 결정
// ─────────────────────────────────────────────────────────
function routeNotification(event, opts = {}) {
  const routes = {
    'deploy.success':  [{ channel: 'slack', template: 'deployment' }],
    'deploy.failure':  [{ channel: 'slack', template: 'alert' }, { channel: 'sms', template: 'alert' }],
    'order.created':   [{ channel: 'sms',   template: 'order_confirm' }],
    'payment.done':    [{ channel: 'sms',   template: 'payment' }],
    'alert.critical':  [{ channel: 'slack', template: 'alert' }, { channel: 'sms', template: 'alert' }],
    'alert.warning':   [{ channel: 'slack', template: 'alert' }],
    'task.done':       [{ channel: 'slack', template: 'task_done' }],
    'issue.created':   [{ channel: 'github', action: 'create_issue' }],
    'report.daily':    [{ channel: 'slack', template: 'report' }],
    'otp.send':        [{ channel: 'sms',   template: 'otp' }],
  };
  return routes[event] || [{ channel: 'slack', template: 'alert', note: '기본 라우트' }];
}

// ─────────────────────────────────────────────────────────
// 통합 실행
// ─────────────────────────────────────────────────────────
async function execute(opts = {}) {
  const {
    channel   = 'slack',   // slack | sms | github | all
    event     = null,
    // Slack
    slackTemplate = 'alert',
    slackChannel  = '#general',
    slackOpts     = {},
    webhookUrl    = null,
    botToken      = null,
    // SMS
    smsTemplate   = 'alert',
    smsTo         = '',
    smsVars       = {},
    smsProvider   = 'twilio',
    smsApiKey     = null,
    // GitHub
    githubAction  = 'create_issue',
    githubOpts    = {},
    githubToken   = null,
  } = opts;

  const startMs = Date.now();
  const results = {};

  const channels = event
    ? routeNotification(event, opts).map(r => r.channel)
    : (channel === 'all' ? ['slack', 'sms', 'github'] : [channel]);

  if (channels.includes('slack')) {
    const payload = buildSlackPayload(slackTemplate, { ...slackOpts, _templateKey: slackTemplate });
    results.slack = await sendSlack(slackChannel, payload, webhookUrl, botToken);
  }

  if (channels.includes('sms') && smsTo) {
    const { text, valid, missing } = renderSMS(smsTemplate, smsVars);
    if (!valid) results.sms = { success: false, error: `미치환 변수: ${missing.join(', ')}` };
    else results.sms = await sendSMS(smsTo, text, smsProvider, smsApiKey);
  }

  if (channels.includes('github')) {
    results.github = await callGitHub(githubAction, githubOpts, githubToken);
  }

  const allSuccess = Object.values(results).every(r => r.stub || r.success !== false);

  return {
    success:    allSuccess,
    pipeline:   'notification',
    event,
    channels,
    results,
    durationMs: Date.now() - startMs,
    readyToUse: false,
    meta: {
      smsTemplates:    Object.keys(SMS_TEMPLATES),
      slackTemplates:  Object.keys(SLACK_TEMPLATES),
      githubActions:   Object.keys(GITHUB_ACTIONS),
      eventRoutes:     Object.keys(routeNotification.__closure || {}),
    },
  };
}

module.exports = {
  execute,
  sendSMS,
  sendSlack,
  callGitHub,
  renderSMS,
  buildSlackPayload,
  buildGitHubPayload,
  routeNotification,
  SMS_TEMPLATES,
  SLACK_TEMPLATES,
  GITHUB_ACTIONS,
};
