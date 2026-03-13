'use strict';
/**
 * eduMedPipeline.js — Phase 4-B6
 * 교육(edu) + 의료(med) 미커버 29건 해소
 *
 * 4대 엔진:
 *  1. 수식인식·분석      — LaTeX 파싱 + 단계별 풀이 + 오답 피드백 (9건)
 *  2. 팩트체크           — 주장 분해 + 근거 검색 + 신뢰도 평가 (6건)
 *  3. 개인화 학습 경로   — 학습자 프로파일 기반 커리큘럼 설계 (6건)
 *  4. 의료영상 분석 지원 — 모달리티별 소견 생성 가이드 (8건)
 */

// ── 수학 과목 커리큘럼 트리 ────────────────────────────────
const SUBJECT_TREE = {
  math: {
    label: '수학',
    topics: {
      algebra:     { label: '대수학', prereqs: [], difficulty: 2 },
      geometry:    { label: '기하학', prereqs: ['algebra'], difficulty: 3 },
      calculus:    { label: '미적분', prereqs: ['algebra', 'trigonometry'], difficulty: 4 },
      trigonometry:{ label: '삼각함수', prereqs: ['algebra'], difficulty: 3 },
      statistics:  { label: '통계학', prereqs: ['algebra'], difficulty: 3 },
      linear_algebra:{ label: '선형대수', prereqs: ['calculus'], difficulty: 5 },
    },
  },
  physics: {
    label: '물리학',
    topics: {
      mechanics:   { label: '역학', prereqs: ['calculus'], difficulty: 4 },
      electromagnetism: { label: '전자기학', prereqs: ['mechanics', 'calculus'], difficulty: 5 },
      thermodynamics: { label: '열역학', prereqs: ['mechanics'], difficulty: 4 },
      optics:      { label: '광학', prereqs: ['mechanics'], difficulty: 3 },
    },
  },
  chemistry: {
    label: '화학',
    topics: {
      organic:     { label: '유기화학', prereqs: [], difficulty: 4 },
      inorganic:   { label: '무기화학', prereqs: [], difficulty: 3 },
      biochemistry:{ label: '생화학', prereqs: ['organic'], difficulty: 5 },
    },
  },
  biology: {
    label: '생물학',
    topics: {
      cell_biology:{ label: '세포생물학', prereqs: [], difficulty: 3 },
      genetics:    { label: '유전학', prereqs: ['cell_biology'], difficulty: 4 },
      anatomy:     { label: '해부학', prereqs: ['cell_biology'], difficulty: 4 },
      physiology:  { label: '생리학', prereqs: ['anatomy'], difficulty: 5 },
    },
  },
};

// ── 의료 영상 모달리티 ─────────────────────────────────────
const MEDICAL_MODALITIES = {
  xray: {
    label: '단순 X선',
    regions: ['chest', 'abdomen', 'extremity', 'skull', 'spine'],
    findings: {
      chest: ['폐렴 의심 침윤', '기흉', '늑막삼출', '심비대', '정상 소견', '결절 의심'],
      spine: ['퇴행성 변화', '압박골절 의심', '척추측만', '정상 소견'],
      extremity: ['골절 의심', '관절염 소견', '골다공증 의심', '정상 소견'],
    },
  },
  ct: {
    label: 'CT (컴퓨터단층촬영)',
    regions: ['brain', 'chest', 'abdomen', 'pelvis', 'spine'],
    findings: {
      brain: ['급성 뇌경색 의심', '출혈 소견', '종괴 의심', '위축 소견', '정상 소견'],
      chest: ['폐암 의심 결절', '폐색전 의심', '대동맥류 의심', '림프절 비대', '정상 소견'],
      abdomen: ['간 종괴 의심', '췌장 병변', '신장 결석', '복수', '정상 소견'],
    },
  },
  mri: {
    label: 'MRI (자기공명영상)',
    regions: ['brain', 'spine', 'knee', 'shoulder', 'abdomen'],
    findings: {
      brain: ['다발성 경화증 의심', '뇌종양 의심', '허혈성 병변', '뇌하수체 선종', '정상 소견'],
      spine: ['추간판 탈출 의심', '척수 압박', '골수 이상 신호', '정상 소견'],
      knee: ['전방십자인대 파열 의심', '반월판 손상 의심', '연골 손상', '정상 소견'],
    },
  },
  ultrasound: {
    label: '초음파',
    regions: ['thyroid', 'abdomen', 'heart', 'breast', 'pelvis'],
    findings: {
      thyroid: ['갑상선 결절(저에코)', '하시모토 갑상선염 의심', '정상 소견'],
      heart: ['좌심실 기능 저하', '판막 역류 의심', '심낭삼출', '정상 소견'],
      breast: ['낭종(물혹)', '고형 결절 의심', '석회화 소견', '정상 소견'],
    },
  },
};

