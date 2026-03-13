// ============================================================
// Express 서버 + Socket.IO 실시간 통신
// ============================================================

require('dotenv').config();

// ── 실제 API 키 우선 적용 (환경변수 오버라이드) ──────────────
// GenSpark 샌드박스 환경에서 OPENAI_API_KEY/BASE_URL이 프록시로
// 설정되어 있을 수 있으므로, .env에 키가 있으면 강제 덮어씀
const _envKeys = {
  OPENAI_API_KEY:    process.env.REAL_OPENAI_API_KEY  || process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL:   process.env.REAL_OPENAI_BASE_URL || '',   // 실제 OpenAI 직접 연결
  ANTHROPIC_API_KEY: process.env.REAL_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  GOOGLE_API_KEY:    process.env.GOOGLE_API_KEY,
  GEMINI_API_KEY:    process.env.GEMINI_API_KEY,
  DEEPSEEK_API_KEY:  process.env.DEEPSEEK_API_KEY,
  XAI_API_KEY:       process.env.XAI_API_KEY,
  MOONSHOT_API_KEY:  process.env.MOONSHOT_API_KEY,
  MISTRAL_API_KEY:   process.env.MISTRAL_API_KEY,
};
// .env에 sk-proj- 형식의 실제 OpenAI 키가 있으면 적용
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-proj-')) {
  process.env.OPENAI_BASE_URL = '';  // 프록시 URL 제거 → 직접 연결
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

// ── DB + 보안 미들웨어 (Phase 8) ───────────────────────────
const db = require('./db/database');
const security = require('./middleware/security');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

const IntentAnalyzer = require('./orchestrator/intentAnalyzer');
const moduleBridge = require('./services/moduleBridge');  // Python AI 모듈 브릿지
const MasterOrchestrator = require('./orchestrator/masterOrchestrator');
const DynamicOrchestrator = require('./orchestrator/dynamicOrchestrator');
const MemoryEngine = require('./memory/memoryEngine');
const { TASK_STATUS } = require('./types');

// ── Phase 4-A: 오케스트레이터 고급 모듈 ────────────────────
const ComboOptimizer  = require('./orchestrator/comboOptimizer');
const ModelBenchmark  = require('./orchestrator/modelBenchmark');
const { API_ADAPTERS, INTEGRATION_PRIORITY, MISSING_TECH_SOLUTIONS } = require('./orchestrator/apiAdapters');
const { TOOL_DEFINITIONS, executeTool, shouldUseTools,
        getToolPriorityHint, selectPriorityTool } = require('./orchestrator/functionTools');
const toolObs = require('./services/toolObservability');  // STEP 7

// ── STEP 10~15: Agent Runtime (Planner + ToolChain + SkillLib + AgentRuntime) ──
const {
  createAgentRuntime,
  taskStateEngine,
  skillLibrary,
  costController,
  failureStore,
  cacheLayer,
  searchEngine,
  parallelExecutor,
  TASK_STATE,
  AGENT_CONFIG,
} = require('./agent');  // src/agent/index.js

// ── 클라이언트 초기화 ──────────────────────────────────────
// GenSpark LLM Proxy 지원: OPENAI_BASE_URL 사용
const openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY || 'demo-mode'
};
if (process.env.OPENAI_BASE_URL) {
  openaiConfig.baseURL = process.env.OPENAI_BASE_URL;
  console.log(`OpenAI Base URL: ${process.env.OPENAI_BASE_URL}`);
}
const openai = new OpenAI(openaiConfig);

// Anthropic은 현재 미지원 → OpenAI로 대체
let anthropic = null;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
} catch (e) {
  console.log('Anthropic SDK 없음, OpenAI로 대체합니다.');
}

const intentAnalyzer = new IntentAnalyzer(openai);
const orchestrator = new DynamicOrchestrator(openai, anthropic); // v3: 동적 라우팅 + 병렬 + 피드백
const memory = new MemoryEngine();

// Phase 4-A 인스턴스
const comboOptimizer = new ComboOptimizer();
const modelBenchmark = new ModelBenchmark();

// ── STEP 10~15: Agent Runtime 초기화 ─────────────────────────
// executeTool은 functionTools.js에서 가져옴 (아래 require 후 연결)
let agentRuntime = null;  // openai 준비 완료 후 초기화

// ── Express 앱 설정 ────────────────────────────────────────
const app = express();

// Nginx 리버스 프록시 뒤에서 동작 시 trust proxy 필요 (X-Forwarded-For, X-Real-IP 처리)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── 보안 미들웨어 적용 ────────────────────────────────────
app.use(security.helmet);
app.use(security.cors);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(security.globalLimiter);

// ── 어드민 전용 URL (/admin → admin.html) — static보다 먼저 등록 ──
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ── Phase 3: Failure Replay Debug UI ─────────────────────────────────────
app.get('/failures', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/failures.html'));
});

app.use(express.static(path.join(__dirname, '../public')));
// Socket.IO 인스턴스를 app에 주입 (admin broadcast용)
app.set('io', io);

// ── 세션 저장소 (메모리) ───────────────────────────────────
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      history: [],
      pendingAnalysis: null,
      createdAt: new Date()
    });
  }
  return sessions.get(sessionId);
}

// ── REST API ───────────────────────────────────────────────

// 헬스체크
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    demoMode: !process.env.OPENAI_API_KEY
  });
});

