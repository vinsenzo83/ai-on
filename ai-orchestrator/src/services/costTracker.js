'use strict';
/**
 * costTracker.js — Phase 7C: AI API 비용 추적 시스템
 * - 모델별 토큰 단가
 * - 파이프라인별 누적 비용
 * - 일/월별 리포트
 * - 예산 초과 알람
 */

// ── 모델별 토큰 단가 (USD per 1K tokens) ──────────────────────
const MODEL_PRICING = {
  // OpenAI
  'gpt-4o':               { input: 0.005,   output: 0.015  },
  'gpt-4o-mini':          { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':          { input: 0.01,    output: 0.03   },
  'gpt-4':                { input: 0.03,    output: 0.06   },
  'gpt-3.5-turbo':        { input: 0.0005,  output: 0.0015 },
  'text-embedding-3-small':{ input: 0.00002, output: 0      },
  'text-embedding-3-large':{ input: 0.00013, output: 0      },
  'whisper-1':            { input: 0.006,   output: 0, unit: 'minute' }, // per minute
  'dall-e-3':             { input: 0.04,    output: 0, unit: 'image'  }, // per image
  // Anthropic
  'claude-3-5-sonnet-20241022':   { input: 0.003,  output: 0.015 },
  'claude-3-5-haiku-20241022':    { input: 0.0008, output: 0.004 },
  'claude-3-opus-20240229':       { input: 0.015,  output: 0.075 },
  'claude-haiku-4-5-20251001':    { input: 0.0008, output: 0.004 },
  'claude-sonnet-4-5-20250929':   { input: 0.003,  output: 0.015 },
  'claude-sonnet-4-6':            { input: 0.003,  output: 0.015 },
  // Google Gemini
  'gemini-3-flash-preview':  { input: 0.0001, output: 0.0004 },
  'gemini-2.5-flash':        { input: 0.0003, output: 0.0012 },
  'gemini-2.0-flash':        { input: 0.0001, output: 0.0004 },
  'gemini-2.0-flash-lite':   { input: 0.000075, output: 0.0003 },
  // DeepSeek
  'deepseek-chat':    { input: 0.00014, output: 0.00028 },
  'deepseek-reasoner':{ input: 0.00055, output: 0.00219 },
  // xAI
  'grok-3-mini':  { input: 0.0003, output: 0.0005 },
  'grok-3':       { input: 0.003,  output: 0.015  },
  // Moonshot
  'moonshot-v1-8k':  { input: 0.0012, output: 0.0012 },
  'moonshot-v1-32k': { input: 0.0024, output: 0.0024 },
  // Mistral
  'mistral-small-latest':  { input: 0.0002, output: 0.0006 },
  'mistral-medium-latest': { input: 0.0027, output: 0.0081 },
  'mistral-large-latest':  { input: 0.003,  output: 0.009  },
  // Default
  'default':              { input: 0.002,   output: 0.008  },
};

// ── In-Memory Usage Store ─────────────────────────────────────
const usageRecords = [];   // 전체 사용 로그
const dailyCache   = {};   // date → { totalTokens, totalCost, byModel, byPipeline }
const BUDGET_LIMIT_DAILY  = parseFloat(process.env.BUDGET_DAILY  || '50');   // USD
const BUDGET_LIMIT_MONTHLY = parseFloat(process.env.BUDGET_MONTHLY || '500'); // USD
const alertCallbacks = [];

// ── Cost Calculation ──────────────────────────────────────────
function calcCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost  = (inputTokens  / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * (pricing.output || 0);
  return +(inputCost + outputCost).toFixed(6);
}

// ── Record Usage ──────────────────────────────────────────────
function record({ userId = 'anonymous', pipeline, model = 'gpt-4o-mini',
                  inputTokens = 0, outputTokens = 0, extraCost = 0, metadata = {} }) {
  const cost = calcCost(model, inputTokens, outputTokens) + extraCost;
  const totalTokens = inputTokens + outputTokens;
  const date = new Date().toISOString().slice(0, 10);
  const entry = {
    id: `usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    userId, pipeline, model,
    inputTokens, outputTokens, totalTokens,
    costUSD: cost, date,
    ts: new Date().toISOString(),
    metadata,
  };
  usageRecords.push(entry);
  if (usageRecords.length > 5000) usageRecords.shift();

  // 일별 캐시 업데이트
  if (!dailyCache[date]) dailyCache[date] = { totalTokens: 0, totalCost: 0, byModel: {}, byPipeline: {}, byUser: {} };
  const d = dailyCache[date];
  d.totalTokens += totalTokens;
  d.totalCost   = +(d.totalCost + cost).toFixed(6);
  d.byModel[model]        = +(( d.byModel[model]        || 0) + cost).toFixed(6);
  d.byPipeline[pipeline]  = +(( d.byPipeline[pipeline]  || 0) + cost).toFixed(6);
  d.byUser[userId]        = +(( d.byUser[userId]        || 0) + cost).toFixed(6);

  // 예산 초과 체크
  _checkBudget(date, d.totalCost);

  return entry;
}

function _checkBudget(date, dailyCost) {
  if (dailyCost >= BUDGET_LIMIT_DAILY) {
    const msg = `⚠️ 일일 예산 초과: $${dailyCost.toFixed(2)} / $${BUDGET_LIMIT_DAILY} (${date})`;
    alertCallbacks.forEach(fn => fn({ type: 'daily_budget', date, cost: dailyCost, limit: BUDGET_LIMIT_DAILY, msg }));
  }
}

function onAlert(fn) { alertCallbacks.push(fn); }

// ── Reports ───────────────────────────────────────────────────
function getDailyReport(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const records = usageRecords.filter(r => r.date === d);
  const totalCost = records.reduce((s, r) => s + r.costUSD, 0);
  const byPipeline = {};
  const byModel    = {};
  records.forEach(r => {
    byPipeline[r.pipeline] = (byPipeline[r.pipeline] || { calls: 0, tokens: 0, cost: 0 });
    byPipeline[r.pipeline].calls++;
    byPipeline[r.pipeline].tokens += r.totalTokens;
    byPipeline[r.pipeline].cost    = +((byPipeline[r.pipeline].cost || 0) + r.costUSD).toFixed(6);
    byModel[r.model] = (byModel[r.model] || { calls: 0, tokens: 0, cost: 0 });
    byModel[r.model].calls++;
    byModel[r.model].tokens += r.totalTokens;
    byModel[r.model].cost    = +((byModel[r.model].cost || 0) + r.costUSD).toFixed(6);
  });
  return {
    date: d, totalCalls: records.length,
    totalTokens: records.reduce((s, r) => s + r.totalTokens, 0),
    totalCostUSD: +totalCost.toFixed(4),
    budgetUsedPct: +(totalCost / BUDGET_LIMIT_DAILY * 100).toFixed(1),
    byPipeline, byModel,
    budgetLimitDaily: BUDGET_LIMIT_DAILY,
  };
}

function getMonthlyReport(yearMonth) {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const records = usageRecords.filter(r => r.date.startsWith(ym));
  const totalCost = records.reduce((s, r) => s + r.costUSD, 0);
  // 날짜별 집계
  const byDate = {};
  records.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { calls: 0, cost: 0 };
    byDate[r.date].calls++;
    byDate[r.date].cost = +((byDate[r.date].cost) + r.costUSD).toFixed(6);
  });
  return {
    yearMonth: ym, totalCalls: records.length,
    totalTokens: records.reduce((s, r) => s + r.totalTokens, 0),
    totalCostUSD: +totalCost.toFixed(4),
    budgetUsedPct: +(totalCost / BUDGET_LIMIT_MONTHLY * 100).toFixed(1),
    budgetLimitMonthly: BUDGET_LIMIT_MONTHLY,
    byDate,
    avgDailyCost: records.length ? +(totalCost / Object.keys(byDate).length).toFixed(4) : 0,
  };
}

function getTopPipelines(limit = 10) {
  const byPipeline = {};
  usageRecords.forEach(r => {
    if (!byPipeline[r.pipeline]) byPipeline[r.pipeline] = { calls: 0, tokens: 0, cost: 0 };
    byPipeline[r.pipeline].calls++;
    byPipeline[r.pipeline].tokens += r.totalTokens;
    byPipeline[r.pipeline].cost = +((byPipeline[r.pipeline].cost) + r.costUSD).toFixed(6);
  });
  return Object.entries(byPipeline)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, limit)
    .map(([name, stats]) => ({ name, ...stats }));
}

function getSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const ym    = today.slice(0, 7);
  const todayRecords  = usageRecords.filter(r => r.date === today);
  const monthRecords  = usageRecords.filter(r => r.date.startsWith(ym));
  return {
    today: {
      calls: todayRecords.length,
      tokens: todayRecords.reduce((s, r) => s + r.totalTokens, 0),
      costUSD: +todayRecords.reduce((s, r) => s + r.costUSD, 0).toFixed(4),
    },
    month: {
      calls: monthRecords.length,
      tokens: monthRecords.reduce((s, r) => s + r.totalTokens, 0),
      costUSD: +monthRecords.reduce((s, r) => s + r.costUSD, 0).toFixed(4),
    },
    total: {
      calls: usageRecords.length,
      tokens: usageRecords.reduce((s, r) => s + r.totalTokens, 0),
      costUSD: +usageRecords.reduce((s, r) => s + r.costUSD, 0).toFixed(4),
    },
    budgets: {
      daily:   { limit: BUDGET_LIMIT_DAILY,   used: +todayRecords.reduce((s,r) => s + r.costUSD, 0).toFixed(4) },
      monthly: { limit: BUDGET_LIMIT_MONTHLY, used: +monthRecords.reduce((s,r) => s + r.costUSD, 0).toFixed(4) },
    },
    topPipelines: getTopPipelines(5),
    modelPricing: MODEL_PRICING,
  };
}

// 샘플 데이터 시딩 (데모용)
function seedDemoData() {
  const pipelines = ['marketingPipeline','itSecurityPipeline','financeInvestPipeline','healthcarePipeline','ecommercePipeline'];
  const models    = ['gpt-4o-mini','gpt-4o','gpt-3.5-turbo','claude-3-5-haiku-20241022'];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 7);
    const d = new Date(now - daysAgo * 86400000).toISOString().slice(0, 10);
    const entry = {
      id: `demo-${i}`,
      userId: 'user-admin-001',
      pipeline: pipelines[Math.floor(Math.random() * pipelines.length)],
      model:    models[Math.floor(Math.random() * models.length)],
      inputTokens:  Math.floor(Math.random() * 2000) + 100,
      outputTokens: Math.floor(Math.random() * 1000) + 50,
      date: d, ts: new Date(now - daysAgo * 86400000 - Math.random() * 3600000).toISOString(),
      metadata: {},
    };
    entry.totalTokens = entry.inputTokens + entry.outputTokens;
    entry.costUSD = calcCost(entry.model, entry.inputTokens, entry.outputTokens);
    usageRecords.push(entry);
    if (!dailyCache[d]) dailyCache[d] = { totalTokens: 0, totalCost: 0, byModel: {}, byPipeline: {}, byUser: {} };
    dailyCache[d].totalTokens += entry.totalTokens;
    dailyCache[d].totalCost    = +((dailyCache[d].totalCost || 0) + entry.costUSD).toFixed(6);
  }
}
seedDemoData();

module.exports = {
  record, calcCost, onAlert,
  getDailyReport, getMonthlyReport, getTopPipelines, getSummary,
  MODEL_PRICING,
  _records: usageRecords,
};
