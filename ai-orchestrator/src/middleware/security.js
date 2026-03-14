'use strict';
/**
 * security.js – 보안 미들웨어 모음
 * helmet, CORS 강화, Rate Limit, JWT 만료 처리, 요청 검증, 쿼터 체크
 */

const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const cors = require('cors');

// ─── 1. Helmet (HTTP security headers) ───────────────────────────────────────
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],   // onclick= 등 인라인 이벤트 허용
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "http://144.172.93.226", "https://144.172.93.226"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false  // Socket.IO 호환
});

// ─── 2. CORS 강화 ─────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // 개발환경: origin 없는 요청(Postman, curl) 허용
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /\.sandbox\.novita\.ai$/.test(origin) ||
      /\.e2b\.dev$/.test(origin)
    ) return callback(null, true);
    callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400
};

const corsMiddleware = cors(corsOptions);

// ─── 3. Rate Limiters ─────────────────────────────────────────────────────────

/** 전역 제한: 1분당 300 요청 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
  skip: (req) => req.path === '/health'
});

/** Auth 엔드포인트: 1분당 20 요청 (brute-force 방지) */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many auth attempts. Try again in 1 minute.' }
});

/** AI 파이프라인: 사용자당 1분당 60 요청 (비용 제어) */
const pipelineLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?.userId;
    return userId ? String(userId) : ipKeyGenerator(req);
  },
  message: { success: false, error: 'AI rate limit exceeded (60/min). Please slow down.', code: 'RATE_LIMIT' }
});

/** 스트리밍: 사용자당 1분당 20 요청 (비용 제어 강화) */
const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?.userId;
    return userId ? String(userId) : ipKeyGenerator(req);
  },
  message: { success: false, error: 'Streaming rate limit exceeded (20/min).', code: 'RATE_LIMIT' }
});

/** 파일 업로드: 1분당 10 요청 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Upload rate limit exceeded.' }
});

// ─── 4. JWT 만료 / 에러 핸들러 ───────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'ai-orchestrator-jwt-secret-2024';

function verifyJWT(token) {
  try {
    return { valid: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { valid: false, expired: true, error: 'Token expired' };
    return { valid: false, expired: false, error: err.message };
  }
}

/**
 * requireAuth – JWT 또는 API Key 인증 미들웨어
 * Header: Authorization: Bearer <token>  또는  X-API-Key: <key>
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey     = req.headers['x-api-key'];

  if (apiKey) {
    const dbMod = require('./database');
    const user = dbMod.getUserByApiKey(apiKey);
    if (!user) return res.status(401).json({ success: false, error: 'Invalid API key' });
    req.user = user;
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  const { valid, expired, error, payload } = verifyJWT(token);

  if (!valid) {
    return res.status(401).json({
      success: false,
      error: expired ? 'Token expired. Please log in again.' : `Invalid token: ${error}`,
      expired: !!expired
    });
  }

  req.user = payload;
  next();
}

/**
 * optionalAuth – 인증 선택적 (공개 + 개인 혼합 경로)
 * 인증 실패 시 통과, 성공 시 req.user 설정
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey     = req.headers['x-api-key'];

  if (apiKey) {
    try {
      const dbMod = require('./database');
      const user = dbMod.getUserByApiKey(apiKey);
      if (user) req.user = user;
    } catch(e) {}
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { valid, payload } = verifyJWT(token);
    if (valid) req.user = payload;
  }
  next();
}

/**
 * requireRole – 역할 기반 접근 제어
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: `Access denied. Required roles: ${roles.join(', ')}` });
    }
    next();
  };
}

/**
 * checkQuota – 사용자 일일/비용 쿼터 체크
 * 쿼터 초과 시 429 반환, 통과 시 req.quotaInfo 설정
 */
function checkQuota(req, res, next) {
  if (!req.user) return next(); // 비인증 요청은 글로벌 rate limit으로만 제어
  try {
    const dbMod = require('./database');
    const userId = req.user.id || req.user.userId;
    const plan = req.user.plan || req.user.role || 'beta';
    const { allowed, quota, overDaily, overCost } = dbMod.checkQuota(userId, plan);
    req.quotaInfo = quota;
    if (!allowed) {
      const reason = overCost
        ? `일일 비용 한도 초과 ($${quota.cost_today.toFixed(4)} / $${quota.cost_limit_usd})`
        : `일일 요청 한도 초과 (${quota.used_today}/${quota.daily_limit})`;
      return res.status(429).json({
        success: false, error: reason, code: 'QUOTA_EXCEEDED',
        quota: { used: quota.used_today, limit: quota.daily_limit, costToday: quota.cost_today }
      });
    }
    next();
  } catch(e) {
    next(); // 쿼터 체크 실패 시 통과 (서비스 중단 방지)
  }
}

/**
 * incrementQuotaAfter – 응답 후 쿼터 증가 (미들웨어로 사용)
 * req.user가 있고 req._aiCostUsd가 설정된 경우 쿼터 업데이트
 */
function incrementQuotaAfter(req, res, next) {
  const origJson = res.json.bind(res);
  res.json = function(body) {
    // 응답 전에 쿼터 증가
    if (req.user) {
      try {
        const dbMod = require('./database');
        const userId = req.user.id || req.user.userId;
        const costUsd = req._aiCostUsd || (body && body.cost_usd) || 0;
        dbMod.incrementQuota(userId, costUsd);
      } catch(e) {}
    }
    return origJson(body);
  };
  next();
}

// ─── 5. 요청 검증 헬퍼 ────────────────────────────────────────────────────────

/** 기본 입력 살균 */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')          // XSS 기본 방어
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // 제어 문자
    .trim()
    .slice(0, 2048);               // 최대 길이
}

/** JSON 바디 필드 검증 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const val = req.body[field];
      if (rules.required && (val === undefined || val === null || val === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      if (val !== undefined) {
        if (rules.type && typeof val !== rules.type) errors.push(`${field} must be ${rules.type}`);
        if (rules.minLength && String(val).length < rules.minLength) errors.push(`${field} min length ${rules.minLength}`);
        if (rules.maxLength && String(val).length > rules.maxLength) errors.push(`${field} max length ${rules.maxLength}`);
        if (rules.pattern && !rules.pattern.test(String(val))) errors.push(`${field} format invalid`);
        if (rules.enum && !rules.enum.includes(val)) errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
    }
    if (errors.length) return res.status(400).json({ success: false, errors });
    next();
  };
}

// ─── 6. 보안 감사 로깅 미들웨어 ──────────────────────────────────────────────

function auditLog(action, resource) {
  return (req, res, next) => {
    const dbMod = require('./database');
    const userId = req.user?.id || req.user?.userId || null;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    dbMod.audit(userId, action, resource, { method: req.method, path: req.path, body: req.body }, ip);
    next();
  };
}

// ─── 7. 에러 핸들러 ───────────────────────────────────────────────────────────

function errorHandler(err, req, res, next) {
  // CORS 에러
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: err.message });
  }
  // JWT 에러 (verifyToken 중간에서 throw된 경우)
  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
  // Multer 에러 (파일 업로드)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, error: 'File too large. Max 10MB.' });
  }
  // 기본 에러
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
}

module.exports = {
  helmet: helmetMiddleware,
  cors: corsMiddleware,
  globalLimiter,
  authLimiter,
  pipelineLimiter,
  streamLimiter,
  uploadLimiter,
  requireAuth,
  optionalAuth,
  requireRole,
  checkQuota,
  incrementQuotaAfter,
  sanitize,
  validate,
  auditLog,
  errorHandler,
  verifyJWT
};
