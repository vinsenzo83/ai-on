// ============================================================
// SkillLibrary — STEP 14: 에이전트 스킬 라이브러리
// ============================================================
// 역할:
//   관련 툴들을 Skill로 그룹화 (Research, Coding, Document, Planning)
//   스킬 선택 → 툴 체인 자동 구성
//   에이전트가 "Research 스킬 사용"처럼 고수준으로 능력 호출
//
// 스킬 목록:
//   RESEARCH  — 정보 수집·분석 (web_search + analyze + summarize)
//   CODING    — 코드 생성·검토 (design + code + review)
//   DOCUMENT  — 문서 작성 (plan + write + format)
//   PLANNING  — 계획 수립 (analyze + plan + decompose)
//   DATA      — 데이터 처리 (extract + analyze + visualize)
//   CREATIVE  — 창의적 작성 (brainstorm + write + refine)
// ============================================================

'use strict';

const { TASK_TYPES } = require('./agentPlanner');

// ─────────────────────────────────────────────────────────────
// § 스킬 정의
// ─────────────────────────────────────────────────────────────
const SKILLS = {

  // ── 리서치 스킬: [병렬검색 × 2] → 분석 → 요약 ─────────────
  // search1, search2 는 dependsOn:[] → 동시 실행 (parallelExecutor)
  RESEARCH: {
    id:          'research',
    name:        '리서치',
    description: '웹 검색 2개를 병렬로 수집하고 분석·요약합니다',
    tools:       ['web_search'],
    taskFlow:    [
      { id: 'search1',   type: TASK_TYPES.SEARCH,    tool: 'web_search', name: '정보 검색 #1',  dependsOn: [] },
      { id: 'search2',   type: TASK_TYPES.SEARCH,    tool: 'web_search', name: '정보 검색 #2',  dependsOn: [] },
      { id: 'analyze',   type: TASK_TYPES.ANALYZE,   tool: null,         name: '분석',           dependsOn: ['search1', 'search2'] },
      { id: 'summarize', type: TASK_TYPES.SUMMARIZE,  tool: null,         name: '최종 요약',      dependsOn: ['analyze'] },
    ],
    triggers:    /최신|뉴스|검색|찾아|알아봐|조사|research|search/i,
    priority:    1,
  },

  // ── 코딩 스킬: 설계 → 구현 → 검토 ─────────────────────────
  CODING: {
    id:          'coding',
    name:        '코딩',
    description: '소프트웨어 설계, 코드 작성, 코드 리뷰를 수행합니다',
    tools:       [],
    taskFlow:    [
      { id: 'design',  type: TASK_TYPES.PLAN,   tool: null, name: '설계',        dependsOn: [] },
      { id: 'code',    type: TASK_TYPES.CODE,   tool: null, name: '코드 작성',   dependsOn: ['design'] },
      { id: 'review',  type: TASK_TYPES.REVIEW, tool: null, name: '코드 검토',   dependsOn: ['code'] },
    ],
    triggers:    /코드|프로그램|함수|클래스|알고리즘|스크립트|code|function|class|script|api/i,
    priority:    2,
  },

  // ── 문서 작성 스킬: 기획 → 작성 → 포맷 ────────────────────
  DOCUMENT: {
    id:          'document',
    name:        '문서 작성',
    description: '보고서, 블로그, 이메일 등 다양한 문서를 작성합니다',
    tools:       [],
    taskFlow:    [
      { id: 'plan',     type: TASK_TYPES.PLAN,      tool: null, name: '문서 기획',   dependsOn: [] },
      { id: 'write',    type: TASK_TYPES.WRITE,     tool: null, name: '본문 작성',   dependsOn: ['plan'] },
      { id: 'synthesize', type: TASK_TYPES.SYNTHESIZE, tool: null, name: '최종 완성', dependsOn: ['write'] },
    ],
    triggers:    /보고서|블로그|이메일|문서|자소서|리포트|report|blog|email|document/i,
    priority:    3,
  },

  // ── 계획 수립 스킬: 분석 → 계획 → 분해 ────────────────────
  PLANNING: {
    id:          'planning',
    name:        '계획 수립',
    description: '목표를 분석하고 실행 가능한 단계적 계획을 수립합니다',
    tools:       [],
    taskFlow:    [
      { id: 'analyze',    type: TASK_TYPES.ANALYZE,    tool: null, name: '목표 분석',   dependsOn: [] },
      { id: 'plan',       type: TASK_TYPES.PLAN,       tool: null, name: '계획 수립',   dependsOn: ['analyze'] },
      { id: 'synthesize', type: TASK_TYPES.SYNTHESIZE, tool: null, name: '최종 계획',   dependsOn: ['plan'] },
    ],
    triggers:    /계획|전략|로드맵|플랜|기획|plan|strategy|roadmap/i,
    priority:    4,
  },

  // ── 데이터 분석 스킬: 추출 → 분석 → 시각화 설명 ─────────────
  DATA: {
    id:          'data',
    name:        '데이터 분석',
    description: '데이터를 추출·분석하고 인사이트를 도출합니다',
    tools:       [],
    taskFlow:    [
      { id: 'extract',    type: TASK_TYPES.EXTRACT,    tool: null, name: '데이터 추출', dependsOn: [] },
      { id: 'analyze',    type: TASK_TYPES.ANALYZE,    tool: null, name: '데이터 분석', dependsOn: ['extract'] },
      { id: 'synthesize', type: TASK_TYPES.SYNTHESIZE, tool: null, name: '인사이트 정리', dependsOn: ['analyze'] },
    ],
    triggers:    /데이터|분석|통계|숫자|그래프|차트|data|analysis|statistics/i,
    priority:    5,
  },

  // ── 창의 스킬: 아이디어 → 작성 → 다듬기 ───────────────────
  CREATIVE: {
    id:          'creative',
    name:        '창의 작성',
    description: '창의적인 글쓰기, 아이디어 발상, 스토리텔링을 수행합니다',
    tools:       [],
    taskFlow:    [
      { id: 'brainstorm', type: TASK_TYPES.PLAN,       tool: null, name: '아이디어 발상', dependsOn: [] },
      { id: 'write',      type: TASK_TYPES.WRITE,      tool: null, name: '창의 작성',     dependsOn: ['brainstorm'] },
      { id: 'synthesize', type: TASK_TYPES.SYNTHESIZE, tool: null, name: '완성',           dependsOn: ['write'] },
    ],
    triggers:    /창의|스토리|소설|시|광고|카피|creative|story|poem|slogan/i,
    priority:    6,
  },

  // ── 심층 분석 스킬: [병렬검색 × 3] → 분석 → 작성 → 검토+완성 ──
  // search1/2/3 → dependsOn:[] → 3개 동시 실행
  // review+synthesize 는 write 완료 후 실행 (review도 write에만 의존)
  DEEP_ANALYSIS: {
    id:          'deep_analysis',
    name:        '심층 분석',
    description: '웹 검색 3개 병렬 + 다각도 분석 + 자기교정으로 심층 리포트를 생성합니다',
    tools:       ['web_search'],
    taskFlow:    [
      { id: 'search1',    type: TASK_TYPES.SEARCH,     tool: 'web_search', name: '자료 검색 #1', dependsOn: [] },
      { id: 'search2',    type: TASK_TYPES.SEARCH,     tool: 'web_search', name: '자료 검색 #2', dependsOn: [] },
      { id: 'search3',    type: TASK_TYPES.SEARCH,     tool: 'web_search', name: '자료 검색 #3', dependsOn: [] },
      { id: 'analyze',    type: TASK_TYPES.ANALYZE,    tool: null,         name: '심층 분석',    dependsOn: ['search1', 'search2', 'search3'] },
      { id: 'write',      type: TASK_TYPES.WRITE,      tool: null,         name: '리포트 작성',  dependsOn: ['analyze'] },
      { id: 'synthesize', type: TASK_TYPES.SYNTHESIZE, tool: null,         name: '최종 완성',    dependsOn: ['write'] },
    ],
    triggers:    /심층|깊이|상세|전문|자세히|분석 리포트|comprehensive|in-depth/i,
    priority:    1,
  },
};

