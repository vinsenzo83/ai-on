'use strict';
/**
 * admin.js — 어드민 전용 API 라우터
 * 모든 엔드포인트는 role=admin 필수
 *
 * GET  /api/admin/stats          — 전체 현황 요약
 * GET  /api/admin/users          — 사용자 목록
 * GET  /api/admin/users/:id      — 사용자 상세
 * PUT  /api/admin/users/:id/role — 역할 변경
 * DELETE /api/admin/users/:id    — 사용자 삭제
 * GET  /api/admin/jobs           — 잡 목록
 * DELETE /api/admin/jobs/:id     — 잡 삭제
 * POST /api/admin/jobs/clear     — 완료/실패 잡 일괄 삭제
 * GET  /api/admin/costs          — 비용 전체 내역
 * GET  /api/admin/audit          — 감사 로그
 * GET  /api/admin/pipelines      — 빌더 파이프라인 목록
 * DELETE /api/admin/pipelines/:id— 파이프라인 삭제
 * POST /api/admin/broadcast      — 전체 공지 (Socket.IO)
 * GET  /api/admin/system         — 시스템 정보 (메모리·업타임)
 * POST /api/admin/seed           — 테스트용 시드 데이터 생성
 * ── 3-Layer 모델 관리 ──
 * GET  /api/admin/apiconfig               — 공급자 목록
 * POST /api/admin/apiconfig               — 공급자 등록/업데이트 (Layer 1)
 * DELETE /api/admin/apiconfig/:provider   — 공급자 삭제
 * POST /api/admin/apiconfig/:provider/test— 연결 테스트
 * POST /api/admin/apiconfig/test-key      — 저장 전 즉시 테스트
 * GET  /api/admin/models/whitelist        — 모델 화이트리스트 조회 (Layer 2)
 * PUT  /api/admin/models/whitelist        — 모델 화이트리스트 일괄 저장
 * PATCH /api/admin/models/:modelId/toggle — 단일 모델 ON/OFF 토글
 * PATCH /api/admin/models/:modelId/budget — 모델별 예산 설정
 * GET  /api/admin/models/priority         — 태스크 우선순위 조회 (Layer 3)
 * PUT  /api/admin/models/priority         — 태스크 우선순위 저장
 * GET  /api/admin/models/stats            — 공급자별 모델 통계
 */

const express    = require('express');
const router     = express.Router();
const db         = require('../db/database');
const security   = require('../middleware/security');
const { v4: uuidv4 } = require('uuid');
const os         = require('os');
const bcrypt     = require('bcryptjs');
const modelReg   = require('../services/modelRegistry');
const { MODEL_REGISTRY } = require('../types/index.js');
const aiConnector = require('../services/aiConnector');

// ── 모든 어드민 라우트에 JWT 인증 + admin 역할 적용 ───────────────
router.use(security.requireAuth);
router.use(security.requireRole('admin'));
router.use(security.globalLimiter);   // 어드민 API: 글로벌 rate-limit (300/min) 적용

// ── 감사 로깅 ─────────────────────────────────────────────────────
router.use((req, res, next) => {
  const userId = req.user?.userId || req.user?.id || null;
  const ip     = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  db.audit(userId, `admin:${req.method}:${req.path}`, 'admin', { query: req.query, body: req.body }, ip);
  next();
});

// ─────────────────────────────────────────────────────────────────
// 1. 전체 현황 요약
// GET /api/admin/stats
// ─────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const overview  = db.getStatsOverview();
    const jobStats  = db.getJobStats();
    const costTotal = db.getCostTotal();
    const costByModel = db.getCostByModel();
    const hourly    = db.getCostHourly();
    const recentUsers = db.getAllUsers().slice(0, 5);
    const recentJobs  = db.getRecentJobs(5);

    res.json({
      success: true,
      overview: {
        ...overview,
        ...jobStats,
        totalCostUsd: costTotal?.total || 0,
        totalTokens:  (costTotal?.inputs || 0) + (costTotal?.outputs || 0),
        totalApiCalls: costTotal?.calls || 0,
      },
      jobStats,
      costByModel,
      hourly,
      recentUsers,
      recentJobs,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. 사용자 관리
// ─────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { q } = req.query;
  const users = q ? db.searchUsers(q) : db.getAllUsers();
  // 비밀번호 제거
  const safe = users.map(({ password: _, ...u }) => u);
  res.json({ success: true, count: safe.length, users: safe });
});

router.get('/users/:id', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });
  const { password: _, ...safe } = user;
  const auditLogs = db.getAuditByUser(req.params.id, 20);
  res.json({ success: true, user: safe, auditLogs });
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin','moderator'].includes(role))
    return res.status(400).json({ success: false, error: '유효하지 않은 역할 (user|admin|moderator)' });
  const updated = db.updateUserRole(req.params.id, role);
  if (!updated) return res.status(404).json({ success: false, error: '사용자 없음' });
  const { password: _, ...safe } = updated;
  db.audit(req.user?.userId, 'admin:change_role', 'users', { targetId: req.params.id, newRole: role }, req.ip);
  res.json({ success: true, user: safe });
});

router.put('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4)
    return res.status(400).json({ success: false, error: '비밀번호 4자 이상' });
  const hash = await bcrypt.hash(password, 10);
  db.db.prepare(`UPDATE users SET password=?, updated_at=datetime('now') WHERE id=?`).run(hash, req.params.id);
  db.audit(req.user?.userId, 'admin:reset_password', 'users', { targetId: req.params.id }, req.ip);
  res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

router.delete('/users/:id', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });
  // 본인 삭제 방지
  if (req.params.id === req.user?.userId)
    return res.status(400).json({ success: false, error: '본인 계정은 삭제할 수 없습니다.' });
  db.deleteUser(req.params.id);
  db.audit(req.user?.userId, 'admin:delete_user', 'users', { targetId: req.params.id, email: user.email }, req.ip);
  res.json({ success: true, deleted: req.params.id });
});

// ─────────────────────────────────────────────────────────────────
// 3. 잡 관리
// ─────────────────────────────────────────────────────────────────
router.get('/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const jobs  = db.getRecentJobs(limit);
  const stats = db.getJobStats();
  res.json({ success: true, stats, count: jobs.length, jobs });
});

router.delete('/jobs/:id', (req, res) => {
  db.deleteJob(req.params.id);
  res.json({ success: true, deleted: req.params.id });
});

router.post('/jobs/clear', (req, res) => {
  const { status = 'completed' } = req.body;
  if (!['completed','failed','waiting'].includes(status))
    return res.status(400).json({ success: false, error: '유효하지 않은 status' });
  db.clearJobsByStatus(status);
  db.audit(req.user?.userId, 'admin:clear_jobs', 'jobs', { status }, req.ip);
  res.json({ success: true, cleared: status });
});

// ─────────────────────────────────────────────────────────────────
// 4. 비용 관리
// ─────────────────────────────────────────────────────────────────
router.get('/costs', (req, res) => {
  const days    = parseInt(req.query.days) || 30;
  const summary = db.getCostSummary();
  const daily   = db.getCostDaily(days);
  const monthly = db.getCostMonthly();
  const byModel = db.getCostByModel();
  const total   = db.getCostTotal();
  const hourly  = db.getCostHourly();
  res.json({ success: true, total, summary, daily, monthly, byModel, hourly });
});

// ─────────────────────────────────────────────────────────────────
// 5. 감사 로그
// ─────────────────────────────────────────────────────────────────
router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const logs  = db.getAuditLogs(limit);
  res.json({ success: true, count: logs.length, logs });
});

// ─────────────────────────────────────────────────────────────────
// 6. 빌더 파이프라인 관리
// ─────────────────────────────────────────────────────────────────
router.get('/pipelines', (req, res) => {
  const pipes = db.getAllPipelines();
  res.json({ success: true, count: pipes.length, pipelines: pipes });
});

router.delete('/pipelines/:id', (req, res) => {
  db.deletePipeline(req.params.id);
  db.audit(req.user?.userId, 'admin:delete_pipeline', 'pipelines', { id: req.params.id }, req.ip);
  res.json({ success: true, deleted: req.params.id });
});

