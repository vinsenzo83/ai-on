'use strict';
/**
 * storageEngine.js — Platform Layer: Generated Asset & File Persistence
 * ======================================================================
 * Phase 14 platform extension. Frozen engine core (aiConnector) untouched.
 *
 * Manages three asset classes:
 *   GENERATED  – LLM-produced text/JSON/markdown outputs (immutable once saved)
 *   UPLOAD     – user-supplied files (images, documents, CSV)
 *   EXPORT     – formatted deliverables (PDF-ready, CSV, JSONL dataset)
 *
 * Storage backends (pluggable via STORAGE_BACKEND env):
 *   local  (default) – filesystem under data/assets/  (works on VPS without S3)
 *   s3              – AWS S3 (provide S3_BUCKET, AWS_REGION, AWS_* creds)
 *
 * Admin API surface (exported):
 *   saveAsset(meta, content)                → assetRecord
 *   getAsset(assetId)                       → { meta, content }
 *   listAssets(filter)                      → assetRecord[]
 *   deleteAsset(assetId)                    → boolean
 *   getAssetUrl(assetId)                    → string (local path or presigned S3 URL)
 *   stats()
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ── Config ────────────────────────────────────────────────────────────────
const STORAGE_BACKEND  = process.env.STORAGE_BACKEND || 'local';
const LOCAL_ROOT       = path.join(__dirname, '../../data/assets');
const MAX_ASSET_SIZE   = parseInt(process.env.MAX_ASSET_SIZE_MB || '50', 10) * 1024 * 1024;
const RETENTION_DAYS   = parseInt(process.env.ASSET_RETENTION_DAYS || '90', 10);

// Asset type → subdirectory
const TYPE_DIRS = {
  generated: 'generated',
  upload:    'uploads',
  export:    'exports',
};

// ── DB (lazy) ─────────────────────────────────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) { try { _db = require('../db/database'); } catch (_) {} }
  return _db;
}

// ── In-memory index (hot cache for asset metadata) ────────────────────────
const _index = new Map();   // assetId → AssetRecord (without content)
let _totalSaved = 0;
let _totalBytes = 0;

// ── AssetRecord schema ────────────────────────────────────────────────────
/*
  AssetRecord {
    assetId:   uuid,
    type:      'generated' | 'upload' | 'export',
    pipeline:  string,
    userId:    string,
    filename:  string,
    mimeType:  string,
    sizeBytes: number,
    checksum:  sha256 hex,
    tags:      string[],
    meta:      { model?, provider?, taskType?, ... },
    localPath: string,       (relative to LOCAL_ROOT)
    s3Key:     string|null,
    createdAt: ISO string,
    expiresAt: ISO string|null,
  }
*/