// ─────────────────────────────────────────────────────────────
// § SkillLibrary 클래스
// ─────────────────────────────────────────────────────────────
class SkillLibrary {
  constructor() {
    this.skills = SKILLS;
  }

  // ── 메시지/태스크 타입으로 스킬 자동 선택 ──────────────────
  selectSkill(message, taskType, strategy) {
    // strategy=deep → 심층 분석 스킬 우선
    if (strategy === 'deep') {
      // 검색이 필요한 deep 태스크
      if (/최신|뉴스|검색|search/i.test(message) || taskType === 'analysis') {
        return this.skills.DEEP_ANALYSIS;
      }
    }

    // taskType 직접 매핑
    const taskTypeMap = {
      code:      this.skills.CODING,
      blog:      this.skills.DOCUMENT,
      report:    this.skills.DOCUMENT,
      email:     this.skills.DOCUMENT,
      resume:    this.skills.DOCUMENT,
      analysis:  this.skills.DATA,
      creative:  this.skills.CREATIVE,
      ppt:       this.skills.DOCUMENT,
    };
    if (taskTypeMap[taskType]) return taskTypeMap[taskType];

    // 트리거 패턴 매칭 (우선순위 순)
    const sortedSkills = Object.values(this.skills).sort((a, b) => a.priority - b.priority);
    for (const skill of sortedSkills) {
      if (skill.triggers && skill.triggers.test(message)) {
        return skill;
      }
    }

    // 기본값
    return this.skills.DOCUMENT;
  }