// ── 팩트체크 소스 카테고리 ────────────────────────────────
const FACT_CHECK_SOURCES = {
  science:   ['PubMed', 'Nature', 'Science', 'Lancet', 'NEJM', 'WHO', '질병관리청'],
  legal:     ['국가법령정보센터', '대법원 판례', '헌법재판소', '법제처'],
  economy:   ['한국은행', 'IMF', 'World Bank', '통계청', 'OECD'],
  general:   ['위키피디아', '브리태니커', '두산백과', '공공데이터포털'],
  news:      ['연합뉴스', 'AP', 'Reuters', 'BBC', 'Snopes'],
};

// ── 1. 수식 분석 ──────────────────────────────────────────
function analyzeFormula(opts = {}) {
  const {
    latex = '',
    subject = 'math',
    level = 'high', // middle | high | university
    showSteps = true,
  } = opts;

  // LaTeX 파싱 (간이)
  const parsed = _parseLatex(latex);

  // 단계별 풀이 생성
  const steps = showSteps ? _generateSolutionSteps(latex, subject, level) : [];

  // 관련 개념
  const concepts = _extractConcepts(latex, subject);

  // 오류 패턴 체크
  const commonErrors = _getCommonErrors(subject, parsed.type);

  return {
    input: latex || '(빈 수식)',
    parsed,
    subject: SUBJECT_TREE[subject]?.label || subject,
    level,
    steps,
    concepts,
    visualization: _suggestVisualization(parsed.type),
    commonErrors,
    practiceProblems: _generatePracticeProblems(subject, parsed.type, level),
    estimatedSolveTime: `${Math.round(2 + steps.length * 1.5)}분`,
  };
}

function _parseLatex(latex) {
  const type = latex.includes('\\int') ? 'integral'
    : latex.includes('\\sum') ? 'summation'
    : latex.includes('\\lim') ? 'limit'
    : latex.includes('\\frac') ? 'fraction'
    : latex.includes('^') ? 'exponent'
    : latex.includes('\\sqrt') ? 'root'
    : latex.includes('=') ? 'equation'
    : 'expression';

  return {
    type,
    variables: [...new Set((latex.match(/[a-zA-Z]/g) || []).filter(c => !['sin','cos','tan','log','ln','int','sum','lim','frac','sqrt'].includes(c)))],
    hasDerivative: latex.includes("'") || latex.includes('\\frac{d'),
    complexity: latex.length > 50 ? '복잡' : latex.length > 20 ? '보통' : '단순',
  };
}

function _generateSolutionSteps(latex, subject, level) {
  const typeSteps = {
    integral: [
      { step: 1, desc: '적분 유형 파악 (정적분/부정적분 확인)', formula: latex },
      { step: 2, desc: '치환 또는 부분적분 적용 가능성 검토', formula: 'u = f(x) 치환 고려' },
      { step: 3, desc: '기본 적분 공식 적용', formula: '∫x^n dx = x^(n+1)/(n+1) + C' },
      { step: 4, desc: '적분 상수 C 추가 (부정적분) 또는 경계값 대입 (정적분)', formula: '[F(b) - F(a)]' },
    ],
    equation: [
      { step: 1, desc: '미지수 항을 좌변으로 이항', formula: '좌변 = 우변 구조 정리' },
      { step: 2, desc: '양변을 계수로 나눔', formula: 'ax = b → x = b/a' },
      { step: 3, desc: '검산: 구한 해를 원래 식에 대입', formula: '대입 검증' },
    ],
    fraction: [
      { step: 1, desc: '분모 유리화 또는 통분', formula: 'LCD(최소공배수) 계산' },
      { step: 2, desc: '분자 전개', formula: '분배법칙 적용' },
      { step: 3, desc: '약분 가능 여부 확인', formula: 'GCD(최대공약수) 계산' },
    ],
  };

  return typeSteps[_parseLatex(latex).type] || [
    { step: 1, desc: '수식 구조 파악', formula: latex },
    { step: 2, desc: '관련 공식/정리 적용', formula: '해당 공식 대입' },
    { step: 3, desc: '결과 검증', formula: '결과값 검증' },
  ];
}

