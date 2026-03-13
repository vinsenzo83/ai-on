'use strict';
/**
 * integrationService.js — Phase 7H: 외부 서비스 통합
 * - Slack Webhook
 * - Google Sheets API
 * - AWS S3 (파일 저장)
 * - Stripe 결제
 * - Notion API
 * 실제 자격증명 없을 때는 mock 모드로 동작
 */
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

// ── Mock Store (자격증명 없을 때 로컬 저장) ───────────────────
const mockSent    = [];   // Slack 메시지 로그
const mockSheets  = {};   // spreadsheetId → rows[]
const mockStorage = {};   // bucket/key → content
const mockPayments= [];   // 결제 로그

function _isMock(key) { return !process.env[key]; }
function _log(type, data) { console.log(`[Integration:${type}]`, JSON.stringify(data).slice(0,100)); }

// ── HTTP 헬퍼 ─────────────────────────────────────────────────
function _request(url, opts, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Slack Integration ─────────────────────────────────────────
async function sendSlack({ webhookUrl, channel, text, blocks, username = 'AI 오케스트레이터' }) {
  const payload = { text, username, icon_emoji: ':robot_face:' };
  if (channel) payload.channel = channel;
  if (blocks)  payload.blocks  = blocks;

  if (_isMock('SLACK_WEBHOOK_URL')) {
    const mock = { id: 'slack-' + Date.now(), channel, text, ts: new Date().toISOString(), mock: true };
    mockSent.push(mock);
    _log('Slack', { mode: 'mock', text: text?.slice(0, 50) });
    return { ok: true, mock: true, messageId: mock.id };
  }

  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
  try {
    const res = await _request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, payload);
    return { ok: res.status === 200, status: res.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sendSlackAlert({ message, level = 'info', pipeline, costUSD }) {
  const emoji = { info: 'ℹ️', warn: '⚠️', error: '🚨', success: '✅' }[level] || 'ℹ️';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} AI 오케스트레이터 알림` } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*메시지*\n${message}` },
      { type: 'mrkdwn', text: `*파이프라인*\n${pipeline || 'N/A'}` },
      { type: 'mrkdwn', text: `*레벨*\n${level.toUpperCase()}` },
      { type: 'mrkdwn', text: `*비용*\n$${costUSD || '0.00'}` },
    ]},
    { type: 'context', elements: [{ type: 'mrkdwn', text: new Date().toLocaleString('ko-KR') }] },
  ];
  return sendSlack({ text: `${emoji} ${message}`, blocks });
}

// ── Google Sheets Integration ─────────────────────────────────
async function appendToSheet({ spreadsheetId, range, values }) {
  if (_isMock('GOOGLE_SHEETS_API_KEY')) {
    if (!mockSheets[spreadsheetId]) mockSheets[spreadsheetId] = [];
    const rows = Array.isArray(values[0]) ? values : [values];
    mockSheets[spreadsheetId].push(...rows.map(r => ({ values: r, ts: new Date().toISOString() })));
    _log('Sheets', { mode: 'mock', spreadsheetId, rows: rows.length });
    return { ok: true, mock: true, updatedRows: rows.length, spreadsheetId };
  }
  // 실제 Google Sheets API 호출 (자격증명 있을 때)
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&key=${apiKey}`;
  try {
    const res = await _request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { values });
    return { ok: res.status === 200, data: res.data };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function readSheet({ spreadsheetId, range }) {
  if (_isMock('GOOGLE_SHEETS_API_KEY')) {
    const data = mockSheets[spreadsheetId] || [];
    return { ok: true, mock: true, values: data.map(r => r.values), count: data.length };
  }
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey}`;
  try {
    const res = await _request(url, { method: 'GET' });
    return { ok: res.status === 200, values: res.data.values || [] };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── S3 / Storage Integration ──────────────────────────────────
async function uploadFile({ bucket, key, content, contentType = 'application/json' }) {
  if (_isMock('AWS_S3_BUCKET')) {
    const storageKey = `${bucket}/${key}`;
    mockStorage[storageKey] = {
      content: typeof content === 'object' ? JSON.stringify(content) : content,
      contentType, size: JSON.stringify(content).length,
      uploadedAt: new Date().toISOString(),
    };
    const url = `https://mock-s3.local/${bucket}/${key}`;
    _log('S3', { mode: 'mock', bucket, key });
    return { ok: true, mock: true, url, key, bucket };
  }
  // 실제 AWS S3 presigned upload 로직
  return { ok: false, error: 'AWS_S3_BUCKET 환경 변수가 설정되지 않았습니다.' };
}

async function getFile({ bucket, key }) {
  if (_isMock('AWS_S3_BUCKET')) {
    const storageKey = `${bucket}/${key}`;
    const file = mockStorage[storageKey];
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' };
    return { ok: true, mock: true, ...file };
  }
  return { ok: false, error: 'AWS_S3_BUCKET 환경 변수가 설정되지 않았습니다.' };
}

function listFiles(bucket) {
  if (_isMock('AWS_S3_BUCKET')) {
    const prefix = bucket + '/';
    return Object.entries(mockStorage)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: k.replace(prefix, ''), size: v.size, uploadedAt: v.uploadedAt }));
  }
  return [];
}

