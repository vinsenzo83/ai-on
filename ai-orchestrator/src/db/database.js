'use strict';
/**
 * database.js – SQLite 영속성 레이어
 * better-sqlite3 기반 동기 API + WAL 모드
 * 테이블: users, jobs, costs, pipelines, versions, scheduler_jobs, audit_logs
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'orchestrator.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -32000');   // 32 MB page cache

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    api_key     TEXT UNIQUE,
    last_login  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    queue         TEXT NOT NULL DEFAULT 'ai-task',
    pipeline      TEXT,
    action        TEXT,
    status        TEXT NOT NULL DEFAULT 'waiting',
    priority      INTEGER DEFAULT 0,
    data          TEXT,
    result        TEXT,
    error         TEXT,
    progress      INTEGER DEFAULT 0,
    user_id       TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    completed_at  TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS costs (
    id            TEXT PRIMARY KEY,
    pipeline      TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      REAL DEFAULT 0,
    user_id       TEXT,
    job_id        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pipelines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    nodes       TEXT,
    edges       TEXT,
    config      TEXT,
    status      TEXT DEFAULT 'draft',
    runs        INTEGER DEFAULT 0,
    user_id     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_run    TEXT
  );

  CREATE TABLE IF NOT EXISTS versions (
    id           TEXT PRIMARY KEY,
    pipeline_id  TEXT NOT NULL,
    version      TEXT NOT NULL,
    config       TEXT NOT NULL,
    description  TEXT,
    created_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pipeline_id, version)
  );

  CREATE TABLE IF NOT EXISTS scheduler_jobs (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    cron         TEXT NOT NULL,
    pipeline     TEXT,
    action       TEXT,
    params       TEXT,
    enabled      INTEGER DEFAULT 1,
    last_run     TEXT,
    next_run     TEXT,
    run_count    INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    action     TEXT NOT NULL,
    resource   TEXT,
    details    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── 설정 영속성 테이블 (재시작 후 복원) ──────────────────────
  CREATE TABLE IF NOT EXISTS api_configs (
    provider      TEXT PRIMARY KEY,
    provider_label TEXT,
    api_key_enc   TEXT NOT NULL,
    base_url      TEXT DEFAULT '',
    memo          TEXT DEFAULT '',
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS model_settings (
    setting_key   TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── AI 추론 로그 (실제/fallback 분리 + 조합 성능 누적) ─────────
  CREATE TABLE IF NOT EXISTS inference_log (
    id              TEXT PRIMARY KEY,
    pipeline        TEXT NOT NULL,
    step            INTEGER DEFAULT 0,       -- 멀티스텝 내 순서 (0=단일)
    combo_id        TEXT,                    -- 조합 실행 묶음 ID
    requested_model TEXT,                    -- 요청한 모델
    used_model      TEXT NOT NULL,           -- 실제 사용된 모델
    provider        TEXT NOT NULL,
    is_fallback     INTEGER DEFAULT 0,       -- 1=fallback 발생
    fallback_reason TEXT,                    -- fallback 사유
    fallback_from   TEXT,                    -- fallback 원래 모델
    latency_ms      INTEGER DEFAULT 0,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    cost_usd        REAL DEFAULT 0,
    success         INTEGER DEFAULT 1,       -- 0=에러
    error_code      TEXT,                    -- AIError.code
    user_id         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_infl_pipeline   ON inference_log(pipeline);
  CREATE INDEX IF NOT EXISTS idx_infl_combo      ON inference_log(combo_id);
  CREATE INDEX IF NOT EXISTS idx_infl_provider   ON inference_log(provider);
  CREATE INDEX IF NOT EXISTS idx_infl_fallback   ON inference_log(is_fallback);
  CREATE INDEX IF NOT EXISTS idx_infl_created    ON inference_log(created_at);

  -- ── provider_health 스냅샷 (주기적 상태 기록) ─────────────────
  CREATE TABLE IF NOT EXISTS provider_health (
    id           TEXT PRIMARY KEY,
    provider     TEXT NOT NULL,
    status       TEXT NOT NULL,        -- 'ok' | 'degraded' | 'down'
    latency_ms   INTEGER DEFAULT 0,
    error_code   TEXT,
    error_msg    TEXT,
    checked_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ph_provider ON provider_health(provider);
  CREATE INDEX IF NOT EXISTS idx_ph_checked  ON provider_health(checked_at);

  CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_pipeline    ON jobs(pipeline);
  CREATE INDEX IF NOT EXISTS idx_jobs_created     ON jobs(created_at);
  CREATE INDEX IF NOT EXISTS idx_costs_pipeline   ON costs(pipeline);
  CREATE INDEX IF NOT EXISTS idx_costs_created    ON costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_versions_pipe    ON versions(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs(created_at);
`);

// ── Phase 14: Platform layer schema migration ─────────────────────────────
db.exec(`
  -- ── Memory Engine: Sessions ─────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS mem_sessions (
    session_id  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'anonymous',
    pipeline    TEXT DEFAULT 'unknown',
    turns       TEXT NOT NULL DEFAULT '[]',    -- JSON array
    summary     TEXT,
    turn_count  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ms_user     ON mem_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ms_last     ON mem_sessions(last_used);

  -- ── Memory Engine: Workspaces ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS mem_workspaces (
    user_id     TEXT NOT NULL,
    ws_name     TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT '{}',    -- JSON object (key→value)
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, ws_name)
  );
  CREATE INDEX IF NOT EXISTS idx_mw_user ON mem_workspaces(user_id);

  -- ── Memory Engine: User Profiles ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS mem_user_profiles (
    user_id     TEXT PRIMARY KEY,
    preferences TEXT NOT NULL DEFAULT '{}',    -- JSON
    patterns    TEXT NOT NULL DEFAULT '{}',    -- JSON: taskType → count
    stats       TEXT NOT NULL DEFAULT '{}',    -- JSON: totalSessions, totalTurns, totalCost
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Storage Engine: Asset Index ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS storage_assets (
    asset_id    TEXT PRIMARY KEY,
    asset_type  TEXT NOT NULL DEFAULT 'generated',  -- generated|upload|export
    pipeline    TEXT NOT NULL DEFAULT 'unknown',
    user_id     TEXT NOT NULL DEFAULT 'anonymous',
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes  INTEGER DEFAULT 0,
    checksum    TEXT,
    tags        TEXT DEFAULT '[]',    -- JSON array
    meta        TEXT DEFAULT '{}',    -- JSON: model, provider, taskType, etc.
    local_path  TEXT NOT NULL,
    s3_key      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sa_user      ON storage_assets(user_id);
  CREATE INDEX IF NOT EXISTS idx_sa_pipeline  ON storage_assets(pipeline);
  CREATE INDEX IF NOT EXISTS idx_sa_type      ON storage_assets(asset_type);
  CREATE INDEX IF NOT EXISTS idx_sa_created   ON storage_assets(created_at);
  CREATE INDEX IF NOT EXISTS idx_sa_expires   ON storage_assets(expires_at);

  -- ── Observability Engine: Spans ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS obs_spans (
    span_id        TEXT PRIMARY KEY,
    trace_id       TEXT NOT NULL,
    parent_span_id TEXT,
    name           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ok',   -- ok|error|timeout
    pipeline       TEXT NOT NULL DEFAULT 'unknown',
    user_id        TEXT DEFAULT 'anonymous',
    model          TEXT,
    provider       TEXT,
    task_type      TEXT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    duration_ms    INTEGER DEFAULT 0,
    input_tokens   INTEGER DEFAULT 0,
    output_tokens  INTEGER DEFAULT 0,
    cost_usd       REAL DEFAULT 0,
    is_fallback    INTEGER DEFAULT 0,
    from_cache     INTEGER DEFAULT 0,
    error_code     TEXT,
    tags           TEXT DEFAULT '[]',
    meta           TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_os_trace    ON obs_spans(trace_id);
  CREATE INDEX IF NOT EXISTS idx_os_pipeline ON obs_spans(pipeline);
  CREATE INDEX IF NOT EXISTS idx_os_status   ON obs_spans(status);
  CREATE INDEX IF NOT EXISTS idx_os_started  ON obs_spans(started_at);
  CREATE INDEX IF NOT EXISTS idx_os_provider ON obs_spans(provider);

  -- ── Observability Engine: Events ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS obs_events (
    event_id  TEXT PRIMARY KEY,
    trace_id  TEXT,
    span_id   TEXT,
    name      TEXT NOT NULL,
    level     TEXT NOT NULL DEFAULT 'info',   -- info|warn|error
    pipeline  TEXT DEFAULT 'unknown',
    user_id   TEXT DEFAULT 'anonymous',
    message   TEXT NOT NULL,
    data      TEXT DEFAULT '{}',
    ts        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_oe_trace    ON obs_events(trace_id);
  CREATE INDEX IF NOT EXISTS idx_oe_name     ON obs_events(name);
  CREATE INDEX IF NOT EXISTS idx_oe_level    ON obs_events(level);
  CREATE INDEX IF NOT EXISTS idx_oe_ts       ON obs_events(ts);

  -- ── Analytics Engine: Events ────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS analytics_events (
    event_id    TEXT PRIMARY KEY,
    event_name  TEXT NOT NULL,
    user_id     TEXT DEFAULT 'anonymous',
    session_id  TEXT,
    pipeline    TEXT DEFAULT 'unknown',
    properties  TEXT DEFAULT '{}',   -- JSON
    value       REAL DEFAULT 0,
    ts          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ae_name     ON analytics_events(event_name);
  CREATE INDEX IF NOT EXISTS idx_ae_user     ON analytics_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_ae_pipeline ON analytics_events(pipeline);
  CREATE INDEX IF NOT EXISTS idx_ae_ts       ON analytics_events(ts);

  -- ── Analytics Engine: Aggregation Snapshots ─────────────────────────────
  CREATE TABLE IF NOT EXISTS analytics_agg_snapshots (
    snapshot_key    TEXT PRIMARY KEY,
    snapshot_value  TEXT NOT NULL DEFAULT '{}',
    snapped_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Job Engine: Job Runs ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS job_runs (
    job_id        TEXT PRIMARY KEY,
    queue_name    TEXT NOT NULL DEFAULT 'default',
    status        TEXT NOT NULL DEFAULT 'waiting',  -- waiting|active|completed|failed|cancelled
    priority      INTEGER DEFAULT 3,
    data          TEXT DEFAULT '{}',
    result        TEXT,
    error         TEXT,
    progress      INTEGER DEFAULT 0,
    logs          TEXT DEFAULT '[]',
    attempts      INTEGER DEFAULT 0,
    max_retries   INTEGER DEFAULT 2,
    next_retry_at TEXT,
    user_id       TEXT DEFAULT 'anonymous',
    pipeline      TEXT DEFAULT 'unknown',
    trace_id      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    finished_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jr_status   ON job_runs(status);
  CREATE INDEX IF NOT EXISTS idx_jr_queue    ON job_runs(queue_name);
  CREATE INDEX IF NOT EXISTS idx_jr_user     ON job_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_jr_pipeline ON job_runs(pipeline);
  CREATE INDEX IF NOT EXISTS idx_jr_created  ON job_runs(created_at);
`);

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmt = {
  // users
  userInsert:  db.prepare(`INSERT INTO users (id,username,email,password,role,api_key) VALUES (?,?,?,?,?,?)`),
  userByEmail: db.prepare(`SELECT * FROM users WHERE email=?`),
  userByUser:  db.prepare(`SELECT * FROM users WHERE username=?`),
  userById:    db.prepare(`SELECT * FROM users WHERE id=?`),
  userByKey:   db.prepare(`SELECT * FROM users WHERE api_key=?`),
  userLogin:   db.prepare(`UPDATE users SET last_login=datetime('now'), updated_at=datetime('now') WHERE id=?`),
  userApiKey:  db.prepare(`UPDATE users SET api_key=?, updated_at=datetime('now') WHERE id=?`),
  usersAll:    db.prepare(`SELECT id,username,email,role,last_login,created_at FROM users ORDER BY created_at DESC`),

  // jobs
  jobInsert:  db.prepare(`INSERT INTO jobs (id,queue,pipeline,action,status,priority,data,user_id) VALUES (?,?,?,?,?,?,?,?)`),
  jobById:    db.prepare(`SELECT * FROM jobs WHERE id=?`),
  jobsAll:    db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`),
  jobsByQ:    db.prepare(`SELECT * FROM jobs WHERE queue=? ORDER BY created_at DESC LIMIT ?`),
  jobsByStatus: db.prepare(`SELECT * FROM jobs WHERE status=? ORDER BY created_at DESC`),
  jobUpdate:  db.prepare(`UPDATE jobs SET status=?,progress=?,result=?,error=?,started_at=?,completed_at=? WHERE id=?`),
  jobProgress:db.prepare(`UPDATE jobs SET progress=?,status=? WHERE id=?`),
  jobStats:   db.prepare(`SELECT status, COUNT(*) as count FROM jobs GROUP BY status`),

  // costs
  costInsert: db.prepare(`INSERT INTO costs (id,pipeline,model,input_tokens,output_tokens,cost_usd,user_id,job_id) VALUES (?,?,?,?,?,?,?,?)`),
  costSummary:db.prepare(`SELECT pipeline, SUM(cost_usd) as total, SUM(input_tokens) as inputs, SUM(output_tokens) as outputs, COUNT(*) as calls FROM costs GROUP BY pipeline ORDER BY total DESC`),
  costDaily:  db.prepare(`SELECT date(created_at) as day, SUM(cost_usd) as total, COUNT(*) as calls FROM costs WHERE created_at >= date('now',?) GROUP BY day ORDER BY day`),
  costMonthly:db.prepare(`SELECT strftime('%Y-%m',created_at) as month, SUM(cost_usd) as total, COUNT(*) as calls FROM costs GROUP BY month ORDER BY month DESC LIMIT 12`),
  costTotal:  db.prepare(`SELECT SUM(cost_usd) as total, COUNT(*) as calls, SUM(input_tokens) as inputs, SUM(output_tokens) as outputs FROM costs`),
  costByModel:db.prepare(`SELECT model, SUM(cost_usd) as total, COUNT(*) as calls FROM costs GROUP BY model ORDER BY total DESC`),

  // pipelines
  pipeInsert: db.prepare(`INSERT INTO pipelines (id,name,description,nodes,edges,config,status,user_id) VALUES (?,?,?,?,?,?,?,?)`),
  pipeById:   db.prepare(`SELECT * FROM pipelines WHERE id=?`),
  pipesAll:   db.prepare(`SELECT * FROM pipelines ORDER BY updated_at DESC`),
  pipeUpdate: db.prepare(`UPDATE pipelines SET name=?,description=?,nodes=?,edges=?,config=?,status=?,updated_at=datetime('now') WHERE id=?`),
  pipeRun:    db.prepare(`UPDATE pipelines SET runs=runs+1,last_run=datetime('now'),updated_at=datetime('now') WHERE id=?`),
  pipeDelete: db.prepare(`DELETE FROM pipelines WHERE id=?`),

  // versions
  verInsert:  db.prepare(`INSERT INTO versions (id,pipeline_id,version,config,description,created_by) VALUES (?,?,?,?,?,?)`),
  versByPipe: db.prepare(`SELECT * FROM versions WHERE pipeline_id=? ORDER BY created_at DESC`),
  verById:    db.prepare(`SELECT * FROM versions WHERE id=?`),

  // scheduler
  schedInsert:db.prepare(`INSERT INTO scheduler_jobs (id,name,cron,pipeline,action,params,enabled) VALUES (?,?,?,?,?,?,?)`),
  schedAll:   db.prepare(`SELECT * FROM scheduler_jobs ORDER BY created_at DESC`),
  schedById:  db.prepare(`SELECT * FROM scheduler_jobs WHERE id=?`),
  schedUpdate:db.prepare(`UPDATE scheduler_jobs SET enabled=?,updated_at=datetime('now') WHERE id=?`),
  schedRun:   db.prepare(`UPDATE scheduler_jobs SET last_run=datetime('now'),run_count=run_count+1,updated_at=datetime('now') WHERE id=?`),

  // audit
  auditInsert:  db.prepare(`INSERT INTO audit_logs (id,user_id,action,resource,details,ip) VALUES (?,?,?,?,?,?)`),
  auditAll:     db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`),
  auditByUser:  db.prepare(`SELECT * FROM audit_logs WHERE user_id=? ORDER BY created_at DESC LIMIT ?`),

  // admin – users management
  userUpdateRole:   db.prepare(`UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?`),
  userDelete:       db.prepare(`DELETE FROM users WHERE id=?`),
  userUpdateStatus: db.prepare(`UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?`),
  usersCount:       db.prepare(`SELECT COUNT(*) as count FROM users`),
  usersSearch:      db.prepare(`SELECT id,username,email,role,api_key,last_login,created_at FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 50`),

  // admin – jobs management
  jobDelete:       db.prepare(`DELETE FROM jobs WHERE id=?`),
  jobDeleteByStatus: db.prepare(`DELETE FROM jobs WHERE status=?`),
  jobsRecent:      db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`),
  jobsCount:       db.prepare(`SELECT COUNT(*) as count FROM jobs`),

  // admin – system stats
  statsOverview:   db.prepare(`SELECT
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM jobs) as total_jobs,
    (SELECT COUNT(*) FROM costs) as total_cost_records,
    (SELECT COALESCE(SUM(cost_usd),0) FROM costs) as total_cost_usd,
    (SELECT COUNT(*) FROM pipelines) as total_pipelines,
    (SELECT COUNT(*) FROM audit_logs) as total_audit_logs
  `),
  costHourly: db.prepare(`SELECT strftime('%H:00',created_at) as hour, SUM(cost_usd) as total, COUNT(*) as calls FROM costs WHERE date(created_at)=date('now') GROUP BY hour ORDER BY hour`)
};

// ─── Helper exports ───────────────────────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');

module.exports = {
  db,
  stmt,

  /* ── Users ── */
  createUser(u) {
    stmt.userInsert.run(u.id||uuidv4(), u.username, u.email, u.password, u.role||'user', u.apiKey||null);
    return stmt.userByEmail.get(u.email);
  },
  getUserByEmail: (email) => stmt.userByEmail.get(email),
  getUserByUsername: (username) => stmt.userByUser.get(username),
  getUserById: (id) => stmt.userById.get(id),
  getUserByApiKey: (key) => stmt.userByKey.get(key),
  updateUserLogin: (id) => stmt.userLogin.run(id),
  updateApiKey: (id, key) => stmt.userApiKey.run(key, id),
  getAllUsers: () => stmt.usersAll.all(),

  /* ── Jobs ── */
  createJob(j) {
    const id = j.id || uuidv4();
    stmt.jobInsert.run(id, j.queue||'ai-task', j.pipeline||null, j.action||null,
      'waiting', j.priority||0, JSON.stringify(j.data||{}), j.userId||null);
    return stmt.jobById.get(id);
  },
  getJob: (id) => {
    const j = stmt.jobById.get(id);
    if (j) { try { j.data = JSON.parse(j.data); } catch(e){} try { j.result = JSON.parse(j.result); } catch(e){} }
    return j;
  },
  getJobs(limit=100) {
    return stmt.jobsAll.all(limit).map(j => {
      try { j.data = JSON.parse(j.data); } catch(e){}
      try { j.result = JSON.parse(j.result); } catch(e){}
      return j;
    });
  },
  updateJob(id, updates) {
    const j = stmt.jobById.get(id) || {};
    stmt.jobUpdate.run(
      updates.status   ?? j.status,
      updates.progress ?? j.progress,
      updates.result   ? JSON.stringify(updates.result)   : j.result,
      updates.error    ? String(updates.error)            : j.error,
      updates.startedAt   || j.started_at,
      updates.completedAt || j.completed_at,
      id
    );
  },
  updateJobProgress: (id, progress, status='running') => stmt.jobProgress.run(progress, status, id),
  getJobStats() {
    const rows = stmt.jobStats.all();
    const stats = { waiting:0, running:0, completed:0, failed:0 };
    rows.forEach(r => { stats[r.status] = r.count; });
    return stats;
  },

  /* ── Costs ── */
  recordCost(c) {
    stmt.costInsert.run(uuidv4(), c.pipeline, c.model, c.inputTokens||0, c.outputTokens||0,
      c.costUsd||0, c.userId||null, c.jobId||null);
  },
  getCostSummary: () => stmt.costSummary.all(),
  getCostDaily: (days=30) => stmt.costDaily.all(`-${days} days`),
  getCostMonthly: () => stmt.costMonthly.all(),
  getCostTotal: () => stmt.costTotal.get(),
  getCostByModel: () => stmt.costByModel.all(),

  /* ── Pipelines ── */
  createPipeline(p) {
    const id = p.id || uuidv4();
    stmt.pipeInsert.run(id, p.name, p.description||'', JSON.stringify(p.nodes||[]),
      JSON.stringify(p.edges||[]), JSON.stringify(p.config||{}), p.status||'draft', p.userId||null);
    return stmt.pipeById.get(id);
  },
  getPipeline(id) {
    const p = stmt.pipeById.get(id);
    if (!p) return null;
    try { p.nodes = JSON.parse(p.nodes); } catch(e){}
    try { p.edges = JSON.parse(p.edges); } catch(e){}
    try { p.config = JSON.parse(p.config); } catch(e){}
    return p;
  },
  getAllPipelines() {
    return stmt.pipesAll.all().map(p => {
      try { p.nodes = JSON.parse(p.nodes); } catch(e){}
      try { p.edges = JSON.parse(p.edges); } catch(e){}
      try { p.config = JSON.parse(p.config); } catch(e){}
      return p;
    });
  },
  updatePipeline(id, u) {
    const existing = module.exports.getPipeline(id);
    if (!existing) return null;
    stmt.pipeUpdate.run(
      u.name        || existing.name,
      u.description || existing.description,
      JSON.stringify(u.nodes  || existing.nodes),
      JSON.stringify(u.edges  || existing.edges),
      JSON.stringify(u.config || existing.config),
      u.status      || existing.status,
      id
    );
    return module.exports.getPipeline(id);
  },
  incrementPipelineRuns: (id) => stmt.pipeRun.run(id),
  deletePipeline: (id) => stmt.pipeDelete.run(id),

  /* ── Versions ── */
  createVersion(v) {
    const id = v.id || uuidv4();
    stmt.verInsert.run(id, v.pipelineId, v.version, JSON.stringify(v.config||{}), v.description||'', v.createdBy||null);
    return stmt.verById.get(id);
  },
  getVersions(pipelineId) {
    return stmt.versByPipe.all(pipelineId).map(v => {
      try { v.config = JSON.parse(v.config); } catch(e){}
      return v;
    });
  },

  /* ── Scheduler ── */
  createSchedulerJob(j) {
    const id = j.id || uuidv4();
    stmt.schedInsert.run(id, j.name, j.cron, j.pipeline||null, j.action||null,
      JSON.stringify(j.params||{}), j.enabled!==false?1:0);
    return stmt.schedById.get(id);
  },
  getSchedulerJobs: () => stmt.schedAll.all(),
  updateSchedulerJob: (id, enabled) => stmt.schedUpdate.run(enabled?1:0, id),
  markSchedulerRun: (id) => stmt.schedRun.run(id),

  /* ── Audit ── */
  audit(userId, action, resource, details, ip) {
    stmt.auditInsert.run(uuidv4(), userId||null, action, resource||null,
      typeof details==='object'?JSON.stringify(details):String(details||''), ip||null);
  },
  getAuditLogs(limit=100) {
    return stmt.auditAll.all(limit);
  },
  getAuditByUser(userId, limit=50) {
    return stmt.auditByUser.all(userId, limit);
  },

  /* ── Admin ── */
  getStatsOverview: () => stmt.statsOverview.get(),
  getCostHourly:    () => stmt.costHourly.all(),
  searchUsers: (q) => stmt.usersSearch.all(`%${q}%`, `%${q}%`),
  updateUserRole(id, role) {
    stmt.userUpdateRole.run(role, id);
    return stmt.userById.get(id);
  },
  deleteUser: (id) => stmt.userDelete.run(id),
  deleteJob:  (id) => stmt.jobDelete.run(id),
  clearJobsByStatus: (status) => stmt.jobDeleteByStatus.run(status),
  getRecentJobs(limit=50) {
    return stmt.jobsRecent.all(limit).map(j => {
      try { j.data = JSON.parse(j.data); } catch(e){}
      try { j.result = JSON.parse(j.result); } catch(e){}
      return j;
    });
  },

  /* ── Util ── */
  close: () => db.close(),

  /* ── API Config 영속성 ── */
  saveApiConfig(cfg) {
    db.prepare(`INSERT INTO api_configs (provider, provider_label, api_key_enc, base_url, memo, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(provider) DO UPDATE SET
        provider_label=excluded.provider_label,
        api_key_enc=excluded.api_key_enc,
        base_url=excluded.base_url,
        memo=excluded.memo,
        is_active=1,
        updated_at=datetime('now')`
    ).run(cfg.provider, cfg.providerLabel||cfg.provider, cfg.apiKey, cfg.baseUrl||'', cfg.memo||'');
  },
  deleteApiConfig(provider) {
    db.prepare(`DELETE FROM api_configs WHERE provider=?`).run(provider);
  },
  getAllApiConfigs() {
    return db.prepare(`SELECT * FROM api_configs WHERE is_active=1 ORDER BY provider`).all();
  },
  getApiConfig(provider) {
    return db.prepare(`SELECT * FROM api_configs WHERE provider=?`).get(provider);
  },

  /* ── Model Settings 영속성 (화이트리스트, 우선순위) ── */
  saveModelSetting(key, value) {
    db.prepare(`INSERT INTO model_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value=excluded.setting_value,
        updated_at=datetime('now')`
    ).run(key, typeof value === 'string' ? value : JSON.stringify(value));
  },
  getModelSetting(key) {
    const row = db.prepare(`SELECT setting_value FROM model_settings WHERE setting_key=?`).get(key);
    if (!row) return null;
    try { return JSON.parse(row.setting_value); } catch(e) { return row.setting_value; }
  },
  getAllModelSettings() {
    const rows = db.prepare(`SELECT * FROM model_settings ORDER BY setting_key`).all();
    const result = {};
    rows.forEach(r => {
      try { result[r.setting_key] = JSON.parse(r.setting_value); } catch(e) { result[r.setting_key] = r.setting_value; }
    });
    return result;
  },

  /* ── Inference Log: AI 추론 결과 누적 저장 ── */
  logInference({ id, pipeline, step = 0, comboId, requestedModel, usedModel, provider,
                 isFallback = false, fallbackReason, fallbackFrom,
                 latencyMs = 0, inputTokens = 0, outputTokens = 0, costUsd = 0,
                 success = true, errorCode, errorCategory, userId }) {
    // errorCategory 자동 분류 (errorCode 기반)
    const category = errorCategory || (
      !success ? (
        errorCode === 'AUTH_FAILED'    ? 'auth' :
        errorCode === 'NO_API_KEY'     ? 'config' :
        errorCode === 'MODEL_BLOCKED'  ? 'whitelist' :
        errorCode === 'NO_MODEL'       ? 'config' :
        errorCode === 'MAX_RETRIES'    ? 'network' :
        'unknown'
      ) : null
    );
    db.prepare(`INSERT INTO inference_log
      (id, pipeline, step, combo_id, requested_model, used_model, provider,
       is_fallback, fallback_reason, fallback_from,
       latency_ms, input_tokens, output_tokens, cost_usd,
       success, error_code, error_category, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id || `inf-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      pipeline, step, comboId || null,
      requestedModel || usedModel, usedModel, provider,
      isFallback ? 1 : 0, fallbackReason || null, fallbackFrom || null,
      latencyMs, inputTokens, outputTokens, costUsd,
      success ? 1 : 0, errorCode || null, category || null, userId || null
    );
  },

  /**
   * 조합 성능 통계 조회
   * - comboId별 집계: 총 지연, 총 비용, 스텝 수, fallback 수
   * - provider별 실제/fallback 분리 집계
   */
  getInferenceSummary({ pipeline, fromDate, limit = 100 } = {}) {
    let where = '1=1';
    const params = [];
    if (pipeline) { where += ' AND pipeline=?'; params.push(pipeline); }
    if (fromDate) { where += ' AND created_at>=?'; params.push(fromDate); }

    // 전체 레코드
    const rows = db.prepare(`SELECT * FROM inference_log WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit);

    // provider별 실제/fallback 분리
    const byProvider = {};
    rows.forEach(r => {
      if (!byProvider[r.provider]) byProvider[r.provider] = { real: 0, fallback: 0, totalMs: 0, totalCost: 0, errors: 0 };
      const p = byProvider[r.provider];
      if (r.is_fallback) p.fallback++; else p.real++;
      p.totalMs   += r.latency_ms;
      p.totalCost += r.cost_usd;
      if (!r.success) p.errors++;
    });

    // comboId별 집계
    const byComboDB = {};
    rows.filter(r => r.combo_id).forEach(r => {
      if (!byComboDB[r.combo_id]) byComboDB[r.combo_id] = { steps: 0, totalMs: 0, totalCost: 0, fallbacks: 0, pipeline: r.pipeline };
      const c = byComboDB[r.combo_id];
      c.steps++;
      c.totalMs   += r.latency_ms;
      c.totalCost += r.cost_usd;
      if (r.is_fallback) c.fallbacks++;
    });

    return {
      total: rows.length,
      realSuccess: rows.filter(r => !r.is_fallback && r.success).length,
      fallbackSuccess: rows.filter(r => r.is_fallback && r.success).length,
      errors: rows.filter(r => !r.success).length,
      byProvider,
      combos: Object.entries(byComboDB).map(([id, s]) => ({ comboId: id, ...s })),
      recentRows: rows.slice(0, 20),
    };
  },

  getInferenceStats({ days = 7 } = {}) {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`
      SELECT
        provider,
        SUM(CASE WHEN is_fallback=0 AND success=1 THEN 1 ELSE 0 END) AS real_success,
        SUM(CASE WHEN is_fallback=1 AND success=1 THEN 1 ELSE 0 END) AS fallback_success,
        SUM(CASE WHEN success=0 THEN 1 ELSE 0 END)                   AS errors,
        COUNT(*)                                                       AS total,
        ROUND(AVG(latency_ms),0)                                      AS avg_ms,
        ROUND(SUM(cost_usd),6)                                        AS total_cost
      FROM inference_log
      WHERE created_at >= ?
      GROUP BY provider
      ORDER BY total DESC
    `).all(from);
  },

  /* ── Provider Health: 상태 스냅샷 저장/조회 ── */
  saveProviderHealth({ provider, status, latencyMs = 0, errorCode = null, errorMsg = null }) {
    db.prepare(`INSERT INTO provider_health (id, provider, status, latency_ms, error_code, error_msg)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      `ph-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      provider, status, latencyMs, errorCode || null, errorMsg ? errorMsg.slice(0, 200) : null
    );
  },

  /** 공급자별 최근 상태 + 24h 집계 */
  getProviderHealthDashboard({ hours = 24 } = {}) {
    const from = new Date(Date.now() - hours * 3600000).toISOString();
    // 최근 체크 결과 (공급자별 최신 1건)
    const latest = db.prepare(`
      SELECT ph.provider, ph.status, ph.latency_ms, ph.error_code, ph.error_msg, ph.checked_at
      FROM provider_health ph
      INNER JOIN (
        SELECT provider, MAX(checked_at) AS max_at FROM provider_health GROUP BY provider
      ) t ON ph.provider = t.provider AND ph.checked_at = t.max_at
      ORDER BY ph.provider
    `).all();
    // 24h 가용성 집계
    const uptime = db.prepare(`
      SELECT provider,
        COUNT(*) AS total_checks,
        SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok_count,
        ROUND(AVG(CASE WHEN status='ok' THEN latency_ms END), 0) AS avg_ok_latency
      FROM provider_health
      WHERE checked_at >= ?
      GROUP BY provider
    `).all(from);
    // 24h inference 성능 집계
    const perfFrom = new Date(Date.now() - hours * 3600000).toISOString();
    const perf = db.prepare(`
      SELECT provider,
        COUNT(*) AS calls,
        SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes,
        ROUND(AVG(CASE WHEN success=1 THEN latency_ms END), 0) AS avg_latency,
        ROUND(SUM(cost_usd), 6) AS total_cost,
        SUM(input_tokens + output_tokens) AS total_tokens
      FROM inference_log
      WHERE created_at >= ?
      GROUP BY provider
    `).all(perfFrom);
    return { latest, uptime, perf };
  },

  /** 에러 분류별 집계 (에러 카테고리 분석) */
  getErrorBreakdown({ days = 7 } = {}) {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`
      SELECT
        error_code,
        error_category,
        provider,
        COUNT(*) AS cnt,
        MAX(created_at) AS last_seen
      FROM inference_log
      WHERE success = 0 AND created_at >= ?
      GROUP BY error_code, error_category, provider
      ORDER BY cnt DESC
    `).all(from);
  },

  // ─── 베타 초대 코드 관리 ───────────────────────────────────────
  createInviteCode({ code, email = null, role = 'beta', expiresAt = null, createdBy = null }) {
    const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    db.prepare(`INSERT INTO beta_invites (id,code,email,role,expires_at,created_by) VALUES (?,?,?,?,?,?)`)
      .run(id, code, email || null, role, expiresAt || null, createdBy || null);
    return { id, code, email, role, expiresAt };
  },

  getInviteCode(code) {
    return db.prepare(`SELECT * FROM beta_invites WHERE code=?`).get(code);
  },

  listInviteCodes({ limit = 50 } = {}) {
    return db.prepare(`SELECT * FROM beta_invites ORDER BY created_at DESC LIMIT ?`).all(limit);
  },

  useInviteCode(code, userId) {
    const inv = db.prepare(`SELECT * FROM beta_invites WHERE code=? AND used=0`).get(code);
    if (!inv) return false;
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return false;
    db.prepare(`UPDATE beta_invites SET used=1,used_by=?,used_at=datetime('now') WHERE code=?`).run(userId, code);
    return inv;
  },

  deleteInviteCode(code) {
    db.prepare(`DELETE FROM beta_invites WHERE code=?`).run(code);
  },

  // ─── 사용자 쿼터 관리 ─────────────────────────────────────────
  getOrCreateQuota(userId, plan = 'beta') {
    let q = db.prepare(`SELECT * FROM user_quotas WHERE user_id=?`).get(userId);
    if (!q) {
      const limits = { free: [20,200,1.0], beta: [100,2000,5.0], pro: [500,10000,50.0], admin: [9999,999999,9999.0] };
      const [daily, monthly, cost] = limits[plan] || limits.beta;
      db.prepare(`INSERT INTO user_quotas (user_id,plan,daily_limit,monthly_limit,cost_limit_usd) VALUES (?,?,?,?,?)`)
        .run(userId, plan, daily, monthly, cost);
      q = db.prepare(`SELECT * FROM user_quotas WHERE user_id=?`).get(userId);
    }
    // 날짜가 바뀌면 일일 카운터 리셋
    if (q.reset_date !== new Date().toISOString().slice(0,10)) {
      db.prepare(`UPDATE user_quotas SET used_today=0,cost_today=0.0,reset_date=date('now'),updated_at=datetime('now') WHERE user_id=?`).run(userId);
      q = db.prepare(`SELECT * FROM user_quotas WHERE user_id=?`).get(userId);
    }
    return q;
  },

  incrementQuota(userId, costUsd = 0) {
    this.getOrCreateQuota(userId);
    db.prepare(`UPDATE user_quotas SET used_today=used_today+1,used_month=used_month+1,cost_today=cost_today+?,cost_month=cost_month+?,updated_at=datetime('now') WHERE user_id=?`)
      .run(costUsd, costUsd, userId);
  },

  checkQuota(userId, plan = 'beta') {
    const q = this.getOrCreateQuota(userId, plan);
    const overDaily = q.used_today >= q.daily_limit;
    const overCost  = q.cost_today >= q.cost_limit_usd;
    return { allowed: !overDaily && !overCost, quota: q, overDaily, overCost };
  },

  getQuotaStats({ days = 7 } = {}) {
    return db.prepare(`
      SELECT q.user_id, u.email, u.username, q.plan,
        q.used_today, q.daily_limit, q.used_month, q.monthly_limit,
        q.cost_today, q.cost_month, q.cost_limit_usd, q.reset_date
      FROM user_quotas q LEFT JOIN users u ON q.user_id=u.id
      ORDER BY q.cost_month DESC LIMIT 50
    `).all();
  },

  // ─── 베타 사용자 목록 ─────────────────────────────────────────
  getBetaUsers() {
    return db.prepare(`
      SELECT u.id,u.username,u.email,u.role,u.plan,u.beta_code,u.is_active,u.created_at,
        q.used_today,q.used_month,q.cost_month,q.daily_limit,q.plan as quota_plan
      FROM users u
      LEFT JOIN user_quotas q ON u.id=q.user_id
      WHERE u.plan='beta' OR u.role='beta'
      ORDER BY u.created_at DESC
    `).all();
  },

  updateUserPlan(userId, plan, isActive = 1) {
    db.prepare(`UPDATE users SET plan=?,is_active=?,updated_at=datetime('now') WHERE id=?`).run(plan, isActive, userId);
  },
};

console.log(`[DB] SQLite ready → ${DB_PATH}`);

// ─── 런타임 마이그레이션: error_category 컬럼 추가 ─────────────
try {
  const cols = db.pragma('table_info(inference_log)').map(c => c.name);
  if (!cols.includes('error_category')) {
    db.exec(`ALTER TABLE inference_log ADD COLUMN error_category TEXT`);
    console.log('[DB] inference_log.error_category 컬럼 추가됨');
  }
} catch(e) { /* 이미 존재하면 무시 */ }

// ─── 런타임 마이그레이션: 베타 시스템 테이블 ──────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beta_invites (
      id          TEXT PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      email       TEXT,
      role        TEXT NOT NULL DEFAULT 'beta',
      used        INTEGER DEFAULT 0,
      used_by     TEXT,
      used_at     TEXT,
      expires_at  TEXT,
      created_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_quotas (
      user_id       TEXT PRIMARY KEY,
      plan          TEXT NOT NULL DEFAULT 'beta',
      daily_limit   INTEGER DEFAULT 100,
      monthly_limit INTEGER DEFAULT 2000,
      cost_limit_usd REAL DEFAULT 5.0,
      used_today    INTEGER DEFAULT 0,
      used_month    INTEGER DEFAULT 0,
      cost_today    REAL DEFAULT 0.0,
      cost_month    REAL DEFAULT 0.0,
      reset_date    TEXT DEFAULT (date('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_beta_invites_code ON beta_invites(code);
    CREATE INDEX IF NOT EXISTS idx_beta_invites_email ON beta_invites(email);
  `);

  // users 테이블 beta 컬럼 추가
  const uCols = db.pragma('table_info(users)').map(c => c.name);
  if (!uCols.includes('plan'))       db.exec(`ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'`);
  if (!uCols.includes('beta_code'))  db.exec(`ALTER TABLE users ADD COLUMN beta_code TEXT`);
  if (!uCols.includes('is_active'))  db.exec(`ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1`);
  if (!uCols.includes('invited_by')) db.exec(`ALTER TABLE users ADD COLUMN invited_by TEXT`);
  console.log('[DB] 베타 시스템 테이블 준비됨');
} catch(e) { console.warn('[DB] 베타 테이블 마이그레이션:', e.message); }

// raw db 접근자 (admin inference recent용)
module.exports._raw = db;