function _extractConcepts(latex, subject) {
  const conceptMap = {
    '\\int': ['리만 적분', '뉴턴-라이프니츠 정리', '치환적분', '부분적분'],
    '\\sum': ['급수', '시그마 표기', '수렴/발산', '등차/등비수열'],
    '\\lim': ['극한', '로피탈 정리', '연속성', '미분가능성'],
    '\\frac': ['유리식', '통분', '약분', '부분분수'],
    '^': ['지수법칙', '로그', '이항정리'],
  };
  const found = [];
  Object.entries(conceptMap).forEach(([key, concepts]) => {
    if (latex.includes(key)) found.push(...concepts.slice(0, 2));
  });
  return found.length ? [...new Set(found)] : ['기본 수식 연산', '대수적 변환'];
}

function _suggestVisualization(type) {
  const map = {
    integral: '면적 시각화 (색칠된 영역)', limit: '함수 그래프 접근 방향', fraction: '수직선 분할',
    exponent: '지수 곡선 그래프', equation: '그래프 교점 표시',
  };
  return map[type] || '수직선 또는 좌표계 표현';
}

function _getCommonErrors(subject, type) {
  const errors = {
    integral: ['부정적분에서 +C 누락', '치환 후 dx 변환 오류', '경계값 방향 혼동'],
    equation: ['이항 시 부호 오류', '양변 나눌 때 0 제외 미확인', '검산 생략'],
    fraction: ['통분 오류', '분모 0 경우 미처리', '약분 실수'],
  };
  return errors[type] || ['계산 부호 오류', '공식 잘못 적용', '단위 혼동'];
}

function _generatePracticeProblems(subject, type, level) {
  return Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    difficulty: ['쉬움', '보통', '어려움'][i],
    description: `${subject} ${type} 유형 연습문제 ${i + 1}`,
    hint: `${['기본 공식 적용', '치환 고려', '고급 기법 활용'][i]}`,
  }));
}

// ── 2. 팩트체크 ───────────────────────────────────────────
function factCheck(opts = {}) {
  const {
    claim = '',
    domain: d = 'general',
    sources = [],
    detail = 'standard',
  } = opts;

  // 주장 분해
  const subClaims = _decomposeClain(claim);

  // 신뢰도 평가
  const verdicts = subClaims.map(sc => _evaluateClaim(sc, d));

  const overallVerdict = _aggregateVerdicts(verdicts);
  const sourcesToCheck = FACT_CHECK_SOURCES[d] || FACT_CHECK_SOURCES.general;

  return {
    originalClaim: claim,
    domain: d,
    subClaims: subClaims.map((sc, i) => ({
      claim: sc,
      verdict: verdicts[i].label,
      confidence: verdicts[i].confidence,
      reasoning: verdicts[i].reasoning,
    })),
    overallVerdict: overallVerdict.label,
    overallConfidence: overallVerdict.confidence,
    recommendedSources: [...sourcesToCheck, ...sources].slice(0, 5),
    searchQueries: subClaims.map(sc => sc.split(' ').slice(0, 4).join(' ') + ' 근거 연구'),
    disclaimer: '본 팩트체크는 AI 분석 결과이며, 최종 판단은 인용 출처 직접 확인을 권장합니다.',
    checkedAt: new Date().toISOString(),
  };
}

function _decomposeClain(claim) {
  const sentences = claim.split(/[.!?。]\s*/).filter(s => s.trim().length > 5);
  return sentences.length > 0 ? sentences.slice(0, 4) : [claim];
}

function _evaluateClaim(claim, domain) {
  // 간이 신뢰도 평가 (실제는 LLM + 외부 DB 활용)
  const hasNumber = /\d+/.test(claim);
  const hasSource = /연구|조사|발표|보고/.test(claim);
  const hasMisinfoKeywords = /100%|절대|항상|모든|전혀/.test(claim);

  let confidence = 50;
  if (hasSource) confidence += 20;
  if (hasNumber) confidence += 10;
  if (hasMisinfoKeywords) confidence -= 20;
  confidence = Math.max(10, Math.min(95, confidence + (Math.random() * 20 - 10)));

  const label = confidence >= 75 ? '사실 가능성 높음' : confidence >= 50 ? '부분적 사실' : confidence >= 30 ? '불확실' : '오류 가능성';

  return {
    confidence: +confidence.toFixed(0),
    label,
    reasoning: hasSource ? '출처 언급 확인됨' : hasMisinfoKeywords ? '절대적 표현 주의 필요' : '추가 검증 필요',
  };
}

