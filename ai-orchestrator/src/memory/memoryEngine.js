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
const DATA_DIR   = path.join(__dirname, '../../data');
const EPIS_FILE  = path.join(DATA_DIR, 'episodic.json');   // 작업 이력
const SEM_FILE   = path.join(DATA_DIR, 'semantic.json');   // 사용자 프로필
const FACTS_FILE = path.join(DATA_DIR, 'facts.json');      // L3 사용자 선언 사실
const SUMM_FILE  = path.join(DATA_DIR, 'summaries.json'); // L2 대화 요약

// ── 초기화 ─────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EPIS_FILE))  fs.writeFileSync(EPIS_FILE,  JSON.stringify({}));
  if (!fs.existsSync(SEM_FILE))   fs.writeFileSync(SEM_FILE,   JSON.stringify({}));
  if (!fs.existsSync(FACTS_FILE)) fs.writeFileSync(FACTS_FILE, JSON.stringify({}));
  if (!fs.existsSync(SUMM_FILE))  fs.writeFileSync(SUMM_FILE,  JSON.stringify({}));
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
// L4: UserFacts – 사용자 선언 사실 ("나는 ~야", "~를 개발 중") 영구 저장
// ============================================================
class UserFacts {

  // 새로운 사실 추가/업데이트
  addFact(sessionId, factText, category = 'general') {
    const db = readJSON(FACTS_FILE);
    if (!db[sessionId]) db[sessionId] = [];

    // 중복 제거 (동일한 factText는 저장하지 않음)
    const exists = db[sessionId].some(f => f.fact === factText);
    if (!exists) {
      db[sessionId].push({
        fact:     factText,
        category, // 'project' | 'preference' | 'identity' | 'general'
        ts:       new Date().toISOString()
      });
      // 세션당 최대 50개 보관 (STEP 8: limit 50)
      if (db[sessionId].length > 50) {
        const priority = db[sessionId].filter(f => ['project','identity','tech'].includes(f.category));
        const other    = db[sessionId].filter(f => !['project','identity','tech'].includes(f.category));
        db[sessionId]  = [...priority, ...other].slice(-50);
      }
      writeJSON(FACTS_FILE, db);
    }
  }

  getFacts(sessionId) {
    const db = readJSON(FACTS_FILE);
    return db[sessionId] || [];
  }

  // STEP 8: 저장 금지 패턴 검사 — 일회성 쿼리, 단순 대화, 검색 결과 raw 텍스트 차단
  static shouldStoreFact(text) {
    if (!text || text.trim().length < 8) return false;
    const BLOCK = [
      /^\d+[원달러엔%]?$/,               // 숫자·금액만
      /^\s*(?:안녕|반가워|고마워|감사|잘 부탁|오케|ㅎㅎ|ㅋㅋ|ㅠㅠ)/,  // 인사·감탄
      /\[웹 검색|웹검색|검색 결과|출처:/,  // 검색 결과 raw 텍스트
      /^(?:https?:\/\/|www\.)/,            // URL만
    ];
    return !BLOCK.some(re => re.test(text.trim()));
  }

  // 텍스트에서 사실 자동 추출 (패턴 매칭)
  extractFacts(sessionId, text) {
    // STEP 8: 저장 금지 텍스트 차단
    if (!UserFacts.shouldStoreFact(text)) return;
    const patterns = [
      // 프로젝트/작업 관련 — 광범위
      { re: /나[는은]?\s*.{2,30}(?:개발자|스타트업|회사)/,                                    cat: 'identity' },
      { re: /나[는은]?\s*.{2,50}(?:개발|만들|구축|제작)\s*(?:하고\s*있|중이야|중입니다|중)/,    cat: 'project' },
      { re: /(?:현재|지금)\s*.{3,50}(?:프로젝트|서비스|앱|시스템|플랫폼)/,                     cat: 'project' },
      // 기술 스택 — 콤마/랑/과 나열
      { re: /(?:Next\.js|React|Vue|Angular|FastAPI|Django|Flask|Spring|Node)\s*(?:랑|과|와|,)/, cat: 'tech' },
      { re: /(?:파이썬|Python|자바스크립트|TypeScript|Java|Go|Rust)\s*(?:써|사용|기반)/,        cat: 'tech' },
      // 선호도 관련
      { re: /(?:나[는은]?|저[는은]?)\s*(?:짧은|긴|자세한|간단한|bullet|마크다운)\s*(?:답변|설명|형식)\s*(?:좋아|선호|원해)/, cat: 'preference' },
      { re: /(?:항상|꼭|반드시)\s*(?:한국어|영어|한글)로\s*(?:답해|답변|대답)/,                 cat: 'preference' },
      // 정체성 관련
      { re: /나[는은]?\s*(?:AI\s*)?(?:개발자|디자이너|마케터|기획자|학생|CEO|CTO|PM|프리랜서)/, cat: 'identity' },
      { re: /(?:회사|팀)\s*(?:이름|명)(?:은|이)?\s*(.+?)(?:이야|야|입니다|임)/,                cat: 'identity' },
    ];

    for (const { re, cat } of patterns) {
      if (re.test(text)) {
        const fact = text.trim().substring(0, 100);
        this.addFact(sessionId, fact, cat);
        break; // 발화당 최대 1개
      }
    }
  }
}

// ============================================================
// ConversationSummary – 긴 대화 자동 압축 (L2 보강)
// ============================================================
class ConversationSummary {

