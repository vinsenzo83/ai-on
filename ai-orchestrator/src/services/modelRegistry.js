'use strict';
/**
 * modelRegistry.js — 3-Layer 모델 관리 시스템
 *
 * Layer 1: 공급자 API 키 등록 (admin apiconfig store)
 * Layer 2: 모델 화이트리스트 — 공급자별 허용 모델 ON/OFF
 * Layer 3: 태스크별 모델 우선순위 — 실제 파이프라인 모델 결정
 *
 * 이 모듈은 admin.js(쓰기)와 aiConnector.js(읽기)가 공유하는
 * 런타임 싱글턴 스토어입니다.
 */

const { MODEL_REGISTRY } = require('../types/index.js');

// ─────────────────────────────────────────────────────────────
// Layer 2: 화이트리스트 스토어
// key = model id (e.g. 'gpt-5.2'), value = { enabled, budgetUsd }
// ─────────────────────────────────────────────────────────────
const _whitelist = (() => {
  const store = {};
  Object.values(MODEL_REGISTRY).forEach(m => {
    store[m.id] = {
      modelId:  m.id,
      provider: m.provider,
      tier:     m.tier,
      enabled:  m.available === true,   // 초기값: MODEL_REGISTRY.available 따름
      budgetUsd: null,                   // null = 무제한
      notes:    '',
    };
  });
  // P5: xAI grok-3-mini/grok-3 완전 비활성화 (크레딧 없음/403)
  const XAI_DISABLED = ['grok-3-mini', 'grok-3', 'grok-beta'];
  XAI_DISABLED.forEach(id => {
    if (store[id]) {
      store[id].enabled = false;
      store[id].notes = 'P5: xAI 크레딧 없음 (403) — 완전 비활성화';
    }
  });
  return store;
})();

// ─────────────────────────────────────────────────────────────
// Layer 3: 태스크별 우선순위 스토어 (실제 모델 기본값)
// ─────────────────────────────────────────────────────────────
const _priority = {
  text:     process.env.DEFAULT_TEXT_MODEL     || 'gpt-4o',
  analysis: process.env.DEFAULT_ANALYSIS_MODEL || 'gpt-4o',
  chat:     process.env.DEFAULT_CHAT_MODEL     || 'gpt-4o-mini',
  code:     process.env.DEFAULT_CODE_MODEL     || 'gpt-4o',
  creative: process.env.DEFAULT_CREATIVE_MODEL || 'gpt-4o',
  fast:     process.env.DEFAULT_FAST_MODEL     || 'gpt-4o-mini',
};

// ─────────────────────────────────────────────────────────────
// 공급자 활성 상태 캐시 (Layer 1 연동용 — admin.js에서 업데이트)
// ─────────────────────────────────────────────────────────────
const _activeProviders = new Set();

// ─────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────

/** 전체 화이트리스트 반환 */
function getWhitelist() {
  return Object.values(_whitelist);
}

/** 공급자별 화이트리스트 반환 */
function getWhitelistByProvider(provider) {
  return Object.values(_whitelist).filter(m => m.provider === provider);
}

/** 모델 활성화/비활성화 토글 */
function setModelEnabled(modelId, enabled) {
  if (!_whitelist[modelId]) return false;
  _whitelist[modelId].enabled = !!enabled;
  return true;
}

/** 모델별 월간 예산 설정 (USD, null = 무제한) */
function setModelBudget(modelId, budgetUsd) {
  if (!_whitelist[modelId]) return false;
  _whitelist[modelId].budgetUsd = budgetUsd === null ? null : Number(budgetUsd);
  return true;
}

/** 공급자 전체 활성화/비활성화 */
function setProviderEnabled(provider, enabled) {
  let changed = 0;
  Object.values(_whitelist).forEach(m => {
    if (m.provider === provider) {
      // 공급자 비활성화 시 모든 모델 비활성화
      // 공급자 활성화 시 MODEL_REGISTRY.available=true인 모델만 복원
      m.enabled = enabled ? true : false;
      changed++;
    }
  });
  if (enabled) _activeProviders.add(provider);
  else _activeProviders.delete(provider);
  return changed;
}

/** 활성 공급자 등록 (admin apiconfig POST 시 호출) */
function activateProvider(provider) {
  _activeProviders.add(provider);
  // 해당 공급자의 모든 모델을 활성화
  // (available:false는 프록시 미지원 등 기술적 제약이었으나, 운영자가 API 키를 직접 등록하면 사용 가능)
  Object.values(_whitelist).forEach(m => {
    if (m.provider === provider) m.enabled = true;
  });
}

/** 공급자 비활성화 (admin apiconfig DELETE 시 호출) */
function deactivateProvider(provider) {
  _activeProviders.delete(provider);
  Object.values(_whitelist).forEach(m => {
    if (m.provider === provider) m.enabled = false;
  });
}