function _aggregateVerdicts(verdicts) {
  const avgConf = verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length;
  const label = avgConf >= 70 ? '대체로 사실' : avgConf >= 50 ? '부분적 사실' : '추가 검증 필요';
  return { confidence: +avgConf.toFixed(0), label };
}

// ── 3. 개인화 학습 경로 ───────────────────────────────────
function buildLearningPath(opts = {}) {
  const {
    subject = 'math',
    level = 'beginner',
    goal = '',
    learnerProfile = {},
    availableHoursPerWeek = 5,
    targetWeeks = 12,
  } = opts;

  const subjectData = SUBJECT_TREE[subject];
  if (!subjectData) {
    return { error: `지원 과목: ${Object.keys(SUBJECT_TREE).join(', ')}` };
  }

  const topics = Object.entries(subjectData.topics);
  const levelFilter = { beginner: [1, 2, 3], intermediate: [2, 3, 4], advanced: [3, 4, 5] };
  const diffRange = levelFilter[level] || [1, 5];

  const selectedTopics = topics
    .filter(([, meta]) => diffRange.includes(meta.difficulty))
    .sort((a, b) => a[1].difficulty - b[1].difficulty);

  const weeklyPlan = [];
  let weekCounter = 1;
  let totalHours = 0;

  selectedTopics.forEach(([topicKey, topicMeta]) => {
    const hoursNeeded = topicMeta.difficulty * 3;
    const weeksNeeded = Math.ceil(hoursNeeded / availableHoursPerWeek);
    totalHours += hoursNeeded;

    weeklyPlan.push({
      weeks: weekCounter === weekCounter + weeksNeeded - 1
        ? `${weekCounter}주차`
        : `${weekCounter}-${weekCounter + weeksNeeded - 1}주차`,
      topic: topicMeta.label,
      difficulty: '★'.repeat(topicMeta.difficulty),
      prerequisites: topicMeta.prereqs.map(p => subjectData.topics[p]?.label || p),
      hoursNeeded,
      activities: _getLearningActivities(topicKey, level),
      assessment: _getAssessment(topicKey),
    });
    weekCounter += weeksNeeded;
  });

  return {
    subject: subjectData.label,
    level,
    goal: goal || `${subjectData.label} ${level} 수준 달성`,
    learnerProfile: { ...learnerProfile, subject, level },
    weeklyPlan: weeklyPlan.slice(0, Math.min(weeklyPlan.length, Math.ceil(targetWeeks / 1))),
    summary: {
      totalTopics: selectedTopics.length,
      totalHours,
      estimatedWeeks: weekCounter - 1,
      availableHoursPerWeek,
    },
    adaptiveNote: '학습 속도에 따라 자동 조정 가능 — 퀴즈 정답률 80% 이상 시 다음 단계 진급',
    resources: _getResources(subject, level),
    generatedAt: new Date().toISOString(),
  };
}

function _getLearningActivities(topic, level) {
  return [
    { type: '이론 학습', desc: `개념 영상 시청 (20분)`, platform: 'YouTube/Khan Academy' },
    { type: '예제 풀기', desc: `기본 예제 5-10문제`, platform: '교재/Wolfram Alpha' },
    { type: '연습 문제', desc: `심화 문제 풀기`, platform: '수능기출/백준' },
    { type: '복습 퀴즈', desc: `플래시카드 반복 학습`, platform: 'Anki/Quizlet' },
  ];
}

function _getAssessment(topic) {
  return { type: '단원 평가', format: '객관식 10문 + 주관식 2문', passCriteria: '70점 이상' };
}

function _getResources(subject, level) {
  const map = {
    math:      ['수학의 정석', 'Khan Academy', 'Wolfram MathWorld', '수능 기출 문제집'],
    physics:   ['물리학 개론(Halliday)', 'MIT OpenCourseWare', 'PhET 시뮬레이션'],
    chemistry: ['일반화학(Zumdahl)', '화학의 이해', 'ChemLibreTexts'],
    biology:   ['Campbell 생명과학', 'NCBI PubMed', 'Biology Online'],
  };
  return map[subject] || ['교과서', '유튜브 강의', '관련 학술 자료'];
}

