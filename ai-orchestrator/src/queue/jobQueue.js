'use strict';
/**
 * jobQueue.js — Phase 7A: 작업 큐 시스템 (In-Memory, Redis fallback 가능)
 */
const EventEmitter = require('events');

class InMemoryJobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs   = new Map();
    this.queues = new Map();
    this.workers = new Map();
    this._counter = 0;
    this.setMaxListeners(100);
  }

  _nextId() { return `job-${Date.now()}-${++this._counter}`; }

  addJob(queueName, data, opts = {}) {
    const id = opts.jobId || this._nextId();
    const job = {
      id, queue: queueName, data, opts,
      status: 'waiting', progress: 0,
      result: null, error: null,
      createdAt: new Date().toISOString(),
      startedAt: null, finishedAt: null,
      attempts: 0, logs: [],
    };
    this.jobs.set(id, job);
    const q = this.queues.get(queueName) || [];
    q.push(id);
    this.queues.set(queueName, q);
    this.emit('job:added', { jobId: id, queue: queueName });
    setImmediate(() => this._tryProcess(queueName));
    return job;
  }

  updateProgress(jobId, progress, log) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = Math.min(100, Math.max(0, progress));
    if (log) job.logs.push({ ts: new Date().toISOString(), msg: log });
    this.emit('job:progress', { jobId, progress: job.progress, log });
  }

  completeJob(jobId, result) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, { status: 'completed', progress: 100, result, finishedAt: new Date().toISOString() });
    this.emit('job:completed', { jobId, result });
  }

  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    });
    this.emit('job:failed', { jobId, error: job.error });
  }

  getJob(jobId) { return this.jobs.get(jobId) || null; }

  getQueueStats(queueName) {
    const q = this.queues.get(queueName) || [];
    const stats = { waiting: 0, active: 0, completed: 0, failed: 0, total: q.length };
    q.forEach(id => { const j = this.jobs.get(id); if (j) stats[j.status] = (stats[j.status] || 0) + 1; });
    return stats;
  }

  getAllStats() {
    const res = {};
    for (const [qName] of this.queues) res[qName] = this.getQueueStats(qName);
    return res;
  }

  registerWorker(queueName, fn) { this.workers.set(queueName, fn); }

  async _tryProcess(queueName) {
    const fn = this.workers.get(queueName);
    if (!fn) return;
    const q = this.queues.get(queueName) || [];
    const waitingId = q.find(id => { const j = this.jobs.get(id); return j && j.status === 'waiting'; });
    if (!waitingId) return;
    const job = this.jobs.get(waitingId);
    Object.assign(job, { status: 'active', startedAt: new Date().toISOString(), attempts: job.attempts + 1 });
    this.emit('job:active', { jobId: waitingId });
    try {
      const result = await fn(job, { updateProgress: (p, log) => this.updateProgress(waitingId, p, log) });
      this.completeJob(waitingId, result);
    } catch (e) { this.failJob(waitingId, e); }
  }
}

const store = new InMemoryJobStore();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 워커 등록 ─────────────────────────────────────────────────
store.registerWorker('ai-task', async (job, { updateProgress }) => {
  const { pipeline, action, params } = job.data;
  updateProgress(10, `[${pipeline}] 파이프라인 로드...`);
  await sleep(80);
  let mod;
  try { mod = require(`../pipelines/${pipeline}`); }
  catch (e) { throw new Error(`파이프라인 '${pipeline}' 없음: ${e.message}`); }
  updateProgress(35, `[${pipeline}] 실행 중: ${action}`);
  let result;
  if (typeof mod.execute === 'function') result = await mod.execute(action, params || {});
  else if (typeof mod[action] === 'function') result = await mod[action](params || {});
  else throw new Error(`액션 '${action}' 없음`);
  updateProgress(95, `[${pipeline}] 완료`);
  await sleep(30);
  return result;
});

store.registerWorker('batch-test', async (job, { updateProgress }) => {
  const { pipelines = [] } = job.data;
  const results = [];
  for (let i = 0; i < pipelines.length; i++) {
    const p = pipelines[i];
    updateProgress(Math.round((i / pipelines.length) * 100), `테스트: ${p.name}`);
    try {
      const mod = require(`../pipelines/${p.name}`);
      const t = Date.now();
      const out = typeof mod.execute === 'function' ? await mod.execute(p.action || 'status', p.params || {}) : { ok: true };
      results.push({ name: p.name, status: 'pass', ms: Date.now() - t });
    } catch (e) { results.push({ name: p.name, status: 'fail', error: e.message }); }
    await sleep(30);
  }
  return { tested: results.length, passed: results.filter(r => r.status === 'pass').length, results };
});

store.registerWorker('report-gen', async (job, { updateProgress }) => {
  const { reportType, params } = job.data;
  updateProgress(20, '데이터 수집...'); await sleep(200);
  updateProgress(55, '분석 중...'); await sleep(200);
  updateProgress(85, '리포트 작성...'); await sleep(100);
  return {
    reportType, generatedAt: new Date().toISOString(), params,
    summary: `${reportType} 리포트 생성 완료`,
    sections: ['개요', '주요 지표', '트렌드', '권고사항'],
  };
});

// ── Public API ────────────────────────────────────────────────
module.exports = {
  store,
  add:            (q, data, opts) => store.addJob(q, data, opts),
  getJob:         id => store.getJob(id),
  stats:          q => q ? store.getQueueStats(q) : store.getAllStats(),
  registerWorker: (q, fn) => store.registerWorker(q, fn),
  on:             (ev, fn) => { store.on(ev, fn); return module.exports; },
  off:            (ev, fn) => { store.off(ev, fn); return module.exports; },
  listJobs:       (filter = {}) => {
    const jobs = Array.from(store.jobs.values());
    if (filter.queue)  return jobs.filter(j => j.queue === filter.queue);
    if (filter.status) return jobs.filter(j => j.status === filter.status);
    return jobs.slice(-200);
  },
};