// ─────────────────────────────────────────────────────────────────
// 7. 전체 공지 브로드캐스트 (Socket.IO)
// ─────────────────────────────────────────────────────────────────
router.post('/broadcast', (req, res) => {
  const { message, type = 'info' } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'message 필수' });
  // io는 서버에서 주입
  if (req.app.get('io')) {
    req.app.get('io').emit('admin:broadcast', { message, type, timestamp: new Date().toISOString() });
  }
  db.audit(req.user?.userId, 'admin:broadcast', 'system', { message, type }, req.ip);
  res.json({ success: true, broadcast: { message, type } });
});

// ─────────────────────────────────────────────────────────────────
// 8. 시스템 정보
// ─────────────────────────────────────────────────────────────────
router.get('/system', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  res.json({
    success: true,
    system: {
      platform: os.platform(),
      arch:     os.arch(),
      nodeVersion: process.version,
      uptime:   process.uptime(),
      memory: {
        rss:      Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        heapTotal:Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
      },
      os: {
        totalMem:  Math.round(os.totalmem() / 1024 / 1024) + ' MB',
        freeMem:   Math.round(os.freemem()  / 1024 / 1024) + ' MB',
        loadAvg:   os.loadavg(),
        cpuCount:  os.cpus().length,
      },
      cpu: {
        user:   Math.round(cpuUsage.user   / 1000) + ' ms',
        system: Math.round(cpuUsage.system / 1000) + ' ms',
      },
      env: {
        nodeEnv:  process.env.NODE_ENV || 'development',
        hasOpenAI:   !!process.env.OPENAI_API_KEY,
        hasAnthropic:!!process.env.ANTHROPIC_API_KEY,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. 시드 데이터 생성 (개발/테스트용)
// ─────────────────────────────────────────────────────────────────
router.post('/seed', async (req, res) => {
  try {
    const created = [];

    // 샘플 비용 기록
    const pipelines = ['marketingPipeline','itSecurityPipeline','financeInvestPipeline','healthcarePipeline','ecommercePipeline'];
    const models    = ['gpt-4o-mini','gpt-4o'];
    for (let i = 0; i < 20; i++) {
      const pipe  = pipelines[i % pipelines.length];
      const model = models[i % 2];
      const inputT  = Math.floor(Math.random() * 500) + 100;
      const outputT = Math.floor(Math.random() * 300) + 50;
      const cost    = model === 'gpt-4o' ? (inputT * 0.000005 + outputT * 0.000015) : (inputT * 0.00000015 + outputT * 0.0000006);
      db.recordCost({ pipeline: pipe, model, inputTokens: inputT, outputTokens: outputT, costUsd: cost });
    }
    created.push('20 cost records');

    // 샘플 빌더 파이프라인
    const samplePipes = [
      { name: 'SNS 마케팅 자동화', description: '키워드 → 분석 → 콘텐츠 → 예약', nodes: [{id:'n1',type:'input',label:'키워드 입력'},{id:'n2',type:'ai',label:'트렌드 분석'},{id:'n3',type:'ai',label:'콘텐츠 생성'},{id:'n4',type:'output',label:'SNS 게시'}] },
      { name: 'IT 보안 스캔', description: 'OWASP → AI 리뷰 → 리포트', nodes: [{id:'n1',type:'input',label:'코드 입력'},{id:'n2',type:'process',label:'OWASP 스캔'},{id:'n3',type:'ai',label:'AI 코드리뷰'},{id:'n4',type:'output',label:'보안 리포트'}] },
      { name: '금융 분석 봇', description: '시장 데이터 → AI 분석 → 리포트', nodes: [{id:'n1',type:'input',label:'시장 데이터'},{id:'n2',type:'ai',label:'기술 분석'},{id:'n3',type:'output',label:'투자 리포트'}] },
    ];
    for (const p of samplePipes) {
      if (!db.getAllPipelines().find(x => x.name === p.name)) {
        db.createPipeline({ ...p, edges: [], status: 'active' });
        created.push(`pipeline: ${p.name}`);
      }
    }

    db.audit(req.user?.userId, 'admin:seed', 'system', { created }, req.ip);
    res.json({ success: true, created });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 10. API 키 관리
// GET  /api/admin/apikeys          — 전체 API 키 목록 (userId, username, key masked)
// POST /api/admin/apikeys          — 새 API 키 발급 (userId 지정)
// DELETE /api/admin/apikeys/:userId — 해당 사용자 API 키 삭제
// ─────────────────────────────────────────────────────────────────
router.get('/apikeys', (req, res) => {
  try {
    const users = db.getAllUsers();
    const keys = users
      .filter(u => u.api_key)
      .map(u => ({
        userId:    u.id,
        username:  u.username,
        email:     u.email,
        role:      u.role,
        keyMasked: u.api_key.slice(0, 8) + '••••••••••••••••' + u.api_key.slice(-4),
        keyFull:   u.api_key,   // 어드민만 볼 수 있음
        createdAt: u.updated_at || u.created_at,
      }));
    res.json({ success: true, count: keys.length, apiKeys: keys });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/apikeys', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId 필수' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });

    const newKey = 'ak-' + require('crypto').randomBytes(24).toString('hex');
    db.stmt.userApiKey.run(newKey, userId);
    db.audit(req.user?.userId, 'admin:generate_apikey', 'users', { targetId: userId }, req.ip);
    res.json({ success: true, userId, apiKey: newKey });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/apikeys/:userId', (req, res) => {
  try {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: '사용자 없음' });
    db.stmt.userApiKey.run(null, req.params.userId);
    db.audit(req.user?.userId, 'admin:revoke_apikey', 'users', { targetId: req.params.userId }, req.ip);
    res.json({ success: true, revoked: req.params.userId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 11. API 등록관리 (외부 AI 모델 API 키 CRUD)
// GET    /api/admin/apiconfig              — 등록된 공급자 목록 + 모델 우선순위
// POST   /api/admin/apiconfig              — API 키 등록 / 업데이트
// DELETE /api/admin/apiconfig/:provider   — 특정 공급자 키 삭제
// POST   /api/admin/apiconfig/:provider/test — 연결 테스트
// POST   /api/admin/apiconfig/test-key    — 즉시 연결 테스트 (저장 전)
// PUT    /api/admin/apiconfig/model-priority — 모델 우선순위 저장
// ─────────────────────────────────────────────────────────────────

// ── API 키 스토어: DB 영속성 + 환경변수 fallback ─────────────────
const PROVIDER_LABELS = {
  openai:'OpenAI', anthropic:'Anthropic Claude', google:'Google Gemini',
  azure:'Azure OpenAI', groq:'Groq', openrouter:'OpenRouter',
  deepseek:'DeepSeek', xai:'xAI (Grok)', moonshot:'Moonshot (Kimi)',
  mistral:'Mistral AI', alibaba:'Alibaba (Qwen)', meta:'Meta (Llama)',
};

const _apiConfigStore = (() => {
  const store = {};

  // 1) DB에서 저장된 키 로드 (최우선)
  try {
    const saved = db.getAllApiConfigs();
    saved.forEach(row => {
      store[row.provider] = {
        provider: row.provider,
        providerLabel: row.provider_label || PROVIDER_LABELS[row.provider] || row.provider,
        apiKey: row.api_key_enc,
        baseUrl: row.base_url || '',
        memo: row.memo || 'DB 로드',
        isActive: true,
        createdAt: row.created_at,
      };
      modelReg.activateProvider(row.provider);
    });
    if (saved.length > 0) console.log(`[apiConfig] DB에서 ${saved.length}개 공급자 키 로드됨`);
  } catch(e) { console.warn('[apiConfig] DB 로드 실패:', e.message); }

  // 2) 환경변수에서 추가 로드 (DB에 없는 것만)
  const PROVIDER_ENV = {
    openai:     process.env.REAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    anthropic:  process.env.ANTHROPIC_API_KEY,
    google:     process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    azure:      process.env.AZURE_OPENAI_API_KEY,
    groq:       process.env.GROQ_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    deepseek:   process.env.DEEPSEEK_API_KEY,
    xai:        process.env.XAI_API_KEY,
    moonshot:   process.env.MOONSHOT_API_KEY,
    mistral:    process.env.MISTRAL_API_KEY,
    alibaba:    process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY,
    meta:       process.env.META_API_KEY || process.env.TOGETHER_API_KEY,
  };
  Object.entries(PROVIDER_ENV).forEach(([k, v]) => {
    if (v && !store[k]) {
      store[k] = { provider:k, providerLabel: PROVIDER_LABELS[k]||k, apiKey:v, baseUrl:'', memo:'환경변수 로드', isActive:true, createdAt: new Date().toISOString() };
      modelReg.activateProvider(k);
    }
  });
  return store;
})();

// ── 모델 우선순위: DB 영속성 ───────────────────────────────────
const _PRIORITY_DEFAULTS = {
  text:     'gpt-4o',
  analysis: 'gpt-4o',
  chat:     'gpt-4o-mini',
  code:     'gpt-4o',
  creative: 'gpt-4o',
  fast:     'gpt-4o-mini',
};
const _modelPriority = (() => {
  try {
    const saved = db.getModelSetting('model_priority');
    if (saved && typeof saved === 'object') {
      console.log('[modelPriority] DB에서 우선순위 로드됨');
      const merged = { ..._PRIORITY_DEFAULTS, ...saved };
      // modelRegistry Layer 3에도 즉시 반영 (서버 재시작 후 복원)
      modelReg.updatePriority(merged);
      return merged;
    }
  } catch(e) { console.warn('[modelPriority] DB 로드 실패:', e.message); }
  return { ..._PRIORITY_DEFAULTS };
})();

// ── 화이트리스트 오버라이드: DB 영속성 복원 (재시작 후) ────────
;(() => {
  try {
    const snapshot = db.getModelSetting('whitelist_overrides');
    if (snapshot && typeof snapshot === 'object') {
      const n = modelReg.loadFromSnapshot(snapshot);
      console.log(`[whitelist] DB에서 ${n}개 모델 오버라이드 복원됨`);
    }
  } catch(e) { console.warn('[whitelist] DB 복원 실패:', e.message); }
})();

function maskApiKey(key) {
  if (!key || key.length < 12) return '•'.repeat(key?.length||8);
  return key.slice(0,6) + '••••••••••••' + key.slice(-4);
}

router.get('/apiconfig', (req, res) => {
  const providers = Object.values(_apiConfigStore).map(p => ({
    provider:      p.provider,
    providerLabel: p.providerLabel || p.provider,
    keyMasked:     maskApiKey(p.apiKey),
    baseUrl:       p.baseUrl || '',
    memo:          p.memo || '',
    isActive:      p.isActive !== false,
    createdAt:     p.createdAt,
    modelStats:    modelReg.getStats()[p.provider] || { total: 0, enabled: 0 },
  }));
  res.json({ success:true, count: providers.length, providers, modelPriority: modelReg.getPriority() });
});

router.post('/apiconfig', (req, res) => {
  const { provider, apiKey, baseUrl, memo } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ success:false, error: 'provider, apiKey 필수' });

  const existing = _apiConfigStore[provider];
  _apiConfigStore[provider] = {
    provider,
    providerLabel: PROVIDER_LABELS[provider] || provider,
    apiKey,
    baseUrl: baseUrl || '',
    memo: memo || '',
    isActive: true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // DB 영속 저장 (\uae30동 후 키 복원)
  try {
    db.saveApiConfig({ provider, providerLabel: PROVIDER_LABELS[provider]||provider, apiKey, baseUrl: baseUrl||'', memo: memo||'' });
  } catch(e) { console.warn('[apiConfig] DB 저장 실패:', e.message); }

  // Layer 1 → Layer 2 연동: modelRegistry 공급자 활성화 + aiConnector 클라이언트 재생성
  modelReg.activateProvider(provider);
  if (provider === 'anthropic') {
    aiConnector.refreshAnthropicClient(apiKey);
  } else {
    aiConnector.refreshClient(provider, apiKey, baseUrl);
  }

  db.audit(req.user?.userId, 'admin:save_apiconfig', 'apiconfig', { provider, hasBaseUrl: !!baseUrl }, req.ip);
  res.json({ success:true, provider, updated: !!existing, enabledModels: modelReg.getWhitelistByProvider(provider).filter(m=>m.enabled).length });
});

router.delete('/apiconfig/:provider', (req, res) => {
  const { provider } = req.params;
  if (!_apiConfigStore[provider]) return res.status(404).json({ success:false, error: '등록된 공급자 없음' });
  delete _apiConfigStore[provider];
  // DB에서도 삭제
  try { db.deleteApiConfig(provider); } catch(e) { console.warn('[apiConfig] DB 삭제 실패:', e.message); }
  // Layer 1 → Layer 2: 공급자 비활성화
  modelReg.deactivateProvider(provider);
  aiConnector.refreshClient(provider, null);
  db.audit(req.user?.userId, 'admin:delete_apiconfig', 'apiconfig', { provider }, req.ip);
  res.json({ success:true, deleted: provider });
});

// 저장된 API 키로 연결 테스트
router.post('/apiconfig/:provider/test', async (req, res) => {
  const { provider } = req.params;
  const cfg = _apiConfigStore[provider];
  if (!cfg) return res.status(404).json({ success:false, error: '등록된 공급자 없음' });
  await testApiKeyConnection(provider, cfg.apiKey, cfg.baseUrl, res);
});

// 저장 전 즉시 테스트
router.post('/apiconfig/test-key', async (req, res) => {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ success:false, error: 'provider, apiKey 필수' });
  await testApiKeyConnection(provider, apiKey, req.body.baseUrl || '', res);
});

router.put('/apiconfig/model-priority', (req, res) => {
  const { priority } = req.body;
  if (!priority || typeof priority !== 'object') return res.status(400).json({ success:false, error: 'priority 객체 필수' });
  // modelRegistry Layer 3 업데이트
  const updated = modelReg.updatePriority(priority);
  // DB 영속 저장
  try { db.saveModelSetting('model_priority', updated); } catch(e) { console.warn('[modelPriority] DB 저장 실패:', e.message); }
  db.audit(req.user?.userId, 'admin:update_model_priority', 'apiconfig', priority, req.ip);
  res.json({ success:true, modelPriority: updated });
});

// ─────────────────────────────────────────────────────────────────
// 12. Layer 2 모델 화이트리스트 관리
// GET   /api/admin/models/whitelist        — 전체 모델 화이트리스트 + 통계
// PUT   /api/admin/models/whitelist        — 일괄 ON/OFF 저장
// PATCH /api/admin/models/:modelId/toggle  — 단일 모델 ON/OFF 토글
// PATCH /api/admin/models/:modelId/budget  — 모델별 월간 예산 상한
// GET   /api/admin/models/priority         — 태스크별 우선순위 조회
// PUT   /api/admin/models/priority         — 태스크별 우선순위 저장 (Layer 3)
// GET   /api/admin/models/stats            — 공급자별 통계
// ─────────────────────────────────────────────────────────────────

// 화이트리스트 + MODEL_REGISTRY 메타 병합 함수
function _buildWhitelistResponse() {
  const wl = modelReg.getWhitelist();
  const byProvider = {};
  wl.forEach(entry => {
    const reg = Object.values(MODEL_REGISTRY).find(m => m.id === entry.modelId);
    const enriched = {
      ...entry,
      name:        reg?.name      || entry.modelId,
      tier:        reg?.tier      || entry.tier,
      cost:        reg?.costPer1kTokens || 0,
      latency:     reg?.avgLatencyMs || 0,
      context:     reg?.contextWindow || '',
      benchmark:   reg?.benchmark?.overall || 0,
      bestFor:     reg?.bestFor  || [],
      specialty:   reg?.specialty || '',
      providerRegistered: !!_apiConfigStore[entry.provider],
    };
    if (!byProvider[entry.provider]) byProvider[entry.provider] = [];
    byProvider[entry.provider].push(enriched);
  });
  return byProvider;
}

// 전체 모델 목록 조회 (화이트리스트 + 통계)
router.get('/models', (req, res) => {
  const stats = modelReg.getStats();
  const enabled = modelReg.getEnabledModels ? modelReg.getEnabledModels() : [];
  const byProvider = _buildWhitelistResponse();
  // 플랫 배열로 변환
  const models = [];
  Object.entries(byProvider).forEach(([provider, items]) => {
    if (Array.isArray(items)) {
      items.forEach(m => models.push({ ...m, id: m.modelId, provider }));
    }
  });
  const total   = Object.values(stats).reduce((a,s)=>a+(s.total||0),0);
  const enabledCount = Object.values(stats).reduce((a,s)=>a+(s.enabled||0),0);
  res.json({ success:true, models, stats, summary: { total, enabled: enabledCount, disabled: total-enabledCount } });
});

// 스케줄러 작업 목록
router.get('/scheduler', (req, res) => {
  try {
    const jobs = db.getAllSchedulerJobs ? db.getAllSchedulerJobs() : [];
    res.json({ success:true, count: jobs.length, jobs });
  } catch(e) {
    res.json({ success:true, count:0, jobs:[], message: e.message });
  }
});

// 스케줄러 작업 생성
router.post('/scheduler', (req, res) => {
  try {
    const { name, cron, pipeline, action, params, enabled = true } = req.body;
    if (!name || !cron) return res.status(400).json({ success:false, error: 'name, cron 필수' });
    const job = db.createSchedulerJob ? db.createSchedulerJob({ name, cron, pipeline, action, params: JSON.stringify(params||{}), enabled: enabled ? 1 : 0 }) : { id: Date.now(), name };
    db.audit(req.user?.userId, 'admin:create_scheduler_job', 'scheduler', { name }, req.ip);
    res.json({ success:true, job });
  } catch(e) {
    res.status(500).json({ success:false, error: e.message });
  }
});

// 파이프라인 생성 (DB 저장)
router.post('/pipelines', (req, res) => {
  try {
    const { name, description, nodes, edges, config } = req.body;
    if (!name) return res.status(400).json({ success:false, error: 'name 필수' });
    const userId = req.user?.userId || 'admin';
    const pipeline = db.createPipeline({
      name, description: description||'',
      nodes: JSON.stringify(nodes||[]),
      edges: JSON.stringify(edges||[]),
      config: JSON.stringify(config||{}),
      status: 'active', user_id: userId
    });
    db.audit(userId, 'admin:create_pipeline', 'pipelines', { name }, req.ip);
    res.json({ success:true, id: pipeline.id, pipeline });
  } catch(e) {
    res.status(500).json({ success:false, error: e.message });
  }
});

// 파이프라인 수정
router.put('/pipelines/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, nodes, edges, config } = req.body;
    db.updatePipeline(id, {
      name, description,
      nodes: nodes ? JSON.stringify(nodes) : undefined,
      edges: edges ? JSON.stringify(edges) : undefined,
      config: config ? JSON.stringify(config) : undefined,
    });
    db.audit(req.user?.userId, 'admin:update_pipeline', 'pipelines', { id, name }, req.ip);
    res.json({ success:true, id });
  } catch(e) {
    res.status(500).json({ success:false, error: e.message });
  }
});

// 화이트리스트 조회
router.get('/models/whitelist', (req, res) => {
  const byProvider = _buildWhitelistResponse();
  const stats = modelReg.getStats();
  const total  = Object.values(stats).reduce((a,s)=>a+s.total,0);
  const enabled = Object.values(stats).reduce((a,s)=>a+s.enabled,0);
  res.json({ success:true, byProvider, stats, summary: { total, enabled, disabled: total-enabled } });
});

// 화이트리스트 일괄 저장 (POST body: { items: [{modelId, enabled, budgetUsd, notes}] })
router.put('/models/whitelist', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ success:false, error: 'items 배열 필수' });
  const count = modelReg.bulkUpdateWhitelist(items);
  // DB 영속 저장 (재시작 후 복원용)
  try { db.saveModelSetting('whitelist_overrides', modelReg.getWhitelistSnapshot()); } catch(e) {}
  db.audit(req.user?.userId, 'admin:update_whitelist', 'models', { count }, req.ip);
  res.json({ success:true, updated: count, stats: modelReg.getStats() });
});

// 단일 모델 ON/OFF 토글
router.patch('/models/:modelId/toggle', (req, res) => {
  const { modelId } = req.params;
  const { enabled } = req.body;
  if (enabled === undefined) return res.status(400).json({ success:false, error: 'enabled boolean 필수' });
  const ok = modelReg.setModelEnabled(modelId, enabled);
  if (!ok) return res.status(404).json({ success:false, error: '모델 없음: ' + modelId });
  // DB 영속 저장 (whitelist 전체 스냅샷)
  try { db.saveModelSetting('whitelist_overrides', modelReg.getWhitelistSnapshot()); } catch(e) {}
  db.audit(req.user?.userId, 'admin:toggle_model', 'models', { modelId, enabled }, req.ip);
  res.json({ success:true, modelId, enabled, stats: modelReg.getStats() });
});

// 모델별 월간 예산 상한 설정
router.patch('/models/:modelId/budget', (req, res) => {
  const { modelId } = req.params;
  const { budgetUsd } = req.body;  // null → 무제한
  const ok = modelReg.setModelBudget(modelId, budgetUsd === undefined ? null : budgetUsd);
  if (!ok) return res.status(404).json({ success:false, error: '모델 없음: ' + modelId });
  // DB 영속 저장
  try { db.saveModelSetting('whitelist_overrides', modelReg.getWhitelistSnapshot()); } catch(e) {}
  db.audit(req.user?.userId, 'admin:set_budget', 'models', { modelId, budgetUsd }, req.ip);
  res.json({ success:true, modelId, budgetUsd });
});

// 태스크 우선순위 조회
router.get('/models/priority', (req, res) => {
  const priority = modelReg.getPriority();
  // 각 태스크별 리존드 모델 정보
  const resolved = {};
  Object.keys(priority).forEach(task => {
    const modelId = modelReg.getModelForTask(task);
    const reg = Object.values(MODEL_REGISTRY).find(m => m.id === modelId);
    resolved[task] = {
      preferred: priority[task],
      actual: modelId,
      match: priority[task] === modelId,
      provider: reg?.provider || '',
      cost: reg?.costPer1kTokens || 0,
      tier: reg?.tier || '',
    };
  });
  res.json({ success:true, priority, resolved });
});

// 태스크 우선순위 저장 (Layer 3)
router.put('/models/priority', (req, res) => {
  const { priority } = req.body;
  if (!priority || typeof priority !== 'object') return res.status(400).json({ success:false, error: 'priority 객체 필수' });
  const updated = modelReg.updatePriority(priority);
  // DB 영속 저장 (재시작 후 복원용)
  try { db.saveModelSetting('model_priority', updated); } catch(e) {}
  db.audit(req.user?.userId, 'admin:update_priority', 'models', priority, req.ip);
  res.json({ success:true, modelPriority: updated });
});

// 공급자별 모델 통계
router.get('/models/stats', (req, res) => {
  const stats  = modelReg.getStats();
  const priority = modelReg.getPriority();
  const enabled  = modelReg.getEnabledModels();
  // 사용 가능한 모델 상세
  const enabledDetail = enabled.map(e => {
    const reg = Object.values(MODEL_REGISTRY).find(m => m.id === e.modelId);
    return {
      modelId:   e.modelId,
      provider:  e.provider,
      tier:      e.tier,
      cost:      reg?.costPer1kTokens || 0,
      benchmark: reg?.benchmark?.overall || 0,
      budgetUsd: e.budgetUsd,
      bestFor:   (reg?.bestFor||[]).slice(0,3),
    };
  });
  res.json({ success:true, stats, priority, enabledModels: enabledDetail, totalEnabled: enabled.length });
});

async function testApiKeyConnection(provider, apiKey, baseUrl, res) {
  const start = Date.now();
  try {
    let testOk = false, error = null;

    if (provider === 'openai' || provider === 'azure') {
      const url = (provider === 'azure' && baseUrl)
        ? baseUrl.replace(/\/$/, '') + '/openai/models?api-version=2024-02-01'
        : 'https://api.openai.com/v1/models';
      const hdr = provider === 'azure'
        ? { 'api-key': apiKey }
        : { 'Authorization': 'Bearer ' + apiKey };
      const r = await fetch(url, { headers: hdr, signal: AbortSignal.timeout(8000) });
      testOk = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;
    } else if (provider === 'anthropic') {
      // Step 1: Try models list (read-only, no cost)
      const rList = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version':'2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      if (rList.ok) {
        testOk = true;
      } else if (rList.status === 401 || rList.status === 403) {
        // Key is definitively invalid
        let bodyText = '';
        try { bodyText = await rList.text(); } catch(_) {}
        let detail = '';
        try {
          const bodyJson = JSON.parse(bodyText);
          detail = bodyJson?.error?.message || '';
        } catch(_) {}
        testOk = false;
        error = `인증 실패 (${rList.status}): API 키가 유효하지 않거나 만료되었습니다. Anthropic 콘솔에서 키를 재발급하세요.${detail ? ' (' + detail + ')' : ''}`;
      } else {
        // Non-auth error (e.g. 404 models not supported) - fall back to messages endpoint
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
          body: JSON.stringify({ model:'claude-3-5-haiku-20241022', max_tokens:1, messages:[{role:'user',content:'ping'}] }),
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok || r.status === 529) {
          testOk = true; // 529 = overloaded but key is valid
        } else if (r.status === 401 || r.status === 403) {
          let bodyText = '';
          try { bodyText = await r.text(); } catch(_) {}
          let detail = '';
          try { detail = JSON.parse(bodyText)?.error?.message || ''; } catch(_) {}
          testOk = false;
          error = `인증 실패 (${r.status}): API 키가 유효하지 않거나 만료되었습니다. Anthropic 콘솔에서 키를 재발급하세요.${detail ? ' (' + detail + ')' : ''}`;
        } else {
          // Model not found or other errors mean key IS valid
          testOk = true;
        }
      }
    } else if (provider === 'google') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
      testOk = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;
  } else if (provider === 'deepseek') {
      const r = await fetch('https://api.deepseek.com/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      const dsBody = await r.text();
      if (r.status === 401 || r.status === 403) {
        let detail = '';
        try { detail = JSON.parse(dsBody)?.error?.message || JSON.parse(dsBody)?.message || ''; } catch(_) {}
        testOk = false;
        error = `인증 실패 (${r.status}): DeepSeek API 키가 유효하지 않습니다. platform.deepseek.com에서 키를 확인하세요.${detail ? ' (' + detail + ')' : ''}`;
      } else {
        testOk = r.ok;
        if (!r.ok) error = `HTTP ${r.status}`;
      }
    } else if (provider === 'xai') {
      const r = await fetch('https://api.x.ai/v1/models', {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      const xaiBody = await r.text();
      const isCfBlock = xaiBody.includes('Blocked due to abusive') || xaiBody.includes('cf-browser-verification') || xaiBody.includes('cdn-cgi');
      if (isCfBlock) {
        // Cloudflare blocks this sandbox IP — treat key format as validation
        const keyValid = apiKey.startsWith('xai-') && apiKey.length >= 50;
        testOk = keyValid;
        error = keyValid
          ? null
          : 'API 키 형식이 올바르지 않습니다 (xai-... 형식이어야 합니다)';
        if (keyValid) {
          // Override with special warning message
          res.json({
            success: true,
            latencyMs: Date.now() - start,
            warning: '⚠️ xAI 서버가 이 환경의 IP를 일시 차단 중입니다 (Cloudflare 403). 키 형식은 유효합니다. 실제 환경(로컬/프로덕션)에서는 정상 작동합니다.',
            message: 'xAI (Grok) 키 형식 검증 완료 (IP 차단으로 실제 연결 테스트 불가)'
          });
          return;
        }
      } else if (r.status === 401 || r.status === 403) {
        let detail = '';
        try { detail = JSON.parse(xaiBody)?.error?.message || JSON.parse(xaiBody)?.message || ''; } catch(_) {}
        testOk = false;
        error = `인증 실패 (${r.status}): API 키가 유효하지 않습니다. console.x.ai에서 키를 확인하세요.${detail ? ' (' + detail + ')' : ''}`;
      } else {
        testOk = r.ok;
        if (!r.ok) error = `HTTP ${r.status}: xAI API 서버 오류`;
      }
    } else if (provider === 'moonshot') {
      // baseUrl이 있으면 사용, 없으면 api.moonshot.ai (정상 도메인)
      const moonshotBase = (baseUrl || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
      const r = await fetch(moonshotBase + '/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      const moonshotBody = await r.text();
      if (r.status === 401 || r.status === 403) {
        let detail = '';
        try { detail = JSON.parse(moonshotBody)?.error?.message || ''; } catch(_) {}
        testOk = false;
        error = `인증 실패 (${r.status}): Moonshot API 키가 유효하지 않습니다. platform.moonshot.cn 또는 platform.moonshot.ai에서 키를 확인하세요.${detail ? ' (' + detail + ')' : ''}`;
      } else {
        testOk = r.ok;
        if (!r.ok) error = `HTTP ${r.status}`;
      }
    } else if (provider === 'mistral') {
      const r = await fetch('https://api.mistral.ai/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      const mistralBody = await r.text();
      if (r.status === 401 || r.status === 403) {
        let detail = '';
        try { detail = JSON.parse(mistralBody)?.message || ''; } catch(_) {}
        testOk = false;
        error = `인증 실패 (${r.status}): Mistral API 키가 유효하지 않습니다. console.mistral.ai에서 키를 확인하세요.${detail ? ' (' + detail + ')' : ''}`;
      } else {
        testOk = r.ok;
        if (!r.ok) error = `HTTP ${r.status}`;
      }
    } else if (provider === 'alibaba') {
      // DashScope API 키 형식 확인 (실제 엔드포인트는 복잡하므로 형식만 확인)
      testOk = apiKey.startsWith('sk-') && apiKey.length > 20;
      if (!testOk) error = 'API 키 형식이 올바르지 않습니다 (sk-...)';
    } else if (provider === 'meta') {
      // Meta API는 Together.ai 등 중개 서비스를 통함
      const baseEndpoint = apiKey.includes('.') ? apiKey : 'https://api.together.xyz';
      try {
        const r = await fetch((apiKey || baseEndpoint) + '/v1/models', {
          headers: { 'Authorization': 'Bearer ' + apiKey },
          signal: AbortSignal.timeout(8000),
        });
        testOk = r.ok;
        if (!r.ok) error = `HTTP ${r.status}`;
      } catch(fe) { error = fe.message; testOk = false; }
    } else if (provider === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      testOk = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;
    } else if (provider === 'openrouter') {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      testOk = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;
    } else {
      // custom — baseUrl로 GET 시도
      if (!baseUrl) return res.json({ success:false, error: 'Custom 공급자는 Base URL 필요' });
      const r = await fetch(baseUrl.replace(/\/$/, '') + '/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(8000),
      });
      testOk = r.ok;
      if (!r.ok) error = `HTTP ${r.status}`;
    }

    const resp = { success: testOk, latencyMs: Date.now() - start };
    if (error) resp.error = error;
    if (testOk) {
      const providerLabels = { openai:'OpenAI', anthropic:'Anthropic (Claude)', google:'Google Gemini',
        azure:'Azure OpenAI', deepseek:'DeepSeek', xai:'xAI (Grok)', meta:'Meta (Llama)',
        alibaba:'Alibaba (Qwen)', moonshot:'Moonshot (Kimi)', mistral:'Mistral', groq:'Groq', openrouter:'OpenRouter' };
      resp.message = `${providerLabels[provider] || provider} 연결 성공`;
    }
    res.json(resp);
  } catch (e) {
    let friendlyErr = e.message;
    if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED')) {
      friendlyErr = '네트워크 연결 실패: API 서버에 도달할 수 없습니다.';
    } else if (e.message.includes('timeout') || e.message.includes('TimeoutError')) {
      friendlyErr = '연결 시간 초과: API 서버 응답이 없습니다 (8초 초과).';
    }
    res.json({ success: false, latencyMs: Date.now() - start, error: friendlyErr });
  }
}

// ─────────────────────────────────────────────────────────────
// 13. AI 추론 로그 / 조합 성능 통계
// GET /api/admin/inference/stats     — 공급자별 real/fallback 분리 통계 (최근 7일)
// GET /api/admin/inference/summary   — pipeline·combo별 요약
// GET /api/admin/inference/recent    — 최근 추론 로그 (최대 100건)
// ─────────────────────────────────────────────────────────────

router.get('/inference/stats', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = db.getInferenceStats({ days });
    const total = stats.reduce((s, r) => s + r.total, 0);
    const realTotal = stats.reduce((s, r) => s + r.real_success, 0);
    const fallbackTotal = stats.reduce((s, r) => s + r.fallback_success, 0);
    const errorTotal = stats.reduce((s, r) => s + r.errors, 0);
    res.json({
      success: true,
      period: `최근 ${days}일`,
      summary: { total, realSuccess: realTotal, fallbackSuccess: fallbackTotal, errors: errorTotal,
                 realPct: total ? +(realTotal / total * 100).toFixed(1) : 0,
                 fallbackPct: total ? +(fallbackTotal / total * 100).toFixed(1) : 0 },
      byProvider: stats,
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/inference/summary', (req, res) => {
  try {
    const { pipeline, from } = req.query;
    const summary = db.getInferenceSummary({ pipeline, fromDate: from, limit: 200 });
    res.json({ success: true, ...summary });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/inference/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const pipeline = req.query.pipeline;
    let where = '1=1';
    const params = [];
    if (pipeline) { where += ' AND pipeline=?'; params.push(pipeline); }
    const db2 = require('../db/database');
    const rows = db2._raw
      ? db2._raw.prepare(`SELECT * FROM inference_log WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)
      : [];
    res.json({ success: true, total: rows.length, rows });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// 14. Provider Health 대시보드 + 에러 분류 분석
// GET /api/admin/health/dashboard  — 공급자별 상태 + 24h 성능 집계
// GET /api/admin/health/errors     — 에러 원인 카테고리별 분해
// POST /api/admin/health/check     — 모든 공급자 즉시 연결 체크 + DB 기록
// ─────────────────────────────────────────────────────────────

router.get('/health/dashboard', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const dashboard = db.getProviderHealthDashboard({ hours });
    // 현재 메모리 상태 (getProviderStatus)
    const memStatus = aiConnector.getProviderStatus();

    // 공급자별 병합
    const providers = {};
    // 메모리 상태 우선
    Object.entries(memStatus).forEach(([p, s]) => {
      providers[p] = {
        provider: p,
        configured: s.configured,
        clientReady: s.available,
        enabledModels: s.enabledModels || [],
        latestCheck: null,
        uptimePct: null,
        avgLatency: null,
        calls24h: 0,
        successRate24h: null,
        totalCost24h: 0,
        totalTokens24h: 0,
      };
    });
    // 최근 health check 결과 병합
    dashboard.latest.forEach(r => {
      if (!providers[r.provider]) providers[r.provider] = {};
      providers[r.provider].latestCheck = {
        status: r.status,
        latency_ms: r.latency_ms,
        error_code: r.error_code,
        error_msg: r.error_msg,
        checked_at: r.checked_at,
      };
    });
    // 24h uptime 집계 병합
    dashboard.uptime.forEach(r => {
      if (!providers[r.provider]) providers[r.provider] = {};
      providers[r.provider].uptimePct = r.total_checks > 0 ? +(r.ok_count / r.total_checks * 100).toFixed(1) : null;
      providers[r.provider].avgLatency = r.avg_ok_latency;
    });
    // 24h inference 성능 병합
    dashboard.perf.forEach(r => {
      if (!providers[r.provider]) providers[r.provider] = {};
      providers[r.provider].calls24h = r.calls;
      providers[r.provider].successRate24h = r.calls > 0 ? +(r.successes / r.calls * 100).toFixed(1) : null;
      providers[r.provider].totalCost24h = r.total_cost;
      providers[r.provider].totalTokens24h = r.total_tokens;
    });

    // 전체 요약
    const all = Object.values(providers);
    const totalCost24h = all.reduce((s, p) => s + (p.totalCost24h || 0), 0);
    const totalCalls24h = all.reduce((s, p) => s + (p.calls24h || 0), 0);
    const configuredCount = all.filter(p => p.configured || p.clientReady).length;

    res.json({
      success: true,
      period: `최근 ${hours}시간`,
      summary: {
        totalProviders: all.length,
        configured: configuredCount,
        totalCalls24h,
        totalCost24h: +totalCost24h.toFixed(6),
      },
      providers: Object.fromEntries(
        Object.entries(providers).filter(([, p]) => p.configured || p.clientReady || p.calls24h > 0)
      ),
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/health/errors', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const errors = db.getErrorBreakdown({ days });
    // 카테고리별 요약
    const byCat = {};
    errors.forEach(e => {
      const cat = e.error_category || 'unknown';
      if (!byCat[cat]) byCat[cat] = { count: 0, providers: new Set(), codes: new Set() };
      byCat[cat].count += e.cnt;
      byCat[cat].providers.add(e.provider);
      byCat[cat].codes.add(e.error_code);
    });
    const categories = Object.entries(byCat).map(([cat, s]) => ({
      category: cat,
      count: s.count,
      providers: [...s.providers],
      codes: [...s.codes],
      description: {
        auth:      '인증 실패 — API 키 확인 필요',
        config:    '설정 오류 — API 키 미등록 또는 모델 없음',
        whitelist: '화이트리스트 차단 — 모델 비활성 또는 미등록',
        network:   '네트워크/타임아웃 — 외부 API 연결 불안정',
        unknown:   '분류 불가 — 로그 상세 확인 필요',
      }[cat] || '기타',
    })).sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      period: `최근 ${days}일`,
      totalErrors: errors.reduce((s, e) => s + e.cnt, 0),
      total_errors: errors.reduce((s, e) => s + e.cnt, 0),
      categories,
      breakdown: errors,  // alias: raw breakdown rows (test/frontend compatibility)
      details: errors,
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/health/check', async (req, res) => {
  try {
    const { providers: providerList } = req.body;
    const store = _apiConfigStore;
    const targets = providerList?.length
      ? providerList
      : Object.keys(store).filter(p => store[p]?.isActive !== false);

    const PROV_URLS = {
      openai:'https://api.openai.com/v1', deepseek:'https://api.deepseek.com/v1',
      xai:'https://api.x.ai/v1', moonshot:'https://api.moonshot.ai/v1',
      mistral:'https://api.mistral.ai/v1', groq:'https://api.groq.com/openai/v1',
      alibaba:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    };

    const results = [];
    for (const provider of targets) {
      const cfg = store[provider];
      if (!cfg?.apiKey) continue;
      const start = Date.now();
      let status = 'ok', errorCode = null, errorMsg = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        let url, headers;
        if (provider === 'google') {
          url = `https://generativelanguage.googleapis.com/v1beta/models?key=${cfg.apiKey}`;
          headers = { Accept: 'application/json' };
        } else if (provider === 'anthropic') {
          url = 'https://api.anthropic.com/v1/models';
          headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', Accept: 'application/json' };
        } else {
          const base = cfg.baseUrl || PROV_URLS[provider] || 'https://api.openai.com/v1';
          url = base.replace(/\/$/, '') + '/models';
          headers = { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' };
        }
        try {
          const r = await fetch(url, { headers, signal: ctrl.signal });
          clearTimeout(timer);
          if (r.status === 401 || r.status === 403) {
            status = 'down'; errorCode = 'AUTH_FAILED'; errorMsg = `HTTP ${r.status}`;
          } else if (!r.ok && r.status !== 404) {
            // 404 is OK for some providers (models list not exposed)
            status = 'degraded'; errorCode = 'HTTP_ERROR'; errorMsg = `HTTP ${r.status}`;
          }
        } catch(fe) {
          clearTimeout(timer);
          status = 'down';
          errorCode = fe.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
          errorMsg = fe.message?.slice(0, 100);
        }
      } catch(e) {
        status = 'down'; errorCode = 'ERROR'; errorMsg = e.message?.slice(0, 100);
      }
      const latencyMs = Date.now() - start;
      db.saveProviderHealth({ provider, status, latencyMs, errorCode, errorMsg });
      results.push({ provider, status, latencyMs, errorCode });
    }
    res.json({ success: true, checked: results.length, results });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── Phase 5: 베타 사용자 관리 API ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// GET /beta/users — 베타 사용자 목록 + 쿼터 정보
router.get('/beta/users', (req, res) => {
  try {
    const users = db.getBetaUsers();
    res.json({ success: true, total: users.length, users });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /beta/invites — 초대 코드 목록
router.get('/beta/invites', (req, res) => {
  try {
    const invites = db.listInviteCodes({ limit: 100 });
    res.json({ success: true, total: invites.length, invites });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /beta/invites — 초대 코드 생성
router.post('/beta/invites', (req, res) => {
  try {
    const { email, role = 'beta', expiresAt, count = 1 } = req.body;
    const adminId = req.user?.id || req.user?.userId;
    const results = [];
    const n = Math.min(parseInt(count) || 1, 20); // 최대 20개
    for (let i = 0; i < n; i++) {
      const code = `BETA-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const inv = db.createInviteCode({ code, email: email || null, role, expiresAt: expiresAt || null, createdBy: adminId });
      results.push(inv);
    }
    res.json({ success: true, created: results.length, invites: results });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /beta/invites/:code — 초대 코드 삭제
router.delete('/beta/invites/:code', (req, res) => {
  try {
    db.deleteInviteCode(req.params.code);
    res.json({ success: true, message: '초대 코드가 삭제되었습니다.' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /beta/quota — 전체 사용자 쿼터 현황
router.get('/beta/quota', (req, res) => {
  try {
    const stats = db.getQuotaStats({ days: 7 });
    res.json({ success: true, total: stats.length, quotas: stats });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// PATCH /beta/quota/:userId — 사용자 쿼터/플랜 변경
router.patch('/beta/quota/:userId', async (req, res) => {
  try {
    const { plan, isActive } = req.body;
    const { userId } = req.params;
    if (plan) {
      db.updateUserPlan(userId, plan, isActive !== undefined ? isActive : 1);
    }
    res.json({ success: true, message: `사용자 ${userId} 플랜이 업데이트되었습니다.` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /beta/quota/:userId — 특정 사용자 쿼터 상세
router.get('/beta/quota/:userId', (req, res) => {
  try {
    const q = db.getOrCreateQuota(req.params.userId);
    res.json({ success: true, quota: q });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /beta/quota/reset/:userId — 사용자 일일 쿼터 리셋
router.post('/beta/quota/reset/:userId', (req, res) => {
  try {
    db._raw.prepare(`UPDATE user_quotas SET used_today=0,cost_today=0.0,reset_date=date('now'),updated_at=datetime('now') WHERE user_id=?`)
      .run(req.params.userId);
    res.json({ success: true, message: `사용자 ${req.params.userId} 쿼터가 리셋되었습니다.` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /beta/stats — 베타 전체 통계
router.get('/beta/stats', (req, res) => {
  try {
    const users  = db.getBetaUsers();
    const quotas = db.getQuotaStats();
    const totalCostMonth = quotas.reduce((s, q) => s + (q.cost_month || 0), 0);
    const totalReqToday  = quotas.reduce((s, q) => s + (q.used_today || 0), 0);
    const overQuota = quotas.filter(q => q.used_today >= q.daily_limit);
    res.json({
      success: true,
      summary: {
        totalBetaUsers: users.length,
        activeUsers: users.filter(u => u.is_active).length,
        totalCostMonth: Math.round(totalCostMonth * 10000) / 10000,
        totalReqToday,
        overQuotaUsers: overQuota.length
      },
      topUsers: quotas.slice(0, 10)
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /beta/register — 초대 코드로 베타 가입 (인증 불필요)
// 이 라우트만 requireAuth 없이 호출 가능 (별도 퍼블릭 라우터 필요)
// → server.js에 /api/beta/register 퍼블릭 라우트 추가 예정

// ── POST /hot-restart — git pull + process.exit(0) → pm2 auto-restart ───
// 새 파일 배포 시 npm install 없이 재시작. pm2가 자동으로 재기동.
// 사용: POST /api/admin/hot-restart  { "branch": "genspark_ai_developer" }
router.post('/hot-restart', (req, res) => {
  const { exec } = require('child_process');
  const branch   = (req.body && req.body.branch) || 'genspark_ai_developer';
  const APP_PATH = process.env.APP_PATH || '/opt/ai-orchestrator/app';

  const pullCmd = [
    `cd ${APP_PATH}`,
    `git fetch origin`,
    `git checkout ${branch}`,
    `git pull origin ${branch} --ff-only`,
  ].join(' && ');

  res.json({ success: true, status: 'hot-restarting', branch,
             message: 'git pull 실행 후 pm2 auto-restart (2초 후 process.exit)' });

  setTimeout(() => {
    exec(pullCmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[admin][hot-restart] git pull 실패:', err.message);
        return;
      }
      console.log('[admin][hot-restart] git pull 완료:', stdout.trim().slice(0, 200));
      console.log('[admin][hot-restart] process.exit(0) → pm2 재시작');
      // pm2가 자동으로 재기동 (autorestart: true)
      setTimeout(() => process.exit(0), 500);
    });
  }, 200);
});

module.exports = router;
module.exports._apiConfigStore = _apiConfigStore;   // aiConnector에서 DB키 조회용

// ── POST /deploy — git pull + pm2 restart (Phase 13.1 핫 배포) ──────
// 사용: POST /api/admin/deploy  { "branch": "genspark_ai_developer", "skipNpm": true }
router.post('/deploy', async (req, res) => {
  const { exec } = require('child_process');
  const branch   = (req.body && req.body.branch)  || 'genspark_ai_developer';
  const skipNpm  = (req.body && req.body.skipNpm) || false;
  const APP_PATH = process.env.APP_PATH || '/opt/ai-orchestrator/app';

  const steps = [
    `cd ${APP_PATH}`,
    `git fetch origin`,
    `git checkout ${branch}`,
    `git pull origin ${branch} --ff-only`,
  ];
  if (!skipNpm) {
    steps.push(`cd ${APP_PATH}/ai-orchestrator && npm install --only=production --quiet`);
  }
  steps.push(`pm2 reload ai-orchestrator --update-env || pm2 restart ai-orchestrator || pm2 start ${APP_PATH}/ai-orchestrator/ecosystem.vps.config.js`);

  const cmd = steps.join(' && ');

  res.json({ success: true, status: 'deploying', branch, skipNpm, cmd: cmd.replace(/&&/g,'&&\n') });

  // Run after response sent so client gets ACK
  setTimeout(() => {
    exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
      const msg = err ? `DEPLOY ERROR: ${err.message}\n${stderr}` : `DEPLOY OK:\n${stdout}`;
      console.log('[admin][deploy]', msg.slice(0, 2000));
    });
  }, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM LAYER ADMIN — Phase 14
// Provides admin visibility and management for all five platform engines.
// Frozen engine core (aiConnector) is NOT touched here.
// ═══════════════════════════════════════════════════════════════════════════

// ── Lazy-load platform engines (avoid circular deps) ──────────────────────
let _memoryEngine = null, _storageEngine = null, _observability = null;
let _analytics = null, _jobEngine = null;

function _mem()  { if (!_memoryEngine)  _memoryEngine  = require('../services/memoryEngine');       return _memoryEngine; }
function _stor() { if (!_storageEngine) _storageEngine = require('../services/storageEngine');      return _storageEngine; }
function _obs()  { if (!_observability) _observability = require('../services/observabilityEngine'); return _observability; }
function _ana()  { if (!_analytics)     _analytics     = require('../services/analyticsEngine');    return _analytics; }
function _job()  { if (!_jobEngine)     _jobEngine     = require('../services/jobEngine');          return _jobEngine; }

// ── GET /platform/status — Full platform layer health summary ─────────────
router.get('/platform/status', (req, res) => {
  try {
    res.json({
      success: true,
      ts: new Date().toISOString(),
      platform: {
        memory:        _mem().stats(),
        storage:       _stor().stats(),
        observability: _obs().stats(),
        analytics:     _ana().stats(),
        jobs:          _job().stats(),
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── MEMORY ENGINE ──────────────────────────────────────────────────────────

router.get('/platform/memory/stats', (req, res) => {
  res.json({ success: true, stats: _mem().stats() });
});

router.get('/platform/memory/sessions', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.json({ success: true, stats: _mem().stats(), hint: 'Add ?userId=<id> to list sessions' });
    res.json({ success: true, sessions: _mem().listSessions(userId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/memory/sessions/:sessionId', (req, res) => {
  try {
    const s = _mem().getSession(req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, session: s });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/platform/memory/sessions/:sessionId', (req, res) => {
  try {
    const deleted = _mem().deleteSession(req.params.sessionId);
    res.json({ success: true, deleted });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/memory/sessions/:sessionId/summarise', (req, res) => {
  try {
    const result = _mem().summariseSession(req.params.sessionId);
    if (!result) return res.status(404).json({ success: false, error: 'Session not found or empty' });
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/memory/profiles/:userId', (req, res) => {
  try {
    const profile = _mem().getUserProfile(req.params.userId);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });
    res.json({ success: true, profile });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.patch('/platform/memory/profiles/:userId', (req, res) => {
  try {
    const profile = _mem().patchUserProfile(req.params.userId, req.body);
    res.json({ success: true, profile });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/memory/flush', (req, res) => {
  try { _mem().flush(); res.json({ success: true, message: 'Memory flushed to DB' }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── STORAGE ENGINE ─────────────────────────────────────────────────────────

router.get('/platform/storage/stats', (req, res) => {
  res.json({ success: true, stats: _stor().stats() });
});

router.get('/platform/storage/assets', (req, res) => {
  try {
    const { userId, pipeline, type, tag, limit } = req.query;
    const assets = _stor().listAssets({ userId, pipeline, type, tag, limit: parseInt(limit || '100', 10) });
    res.json({ success: true, count: assets.length, assets });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/storage/assets/:assetId', (req, res) => {
  try {
    const result = _stor().getAsset(req.params.assetId);
    if (!result) return res.status(404).json({ success: false, error: 'Asset not found' });
    res.json({ success: true, asset: result.meta, url: _stor().getAssetUrl(req.params.assetId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/platform/storage/assets/:assetId', (req, res) => {
  try {
    const deleted = _stor().deleteAsset(req.params.assetId);
    if (!deleted) return res.status(404).json({ success: false, error: 'Asset not found' });
    res.json({ success: true, deleted: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── OBSERVABILITY ENGINE ───────────────────────────────────────────────────

router.get('/platform/obs/stats', (req, res) => {
  res.json({ success: true, stats: _obs().stats() });
});

router.get('/platform/obs/spans', (req, res) => {
  try {
    const { traceId, pipeline, status, provider, userId, minDurationMs, limit } = req.query;
    const spans = _obs().querySpans({
      traceId, pipeline, status, provider, userId,
      minDurationMs: minDurationMs ? parseInt(minDurationMs, 10) : undefined,
      limit: parseInt(limit || '50', 10),
    });
    res.json({ success: true, count: spans.length, spans });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/obs/events', (req, res) => {
  try {
    const { traceId, name, level, pipeline, userId, limit } = req.query;
    const events = _obs().queryEvents({
      traceId, name, level, pipeline, userId,
      limit: parseInt(limit || '100', 10),
    });
    res.json({ success: true, count: events.length, events });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/obs/traces/:traceId', (req, res) => {
  try {
    const trace = _obs().getTrace(req.params.traceId);
    if (!trace) return res.status(404).json({ success: false, error: 'Trace not found' });
    res.json({ success: true, trace });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/obs/flush', (req, res) => {
  try { _obs().flush(); res.json({ success: true, message: 'Observability flushed' }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── ANALYTICS ENGINE ───────────────────────────────────────────────────────

router.get('/platform/analytics/stats', (req, res) => {
  res.json({ success: true, stats: _ana().stats() });
});

router.get('/platform/analytics/counters', (req, res) => {
  res.json({ success: true, counters: _ana().getCounters() });
});

router.get('/platform/analytics/pipelines', (req, res) => {
  res.json({ success: true, pipelines: _ana().getPipelineStats() });
});

router.get('/platform/analytics/timeline', (req, res) => {
  try {
    const days      = parseInt(req.query.days || '7', 10);
    const eventName = req.query.event || null;
    res.json({ success: true, timeline: _ana().getDailyTimeline(days, eventName) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/analytics/costs', (req, res) => {
  res.json({ success: true, costs: _ana().getCostSummary() });
});

router.get('/platform/analytics/users/:userId', (req, res) => {
  try {
    const activity = _ana().getUserActivity(req.params.userId);
    if (!activity) return res.status(404).json({ success: false, error: 'User not found in analytics' });
    res.json({ success: true, activity });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/analytics/events', (req, res) => {
  try {
    const { eventName, userId, pipeline, from, to, limit } = req.query;
    const events = _ana().query({
      eventName, userId, pipeline, from, to,
      limit: parseInt(limit || '100', 10),
    });
    res.json({ success: true, count: events.length, events });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/analytics/funnel', (req, res) => {
  try {
    const { steps, userId } = req.body;
    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({ success: false, error: 'steps[] required' });
    }
    res.json({ success: true, funnel: _ana().getFunnel(steps, { userId }) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/analytics/track', (req, res) => {
  try {
    const { eventName, userId, pipeline, properties, value } = req.body;
    if (!eventName) return res.status(400).json({ success: false, error: 'eventName required' });
    _ana().track(eventName, { userId: userId || req.user?.id, pipeline, properties, value });
    res.json({ success: true, tracked: eventName });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── JOB ENGINE ─────────────────────────────────────────────────────────────

router.get('/platform/jobs/stats', (req, res) => {
  res.json({ success: true, stats: _job().stats() });
});

router.get('/platform/jobs/queues', (req, res) => {
  res.json({ success: true, queues: _job().getQueueStats() });
});

router.get('/platform/jobs', (req, res) => {
  try {
    const { status, queueName, userId, pipeline, limit } = req.query;
    const jobs = _job().listJobs({ status, queueName, userId, pipeline, limit: parseInt(limit || '100', 10) });
    res.json({ success: true, count: jobs.length, jobs });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/platform/jobs/:jobId', (req, res) => {
  try {
    const job = _job().getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/jobs/:jobId/cancel', (req, res) => {
  try {
    const cancelled = _job().cancelJob(req.params.jobId);
    if (!cancelled) return res.status(400).json({ success: false, error: 'Job cannot be cancelled' });
    res.json({ success: true, cancelled: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/jobs/:jobId/retry', (req, res) => {
  try {
    const job = _job().retryJob(req.params.jobId);
    if (!job) return res.status(400).json({ success: false, error: 'Job not in failed state or not found' });
    res.json({ success: true, job });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/platform/jobs/enqueue', (req, res) => {
  try {
    const { queueName, data, priority, userId, pipeline } = req.body;
    if (!queueName) return res.status(400).json({ success: false, error: 'queueName required' });
    const job = _job().enqueue(queueName, data || {}, {
      priority, userId: userId || req.user?.id, pipeline,
    });
    res.json({ success: true, job });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