  // ── 스킬 → 태스크 목록 변환 ──────────────────────────────────
  buildTasksFromSkill(skill, overrides = {}) {
    return skill.taskFlow.map((t, i) => ({
      id:        `${t.id}_${Date.now()}_${i}`.replace(/[^a-z0-9_]/gi, '_'),
      originalId: t.id,
      name:      t.name,
      type:      t.type,
      tool:      t.tool || null,
      dependsOn: t.dependsOn.map(dep => `${dep}_${Date.now()}_${skill.taskFlow.findIndex(x => x.id === dep)}`).filter(Boolean),
      priority:  i + 1,
      ...overrides[t.id],
    }));
  }

  // ── 간단한 버전: ID 오염 없이 태스크 생성 ────────────────────
  buildTasks(skill) {
    return skill.taskFlow.map((t, i) => ({
      id:        t.id,
      name:      t.name,
      type:      t.type,
      tool:      t.tool || null,
      dependsOn: [...t.dependsOn],
      priority:  i + 1,
    }));
  }

  // ── 스킬 목록 조회 ────────────────────────────────────────────
  listSkills() {
    return Object.values(this.skills).map(s => ({
      id:          s.id,
      name:        s.name,
      description: s.description,
      tools:       s.tools,
      stepCount:   s.taskFlow.length,
    }));
  }

  // ── 스킬 ID로 조회 ────────────────────────────────────────────
  getSkill(skillId) {
    return Object.values(this.skills).find(s => s.id === skillId) || null;
  }

  // ── 복합 스킬: 여러 스킬 조합 ────────────────────────────────
  combineSkills(skillIds) {
    const combined = { id: 'combined', name: '복합', taskFlow: [], tools: [], triggers: null, priority: 0 };
    const seen = new Set();
    for (const sid of skillIds) {
      const skill = this.getSkill(sid);
      if (!skill) continue;
      for (const t of skill.taskFlow) {
        if (!seen.has(t.id)) {
          combined.taskFlow.push(t);
          seen.add(t.id);
        }
      }
      combined.tools.push(...skill.tools);
    }
    combined.tools = [...new Set(combined.tools)];
    return combined;
  }
}

// ─────────────────────────────────────────────────────────────
// § 싱글턴 인스턴스
// ─────────────────────────────────────────────────────────────
const skillLibrary = new SkillLibrary();

module.exports = { SkillLibrary, skillLibrary, SKILLS };
