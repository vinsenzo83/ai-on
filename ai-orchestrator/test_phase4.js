'use strict';
const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: 3000, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.slice(0, 60) }); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3000, path }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ _raw: d.slice(0, 60) }); } });
    }).on('error', reject);
  });
}

const tests = [
  ['marketing/content',       () => post('/api/marketing/content',      { topic: 'AI', platforms: ['instagram'] })],
  ['marketing/schedule',      () => post('/api/marketing/schedule',     { startDate: '2026-03-10', endDate: '2026-03-14', frequency: 'daily', platforms: ['instagram'] })],
  ['marketing/campaign',      () => post('/api/marketing/campaign',     { brand: '테크', budget: 5000000 })],
  ['marketing/voice-script',  () => post('/api/marketing/voice-script', { script: '안녕하세요.', voicePreset: 'narrator' })],
  ['marketing/media-monitor', () => post('/api/marketing/media-monitor',{ keywords: ['AI'] })],
  ['marketing/influencers',   () => post('/api/marketing/influencers',  { platform: 'instagram', minFollowers: 10000 })],
  ['b2b/payroll',             () => post('/api/b2b/payroll',            { industry: 'it' })],
  ['b2b/company-research',    () => post('/api/b2b/company-research',   { companyName: '네이버' })],
  ['b2b/contract-analysis',   () => post('/api/b2b/contract-analysis',  { contractType: 'nda' })],
  ['b2b/proposal',            () => post('/api/b2b/proposal',           { proposalType: 'software', budget: 100000000 })],
  ['b2b/market-research',     () => post('/api/b2b/market-research',    { industry: 'it' })],
  ['creative/character',      () => post('/api/creative/character',     { characterName: '아리아', genre: 'fantasy' })],
  ['creative/video-storyboard',() => post('/api/creative/video-storyboard', { title: 'AI시대', durationSec: 60 })],
  ['creative/music',          () => post('/api/creative/music',         { mood: 'uplifting', genre: 'pop' })],
  ['creative/ar-scene',       () => post('/api/creative/ar-scene',      { scene: '거실', objects: ['소파', 'TV'] })],
  ['data-ai/anomaly',         () => post('/api/data-ai/anomaly',        { data: [{ value: 10 }, { value: 11 }, { value: 999 }], algorithm: 'zscore' })],
  ['data-ai/forecast',        () => post('/api/data-ai/forecast',       { series: [{ date: '2025-01', value: 100 }, { date: '2025-02', value: 110 }], periods: 3 })],
  ['data-ai/rpa',             () => post('/api/data-ai/rpa',            { taskName: '자동화', steps: ['수집', '계산'], trigger: 'schedule' })],
  ['data-ai/iot',             () => post('/api/data-ai/iot',            { deviceId: 'sensor-001', sensors: ['temp', 'humidity'] })],
  ['ecommerce/recommend',     () => post('/api/ecommerce/recommend',    { userId: 'u001', browsedItems: ['스마트폰'] })],
  ['ecommerce/ads',           () => post('/api/ecommerce/ads',          { productName: 'AI스피커', budget: 1000000, targetKeywords: ['AI'] })],
  ['ecommerce/price-compare', () => post('/api/ecommerce/price-compare',{ productName: '갤럭시S25' })],
  ['GET /api/coverage',       () => get('/api/coverage')],
  ['GET /api/export/cases',   () => get('/api/export/cases?limit=3')],
  ['GET /api/export/report',  () => get('/api/export/coverage-report')],
];

async function run() {
  let pass = 0, fail = 0;
  for (const [label, fn] of tests) {
    try {
      const r = await fn();
      if (r.error) {
        console.log('⚠️ ', label, '--', String(r.error).slice(0, 60));
        fail++;
      } else {
        console.log('✅', label);
        pass++;
      }
    } catch (e) {
      console.log('❌', label, '--', e.message);
      fail++;
    }
  }
  console.log('\n══════════════════════════════════════════════════');
  console.log('Phase 4 최종: ' + pass + '/' + tests.length + ' 통과' + (fail > 0 ? ' (' + fail + ' 실패)' : ' 🎉 ALL PASS'));
  console.log('══════════════════════════════════════════════════');
}

run();