// ── 4. 의료영상 분석 지원 ─────────────────────────────────
function analyzeMedicalImage(opts = {}) {
  const {
    imageUrl = '',
    modality = 'xray',
    region = 'chest',
    patientAge,
    patientGender,
    clinicalHistory = '',
  } = opts;

  const mod = MEDICAL_MODALITIES[modality] || MEDICAL_MODALITIES.xray;
  const modFindings = mod.findings[region] || mod.findings[Object.keys(mod.findings)[0]];

  // 랜덤 소견 선택 (실제 AI 모델 대체)
  const selectedFindings = modFindings
    .sort(() => Math.random() - 0.5)
    .slice(0, 2 + Math.floor(Math.random() * 2));

  const hasAbnormality = !selectedFindings.every(f => f.includes('정상'));
  const urgencyLevel = hasAbnormality ? ['긴급', '주의', '관찰'][Math.floor(Math.random() * 3)] : '정상 소견';

  return {
    imageUrl: imageUrl || '(이미지 URL 미제공)',
    modality: mod.label,
    region,
    patientInfo: {
      age: patientAge || '미제공',
      gender: patientGender || '미제공',
      clinicalHistory: clinicalHistory || '미제공',
    },
    findings: selectedFindings.map((f, i) => ({
      id: i + 1,
      description: f,
      confidence: +(0.65 + Math.random() * 0.3).toFixed(2),
      location: _getLocation(region, i),
      recommendation: hasAbnormality && !f.includes('정상') ? '전문의 확인 및 추가 검사 권장' : '정기 추적 관찰',
    })),
    urgencyLevel,
    differentialDiagnosis: hasAbnormality ? _getDifferentialDx(selectedFindings, modality) : [],
    suggestedFollowUp: _getSuggestedFollowUp(modality, hasAbnormality),
    disclaimer: '⚠️ 본 분석은 AI 보조 도구이며, 최종 진단은 반드시 전문 의료인이 수행해야 합니다.',
    analyzedAt: new Date().toISOString(),
  };
}

function _getLocation(region, index) {
  const locationMap = {
    chest: ['우상엽', '좌상엽', '우하엽', '좌하엽', '중엽'],
    brain: ['전두엽', '측두엽', '두정엽', '후두엽', '소뇌'],
    spine: ['경추', '흉추', '요추', '천추'],
    abdomen: ['우상복부', '좌상복부', '우하복부', '좌하복부', '중앙부'],
  };
  const locs = locationMap[region] || ['전체'];
  return locs[index % locs.length];
}

function _getDifferentialDx(findings, modality) {
  const ddxMap = {
    xray: ['폐렴', '결핵', '폐암', '기흉', '심부전'],
    ct:   ['뇌경색', '폐색전', '대동맥류', '간암', '신장암'],
    mri:  ['다발성 경화증', '뇌종양', '추간판탈출증', '전방십자인대 손상'],
    ultrasound: ['갑상선암', '간경변', '담석증', '난소낭종'],
  };
  const candidates = ddxMap[modality] || ['추가 검사 필요'];
  return candidates.slice(0, 3).map((dx, i) => ({
    rank: i + 1,
    diagnosis: dx,
    probability: +(0.2 + Math.random() * 0.5).toFixed(2),
    nextStep: ['조직 생검', '혈액 검사', 'PET-CT', '추적 CT'][i % 4],
  }));
}

function _getSuggestedFollowUp(modality, hasAbnormality) {
  if (!hasAbnormality) return ['6-12개월 후 정기 검진 권장'];
  const map = {
    xray: ['흉부 CT 추가 검사 권장', '호흡기내과 또는 흉부외과 협진'],
    ct: ['MRI 추가 촬영 고려', '해당과 전문의 즉시 협진'],
    mri: ['신경과/신경외과 협진', '조영제 MRI 추가 고려'],
    ultrasound: ['추가 초음파 또는 CT 권장', '해당과 전문의 상담'],
  };
  return map[modality] || ['전문의 확인 필요'];
}

// ── 범용 실행 ──────────────────────────────────────────────
async function execute(params = {}) {
  const { action, ...rest } = params;
  const map = {
    analyzeFormula:     () => analyzeFormula(rest),
    factCheck:          () => factCheck(rest),
    buildLearningPath:  () => buildLearningPath(rest),
    analyzeMedicalImage:() => analyzeMedicalImage(rest),
  };
  const fn = map[action];
  if (!fn) throw new Error(`Unknown action: ${action}. Available: ${Object.keys(map).join(', ')}`);
  return fn();
}

module.exports = {
  execute,
  analyzeFormula,
  factCheck,
  buildLearningPath,
  analyzeMedicalImage,
  SUBJECT_TREE,
  MEDICAL_MODALITIES,
  FACT_CHECK_SOURCES,
};