// ── Stripe / 결제 Integration ─────────────────────────────────
async function createPayment({ userId, amountUSD, description, planId }) {
  if (_isMock('STRIPE_SECRET_KEY')) {
    const payment = {
      id: 'pay-' + crypto.randomBytes(8).toString('hex'),
      userId, amountUSD, description, planId,
      status: 'succeeded', mock: true,
      createdAt: new Date().toISOString(),
    };
    mockPayments.push(payment);
    _log('Stripe', { mode: 'mock', amountUSD, planId });
    return { ok: true, mock: true, paymentId: payment.id, status: 'succeeded' };
  }
  return { ok: false, error: 'STRIPE_SECRET_KEY 환경 변수가 설정되지 않았습니다.' };
}

// ── Notion Integration ────────────────────────────────────────
async function createNotionPage({ databaseId, title, properties, content }) {
  if (_isMock('NOTION_API_KEY')) {
    const page = {
      id: 'notion-' + Date.now(),
      databaseId, title,
      url: `https://notion.so/mock-page-${Date.now()}`,
      mock: true, createdAt: new Date().toISOString(),
    };
    _log('Notion', { mode: 'mock', title });
    return { ok: true, mock: true, pageId: page.id, url: page.url };
  }
  const token = process.env.NOTION_API_KEY;
  const url = 'https://api.notion.com/v1/pages';
  const body = {
    parent: { database_id: databaseId },
    properties: { title: { title: [{ text: { content: title } }] }, ...properties },
    children: content ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }] : [],
  };
  try {
    const res = await _request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' } }, body);
    return { ok: res.status === 200, pageId: res.data.id, url: res.data.url };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Integration Status ────────────────────────────────────────
function getIntegrationStatus() {
  return {
    slack:        { connected: !_isMock('SLACK_WEBHOOK_URL'),  mock: _isMock('SLACK_WEBHOOK_URL'),  messagesSent: mockSent.length },
    googleSheets: { connected: !_isMock('GOOGLE_SHEETS_API_KEY'), mock: _isMock('GOOGLE_SHEETS_API_KEY'), spreadsheets: Object.keys(mockSheets).length },
    s3:           { connected: !_isMock('AWS_S3_BUCKET'),      mock: _isMock('AWS_S3_BUCKET'),      filesStored: Object.keys(mockStorage).length },
    stripe:       { connected: !_isMock('STRIPE_SECRET_KEY'),  mock: _isMock('STRIPE_SECRET_KEY'),  payments: mockPayments.length },
    notion:       { connected: !_isMock('NOTION_API_KEY'),     mock: _isMock('NOTION_API_KEY'),     pages: 0 },
  };
}

module.exports = {
  sendSlack, sendSlackAlert,
  appendToSheet, readSheet,
  uploadFile, getFile, listFiles,
  createPayment,
  createNotionPage,
  getIntegrationStatus,
  _mockSent: mockSent, _mockStorage: mockStorage,
};
