// ============================================================
// MemoryEngine – AI 기억 유지 핵심 엔진
// ============================================================
//
// 문제: LLM은 요청마다 기억을 초기화 → 이전 대화/작업 맥락 없음
//
// 해결 구조 (3계층):
//   L1 WorkingMemory  – 현재 세션 대화 (빠른 접근, RAM)
//   L2 EpisodicMemory – 완료된 작업 이력 (JSON 파일, 영구)
//   L3 SemanticMemory – 사용자 선호/패턴 학습 (JSON 파일, 영구)
//
// 오케스트레이터에 전달되는 컨텍스트 예시:
//   "이전에 카페 홈페이지를 만들었고, 사용자는 미니멀 스타일을 선호함.
//    오늘 요청: 메뉴 페이지 추가"
// ============================================================

const fs   = require('fs');
const path = require('path');

// 저장 경로 (서버 재시작 후에도 유지)
const DATA_DIR  = path.join(__dirname, '../../data');
const EPIS_FILE = path.join(DATA_DIR, 'episodic.json');   // 작업 이력
const SEM_FILE  = path.join(DATA_DIR, 'semantic.json');    // 사용자 프로필

// ── 초기화 ─────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EPIS_FILE)) fs.writeFileSync(EPIS_FILE, JSON.stringify({}));
  if (!fs.existsSync(SEM_FILE))  fs.writeFileSync(SEM_FILE,  JSON.stringify({}));
}
ensureDataDir();

// ── JSON 유틸 ───────────────────────────────────────────────
function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================
// L1: WorkingMemory – 현재 세션 대화 버퍼 (RAM)
// ============================================================
class WorkingMemory {
  constructor(maxTurns = 20) {
    this.sessions = new Map();   // sessionId → turns[]
    this.maxTurns = maxTurns;
  }

  // 대화 턴 추가
  addTurn(sessionId, role, content, meta = {}) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    const turns = this.sessions.get(sessionId);
    turns.push({
      role,            // 'user' | 'assistant' | 'system'
      content,
      meta,            // { taskType, qualityScore, ... }
      ts: Date.now()
    });

    // 최대 턴 수 유지 (오래된 것 제거, 단 system 메시지는 유지)
    const nonSystem = turns.filter(t => t.role !== 'system');
    if (nonSystem.length > this.maxTurns) {
      const systemTurns = turns.filter(t => t.role === 'system');
      const recent = nonSystem.slice(-this.maxTurns);
      this.sessions.set(sessionId, [...systemTurns, ...recent]);
    }
  }

  // 최근 N턴 반환 (LLM 컨텍스트용)
  getRecentTurns(sessionId, n = 10) {
    const turns = this.sessions.get(sessionId) || [];
    return turns.slice(-n).map(t => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      content: t.content
    }));
  }

  // 세션 전체 반환 (UI 표시용)
  getAllTurns(sessionId) {
    return this.sessions.get(sessionId) || [];
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}

// ============================================================
// L2: EpisodicMemory – 완료된 작업 이력 (영구 저장)
// ============================================================
class EpisodicMemory {

  // 작업 완료 시 저장
  saveEpisode(sessionId, episode) {
    const db = readJSON(EPIS_FILE);
    if (!db[sessionId]) db[sessionId] = [];

    db[sessionId].push({
      id:          `ep_${Date.now()}`,
      taskType:    episode.taskType,
      taskInfo:    episode.taskInfo,        // 주제, 업종 등
      summary:     episode.summary,         // 결과 요약 (100자 이내)
      qualityScore: episode.qualityScore,
      ts:          new Date().toISOString(),
      tags:        episode.tags || []
    });

    // 세션당 최대 50개 보관
    if (db[sessionId].length > 50) {
      db[sessionId] = db[sessionId].slice(-50);
    }

    writeJSON(EPIS_FILE, db);
  }

  // 최근 N개 작업 이력 반환
  getRecentEpisodes(sessionId, n = 5) {
    const db = readJSON(EPIS_FILE);
    return (db[sessionId] || []).slice(-n);
  }

  // 같은 taskType의 이전 작업 찾기
  getEpisodesByType(sessionId, taskType, n = 3) {
    const db = readJSON(EPIS_FILE);
    return (db[sessionId] || [])
      .filter(ep => ep.taskType === taskType)
      .slice(-n);
  }

