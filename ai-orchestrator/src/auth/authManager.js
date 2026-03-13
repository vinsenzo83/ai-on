'use strict';
/**
 * authManager.js — Phase 7B: JWT 기반 인증 시스템
 * - 회원가입 / 로그인 / 토큰 갱신
 * - API Key 발급 및 검증
 * - Rate Limiting (요청별 쿼터)
 * DB 없이 in-memory store 사용 (PostgreSQL 연동 시 교체 가능)
 */
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET  || 'ai-orch-jwt-secret-phase7-' + Date.now();
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';
const SALT_ROUNDS = 10;

// ── In-Memory User Store ──────────────────────────────────────
const users   = new Map();  // userId → user object
const apiKeys = new Map();  // apiKey → userId
const sessions = new Map(); // token → { userId, exp }

// 기본 admin 계정 생성
(async () => {
  const adminPw = await bcrypt.hash('admin1234', SALT_ROUNDS);
  const adminId = 'user-admin-001';
  users.set(adminId, {
    id: adminId, email: 'admin@ai-orch.io', name: 'Admin',
    passwordHash: adminPw, role: 'admin',
    plan: 'enterprise', quota: { daily: 10000, used: 0 },
    createdAt: new Date().toISOString(),
    apiKeys: [], lastLogin: null,
  });
  // admin API key
  const key = 'oai-' + crypto.randomBytes(24).toString('hex');
  apiKeys.set(key, adminId);
  users.get(adminId).apiKeys.push(key);
})();

// ── Usage Tracker ─────────────────────────────────────────────
const usageLog = []; // 최근 1000개

function trackUsage(userId, pipeline, tokens, costUSD) {
  const entry = {
    userId, pipeline, tokens, costUSD,
    ts: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
  };
  usageLog.push(entry);
  if (usageLog.length > 1000) usageLog.shift();

  // 사용자 quota 업데이트
  const u = users.get(userId);
  if (u) u.quota.used += tokens;
  return entry;
}

function getUsageSummary(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const userLogs = userId ? usageLog.filter(l => l.userId === userId) : usageLog;
  const todayLogs = userLogs.filter(l => l.date === today);
  const totalCost = userLogs.reduce((s, l) => s + (l.costUSD || 0), 0);
  const todayCost = todayLogs.reduce((s, l) => s + (l.costUSD || 0), 0);
  const byPipeline = {};
  userLogs.forEach(l => {
    if (!byPipeline[l.pipeline]) byPipeline[l.pipeline] = { calls: 0, tokens: 0, cost: 0 };
    byPipeline[l.pipeline].calls++;
    byPipeline[l.pipeline].tokens += l.tokens || 0;
    byPipeline[l.pipeline].cost   += l.costUSD || 0;
  });
  return {
    totalCalls: userLogs.length, todayCalls: todayLogs.length,
    totalTokens: userLogs.reduce((s, l) => s + (l.tokens || 0), 0),
    totalCostUSD: +totalCost.toFixed(4),
    todayCostUSD: +todayCost.toFixed(4),
    byPipeline,
    recentLogs: userLogs.slice(-20).reverse(),
  };
}

// ── Auth Functions ────────────────────────────────────────────
async function register({ email, password, name }) {
  if (!email || !password) throw new Error('이메일과 비밀번호를 입력하세요.');
  for (const [, u] of users) {
    if (u.email === email) throw new Error('이미 사용 중인 이메일입니다.');
  }
  const id = 'user-' + crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = {
    id, email, name: name || email.split('@')[0],
    passwordHash, role: 'user',
    plan: 'free', quota: { daily: 1000, used: 0 },
    createdAt: new Date().toISOString(),
    apiKeys: [], lastLogin: null,
  };
  users.set(id, user);
  const token = _issueToken(user);
  return { userId: id, email, name: user.name, token, role: user.role, plan: user.plan };
}

async function login({ email, password }) {
  // email 또는 name(username)으로 사용자 검색
  const user = Array.from(users.values()).find(u => u.email === email || u.name === email);
  if (!user) throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok)   throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  user.lastLogin = new Date().toISOString();
  const token = _issueToken(user);
  return { userId: user.id, email: user.email, name: user.name, token, role: user.role, plan: user.plan };
}

function _issueToken(user) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) { return null; }
}

function generateApiKey(userId) {
  const user = users.get(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const key = 'oai-' + crypto.randomBytes(24).toString('hex');
  apiKeys.set(key, userId);
  user.apiKeys.push(key);
  return { apiKey: key, createdAt: new Date().toISOString() };
}

function verifyApiKey(key) {
  const userId = apiKeys.get(key);
  if (!userId) return null;
  return users.get(userId) || null;
}

function getProfile(userId) {
  const u = users.get(userId);
  if (!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}

// ── Express Middleware ────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  if (apiKeyHeader) {
    const user = verifyApiKey(apiKeyHeader);
    if (!user) return res.status(401).json({ error: 'API 키가 유효하지 않습니다.' });
    req.user = { sub: user.id, email: user.email, role: user.role };
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: '토큰이 유효하지 않습니다.' });
    req.user = payload;
    return next();
  }

  return res.status(401).json({ error: '인증이 필요합니다. Authorization 헤더 또는 X-API-Key를 제공하세요.' });
}

function optionalAuth(req, res, next) {
  const authHeader  = req.headers['authorization'];
  const apiKeyHdr   = req.headers['x-api-key'];
  if (apiKeyHdr) {
    const user = verifyApiKey(apiKeyHdr);
    if (user) req.user = { sub: user.id, email: user.email, role: user.role };
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyToken(authHeader.slice(7));
    if (payload) req.user = payload;
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '인증 필요' });
    if (req.user.role !== role && req.user.role !== 'admin')
      return res.status(403).json({ error: '권한이 없습니다.' });
    next();
  };
}

module.exports = {
  register, login, verifyToken, verifyApiKey,
  generateApiKey, getProfile,
  trackUsage, getUsageSummary,
  authMiddleware, optionalAuth, requireRole,
  // for testing
  _users: users, _apiKeys: apiKeys,
};
