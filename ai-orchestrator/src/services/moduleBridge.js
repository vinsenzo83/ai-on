/**
 * moduleBridge.js
 * Node.js ↔ Python FastAPI AI 모듈 브릿지 (v2)
 *
 * Python FastAPI AI Module Server (포트 8000)과 HTTP로 통신
 * 
 * 엔드포인트:
 *   GET  /health
 *   POST /api/workflow/run    (통합 라우터)
 *   POST /api/module/summarize
 *   POST /api/module/translate
 *   POST /api/module/analysis
 *   POST /api/module/extract
 *   POST /api/module/classify
 *   POST /api/module/code
 *   POST /api/module/document
 *
 * taskType 매핑:
 *   summarize/summarise → /api/module/summarize
 *   translate/translation → /api/module/translate
 *   analysis/analyze/report → /api/module/analysis
 *   extract → /api/module/extract
 *   classify → /api/module/classify
 *   code/codegen → /api/module/code
 *   document/ppt/blog/website → /api/module/document
 */

'use strict';

const PYTHON_API_BASE = process.env.PYTHON_API_BASE || 'http://127.0.0.1:8000';
const BRIDGE_TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT_MS || '30000');

// taskType → 모듈 엔드포인트 매핑
const TASK_MODULE_MAP = {
  summarize:   '/api/module/summarize',
  summarise:   '/api/module/summarize',
  translate:   '/api/module/translate',
  translation: '/api/module/translate',
  analysis:    '/api/module/analysis',
  analyse:     '/api/module/analysis',
  analyze:     '/api/module/analysis',
  extract:     '/api/module/extract',
  extraction:  '/api/module/extract',
  classify:    '/api/module/classify',
  classification: '/api/module/classify',
  code:        '/api/module/code',
  codegen:     '/api/module/code',
  document:    '/api/module/document',
  report:      '/api/module/document',
  ppt:         '/api/module/document',
  blog:        '/api/module/document',
  website:     '/api/module/document',
  doc:         '/api/module/document',
};

let _available = null;
let _lastCheck = 0;
const CACHE_TTL = 30000; // 30초

/**
 * Python FastAPI 서비스 가용 여부 확인
 */
async function isAvailable() {
  const now = Date.now();
  if (_available !== null && (now - _lastCheck) < CACHE_TTL) {
    return _available;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${PYTHON_API_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    _available = res.ok && data.status === 'ok';
    _lastCheck = now;
  } catch {
    _available = false;
    _lastCheck = now;
  }
  return _available;
}

/**
 * Python 모듈 시스템 호출
 * @param {string} taskType  - summarize / translate / analysis / etc.
 * @param {string} text      - 입력 텍스트
 * @param {object} extra     - 추가 파라미터 (target_lang, style, etc.)
 * @returns {object|null}    - { success, output, module, ms } 또는 null(실패)
 */
async function callModule(taskType, text, extra = {}) {
  const endpoint = TASK_MODULE_MAP[taskType];
  if (!endpoint) return null;

  // Python 서비스 가용 확인
  const available = await isAvailable();
  if (!available) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);

    const body = { text, message: text, ...extra };
    const res = await fetch(`${PYTHON_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.success) return null;

    // 결과에서 텍스트 출력 추출
    const result = data.result || {};
    const output = result.summary || result.translated_text || result.analysis ||
                   result.document || result.code_output ||
                   (result.extracted ? JSON.stringify(result.extracted, null, 2) : null) ||
                   (result.classification ? JSON.stringify(result.classification, null, 2) : null) ||
                   JSON.stringify(result, null, 2);

    return {
      success:   true,
      output:    output,
      raw:       result,
      module:    data.module || taskType,
      ms:        data.ms || 0,
    };
  } catch (err) {
    console.error('[moduleBridge] callModule error:', err.message);
    return null;
  }
}

/**
 * 통합 워크플로우 실행 (taskType 자동 라우팅)
 */
async function runWorkflow(taskType, message, params = {}) {
  const available = await isAvailable();
  if (!available) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);

    const res = await fetch(`${PYTHON_API_BASE}/api/workflow/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_type: taskType, message, params }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;

    const result = data.result || {};
    const output = result.summary || result.translated_text || result.analysis ||
                   result.document || result.code_output ||
                   JSON.stringify(result, null, 2);

    return {
      success: true,
      output,
      raw: result,
      module: data.module || taskType,
      ms: data.ms || 0,
    };
  } catch (err) {
    console.error('[moduleBridge] runWorkflow error:', err.message);
    return null;
  }
}

/**
 * 지원 taskType 목록 반환
 */
function getSupportedTaskTypes() {
  return Object.keys(TASK_MODULE_MAP);
}

module.exports = {
  isAvailable,
  callModule,
  runWorkflow,
  getSupportedTaskTypes,
  TASK_MODULE_MAP,
};