  // 전체 이력 반환 (UI용)
  getAllEpisodes(sessionId) {
    const db = readJSON(EPIS_FILE);
    return (db[sessionId] || []).reverse();  // 최신 순
  }
}

// ============================================================
// L3: SemanticMemory – 사용자 선호/패턴 학습 (영구 저장)
// ============================================================
class SemanticMemory {

  // 작업 완료 시 선호도 업데이트
  updateProfile(sessionId, taskType, taskInfo, qualityScore) {
    const db = readJSON(SEM_FILE);
    if (!db[sessionId]) {
      db[sessionId] = {
        preferredStyles: {},     // 'website' → 'modern'
        preferredTones: {},      // 'blog' → 'casual'
        industries: {},          // 'website' → ['카페', '레스토랑']
        taskCounts: {},          // 'ppt' → 3
        avgQuality: {},          // 'blog' → 87.5
        lastActive: null,
        totalTasks: 0
      };
    }

    const profile = db[sessionId];
    profile.lastActive = new Date().toISOString();
    profile.totalTasks = (profile.totalTasks || 0) + 1;

    // 작업별 카운트
    profile.taskCounts[taskType] = (profile.taskCounts[taskType] || 0) + 1;

    // 스타일 선호도 학습
    if (taskInfo.style) {
      profile.preferredStyles[taskType] = taskInfo.style;
    }
    if (taskInfo.tone) {
      profile.preferredTones[taskType] = taskInfo.tone;
    }

    // 업종/주제 기록
    const key = taskInfo.industry || taskInfo.topic || taskInfo.subject;
    if (key) {
      if (!profile.industries[taskType]) profile.industries[taskType] = [];
      if (!profile.industries[taskType].includes(key)) {
        profile.industries[taskType].push(key);
      }
    }

    // 평균 품질 점수 업데이트
    if (qualityScore) {
      const prev = profile.avgQuality[taskType] || qualityScore;
      const count = profile.taskCounts[taskType];
      profile.avgQuality[taskType] = Math.round((prev * (count - 1) + qualityScore) / count);
    }

    writeJSON(SEM_FILE, db);
  }

  // 사용자 프로필 반환
  getProfile(sessionId) {
    const db = readJSON(SEM_FILE);
    return db[sessionId] || null;
  }

  // 특정 타입에 대한 선호도 반환
  getPreference(sessionId, taskType) {
    const profile = this.getProfile(sessionId);
    if (!profile) return {};
    return {
      style:    profile.preferredStyles?.[taskType],
      tone:     profile.preferredTones?.[taskType],
      pastTopics: profile.industries?.[taskType] || [],
      taskCount:  profile.taskCounts?.[taskType] || 0,
      avgQuality: profile.avgQuality?.[taskType] || null
    };
  }
}

// ============================================================
// MemoryEngine – 3계층 통합 인터페이스
// ============================================================
class MemoryEngine {
  constructor() {
    this.working  = new WorkingMemory(20);
    this.episodic = new EpisodicMemory();
    this.semantic = new SemanticMemory();
  }

  // ── 대화 기록 ───────────────────────────────────────────
  recordTurn(sessionId, role, content, meta = {}) {
    this.working.addTurn(sessionId, role, content, meta);
  }

  // ── 작업 완료 처리 ──────────────────────────────────────
  recordCompletion(sessionId, result) {
    const { taskType, taskInfo, validation, result: res } = result;
    const qualityScore = validation?.score || 0;

    // L2: 에피소드 저장
    const summary = this.buildSummary(taskType, taskInfo, res?.content);
    this.episodic.saveEpisode(sessionId, {
      taskType,
      taskInfo,
      summary,
      qualityScore,
      tags: this.extractTags(taskType, taskInfo)
    });

    // L3: 프로필 업데이트
    this.semantic.updateProfile(sessionId, taskType, taskInfo, qualityScore);

    // L1: 완료 기록
    this.working.addTurn(sessionId, 'system',
      `[완료] ${taskType} 작업 완료. 점수: ${qualityScore}. 요약: ${summary}`,
      { taskType, qualityScore }
    );
  }