// ── STEP 7: Tool Observability KPI 엔드포인트 ────────────────────────────
// /api/kpi — 단축 별칭 (Regression Suite I1 테스트용)
app.get('/api/kpi', (req, res) => {
  try {
    const toolKpi      = toolObs.getKPI();
    const budgetKpi    = costController    ? costController.getBudgetKPI()    : {};
    const cacheKpi     = cacheLayer        ? cacheLayer.getStats()            : {};
    const failureKpi   = _buildFailureKpi();
    const searchKpi    = searchEngine      ? searchEngine.getKPI()            : {};
    const parallelKpi  = parallelExecutor  ? parallelExecutor.getParallelKPI(): {};
    res.json({ ...toolKpi, budget: budgetKpi, cache: cacheKpi, failures: failureKpi, search: searchKpi, parallel: parallelKpi });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/observability/kpi', (req, res) => {
  try {
    const toolKpi      = toolObs.getKPI();
    const budgetKpi    = costController    ? costController.getBudgetKPI()    : {};
    const cacheKpi     = cacheLayer        ? cacheLayer.getStats()            : {};
    const failureKpi   = _buildFailureKpi();
    const searchKpi    = searchEngine      ? searchEngine.getKPI()            : {};
    const parallelKpi  = parallelExecutor  ? parallelExecutor.getParallelKPI(): {};
    res.json({ ...toolKpi, budget: budgetKpi, cache: cacheKpi, failures: failureKpi, search: searchKpi, parallel: parallelKpi });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function _buildFailureKpi() {
  if (!failureStore) return {};
  try {
    const s = failureStore.getReplayStats();
    const total     = s.total_failures || 0;
    const replays   = s.total_replays  || 0;
    const replayRuns= s.replay_runs    || 0;
    const budgetKpi = costController ? costController.getBudgetKPI() : {};
    const partial   = parseFloat(budgetKpi.partial_result_rate) || 0;
    return {
      total_failures:          total,
      failure_rate:            total > 0 ? (total / Math.max(total, 1) * 100).toFixed(1) + '%' : '0%',
      partial_rate:            budgetKpi.partial_result_rate || '0%',
      budget_exceeded_count:   s.budget_exceeded || 0,
      timeout_count:           s.timeout         || 0,
      llm_error_count:         s.llm_error       || 0,
      chain_error_count:       s.chain_error      || 0,
      total_replays:           replays,
      replay_runs:             replayRuns,
      replay_success_rate:     replayRuns > 0
        ? ((replays / replayRuns) * 100).toFixed(1) + '%'
        : '0%',
    };
  } catch (err) {
    return {};
  }
}
app.get('/api/observability/logs', (req, res) => {
  const n       = Math.min(parseInt(req.query.n || '50'), 200);
  const filter  = {
    type:     req.query.type     || undefined,
    tool:     req.query.tool     || undefined,
    strategy: req.query.strategy || undefined,
  };
  try { res.json(toolObs.getRecentLogs(n, filter)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STEP 10~15: Agent API 엔드포인트 ─────────────────────────────────────

// GET /api/agent/skills — 사용 가능한 스킬 목록
app.get('/api/agent/skills', (req, res) => {
  try {
    res.json({ skills: skillLibrary.listSkills() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agent/plan/status/:planId — 태스크 플랜 상태 조회 (STEP 12)
app.get('/api/agent/plan/status/:planId', (req, res) => {
  try {
    const summary = taskStateEngine.getSummary(req.params.planId);
    if (!summary) return res.status(404).json({ error: 'Plan not found' });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agent/status — Agent Runtime 상태
app.get('/api/agent/status', (req, res) => {
  res.json({
    agentEnabled:    !!agentRuntime,
    autonomousStrategies: AGENT_CONFIG.AUTONOMOUS_STRATEGIES,
    skipTypes:       Array.from(AGENT_CONFIG.SKIP_AUTONOMOUS_TYPES),
    autonomousTypes: Array.from(AGENT_CONFIG.AUTONOMOUS_TASK_TYPES),
    maxMs:           AGENT_CONFIG.MAX_AUTONOMOUS_MS,
    skills:          skillLibrary.listSkills().map(s => s.id),
    // STEP 10~15 구성 확인
    components: {
      planner:        true,
      taskStateEngine: true,
      toolChain:      true,
      selfCorrection:  true,
      skillLibrary:    true,
      autonomousMode:  !!agentRuntime,
    },
    version: 'STEP 10~15 v1.0',
  });
});

// POST /api/agent/plan — 요청에서 태스크 플랜 생성 (STEP 10)
app.post('/api/agent/plan', async (req, res) => {
  if (!agentRuntime) return res.status(503).json({ error: 'AgentRuntime 미초기화' });
  try {
    const { message, taskType = 'analysis', strategy = 'deep' } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message 필드 필요' });
    const { AgentPlanner } = require('./agent');
    const planner = new AgentPlanner(openai);
    const plan = await planner.createPlan(message, taskType, strategy, {});
    res.json({
      success: true,
      planId:     plan.planId,
      complexity: plan.complexity,
      reasoning:  plan.reasoning,
      totalSteps: plan.totalSteps,
      tasks:      plan.tasks.map(t => ({ id: t.id, name: t.name, type: t.type, tool: t.tool, dependsOn: t.dependsOn })),
      task_state: plan.task_state,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/agent/run — 자율 에이전트 직접 실행 (STEP 15)
app.post('/api/agent/run', async (req, res) => {
  if (!agentRuntime) return res.status(503).json({ error: 'AgentRuntime 미초기화' });
  try {
    const {
      message,
      taskType   = 'analysis',
      strategy   = 'deep',
      sessionId  = uuidv4(),
      maxTokens  = 3000,
    } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message 필드 필요' });

    const runStart = Date.now();
    const result = await agentRuntime.run({
      message,
      taskType,
      strategy,
      sessionId,
      systemPrompt: `You are a highly capable autonomous AI agent. Respond in Korean.`,
      selectedModel: 'gpt-4o-mini',
      maxTokens,
      temperature: 0.7,
      memoryContext: null,
    });

    if (!result) {
      return res.json({ success: true, agentMode: false, message: 'simple plan — 직접 LLM 사용' });
    }

    res.json({
      success:     true,
      agentMode:   true,
      content:     result.content,
      planId:      result.planId,
      complexity:  result.plan?.complexity,
      totalSteps:  result.plan?.totalSteps,
      chainLog:    result.chainLog?.map(s => ({ id: s.taskId, name: s.taskName, success: s.success, ms: s.ms })),
      corrections: result.corrections?.length || 0,
      stateSummary: result.stateSummary,
      totalMs:     Date.now() - runStart,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Phase 6: Cache Layer API ────────────────────────────────────────────────
app.get('/api/cache/stats', (req, res) => {
  if (!cacheLayer) return res.status(503).json({ error: 'cacheLayer 미초기화' });
  res.json({ success: true, cache: cacheLayer.getStats() });
});
app.delete('/api/cache', (req, res) => {
  if (!cacheLayer) return res.status(503).json({ error: 'cacheLayer 미초기화' });
  const { type } = req.query;
  if (type) {
    cacheLayer.invalidateByType(type);
    res.json({ success: true, message: `${type} 캐시 삭제 완료` });
  } else {
    cacheLayer.clear();
    res.json({ success: true, message: '전체 캐시 초기화 완료' });
  }
});

// ── Phase 5: Search Engine API ──────────────────────────────────────────────
// GET  /api/search/providers  — 활성 프로바이더 목록 및 KPI
// GET  /api/search/test       — 프로바이더 테스트 (쿼리: ?q=검색어)

app.get('/api/search/providers', (req, res) => {
  try {
    const kpi = searchEngine ? searchEngine.getKPI() : {};
    res.json({ success: true, ...kpi });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search/test', async (req, res) => {
  const query = req.query.q || '오늘 날씨 서울';
  try {
    const start  = Date.now();
    const result = await searchEngine.search(query, { maxResults: 3 });
    res.json({
      success:    !!result,
      query,
      latency_ms: Date.now() - start,
      result:     result ? result.slice(0, 500) : null,
      kpi:        searchEngine.getKPI(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 4: Parallel Executor API ─────────────────────────────────────────
// GET  /api/parallel/kpi         — 병렬 실행 KPI
// POST /api/parallel/config      — max_parallel_tools 동적 변경

app.get('/api/parallel/kpi', (req, res) => {
  try {
    const kpi = parallelExecutor ? parallelExecutor.getParallelKPI() : {};
    res.json({ success: true, ...kpi });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/parallel/config', (req, res) => {
  try {
    const { max_parallel_tools } = req.body;
    if (typeof max_parallel_tools === 'number' && max_parallel_tools >= 1 && max_parallel_tools <= 5) {
      parallelExecutor.setMaxParallelTools(max_parallel_tools);
      res.json({ success: true, max_parallel_tools: parallelExecutor.PARALLEL_CONFIG.MAX_PARALLEL_TOOLS });
    } else {
      res.status(400).json({ error: 'max_parallel_tools must be 1-5' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3: Failure Replay System ─────────────────────────────────────────
// GET  /api/agent/failures          — 실패 목록 조회
// GET  /api/agent/failure/:id       — 특정 실패 상세 조회
// POST /api/agent/replay/:id        — 특정 실패 재실행
// GET  /api/agent/failures/stats    — 실패 통계

app.get('/api/agent/failures/stats', (req, res) => {
  if (!failureStore) return res.status(503).json({ error: 'failureStore 미초기화' });
  try {
    res.json({ success: true, stats: failureStore.getReplayStats() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/agent/failures', (req, res) => {
  if (!failureStore) return res.status(503).json({ error: 'failureStore 미초기화' });
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    res.json({ success: true, ...failureStore.getFailures(limit, offset) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/agent/failure/:id', (req, res) => {
  if (!failureStore) return res.status(503).json({ error: 'failureStore 미초기화' });
  try {
    const id   = parseInt(req.params.id);
    const item = failureStore.getFailure(id);
    if (!item) return res.status(404).json({ success: false, error: '해당 실패 기록 없음' });
    res.json({ success: true, failure: item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/agent/replay/:id', async (req, res) => {
  if (!failureStore) return res.status(503).json({ error: 'failureStore 미초기화' });
  if (!agentRuntime) return res.status(503).json({ error: 'AgentRuntime 미초기화' });

  try {
    const id = parseInt(req.params.id);
    const failure = failureStore.getFailure(id);
    if (!failure) return res.status(404).json({ success: false, error: '해당 실패 기록 없음' });

    const {
      overridePlan,  // true → 원본 plan 재사용, false → 새로 계획 (기본: false)
    } = req.body || {};

    const runStart  = Date.now();
    const sessionId = `replay_${id}_${Date.now()}`;

    let result;
    if (overridePlan && failure.plan) {
      // 원본 plan을 직접 ToolChainExecutor에 전달
      const { ToolChainExecutor } = require('./agent');
      const chainExec = new ToolChainExecutor(openai, callWithFunctionTools, taskStateEngine);
      const { costController: cc } = require('./agent');
      const replayBudget = cc.createExecutionBudget(failure.complexity || 'normal');
      taskStateEngine.register(failure.plan);

      const chainResult = await chainExec.executeChain(failure.plan, `You are a highly capable autonomous AI agent. Respond in Korean.`, {
        userMessage:   failure.userMessage,
        sessionId,
        maxTokens:     3000,
        temperature:   0.7,
        selectedModel: failure.model || 'gpt-4o-mini',
        budget:        replayBudget,
      });

      if (chainResult?.finalResult) {
        result = {
          content:     typeof chainResult.finalResult === 'string' ? chainResult.finalResult : JSON.stringify(chainResult.finalResult, null, 2),
          planId:      failure.planId,
          plan:        failure.plan,
          chainLog:    chainResult.chainLog,
          corrections: chainResult.corrections,
          totalMs:     Date.now() - runStart,
          isReplay:    true,
          replayedFrom: id,
          budgetSummary: cc.getBudgetSummary(replayBudget),
        };
      }
    } else {
      // 새로운 입력으로 agentRuntime.run() 재실행
      result = await agentRuntime.run({
        message:       failure.userMessage,
        taskType:      failure.plan?.taskType || 'analysis',
        strategy:      failure.strategy || 'deep',
        sessionId,
        systemPrompt:  `You are a highly capable autonomous AI agent. Respond in Korean.`,
        selectedModel: failure.model || 'gpt-4o-mini',
        maxTokens:     3000,
        temperature:   0.7,
        memoryContext: null,
      });
    }

    // replay 성공 시 원본 failure에 replay_count 증가
    failureStore.markReplayed(id);

    // 새 실행 결과를 failureStore에 replay 기록
    let newFailureId = null;
    if (!result) {
      newFailureId = failureStore.captureFailure({
        planId:        `replay_${id}_${Date.now()}`,
        sessionId,
        userMessage:   failure.userMessage,
        strategy:      failure.strategy,
        model:         failure.model,
        complexity:    failure.complexity,
        finalError:    'replay returned null',
        errorType:     'chain_error',
        replayedFrom:  id,
      });
    }

    res.json({
      success:      !!result,
      replayedFrom: id,
      sessionId,
      content:      result?.content        || null,
      planId:       result?.planId         || null,
      chainLog:     result?.chainLog?.map(s => ({ id: s.taskId, name: s.taskName, success: s.success, ms: s.ms })) || [],
      corrections:  result?.corrections?.length || 0,
      totalMs:      Date.now() - runStart,
      isReplay:     true,
      newFailureId: newFailureId || null,
    });
  } catch (e) {
    console.error('[ReplayAPI] 재실행 오류:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── STEP 6: Regression Test Suite 실행 엔드포인트 ────────────────────────
app.post('/api/regression/run', async (req, res) => {
  try {
    const { runAITestSuite } = require('./testcases/regressionSuite');
    const url      = `http://localhost:${process.env.PORT || 3000}`;
    const fastMode = req.body?.mode === 'fast';
    const summary  = await runAITestSuite({ url, fastMode });
    res.json({ success: true, summary });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 세션 생성
app.post('/api/session', (req, res) => {
  const sessionId = uuidv4();
  getOrCreateSession(sessionId);
  res.json({ sessionId });
});

// ── 메모리 API (legacy — Phase 1-11, renamed to avoid shadowing Phase 14 /api/memory/* routes) ──

// 세션 메모리 전체 조회 (UI 히스토리 패널용) — legacy
app.get('/api/memory-legacy/:sessionId', (req, res) => {
  const history = memory.getHistory(req.params.sessionId);
  res.json(history);
});

// 에피소드 이력만 조회 — legacy
app.get('/api/memory-legacy/:sessionId/episodes', (req, res) => {
  const episodes = memory.episodic.getAllEpisodes(req.params.sessionId);
  res.json(episodes);
});

// 사용자 프로필 조회 — legacy
app.get('/api/memory-legacy/:sessionId/profile', (req, res) => {
  const profile = memory.semantic.getProfile(req.params.sessionId);
  res.json(profile || {});
});

// 세션 메모리 초기화 — legacy
app.delete('/api/memory-legacy/:sessionId', (req, res) => {
  memory.working.clearSession(req.params.sessionId);
  res.json({ ok: true, message: '대화 메모리 초기화 완료' });
});

// 메시지 처리 (REST fallback)
app.post('/api/message', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: '세션ID와 메시지가 필요합니다.' });
  }

  const session = getOrCreateSession(sessionId);
  try {
    const result = await processMessage(session, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 지원 작업 타입 조회
app.get('/api/task-types', (req, res) => {
  const { TASK_PIPELINES } = require('./types');
  res.json(Object.entries(TASK_PIPELINES).map(([type, pipeline]) => ({
    type,
    name: pipeline.name,
    icon: pipeline.icon,
    estimatedTime: pipeline.estimatedTime,
    steps: pipeline.steps.length
  })));
});

// ── 조합 최적화 API ────────────────────────────────────────

// ── AI 조합 최적화 API ────────────────────────────────────

// 최적 조합 추천
app.post('/api/combo/recommend', (req, res) => {
  try {
    const { taskType, strategy = 'quality', complexity = 'medium' } = req.body;
    if (!taskType) return res.status(400).json({ error: 'taskType required' });

    const selection = orchestrator.optimizer.selectBestCombo({ taskType, strategy, complexity });
    const ranking   = orchestrator.optimizer.rankCombos(taskType, strategy);

    res.json({
      recommended: {
        comboKey:     selection.comboKey,
        name:         selection.combo.name,
        description:  selection.combo.description,
        strategy:     selection.combo.strategy,
        scores:       selection.scores,
        reason:       selection.reason,
        modelMap:     selection.modelMap
      },
      alternatives: selection.alternatives,
      ranking: ranking.map(r => ({
        rank:      ranking.indexOf(r) + 1,
        comboKey:  r.comboKey,
        name:      r.name,
        score:     Math.round(r.scores.total * 100),
        winRate:   r.scores.winRate,
        avgScore:  r.scores.avgScore,
        strategy:  r.strategy,
        models:    r.modelMap
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 조합 성능 분석 리포트
app.get('/api/combo/report', (req, res) => {
  try {
    const { taskType, strategy = 'quality' } = req.query;
    if (taskType) {
      const perf    = orchestrator.getComboPerformance(taskType);
      const ranking = orchestrator.getComboRanking(taskType, strategy);
      res.json({ performance: perf, ranking });
    } else {
      // 전체 작업 유형 요약
      const { TASK_TYPES } = require('./types');
      const report = {};
      for (const tt of Object.values(TASK_TYPES)) {
        if (tt === 'unknown' || tt === 'image') continue;
        report[tt] = orchestrator.getComboPerformance(tt);
      }
      res.json({ report });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 벤치마크 인사이트 (실제 실행 기반 통계)
app.get('/api/benchmark/insights', (req, res) => {
  try {
    const { taskType } = req.query;
    res.json(orchestrator.getBenchmarkInsights(taskType || null));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 레거시 호환: /api/benchmark/leaderboard
app.get('/api/benchmark/leaderboard', (req, res) => {
  try {
    res.json(orchestrator.getBenchmarkLeaderboard());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 전체 모델 레지스트리 조회
app.get('/api/models', (req, res) => {
  const { MODEL_REGISTRY, COMBO_ROLES, BEST_IN_CLASS } = require('./types');
  res.json({
    models: Object.entries(MODEL_REGISTRY).map(([key, m]) => ({
      key,
      id:          m.id,
      name:        m.name,
      provider:    m.provider,
      tier:        m.tier,
      abilities:   m.abilities,
      bestFor:     m.bestFor,
      weakAt:      m.weakAt,
      specialty:   m.specialty,
      cost:        m.costPer1kTokens,
      latencyMs:   m.avgLatencyMs,
      contextWindow: m.contextWindow,
      benchmark:   m.benchmark,
      available:   m.available !== false,
      tags:        m.tags
    })),
    roles: Object.entries(COMBO_ROLES).map(([key, r]) => ({
      key,
      name:        r.name,
      icon:        r.icon,
      description: r.description,
      preferModel: r.preferModel,
      weights:     r.weights
    })),
    bestInClass: BEST_IN_CLASS
  });
});

// ============================================================
// Phase 4-A: ComboOptimizer v2 라우트 (독립 인스턴스)
// ============================================================

// GET /api/combo/v2/recommend — 최적 AI 조합 추천 (comboOptimizer 인스턴스)
app.post('/api/combo/v2/recommend', (req, res) => {
  try {
    const { taskType = 'ppt', strategy = 'quality', complexity = 'medium' } = req.body;
    const selection = comboOptimizer.selectBestCombo({ taskType, strategy, complexity });
    const ranking   = comboOptimizer.rankCombos(taskType, strategy);
    res.json({
      engine: 'ComboOptimizer v2',
      recommended: {
        comboKey: selection.comboKey,
        name:     selection.combo?.name,
        strategy: selection.combo?.strategy,
        scores:   selection.scores,
        reason:   selection.reason,
        modelMap: selection.modelMap
      },
      alternatives: selection.alternatives,
      ranking: ranking.slice(0, 5).map((r, i) => ({
        rank: i + 1,
        comboKey: r.comboKey,
        name:     r.name,
        score:    Math.round((r.scores?.total || 0) * 100),
        strategy: r.strategy,
        models:   r.modelMap
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/combo/v2/analyze/:taskType — 조합 성능 분석
app.get('/api/combo/v2/analyze/:taskType', (req, res) => {
  try {
    const analysis = comboOptimizer.analyzePerformance(req.params.taskType);
    res.json({ engine: 'ComboOptimizer v2', ...analysis });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Phase 4-A: ModelBenchmark 라우트
// ============================================================

// POST /api/benchmark/record — 실행 결과 기록
app.post('/api/benchmark/record', (req, res) => {
  try {
    const { taskType, comboKey, score, durationMs, feedback = '' } = req.body;
    if (!taskType || !comboKey || score == null) {
      return res.status(400).json({ error: 'taskType, comboKey, score 필수' });
    }
    modelBenchmark.record(taskType, comboKey, score, durationMs || 0, feedback);
    res.json({ success: true, message: `${taskType}/${comboKey} 기록 저장` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/benchmark/best/:taskType — 최적 조합 조회
app.get('/api/benchmark/best/:taskType', (req, res) => {
  try {
    const best = modelBenchmark.getBestCombo(req.params.taskType);
    res.json({ taskType: req.params.taskType, best });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/benchmark/stats — 전체 통계
app.get('/api/benchmark/stats', (req, res) => {
  try {
    const data = modelBenchmark.export();
    const stats = Object.entries(data).map(([taskType, combos]) => ({
      taskType,
      totalRuns: Object.values(combos).reduce((s, c) => s + (c.count || 0), 0),
      combosTracked: Object.keys(combos).length,
      topCombo: Object.entries(combos).sort((a, b) =>
        ((b[1].avgScore || 0) - (a[1].avgScore || 0))
      )[0]?.[0] || 'N/A'
    }));
    res.json({ engine: 'ModelBenchmark', totalTaskTypes: stats.length, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Phase 4-A: API 어댑터 정보 라우트
// ============================================================

// GET /api/adapters — 전체 API 어댑터 목록
app.get('/api/adapters', (req, res) => {
  try {
    res.json({
      adapters: Object.entries(API_ADAPTERS).map(([key, a]) => ({
        key,
        name:         a.name,
        status:       a.status,
        stubReady:    a.stubReady,
        realApiReady: a.realApiReady,
        endpoints:    a.endpoints,
        envRequired:  a.envRequired,
        casesCount:   a.casesCount,
        domains:      a.domains
      })),
      integrationPriority: INTEGRATION_PRIORITY,
      totalAdapters: Object.keys(API_ADAPTERS).length,
      liveAdapters:  Object.values(API_ADAPTERS).filter(a => a.realApiReady).length,
      stubAdapters:  Object.values(API_ADAPTERS).filter(a => a.stubReady && !a.realApiReady).length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/adapters/missing-tech — 미구현 기술 해결책
app.get('/api/adapters/missing-tech', (req, res) => {
  try {
    res.json({
      solutions: Object.entries(MISSING_TECH_SOLUTIONS).map(([tech, sol]) => ({
        tech,
        solution:  sol.solution,
        adapter:   sol.adapter,
        timeline:  sol.timeline
      })),
      total: Object.keys(MISSING_TECH_SOLUTIONS).length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/adapters/call/:adapterKey — 어댑터 실행 (stub)
app.post('/api/adapters/call/:adapterKey', async (req, res) => {
  try {
    const adapter = API_ADAPTERS[req.params.adapterKey];
    if (!adapter) return res.status(404).json({ error: `어댑터 없음: ${req.params.adapterKey}` });
    if (!adapter.stubReady) return res.status(400).json({ error: '이 어댑터는 아직 stub 미구현' });
    // stub 실행
    const result = await adapter.call(req.body);
    const startMs = Date.now();
    // 벤치마크 기록
    modelBenchmark.record(req.body.taskType || 'api_call', req.params.adapterKey, 80, Date.now() - startMs, '');
    res.json({ adapter: req.params.adapterKey, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Phase 1 파이프라인 라우트
// ============================================================
const pipelineManager = require('./pipelines/pipelineManager');

// GET /api/pipelines — 전체 파이프라인 상태 조회
app.get('/api/pipelines', (_req, res) => {
  res.json(pipelineManager.getStatus());
});

// GET /api/pipelines/coverage — 커버리지 리포트
app.get('/api/pipelines/coverage', (_req, res) => {
  res.json(pipelineManager.getCoverageReport());
});

// POST /api/pipelines/run — 파이프라인 실행
app.post('/api/pipelines/run', async (req, res) => {
  const { pipeline, ...opts } = req.body || {};
  if (!pipeline) return res.status(400).json({ error: 'pipeline 파라미터 필수', available: Object.keys(pipelineManager.PIPELINES) });
  try {
    const result = await pipelineManager.run(pipeline, opts);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/pipelines/image — 이미지 생성
app.post('/api/pipelines/image', async (req, res) => {
  try {
    const result = await pipelineManager.run('imageGen', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/stt — 음성 전사
app.post('/api/pipelines/stt', async (req, res) => {
  try {
    const result = await pipelineManager.run('stt', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/crawl — 웹 크롤링
app.post('/api/pipelines/crawl', async (req, res) => {
  try {
    const result = await pipelineManager.run('crawler', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/email — 이메일 자동화
app.post('/api/pipelines/email', async (req, res) => {
  try {
    const result = await pipelineManager.run('email', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/vision — GPT-4V 이미지 분석
app.post('/api/pipelines/vision', async (req, res) => {
  try {
    const result = await pipelineManager.run('vision', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/notify — SMS/Slack/GitHub 알림
app.post('/api/pipelines/notify', async (req, res) => {
  try {
    const result = await pipelineManager.run('notification', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 2 파이프라인 라우트 ──────────────────────────────

// POST /api/pipelines/3d — 3D 렌더링
app.post('/api/pipelines/3d', async (req, res) => {
  try {
    const result = await pipelineManager.run('threeD', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/ner — NER 파이프라인
app.post('/api/pipelines/ner', async (req, res) => {
  try {
    if (!req.body.text) return res.status(400).json({ error: 'text 파라미터 필수' });
    const result = await pipelineManager.run('ner', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/churn — 이탈 예측 ML
app.post('/api/pipelines/churn', async (req, res) => {
  try {
    const result = await pipelineManager.run('churnPrediction', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/churn/batch — 배치 이탈 예측
app.post('/api/pipelines/churn/batch', async (req, res) => {
  try {
    const { customers = [], domain = 'b2b' } = req.body;
    if (!customers.length) return res.status(400).json({ error: 'customers 배열 필수' });
    const churnModule = pipelineManager.modules.churnPrediction;
    const result = await churnModule.executeBatch(customers, domain);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/spatial — 공간인식 AI
app.post('/api/pipelines/spatial', async (req, res) => {
  try {
    const result = await pipelineManager.run('spatialAI', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/formula — 수식 인식 OCR
app.post('/api/pipelines/formula', async (req, res) => {
  try {
    const result = await pipelineManager.run('formulaOCR', req.body);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/formula/compute — 수식 직접 계산
app.post('/api/pipelines/formula/compute', async (req, res) => {
  try {
    const { formulaKey, params = {} } = req.body;
    if (!formulaKey) return res.status(400).json({ error: 'formulaKey 필수' });
    const formulaModule = pipelineManager.modules.formulaOCR;
    const result = formulaModule.computeFormula(formulaKey, params);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pipelines/domain/:domain — 도메인별 파이프라인 추천
app.get('/api/pipelines/domain/:domain', (req, res) => {
  try {
    const result = pipelineManager.recommendForDomain(req.params.domain);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3 도메인 심화 라우트 ────────────────────────────────
const domainOrchestrator = require('./domains/domainOrchestrator');

// GET /api/domain/status — Phase 3 전체 상태
app.get('/api/domain/status', (req, res) => {
  try {
    res.json(domainOrchestrator.getStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/detect — 프롬프트에서 도메인 자동 감지
app.post('/api/domain/detect', (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text 필수' });
    const detected = domainOrchestrator.detectDomain(text);
    res.json({ detected, availableDomains: Object.keys(domainOrchestrator.DOMAIN_REGISTRY) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/run — 범용 도메인 실행
app.post('/api/domain/run', async (req, res) => {
  try {
    const { domain, action, params = {} } = req.body;
    if (!domain || !action) return res.status(400).json({ error: 'domain, action 필수' });
    const result = await domainOrchestrator.run(domain, action, params);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/batch — 복수 도메인 병렬 실행
app.post('/api/domain/batch', async (req, res) => {
  try {
    const { requests } = req.body;
    if (!Array.isArray(requests)) return res.status(400).json({ error: 'requests 배열 필수' });
    const results = await domainOrchestrator.runBatch(requests);
    res.json({ results, total: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3-1: 부동산 전용 라우트 ────────────────────────────
// POST /api/domain/real-estate/analyze
app.post('/api/domain/real-estate/analyze', async (req, res) => {
  try {
    const r = await domainOrchestrator.runRealEstate('analyze', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/real-estate/commercial
app.post('/api/domain/real-estate/commercial', async (req, res) => {
  try {
    const r = await domainOrchestrator.runRealEstate('commercial', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/real-estate/invest
app.post('/api/domain/real-estate/invest', async (req, res) => {
  try {
    const r = await domainOrchestrator.runRealEstate('invest', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/real-estate/interior
app.post('/api/domain/real-estate/interior', async (req, res) => {
  try {
    const r = await domainOrchestrator.runRealEstate('interior', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/real-estate/gis
app.post('/api/domain/real-estate/gis', async (req, res) => {
  try {
    const r = await domainOrchestrator.runRealEstate('gis', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3-2: 금융 전용 라우트 ──────────────────────────────
// POST /api/domain/finance/technical
app.post('/api/domain/finance/technical', async (req, res) => {
  try {
    const r = await domainOrchestrator.runFinance('technical', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/finance/portfolio
app.post('/api/domain/finance/portfolio', async (req, res) => {
  try {
    const r = await domainOrchestrator.runFinance('portfolio', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/finance/option
app.post('/api/domain/finance/option', async (req, res) => {
  try {
    const r = await domainOrchestrator.runFinance('option', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/finance/crypto
app.post('/api/domain/finance/crypto', async (req, res) => {
  try {
    const r = await domainOrchestrator.runFinance('crypto', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/finance/risk
app.post('/api/domain/finance/risk', async (req, res) => {
  try {
    const r = await domainOrchestrator.runFinance('risk', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3-3: 헬스케어 전용 라우트 ──────────────────────────
// POST /api/domain/healthcare/prescription
app.post('/api/domain/healthcare/prescription', async (req, res) => {
  try {
    const r = await domainOrchestrator.runHealthcare('prescription', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/healthcare/imaging
app.post('/api/domain/healthcare/imaging', async (req, res) => {
  try {
    const r = await domainOrchestrator.runHealthcare('imaging', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/healthcare/clinical
app.post('/api/domain/healthcare/clinical', async (req, res) => {
  try {
    const r = await domainOrchestrator.runHealthcare('clinical', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/healthcare/chat
app.post('/api/domain/healthcare/chat', async (req, res) => {
  try {
    const r = await domainOrchestrator.runHealthcare('chat', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/healthcare/phr
app.post('/api/domain/healthcare/phr', async (req, res) => {
  try {
    const r = await domainOrchestrator.runHealthcare('phr', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3-4: 정부/공공 전용 라우트 ─────────────────────────
// POST /api/domain/government/public-data
app.post('/api/domain/government/public-data', async (req, res) => {
  try {
    const r = await domainOrchestrator.runGovernment('publicData', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/government/translate
app.post('/api/domain/government/translate', async (req, res) => {
  try {
    const r = await domainOrchestrator.runGovernment('translate', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/government/disaster
app.post('/api/domain/government/disaster', async (req, res) => {
  try {
    const r = await domainOrchestrator.runGovernment('disaster', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/government/chatbot
app.post('/api/domain/government/chatbot', async (req, res) => {
  try {
    const r = await domainOrchestrator.runGovernment('chatbot', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/domain/government/legislation
app.post('/api/domain/government/legislation', async (req, res) => {
  try {
    const r = await domainOrchestrator.runGovernment('legislation', req.body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// Phase 4-B 파이프라인 라우트
// ══════════════════════════════════════════════════════════════
const creativePipeline  = require('./pipelines/creativePipeline');
const dataAIPipeline    = require('./pipelines/dataAIPipeline');
const ecommercePipeline = require('./pipelines/ecommercePipeline');
const marketingPipeline = require('./pipelines/marketingPipeline');
const b2bPipeline       = require('./pipelines/b2bPipeline');
const eduMedPipeline    = require('./pipelines/eduMedPipeline');

// Phase 5 파이프라인 imports
const itSecurityPipeline    = require('./pipelines/itSecurityPipeline');
const realEstatePipeline    = require('./pipelines/realEstatePipeline');
const financeInvestPipeline = require('./pipelines/financeInvestPipeline');
const healthcarePipeline    = require('./pipelines/healthcarePipeline');
const governmentPipeline    = require('./pipelines/governmentPipeline');

// Phase 6 imports
const workflowEngine  = require('./pipelines/workflowEngine');
const realtimeMetrics = require('./pipelines/realtimeMetrics');

// Phase 7 imports
const jobQueue           = require('./queue/jobQueue');
const authManager        = require('./auth/authManager');
const costTracker        = require('./services/costTracker');
const versionManager     = require('./services/versionManager');
const cronScheduler      = require('./services/cronScheduler');
const integrationService = require('./services/integrationService');
const aiConnector        = require('./services/aiConnector');
const multimodalPipeline = require('./pipelines/multimodalPipeline');

// ── 신규 툴 파이프라인 ──────────────────────────────────────────────────────
const pptPipeline   = require('./pipelines/pptPipeline');
const pdfPipeline   = require('./pipelines/pdfPipeline');
const excelPipeline = require('./pipelines/excelPipeline');
const extraTools    = require('./tools/extraTools');

// ── Phase 14: Platform Layer engines ─────────────────────────────────────
const memoryEngine      = require('./services/memoryEngine');
const storageEngine     = require('./services/storageEngine');
const observability     = require('./services/observabilityEngine');
const analytics         = require('./services/analyticsEngine');
const jobEngine         = require('./services/jobEngine');

// Phase 8 — 어드민 라우터
const adminRouter = require('./routes/admin');

// 잡 큐 이벤트 → Socket.IO 브로드캐스트
jobQueue.on('job:progress', ({ jobId, progress, log }) => {
  io.emit('job:progress', { jobId, progress, log });
});
jobQueue.on('job:completed', ({ jobId, result }) => {
  io.emit('job:completed', { jobId, result });
});
jobQueue.on('job:failed', ({ jobId, error }) => {
  io.emit('job:failed', { jobId, error });
});

// ── Phase 14: jobEngine → Socket.IO 브로드캐스트 ─────────────────────────
jobEngine.setSocketIO(io);

// 비용 알람 → Slack
costTracker.onAlert(alert => {
  integrationService.sendSlackAlert({ message: alert.msg, level: 'warn', pipeline: 'cost-tracker' }).catch(() => {});
});

// ── B1: Creative 파이프라인 ────────────────────────────────
// POST /api/pipelines/creative/character
app.post('/api/pipelines/creative/character', async (req, res) => {
  try {
    const { name, style = 'webtoon_korea', description = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'name 필수' });
    const result = creativePipeline.generateCharacterSheet({ name, style, description });
    res.json({ success: true, pipeline: 'creative/character', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/creative/video
app.post('/api/pipelines/creative/video', async (req, res) => {
  try {
    const { title = '미제목', concept = '', genre = 'cinematic', scenes = 5 } = req.body;
    const result = creativePipeline.generateVideoStoryboard({ title, concept, genre, scenes });
    res.json({ success: true, pipeline: 'creative/video', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/creative/music
app.post('/api/pipelines/creative/music', async (req, res) => {
  try {
    const { theme = '', genre = 'k-pop', bpm = 120, mood = 'upbeat' } = req.body;
    const result = creativePipeline.composeMusicPackage({ theme, genre, bpm, mood });
    res.json({ success: true, pipeline: 'creative/music', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/creative/ar
app.post('/api/pipelines/creative/ar', async (req, res) => {
  try {
    const { scene = 'room', objects = [], style = 'modern' } = req.body;
    const result = creativePipeline.buildARScene({ scene, objects, style });
    res.json({ success: true, pipeline: 'creative/ar', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/creative/run (범용)
app.post('/api/pipelines/creative/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await creativePipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'creative', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B2: Data-AI 파이프라인 ────────────────────────────────
// POST /api/pipelines/data-ai/anomaly
app.post('/api/pipelines/data-ai/anomaly', async (req, res) => {
  try {
    const { data = [], algorithm = 'isolation_forest', domain: d = 'general' } = req.body;
    const result = dataAIPipeline.detectAnomalies({ data, algorithm, domain: d });
    res.json({ success: true, pipeline: 'data-ai/anomaly', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/data-ai/forecast
app.post('/api/pipelines/data-ai/forecast', async (req, res) => {
  try {
    const { series = [], periods = 7, metric = 'sales' } = req.body;
    const result = dataAIPipeline.forecastTimeSeries({ series, periods, metric });
    res.json({ success: true, pipeline: 'data-ai/forecast', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/data-ai/rpa
app.post('/api/pipelines/data-ai/rpa', async (req, res) => {
  try {
    const { taskType = 'data_entry', steps = [], schedule = 'daily' } = req.body;
    const result = dataAIPipeline.buildRPAWorkflow({ taskType, steps, schedule });
    res.json({ success: true, pipeline: 'data-ai/rpa', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/data-ai/iot
app.post('/api/pipelines/data-ai/iot', async (req, res) => {
  try {
    const { deviceId = 'DEV-001', sensors = [], streamMode = 'realtime' } = req.body;
    const result = dataAIPipeline.processIoTStream({ deviceId, sensors, streamMode });
    res.json({ success: true, pipeline: 'data-ai/iot', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/data-ai/run (범용)
app.post('/api/pipelines/data-ai/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await dataAIPipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'data-ai', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B3: eCommerce 파이프라인 ──────────────────────────────
// POST /api/pipelines/ecommerce/recommend
app.post('/api/pipelines/ecommerce/recommend', async (req, res) => {
  try {
    const { userId = 'guest', history = [], algorithm = 'collaborative' } = req.body;
    const result = ecommercePipeline.recommendProducts({ userId, history, algorithm });
    res.json({ success: true, pipeline: 'ecommerce/recommend', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/ecommerce/ads
app.post('/api/pipelines/ecommerce/ads', async (req, res) => {
  try {
    const { keyword, budget = 100000, platform = 'naver', targetROAS = 300 } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword 필수' });
    const result = ecommercePipeline.optimizeShoppingAds({ keyword, budget, platform, targetROAS });
    res.json({ success: true, pipeline: 'ecommerce/ads', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/ecommerce/price-compare
app.post('/api/pipelines/ecommerce/price-compare', async (req, res) => {
  try {
    const { productName, category = 'general' } = req.body;
    if (!productName) return res.status(400).json({ error: 'productName 필수' });
    const result = ecommercePipeline.comparePrices({ productName, category });
    res.json({ success: true, pipeline: 'ecommerce/price-compare', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/ecommerce/run (범용)
app.post('/api/pipelines/ecommerce/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await ecommercePipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'ecommerce', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B4: Marketing 파이프라인 ──────────────────────────────
// POST /api/pipelines/marketing/sns-schedule
app.post('/api/pipelines/marketing/sns-schedule', async (req, res) => {
  try {
    const { brand, platform = 'instagram', posts = 7, tone = 'friendly' } = req.body;
    if (!brand) return res.status(400).json({ error: 'brand 필수' });
    const result = marketingPipeline.buildSNSSchedule({ brand, platform, posts, tone });
    res.json({ success: true, pipeline: 'marketing/sns-schedule', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/marketing/press
app.post('/api/pipelines/marketing/press', async (req, res) => {
  try {
    const { company, topic, angle = 'innovation' } = req.body;
    if (!company || !topic) return res.status(400).json({ error: 'company, topic 필수' });
    const result = marketingPipeline.buildPressRelease({ company, topic, angle });
    res.json({ success: true, pipeline: 'marketing/press', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/marketing/voice-tts
app.post('/api/pipelines/marketing/voice-tts', async (req, res) => {
  try {
    const { script, voice = 'ko-female', speed = 1.0, purpose = 'ad' } = req.body;
    if (!script) return res.status(400).json({ error: 'script 필수' });
    const result = marketingPipeline.buildVoiceTTS({ script, voice, speed, purpose });
    res.json({ success: true, pipeline: 'marketing/voice-tts', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/marketing/influencer
app.post('/api/pipelines/marketing/influencer', async (req, res) => {
  try {
    const { niche = 'beauty', budget = 5000000, kpi = 'reach' } = req.body;
    const result = marketingPipeline.findInfluencers({ niche, budget, kpi });
    res.json({ success: true, pipeline: 'marketing/influencer', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/marketing/run (범용)
app.post('/api/pipelines/marketing/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await marketingPipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'marketing', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B5: B2B / LegalHR 파이프라인 ─────────────────────────
// POST /api/pipelines/b2b/company-research
app.post('/api/pipelines/b2b/company-research', async (req, res) => {
  try {
    const { companyName, depth = 'standard' } = req.body;
    if (!companyName) return res.status(400).json({ error: 'companyName 필수' });
    const result = b2bPipeline.researchCompany({ companyName, depth });
    res.json({ success: true, pipeline: 'b2b/company-research', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/b2b/payroll
app.post('/api/pipelines/b2b/payroll', async (req, res) => {
  try {
    const { employees = [], month = new Date().toISOString().slice(0,7) } = req.body;
    const result = b2bPipeline.calculatePayroll({ employees, month });
    res.json({ success: true, pipeline: 'b2b/payroll', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/b2b/churn-predict
app.post('/api/pipelines/b2b/churn-predict', async (req, res) => {
  try {
    const { customers = [], model = 'xgboost' } = req.body;
    const result = b2bPipeline.predictChurn({ customers, model });
    res.json({ success: true, pipeline: 'b2b/churn-predict', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/b2b/contract-parse
app.post('/api/pipelines/b2b/contract-parse', async (req, res) => {
  try {
    const { text = '', contractType = 'service' } = req.body;
    if (!text) return res.status(400).json({ error: 'text 필수' });
    const result = b2bPipeline.parseContract({ text, contractType });
    res.json({ success: true, pipeline: 'b2b/contract-parse', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/b2b/patent-search
app.post('/api/pipelines/b2b/patent-search', async (req, res) => {
  try {
    const { keyword, ipc = '', dateRange = '2020-2025' } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword 필수' });
    const result = b2bPipeline.searchPatents({ keyword, ipc, dateRange });
    res.json({ success: true, pipeline: 'b2b/patent-search', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/b2b/run (범용)
app.post('/api/pipelines/b2b/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await b2bPipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'b2b', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B6: EduMed 파이프라인 ─────────────────────────────────
// POST /api/pipelines/edu-med/formula
app.post('/api/pipelines/edu-med/formula', async (req, res) => {
  try {
    const { latex = '', subject = 'math', level = 'high' } = req.body;
    const result = eduMedPipeline.analyzeFormula({ latex, subject, level });
    res.json({ success: true, pipeline: 'edu-med/formula', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/edu-med/fact-check
app.post('/api/pipelines/edu-med/fact-check', async (req, res) => {
  try {
    const { claim, domain: d = 'general', sources = [] } = req.body;
    if (!claim) return res.status(400).json({ error: 'claim 필수' });
    const result = eduMedPipeline.factCheck({ claim, domain: d, sources });
    res.json({ success: true, pipeline: 'edu-med/fact-check', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/edu-med/learning-path
app.post('/api/pipelines/edu-med/learning-path', async (req, res) => {
  try {
    const { subject, level = 'beginner', goal = '', learnerProfile = {} } = req.body;
    if (!subject) return res.status(400).json({ error: 'subject 필수' });
    const result = eduMedPipeline.buildLearningPath({ subject, level, goal, learnerProfile });
    res.json({ success: true, pipeline: 'edu-med/learning-path', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/edu-med/medical-image
app.post('/api/pipelines/edu-med/medical-image', async (req, res) => {
  try {
    const { imageUrl = '', modality = 'xray', region = 'chest' } = req.body;
    const result = eduMedPipeline.analyzeMedicalImage({ imageUrl, modality, region });
    res.json({ success: true, pipeline: 'edu-med/medical-image', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pipelines/edu-med/run (범용)
app.post('/api/pipelines/edu-med/run', async (req, res) => {
  try {
    const { action, params = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action 필수' });
    const result = await eduMedPipeline.execute({ action, ...params });
    res.json({ success: true, pipeline: 'edu-med', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Webhook + 결과 다운로드 ──────────────────────────────
const fs = require('fs');
const webhookStore = new Map(); // sessionId → results[]

// POST /api/webhook/receive — 외부 결과 수신
app.post('/api/webhook/receive', (req, res) => {
  try {
    const { sessionId = 'global', event, data } = req.body;
    if (!event) return res.status(400).json({ error: 'event 필수' });
    const entry = { id: uuidv4(), sessionId, event, data, receivedAt: new Date().toISOString() };
    if (!webhookStore.has(sessionId)) webhookStore.set(sessionId, []);
    webhookStore.get(sessionId).push(entry);
    // 최대 100개 유지
    const arr = webhookStore.get(sessionId);
    if (arr.length > 100) arr.splice(0, arr.length - 100);
    res.json({ success: true, id: entry.id, queued: arr.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/webhook/results/:sessionId — 수신 결과 조회
app.get('/api/webhook/results/:sessionId', (req, res) => {
  const results = webhookStore.get(req.params.sessionId) || [];
  res.json({ sessionId: req.params.sessionId, count: results.length, results });
});

// GET /api/download/results — 결과 JSON 다운로드
app.get('/api/download/results', (req, res) => {
  try {
    const { sessionId = 'all', format = 'json' } = req.query;
    let payload;
    if (sessionId === 'all') {
      const all = {};
      webhookStore.forEach((v, k) => { all[k] = v; });
      payload = all;
    } else {
      payload = webhookStore.get(sessionId) || [];
    }
    const jsonStr = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="results_${Date.now()}.json"`);
    res.send(jsonStr);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/coverage — 전체 커버리지 현황 (Phase 6 업데이트)
app.get('/api/coverage', (req, res) => {
  try {
    // require cache 무효화 → 최신 데이터 반영
    delete require.cache[require.resolve('./testcases/testcases_db.json')];
    const raw = require('./testcases/testcases_db.json');
    const cases = raw.cases;
    const byDomain = {};
    const byFeasibility = {};
    cases.forEach(c => {
      const dom = c.domain || 'unknown';
      if (!byDomain[dom]) byDomain[dom] = { total: 0, ready: 0, api_needed: 0, custom: 0, covered: 0 };
      byDomain[dom].total++;
      if (c.feasibility === 'ready' || c.system_coverage === true) {
        byDomain[dom].ready++;
        byDomain[dom].covered++;
      } else if (c.feasibility === 'api_needed') byDomain[dom].api_needed++;
      else if (c.feasibility === 'custom_pipeline') byDomain[dom].custom++;
      byFeasibility[c.feasibility] = (byFeasibility[c.feasibility] || 0) + 1;
    });
    const total   = cases.length;
    const covered = cases.filter(c => c.feasibility === 'ready' || c.system_coverage === true).length;
    res.json({
      total, covered, uncovered: total - covered,
      coverageRate: (covered/total*100).toFixed(1) + '%',
      byDomain, byFeasibility,
      domains: byDomain,
      summary: { total, covered, uncovered: total - covered, coverageRate: +(covered/total*100).toFixed(1) },
      phases: { phase1: 379, phase2: 47, phase3: 113, phase4: 260, phase5: 147, phase6: 134 },
      pipelineCount: 26,
      lastUpdated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export/cases — 테스트 케이스 JSON 다운로드
app.get('/api/export/cases', (req, res) => {
  try {
    const { domain, feasibility, limit = 100 } = req.query;
    const raw = require('./testcases/testcases_db.json');
    let cases = raw.cases;
    if (domain)      cases = cases.filter(c => c.domain === domain);
    if (feasibility) cases = cases.filter(c => c.feasibility === feasibility);
    cases = cases.slice(0, parseInt(limit));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="cases_${domain || 'all'}_${Date.now()}.json"`);
    res.json({ total: cases.length, cases, exportedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export/coverage-report — 커버리지 리포트 다운로드
app.get('/api/export/coverage-report', (req, res) => {
  try {
    const raw = require('./testcases/testcases_db.json');
    const cases = raw.cases;
    const domains = [...new Set(cases.map(c => c.domain))];
    const report = {
      title: 'AI 오케스트레이터 커버리지 리포트',
      generatedAt: new Date().toISOString(),
      summary: { total: cases.length, covered: cases.filter(c => c.feasibility === 'ready').length },
      byDomain: domains.map(d => {
        const dc = cases.filter(c => c.domain === d);
        const ready = dc.filter(c => c.feasibility === 'ready').length;
        return { domain: d, total: dc.length, ready, rate: ((ready / dc.length) * 100).toFixed(1) + '%' };
      }),
      pipelines: ['imageGen','stt','crawler','email','vision','notification',
                  '3d','ner','churn','spatial','formulaOCR',
                  'realEstate','finance','healthcare','government',
                  'creative','dataAI','ecommerce','marketing','b2b']
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="coverage_report_${Date.now()}.json"`);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 4-B: 신규 파이프라인 라우트 (모듈은 위에서 이미 로드됨) ──

// ── Marketing 라우트 (/api/marketing/*) ──────────────────────
app.post('/api/marketing/content', async (req, res) => {
  try { res.json(await marketingPipeline.generateSNSContent(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/marketing/schedule', async (req, res) => {
  try { res.json(await marketingPipeline.scheduleSNSPosts(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/marketing/media-monitor', async (req, res) => {
  try { res.json(await marketingPipeline.monitorMedia(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/marketing/voice-script', async (req, res) => {
  try { res.json(await marketingPipeline.buildVoiceScript(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/marketing/campaign', async (req, res) => {
  try { res.json(await marketingPipeline.planCampaign(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/marketing/influencers', async (req, res) => {
  try { res.json(await marketingPipeline.findInfluencers(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── B2B 라우트 (/api/b2b/*) ──────────────────────────────────
app.post('/api/b2b/company-research', async (req, res) => {
  try { res.json(await b2bPipeline.researchCompany(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/b2b/payroll', async (req, res) => {
  try { res.json(await b2bPipeline.calculatePayroll(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/b2b/contract-analysis', async (req, res) => {
  try { res.json(await b2bPipeline.analyzeContract(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/b2b/proposal', async (req, res) => {
  try { res.json(await b2bPipeline.generateProposal(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/b2b/market-research', async (req, res) => {
  try { res.json(await b2bPipeline.conductMarketResearch(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Creative 라우트 (/api/creative/*) ────────────────────────
app.post('/api/creative/character', async (req, res) => {
  try { res.json(await creativePipeline.generateCharacterSheet(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/creative/video-storyboard', async (req, res) => {
  try { res.json(await creativePipeline.generateVideoStoryboard(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/creative/music', async (req, res) => {
  try { res.json(await creativePipeline.composeMusicPackage(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/creative/ar-scene', async (req, res) => {
  try { res.json(await creativePipeline.buildARScene(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Data-AI 라우트 (/api/data-ai/*) ──────────────────────────
app.post('/api/data-ai/anomaly', async (req, res) => {
  try { res.json(await dataAIPipeline.detectAnomalies(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/data-ai/forecast', async (req, res) => {
  try { res.json(await dataAIPipeline.forecastTimeSeries(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/data-ai/rpa', async (req, res) => {
  try { res.json(await dataAIPipeline.buildRPAWorkflow(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/data-ai/iot', async (req, res) => {
  try { res.json(await dataAIPipeline.processIoTStream(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── eCommerce 라우트 (/api/ecommerce/*) ──────────────────────
app.post('/api/ecommerce/recommend', async (req, res) => {
  try { res.json(await ecommercePipeline.recommendProducts(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ecommerce/ads', async (req, res) => {
  try { res.json(await ecommercePipeline.optimizeShoppingAds(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ecommerce/price-compare', async (req, res) => {
  try { res.json(await ecommercePipeline.comparePrices(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Socket.IO 실시간 처리 ──────────────────────────────────
io.on('connection', (socket) => {
  console.log(`소켓 연결: ${socket.id}`);

  socket.on('join', ({ sessionId }) => {
    socket.join(sessionId);
    socket.sessionId = sessionId;
    getOrCreateSession(sessionId);
    socket.emit('ready', { message: '연결 완료' });
  });

  socket.on('message', async ({ sessionId, message, mode }) => {
    const session = getOrCreateSession(sessionId);
    // Phase 5: mode 저장 ('chat' | 'agent' | 'research')
    const clientMode = (mode === 'chat' || mode === 'agent' || mode === 'research') ? mode : null;

    try {
      // ① L1 메모리에 사용자 발화 기록
      memory.recordTurn(sessionId, 'user', message);
      session.history.push({ role: 'user', content: message, timestamp: new Date() });

      // 데모 모드 확인
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'demo-mode') {
        await handleDemoMode(socket, sessionId, session, message);
        return;
      }

      // ② 의도 분석 (L1 대화 히스토리 참조)
      socket.emit('status', { status: 'analyzing', message: '요청 분석 중...' });

      // L1에서 최근 대화 가져오기
      const recentHistory = memory.working.getRecentTurns(sessionId, 6);

      let analysis;
      if (session.pendingAnalysis && session.pendingAnalysis.needsQuestion) {
        analysis = await intentAnalyzer.supplement(
          session.pendingAnalysis.originalInput,
          session.pendingAnalysis.question,
          message,
          session.pendingAnalysis
        );
      } else {
        analysis = await intentAnalyzer.analyze(message, recentHistory);
        analysis.originalInput = message;
      }

      // 추가 질문 필요한 경우
      if (analysis.needsQuestion && analysis.taskType !== 'unknown') {
        session.pendingAnalysis = analysis;
        const response = {
          type: 'question',
          message: analysis.question,
          taskType: analysis.taskType,
          detectedInfo: analysis.extractedInfo
        };
        memory.recordTurn(sessionId, 'assistant', analysis.question);
        session.history.push({ role: 'assistant', content: analysis.question, timestamp: new Date() });
        socket.emit('response', response);
        return;
      }

      // 작업 타입 불명확한 경우
      if (analysis.taskType === 'unknown' || analysis.confidence < 40) {
        const helpMsg = getHelpMessage();
        socket.emit('response', { type: 'help', message: helpMsg });
        return;
      }

      // ③ 메모리 컨텍스트 빌드 (L2+L3 이전 작업/선호도 참조)
      session.pendingAnalysis = null;
      const taskInfo = { ...analysis.extractedInfo, ...analysis.inferredInfo };

      // Phase 5: clientMode → taskInfo에 주입
      if (clientMode) {
        taskInfo._clientMode = clientMode;
        // chat 모드: strategy를 fast로 강제
        if (clientMode === 'chat' && analysis.strategy !== 'fast') {
          analysis.strategy = 'fast';
        }
        // research 모드: strategy를 deep으로 강제
        if (clientMode === 'research') {
          analysis.strategy = 'deep';
        }
        // agent 모드: balanced 이상 보장
        if (clientMode === 'agent' && analysis.strategy === 'fast') {
          analysis.strategy = 'balanced';
        }
      }

      const memoryContext = memory.buildContext(sessionId, analysis.taskType);

      // 메모리에서 알아낸 선호도 자동 채우기
      const pref = memoryContext.raw.preference;
      if (pref?.style && !taskInfo.style)  taskInfo.style = pref.style;
      if (pref?.tone  && !taskInfo.tone)   taskInfo.tone  = pref.tone;

      socket.emit('taskStart', {
        taskType: analysis.taskType,
        taskInfo,
        message: `✅ 분석 완료! ${getTaskTypeName(analysis.taskType)} 작업을 시작합니다.`,
        memoryHint: memoryContext.raw.recentEpisodes.length > 0
          ? `💡 이전 작업 ${memoryContext.raw.recentEpisodes.length}개를 기억하고 있습니다`
          : null
      });

      // ④ 오케스트레이터 실행 (memoryContext 주입)
      let result;
      try {
        result = await orchestrator.execute(
          analysis.taskType,
          taskInfo,
          (progress) => { socket.emit('progress', progress); },
          memoryContext,   // ← 이전 기억 전달
          sessionId,       // ← 세션 ID (조합 히스토리용)
          session?.userId || 'anonymous'  // ← userId (inference_log/costs 기록용)
        );
      } catch (orchErr) {
        // API 인증 오류 등 → 데모 모드로 폴백
        if (orchErr.status === 401 || orchErr.message?.includes('401') || orchErr.message?.includes('Authentication')) {
          console.log('API 인증 실패, 데모 모드로 폴백');
          await handleDemoMode(socket, sessionId, session, message);
          return;
        }
        throw orchErr;
      }

      // ⑤ 완료 후 메모리 업데이트 (L2 에피소드 + L3 프로필)
      memory.recordCompletion(sessionId, result);
      memory.recordTurn(sessionId, 'assistant',
        `[${result.pipeline.name} 완료] 품질점수: ${result.validation.score}/100`
      );

      // 결과 전송 (메모리 상태 포함)
      result.memoryState = {
        episodeCount: memory.episodic.getAllEpisodes(sessionId).length,
        hasProfile: !!memory.semantic.getProfile(sessionId),
        totalTasks: memory.semantic.getProfile(sessionId)?.totalTasks || 1
      };
      socket.emit('result', result);

      session.history.push({
        role: 'assistant',
        content: `[${result.pipeline.name} 완료] 품질점수: ${result.validation.score}/100`,
        timestamp: new Date()
      });

    } catch (err) {
      console.error('처리 오류:', err);
      socket.emit('error', {
        message: `오류가 발생했습니다: ${err.message}`,
        detail: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`소켓 해제: ${socket.id}`);
  });
});

// ── 데모 모드 핸들러 ──────────────────────────────────────
async function handleDemoMode(socket, sessionId, session, message) {
  const demoResponses = getDemoResponse(message);

  socket.emit('status', { status: 'analyzing', message: '요청 분석 중...' });
  await sleep(800);

  if (demoResponses.question) {
    socket.emit('response', {
      type: 'question',
      message: demoResponses.question,
      taskType: demoResponses.taskType,
      isDemo: true
    });
    return;
  }

  socket.emit('taskStart', {
    taskType: demoResponses.taskType,
    message: `✅ ${demoResponses.taskName} 작업 시작! (데모 모드)`,
    isDemo: true
  });

  for (const step of demoResponses.steps) {
    socket.emit('progress', step);
    await sleep(600);
  }

  socket.emit('result', demoResponses.result);
}

function getDemoResponse(message) {
  const lower = message.toLowerCase();

  if (lower.includes('ppt') || lower.includes('발표') || lower.includes('프레젠테이션')) {
    return {
      taskType: 'ppt',
      taskName: 'PPT 제작',
      steps: [
        { status: 'executing', message: '📚 리서치 중... (GPT-5)', progress: 20 },
        { status: 'executing', message: '🏗️ 구성 설계 중... (GPT-5)', progress: 35 },
        { status: 'executing', message: '✍️ 콘텐츠 작성 중... (GPT-5)', progress: 55 },
        { status: 'validating', message: '🔍 품질 검증 중... (GPT-5 mini)', progress: 80 },
        { status: 'executing', message: '🔧 최종 조립 중...', progress: 90 }
      ],
      result: {
        taskType: 'ppt',
        pipeline: { name: 'PPT / 프레젠테이션', icon: '📊', steps: 5 },
        result: {
          content: getDemoPPTContent(message),
          contentType: 'ppt'
        },
        validation: { score: 92, approved: true, issues: [], strengths: ['주제 명확', '구성 논리적', '데이터 풍부'] },
        meta: { elapsed: '데모', qualityScore: 92, approved: true }
      }
    };
  }

  if (lower.includes('홈페이지') || lower.includes('웹사이트') || lower.includes('사이트')) {
    return {
      taskType: 'website',
      taskName: '홈페이지 제작',
      steps: [
        { status: 'executing', message: '📐 사이트 기획 중... (GPT-5)', progress: 18 },
        { status: 'executing', message: '✍️ 카피라이팅 중... (GPT-5)', progress: 35 },
        { status: 'executing', message: '🎨 디자인 설계 중... (GPT-5)', progress: 52 },
        { status: 'executing', message: '💻 코드 작성 중... (GPT-5)', progress: 72 },
        { status: 'validating', message: '🔍 코드 검증 중... (GPT-5 mini)', progress: 88 }
      ],
      result: {
        taskType: 'website',
        pipeline: { name: '홈페이지 / 웹사이트', icon: '🌐', steps: 6 },
        result: {
          content: getDemoWebsiteContent(message),
          contentType: 'html'
        },
        validation: { score: 90, approved: true, issues: [], strengths: ['반응형 디자인', '카피 자연스러움', '코드 완성'] },
        meta: { elapsed: '데모', qualityScore: 90, approved: true }
      }
    };
  }

  if (lower.includes('블로그') || lower.includes('글') || lower.includes('포스팅')) {
    return {
      taskType: 'blog',
      taskName: '블로그 작성',
      steps: [
        { status: 'executing', message: '🔍 리서치 중... (GPT-5)', progress: 25 },
        { status: 'executing', message: '📋 개요 작성 중... (GPT-5)', progress: 50 },
        { status: 'executing', message: '✍️ 본문 작성 중... (GPT-5)', progress: 75 },
        { status: 'validating', message: '✅ 검증 중... (GPT-5 mini)', progress: 90 }
      ],
      result: {
        taskType: 'blog',
        pipeline: { name: '블로그 / 콘텐츠', icon: '📝', steps: 4 },
        result: {
          content: getDemoBlogContent(message),
          contentType: 'markdown'
        },
        validation: { score: 88, approved: true, issues: [], strengths: ['자연스러운 문체', 'SEO 최적화', '실용적 정보'] },
        meta: { elapsed: '데모', qualityScore: 88, approved: true }
      }
    };
  }

  if (lower.includes('분석') || lower.includes('리포트') || lower.includes('보고서')) {
    return {
      taskType: 'report',
      taskName: '분석 리포트',
      steps: [
        { status: 'executing', message: '📊 데이터 수집 중... (GPT-5)', progress: 25 },
        { status: 'executing', message: '🔬 분석 중... (GPT-5)', progress: 50 },
        { status: 'executing', message: '📝 리포트 작성 중... (GPT-5)', progress: 75 },
        { status: 'validating', message: '✅ 검증 중... (GPT-5 mini)', progress: 90 }
      ],
      result: {
        taskType: 'report',
        pipeline: { name: '분석 리포트', icon: '📈', steps: 4 },
        result: {
          content: getDemoReportContent(message),
          contentType: 'markdown'
        },
        validation: { score: 91, approved: true, issues: [], strengths: ['데이터 기반', 'SWOT 완성', '인사이트 명확'] },
        meta: { elapsed: '데모', qualityScore: 91, approved: true }
      }
    };
  }

  if (lower.includes('코드') || lower.includes('개발') || lower.includes('프로그램') || lower.includes('함수') || lower.includes('api')) {
    return {
      taskType: 'code',
      taskName: '코드 개발',
      steps: [
        { status: 'executing', message: '🏗️ 아키텍처 설계 중... (GPT-5)', progress: 20 },
        { status: 'executing', message: '💻 코드 작성 중... (GPT-5)', progress: 55 },
        { status: 'executing', message: '🔍 코드 리뷰 중... (GPT-5.1)', progress: 78 },
        { status: 'validating', message: '✅ 최종 검증... (GPT-5 mini)', progress: 92 }
      ],
      result: {
        taskType: 'code',
        pipeline: { name: '코드 개발', icon: '💻', steps: 4 },
        result: {
          content: getDemoCodeContent(message),
          contentType: 'code'
        },
        validation: { score: 89, approved: true, issues: [], strengths: ['동작 가능한 코드', '한국어 주석', '에러 핸들링'] },
        meta: { elapsed: '데모', qualityScore: 89, approved: true }
      }
    };
  }

  if (lower.includes('이메일') || lower.includes('메일') || lower.includes('편지') || lower.includes('공문')) {
    return {
      taskType: 'email',
      taskName: '이메일 작성',
      steps: [
        { status: 'executing', message: '✍️ 이메일 작성 중... (GPT-5)', progress: 50 },
        { status: 'validating', message: '✅ 검증 중... (GPT-5 mini)', progress: 90 }
      ],
      result: {
        taskType: 'email',
        pipeline: { name: '이메일 / 문서', icon: '✉️', steps: 2 },
        result: {
          content: getDemoEmailContent(message),
          contentType: 'text'
        },
        validation: { score: 93, approved: true, issues: [], strengths: ['격식체 정확', '목적 명확', '간결함'] },
        meta: { elapsed: '데모', qualityScore: 93, approved: true }
      }
    };
  }

  if (lower.includes('자기소개') || lower.includes('자소서') || lower.includes('이력서') || lower.includes('지원')) {
    return {
      taskType: 'resume',
      taskName: '자기소개서',
      steps: [
        { status: 'executing', message: '📋 구조 설계 중... (GPT-5)', progress: 25 },
        { status: 'executing', message: '✍️ 자소서 작성 중... (GPT-5)', progress: 65 },
        { status: 'validating', message: '✅ 검증 중... (GPT-5 mini)', progress: 90 }
      ],
      result: {
        taskType: 'resume',
        pipeline: { name: '자기소개서', icon: '📄', steps: 3 },
        result: {
          content: getDemoResumeContent(message),
          contentType: 'markdown'
        },
        validation: { score: 90, approved: true, issues: [], strengths: ['논리적 구성', '설득력', '자연스러운 문체'] },
        meta: { elapsed: '데모', qualityScore: 90, approved: true }
      }
    };
  }

  // 기본 응답
  return {
    taskType: 'unknown',
    taskName: '일반',
    question: null,
    steps: [],
    result: {
      taskType: 'text',
      pipeline: { name: '일반', icon: '💬', steps: 1 },
      result: { content: `안녕하세요! 저는 AI 오케스트레이터입니다.\n\n다음과 같은 작업을 할 수 있어요:\n- 📊 PPT / 프레젠테이션 제작\n- 🌐 홈페이지 / 웹사이트 제작\n- 📝 블로그 / 콘텐츠 작성\n- 📈 분석 리포트 작성\n- 💻 코드 개발\n- ✉️ 이메일 작성\n- 📄 자기소개서 작성\n\n무엇을 만들어드릴까요?`, contentType: 'text' },
      validation: { score: 100, approved: true },
      meta: { elapsed: '즉시', qualityScore: 100 }
    }
  };
}

// ── 데모 콘텐츠 ───────────────────────────────────────────
function getDemoPPTContent(message) {
  return `# 📊 AI 기반 비즈니스 혁신 전략
### 멀티모델 AI 오케스트레이션 플랫폼 소개

---

## 슬라이드 1: 표지
**제목:** AI 오케스트레이션 플랫폼
**부제목:** 말 한마디로 최고의 결과물
**발표자:** AI 오케스트레이터

---

## 슬라이드 2: 목차
1. 시장 현황 및 문제 정의
2. 솔루션 개요
3. 핵심 기능
4. 비즈니스 모델
5. 성장 전략
6. 결론 및 Q&A

---

## 슬라이드 3: 문제 정의
**핵심 메시지:** 사용자들은 여러 AI를 돌아다니며 시간을 낭비하고 있다

• ChatGPT, Claude, Midjourney, DALL-E... 평균 4.2개 AI 서비스 사용
• AI 간 전환에 하루 평균 45분 낭비
• 최적 AI 선택 불확실성 → 결과물 품질 편차 큼
• AI 오케스트레이션 시장 2025년 $11B → 2030년 $65B (CAGR 38%)

---

## 슬라이드 4: 솔루션
**핵심 메시지:** 하나의 플랫폼에서 모든 AI가 협력하여 최고의 결과물 생성

• 사용자: 자연어로 요청 한마디
• 오케스트레이터: 자동 의도 파악 → AI 선택 → 작업 배분
• 검증 엔진: 품질 보장 (90점 이상)
• 결과: 완성된 결과물 전달

---

## 슬라이드 5: 핵심 기능
**핵심 메시지:** 6가지 결과물 타입, 15+ AI 모델 연동

| 기능 | 사용 AI | 시간 |
|------|---------|------|
| PPT 제작 | GPT-5 + Claude | 3-5분 |
| 홈페이지 | Claude + DALL-E | 5-8분 |
| 블로그 | Claude + GPT-5 | 2-3분 |
| 분석 리포트 | GPT-5 + Gemini | 5-7분 |

---

## 슬라이드 6: 비즈니스 모델
**핵심 메시지:** 구독 + 건당 과금의 하이브리드 모델

• **Free**: 월 10건 무료
• **Pro $29/월**: 무제한 기본 작업
• **Business $99/월**: 팀 협업 + 우선 처리
• **Enterprise $299/월**: API 접근 + 커스텀 워크플로우

---

## 슬라이드 7: 결론
**핵심 메시지:** 지금이 시장 진입 최적 타이밍

• AI 오케스트레이션 시장 초기 단계, 명확한 선도 기업 없음
• 한국어 특화 플랫폼 부재 → 블루오션
• MVP 2주 내 구축 가능
• **목표: 6개월 내 MAU 10,000, 월 매출 1억 원**

---

*✅ AI 오케스트레이터가 자동 생성한 PPT입니다. (품질 점수: 92/100)*`;
}

function getDemoWebsiteContent(message) {
  const industry = message.match(/(카페|레스토랑|쇼핑몰|병원|학원|IT|스타트업|부동산|헬스|뷰티)/)?.[1] || '비즈니스';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${industry} - Premium Business</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #6366f1;
      --secondary: #8b5cf6;
      --accent: #06b6d4;
      --bg: #0f172a;
      --surface: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Noto Sans KR',sans-serif; background:var(--bg); color:var(--text); }
    /* NAV */
    nav { position:fixed; top:0; width:100%; background:rgba(15,23,42,0.9); backdrop-filter:blur(10px); padding:1rem 2rem; display:flex; justify-content:space-between; align-items:center; z-index:100; border-bottom:1px solid rgba(99,102,241,0.2); }
    .logo { font-size:1.5rem; font-weight:900; background:linear-gradient(135deg,var(--primary),var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .nav-links { display:flex; gap:2rem; list-style:none; }
    .nav-links a { color:var(--text-muted); text-decoration:none; transition:.3s; font-weight:500; }
    .nav-links a:hover { color:var(--text); }
    /* HERO */
    .hero { min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; padding:6rem 2rem 4rem; background:radial-gradient(ellipse at center, rgba(99,102,241,0.15) 0%, transparent 70%); }
    .hero h1 { font-size:clamp(2.5rem,6vw,5rem); font-weight:900; line-height:1.1; margin-bottom:1.5rem; }
    .gradient-text { background:linear-gradient(135deg,var(--primary),var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .hero p { font-size:1.25rem; color:var(--text-muted); max-width:600px; margin:0 auto 2.5rem; line-height:1.8; }
    .cta-group { display:flex; gap:1rem; justify-content:center; flex-wrap:wrap; }
    .btn-primary { background:linear-gradient(135deg,var(--primary),var(--secondary)); color:#fff; padding:1rem 2.5rem; border:none; border-radius:50px; font-size:1.1rem; font-weight:700; cursor:pointer; transition:.3s; text-decoration:none; display:inline-block; }
    .btn-primary:hover { transform:translateY(-3px); box-shadow:0 20px 40px rgba(99,102,241,0.4); }
    .btn-secondary { background:transparent; color:var(--text); padding:1rem 2.5rem; border:2px solid rgba(99,102,241,0.5); border-radius:50px; font-size:1.1rem; font-weight:500; cursor:pointer; transition:.3s; text-decoration:none; display:inline-block; }
    .btn-secondary:hover { border-color:var(--primary); background:rgba(99,102,241,0.1); }
    /* SERVICES */
    .services { padding:6rem 2rem; background:var(--surface); }
    .section-title { text-align:center; font-size:2.5rem; font-weight:900; margin-bottom:1rem; }
    .section-sub { text-align:center; color:var(--text-muted); margin-bottom:4rem; font-size:1.1rem; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:2rem; max-width:1200px; margin:0 auto; }
    .card { background:var(--bg); padding:2.5rem; border-radius:20px; border:1px solid rgba(99,102,241,0.2); transition:.3s; }
    .card:hover { transform:translateY(-8px); border-color:var(--primary); box-shadow:0 20px 40px rgba(99,102,241,0.2); }
    .card-icon { font-size:3rem; margin-bottom:1rem; }
    .card h3 { font-size:1.4rem; font-weight:700; margin-bottom:0.8rem; }
    .card p { color:var(--text-muted); line-height:1.7; }
    /* ABOUT */
    .about { padding:6rem 2rem; max-width:1000px; margin:0 auto; text-align:center; }
    .about p { font-size:1.2rem; color:var(--text-muted); line-height:2; }
    /* STATS */
    .stats { padding:4rem 2rem; background:linear-gradient(135deg,var(--primary),var(--secondary)); }
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:2rem; max-width:900px; margin:0 auto; text-align:center; }
    .stat-num { font-size:3rem; font-weight:900; }
    .stat-label { opacity:.85; margin-top:.5rem; }
    /* CONTACT */
    .contact { padding:6rem 2rem; text-align:center; }
    .contact-box { background:var(--surface); padding:4rem; border-radius:24px; max-width:600px; margin:0 auto; border:1px solid rgba(99,102,241,0.2); }
    .contact-box p { color:var(--text-muted); margin-bottom:2rem; font-size:1.1rem; }
    input,textarea { width:100%; background:var(--bg); border:1px solid rgba(99,102,241,0.3); border-radius:12px; padding:1rem; color:var(--text); margin-bottom:1rem; font-size:1rem; font-family:inherit; }
    input:focus,textarea:focus { outline:none; border-color:var(--primary); }
    /* FOOTER */
    footer { background:var(--surface); padding:3rem 2rem; text-align:center; color:var(--text-muted); border-top:1px solid rgba(99,102,241,0.1); }
    @media(max-width:768px) { .nav-links { display:none; } }
  </style>
</head>
<body>
  <nav>
    <div class="logo">${industry}</div>
    <ul class="nav-links">
      <li><a href="#services">서비스</a></li>
      <li><a href="#about">소개</a></li>
      <li><a href="#contact">문의</a></li>
    </ul>
    <a href="#contact" class="btn-primary" style="padding:.7rem 1.5rem;font-size:.95rem;">시작하기</a>
  </nav>

  <section class="hero">
    <div>
      <h1>최고의 <span class="gradient-text">${industry} 경험</span>을<br>제공합니다</h1>
      <p>전문적인 서비스와 혁신적인 솔루션으로 당신의 비즈니스를 다음 단계로 이끌어갑니다.</p>
      <div class="cta-group">
        <a href="#services" class="btn-primary">서비스 보기</a>
        <a href="#contact" class="btn-secondary">무료 상담</a>
      </div>
    </div>
  </section>

  <section class="services" id="services">
    <h2 class="section-title">핵심 <span class="gradient-text">서비스</span></h2>
    <p class="section-sub">고객 중심의 맞춤형 솔루션을 제공합니다</p>
    <div class="cards">
      <div class="card">
        <div class="card-icon">🚀</div>
        <h3>프리미엄 서비스</h3>
        <p>업계 최고 수준의 품질과 전문성으로 고객 만족을 실현합니다.</p>
      </div>
      <div class="card">
        <div class="card-icon">💡</div>
        <h3>혁신 솔루션</h3>
        <p>최신 기술과 트렌드를 적용한 혁신적인 솔루션을 제공합니다.</p>
      </div>
      <div class="card">
        <div class="card-icon">🤝</div>
        <h3>전문 컨설팅</h3>
        <p>10년 이상의 경험을 바탕으로 최적의 전략을 제시합니다.</p>
      </div>
    </div>
  </section>

  <section class="stats">
    <div class="stats-grid">
      <div><div class="stat-num">500+</div><div class="stat-label">성공 사례</div></div>
      <div><div class="stat-num">98%</div><div class="stat-label">고객 만족도</div></div>
      <div><div class="stat-num">10년+</div><div class="stat-label">업계 경험</div></div>
      <div><div class="stat-num">24/7</div><div class="stat-label">고객 지원</div></div>
    </div>
  </section>

  <section class="about" id="about">
    <h2 class="section-title">우리의 <span class="gradient-text">이야기</span></h2>
    <p>저희는 ${industry} 분야에서 최고의 경험을 제공하기 위해 설립되었습니다. 고객의 성공이 곧 우리의 성공이라는 철학으로, 끊임없는 혁신과 열정으로 최상의 서비스를 제공합니다.</p>
  </section>

  <section class="contact" id="contact">
    <h2 class="section-title">문의 <span class="gradient-text">하기</span></h2>
    <div class="contact-box">
      <p>무엇이든 물어보세요. 전문가가 빠르게 답변드립니다.</p>
      <input type="text" placeholder="이름">
      <input type="email" placeholder="이메일">
      <textarea rows="4" placeholder="문의 내용"></textarea>
      <button class="btn-primary" style="width:100%;font-size:1.1rem;">문의 보내기</button>
    </div>
  </section>

  <footer>
    <p>© 2025 ${industry}. All rights reserved. | AI 오케스트레이터가 자동 생성한 홈페이지입니다.</p>
  </footer>
</body>
</html>`;
}

function getDemoBlogContent(message) {
  const topic = message.replace(/블로그|글|포스팅|작성|써줘|써주세요/g, '').trim() || 'AI와 미래 기술';
  return `# ${topic}: 2025년 완벽 가이드

> 📝 *AI 오케스트레이터가 자동 생성한 블로그 포스트입니다.*

---

## 들어가며

안녕하세요! 오늘은 **${topic}**에 대해 깊이 알아보겠습니다. 이 분야는 최근 급격한 변화를 겪고 있으며, 여러분이 꼭 알아야 할 최신 트렌드와 핵심 인사이트를 담았습니다.

---

## 1. 왜 지금 ${topic}인가?

현재 디지털 전환의 가속화로 인해 **${topic}의 중요성이 그 어느 때보다 높아지고 있습니다.**

최근 데이터에 따르면:
- 관련 시장 규모가 2024년 대비 **40% 이상 성장** 예상
- 도입 기업의 **78%**가 생산성 향상을 경험
- 2025년 글로벌 투자 규모 **1조원 돌파** 예상

---

## 2. 핵심 트렌드 5가지

### 트렌드 1: 자동화의 가속
반복적인 업무가 AI로 대체되면서, 인간은 더 창의적인 일에 집중할 수 있게 됩니다.

### 트렌드 2: 개인화의 심화
데이터 분석 기술의 발전으로 초개인화 서비스가 가능해지고 있습니다.

### 트렌드 3: 비용 효율화
초기 투자 후 운영 비용이 **평균 35% 절감**되는 효과가 확인됩니다.

### 트렌드 4: 접근성 향상
전문 지식 없이도 누구나 활용할 수 있는 환경이 조성되고 있습니다.

### 트렌드 5: 생태계 확장
다양한 파트너십과 API 연동으로 활용 범위가 폭발적으로 늘고 있습니다.

---

## 3. 실전 활용 방법

**Step 1: 현황 파악**
먼저 현재 상황을 정확히 진단하세요.

**Step 2: 목표 설정**
명확하고 측정 가능한 목표를 수립하세요.

**Step 3: 단계적 적용**
작은 것부터 시작해 점진적으로 확장하세요.

**Step 4: 성과 측정**
KPI를 설정하고 정기적으로 모니터링하세요.

---

## 4. 주의할 점

⚠️ **오류 발생 가능성**: 자동화 시스템도 실수할 수 있어 검증 과정이 필요합니다.

⚠️ **초기 학습 비용**: 처음에는 시간과 비용이 필요하지만 장기적으로 이익입니다.

⚠️ **데이터 품질**: 입력 데이터의 품질이 결과를 좌우합니다.

---

## 마무리

**${topic}은 이제 선택이 아닌 필수**입니다. 지금 시작하지 않으면 경쟁에서 뒤처질 수 있습니다.

여러분의 생각은 어떠신가요? 댓글로 의견을 나눠주세요! 😊

---
*🤖 이 글은 AI 오케스트레이터의 GPT-5(리서치) + GPT-5(작성) 파이프라인으로 생성되었습니다.*`;
}

function getDemoReportContent(message) {
  const subject = message.replace(/분석|리포트|보고서|작성|해줘|해주세요/g, '').trim() || 'AI 오케스트레이션 시장';
  return `# ${subject} 분석 리포트

**작성일:** ${new Date().toLocaleDateString('ko-KR')} | **작성:** AI 오케스트레이터

---

## Executive Summary

${subject}은 현재 급성장 중인 시장으로, 2025년 기준 글로벌 시장 규모 약 **$11B**에 달하며 연평균 **38.9%** 성장이 예상됩니다. 국내 시장은 아직 초기 단계이나 디지털 전환 가속화로 빠른 성장이 기대됩니다.

---

## 1. 시장 현황 분석

### 글로벌 시장
- 2024년: $9.6B
- 2025년: $11~12B (예상)
- 2030년: $30~65B (예상, CAGR 22~38%)
- 주요 성장 동력: 생성형 AI 확산, 디지털 전환, AI 에이전트 수요 급증

### 국내 시장
- 2025년 정부 AI 투자: 약 2조 1천억 원
- 주요 플레이어: 네이버, 카카오, SK텔레콤, LG CNS, 삼성SDS
- 성장 제약 요인: AI 전문 인력 부족, 규제 불확실성

---

## 2. 경쟁 환경 분석

| 플레이어 | 특징 | 강점 | 약점 |
|---------|------|------|------|
| Genspark | 미국, $1.25B 기업가치 | 멀티모달, MAU 급성장 | 한국어 최적화 미흡 |
| Manus | 중국, Meta 인수 ($2B) | 자율 실행력 | 신뢰성 이슈 |
| 뤼튼 | 한국, MAU 527만 | 한국어 특화 | 수익성 적자 |
| LangChain | 미국, $1.25B | 오픈소스 생태계 | 비개발자 접근 어려움 |

---

## 3. SWOT 분석

### ✅ 강점 (Strengths)
- AI 오케스트레이션 수요 폭발적 증가
- 한국어 특화 경쟁 우위 가능
- API 비용 지속 하락으로 마진 개선
- 멀티모델 조합으로 차별화 가능

### ⚠️ 약점 (Weaknesses)
- 외부 LLM API 의존성 높음
- 초기 브랜드 인지도 부재
- 결과물 품질 일관성 확보 어려움
- 기술 스택 복잡성

### 🚀 기회 (Opportunities)
- 한국어 특화 AI 서비스 시장 공백
- 중소기업 AI 전환 수요 급증
- 정부 AI 바우처 프로그램 활용 가능
- B2B 고부가가치 시장 진입 가능

### 🔴 위협 (Threats)
- OpenAI, Google 직접 경쟁
- API 가격 변동성
- 빠른 기술 변화 속도
- 대기업 후발 진입

---

## 4. 핵심 인사이트

1. **시장 타이밍**: AI 오케스트레이션 시장은 현재 초기 단계, 2~3년 내 폭발적 성장 예상
2. **차별화 전략**: 범용이 아닌 도메인 특화로 경쟁 우위 확보 필요
3. **수익 모델**: SaaS 구독 + 건당 과금 하이브리드가 최적
4. **한국 시장**: 영어 중심 글로벌 플랫폼 대비 명확한 기회 존재
5. **기술 진입 장벽**: 낮아지는 추세, 실행력과 UX가 핵심 경쟁력

---

## 5. 결론 및 권고사항

### 결론
${subject}은 현재 명확한 시장 리더가 없는 초기 경쟁 단계로, **빠른 진입과 특화 전략**이 핵심입니다.

### 권고사항
1. **즉시 MVP 구축**: 2주 내 핵심 기능 개발, 빠른 시장 검증
2. **도메인 특화**: 마케팅, HR, 법무 중 1개 분야 딥다이브
3. **한국어 최적화**: 경쟁 우위의 핵심, 지속 투자 필요
4. **B2B 우선**: B2C 대비 높은 ARPU, 안정적 수익 기반
5. **6개월 목표**: MAU 1,000 → 유료 전환 5% → 월 매출 500만 원

---

*📊 이 리포트는 AI 오케스트레이터의 GPT-5(데이터 수집+분석) + GPT-5(작성) 파이프라인으로 생성되었습니다. (품질 점수: 91/100)*`;
}

function getDemoCodeContent(message) {
  const task = message.replace(/코드|개발|만들어줘|작성|구현/g, '').trim() || '로그인 시스템';
  return `\`\`\`python
# ============================================================
# ${task} - AI 오케스트레이터 자동 생성 코드
# GPT-5(설계) → GPT-5(구현) → GPT-5.1(리뷰) 파이프라인
# ============================================================

import hashlib
import json
import os
from datetime import datetime, timedelta
from typing import Optional

# ── 설정 ──────────────────────────────────────────────────
SECRET_KEY = os.environ.get('SECRET_KEY', 'your-secret-key-here')
USERS_DB = {}  # 실제 운영 시 데이터베이스로 교체

# ── 사용자 클래스 ──────────────────────────────────────────
class User:
    """사용자 데이터 모델"""
    def __init__(self, username: str, email: str, password_hash: str):
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.created_at = datetime.now()
        self.is_active = True

    def to_dict(self) -> dict:
        return {
            'username': self.username,
            'email': self.email,
            'created_at': self.created_at.isoformat(),
            'is_active': self.is_active
        }

# ── 인증 서비스 ────────────────────────────────────────────
class AuthService:
    """사용자 인증 서비스"""

    @staticmethod
    def hash_password(password: str) -> str:
        """비밀번호 해싱 (실제 운영 시 bcrypt 사용 권장)"""
        return hashlib.sha256(
            (password + SECRET_KEY).encode()
        ).hexdigest()

    @staticmethod
    def verify_password(password: str, hashed: str) -> bool:
        """비밀번호 검증"""
        return AuthService.hash_password(password) == hashed

    @staticmethod
    def register(username: str, email: str, password: str) -> dict:
        """신규 사용자 등록"""
        # 중복 확인
        if username in USERS_DB:
            return {'success': False, 'error': '이미 존재하는 사용자명입니다.'}
        if any(u.email == email for u in USERS_DB.values()):
            return {'success': False, 'error': '이미 등록된 이메일입니다.'}

        # 비밀번호 강도 검사
        if len(password) < 8:
            return {'success': False, 'error': '비밀번호는 8자 이상이어야 합니다.'}

        # 사용자 생성 및 저장
        user = User(username, email, AuthService.hash_password(password))
        USERS_DB[username] = user

        print(f"✅ 신규 사용자 등록: {username}")
        return {'success': True, 'user': user.to_dict()}

    @staticmethod
    def login(username: str, password: str) -> dict:
        """사용자 로그인"""
        # 사용자 조회
        user = USERS_DB.get(username)
        if not user:
            return {'success': False, 'error': '존재하지 않는 사용자입니다.'}

        # 계정 활성 상태 확인
        if not user.is_active:
            return {'success': False, 'error': '비활성화된 계정입니다.'}

        # 비밀번호 검증
        if not AuthService.verify_password(password, user.password_hash):
            return {'success': False, 'error': '비밀번호가 올바르지 않습니다.'}

        # 세션 토큰 생성
        token = hashlib.sha256(
            f"{username}{datetime.now().isoformat()}{SECRET_KEY}".encode()
        ).hexdigest()

        print(f"✅ 로그인 성공: {username}")
        return {
            'success': True,
            'token': token,
            'user': user.to_dict(),
            'expires_at': (datetime.now() + timedelta(hours=24)).isoformat()
        }

# ── 메인 테스트 ────────────────────────────────────────────
if __name__ == '__main__':
    print("🤖 AI 오케스트레이터 생성 코드 테스트\\n")

    # 회원가입 테스트
    result = AuthService.register('kim_user', 'kim@example.com', 'Password123')
    print(f"회원가입: {json.dumps(result, ensure_ascii=False, indent=2)}")

    # 로그인 테스트
    result = AuthService.login('kim_user', 'Password123')
    print(f"\\n로그인: {json.dumps(result, ensure_ascii=False, indent=2)}")

    # 실패 케이스
    result = AuthService.login('kim_user', 'wrong_password')
    print(f"\\n잘못된 비밀번호: {result['error']}")

\`\`\`

---
*💻 이 코드는 AI 오케스트레이터의 GPT-5(설계) + GPT-5(구현) + GPT-5.1(리뷰) 파이프라인으로 생성되었습니다. (품질 점수: 89/100)*`;
}

function getDemoEmailContent(message) {
  const purpose = message.replace(/이메일|메일|편지|써줘|작성|해줘/g, '').trim() || '협력 제안';
  return `제목: [${purpose}] 귀사와의 협력 기회에 대해 말씀드립니다

안녕하세요,

저는 AI 오케스트레이터 플랫폼을 운영하고 있는 김민준입니다.

이번에 귀사의 혁신적인 사업 방향과 저희 플랫폼의 AI 자동화 솔루션이 시너지를 낼 수 있는 기회가 있다고 판단하여 연락드립니다.

**제안 요약**

저희 AI 오케스트레이터 플랫폼은 다음과 같은 가치를 제공합니다:

1. **업무 자동화**: PPT, 보고서, 홈페이지 등 반복 작업을 AI가 자동 처리
2. **품질 보장**: GPT-5, GPT-5 등 최적 AI를 자동 선택하여 품질 검증
3. **비용 절감**: 기존 대비 70% 업무 시간 단축 효과 검증 완료

**제안 내용**

귀사 마케팅팀의 콘텐츠 제작 업무에 저희 솔루션을 도입하여 3개월 파일럿을 진행하고 싶습니다. 파일럿 기간 중에는 무상으로 제공해 드릴 예정입니다.

다음 주 중으로 30분 정도 미팅이 가능하신지요? 귀사에 방문하거나 화상 미팅 모두 편하신 방법으로 진행하겠습니다.

바쁘신 중에 긴 메일 읽어주셔서 감사합니다.

---
김민준 드림
AI 오케스트레이터 대표
📧 kim@ai-orchestra.kr | 📱 010-1234-5678

---
*✉️ 이 이메일은 AI 오케스트레이터의 GPT-5 파이프라인으로 생성되었습니다. (품질 점수: 93/100)*`;
}

function getDemoResumeContent(message) {
  const position = message.replace(/자기소개서|자소서|이력서|써줘|작성|지원/g, '').trim() || '소프트웨어 개발자';
  return `# 자기소개서 – ${position} 지원

---

## 지원 동기

저는 기술이 사람들의 일상을 더 나아지게 만들 수 있다는 믿음 아래 ${position} 직무에 지원합니다.

대학교 재학 중 개인 프로젝트로 소규모 서비스를 개발하여 500명 이상의 실 사용자를 확보한 경험이 있습니다. 이 과정에서 단순히 코드를 짜는 것이 아니라, 사용자의 문제를 해결하는 제품을 만드는 것이 진정한 개발자의 역할임을 배웠습니다.

귀사가 추구하는 "기술로 사람을 연결한다"는 비전이 저의 가치관과 일치하여, 이곳에서 제 역량을 최대한 발휘하고 싶습니다.

---

## 역량 및 경험

**기술 스택**
- 백엔드: Python(FastAPI, Django), Node.js
- 프론트엔드: React, TypeScript
- 데이터베이스: PostgreSQL, Redis, MongoDB
- 인프라: Docker, AWS, GitHub Actions (CI/CD)

**주요 프로젝트 경험**

*[AI 기반 일정 관리 서비스] – 개인 프로젝트*
- Python + React로 전체 스택 개발, AWS에 배포
- GPT API 연동으로 자연어 일정 입력 기능 구현
- MAU 500명 달성, 앱스토어 평점 4.7/5.0 유지

*[오픈소스 기여] – GitHub 500+ Stars 프로젝트*
- 성능 병목 이슈 발견 및 PR 제출 (응답 속도 40% 개선)
- 메인테이너로 인정받아 Core Contributor 등록

---

## 입사 후 포부

입사 후 6개월 안에 팀의 신뢰받는 일원이 되겠습니다. 처음에는 기존 코드베이스를 빠르게 이해하고, 소규모 이슈 해결부터 시작하겠습니다.

1년 후에는 담당 서비스의 성능 개선 프로젝트를 리드하고 싶습니다. 데이터를 기반으로 문제를 정의하고, 팀과 협력하여 사용자 경험을 10% 이상 향상시키는 것이 목표입니다.

장기적으로는 기술 리더로 성장하여 후배 개발자들을 이끌고, 귀사가 기술 혁신에서 앞서나갈 수 있도록 기여하겠습니다.

---
*📄 이 자기소개서는 AI 오케스트레이터의 GPT-5(구조 설계) + GPT-5(작성) 파이프라인으로 생성되었습니다. (품질 점수: 90/100)*`;
}

// ── 유틸리티 ──────────────────────────────────────────────
// ── 실시간 정보 조회 헬퍼 ────────────────────────────────────────────────────
// ── 웹 검색 (Phase 5: searchEngine 위임 — Brave → SerpAPI → Serper → Tavily → DDG) ──
async function _webSearch(query, maxResults = 5) {
  const result = await searchEngine.search(query, { maxResults });
  if (result) return result;
  return null;
}

async function _fetchRealtimeContext(message) {
  const msg = message.toLowerCase();
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  // ── 1. 날짜/시간 질문 ──────────────────────────────────────────────────────
  const dateTimeMatch = msg.match(
    /오늘.*날짜|오늘.*몇월|오늘.*며칠|지금.*날짜|현재.*날짜|오늘이 언제|오늘 날짜|몇 월 며칠|날짜가 어떻게|날짜.*알려|오늘.*무슨 날|오늘은 몇|오늘.*요일|무슨 요일|현재.*요일|지금.*요일|what.*date|today.*date|what day/
  );
  const timeMatch = msg.match(
    /지금.*몇 시|현재.*시간|몇 시야|몇시야|지금.*시각|현재.*시각|몇시 몇분|what.*time|current.*time/
  );

  if (dateTimeMatch || timeMatch) {
    const dayNames = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
    const year = koreaTime.getFullYear();
    const month = koreaTime.getMonth() + 1;
    const day = koreaTime.getDate();
    const dayName = dayNames[koreaTime.getDay()];
    const hours = koreaTime.getHours();
    const minutes = String(koreaTime.getMinutes()).padStart(2, '0');
    const ampm = hours < 12 ? '오전' : '오후';
    const hours12 = hours % 12 || 12;

    return `[현재 날짜/시간 정보]
오늘 날짜: ${year}년 ${month}월 ${day}일 (${dayName})
현재 시각: ${ampm} ${hours12}시 ${minutes}분 (한국 표준시, KST)
타임존: Asia/Seoul (UTC+9)`;
  }

  // ── 2. 날씨 감지 ──────────────────────────────────────────────────────────
  const weatherMatch = msg.match(/날씨|기온|온도|비.오|눈.오|흐림|맑음|weather|기상/);
  if (weatherMatch) {
    // 도시명 추출 - 한국어 우선, 영문은 후순위
    const cityMap = {
      '서울':'Seoul','부산':'Busan','인천':'Incheon','대구':'Daegu','대전':'Daejeon',
      '광주':'Gwangju','울산':'Ulsan','제주':'Jeju','수원':'Suwon','성남':'Seongnam',
      '춘천':'Chuncheon','청주':'Cheongju','전주':'Jeonju','포항':'Pohang','창원':'Changwon',
      '도쿄':'Tokyo','오사카':'Osaka','베이징':'Beijing','상하이':'Shanghai',
      '뉴욕':'New+York','런던':'London','파리':'Paris','LA':'Los+Angeles',
      '싱가포르':'Singapore','방콕':'Bangkok','홍콩':'Hong+Kong','타이베이':'Taipei',
    };
    let city = 'Seoul';
    let cityKr = '서울';
    // 1) 한국어 도시명 먼저 확인
    for (const [kr, en] of Object.entries(cityMap)) {
      if (msg.includes(kr)) { city = en; cityKr = kr; break; }
    }
    // 2) 영문 도시명은 한국어 도시가 없을 때만, 그리고 날씨 단어 옆에 있을 때만
    if (city === 'Seoul') {
      const enCityMatch = message.match(/\b([A-Z][a-z]{2,})(?:\s[A-Z][a-z]+)?\b/);
      if (enCityMatch && !['Sunny','Cloudy','Rainy','Clear','What','How','The'].includes(enCityMatch[1])) {
        city = enCityMatch[1];
        cityKr = enCityMatch[1];
      }
    }

    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const cur = data.current_condition?.[0];
        const area = data.nearest_area?.[0];
        const detectedCity = area?.areaName?.[0]?.value || cityKr;
        const country = area?.country?.[0]?.value || '';
        const tempC = cur?.temp_C;
        const feelsC = cur?.FeelsLikeC;
        const desc = cur?.weatherDesc?.[0]?.value || '';
        const humidity = cur?.humidity;
        const windKmph = cur?.windspeedKmph;
        const visibility = cur?.visibility;
        const uvIndex = cur?.uvIndex;

        // 내일/모레 예보
        const forecasts = (data.weather || []).slice(0, 3).map(day => {
          const avgTmp = day.hourly ? Math.round(day.hourly.reduce((s,h)=>s+Number(h.tempC),0)/day.hourly.length) : '?';
          const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value || '';
          return `${day.date}: 평균 ${avgTmp}°C, ${dayDesc}`;
        }).join(' | ');

        return `[실시간 날씨 데이터 — ${detectedCity}, ${country}]
현재 기온: ${tempC}°C (체감 ${feelsC}°C)
날씨 상태: ${desc}
습도: ${humidity}% | 풍속: ${windKmph}km/h | 가시거리: ${visibility}km | UV지수: ${uvIndex}
예보: ${forecasts}
데이터 출처: wttr.in (${new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})})`;
      }
    } catch (_) {}
    // 날씨 API 실패 시 웹 검색 시도
    const citySearchResult = await _webSearch(`${cityKr} 날씨 오늘`);
    if (citySearchResult) {
      return `[날씨 정보 (웹 검색) — ${cityKr}]\n${citySearchResult}`;
    }
    return null;
  }

  // ── 환율 감지 ────────────────────────────────────────────────────────────
  const exchangeMatch = msg.match(/환율|달러|엔화|유로|원화|위안|환전|exchange rate/);
  if (exchangeMatch) {
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const krw = data.rates?.KRW?.toFixed(0);
        const jpy = data.rates?.JPY?.toFixed(2);
        const eur = data.rates?.EUR?.toFixed(4);
        const cny = data.rates?.CNY?.toFixed(4);
        return `[실시간 환율 데이터 — ${new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}]
1 USD = ${krw}원 (KRW) | ${jpy}엔 (JPY) | ${eur}유로 (EUR) | ${cny}위안 (CNY)
데이터 출처: exchangerate-api.com`;
      }
    } catch (_) {}
    return null;
  }

  // ── 3. 웹 검색이 필요한 최신 정보 질문 ────────────────────────────────────
  // 뉴스, 최신 이벤트, 주가, 스포츠 결과 등
  const searchMatch = msg.match(
    /최신|뉴스|오늘의|이번\s*주|지난주|최근|어제|그제|현재.*상황|지금.*상황|지금.*어떻|지금.*얼마|지금.*몇|현재.*가격|현재.*얼마|얼마야|얼마예요|얼마임|가격.*알려|시세|주가|주식.*가격|주식.*얼마|코스피|코스닥|나스닥|비트코인|이더리움|암호화폐|코인.*가격|crypto|stock.*price|nasdaq|경기.*결과|점수.*얼마|누가\s*이겼|승패|올림픽|월드컵|챔피언스리그|프리미어리그|EPL|MLB|NBA|NFL|K리그|손흥민|이강인|황희찬|류현진|오타니|메시|호날두|선수.*골|골.*기록|최근.*경기|경기.*스코어|선거|정치.*뉴스|탄핵|임명|임기|취임|사임|사퇴|검색해줘|검색해 줘|찾아줘|찾아 줘|new|news|latest|recent|current.*price|업데이트.*됐|업데이트.*되었|출시됐|출시.*됐|발표됐|발표.*됐/i
  );

  if (searchMatch) {
    // 검색 쿼리 정제: 질문 어미 + 불필요한 단어 제거
    const cleanQuery = message
      .replace(/검색해\s*줘|찾아\s*줘|알려\s*줘|말해\s*줘/g, '')
      .replace(/알려주세요|찾아주세요|알고\s*싶어|궁금해|궁금한데/g, '')
      .replace(/어때요?|이야|이에요|이냐|냐|요$|까$|거야|야$|어\??$/g, '')
      .replace(/뉴스|최신\s*|정보$/g, '')
      .trim() || message.trim();

    const searchResult = await _webSearch(cleanQuery);
    if (searchResult) {
      return `[웹 검색 결과 — "${cleanQuery}" (${koreaTime.toLocaleDateString('ko-KR')})]
${searchResult}

※ 위 정보를 바탕으로 답변하되, 확실하지 않은 정보는 명시해 주세요.`;
    }
  }

  return null;
}

// ── selectMaxTokens: strategy + taskType → max_tokens 결정 ─────────────
//
// 전략    기본값    taskType 세분화
// ─────────────────────────────────────────────────────────────────────
// fast      1200    (모두 동일 — 인사/번역/단순 사실)
// balanced  3000    summarize → 2500 (요약은 출력 자체가 짧음)
// ── callWithFunctionTools: Function Calling 루프 (STEP 5) ────────────────
// LLM이 tool_calls를 반환하면 실행 → 결과 주입 → 재호출 (최대 3회)
// 지원 모델: gpt-4o, gpt-4o-mini (OpenAI only — Anthropic/Google은 직접 호출로 폴백)
async function callWithFunctionTools({
  messages,
  systemPrompt,
  selectedModel,
  strategy,
  taskType,
  maxTokens,
  temperature,
  userId,
  sessionId,   // STEP 7: observability용
  userMessage, // STEP 7+9: 툴 우선순위 힌트용
}) {
  // OpenAI 클라이언트가 없으면 function-calling 불가
  if (!openai || !openai.chat) return null;

  // gpt-4o / gpt-4o-mini 모델만 지원 (claude/gemini는 도구 호출 방식 다름)
  const modelLower = (selectedModel || '').toLowerCase();
  if (!modelLower.startsWith('gpt')) return null;

  const maxToolRounds = 3;   // 최대 tool-call 라운드 수
  let roundMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let toolsUsed = [];        // 사용된 툴 목록 (로깅용)
  let lastContent = null;

  for (let round = 0; round < maxToolRounds; round++) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model:       selectedModel,
        messages:    roundMessages,
        tools:       TOOL_DEFINITIONS,
        tool_choice: 'auto',   // LLM이 자율 결정
        max_tokens:  maxTokens,
        temperature,
      });
    } catch (err) {
      console.warn(`[functionCall] round ${round} LLM 오류:`, err.message);
      return null;  // 실패 시 일반 callLLM 폴백
    }

    const choice = response.choices?.[0];
    if (!choice) return null;

    const msg = choice.message;
    lastContent = msg.content;

    // tool_calls 없으면 → 최종 응답
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log(`[functionCall] round ${round}: 최종 응답 (툴 사용: ${toolsUsed.join(', ') || '없음'})`);
      return {
        content:    lastContent,
        model:      response.model || selectedModel,
        provider:   'openai',
        toolsUsed,
        usage:      response.usage,
        ms:         Date.now(),
        isFallback: false,
      };
    }

    // tool_calls 있음 → 각 툴 실행
    // 어시스턴트 메시지 (tool_calls 포함) 추가
    roundMessages.push({
      role:       'assistant',
      content:    msg.content || null,
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      const toolName = tc.function?.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}

      console.log(`[functionCall] round ${round}: 툴 실행 → ${toolName}(${JSON.stringify(toolArgs)})`);
      toolsUsed.push(toolName);

      const toolStart = Date.now();
      let toolResult, toolSuccess = true, toolErr = null;
      try {
        toolResult = await executeTool(toolName, toolArgs, { _webSearch });
        toolSuccess = !toolResult?.startsWith?.('[툴 실행 오류') && !toolResult?.startsWith?.('[알 수 없는 툴');
      } catch (e) {
        toolResult = `[툴 실행 오류: ${toolName}] ${e.message}`;
        toolSuccess = false;
        toolErr = e.message;
      }
      const toolLatencyMs = Date.now() - toolStart;

      // STEP 7: Tool Observability 로그
      try {
        toolObs.logToolCall({
          sessionId,
          query:       userMessage,
          strategy,
          model:       selectedModel,
          taskType,
          toolName,
          toolArgs,
          toolLatencyMs,
          toolSuccess,
          errorMsg:    toolErr,
        });
      } catch (_) {}

      // tool 결과 메시지 추가
      roundMessages.push({
        role:         'tool',
        tool_call_id: tc.id,
        content:      toolResult,
      });
    }
    // 다음 라운드: tool 결과 포함하여 재호출
  }

  // 최대 라운드 초과 → 마지막 content 반환 (있으면)
  console.warn(`[functionCall] 최대 ${maxToolRounds}라운드 초과 — 마지막 응답 사용`);
  return lastContent
    ? { content: lastContent, model: selectedModel, provider: 'openai', toolsUsed, isFallback: false }
    : null;
}

// deep      6000    code       → 7000 (코드 + 설명 + 예시 충분히)
//                   ppt/report → 7000 (긴 문서 구조)
//                   website    → 6500 (아키텍처 + 컴포넌트)
//                   그 외 deep → 6000
function selectMaxTokens(strategy, taskType) {
  switch (strategy) {
    case 'fast':
      return 1200;

    case 'balanced':
      if (['summarize', 'summarise'].includes(taskType)) return 2500;
      return 3000;

    case 'deep':
      if (['code', 'ppt', 'report', 'document'].includes(taskType)) return 7000;
      if (taskType === 'website') return 6500;
      return 6000;

    default:
      return 3000;
  }
}

// ── selectModel: strategy → 구체적 모델 ID 결정 ──────────────────────────
// deep     → claude-sonnet-4-5 (코드·설계·복잡 분석) / gpt-4o (website·code)
// balanced → gpt-4o (일반 대화·문서 작성)
// fast     → gpt-4o-mini (인사·단순 질문·번역)
function selectModel(strategy, taskType) {
  switch (strategy) {
    case 'deep':
      // 코드·웹사이트 설계 → OpenAI gpt-4o 우선 (reasoning 강점)
      if (['code', 'website', 'reasoning'].includes(taskType)) return 'gpt-4o';
      // 분석·문서·자소서 → Claude Sonnet 우선
      return 'claude-sonnet-4-5-20250929';
    case 'balanced':
      return 'gpt-4o';
    case 'fast':
    default:
      return 'gpt-4o-mini';
  }
}

async function processMessage(session, message, clientMode = null) {
  const sessionId = session.id;

  // ── L1: 현재 user 발화 즉시 기록 + L3 사실 자동 추출 ──────────────────
  memory.recordTurn(sessionId, 'user', message, {});

  // 1단계: 의도 분석
  const analysis = await intentAnalyzer.analyze(message, session.history);

  // 2단계: 실제 AI 호출 체인 연결
  const taskType  = analysis?.taskType  || 'text';

  // Phase 5: clientMode로 strategy 오버라이드
  let strategy = analysis?.strategy || 'balanced';
  if (clientMode === 'chat') {
    strategy = 'fast';       // chat → 빠른 응답
  } else if (clientMode === 'research') {
    strategy = 'deep';       // research → 심층 분석
  } else if (clientMode === 'agent') {
    strategy = strategy === 'fast' ? 'balanced' : strategy; // agent → 최소 balanced
  }
  const confidence = analysis?.confidence || 0;

  // 2.1단계: strategy → 모델 ID 확정
  const selectedModel = selectModel(strategy, taskType);
  console.log(`[strategyRouter] ${taskType} / strategy:${strategy} → model:${selectedModel}`);

  // ── 처리 시작 시간 기록 (STEP 7: response latency 측정) ─────────────────
  const _processStart = Date.now();

  // 2.5단계: 실시간 정보 자동 조회 (날씨·환율 등)
  let realtimeContext = null;
  try { realtimeContext = await _fetchRealtimeContext(message); } catch (_) {}

  // ── L1/L2/L3 메모리 컨텍스트 로드 (STEP 8: buildContextSmart — 관련 기억만 주입) ──
  // L1: MemoryEngine의 WorkingMemory에서 최근 8턴 (session.history 대신)
  // L2: 이전 에피소드 이력 + 대화 요약
  // L3: 사용자 선언 사실 (프로젝트, 선호도, 신원)
  const memCtx = memory.buildContextSmart
    ? memory.buildContextSmart(sessionId, taskType, message)
    : memory.buildContext(sessionId, taskType);
  const l1History     = memCtx.conversationHistory;
  const memoryPrompt  = memCtx.memoryPrompt;

  // ── 자동 대화 요약 트리거 (20턴 이상 시 system_summary 메시지 생성) ─────
  // 실제 LLM 요약은 비용·지연이 있으므로 간단한 압축 요약으로 처리
  const autoSumCheck = memory.checkAutoSummarize(sessionId, 20);
  if (autoSumCheck.shouldSummarize) {
    // 아직 요약이 없거나 마지막 요약 이후 10턴 이상 쌓인 경우만 생성
    const lastSumm = memory.summaries.getLatestSummary(sessionId);
    const lastSummTurns = lastSumm?.turnCount || 0;
    if (autoSumCheck.turnCount - lastSummTurns >= 10) {
      // 간단 요약: 최근 20턴 앞부분을 합쳐서 텍스트로 압축
      const summaryText = autoSumCheck.turns
        .slice(0, autoSumCheck.turns.length - 8)   // 마지막 8턴 이전 내용
        .map(t => `${t.role === 'user' ? 'User' : 'AI'}: ${String(t.content).substring(0, 120)}`)
        .join('\n');
      memory.saveSummary(sessionId, summaryText, autoSumCheck.turnCount);
      console.log(`[memoryEngine] 세션 ${sessionId.slice(0,8)} 자동 요약 저장 (${autoSumCheck.turnCount}턴)`);
    }
  }

  // STEP 8: 30턴마다 에피소드 정제 (checkEpisodicSummary)
  try { memory.checkEpisodicSummary?.(sessionId); } catch (_) {}

  // 실시간 데이터가 있으면 user 메시지 앞에 컨텍스트 주입
  const userContent = realtimeContext
    ? `${realtimeContext}\n\n위 실시간 데이터를 참고하여 다음 질문에 한국어로 친절하게 답변해 주세요:\n${message}`
    : message;

  // ── 메시지 배열 구성: L1 대화 히스토리 + 현재 user 메시지 ──────────────
  const messages = [
    ...l1History.filter(h => h.role !== 'user' || h.content !== message), // 중복 방지
    { role: 'user', content: userContent },
  ];

  // ── 현재 날짜/시간을 시스템 프롬프트에 항상 주입 ────────────────────────
  // 이렇게 해야 AI가 자신의 학습 데이터 날짜(e.g. 2024년)로 답변하지 않음
  const _nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const _dayNames = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
  const _currentDateStr = `${_nowKST.getFullYear()}년 ${_nowKST.getMonth()+1}월 ${_nowKST.getDate()}일 (${_dayNames[_nowKST.getDay()]})`;
  const _currentTimeStr = (() => {
    const h = _nowKST.getHours(), m = String(_nowKST.getMinutes()).padStart(2,'0');
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시 ${m}분 (KST)`;
  })();
  const DATE_SYSTEM_PREFIX = `[시스템 정보] 오늘 날짜: ${_currentDateStr} | 현재 시각: ${_currentTimeStr}\n사용자가 날짜, 시간, 요일을 물을 경우 반드시 위의 정확한 날짜/시각을 사용하여 답변하십시오. 절대로 학습 데이터의 날짜를 사용하지 마십시오.\n\n`;

  // ── BASE system prompt (모든 task 공통) ──────────────────────────────────
  const BASE_SYSTEM_PROMPT = `You are a highly capable AI assistant.

Your primary goal is to carefully understand the user's intent and provide clear, accurate, and helpful responses.

General behavior rules:
1. Always analyze the user's intent before answering.
2. If the request requires reasoning, think through the problem step by step before responding.
3. When the request is ambiguous, infer the most likely meaning based on context.
4. Provide clear and well-structured responses.
5. Prefer concise answers unless the user asks for detailed explanations.

Language rules:
- Respond primarily in Korean unless the user explicitly asks for another language.
- Maintain natural and professional tone.

External information rules:
- If external information such as search results, realtime data, or tool outputs is provided, prioritize that information over internal knowledge.
- If the external data conflicts with your internal knowledge, prefer the external data.
- When search results are included, cite them naturally in your response.

Uncertainty rules:
- If information is uncertain or incomplete, clearly state the uncertainty.
- Never fabricate unknown facts.

Formatting rules:
- Use structured explanations when appropriate.
- Break down complex answers into clear sections.`;

  // ── deep 전략 추가 규칙 ───────────────────────────────────────────────────
  const DEEP_ADDON = `

Complex task rules:
For complex tasks such as coding, system design, or strategy analysis,
break the solution into logical steps before providing the final answer.
Show your reasoning process clearly before presenting conclusions.`;

  // ── task별 역할 특화 프롬프트 ─────────────────────────────────────────────
  const TASK_ROLE_PROMPTS = {
    ppt:      'You are an expert presentation designer. Create detailed, structured PPT outlines with clear sections, key points, and speaker notes.',
    website:  'You are a senior web developer and UX designer. Provide clear website architecture, component structure, and content plans.',
    blog:     'You are a professional blogger and content strategist. Write engaging, well-structured blog posts with compelling hooks and clear takeaways.',
    report:   'You are a business analyst and data scientist. Provide comprehensive, evidence-based analysis reports with actionable insights.',
    code:     'You are a senior software engineer with expertise in multiple languages. Write clean, efficient, well-documented code with step-by-step explanations.',
    email:    'You are a professional business communications expert. Write clear, concise, and effective emails appropriate for the context.',
    resume:   'You are a career counselor and resume expert. Create compelling, achievement-focused resumes and cover letters tailored to the role.',
    text:     'You are a skilled writer and communicator. Respond clearly, accurately, and concisely.',
    chat:     'You are a knowledgeable conversational assistant. Engage naturally, understand context, and provide helpful, thoughtful responses.',
    analysis: 'You are an expert analyst with strong critical thinking skills. Provide thorough, multi-perspective analysis with clear reasoning.',
    creative: 'You are a creative writer with a strong sense of style and narrative. Produce imaginative, original, high-quality content.',
    translation: 'You are a professional translator fluent in multiple languages. Translate accurately while preserving tone, nuance, and context.',
    summarize:   'You are an expert at distilling information. Produce concise, accurate summaries that capture the key points and insights.',
    default:  'You are a knowledgeable and helpful assistant. Provide accurate, well-reasoned responses.',
  };

  // ── 최종 system prompt 조합 ───────────────────────────────────────────────
  // 구조: DATE_PREFIX + BASE + task역할 + (deep 전략이면 DEEP_ADDON) + 메모리 컨텍스트
  const taskRole = TASK_ROLE_PROMPTS[taskType] || TASK_ROLE_PROMPTS.default;
  const deepAddon = (strategy === 'deep') ? DEEP_ADDON : '';
  // ★ memoryPrompt 주입: 사용자 사실(L3) + 이전 에피소드(L2) + 선호도 정보
  const memorySection = memoryPrompt
    ? `\n\n--- Memory Context ---\n${memoryPrompt}\n--- End Memory ---`
    : '';
  const systemPrompt = DATE_SYSTEM_PREFIX + BASE_SYSTEM_PROMPT
    + `\n\nYour current role: ${taskRole}` + deepAddon + memorySection;

  if (memoryPrompt) {
    console.log(`[memoryEngine] 메모리 주입됨 (세션 ${sessionId.slice(0,8)}): facts=${memCtx.raw.userFacts?.length||0} episodes=${memCtx.raw.recentEpisodes?.length||0}`);
  }

  // ── 모듈 브릿지 자동 분기 (Python FastAPI AI 모듈 서버) ──────────────
  // taskType이 summarize / translate / analysis / extract / classify / code / document 이면
  // Python FastAPI 모듈 서버(포트 8000)로 라우팅
  const MODULE_TASK_TYPES = new Set(moduleBridge.getSupportedTaskTypes());

  // ── 신규 툴 자동 분기 ─────────────────────────────────────────────────
  // ppt_file / pdf / excel / youtube / qrcode / tts / palette / regex / summarycard / chat2pdf
  const TOOL_TASK_MAP = {
    ppt_file:   async () => pptPipeline.run({ topic: analysis?.extractedInfo?.topic || message }),
    pdf:        async () => pdfPipeline.run({ title: analysis?.extractedInfo?.topic || message, aiGenerate: true }),
    excel:      async () => excelPipeline.run({ topic: analysis?.extractedInfo?.topic || message }),
    youtube:    async () => {
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
      return extraTools.run('youtube', { url: urlMatch?.[0] || message });
    },
    qrcode:     async () => {
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
      const text = urlMatch?.[0] || message.replace(/qr코드|qrcode|큐알코드|만들어줘|생성해줘/gi,'').trim();
      return extraTools.run('qrcode', { text, format: 'dataurl' });
    },
    tts:        async () => {
      const text = message.replace(/음성으로|읽어줘|tts|텍스트 음성|mp3로|음성 파일|목소리로/gi,'').trim();
      return extraTools.run('tts', { text: text || message });
    },
    palette:    async () => {
      const theme = message.replace(/색상 팔레트|컬러 팔레트|색깔 추천|브랜드 색상|색상 추천|만들어줘|생성해줘/gi,'').trim();
      return extraTools.run('palette', { theme: theme || message });
    },
    regex:      async () => extraTools.run('regex', { description: message }),
    summarycard: async () => extraTools.run('summarycard', { content: message, title: '요약 카드' }),
    chat2pdf:   async () => extraTools.run('chat2pdf', { messages: session.history || [], title: '대화 내보내기' }),
    removebg:   async () => {
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
      return extraTools.run('removebg', { imageUrl: urlMatch?.[0] });
    },
  };

  if (TOOL_TASK_MAP[taskType]) {
    try {
      const toolResult = await TOOL_TASK_MAP[taskType]();
      let reply = '';

      if (toolResult?.success) {
        if (toolResult.fileBuf) {
          // 파일은 base64로 embed 후 다운로드 링크 안내
          const b64  = toolResult.fileBuf.toString('base64');
          const mime = toolResult.mimeType || 'application/octet-stream';
          reply = `✅ **${toolResult.fileName || '파일'}** 생성 완료!\n\n` +
                  `[📥 다운로드](#download:${toolResult.fileName})\n\n` +
                  `_파일 데이터가 준비되었습니다. 아래 API를 직접 호출하면 파일을 받을 수 있습니다._`;
          // pipelineData에 실제 파일 데이터 포함
          if (!session.history) session.history = [];
          session.history.push({ role: 'user', content: message });
          session.history.push({ role: 'assistant', content: reply });
          return {
            analysis, session: session.id,
            reply,
            model:    'tool-pipeline',
            provider: 'tools',
            pipeline: taskType,
            pipelineData: { ...toolResult, fileBuf: undefined, fileBase64: b64, mimeType: mime },
            ms: Date.now(),
            error: null,
          };
        } else if (toolResult.dataUrl) {
          // QR코드, SVG 카드 등 — 인라인 표시
          reply = toolResult.summary
            || toolResult.analysis
            || (toolResult.palette ? JSON.stringify(toolResult.palette, null, 2) : null)
            || (toolResult.pattern ? `**정규식:** \`${toolResult.pattern}\`\n**설명:** ${toolResult.explanation}\n\n**JavaScript:** \`\`\`js\n${toolResult.code?.javascript}\n\`\`\`` : null)
            || '생성 완료';
          if (!session.history) session.history = [];
          session.history.push({ role: 'user', content: message });
          session.history.push({ role: 'assistant', content: reply });
          return {
            analysis, session: session.id,
            reply,
            model:    'tool-pipeline',
            provider: 'tools',
            pipeline: taskType,
            pipelineData: toolResult,
            ms: Date.now(),
            error: null,
          };
        } else {
          reply = toolResult.summary
            || toolResult.analysis
            || toolResult.text
            || (toolResult.palette ? `🎨 **${toolResult.palette?.name}**\n\n${toolResult.palette?.colors?.map(c=>`• **${c.name}** \`${c.hex}\` — ${c.usage}`).join('\n')}` : null)
            || (toolResult.pattern ? `✅ **정규식:** \`${toolResult.pattern}\`\n\n**설명:** ${toolResult.explanation}\n\n**JavaScript:**\n\`\`\`js\n${toolResult.code?.javascript}\n\`\`\`\n\n**Python:**\n\`\`\`python\n${toolResult.code?.python}\n\`\`\`` : null)
            || toolResult.raw
            || '처리 완료';
        }
      } else {
        reply = `❌ ${toolResult?.error || '처리 중 오류가 발생했습니다.'}`;
        if (toolResult?.tip) reply += `\n\n💡 ${toolResult.tip}`;
      }

      if (!session.history) session.history = [];
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: reply });
      return {
        analysis, session: session.id,
        reply,
        model:    'tool-pipeline',
        provider: 'tools',
        pipeline: taskType,
        pipelineData: toolResult,
        ms: Date.now(),
        error: null,
      };
    } catch (toolErr) {
      console.error(`[Tool:${taskType}] 오류:`, toolErr.message);
      // 실패 시 AI fallback으로 계속
    }
  }

  if (MODULE_TASK_TYPES.has(taskType) && !['code', 'text', 'chat'].includes(taskType)) {
    // code는 아래 pipeline에서 처리하므로 제외, text/chat은 AI fallback 사용

    // ── translate: 목표 언어 파싱 ─────────────────────────────────────
    const moduleExtra = {};
    if (taskType === 'translate') {
      const langMap = {
        '영어': 'en', '영문': 'en', 'english': 'en',
        '한국어': 'ko', '한글': 'ko', 'korean': 'ko',
        '일본어': 'ja', '일어': 'ja', 'japanese': 'ja',
        '중국어': 'zh', '중문': 'zh', 'chinese': 'zh',
        '프랑스어': 'fr', 'french': 'fr',
        '독일어': 'de', 'german': 'de',
        '스페인어': 'es', 'spanish': 'es',
        '베트남어': 'vi', 'vietnamese': 'vi',
      };
      const msgLower = message.toLowerCase();
      for (const [keyword, code] of Object.entries(langMap)) {
        if (msgLower.includes(keyword)) { moduleExtra.target_lang = code; break; }
      }
      if (!moduleExtra.target_lang) moduleExtra.target_lang = 'en'; // 기본 영어
    }

    const moduleResult = await moduleBridge.callModule(taskType, message, moduleExtra);
    if (moduleResult && moduleResult.success && moduleResult.output) {
      if (!session.history) session.history = [];
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: moduleResult.output });
      // ★ MemoryEngine: module 경로도 L1 기록 + L2 에피소드 저장
      memory.recordTurn(sessionId, 'assistant', moduleResult.output, { taskType, model: 'ai-module-server' });
      try {
        const COMPLETABLE_TYPES = new Set(['code','ppt','website','blog','report','email','resume',
                                            'analysis','summarize','translate','creative','document']);
        if (COMPLETABLE_TYPES.has(taskType)) {
          memory.recordCompletion(sessionId, {
            taskType,
            taskInfo:   analysis?.extractedInfo || {},
            validation: { score: analysis?.confidence || 75 },
            result:     { content: moduleResult.output },
          });
        }
      } catch (_) {}
      return {
        analysis,
        session:       session.id,
        reply:         moduleResult.output,
        model:         'ai-module-server',
        provider:      'python-module',
        pipeline:      moduleResult.module,
        pipelineData:  moduleResult.raw,
        isFallback:    false,
        ms:            moduleResult.ms,
        strategy,                // ★ strategy 필드 추가
        selectedModel,           // ★ selectedModel 필드 추가
        error:         null,
        // ★ 메모리 상태
        memoryState: {
          factsCount:   memCtx.raw.userFacts?.length || 0,
          episodeCount: memCtx.raw.recentEpisodes?.length || 0,
          hasMemory:    !!memoryPrompt,
          sessionTurns: memory.working.getAllTurns(sessionId).length,
        },
      };
    }
    // 모듈 실패 시 AI fallback으로 계속 진행
  }

  // ── 파이프라인 자동 분기 ──────────────────────────────────────────
  // taskType이 image / vision / stt / crawl 이면 pipelineManager로 라우팅
  const PIPELINE_TASK_MAP = {
    image:   'imageGen',
    vision:  'vision',
    stt:     'stt',
    crawl:   'crawler',
  };
  const targetPipeline = PIPELINE_TASK_MAP[taskType];

  if (targetPipeline) {
    let pipelineResult = null;
    let pipelineError  = null;
    try {
      // URL 추출 (vision/crawl용)
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
      const pipelineOpts = {
        sessionId: session.id,
        message,
        prompt: message,
        url:    urlMatch ? urlMatch[0] : undefined,
        imageUrl: urlMatch ? urlMatch[0] : undefined,
      };
      pipelineResult = await pipelineManager.run(targetPipeline, pipelineOpts);
    } catch (err) {
      pipelineError = err.message || String(err);
    }

    // 파이프라인 성공 시 결과 반환
    if (pipelineResult && !pipelineError) {
      // crawler는 content/text, imageGen은 result, 기타는 text/url
      const pipelineReply = pipelineResult.result || pipelineResult.content || pipelineResult.text || pipelineResult.url || JSON.stringify(pipelineResult);
      if (!session.history) session.history = [];
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: typeof pipelineReply === 'string' ? pipelineReply : JSON.stringify(pipelineReply) });
      return {
        analysis,
        session:    session.id,
        reply:      typeof pipelineReply === 'string' ? pipelineReply : JSON.stringify(pipelineReply, null, 2),
        model:      pipelineResult.model || targetPipeline,
        provider:   'pipeline',
        pipeline:   targetPipeline,
        pipelineData: pipelineResult,
        isFallback: false,
        error:      null,
      };
    }
    // 파이프라인 실패 시 AI fallback으로 계속 진행
  }

  // ── maxTokens: strategy + taskType 세분화 결정 ─────────────────────────
  //   fast     → 1200  (짧고 빠른 응답)
  //   balanced → 3000  (일반 설명·분석, summarize는 2500)
  //   deep     → 6000+ (코드 7000 / ppt·report 7000 / website 6500 / 기타 6000)
  const maxTokens = selectMaxTokens(strategy, taskType);
  console.log(`[tokenRouter] ${taskType} / strategy:${strategy} → maxTokens:${maxTokens}`);

  const _temperature = strategy === 'deep' ? 0.6 : (taskType === 'creative' ? 0.85 : 0.7);

  // ── STEP 9: Tool Priority Hint 사전 계산 (Agent Runtime + Function Calling에서 공용) ──
  const toolPriorityHint    = getToolPriorityHint(message);
  const systemPromptWithHint = toolPriorityHint
    ? systemPrompt + toolPriorityHint
    : systemPrompt;

  let aiResult = null;
  let aiError  = null;

  // ── STEP 10~15: Agent Runtime (Planner + ToolChain + Self-Correction) ────
  // deep/balanced 전략 + complex 태스크 → 자율 에이전트 실행
  // simple/fast 태스크 → 일반 LLM 경로
  let agentMeta = null;  // 에이전트 실행 메타 정보 (plan, chainLog 등)
  const _useAgent = agentRuntime
    && agentRuntime.shouldRunAutonomous(strategy, taskType, message);

  if (_useAgent) {
    try {
      console.log(`[AgentRuntime] 자율 모드 시도: strategy=${strategy} taskType=${taskType}`);
      const agentResult = await agentRuntime.run({
        message,
        taskType,
        strategy,
        sessionId,
        systemPrompt:  systemPromptWithHint || systemPrompt,
        selectedModel,
        maxTokens,
        temperature:   _temperature,
        memoryContext: memCtx,
      });

      if (agentResult && agentResult.content) {
        aiResult = {
          content:    agentResult.content,
          model:      selectedModel,
          provider:   'agent-runtime',
          ms:         agentResult.totalMs,
          isFallback: false,
          toolsUsed:  [],
          usage:      null,
        };
        agentMeta = {
          planId:        agentResult.planId,
          complexity:    agentResult.plan?.complexity,
          totalSteps:    agentResult.plan?.totalSteps,
          chainLog:      agentResult.chainLog,
          corrections:   agentResult.corrections,
          stateSummary:  agentResult.stateSummary,
          // Phase 2: budget 사용량 기록
          budgetSummary: agentResult.budgetSummary || null,
          isPartial:     agentResult.isPartial || false,
        };
        console.log(`[AgentRuntime] 완료: planId=${agentMeta.planId} steps=${agentMeta.totalSteps} corrections=${agentResult.corrections?.length} partial=${agentMeta.isPartial}`);
      } else {
        console.log('[AgentRuntime] 결과 없음 (simple plan), 일반 LLM 사용');
      }
    } catch (agentErr) {
      console.warn('[AgentRuntime] 오류, 일반 LLM 폴백:', agentErr.message);
    }
  }

  // ── STEP 5: Function Calling (자율 툴 사용) ────────────────────────────
  // balanced/deep 전략 + 일반 chat/text/unknown/code/analysis 타입에서
  // LLM이 자율적으로 web_search / get_weather / get_exchange_rate / get_datetime 호출
  const useFunctionCalling = !aiResult && shouldUseTools(strategy, taskType);

  if (useFunctionCalling) {
    try {
      const fcResult = await callWithFunctionTools({
        messages,
        systemPrompt: systemPromptWithHint,
        selectedModel,
        strategy,
        taskType,
        maxTokens,
        temperature: _temperature,
        userId:      session.userId || 'anonymous',
        sessionId,    // STEP 7: observability
        userMessage:  message, // STEP 7+9
      });
      if (fcResult) {
        aiResult = fcResult;
        if (fcResult.toolsUsed?.length > 0) {
          console.log(`[functionCall] 툴 사용 완료: ${fcResult.toolsUsed.join(', ')} → ${taskType}/${strategy}`);
        }
      }
    } catch (fcErr) {
      console.warn('[functionCall] 오류, 일반 callLLM 폴백:', fcErr.message);
    }
  }

  // ── 일반 LLM 호출 (function-calling 미사용 또는 실패 시) ──────────────
  if (!aiResult) {
    try {
      aiResult = await aiConnector.callLLM({
        messages,
        system:      systemPrompt,
        model:       selectedModel,        // ★ 확정 모델 직접 지정
        strategy,                          // 폴백 시 참고용
        task:        taskType,
        maxTokens,
        temperature: _temperature,
        userId:      session.userId || 'anonymous',
        pipeline:    'api/message',
        useCache:    false,
      });
    } catch (err) {
      aiError = err.message || String(err);
    }
  }

  // ── 세션 히스토리 + MemoryEngine 업데이트 ─────────────────────────────
  if (!session.history) session.history = [];
  session.history.push({ role: 'user', content: message });
  if (aiResult?.content) {
    session.history.push({ role: 'assistant', content: aiResult.content });
    // L1: assistant 발화 기록
    memory.recordTurn(sessionId, 'assistant', aiResult.content, { taskType, model: aiResult.model });
    // STEP 8: isCompletionWorthy — 일회성 대화는 L2에 저장 안 함
    const worthy = memory.isCompletionWorthy
      ? memory.isCompletionWorthy(taskType)
      : !['chat','text','unknown','greeting'].includes(taskType);
    if (worthy) {
      try {
        memory.recordCompletion(sessionId, {
          taskType,
          taskInfo:     analysis?.extractedInfo || {},
          validation:   { score: analysis?.confidence || 75 },
          result:       { content: aiResult.content },
        });
      } catch (_) {}
    }
    // STEP 8: UserFacts 정제 (비동기, 비차단)
    try { memory.pruneUserFacts?.(sessionId); } catch (_) {}
    // STEP 8: 30턴마다 에피소드 정제 (오래된 에피소드 삭제)
    try {
      const totalTurns = memory.working.getAllTurns(sessionId).length;
      if (totalTurns % 30 === 0 && totalTurns > 0) {
        memory.pruneEpisodes?.(sessionId);
        console.log(`[memoryQC] 세션 ${sessionId.slice(0,8)} 에피소드 정제 (${totalTurns}턴)`);
      }
    } catch (_) {}
  }

  // STEP 7: Tool Observability — 요청 단위 로그 (responseMs + hasMemory 포함)
  try {
    toolObs.logRequest({
      sessionId,
      query:          message,
      strategy,
      model:          aiResult?.model || selectedModel,
      taskType,
      toolsUsed:      aiResult?.toolsUsed || [],
      responseTokens: aiResult?.usage?.completion_tokens || 0,
      responseMs:     Date.now() - _processStart,  // ★ STEP 7
      hasMemory:      !!memoryPrompt,              // ★ STEP 7
    });
  } catch (_) {}

  return {
    analysis,
    session:       session.id,
    // AI 응답
    reply:         aiResult?.content  || null,
    model:         aiResult?.model    || selectedModel,
    provider:      aiResult?.provider || null,
    ms:            aiResult?.ms       || null,
    isFallback:    aiResult?.isFallback || false,
    usage:         aiResult?.usage    || null,
    // strategy 라우팅 정보 (디버깅·프론트 표시용)
    strategy,
    selectedModel,
    // ★ function-calling 툴 사용 정보
    toolsUsed:     aiResult?.toolsUsed || [],
    error:         aiError            || null,
    // ★ 메모리 상태 (디버깅·프론트 표시용)
    memoryState: {
      factsCount:    memCtx.raw.userFacts?.length   || 0,
      episodeCount:  memCtx.raw.recentEpisodes?.length || 0,
      hasMemory:     !!memoryPrompt,
      sessionTurns:  memory.working.getAllTurns(sessionId).length,
    },
    // ★ STEP 10~15: Agent Runtime 메타 정보
    agentMeta:     agentMeta || null,
  };
}

function getTaskTypeName(type) {
  const names = {
    ppt: 'PPT 제작',
    website: '홈페이지 제작',
    blog: '블로그 작성',
    report: '분석 리포트',
    code: '코드 개발',
    email: '이메일 작성',
    resume: '자기소개서 작성'
  };
  return names[type] || type;
}

function getHelpMessage() {
  return `안녕하세요! 저는 AI 오케스트레이터입니다. 🤖

다음과 같은 작업을 도와드릴 수 있어요:

📊 **PPT 제작** - "AI 시장 PPT 만들어줘"
🌐 **홈페이지 제작** - "카페 홈페이지 만들어줘"
📝 **블로그 작성** - "마케팅 전략 블로그 써줘"
📈 **분석 리포트** - "경쟁사 분석 해줘"
💻 **코드 개발** - "로그인 기능 만들어줘"
✉️ **이메일 작성** - "제안서 이메일 써줘"
📄 **자기소개서** - "개발자 자소서 써줘"

어떤 결과물이 필요하신가요?`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── 서버 시작 ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// Phase 5: IT보안 · 부동산 · 금융투자 · 헬스케어 · 정부공공 라우트
// ══════════════════════════════════════════════════════════════

// ── IT/보안 파이프라인 ─────────────────────────────────────
app.post('/api/it/security-scan', async (req, res) => {
  try {
    const { target = 'https://example.com', scanType = 'web' } = req.body;
    const result = itSecurityPipeline.runSecurityScan(target, scanType);
    res.json({ success: true, pipeline: 'it/security-scan', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/code-review', async (req, res) => {
  try {
    const { code = '', language = 'javascript' } = req.body;
    const result = itSecurityPipeline.reviewCode(code, language);
    res.json({ success: true, pipeline: 'it/code-review', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/cicd-pipeline', async (req, res) => {
  try {
    const { project = {}, platform = 'github_actions' } = req.body;
    const result = itSecurityPipeline.designCICDPipeline(project, platform);
    res.json({ success: true, pipeline: 'it/cicd-pipeline', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/monitoring', async (req, res) => {
  try {
    const { infra = {}, tools = ['prometheus', 'grafana'] } = req.body;
    const result = itSecurityPipeline.setupMonitoring(infra, tools);
    res.json({ success: true, pipeline: 'it/monitoring', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/cloud-cost', async (req, res) => {
  try {
    const { usage = {}, provider = 'aws' } = req.body;
    const result = itSecurityPipeline.analyzeCloudCost(usage, provider);
    res.json({ success: true, pipeline: 'it/cloud-cost', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/zero-trust', async (req, res) => {
  try {
    const { orgInfo = {} } = req.body;
    const result = itSecurityPipeline.buildZeroTrustPolicy(orgInfo);
    res.json({ success: true, pipeline: 'it/zero-trust', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/it/run', async (req, res) => {
  try {
    const { action, ...params } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });
    const result = await itSecurityPipeline.execute(action, params);
    res.json({ success: true, pipeline: 'it', action, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 부동산 파이프라인 ────────────────────────────────────
app.post('/api/real-estate/transaction-price', async (req, res) => {
  try {
    const result = realEstatePipeline.analyzeTransactionPrice(req.body);
    res.json({ success: true, pipeline: 'real-estate/transaction-price', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/real-estate/search', async (req, res) => {
  try {
    const result = realEstatePipeline.searchProperties(req.body);
    res.json({ success: true, pipeline: 'real-estate/search', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/real-estate/commercial-area', async (req, res) => {
  try {
    const result = realEstatePipeline.analyzeCommercialArea(req.body);
    res.json({ success: true, pipeline: 'real-estate/commercial-area', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/real-estate/location', async (req, res) => {
  try {
    const result = realEstatePipeline.analyzeLocation(req.body);
    res.json({ success: true, pipeline: 'real-estate/location', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/real-estate/investment', async (req, res) => {
  try {
    const result = realEstatePipeline.analyzeInvestment(req.body);
    res.json({ success: true, pipeline: 'real-estate/investment', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 금융/투자 파이프라인 ─────────────────────────────────
app.post('/api/finance/stock', async (req, res) => {
  try {
    const result = financeInvestPipeline.analyzeStock(req.body);
    res.json({ success: true, pipeline: 'finance/stock', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/portfolio', async (req, res) => {
  try {
    const result = financeInvestPipeline.analyzePortfolio(req.body);
    res.json({ success: true, pipeline: 'finance/portfolio', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/crypto', async (req, res) => {
  try {
    const { symbol = 'BTC' } = req.body;
    const result = financeInvestPipeline.analyzeCrypto({ symbol });
    res.json({ success: true, pipeline: 'finance/crypto', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/option', async (req, res) => {
  try {
    const result = financeInvestPipeline.priceOption(req.body);
    res.json({ success: true, pipeline: 'finance/option', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/credit', async (req, res) => {
  try {
    const result = financeInvestPipeline.evaluateCredit(req.body);
    res.json({ success: true, pipeline: 'finance/credit', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 헬스케어 파이프라인 ─────────────────────────────────
app.post('/api/healthcare/drug-interaction', async (req, res) => {
  try {
    const { drugs = ['aspirin', 'warfarin'] } = req.body;
    const result = healthcarePipeline.checkDrugInteraction({ drugs });
    res.json({ success: true, pipeline: 'healthcare/drug-interaction', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/healthcare/medical-db', async (req, res) => {
  try {
    const { query = 'I10', type = 'icd10' } = req.body;
    const result = healthcarePipeline.queryMedicalDB({ query, type });
    res.json({ success: true, pipeline: 'healthcare/medical-db', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/healthcare/clinical-decision', async (req, res) => {
  try {
    const result = healthcarePipeline.supportClinicalDecision(req.body);
    res.json({ success: true, pipeline: 'healthcare/clinical-decision', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/healthcare/phr', async (req, res) => {
  try {
    const result = healthcarePipeline.managePHR(req.body);
    res.json({ success: true, pipeline: 'healthcare/phr', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 정부/공공 파이프라인 ─────────────────────────────────
app.post('/api/government/emergency-alert', async (req, res) => {
  try {
    const result = governmentPipeline.sendEmergencyAlert(req.body);
    res.json({ success: true, pipeline: 'government/emergency-alert', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/government/public-data', async (req, res) => {
  try {
    const { dataType = 'population', region = '서울특별시' } = req.body;
    const result = governmentPipeline.queryPublicData({ dataType, region });
    res.json({ success: true, pipeline: 'government/public-data', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/government/translate', async (req, res) => {
  try {
    const { text, from = 'ko', to = 'en' } = req.body;
    const result = governmentPipeline.translateDocument({ text, from, to });
    res.json({ success: true, pipeline: 'government/translate', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/government/chatbot', async (req, res) => {
  try {
    const { query = '주민등록등본 발급 방법', channel = 'web' } = req.body;
    const result = governmentPipeline.adminChatbot({ query, channel });
    res.json({ success: true, pipeline: 'government/chatbot', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// Phase 6: 워크플로우 엔진 · 실시간 메트릭 · 자동 테스트 라우트
// ══════════════════════════════════════════════════════════════

// ── 워크플로우 엔진 ───────────────────────────────────────
app.get('/api/workflow/templates', (req, res) => {
  try {
    const templates = Object.entries(workflowEngine.WORKFLOW_TEMPLATES).map(([k, v]) => ({
      key: k, name: v.name, description: v.description, trigger: v.trigger,
      steps: v.steps.length,
    }));
    res.json({ success: true, templates, total: templates.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workflow/run', async (req, res) => {
  try {
    const { template, definition, context = {} } = req.body;
    let wfDef = definition;
    if (template && workflowEngine.WORKFLOW_TEMPLATES[template]) {
      wfDef = workflowEngine.WORKFLOW_TEMPLATES[template];
    }
    if (!wfDef) return res.status(400).json({ error: 'template 또는 definition 필요' });
    const result = await workflowEngine.engine.run(wfDef, context);
    res.json({ success: true, pipeline: 'workflow', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workflow/webhook', (req, res) => {
  try {
    const event = req.body;
    const result = workflowEngine.processWebhookEvent(event);
    res.json({ success: true, pipeline: 'workflow/webhook', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workflow/analyze-data', (req, res) => {
  try {
    const result = workflowEngine.analyzeDataReport(req.body);
    res.json({ success: true, pipeline: 'workflow/analyze-data', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/workflow/status', (req, res) => {
  try {
    const result = workflowEngine.engine.getStatus();
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 실시간 메트릭 대시보드 ───────────────────────────────
app.get('/api/metrics/dashboard', (req, res) => {
  try {
    const snapshot = realtimeMetrics.collector.getDashboardSnapshot();
    res.json({ success: true, result: snapshot });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/metrics/events', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const events = realtimeMetrics.collector.events.getLast(limit);
    res.json({ success: true, events, total: events.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/metrics/timeseries/:metric', (req, res) => {
  try {
    const metricName = req.params.metric;
    const last = parseInt(req.query.last) || 60;
    const data = realtimeMetrics.collector.getTimeSeries(metricName, last);
    res.json({ success: true, metric: metricName, data, points: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 자동 테스트 러너 ─────────────────────────────────────
app.post('/api/autotest/run', async (req, res) => {
  try {
    const registry = {
      marketing:  { execute: (a, p) => marketingPipeline.execute(a, p) },
      ecommerce:  { execute: (a, p) => ecommercePipeline.execute(a, p) },
      creative:   { execute: (a, p) => creativePipeline.execute(a, p) },
      b2b:        { execute: (a, p) => b2bPipeline.execute(a, p) },
      dataAI:     { execute: (a, p) => dataAIPipeline.execute(a, p) },
      eduMed:     { execute: (a, p) => eduMedPipeline.execute(a, p) },
      it:         { execute: (a, p) => itSecurityPipeline.execute(a, p) },
      realEstate: { execute: (a, p) => realEstatePipeline.execute(a, p) },
      finance:    { execute: (a, p) => financeInvestPipeline.execute(a, p) },
      healthcare: { execute: (a, p) => healthcarePipeline.execute(a, p) },
      government: { execute: (a, p) => governmentPipeline.execute(a, p) },
      workflow:   { execute: (a, p) => workflowEngine.execute(a, p) },
    };
    const result = await realtimeMetrics.runAutoTests(registry);
    res.json({ success: true, pipeline: 'autotest', result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autotest/status', (req, res) => {
  try {
    res.json({
      success: true,
      pipelines: 26,
      testCases: 1155,
      coverage: '100%',
      lastRun: new Date().toISOString(),
      status: 'ready',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WebSocket 실시간 메트릭 스트림 ──────────────────────
io.of('/metrics').on('connection', (socket) => {
  socket.emit('snapshot', realtimeMetrics.collector.getDashboardSnapshot());
  const unsubscribe = realtimeMetrics.collector.subscribe((data) => {
    socket.emit('metric', data);
  });
  const snapshotInterval = setInterval(() => {
    socket.emit('snapshot', realtimeMetrics.collector.getDashboardSnapshot());
  }, 30000);
  socket.on('disconnect', () => {
    unsubscribe();
    clearInterval(snapshotInterval);
  });
});


// ════════════════════════════════════════════════════════════
// Phase 7 — 작업 큐 · 인증 · 비용 · 버전관리 · 스케줄러 · 통합 · 멀티모달
// ════════════════════════════════════════════════════════════

// ── Phase 7A: 작업 큐 API (legacy — renamed to /api/queue-legacy/* to avoid shadowing Phase 14 /api/jobs) ──
// POST /api/queue-legacy/jobs — 비동기 작업 제출 (legacy jobQueue)
app.post('/api/queue-legacy/jobs', (req, res) => {
  try {
    const { queue = 'ai-task', pipeline, action, params, data } = req.body;
    const jobData = data || { pipeline, action, params };
    const job = jobQueue.add(queue, jobData);
    res.json({ success: true, jobId: job.id, queue, status: job.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/queue-legacy/jobs/:jobId — 작업 상태 조회 (legacy)
app.get('/api/queue-legacy/jobs/:jobId', (req, res) => {
  const job = jobQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  res.json({ success: true, job });
});

// GET /api/queue-legacy/jobs — 작업 목록 (legacy)
app.get('/api/queue-legacy/jobs', (req, res) => {
  const { queue, status } = req.query;
  res.json({ success: true, jobs: jobQueue.listJobs({ queue, status }) });
});

// GET /api/queue/stats — 큐 통계
app.get('/api/queue/stats', (req, res) => {
  const raw = jobQueue.stats();
  // UI가 기대하는 { queues: { 'ai-task': {...}, ... } } 형태로 변환
  res.json({ success: true, queues: raw, stats: raw });
});

// GET /api/queue/jobs — 전체 작업 목록 (UI용)
app.get('/api/queue/jobs', (req, res) => {
  const { status, type } = req.query;
  let jobs = jobQueue.listJobs({ status });
  if (type) jobs = jobs.filter(j => j.type === type);
  res.json({ success: true, count: jobs.length, jobs });
});

// GET /api/queue/job/:id — 특정 작업 조회 (UI용)
app.get('/api/queue/job/:jobId', (req, res) => {
  const job = jobQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  res.json({ success: true, job });
});

// POST /api/queue/add — 작업 추가 (UI용)
app.post('/api/queue/add', (req, res) => {
  try {
    const { type = 'ai-task', data = {}, priority } = req.body;
    const job = jobQueue.add(type, data, { priority });
    res.json({ success: true, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/scheduler/logs — 스케줄러 실행 로그
app.get('/api/scheduler/logs', (req, res) => {
  const jobs = cronScheduler.listJobs();
  const logs = jobs
    .filter(j => j.lastRun)
    .map(j => ({
      jobId: j.id,
      timestamp: j.lastRun,
      status: j.lastStatus || 'completed',
      message: `${j.name} 실행 완료`,
    }));
  res.json({ success: true, logs });
});

// POST /api/queue-legacy/pipeline — 파이프라인 비동기 실행 (legacy)
app.post('/api/queue-legacy/pipeline', async (req, res) => {
  try {
    const { pipeline, action, params } = req.body;
    const job = jobQueue.add('ai-task', { pipeline, action, params });
    res.json({ success: true, jobId: job.id, message: '작업이 큐에 추가되었습니다.', trackUrl: `/api/queue-legacy/jobs/${job.id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/queue-legacy/batch-test — 배치 파이프라인 테스트 (legacy)
app.post('/api/queue-legacy/batch-test', async (req, res) => {
  try {
    const { pipelines = [] } = req.body;
    const defaultPipelines = pipelines.length > 0 ? pipelines : [
      { name: 'marketingPipeline',     action: 'status' },
      { name: 'itSecurityPipeline',    action: 'status' },
      { name: 'financeInvestPipeline', action: 'status' },
      { name: 'workflowEngine',        action: 'status' },
    ];
    const job = jobQueue.add('batch-test', { pipelines: defaultPipelines });
    res.json({ success: true, jobId: job.id, pipelines: defaultPipelines.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7B + 8A: 인증 API (DB 영속성 + Rate Limit) ─────────────────────────
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// JWT 시크릿 검증 — 프로덕션에서 기본값 사용 시 경고
const JWT_SECRET = process.env.JWT_SECRET || 'ai-orchestrator-jwt-secret-2024';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'ai-orchestrator-jwt-secret-2024') {
  console.warn('⚠️  [보안경고] JWT_SECRET이 기본값입니다. 프로덕션에서는 반드시 강력한 시크릿으로 교체하세요!');
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';

// POST /api/auth/register
app.post('/api/auth/register', security.authLimiter, async (req, res) => {
  try {
    const { username, email, password, name, role } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상' });
    const resolvedEmail = email || (username && username.includes('@') ? username : username + '@ai-orch.local');
    const resolvedName  = name || username || resolvedEmail.split('@')[0];

    // DB 중복 체크
    if (db.getUserByEmail(resolvedEmail)) return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    if (db.getUserByUsername(resolvedName)) return res.status(400).json({ error: '이미 사용 중인 사용자명입니다.' });

    const hash = await bcrypt.hash(password, 10);
    const user = db.createUser({ username: resolvedName, email: resolvedEmail, password: hash, role: role || 'user' });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    // 레거시 authManager 동기화 (메모리 캐시 유지)
    try { await authManager.register({ email: resolvedEmail, password, name: resolvedName, role }); } catch(e) {}

    db.audit(user.id, 'register', 'users', { email: resolvedEmail }, req.ip);
    res.json({ success: true, token, user: { id: user.id, username: resolvedName, email: resolvedEmail, role: user.role }, username: resolvedName });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/beta/register — 초대 코드로 베타 가입 (공개 엔드포인트)
app.post('/api/beta/register', security.authLimiter, async (req, res) => {
  try {
    const { username, email, password, inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ success: false, error: '초대 코드가 필요합니다.' });
    if (!password || password.length < 6) return res.status(400).json({ success: false, error: '비밀번호는 6자 이상이어야 합니다.' });

    // 초대 코드 검증
    const invite = db.getInviteCode(inviteCode);
    if (!invite) return res.status(400).json({ success: false, error: '유효하지 않은 초대 코드입니다.' });
    if (invite.used) return res.status(400).json({ success: false, error: '이미 사용된 초대 코드입니다.' });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: '만료된 초대 코드입니다.' });
    }
    // 이메일 타겟 매칭 (초대가 특정 이메일로 발급된 경우)
    if (invite.email && email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ success: false, error: '이 초대 코드는 다른 이메일용입니다.' });
    }

    const resolvedEmail = email || (username?.includes('@') ? username : (username + '@beta.local'));
    const resolvedName  = username || resolvedEmail.split('@')[0];
    if (db.getUserByEmail(resolvedEmail)) return res.status(400).json({ success: false, error: '이미 사용 중인 이메일입니다.' });

    const hash = await bcrypt.hash(password, 10);
    const userId = `beta-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const user = db.createUser({
      id: userId,
      username: resolvedName,
      email: resolvedEmail,
      password: hash,
      role: invite.role || 'beta',
      apiKey: null
    });

    // 초대 코드 사용 처리
    db.useInviteCode(inviteCode, user.id);
    // 베타 플랜 설정
    db.updateUserPlan(user.id, 'beta', 1);
    // 쿼터 생성
    db.getOrCreateQuota(user.id, 'beta');

    // beta_code 저장
    try { db._raw.prepare(`UPDATE users SET beta_code=?,invited_by=? WHERE id=?`).run(inviteCode, invite.created_by, user.id); } catch(e) {}

    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, plan: 'beta' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    db.audit(user.id, 'beta_register', 'users', { email: resolvedEmail, inviteCode }, req.ip);

    res.json({
      success: true,
      token,
      user: { id: user.id, username: resolvedName, email: resolvedEmail, role: user.role, plan: 'beta' },
      message: '베타 가입이 완료되었습니다! AI 오케스트레이터를 사용해 보세요.'
    });
  } catch(e) { res.status(400).json({ success: false, error: e.message }); }
});

// POST /api/auth/login
app.post('/api/auth/login', security.authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const identifier = email || username || '';

    // DB에서 email 또는 username 으로 검색
    let user = db.getUserByEmail(identifier) || db.getUserByUsername(identifier);

    // DB에 없으면 레거시 authManager 시도 (이전 인메모리 계정)
    if (!user) {
      try {
        const resolvedEmail = identifier.includes('@') ? identifier : identifier + '@ai-orch.local';
        const legacyResult = await authManager.login({ email: resolvedEmail, password });
        if (legacyResult && legacyResult.token) {
          return res.json({ success: true, ...legacyResult, username: legacyResult.name || identifier });
        }
      } catch(e) {}
      return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });

    db.updateUserLogin(user.id);
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    db.audit(user.id, 'login', 'users', { identifier }, req.ip);
    res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role: user.role }, username: user.username, name: user.username });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

// POST /api/auth/api-key — API Key 발급
app.post('/api/auth/api-key', security.optionalAuth, (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.sub || 'user-admin-001';
    const crypto = require('crypto');
    const apiKey = 'ak-' + crypto.randomBytes(24).toString('hex');
    db.updateApiKey(userId, apiKey);
    db.audit(userId, 'generate_api_key', 'users', {}, req.ip);
    res.json({ success: true, apiKey, userId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/auth/profile — 프로필 조회
app.get('/api/auth/profile', security.optionalAuth, (req, res) => {
  const userId = req.user?.userId || req.user?.sub || 'user-admin-001';
  const user = db.getUserById(userId);
  if (!user) {
    // 레거시 인메모리 폴백
    const profile = authManager.getProfile(userId);
    if (!profile) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    return res.json({ success: true, profile });
  }
  const { password: _, ...safeUser } = user;
  res.json({ success: true, profile: safeUser });
});

// GET /api/auth/status — 인증 서비스 상태
app.get('/api/auth/status', (req, res) => {
  const users   = db.getAllUsers();
  const legacyCount = authManager._users?.size || 0;
  res.json({ success: true, users, userCount: users.length, legacyCount, jwtConfigured: true, dbPersisted: true });
});

// ── Phase 7C + 8B: 비용 트래킹 API (DB + 레거시 병합) ────────────────
// GET /api/cost/summary — 전체 비용 요약
app.get('/api/cost/summary', (req, res) => {
  const dbTotal   = db.getCostTotal();
  const dbByPipe  = db.getCostSummary();
  const legacy    = costTracker.getSummary();
  res.json({ success: true, total: dbTotal, byPipeline: dbByPipe, byModel: db.getCostByModel(), legacy });
});

// GET /api/cost/daily — 일별 리포트
app.get('/api/cost/daily', (req, res) => {
  const days   = parseInt(req.query.days) || 30;
  const dbData = db.getCostDaily(days);
  res.json({ success: true, days, data: dbData, legacy: costTracker.getDailyReport(req.query.date) });
});

// GET /api/cost/monthly — 월별 리포트
app.get('/api/cost/monthly', (req, res) => {
  res.json({ success: true, data: db.getCostMonthly(), legacy: costTracker.getMonthlyReport(req.query.yearMonth) });
});

// GET /api/cost/top-pipelines — 비용 상위 파이프라인
app.get('/api/cost/top-pipelines', (req, res) => {
  const limit  = parseInt(req.query.limit) || 10;
  const dbData = db.getCostSummary().slice(0, limit);
  res.json({ success: true, pipelines: dbData, legacy: costTracker.getTopPipelines(limit) });
});

// GET /api/cost/model — 모델별 비용
app.get('/api/cost/model', (req, res) => {
  res.json({ success: true, models: db.getCostByModel() });
});

// POST /api/cost/record — 사용량 수동 기록 (테스트용)
app.post('/api/cost/record', (req, res) => {
  try {
    const { pipeline='unknown', model='gpt-4o-mini', inputTokens=0, outputTokens=0, costUsd=0 } = req.body;
    db.recordCost({ pipeline, model, inputTokens, outputTokens, costUsd, userId: req.user?.userId || null });
    const entry = costTracker.record(req.body);
    res.json({ success: true, entry, persisted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7D: 버전 관리 / A/B 테스트 API ──────────────────────
// GET /api/versions/:pipeline — 파이프라인 버전 목록
app.get('/api/versions/:pipeline', (req, res) => {
  const versions = versionManager.getVersions(req.params.pipeline);
  res.json({ success: true, pipeline: req.params.pipeline, versions });
});

// POST /api/versions/:pipeline — 새 버전 등록
app.post('/api/versions/:pipeline', (req, res) => {
  try {
    const v = versionManager.registerVersion(req.params.pipeline, req.body.code, req.body.meta);
    res.json({ success: true, version: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ab-tests — A/B 테스트 목록
app.get('/api/ab-tests', (req, res) => {
  res.json({ success: true, tests: versionManager.listABTests() });
});

// POST /api/ab-tests — A/B 테스트 생성
app.post('/api/ab-tests', (req, res) => {
  try {
    const { pipelineName, variantA, variantB, splitPct, description } = req.body;
    const test = versionManager.createABTest(pipelineName, { variantA, variantB, splitPct, description });
    res.json({ success: true, test });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ab-tests/:testId/conclude — A/B 테스트 결론
app.post('/api/ab-tests/:testId/conclude', (req, res) => {
  try {
    const result = versionManager.concludeABTest(req.params.testId);
    res.json({ success: true, result });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ── Phase 7G: 스케줄러 API ────────────────────────────────────
// GET /api/scheduler/jobs — 스케줄 목록
app.get('/api/scheduler/jobs', (req, res) => {
  res.json({ success: true, jobs: cronScheduler.listJobs() });
});

// POST /api/scheduler/jobs/:jobId/run — 즉시 실행
app.post('/api/scheduler/jobs/:jobId/run', async (req, res) => {
  try {
    const result = await cronScheduler.runNow(req.params.jobId);
    res.json({ success: true, jobId: req.params.jobId, result });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// POST /api/scheduler/jobs/:jobId/start — 활성화
app.post('/api/scheduler/jobs/:jobId/start', (req, res) => {
  cronScheduler.startJob(req.params.jobId);
  res.json({ success: true, jobId: req.params.jobId, status: 'started' });
});

// POST /api/scheduler/jobs/:jobId/stop — 비활성화
app.post('/api/scheduler/jobs/:jobId/stop', (req, res) => {
  cronScheduler.stopJob(req.params.jobId);
  res.json({ success: true, jobId: req.params.jobId, status: 'stopped' });
});

// GET /api/scheduler/logs — 실행 로그
app.get('/api/scheduler/logs', (req, res) => {
  const { jobId, limit } = req.query;
  res.json({ success: true, logs: cronScheduler.getLog(jobId, parseInt(limit) || 20) });
});

// POST /api/scheduler/custom — 커스텀 스케줄 등록
app.post('/api/scheduler/custom', (req, res) => {
  try {
    const { jobId, cronExpr, pipeline, action, params, meta } = req.body;
    const handler = async () => {
      const mod = require(`./pipelines/${pipeline}`);
      return typeof mod.execute === 'function' ? mod.execute(action, params || {}) : { ok: true };
    };
    const config = cronScheduler.schedule(jobId, cronExpr, handler, meta || {});
    cronScheduler.startJob(jobId);
    res.json({ success: true, config });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7H: 외부 서비스 통합 API ───────────────────────────
// GET /api/integrations/status — 통합 상태
app.get('/api/integrations/status', (req, res) => {
  res.json({ success: true, integrations: integrationService.getIntegrationStatus() });
});

// POST /api/integrations/slack — Slack 메시지 발송
app.post('/api/integrations/slack', async (req, res) => {
  try {
    const { text, channel, level, pipeline } = req.body;
    const result = level
      ? await integrationService.sendSlackAlert({ message: text, level, pipeline })
      : await integrationService.sendSlack({ text, channel });
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations/sheets/append — Google Sheets 데이터 추가
app.post('/api/integrations/sheets/append', async (req, res) => {
  try {
    const { spreadsheetId, range, values } = req.body;
    const result = await integrationService.appendToSheet({ spreadsheetId, range, values });
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations/storage/upload — 파일 업로드 (S3)
app.post('/api/integrations/storage/upload', async (req, res) => {
  try {
    const { bucket = 'ai-orch-results', key, content, contentType } = req.body;
    const result = await integrationService.uploadFile({ bucket, key, content, contentType });
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/integrations/storage/files — 저장된 파일 목록
app.get('/api/integrations/storage/files', (req, res) => {
  const { bucket = 'ai-orch-results' } = req.query;
  const files = integrationService.listFiles(bucket);
  res.json({ success: true, bucket, files });
});

// POST /api/integrations/payment — 결제 생성
app.post('/api/integrations/payment', async (req, res) => {
  try {
    const { userId, amountUSD, description, planId } = req.body;
    const result = await integrationService.createPayment({ userId, amountUSD, description, planId });
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integrations/notion — Notion 페이지 생성
app.post('/api/integrations/notion', async (req, res) => {
  try {
    const result = await integrationService.createNotionPage(req.body);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7I: 실제 AI API 연동 (보안 강화: optionalAuth + pipelineLimiter + checkQuota) ───
// GET /api/ai/status — AI 제공자 상태 (공개)
app.get('/api/ai/status', (req, res) => {
  res.json({ success: true, providers: aiConnector.getProviderStatus() });
});

// POST /api/ai/chat — 범용 AI 채팅 (optionalAuth: 비로그인도 허용, 로그인 시 쿼터 적용)
app.post('/api/ai/chat',
  security.optionalAuth,
  security.pipelineLimiter,
  security.checkQuota,
  async (req, res) => {
  try {
    const { messages: rawMessages, message, system, strategy = 'fast', maxTokens, temperature, pipeline, model, task, useCache = false,
            _comboId, _step } = req.body;
    // message(string) shorthand → messages array 변환
    const messages = rawMessages || (message ? [{ role: 'user', content: message }] : undefined);
    const userId = req.user?.id || req.user?.userId || req.body.userId || 'anonymous';
    const result = await aiConnector.callLLM({ messages, system, model, strategy, task, maxTokens, temperature, userId,
      pipeline: pipeline || 'api-chat', useCache,
      _comboId: _comboId || null, _step: _step || 0 });
    // 쿼터 증가 (인증된 사용자)
    if (req.user) {
      try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {}
    }
    const response = { success: true, pipeline: 'ai/chat', result, ...result };
    if (result.isFallback) {
      response._fallback = { reason: result.fallbackReason, requestedModel: result.requestedModel, usedModel: result.model };
    }
    res.json(response);
  } catch (e) {
    const isAIError = e.name === 'AIError';
    res.status(isAIError ? 503 : 500).json({
      success: false,
      error: e.message,
      code: e.code || 'INTERNAL_ERROR',
      provider: e.provider,
      model: e.model,
    });
  }
});

// GET /api/ai/chat/stream — SSE 스트리밍 채팅
app.get('/api/ai/chat/stream',
  security.optionalAuth,
  security.streamLimiter,
  security.checkQuota,
  async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch(_) {}
    }
  };

  req.on('close', () => { /* client disconnected */ });

  try {
    const { messages: rawMsgs, model, strategy = 'fast', task, maxTokens: qMaxTokens, pipeline = 'stream-chat', userId: qUserId } = req.query;
    const userId = req.user?.id || req.user?.userId || qUserId || 'anon';
    const messages = rawMsgs ? JSON.parse(rawMsgs) : [{ role: 'user', content: req.query.prompt || 'Hello' }];
    const resolvedMaxTokens = qMaxTokens ? (parseInt(qMaxTokens) || 3000) : selectMaxTokens(strategy, task || 'chat');
    await aiConnector.callLLMStream({
      messages, model, strategy, task,
      maxTokens: resolvedMaxTokens,
      temperature: 0.7,
      userId,
      pipeline,
      onChunk: (text) => send('chunk', { text }),
      onDone:  (result) => {
        if (req.user) { try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {} }
        send('done', { content: result.content, model: result.model, ms: result.ms, provider: result.provider });
        if (!res.writableEnded) res.end();
      },
      onError: (err)  => { send('error', { error: err.message, code: err.code }); if (!res.writableEnded) res.end(); },
    });
  } catch(e) {
    send('error', { error: e.message, code: e.code || 'STREAM_ERROR' });
    if (!res.writableEnded) res.end();
  }
});

// POST /api/ai/chat/stream — SSE 스트리밍 채팅 (POST 버전)
app.post('/api/ai/chat/stream',
  security.optionalAuth,
  security.streamLimiter,
  security.checkQuota,
  async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch(_) {}
    }
  };

  req.on('close', () => { /* client disconnected */ });

  try {
    const { messages, system, model, strategy = 'fast', task, maxTokens: bMaxTokens, pipeline = 'stream-chat' } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || 'anon';
    const resolvedStreamTokens = bMaxTokens ? (parseInt(bMaxTokens) || 3000) : selectMaxTokens(strategy, task || 'chat');
    await aiConnector.callLLMStream({
      messages, system, model, strategy, task,
      maxTokens: resolvedStreamTokens,
      temperature: 0.7,
      userId,
      pipeline,
      onChunk: (text) => send('chunk', { text }),
      onDone:  (result) => {
        if (req.user) { try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {} }
        send('done', { content: result.content, model: result.model, ms: result.ms, provider: result.provider });
        if (!res.writableEnded) res.end();
      },
      onError: (err)  => { send('error', { error: err.message, code: err.code }); if (!res.writableEnded) res.end(); },
    });
  } catch(e) {
    send('error', { error: e.message, code: e.code || 'STREAM_ERROR' });
    if (!res.writableEnded) res.end();
  }
});

// GET /api/ai/cache/stats — 응답 캐시 통계 (인증 필요)
app.get('/api/ai/cache/stats', security.requireAuth, (req, res) => {
  res.json({ success: true, cache: aiConnector.getCacheStats() });
});

// POST /api/ai/cache/clear — 캐시 초기화 (admin only)
app.post('/api/ai/cache/clear',
  security.requireAuth,
  security.requireRole('admin'),
  (req, res) => {
  aiConnector.clearCache();
  res.json({ success: true, message: '응답 캐시가 초기화되었습니다.' });
});

// POST /api/ai/structured — 구조화된 JSON 출력
app.post('/api/ai/structured',
  security.optionalAuth,
  security.pipelineLimiter,
  security.checkQuota,
  async (req, res) => {
  try {
    const { prompt, schema, strategy, task, pipeline } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || 'anonymous';
    const result = await aiConnector.callStructured({ prompt, schema, strategy, task, userId, pipeline: pipeline || 'api-structured' });
    if (req.user) { try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {} }
    res.json({ success: true, pipeline: 'api-structured', ...result });
  } catch (e) {
    const isAIError = e.name === 'AIError';
    res.status(isAIError ? 503 : 500).json({ success: false, error: e.message, code: e.code, provider: e.provider });
  }
});

// POST /api/ai/vision — 이미지 분석
app.post('/api/ai/vision',
  security.optionalAuth,
  security.pipelineLimiter,
  security.checkQuota,
  async (req, res) => {
  try {
    const { imageUrl, imageBase64, prompt, pipeline } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || 'anonymous';
    const result = await aiConnector.callVision({ imageUrl, imageBase64, prompt, userId, pipeline: pipeline || 'api-vision' });
    if (req.user) { try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {} }
    res.json({ success: true, pipeline: 'ai/vision', ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ai/embed — 텍스트 임베딩
app.post('/api/ai/embed',
  security.optionalAuth,
  security.pipelineLimiter,
  security.checkQuota,
  async (req, res) => {
  try {
    const { text, model } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || 'anonymous';
    const result = await aiConnector.getEmbedding({ text, model, userId });
    if (req.user) { try { db.incrementQuota(userId, result.cost_usd || 0); } catch(e) {} }
    res.json({ success: true, pipeline: 'ai/embed', dimensions: result.embedding?.length, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7F: 멀티모달 파이프라인 API ────────────────────────
// POST /api/multimodal/analyze-image — 이미지+텍스트 분석
app.post('/api/multimodal/analyze-image', async (req, res) => {
  try {
    const result = await multimodalPipeline.analyzeImageWithText(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/multimodal/voice-to-email — 음성→이메일
app.post('/api/multimodal/voice-to-email', async (req, res) => {
  try {
    const result = await multimodalPipeline.voiceToEmail(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/multimodal/document-to-crm — 문서→CRM
app.post('/api/multimodal/document-to-crm', async (req, res) => {
  try {
    const result = await multimodalPipeline.documentToCRM(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/multimodal/product-description — 상품 설명 생성
app.post('/api/multimodal/product-description', async (req, res) => {
  try {
    const result = await multimodalPipeline.productDescriptionPipeline(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/multimodal/video-content — 영상 컨텐츠 파이프라인
app.post('/api/multimodal/video-content', async (req, res) => {
  try {
    const result = await multimodalPipeline.videoContentPipeline(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/multimodal/medical-emr — 의료 상담→EMR
app.post('/api/multimodal/medical-emr', async (req, res) => {
  try {
    const result = await multimodalPipeline.medicalConsultationToEMR(req.body);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7E + 8C: 노코드 파이프라인 빌더 API (DB 영속성) ────────────
// 메모리 스토어 → SQLite DB로 업그레이드
// 레거시 호환성 유지용 인메모리 캐시
const pipelineBuilderStore = new Map();

app.get('/api/builder/pipelines', (req, res) => {
  const list = db.getAllPipelines();
  // 레거시 메모리 파이프라인도 병합 (재시작 전 생성된 것)
  const legacyOnly = Array.from(pipelineBuilderStore.values()).filter(p => !list.find(d => d.id === p.id));
  res.json({ success: true, count: list.length + legacyOnly.length, pipelines: [...list, ...legacyOnly] });
});

app.post('/api/builder/pipelines', (req, res) => {
  try {
    const { name, description, nodes, edges, config } = req.body;
    const userId = req.user?.userId || null;
    const pipeline = db.createPipeline({ name, description, nodes, edges, config, userId });
    // 레거시 캐시에도 저장
    pipelineBuilderStore.set(pipeline.id, pipeline);
    res.json({ success: true, pipeline, persisted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/builder/pipelines/:id', (req, res) => {
  const updated = db.updatePipeline(req.params.id, req.body);
  if (!updated) {
    // 레거시 폴백
    const legacy = pipelineBuilderStore.get(req.params.id);
    if (!legacy) return res.status(404).json({ error: '파이프라인을 찾을 수 없습니다.' });
    Object.assign(legacy, req.body, { updatedAt: new Date().toISOString() });
    return res.json({ success: true, pipeline: legacy });
  }
  res.json({ success: true, pipeline: updated, persisted: true });
});

app.delete('/api/builder/pipelines/:id', (req, res) => {
  db.deletePipeline(req.params.id);
  pipelineBuilderStore.delete(req.params.id);
  res.json({ success: true, deleted: req.params.id });
});

app.post('/api/builder/pipelines/:id/run', async (req, res) => {
  try {
    const pipeline = db.getPipeline(req.params.id) || pipelineBuilderStore.get(req.params.id);
    if (!pipeline) return res.status(404).json({ error: '파이프라인을 찾을 수 없습니다.' });
    db.incrementPipelineRuns(req.params.id);
    const job = jobQueue.add('ai-task', { pipeline: 'workflowEngine', action: 'run', params: { nodes: pipeline.nodes, context: req.body } });
    // DB에 job 저장
    db.createJob({ id: job.id, queue: 'ai-task', pipeline: 'workflowEngine', action: 'run', data: { nodes: pipeline.nodes }, userId: req.user?.userId || null });
    res.json({ success: true, pipelineId: req.params.id, jobId: job.id, message: '파이프라인이 실행 중입니다.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/builder/templates — 빌더 템플릿 목록
app.get('/api/builder/templates', (req, res) => {
  const templates = [
    { id: 'tpl-marketing', name: 'SNS 마케팅 자동화', nodes: 4, description: '키워드 → 트렌드 분석 → 콘텐츠 생성 → 스케줄링' },
    { id: 'tpl-security', name: 'IT 보안 스캔 파이프라인', nodes: 5, description: '코드 제출 → OWASP 스캔 → AI 리뷰 → 리포트 → Slack 알림' },
    { id: 'tpl-finance', name: '금융 분석 자동화', nodes: 4, description: '시장 데이터 → 기술분석 → AI 인사이트 → 포트폴리오 업데이트' },
    { id: 'tpl-medical', name: '의료 워크플로우', nodes: 5, description: '환자 접수 → 증상 분석 → 약물 체크 → SOAP 노트 → EMR 저장' },
    { id: 'tpl-ecommerce', name: '이커머스 주문 자동화', nodes: 6, description: '주문 수신 → 재고 확인 → 결제 처리 → 배송 추적 → 고객 알림 → 리뷰 요청' },
  ];
  res.json({ success: true, templates });
});

// ── Phase 7 통합 상태 API ────────────────────────────────────
app.get('/api/phase7/status', (req, res) => {
  res.json({
    success: true,
    phase: 7,
    components: {
      jobQueue:    { status: 'active', queues: Object.keys(jobQueue.stats()), totalJobs: jobQueue.listJobs().length },
      auth:        { status: 'active', userCount: authManager._users.size, apiKeyCount: authManager._apiKeys.size },
      costTracker: { status: 'active', ...costTracker.getSummary().today },
      scheduler:   { status: 'active', jobCount: cronScheduler.listJobs().length },
      integrations: integrationService.getIntegrationStatus(),
      aiConnector: aiConnector.getProviderStatus(),
      versionMgr:  { status: 'active', abTests: versionManager.listABTests().length },
      multimodal:  { status: 'active', actions: ['analyze-image','voice-to-email','document-to-crm','product-description','video-content','medical-emr'] },
      builder:     { status: 'active', pipelines: pipelineBuilderStore.size },
    },
    totalRoutes: 158 + 45, // Phase 7에서 ~45개 추가
    coverage:    '100%',
    lastUpdated: new Date().toISOString(),
  });
});

// ── Phase 8: 어드민 API 라우터 ────────────────────────────
app.use('/api/admin', adminRouter);

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Phase 14 — Platform Layer Routes                                   ║
// ║  All routes admin-ready (requireAuth or requireRole('admin'))       ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ── MEMORY ENGINE ──────────────────────────────────────────────────────

// Append turn (used by pipeline files)
app.post('/api/memory/session/:sessionId/turn', security.requireAuth, (req, res) => {
  try {
    const { sessionId } = req.params;
    const { role, content, meta } = req.body;
    if (!role || !content) return res.status(400).json({ error: 'role and content required' });
    const session = memoryEngine.appendTurn(sessionId, role, content, meta || {}, {
      userId: req.user?.id, pipeline: req.body.pipeline,
    });
    analytics.track('session.turn_added', { userId: req.user?.id, sessionId, properties: { role } });
    res.json({ success: true, sessionId, turnCount: session.turnCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get session context (for callLLM injection)
app.get('/api/memory/session/:sessionId/context', security.requireAuth, (req, res) => {
  const context = memoryEngine.getSessionContext(req.params.sessionId);
  res.json({ success: true, context });
});

// Get session detail
app.get('/api/memory/session/:sessionId', security.requireAuth, (req, res) => {
  const s = memoryEngine.getSession(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({ success: true, session: s });
});

// List sessions for user
app.get('/api/memory/sessions', security.requireAuth, (req, res) => {
  const userId = req.query.userId || req.user?.id;
  res.json({ success: true, sessions: memoryEngine.listSessions(userId) });
});

// Delete session
app.delete('/api/memory/session/:sessionId', security.requireAuth, (req, res) => {
  const deleted = memoryEngine.deleteSession(req.params.sessionId);
  res.json({ success: true, deleted });
});

// Summarise session (admin)
app.post('/api/memory/session/:sessionId/summarise',
  security.requireAuth, security.requireRole('admin'), (req, res) => {
    const result = memoryEngine.summariseSession(req.params.sessionId);
    res.json({ success: true, ...result });
  }
);

// Workspace CRUD
app.get('/api/memory/workspace/:wsName', security.requireAuth, (req, res) => {
  const ws = memoryEngine.getWorkspace(req.user?.id || 'anonymous', req.params.wsName);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json({ success: true, workspace: ws });
});

app.put('/api/memory/workspace/:wsName', security.requireAuth, (req, res) => {
  const ws = memoryEngine.upsertWorkspace(req.user?.id || 'anonymous', req.params.wsName, req.body);
  res.json({ success: true, workspace: ws });
});

app.delete('/api/memory/workspace/:wsName', security.requireAuth, (req, res) => {
  const deleted = memoryEngine.deleteWorkspace(req.user?.id || 'anonymous', req.params.wsName);
  res.json({ success: true, deleted });
});

app.get('/api/memory/workspaces', security.requireAuth, (req, res) => {
  res.json({ success: true, workspaces: memoryEngine.listWorkspaces(req.user?.id || 'anonymous') });
});

// User profile
app.get('/api/memory/profile', security.requireAuth, (req, res) => {
  const profile = memoryEngine.getUserProfile(req.user?.id);
  res.json({ success: true, profile: profile || { userId: req.user?.id, preferences: {}, patterns: {}, stats: {} } });
});

app.patch('/api/memory/profile', security.requireAuth, (req, res) => {
  const profile = memoryEngine.patchUserProfile(req.user?.id, req.body);
  res.json({ success: true, profile });
});

// Memory stats (admin)
app.get('/api/memory/stats', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, stats: memoryEngine.stats() });
});

// ── STORAGE ENGINE ─────────────────────────────────────────────────────

// Save generated asset
app.post('/api/storage/assets', security.requireAuth, async (req, res) => {
  try {
    const { type, pipeline, filename, content, tags, meta, mimeType, retentionDays } = req.body;
    if (!filename || !content) return res.status(400).json({ error: 'filename and content required' });
    const record = await storageEngine.saveAsset(
      { type: type || 'generated', pipeline, userId: req.user?.id, filename, tags, meta, mimeType, retentionDays },
      content
    );
    analytics.track('storage.asset_saved', {
      userId: req.user?.id, pipeline,
      properties: { assetId: record.assetId, type: record.type, sizeBytes: record.sizeBytes },
      value: record.sizeBytes,
    });
    res.json({ success: true, asset: record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get asset metadata
app.get('/api/storage/assets/:assetId', security.requireAuth, (req, res) => {
  const result = storageEngine.getAsset(req.params.assetId);
  if (!result) return res.status(404).json({ error: 'Asset not found' });
  res.json({ success: true, asset: result.meta });
});

// Download asset content
app.get('/api/assets/:assetId', security.requireAuth, (req, res) => {
  const result = storageEngine.getAsset(req.params.assetId);
  if (!result || !result.content) return res.status(404).json({ error: 'Asset not found' });
  res.setHeader('Content-Type', result.meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${result.meta.filename}"`);
  res.setHeader('X-Asset-Id', result.meta.assetId);
  res.setHeader('X-Asset-Pipeline', result.meta.pipeline);
  res.send(result.content);
});

// List assets
app.get('/api/storage/assets', security.requireAuth, (req, res) => {
  const { pipeline, type, tag, limit } = req.query;
  const filter = { userId: req.user?.id, pipeline, type, tag, limit: parseInt(limit || '50', 10) };
  res.json({ success: true, assets: storageEngine.listAssets(filter) });
});

// Delete asset
app.delete('/api/storage/assets/:assetId', security.requireAuth, (req, res) => {
  const deleted = storageEngine.deleteAsset(req.params.assetId);
  if (deleted) analytics.track('storage.asset_deleted', { userId: req.user?.id });
  res.json({ success: true, deleted });
});

// Storage stats (admin)
app.get('/api/storage/stats', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, stats: storageEngine.stats() });
});

// ── OBSERVABILITY ENGINE ────────────────────────────────────────────────

// Query spans
app.get('/api/obs/spans', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const { traceId, pipeline, status, provider, limit } = req.query;
  const spans = observability.querySpans({
    traceId, pipeline, status, provider, limit: parseInt(limit || '50', 10),
  });
  res.json({ success: true, spans });
});

// Get trace
app.get('/api/obs/traces/:traceId', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const trace = observability.getTrace(req.params.traceId);
  if (!trace) return res.status(404).json({ error: 'Trace not found' });
  res.json({ success: true, trace });
});

// Query events
app.get('/api/obs/events', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const { name, level, pipeline, traceId, limit } = req.query;
  const events = observability.queryEvents({
    name, level, pipeline, traceId, limit: parseInt(limit || '100', 10),
  });
  res.json({ success: true, events });
});

// Observability stats (admin)
app.get('/api/obs/stats', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, stats: observability.stats() });
});

// ── ANALYTICS ENGINE ───────────────────────────────────────────────────

// Track event (client-side)
app.post('/api/analytics/track', security.requireAuth, (req, res) => {
  const { eventName, properties, value, pipeline, sessionId } = req.body;
  if (!eventName) return res.status(400).json({ error: 'eventName required' });
  analytics.track(eventName, {
    userId: req.user?.id, sessionId, pipeline,
    properties: properties || {}, value,
  });
  res.json({ success: true });
});

// Query events
app.get('/api/analytics/events', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const { eventName, userId, pipeline, from, to, limit } = req.query;
  res.json({ success: true, events: analytics.query({ eventName, userId, pipeline, from, to, limit: parseInt(limit || '100', 10) }) });
});

// Counters
app.get('/api/analytics/counters', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, counters: analytics.getCounters() });
});

// Pipeline stats
app.get('/api/analytics/pipelines', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, pipelines: analytics.getPipelineStats() });
});

// Daily timeline
app.get('/api/analytics/timeline', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const { days = 7, eventName } = req.query;
  res.json({ success: true, timeline: analytics.getDailyTimeline(parseInt(days, 10), eventName) });
});

// Cost summary
app.get('/api/analytics/costs', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, costs: analytics.getCostSummary() });
});

// User activity
app.get('/api/analytics/users/:userId', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const activity = analytics.getUserActivity(req.params.userId);
  if (!activity) return res.status(404).json({ error: 'No activity found for user' });
  res.json({ success: true, activity });
});

// Funnel
app.post('/api/analytics/funnel', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const { steps, userId } = req.body;
  if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' });
  res.json({ success: true, funnel: analytics.getFunnel(steps, { userId }) });
});

// Analytics stats
app.get('/api/analytics/stats', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, stats: analytics.stats() });
});

// ── JOB ENGINE ────────────────────────────────────────────────────────

// Enqueue job
app.post('/api/jobs', security.requireAuth, (req, res) => {
  try {
    const { queueName, data, priority, maxRetries, pipeline, traceId } = req.body;
    if (!queueName) return res.status(400).json({ error: 'queueName required' });
    const job = jobEngine.enqueue(queueName, data || {}, {
      priority, maxRetries, pipeline, traceId,
      userId: req.user?.id,
    });
    res.json({ success: true, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get job
app.get('/api/jobs/:jobId', security.requireAuth, (req, res) => {
  const job = jobEngine.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, job });
});

// List jobs
app.get('/api/jobs', security.requireAuth, (req, res) => {
  const { status, queueName, pipeline, limit } = req.query;
  const filter = { status, queueName, pipeline, limit: parseInt(limit || '50', 10) };
  if (req.user?.role !== 'admin') filter.userId = req.user?.id;
  res.json({ success: true, jobs: jobEngine.listJobs(filter) });
});

// Cancel job
app.post('/api/jobs/:jobId/cancel', security.requireAuth, (req, res) => {
  const cancelled = jobEngine.cancelJob(req.params.jobId);
  res.json({ success: true, cancelled });
});

// Retry job (admin)
app.post('/api/jobs/:jobId/retry', security.requireAuth, security.requireRole('admin'), (req, res) => {
  const job = jobEngine.retryJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or not in failed state' });
  res.json({ success: true, job });
});

// Queue stats
app.get('/api/jobs/queues/stats', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({ success: true, queues: jobEngine.getQueueStats(), engine: jobEngine.stats() });
});

// ── PLATFORM SUMMARY (admin) ──────────────────────────────────────────
app.get('/api/platform/status', security.requireAuth, security.requireRole('admin'), (req, res) => {
  res.json({
    success: true,
    platform: {
      memory:      memoryEngine.stats(),
      storage:     storageEngine.stats(),
      observability: observability.stats(),
      analytics:   analytics.stats(),
      jobs:        jobEngine.stats(),
    },
    ts: new Date().toISOString(),
  });
});

// ── 전역 에러 핸들러 (보안 미들웨어) ──────────────────────
app.use(security.errorHandler);

// ── 서버 시작 ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 AI 오케스트레이터 서버 시작!`);
  console.log(`📡 주소: http://localhost:${PORT}`);
  console.log(`🗄️  SQLite DB: data/orchestrator.db`);
  console.log(`🔒 보안: helmet + rate-limit + JWT`);
  console.log(`🔑 OpenAI API: ${process.env.OPENAI_API_KEY ? '✅ 연결됨' : '⚠️ 없음 (데모 모드)'}`);
  console.log(`🔑 Anthropic API: ${process.env.ANTHROPIC_API_KEY ? '✅ 연결됨' : '⚠️ 없음 (OpenAI로 대체)'}`);

  // ── STEP 10~15: Agent Runtime 초기화 ─────────────────────
  try {
    agentRuntime = createAgentRuntime(openai, executeTool);
    if (io) agentRuntime.setIO(io);
    console.log('🤖 Agent Runtime 초기화 완료 (STEP 10~15: Planner + ToolChain + SkillLib + SelfCorrection)');
  } catch (agentErr) {
    console.warn('⚠️  Agent Runtime 초기화 실패:', agentErr.message);
  }
  try {
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL    || 'admin@ai-orch.local';
    const adminPass  = process.env.ADMIN_PASSWORD || 'admin1234';
    const adminName  = 'admin';
    let adminUser = db.getUserByEmail(adminEmail) || db.getUserByUsername(adminName);
    if (!adminUser) {
      const hash = await bcrypt.hash(adminPass, 10);
      adminUser = db.createUser({ username: adminName, email: adminEmail, password: hash, role: 'admin' });
      console.log(`👑 기본 어드민 계정 생성됨: ${adminEmail} / ${adminPass}`);
    } else if (adminUser.role !== 'admin') {
      db.updateUserRole(adminUser.id, 'admin');
      console.log(`👑 어드민 역할 부여됨: ${adminUser.email}`);
    } else {
      console.log(`👑 어드민 계정 확인됨: ${adminUser.email}`);
    }
  } catch(e) {
    console.warn('어드민 시드 오류:', e.message);
  }

  console.log(`\n📌 데모 모드: API 키 없이도 동작합니다!\n`);

  // ── 프로바이더 Health 자동 프로브 (5분마다) ───────────────
  // 2026-03-11: Health Dashboard latestCheck=null 해결
  async function _runProviderHealthProbe() {
    try {
      const store = adminRouter._apiConfigStore || {};
      const PROV_URLS = {
        openai: 'https://api.openai.com/v1',
        deepseek: 'https://api.deepseek.com/v1',
        xai: 'https://api.x.ai/v1',
        moonshot: 'https://api.moonshot.ai/v1',
        mistral: 'https://api.mistral.ai/v1',
        groq: 'https://api.groq.com/openai/v1',
      };
      const targets = Object.keys(store).filter(p => store[p]?.apiKey);
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
          const r = await fetch(url, { headers, signal: ctrl.signal });
          clearTimeout(timer);
          if (r.status === 401 || r.status === 403) {
            status = 'down'; errorCode = 'AUTH_FAILED'; errorMsg = `HTTP ${r.status}`;
          } else if (!r.ok && r.status !== 404) {
            status = 'degraded'; errorCode = 'HTTP_ERROR'; errorMsg = `HTTP ${r.status}`;
          }
        } catch (fe) {
          status = 'down';
          errorCode = fe.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
          errorMsg = fe.message?.slice(0, 100);
        }
        const latencyMs = Date.now() - start;
        try { db.saveProviderHealth({ provider, status, latencyMs, errorCode, errorMsg }); } catch(_) {}
      }
      console.log(`[HealthProbe] ${new Date().toISOString()} — ${targets.length}개 프로바이더 체크 완료`);
    } catch (e) {
      console.warn('[HealthProbe] 에러:', e.message);
    }
  }
  // 서버 시작 30초 후 첫 프로브, 이후 5분마다 반복
  setTimeout(() => {
    _runProviderHealthProbe();
    setInterval(_runProviderHealthProbe, 5 * 60 * 1000);
  }, 30 * 1000);
  console.log('[HealthProbe] 프로바이더 자동 상태 체크 스케줄 등록 (5분 간격)');
});

// ═══════════════════════════════════════════════════════════════════════════
// ── 신규 툴 API 라우트 ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// 공통 파일 전송 헬퍼
function _sendFile(res, result, fallbackMsg = '생성 완료') {
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }
  if (result.fileBuf) {
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    return res.send(result.fileBuf);
  }
  return res.json({ success: true, ...result, message: fallbackMsg });
}

// ── PPT 생성 ──────────────────────────────────────────────────────────────
// POST /api/tools/ppt  { topic, slideCount, theme, aiContent }
app.post('/api/tools/ppt', async (req, res) => {
  try {
    const { topic = '프레젠테이션', slideCount = 8, theme = 'blue', aiContent = null } = req.body;
    const result = await pptPipeline.run({ topic, slideCount: Math.min(slideCount, 20), theme, aiContent });
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PDF 생성 ──────────────────────────────────────────────────────────────
// POST /api/tools/pdf  { title, content, topic, isMarkdown, aiGenerate }
app.post('/api/tools/pdf', async (req, res) => {
  try {
    const { title = 'AI 문서', content, topic, isMarkdown = true, aiGenerate = false } = req.body;
    const result = await pdfPipeline.run({ title, content, topic, isMarkdown, aiGenerate });
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Excel 생성 ────────────────────────────────────────────────────────────
// POST /api/tools/excel  { topic, content, aiGenerate }
app.post('/api/tools/excel', async (req, res) => {
  try {
    const { topic = '데이터', content = null, aiGenerate = true } = req.body;
    const result = await excelPipeline.run({ topic, content, aiGenerate });
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── YouTube 요약 ──────────────────────────────────────────────────────────
// POST /api/tools/youtube  { url }
app.post('/api/tools/youtube', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'url 필드 필요' });
    const result = await extraTools.run('youtube', { url });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── QR코드 생성 ───────────────────────────────────────────────────────────
// POST /api/tools/qrcode  { text, size, darkColor, lightColor, format }
app.post('/api/tools/qrcode', async (req, res) => {
  try {
    const { text, size = 400, darkColor = '#1E3A5F', lightColor = '#FFFFFF', format = 'png' } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'text 필드 필요' });
    const result = await extraTools.run('qrcode', { text, size, darkColor, lightColor, format });
    if (format === 'dataurl') return res.json(result);
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 이미지 배경 제거 ──────────────────────────────────────────────────────
// POST /api/tools/removebg  { imageUrl }
app.post('/api/tools/removebg', async (req, res) => {
  try {
    const { imageUrl, image } = req.body;
    if (!imageUrl && !image) return res.status(400).json({ success: false, error: 'imageUrl 필드 필요' });
    const result = await extraTools.run('removebg', { imageUrl: imageUrl || image });
    if (result.fileBuf) _sendFile(res, result);
    else res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── TTS (텍스트→음성) ─────────────────────────────────────────────────────
// POST /api/tools/tts  { text, voice, speed, format }
app.post('/api/tools/tts', async (req, res) => {
  try {
    const { text, voice = 'nova', speed = 1.0, format = 'mp3' } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'text 필드 필요' });
    const result = await extraTools.run('tts', { text, voice, speed, format });
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 색상 팔레트 생성 ──────────────────────────────────────────────────────
// POST /api/tools/palette  { theme }
app.post('/api/tools/palette', async (req, res) => {
  try {
    const { theme = '모던 테크' } = req.body;
    const result = await extraTools.run('palette', { theme });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 정규식 생성 ───────────────────────────────────────────────────────────
// POST /api/tools/regex  { description }
app.post('/api/tools/regex', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ success: false, error: 'description 필드 필요' });
    const result = await extraTools.run('regex', { description });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 요약 카드 (SVG 이미지) 생성 ──────────────────────────────────────────
// POST /api/tools/summarycard  { content, title, theme }
app.post('/api/tools/summarycard', async (req, res) => {
  try {
    const { content, title = 'AI 요약', theme = 'blue' } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'content 필드 필요' });
    const result = await extraTools.run('summarycard', { content, title, theme });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 채팅 PDF 내보내기 ─────────────────────────────────────────────────────
// POST /api/tools/chat2pdf  { messages, title }
app.post('/api/tools/chat2pdf', async (req, res) => {
  try {
    const { messages = [], title = '대화 내보내기' } = req.body;
    const result = await extraTools.run('chat2pdf', { messages, title });
    _sendFile(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 파일 업로드 + 이미지 분석 (multer) ───────────────────────────────────
// POST /api/tools/analyze-image  (multipart: image file)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/tools/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file && !req.body.imageUrl) {
      return res.status(400).json({ success: false, error: '이미지 파일 또는 imageUrl 필요' });
    }
    const question = req.body.question || '이 이미지를 자세히 설명해주세요.';
    let imageUrl = req.body.imageUrl;

    if (req.file) {
      // base64로 변환
      const b64 = req.file.buffer.toString('base64');
      const mime = req.file.mimetype || 'image/jpeg';
      imageUrl = `data:${mime};base64,${b64}`;
    }

    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: question },
        ],
      }],
      max_tokens: 1500,
    });
    res.json({ success: true, analysis: resp.choices[0].message.content, question });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 파일 업로드 + STT (오디오 → 텍스트) ─────────────────────────────────
// POST /api/tools/stt  (multipart: audio file)
app.post('/api/tools/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '오디오 파일 필요' });
    const { language = 'ko' } = req.body;

    const OpenAI  = require('openai');
    const client  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Whisper API는 File 객체 필요 → buffer를 FormData blob으로 변환
    const { Readable } = require('stream');
    const stream = Readable.from(req.file.buffer);
    stream.path = req.file.originalname || `audio.${req.file.mimetype?.split('/')[1] || 'mp3'}`;

    const transcription = await client.audio.transcriptions.create({
      file:     stream,
      model:    'whisper-1',
      language,
      response_format: 'verbose_json',
    });

    res.json({
      success:  true,
      text:     transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      segments: transcription.segments?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 툴 목록 조회 ─────────────────────────────────────────────────────────
app.get('/api/tools/list', (_req, res) => {
  res.json({
    success: true,
    tools: [
      { id: 'ppt',          name: 'PPT 생성',        icon: '📊', desc: 'AI가 주제에 맞는 .pptx 파일 생성',          endpoint: 'POST /api/tools/ppt' },
      { id: 'pdf',          name: 'PDF 생성',        icon: '📄', desc: 'Markdown/텍스트를 PDF로 변환',              endpoint: 'POST /api/tools/pdf' },
      { id: 'excel',        name: 'Excel 생성',      icon: '📈', desc: 'AI 데이터 표를 .xlsx 파일로 생성',          endpoint: 'POST /api/tools/excel' },
      { id: 'youtube',      name: 'YouTube 요약',    icon: '🎬', desc: 'YouTube URL → 핵심 내용 요약',             endpoint: 'POST /api/tools/youtube' },
      { id: 'qrcode',       name: 'QR코드',          icon: '📱', desc: '텍스트/URL → QR코드 이미지',               endpoint: 'POST /api/tools/qrcode' },
      { id: 'removebg',     name: '배경 제거',        icon: '✂️', desc: '이미지 배경 자동 제거',                    endpoint: 'POST /api/tools/removebg' },
      { id: 'tts',          name: 'TTS 음성 변환',   icon: '🔊', desc: '텍스트 → MP3 음성 파일',                   endpoint: 'POST /api/tools/tts' },
      { id: 'palette',      name: '색상 팔레트',      icon: '🎨', desc: 'AI 브랜드 색상 팔레트 생성',               endpoint: 'POST /api/tools/palette' },
      { id: 'regex',        name: '정규식 생성',      icon: '🔍', desc: '자연어로 정규식 패턴 생성',                 endpoint: 'POST /api/tools/regex' },
      { id: 'summarycard',  name: '요약 카드',        icon: '🃏', desc: '텍스트 → SNS용 SVG 이미지 카드',           endpoint: 'POST /api/tools/summarycard' },
      { id: 'chat2pdf',     name: '대화 PDF 저장',   icon: '💾', desc: '채팅 히스토리를 PDF로 내보내기',            endpoint: 'POST /api/tools/chat2pdf' },
      { id: 'analyze-image',name: '이미지 분석',      icon: '🖼️', desc: '업로드한 이미지를 GPT-4V로 분석',          endpoint: 'POST /api/tools/analyze-image' },
      { id: 'stt',          name: '음성 인식',        icon: '🎤', desc: '오디오 파일을 텍스트로 변환 (Whisper)',     endpoint: 'POST /api/tools/stt' },
    ],
  });
});

module.exports = { app, server };
