/**
 * systemPatcher.js
 * 부족 AI role / combo / taskType을 자동 탐지하고 types/index.js에 패치
 * 
 * 동작:
 * 1. 분석 결과(analyzeMissing 출력)에서 미지원 role/api 탐지
 * 2. types/index.js에서 현재 COMBO_ROLES, TASK_TYPES, KNOWN_COMBOS 읽기
 * 3. 새로운 항목 생성 (role template, combo recipe, tasktype)
 * 4. 파일에 삽입 (기존 마커 활용 또는 append)
 * 5. 변경 이력 저장
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TYPES_FILE = path.join(__dirname, '..', 'types', 'index.js');
const PATCH_HISTORY = path.join(__dirname, 'patch_history.json');

// ─────────────────────────────────────────────
// 이미 정의된 role/tasktype 읽기
// ─────────────────────────────────────────────
function readExistingRoles() {
  const content = fs.readFileSync(TYPES_FILE, 'utf8');
  const roles = new Set();
  const comboRoleRegex = /^\s+(\w+):\s*\{/gm;
  let m;
  // COMBO_ROLES 블록 내 role 키 추출
  const comboStart = content.indexOf('const COMBO_ROLES = {');
  const comboEnd = content.indexOf('// KNOWN_COMBOS', comboStart);
  const comboBlock = content.slice(comboStart, comboEnd);
  while ((m = comboRoleRegex.exec(comboBlock)) !== null) {
    roles.add(m[1]);
  }
  return roles;
}

function readExistingTaskTypes() {
  const content = fs.readFileSync(TYPES_FILE, 'utf8');
  const types = new Set();
  const ttStart = content.indexOf('const TASK_TYPES = {');
  const ttEnd = content.indexOf('};', ttStart);
  const ttBlock = content.slice(ttStart, ttEnd);
  const regex = /(\w+):\s*'(\w+)'/g;
  let m;
  while ((m = regex.exec(ttBlock)) !== null) {
    types.add(m[1]);
    types.add(m[2]);
  }
  return types;
}

function readExistingCombos() {
  const content = fs.readFileSync(TYPES_FILE, 'utf8');
  const combos = new Set();
  const regex = /^\s+(\w+):\s*\{/gm;
  const comboStart = content.indexOf('const KNOWN_COMBOS = {');
  const comboEnd = content.indexOf('const TASK_PIPELINES', comboStart);
  const comboBlock = content.slice(comboStart, comboEnd);
  let m;
  while ((m = regex.exec(comboBlock)) !== null) {
    combos.add(m[1]);
  }
  return combos;
}

// ─────────────────────────────────────────────
// Role 템플릿 생성
// ─────────────────────────────────────────────
const ROLE_TEMPLATES = {
  // API별 자동 role 매핑
  'Puppeteer': { key: 'web_scraper', name: '웹 스크래퍼', icon: '🕷️', desc: '웹 크롤링 및 데이터 추출 자동화', model: 'GPT5_2_CODEX', tier: 'flagship', weight: { reasoning: 0.35, instruction: 0.30, factual: 0.25, speed: 0.10 } },
  'ImageGen_API': { key: 'image_generator', name: '이미지 생성기', icon: '🎨', desc: 'AI 이미지 생성 및 편집 파이프라인', model: 'GPT5_1', tier: 'flagship', weight: { creativity: 0.45, instruction: 0.30, reasoning: 0.15, korean: 0.10 } },
  'Whisper_STT': { key: 'stt_engineer', name: 'STT 엔지니어', icon: '🎙️', desc: '음성 인식 및 화자 분리 전문', model: 'GPT5_2', tier: 'flagship', weight: { reasoning: 0.35, instruction: 0.30, factual: 0.25, speed: 0.10 } },
  'ElevenLabs_TTS': { key: 'tts_engineer', name: 'TTS 엔지니어', icon: '🔊', desc: 'AI 음성 합성 및 오디오 처리', model: 'GPT5_2', tier: 'flagship', weight: { instruction: 0.40, reasoning: 0.30, factual: 0.20, speed: 0.10 } },
  'PDF_API': { key: 'doc_parser', name: '문서 파서', icon: '📄', desc: 'PDF/문서 파싱 및 구조화 추출', model: 'GPT5_2', tier: 'flagship', weight: { factual: 0.40, reasoning: 0.30, instruction: 0.20, speed: 0.10 } },
  'Finance_API': { key: 'quant_analyst', name: '퀀트 애널리스트', icon: '📈', desc: '금융 데이터 분석 및 퀀트 모델링', model: 'GPT5_2', tier: 'flagship', weight: { reasoning: 0.40, factual: 0.35, instruction: 0.15, speed: 0.10 } },
  'Map_API': { key: 'geo_analyst', name: '지리 분석가', icon: '🗺️', desc: '공간 데이터 분석 및 GIS 처리', model: 'GPT5_2', tier: 'flagship', weight: { reasoning: 0.35, factual: 0.35, instruction: 0.20, speed: 0.10 } },
  'CRM_API': { key: 'crm_specialist', name: 'CRM 전문가', icon: '👥', desc: 'CRM 데이터 분석 및 고객 관리 자동화', model: 'GPT5_2', tier: 'flagship', weight: { reasoning: 0.35, factual: 0.30, instruction: 0.25, speed: 0.10 } },
  'Instagram_API': { key: 'sns_manager', name: 'SNS 매니저', icon: '📱', desc: 'SNS 콘텐츠 관리 및 성과 분석', model: 'GPT5_1', tier: 'flagship', weight: { creativity: 0.35, instruction: 0.30, korean: 0.25, speed: 0.10 } },
  'YouTube_API': { key: 'video_analyst', name: '영상 분석가', icon: '▶️', desc: '영상 콘텐츠 분석 및 최적화', model: 'GPT5_2', tier: 'flagship', weight: { reasoning: 0.35, factual: 0.30, instruction: 0.25, speed: 0.10 } },
  'Database_API': { key: 'db_architect', name: 'DB 아키텍트', icon: '🗄️', desc: '데이터베이스 설계 및 최적화', model: 'GPT5_2_CODEX', tier: 'flagship', weight: { reasoning: 0.40, factual: 0.30, instruction: 0.20, speed: 0.10 } },
  'LinkedIn_API': { key: 'b2b_researcher', name: 'B2B 리서처', icon: '💼', desc: 'B2B 잠재 고객 리서치 및 분석', model: 'GPT5_2', tier: 'flagship', weight: { factual: 0.40, reasoning: 0.30, instruction: 0.20, speed: 0.10 } },
  'VideoGen_API': { key: 'video_editor', name: '영상 편집기', icon: '🎬', desc: 'AI 영상 생성 및 편집 자동화', model: 'GPT5_2', tier: 'flagship', weight: { creativity: 0.40, instruction: 0.30, reasoning: 0.20, speed: 0.10 } },
  'Music_API': { key: 'composer', name: '작곡가', icon: '🎵', desc: 'AI 음악 생성 및 편곡', model: 'GPT5_1', tier: 'flagship', weight: { creativity: 0.45, instruction: 0.25, reasoning: 0.20, korean: 0.10 } },
  'OCR_API': { key: 'ocr_specialist', name: 'OCR 전문가', icon: '🔍', desc: '이미지/PDF 텍스트 추출 및 구조화', model: 'GPT5_2', tier: 'flagship', weight: { factual: 0.40, reasoning: 0.30, instruction: 0.20, speed: 0.10 } }
};

// ─────────────────────────────────────────────
// Combo 템플릿 생성
// ─────────────────────────────────────────────
function makeComboEntry(key, roles, taskDesc) {
  const rolesStr = Object.entries(roles)
    .map(([r, m]) => `${r}: '${m}'`)
    .join(', ');
  return `
  ${key}: {
    name: '${taskDesc}',
    roles: { ${rolesStr} }
  },`;
}

function makeRoleEntry(roleKey, tmpl) {
  const weights = Object.entries(tmpl.weight)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join(',\n');
  const tiers = Array.isArray(tmpl.tier) ? `['${tmpl.tier}']` : `['${tmpl.tier}']`;
  return `
  ${roleKey}: {
    name: '${tmpl.name}',
    icon: '${tmpl.icon}',
    weight: {
${weights}
    },
    preferredTier: ${tiers},
    preferredModel: '${tmpl.model}',
    description: '${tmpl.desc}'
  },`;
}

// ─────────────────────────────────────────────
// 패치 히스토리
// ─────────────────────────────────────────────
function loadHistory() {
  if (!fs.existsSync(PATCH_HISTORY)) return { patches: [] };
  return JSON.parse(fs.readFileSync(PATCH_HISTORY, 'utf8'));
}

function saveHistory(h) {
  fs.writeFileSync(PATCH_HISTORY, JSON.stringify(h, null, 2));
}

// ─────────────────────────────────────────────
// 메인 패처
// ─────────────────────────────────────────────
function systemPatcher(analysis) {
  const result = {
    rolesAdded: 0,
    combosAdded: 0,
    taskTypesAdded: 0,
    newRoles: [],
    newCombos: [],
    newTaskTypes: [],
    patchedAt: new Date().toISOString()
  };

  try {
    let content = fs.readFileSync(TYPES_FILE, 'utf8');
    const existingRoles = readExistingRoles();
    const existingCombos = readExistingCombos();

    // ─── 1. 부족 API → 새 role 추가 ───
    const topApis = (analysis.topMissingApis || []).slice(0, 8).map(x => x[0]);
    const rolesToAdd = [];

    for (const api of topApis) {
      const tmpl = ROLE_TEMPLATES[api];
      if (!tmpl) continue;
      if (existingRoles.has(tmpl.key)) continue;
      rolesToAdd.push({ key: tmpl.key, tmpl, api });
    }

    // COMBO_ROLES에 role 추가 (COMBO_ROLES 블록의 마지막 }; 바로 앞)
    if (rolesToAdd.length > 0) {
      // COMBO_ROLES 블록 찾기 → 그 안의 마지막 } 위치에 삽입
      const comboRolesStart = content.indexOf('const COMBO_ROLES = {');
      const knownCombosStart = content.indexOf('const KNOWN_COMBOS');
      if (comboRolesStart > -1 && knownCombosStart > -1) {
        // COMBO_ROLES ~ KNOWN_COMBOS 사이에서 마지막 }; 찾기
        const blockSlice = content.slice(comboRolesStart, knownCombosStart);
        const lastClosingIdx = blockSlice.lastIndexOf('};');
        if (lastClosingIdx > -1) {
          const absInsertIdx = comboRolesStart + lastClosingIdx; // }; 위치
          // }; 앞에 새 role 삽입 (마지막 role 뒤에 , 추가 후 새 항목)
          const newRoleEntries = rolesToAdd.map(r => makeRoleEntry(r.key, r.tmpl)).join('');
          content = content.slice(0, absInsertIdx) + newRoleEntries + '\n' + content.slice(absInsertIdx);
          result.rolesAdded = rolesToAdd.length;
          result.newRoles = rolesToAdd.map(r => r.key);
        }
      }
    }

    // ─── 2. 새 role → combo 레시피 추가 ───
    const combosToAdd = [];
    for (const { key, api } of rolesToAdd) {
      const comboKey = `${key}_pipeline`;
      if (existingCombos.has(comboKey)) continue;

      const roleMap = {};
      roleMap[key] = 'GPT5_2';
      roleMap['analyst'] = 'GPT5_MINI';
      roleMap['validator'] = 'GPT5_MINI';

      combosToAdd.push({
        key: comboKey,
        entry: makeComboEntry(comboKey, roleMap, `${ROLE_TEMPLATES[api]?.name || key} 자동화 파이프라인`)
      });
    }

    if (combosToAdd.length > 0) {
      // KNOWN_COMBOS 끝에 추가 (const TASK_PIPELINES 앞)
      const pipelineMarker = 'const TASK_PIPELINES';
      const pipelineIdx = content.indexOf(pipelineMarker);
      if (pipelineIdx > -1) {
        const insertPos = content.lastIndexOf('};', pipelineIdx);
        if (insertPos > -1) {
          const newComboEntries = combosToAdd.map(c => c.entry).join('');
          content = content.slice(0, insertPos) + newComboEntries + '\n' + content.slice(insertPos);
          result.combosAdded = combosToAdd.length;
          result.newCombos = combosToAdd.map(c => c.key);
        }
      }
    }

    // ─── 3. 변경사항 저장 ───
    if (result.rolesAdded > 0 || result.combosAdded > 0 || result.taskTypesAdded > 0) {
      // 백업 생성
      const backupPath = TYPES_FILE + '.backup_' + Date.now();
      fs.writeFileSync(backupPath, fs.readFileSync(TYPES_FILE, 'utf8'));
      // 패치 적용
      fs.writeFileSync(TYPES_FILE, content);
    }

    // ─── 4. 히스토리 저장 ───
    const history = loadHistory();
    history.patches.push(result);
    if (history.patches.length > 50) history.patches = history.patches.slice(-50);
    saveHistory(history);

  } catch (err) {
    result.error = err.message;
    console.error('[systemPatcher] 오류:', err.message);
  }

  return result;
}

// ─────────────────────────────────────────────
// 패치 검증 (적용 후 syntax 확인)
// ─────────────────────────────────────────────
function validatePatch() {
  try {
    // require 캐시 클리어 후 재로드
    delete require.cache[require.resolve('../types/index.js')];
    const types = require('../types/index.js');
    const roleCount = Object.keys(types.COMBO_ROLES || {}).length;
    const comboCount = Object.keys(types.KNOWN_COMBOS || {}).length;
    const taskCount = Object.keys(types.TASK_TYPES || {}).length;
    return { valid: true, roleCount, comboCount, taskCount };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
// 현재 시스템 상태 스냅샷
// ─────────────────────────────────────────────
function getSystemSnapshot() {
  try {
    delete require.cache[require.resolve('../types/index.js')];
    const types = require('../types/index.js');
    return {
      taskTypes: Object.keys(types.TASK_TYPES || {}).length,
      comboRoles: Object.keys(types.COMBO_ROLES || {}).length,
      knownCombos: Object.keys(types.KNOWN_COMBOS || {}).length,
      taskPipelines: Object.keys(types.TASK_PIPELINES || {}).length,
      snapshotAt: new Date().toISOString()
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { systemPatcher, validatePatch, getSystemSnapshot, readExistingRoles };

// CLI 직접 실행
if (require.main === module) {
  const snap = getSystemSnapshot();
  console.log('현재 시스템 스냅샷:', JSON.stringify(snap, null, 2));

  // 테스트 패치
  const testAnalysis = {
    topMissingApis: [
      ['Puppeteer', 45],
      ['Finance_API', 30],
      ['LinkedIn_API', 25]
    ],
    topMissingTech: [['크롤러', 20]],
    topRoles: [],
    uncoveredDomains: []
  };
  const r = systemPatcher(testAnalysis);
  console.log('\n패치 결과:', JSON.stringify(r, null, 2));

  const v = validatePatch();
  console.log('\n검증:', JSON.stringify(v, null, 2));
}