/** 공급자가 활성 상태인지 확인 */
function isProviderActive(provider) {
  return _activeProviders.has(provider);
}

/** 특정 모델이 사용 가능한지 확인 (화이트리스트 + 공급자 활성) */
function isModelAllowed(modelId) {
  const entry = _whitelist[modelId];
  if (!entry) return false;
  if (!entry.enabled) return false;
  // 공급자가 등록되어 있어야 함 (환경변수로 초기 로드된 경우 포함)
  return true;
}

/** 태스크에 맞는 실제 사용 모델 ID 반환 (Layer 3) */
function getModelForTask(task) {
  const preferred = _priority[task] || _priority.fast;
  // 우선순위 모델이 허용 상태이면 그대로 사용
  if (isModelAllowed(preferred)) return preferred;
  // 아니면 동일 공급자에서 enabled된 모델 중 tier 순으로 대체
  const entry = _whitelist[preferred];
  const provider = entry?.provider;
  if (provider) {
    const fallbacks = Object.values(_whitelist)
      .filter(m => m.provider === provider && m.enabled)
      .sort((a, b) => {
        const TIER_ORDER = { flagship:0, specialized:1, standard:2, mini:3, nano:4, economy:5, open:6 };
        return (TIER_ORDER[a.tier]||9) - (TIER_ORDER[b.tier]||9);
      });
    if (fallbacks.length) return fallbacks[0].modelId;
  }
  // 전체 enabled 모델 중 비용이 가장 낮은 것으로 최후 fallback
  const cheapest = Object.values(_whitelist)
    .filter(m => m.enabled)
    .map(m => ({ ...m, cost: Object.values(MODEL_REGISTRY).find(r => r.id === m.modelId)?.costPer1kTokens || 999 }))
    .sort((a, b) => a.cost - b.cost)[0];
  return cheapest?.modelId || preferred;
}

/** 우선순위 전체 반환 */
function getPriority() {
  return { ..._priority };
}

/** 우선순위 업데이트 */
function updatePriority(updates) {
  const allowed = ['text','analysis','chat','code','creative','fast'];
  allowed.forEach(k => {
    if (updates[k]) _priority[k] = updates[k];
  });
  return { ..._priority };
}

/** 화이트리스트 일괄 업데이트 (어드민 저장 시) */
function bulkUpdateWhitelist(items) {
  // items: [{ modelId, enabled, budgetUsd, notes }]
  let updated = 0;
  items.forEach(item => {
    if (_whitelist[item.modelId]) {
      if (item.enabled !== undefined) _whitelist[item.modelId].enabled = !!item.enabled;
      if (item.budgetUsd !== undefined) _whitelist[item.modelId].budgetUsd = item.budgetUsd === null ? null : Number(item.budgetUsd);
      if (item.notes !== undefined) _whitelist[item.modelId].notes = item.notes || '';
      updated++;
    }
  });
  return updated;
}

/** 활성화된 모델 목록 (사용 가능한 것만) */
function getEnabledModels() {
  return Object.values(_whitelist).filter(m => m.enabled);
}

/** 공급자별 활성 모델 수 통계 */
function getStats() {
  const stats = {};
  Object.values(_whitelist).forEach(m => {
    if (!stats[m.provider]) stats[m.provider] = { total: 0, enabled: 0 };
    stats[m.provider].total++;
    if (m.enabled) stats[m.provider].enabled++;
  });
  return stats;
}

/** 화이트리스트 스냅샷 (DB 저장용 — enabled/budget 오버라이드만) */
function getWhitelistSnapshot() {
  const snapshot = {};
  Object.entries(_whitelist).forEach(([modelId, m]) => {
    // 기본값과 다른 것만 저장 (용량 절약)
    if (!m.enabled || m.budgetUsd !== null) {
      snapshot[modelId] = { enabled: m.enabled, budgetUsd: m.budgetUsd };
    }
  });
  return snapshot;
}

/** DB 스냅샷에서 화이트리스트 복원 (재시작 후 호출) */
function loadFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  let restored = 0;
  Object.entries(snapshot).forEach(([modelId, overrides]) => {
    if (_whitelist[modelId]) {
      if (overrides.enabled !== undefined) _whitelist[modelId].enabled = !!overrides.enabled;
      if (overrides.budgetUsd !== undefined) _whitelist[modelId].budgetUsd = overrides.budgetUsd === null ? null : Number(overrides.budgetUsd);
      restored++;
    }
  });
  return restored;
}

module.exports = {
  getWhitelist,
  getWhitelistByProvider,
  setModelEnabled,
  setModelBudget,
  setProviderEnabled,
  activateProvider,
  deactivateProvider,
  isProviderActive,
  isModelAllowed,
  getModelForTask,
  getPriority,
  updatePriority,
  bulkUpdateWhitelist,
  getEnabledModels,
  getStats,
  getWhitelistSnapshot,
  loadFromSnapshot,
};
