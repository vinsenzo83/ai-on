// ============================================================
// cacheLayer.js — Phase 6: 결과 캐시 레이어
// ============================================================
// 역할:
//   - web_search, summarize, weather, exchange 등 결과 캐싱
//   - TTL(Time-to-Live) 기반 자동 만료
//   - 캐시 히트/미스 통계 기록
//   - 동일하거나 유사한 요청에 대해 캐시 재활용
// ============================================================

'use strict';

// ─────────────────────────────────────────────────────────────
// § TTL 설정 (ms)
// ─────────────────────────────────────────────────────────────
const TTL = {
  weather:    10 * 60 * 1000,   // 10분
  exchange:   10 * 60 * 1000,   // 10분
  datetime:    5 * 60 * 1000,   //  5분
  search:     45 * 60 * 1000,   // 45분
  news:       30 * 60 * 1000,   // 30분
  summarize:  60 * 60 * 1000,   //  1시간
  analyze:    60 * 60 * 1000,   //  1시간
  default:    30 * 60 * 1000,   // 30분 (기타)
};

// ─────────────────────────────────────────────────────────────
// § 인-메모리 캐시 스토어
//   key → { value, expiresAt, type, hitCount }
// ─────────────────────────────────────────────────────────────
const _store = new Map();

// ─────────────────────────────────────────────────────────────
// § KPI 카운터
// ─────────────────────────────────────────────────────────────
const _stats = {
  hits:     0,
  misses:   0,
  sets:     0,
  evictions: 0,
  byType:   {},   // type → { hits, misses }
};

// ─────────────────────────────────────────────────────────────
// § 공개 API
// ─────────────────────────────────────────────────────────────

/**
 * get(type, key)
 * 캐시에서 값을 가져옴. 만료되었으면 삭제 후 null 반환.
 */
function get(type, key) {
  const cacheKey = _buildKey(type, key);
  const entry    = _store.get(cacheKey);

  if (!entry) {
    _recordMiss(type);
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    _store.delete(cacheKey);
    _stats.evictions++;
    _recordMiss(type);
    return null;
  }

  entry.hitCount++;
  _recordHit(type);
  return entry.value;
}

/**
 * set(type, key, value, customTtlMs?)
 * 캐시에 값을 저장.
 */
function set(type, key, value, customTtlMs = null) {
  if (value === null || value === undefined) return;

  const ttl      = customTtlMs || TTL[type] || TTL.default;
  const cacheKey = _buildKey(type, key);

  _store.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttl,
    type,
    hitCount:  0,
    createdAt: Date.now(),
  });

  _stats.sets++;
  _recordType(type);
}

/**
 * getOrNull(type, key)
 * get() 별칭 — null-safe 버전
 */
function getOrNull(type, key) {
  return get(type, key);
}

/**
 * invalidate(type, key)
 * 특정 캐시 엔트리 강제 삭제
 */
function invalidate(type, key) {
  _store.delete(_buildKey(type, key));
}

/**
 * invalidateByType(type)
 * 특정 타입의 모든 캐시 삭제
 */
function invalidateByType(type) {
  const prefix = `${type}:`;
  for (const key of _store.keys()) {
    if (key.startsWith(prefix)) _store.delete(key);
  }
}

/**
 * clear()
 * 전체 캐시 초기화
 */
function clear() {
  _store.clear();
}

/**
 * getStats()
 * 캐시 히트/미스/크기 통계 반환
 */
function getStats() {
  // 만료 엔트리 정리
  _evictExpired();

  const total = _stats.hits + _stats.misses;
  return {
    size:      _store.size,
    hits:      _stats.hits,
    misses:    _stats.misses,
    sets:      _stats.sets,
    evictions: _stats.evictions,
    hitRate:   total > 0 ? +(_stats.hits / total * 100).toFixed(1) + '%' : '0.0%',
    byType:    { ..._stats.byType },
  };
}

/**
 * wrap(type, key, fn, customTtlMs?)
 * 캐시-or-실행 헬퍼: 캐시 히트 시 즉시 반환, 미스 시 fn() 실행 후 저장
 * @param {string} type  캐시 타입
 * @param {string} key   캐시 키
 * @param {Function} fn  async () => value
 * @param {number?} customTtlMs
 * @returns {Promise<any>}
 */
async function wrap(type, key, fn, customTtlMs = null) {
  const cached = get(type, key);
  if (cached !== null) return cached;

  const result = await fn();
  if (result !== null && result !== undefined) {
    set(type, key, result, customTtlMs);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// § 내부 헬퍼
// ─────────────────────────────────────────────────────────────

function _buildKey(type, key) {
  // 키를 소문자+공백정규화해서 유사 쿼리도 히트 가능하게
  const normalized = String(key).toLowerCase().replace(/\s+/g, ' ').trim();
  return `${type}:${normalized}`;
}

function _recordHit(type) {
  _stats.hits++;
  if (!_stats.byType[type]) _stats.byType[type] = { hits: 0, misses: 0 };
  _stats.byType[type].hits++;
  if (process.env.CACHE_DEBUG === 'true') {
    console.log(`[Cache] HIT  type=${type}`);
  }
}

function _recordMiss(type) {
  _stats.misses++;
  if (!_stats.byType[type]) _stats.byType[type] = { hits: 0, misses: 0 };
  _stats.byType[type].misses++;
  if (process.env.CACHE_DEBUG === 'true') {
    console.log(`[Cache] MISS type=${type}`);
  }
}

function _recordType(type) {
  if (!_stats.byType[type]) _stats.byType[type] = { hits: 0, misses: 0 };
}

function _evictExpired() {
  const now = Date.now();
  for (const [key, entry] of _store.entries()) {
    if (now > entry.expiresAt) {
      _store.delete(key);
      _stats.evictions++;
    }
  }
}

// 10분마다 만료 엔트리 자동 정리
setInterval(_evictExpired, 10 * 60 * 1000);

// ─────────────────────────────────────────────────────────────
// § exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  TTL,
  get,
  set,
  getOrNull,
  invalidate,
  invalidateByType,
  clear,
  getStats,
  wrap,
};