// ── Bootstrap ─────────────────────────────────────────────────────────────
function _ensureDirs() {
  for (const sub of Object.values(TYPE_DIRS)) {
    const dir = path.join(LOCAL_ROOT, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function _loadIndex() {
  const db = _getDb();
  if (!db?.db) return;
  try {
    const rows = db.db.prepare(`SELECT * FROM storage_assets ORDER BY created_at DESC LIMIT 10000`).all();
    for (const r of rows) {
      _index.set(r.asset_id, {
        assetId:   r.asset_id,
        type:      r.asset_type,
        pipeline:  r.pipeline,
        userId:    r.user_id,
        filename:  r.filename,
        mimeType:  r.mime_type,
        sizeBytes: r.size_bytes,
        checksum:  r.checksum,
        tags:      _safeJson(r.tags, []),
        meta:      _safeJson(r.meta, {}),
        localPath: r.local_path,
        s3Key:     r.s3_key,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      });
      _totalBytes += r.size_bytes || 0;
    }
    _totalSaved = _index.size;
    console.log(`[StorageEngine] Index loaded: ${_index.size} assets (${(_totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    console.warn('[StorageEngine] Index load error:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _safeJson(str, fallback) {
  if (str && typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function _checksum(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function _mimeFromExt(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.jsonl': 'application/x-ndjson', '.csv': 'text/csv', '.html': 'text/html',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function _expiresAt(days) {
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ── Core: Save ─────────────────────────────────────────────────────────────
/**
 * Save an asset to storage.
 * @param {object} meta  { type, pipeline, userId, filename, tags?, meta?, retentionDays? }
 * @param {string|Buffer} content
 * @returns {AssetRecord}
 */
async function saveAsset(meta, content) {
  _ensureDirs();

  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (buf.length > MAX_ASSET_SIZE) {
    throw new Error(`Asset too large: ${buf.length} bytes (max ${MAX_ASSET_SIZE})`);
  }

  const assetId   = uuidv4();
  const type      = meta.type || 'generated';
  const subDir    = TYPE_DIRS[type] || 'generated';
  const safeFile  = (meta.filename || `asset-${assetId}.txt`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const localPath = path.join(subDir, `${assetId}_${safeFile}`);
  const fullPath  = path.join(LOCAL_ROOT, localPath);

  // Write to disk
  fs.writeFileSync(fullPath, buf);

  const record = {
    assetId,
    type,
    pipeline:  meta.pipeline  || 'unknown',
    userId:    meta.userId    || 'anonymous',
    filename:  safeFile,
    mimeType:  meta.mimeType  || _mimeFromExt(safeFile),
    sizeBytes: buf.length,
    checksum:  _checksum(buf),
    tags:      Array.isArray(meta.tags) ? meta.tags : [],
    meta:      meta.meta || {},
    localPath,
    s3Key:     null,
    createdAt: new Date().toISOString(),
    expiresAt: _expiresAt(meta.retentionDays ?? RETENTION_DAYS),
  };

  // Upload to S3 if configured
  if (STORAGE_BACKEND === 's3') {
    record.s3Key = await _uploadToS3(localPath, buf, record.mimeType);
  }

  // Persist to DB
  const db = _getDb();
  if (db?.db) {
    try {
      db.db.prepare(`
        INSERT INTO storage_assets
          (asset_id, asset_type, pipeline, user_id, filename, mime_type,
           size_bytes, checksum, tags, meta, local_path, s3_key, created_at, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        record.assetId, record.type, record.pipeline, record.userId,
        record.filename, record.mimeType, record.sizeBytes, record.checksum,
        JSON.stringify(record.tags), JSON.stringify(record.meta),
        record.localPath, record.s3Key, record.createdAt, record.expiresAt
      );
    } catch (e) {
      console.warn('[StorageEngine] DB insert error:', e.message);
    }
  }

  // Update in-memory index
  _index.set(assetId, record);
  _totalSaved++;
  _totalBytes += buf.length;

  return record;
}

// ── Core: Get ─────────────────────────────────────────────────────────────
/**
 * Get asset record + content.
 * @param {string} assetId
 * @returns {{ meta: AssetRecord, content: Buffer }} | null
 */
function getAsset(assetId) {
  const rec = _index.get(assetId);
  if (!rec) {
    // Try DB fallback
    const db = _getDb();
    if (!db?.db) return null;
    const row = db.db.prepare(`SELECT * FROM storage_assets WHERE asset_id=?`).get(assetId);
    if (!row) return null;
    const rebuilt = {
      assetId: row.asset_id, type: row.asset_type, pipeline: row.pipeline,
      userId: row.user_id, filename: row.filename, mimeType: row.mime_type,
      sizeBytes: row.size_bytes, checksum: row.checksum,
      tags: _safeJson(row.tags, []), meta: _safeJson(row.meta, {}),
      localPath: row.local_path, s3Key: row.s3_key,
      createdAt: row.created_at, expiresAt: row.expires_at,
    };
    _index.set(assetId, rebuilt);
    return { meta: rebuilt, content: _readContent(rebuilt) };
  }
  return { meta: rec, content: _readContent(rec) };
}

function _readContent(rec) {
  const fullPath = path.join(LOCAL_ROOT, rec.localPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

// ── Core: List ────────────────────────────────────────────────────────────
/**
 * List assets with optional filter.
 * @param {object} filter  { userId?, pipeline?, type?, tag?, limit? }
 */
function listAssets(filter = {}) {
  let results = [..._index.values()];

  if (filter.userId)   results = results.filter(r => r.userId   === filter.userId);
  if (filter.pipeline) results = results.filter(r => r.pipeline === filter.pipeline);
  if (filter.type)     results = results.filter(r => r.type     === filter.type);
  if (filter.tag)      results = results.filter(r => r.tags.includes(filter.tag));

  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results.slice(0, filter.limit || 100);
}

// ── Core: Delete ──────────────────────────────────────────────────────────
function deleteAsset(assetId) {
  const rec = _index.get(assetId);
  if (!rec) return false;

  // Remove file
  const fullPath = path.join(LOCAL_ROOT, rec.localPath);
  if (fs.existsSync(fullPath)) {
    try { fs.unlinkSync(fullPath); } catch (e) { console.warn('[StorageEngine] Unlink error:', e.message); }
  }

  // Remove from DB
  const db = _getDb();
  if (db?.db) {
    try { db.db.prepare(`DELETE FROM storage_assets WHERE asset_id=?`).run(assetId); } catch (_) {}
  }

  _totalBytes -= rec.sizeBytes || 0;
  _index.delete(assetId);
  return true;
}

// ── URL ───────────────────────────────────────────────────────────────────
/**
 * Returns a URL that can be served to a client.
 * For local backend: /api/assets/<assetId> (served by server.js static handler)
 * For S3: presigned URL (requires AWS SDK)
 */
function getAssetUrl(assetId) {
  const rec = _index.get(assetId);
  if (!rec) return null;
  if (rec.s3Key) return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${rec.s3Key}`;
  return `/api/assets/${assetId}`;
}

// ── S3 stub (extend when needed) ──────────────────────────────────────────
async function _uploadToS3(localPath, buf, mimeType) {
  // Requires: npm install @aws-sdk/client-s3
  // Implement when S3_BUCKET env is set
  console.warn('[StorageEngine] S3 upload stub — set STORAGE_BACKEND=local or implement S3 SDK');
  return null;
}

// ── Expiry cleanup (runs every hour) ─────────────────────────────────────
function _runExpiry() {
  const now = new Date().toISOString();
  const db  = _getDb();
  let removed = 0;
  for (const [id, rec] of _index) {
    if (rec.expiresAt && rec.expiresAt < now) {
      deleteAsset(id);
      removed++;
    }
  }
  if (removed > 0) console.log(`[StorageEngine] Expired ${removed} assets`);
}
setInterval(_runExpiry, 60 * 60 * 1000);

// ── Stats ──────────────────────────────────────────────────────────────────
function stats() {
  const byType = {};
  for (const r of _index.values()) {
    byType[r.type] = byType[r.type] || { count: 0, bytes: 0 };
    byType[r.type].count++;
    byType[r.type].bytes += r.sizeBytes || 0;
  }
  return {
    backend:    STORAGE_BACKEND,
    totalAssets: _index.size,
    totalBytes:  _totalBytes,
    totalSaved:  _totalSaved,
    byType,
    retentionDays:  RETENTION_DAYS,
    maxAssetSizeMb: MAX_ASSET_SIZE / 1024 / 1024,
    localRoot:      LOCAL_ROOT,
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
setImmediate(() => {
  _ensureDirs();
  _loadIndex();
});

module.exports = {
  saveAsset,
  getAsset,
  listAssets,
  deleteAsset,
  getAssetUrl,
  stats,
};