  saveSummary(sessionId, summaryText, turnCount) {
    const db = readJSON(SUMM_FILE);
    if (!db[sessionId]) db[sessionId] = [];
    db[sessionId].push({
      summary:   summaryText,
      turnCount,
      ts:        new Date().toISOString()
    });
    // 세션당 최대 10개 요약 보관
    if (db[sessionId].length > 10) db[sessionId] = db[sessionId].slice(-10);
    writeJSON(SUMM_FILE, db);
  }

  getLatestSummary(sessionId) {
    const db = readJSON(SUMM_FILE);
    const arr = db[sessionId] || [];
    return arr.length > 0 ? arr[arr.length - 1] : null;
  }

  getAllSummaries(sessionId) {
    const db = readJSON(SUMM_FILE);
    return db[sessionId] || [];
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
    this.facts    = new UserFacts();           // L3 사용자 선언 사실
    this.summaries = new ConversationSummary(); // L2 대화 요약
  }

  // ── 대화 기록 + 사실 자동 추출 ──────────────────────────
  recordTurn(sessionId, role, content, meta = {}) {
    this.working.addTurn(sessionId, role, content, meta);
    // user 발화에서 사용자 사실 자동 추출
    if (role === 'user') {
      this.facts.extractFacts(sessionId, content);
    }
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

  // ── 오케스트레이터용 컨텍스트 생성 (LLM 프롬프트 주입용) ─────────────
  buildContext(sessionId, currentTaskType) {
    const recentTurns    = this.working.getRecentTurns(sessionId, 8);
    const recentEpisodes = this.episodic.getRecentEpisodes(sessionId, 3);
    const sameTypeEps    = this.episodic.getEpisodesByType(sessionId, currentTaskType, 2);
    const preference     = this.semantic.getPreference(sessionId, currentTaskType);
    const profile        = this.semantic.getProfile(sessionId);
    const userFacts      = this.facts.getFacts(sessionId);          // ★ L3 사용자 사실
    const latestSummary  = this.summaries.getLatestSummary(sessionId); // ★ L2 요약

    return {
      // LLM 메시지 배열에 넣을 대화 히스토리
      conversationHistory: recentTurns,

      // 시스템 프롬프트에 넣을 메모리 요약 텍스트
      memoryPrompt: this.buildMemoryPrompt({
        recentEpisodes,
        sameTypeEps,
        preference,
        profile,
        currentTaskType,
        userFacts,
        latestSummary,
      }),

      // 원본 데이터 (디버깅/UI용)
      raw: { recentEpisodes, sameTypeEps, preference, profile, userFacts, latestSummary }
    };
  }

  // ── 대화가 길어지면 자동 요약 트리거 (20턴 이상) ─────────────────────
  // 반환값: { shouldSummarize, turns } — 호출자가 LLM 요약을 수행 후
  //   saveSummary(sessionId, summaryText, turnCount) 로 저장
  checkAutoSummarize(sessionId, threshold = 20) {
    const allTurns = this.working.getAllTurns(sessionId)
      .filter(t => t.role !== 'system');
    return {
      shouldSummarize: allTurns.length >= threshold,
      turnCount:       allTurns.length,
      turns:           allTurns,
    };
  }

  saveSummary(sessionId, summaryText, turnCount) {
    this.summaries.saveSummary(sessionId, summaryText, turnCount);
  }

  // ── LLM에 주입할 메모리 프롬프트 생성 ───────────────────
  // 최종 구조: 대화요약 → 사용자사실(L4) → 이전이력(L2) → 선호도(L3)
  buildMemoryPrompt({ recentEpisodes, sameTypeEps, preference, profile,
                      currentTaskType, userFacts = [], latestSummary = null }) {
    const parts = [];

    // ① 대화 요약 (20턴+ 시 자동 생성된 압축 요약)
    if (latestSummary?.summary) {
      parts.push('=== 이전 대화 요약 ===');
      parts.push(latestSummary.summary);
    }

    // ② 사용자 선언 사실 — L4 UserFacts
    //    "나는 AI 플랫폼 개발 중", "짧은 답변 선호" 등
    if (userFacts.length > 0) {
      parts.push('\n=== 사용자 관련 기억된 사실 ===');
      userFacts.slice(-8).forEach(f => parts.push(`- ${f.fact}`));
    }

    // ③ 이전 작업 이력 — L2 Episodic
    if (recentEpisodes.length > 0) {
      parts.push('\n=== 이전 작업 이력 ===');
      recentEpisodes.forEach(ep => {
        parts.push(`- [${ep.taskType}] ${ep.summary} (${formatRelTime(ep.ts)})`);
      });
    }

    // ④ 같은 taskType 이전 작업 참고
    if (sameTypeEps.length > 0) {
      parts.push(`\n=== 이전 ${currentTaskType} 작업 참고 ===`);
      sameTypeEps.forEach(ep => {
        const info = ep.taskInfo || {};
        const topic = info.topic || info.industry || info.subject || '';
        parts.push(`- ${topic ? `주제: ${topic}, ` : ''}${ep.summary}`);
      });
    }

    // ⑤ 사용자 선호도 — L3 Semantic
    if (preference && (preference.style || preference.tone || preference.pastTopics?.length > 0)) {
      parts.push('\n=== 사용자 선호도 ===');
      if (preference.style)                 parts.push(`- 선호 스타일: ${preference.style}`);
      if (preference.tone)                  parts.push(`- 선호 톤: ${preference.tone}`);
      if (preference.pastTopics?.length > 0) parts.push(`- 관심 분야: ${preference.pastTopics.join(', ')}`);
    }

    // ⑥ 사용 통계 (초회 이후)
    if (profile?.totalTasks > 1) {
      parts.push(`\n총 ${profile.totalTasks}회 사용 | 마지막 활동: ${formatRelTime(profile.lastActive)}`);
    }

    if (parts.length === 0) return '';

    return (
      '[메모리 컨텍스트 — 아래 정보를 참고하여 사용자 맥락에 맞게 답변하세요]\n' +
      parts.join('\n') +
      '\n[메모리 컨텍스트 끝]\n'
    );
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

  // ── STEP 8: 관련 기억 검색 (semantic search, 키워드 기반) ──────────────
  // 사용자 메시지와 관련성 높은 기억만 선별하여 프롬프트 주입량 최소화
  searchRelevantMemories(sessionId, userMessage) {
    const lower = (userMessage || '').toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length >= 2);

    // L4 사실: 키워드 관련성 점수 계산
    const allFacts = this.facts.getFacts(sessionId);
    const scoredFacts = allFacts.map(f => {
      const factLower = f.fact.toLowerCase();
      const score = words.reduce((s, w) => s + (factLower.includes(w) ? 2 : 0), 0)
                  + (f.category === 'project' ? 1 : 0)
                  + (f.category === 'identity' ? 0.5 : 0);
      return { ...f, score };
    }).sort((a, b) => b.score - a.score);

    // L2 에피소드: 최근 + 키워드 관련
    const allEpisodes = this.episodic.getAllEpisodes(sessionId).slice(0, 20);
    const scoredEpisodes = allEpisodes.map(ep => {
      const text = `${ep.taskType} ${ep.summary || ''} ${JSON.stringify(ep.taskInfo || {})}`.toLowerCase();
      const score = words.reduce((s, w) => s + (text.includes(w) ? 2 : 0), 0);
      return { ...ep, score };
    }).sort((a, b) => b.score - a.score);

    return {
      relevantFacts:    scoredFacts.filter(f => f.score > 0).slice(0, 5),
      relevantEpisodes: scoredEpisodes.filter(e => e.score > 0).slice(0, 3),
      allFacts:         allFacts.slice(-5),        // 항상 최근 5개 포함
      allEpisodes:      allEpisodes.slice(0, 3),   // 항상 최근 3개 포함
    };
  }

  // ── STEP 8: Memory Quality Control — 정제 정책 ──────────────────────────
  // 일회성·단순 대화는 L2 에피소드에 저장하지 않음
  // 저장 금지 taskType 목록
  // STEP 8: 저장 금지 taskType (일회성·단순·검색 raw 결과)
  static get EPHEMERAL_TASK_TYPES() {
    return new Set([
      'chat', 'text', 'unknown', 'greeting',
      // 단순 변환 툴 — 결과가 일회성
      'qrcode', 'tts', 'palette', 'regex', 'stt', 'removebg', 'chat2pdf', 'summarycard',
      // 번역은 일회성 (저장 불필요)
      'translate',
    ]);
  }

  // L4 UserFacts 정제: 최대 50개, 오래된 것 제거
  // STEP 8: UserFacts 정제 — 최대 50개, 프로젝트/정체성/기술 우선 보존
  pruneUserFacts(sessionId) {
    const db = readJSON(FACTS_FILE);
    if (!db[sessionId]) return;
    if (db[sessionId].length > 50) {
      const priority = db[sessionId].filter(f => ['project','identity','tech'].includes(f.category));
      const other    = db[sessionId].filter(f => !['project','identity','tech'].includes(f.category));
      db[sessionId]  = [...priority, ...other].slice(-50);
      writeJSON(FACTS_FILE, db);
      console.log(`[memoryEngine] UserFacts 정제: ${db[sessionId].length}개 보존`);
    }
  }

  // STEP 8: L2 에피소드 정제 — 핵심 에피소드만 보존 (최대 30개)
  // 호출: 30턴마다, 또는 수동
  pruneEpisodes(sessionId) {
    const db = readJSON(EPIS_FILE);
    if (!db[sessionId] || db[sessionId].length <= 30) return;
    // 품질 점수 상위 20개 + 최신 10개 합집합 (중복 제거)
    const sorted = [...db[sessionId]]
      .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
    const topQuality = sorted.slice(0, 20);
    const recent     = db[sessionId].slice(-10);
    const merged     = [...new Map(
      [...topQuality, ...recent].map(e => [e.id, e])
    ).values()].sort((a, b) => new Date(a.ts) - new Date(b.ts));
    db[sessionId] = merged.slice(-30);
    writeJSON(EPIS_FILE, db);
    console.log(`[memoryEngine] 에피소드 정제: ${db[sessionId].length}개 보존`);
  }

  // STEP 8: 30턴 경계 자동 에피소드 정제 트리거
  checkEpisodicSummary(sessionId) {
    const allTurns   = this.working.getAllTurns(sessionId).filter(t => t.role !== 'system');
    const turnCount  = allTurns.length;
    const episodeCount = this.episodic.getAllEpisodes(sessionId).length;
    // 30턴마다 에피소드 정제 (30, 60, 90, ...)
    if (turnCount > 0 && turnCount % 30 === 0) {
      this.pruneEpisodes(sessionId);
    }
    return { turnCount, episodeCount };
  }

  // 저장할 가치가 있는 taskType인지 판단
  isCompletionWorthy(taskType) {
    return !MemoryEngine.EPHEMERAL_TASK_TYPES.has(taskType);
  }

  // ── STEP 8: 향상된 buildContext (관련 기억만 주입) ─────────────────────
  buildContextSmart(sessionId, currentTaskType, userMessage) {
    const relevant = this.searchRelevantMemories(sessionId, userMessage);

    // 관련 사실이 있으면 우선, 없으면 최근 사실
    const factsToUse    = relevant.relevantFacts.length > 0
      ? relevant.relevantFacts
      : relevant.allFacts;

    // 관련 에피소드가 있으면 우선, 없으면 최근 에피소드
    const episodesToUse = relevant.relevantEpisodes.length > 0
      ? relevant.relevantEpisodes
      : relevant.allEpisodes;

    const sameTypeEps  = this.episodic.getEpisodesByType(sessionId, currentTaskType, 2);
    const preference   = this.semantic.getPreference(sessionId, currentTaskType);
    const profile      = this.semantic.getProfile(sessionId);
    const latestSummary = this.summaries.getLatestSummary(sessionId);
    const recentTurns  = this.working.getRecentTurns(sessionId, 8);

    return {
      conversationHistory: recentTurns,
      memoryPrompt: this.buildMemoryPrompt({
        recentEpisodes: episodesToUse,
        sameTypeEps,
        preference,
        profile,
        currentTaskType,
        userFacts: factsToUse,
        latestSummary,
      }),
      raw: {
        relevantFacts:    factsToUse,
        recentEpisodes:   episodesToUse,
        sameTypeEps,
        preference,
        profile,
        userFacts:        factsToUse,
        latestSummary,
      },
    };
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