  // ── 오케스트레이터용 컨텍스트 생성 ──────────────────────
  buildContext(sessionId, currentTaskType) {
    const recentTurns    = this.working.getRecentTurns(sessionId, 8);
    const recentEpisodes = this.episodic.getRecentEpisodes(sessionId, 3);
    const sameTypeEps    = this.episodic.getEpisodesByType(sessionId, currentTaskType, 2);
    const preference     = this.semantic.getPreference(sessionId, currentTaskType);
    const profile        = this.semantic.getProfile(sessionId);

    return {
      // LLM 메시지 배열에 넣을 대화 히스토리
      conversationHistory: recentTurns,

      // 시스템 프롬프트에 넣을 메모리 요약 텍스트
      memoryPrompt: this.buildMemoryPrompt({
        recentEpisodes,
        sameTypeEps,
        preference,
        profile,
        currentTaskType
      }),

      // 원본 데이터 (디버깅/UI용)
      raw: { recentEpisodes, sameTypeEps, preference, profile }
    };
  }

  // ── LLM에 주입할 메모리 프롬프트 생성 ───────────────────
  buildMemoryPrompt({ recentEpisodes, sameTypeEps, preference, profile, currentTaskType }) {
    const parts = [];

    // 이전 작업 이력
    if (recentEpisodes.length > 0) {
      parts.push('=== 이 사용자의 이전 작업 이력 ===');
      recentEpisodes.forEach(ep => {
        parts.push(`- [${ep.taskType}] ${ep.summary} (품질: ${ep.qualityScore}점, ${formatRelTime(ep.ts)})`);
      });
    }

    // 같은 타입의 이전 작업
    if (sameTypeEps.length > 0) {
      parts.push(`\n=== 이전 ${currentTaskType} 작업 ===`);
      sameTypeEps.forEach(ep => {
        const info = ep.taskInfo;
        parts.push(`- 주제/업종: ${info.topic || info.industry || info.subject || '?'}, ${ep.summary}`);
      });
    }

    // 사용자 선호도
    if (preference && (preference.style || preference.tone || preference.pastTopics?.length > 0)) {
      parts.push('\n=== 이 사용자의 선호도 ===');
      if (preference.style) parts.push(`- 선호 스타일: ${preference.style}`);
      if (preference.tone)  parts.push(`- 선호 톤: ${preference.tone}`);
      if (preference.pastTopics?.length > 0)
        parts.push(`- 관심 분야: ${preference.pastTopics.join(', ')}`);
      if (preference.avgQuality)
        parts.push(`- 평균 품질 기대치: ${preference.avgQuality}점`);
    }

    // 전체 사용 통계
    if (profile?.totalTasks > 1) {
      parts.push(`\n=== 사용 통계 ===`);
      parts.push(`- 총 ${profile.totalTasks}번 사용, 마지막 활동: ${formatRelTime(profile.lastActive)}`);
    }

    if (parts.length === 0) return '';

    return parts.join('\n') + '\n\n위 정보를 참고하여 사용자의 취향과 이전 맥락에 맞게 결과물을 생성하세요.';
  }

  // ── 유틸 ────────────────────────────────────────────────
  buildSummary(taskType, taskInfo, content) {
    const key = taskInfo?.topic || taskInfo?.industry || taskInfo?.subject ||
                taskInfo?.purpose || taskInfo?.position || taskInfo?.description || '';
    const typeNames = {
      ppt: 'PPT', website: '홈페이지', blog: '블로그',
      report: '분석 리포트', code: '코드', email: '이메일', resume: '자기소개서'
    };
    const name = typeNames[taskType] || taskType;
    return `${key} ${name} 생성`.trim().substring(0, 80);
  }

  extractTags(taskType, taskInfo) {
    const tags = [taskType];
    if (taskInfo?.style)    tags.push(taskInfo.style);
    if (taskInfo?.industry) tags.push(taskInfo.industry);
    if (taskInfo?.topic)    tags.push(taskInfo.topic);
    return tags.filter(Boolean);
  }

  // UI용 히스토리 전체 반환
  getHistory(sessionId) {
    return {
      turns:    this.working.getAllTurns(sessionId),
      episodes: this.episodic.getAllEpisodes(sessionId),
      profile:  this.semantic.getProfile(sessionId)
    };
  }
}

// ── 시간 포맷 유틸 ─────────────────────────────────────────
function formatRelTime(isoStr) {
  if (!isoStr) return '?';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return '방금 전';
  if (m < 60)  return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

module.exports = MemoryEngine;
