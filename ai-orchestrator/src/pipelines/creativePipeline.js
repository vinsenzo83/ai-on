'use strict';
/**
 * creativePipeline.js — Phase 4-B1
 * creative 도메인 미커버 60건 해소
 *
 * 3대 엔진:
 *  1. 캐릭터일관성AI  — 레퍼런스 이미지 기반 캐릭터 IP 자산 생성 (9건)
 *  2. AI영상생성      — 스토리보드→콘티→영상 프롬프트 패키지 (7건)
 *  3. AI작곡          — 장르·BPM·화음 분석 + 가사 생성 + 프로듀싱 가이드 (7건)
 */

// ── 캐릭터 스타일 프리셋 ────────────────────────────────────
const CHARACTER_STYLES = {
  webtoon_korea: {
    label: '한국 웹툰',
    prompt: 'Korean webtoon style, clean line art, flat color, expressive eyes, manhwa',
    negPrompt: 'realistic, 3d, noisy, blurry',
    aspectRatio: '9:16',
  },
  anime_jp: {
    label: '일본 애니메이션',
    prompt: 'anime style, cel shading, vibrant colors, detailed hair, Makoto Shinkai inspired',
    negPrompt: 'realistic, watercolor, sketch',
    aspectRatio: '1:1',
  },
  flat_illustration: {
    label: '플랫 일러스트',
    prompt: 'flat vector illustration, minimal, geometric shapes, pastel palette, Dribbble style',
    negPrompt: '3d, photorealistic, dark',
    aspectRatio: '1:1',
  },
  '3d_cartoon': {
    label: '3D 카툰',
    prompt: 'Pixar 3D cartoon style, soft lighting, subsurface scattering, expressive character',
    negPrompt: 'flat, 2d, anime, realistic',
    aspectRatio: '1:1',
  },
  pixel_art: {
    label: '픽셀 아트',
    prompt: 'pixel art, 16-bit, retro game sprite, limited palette, crisp edges',
    negPrompt: 'realistic, blurry, smooth',
    aspectRatio: '1:1',
  },
};

// ── 감정 상태 표정 패키지 ────────────────────────────────────
const EMOTION_STATES = [
  'neutral standing pose',
  'happy smiling expression',
  'sad drooping expression',
  'surprised open mouth',
  'angry furrowed brows',
  'thinking finger on chin',
  'waving hello',
  'running action pose',
];

// ── 캐릭터일관성AI ────────────────────────────────────────────
function generateCharacterSheet(opts = {}) {
  const {
    characterName = '주인공',
    style         = 'webtoon_korea',
    colorTheme    = { hair: '#2c1810', eyes: '#4a90d9', outfit: '#6c5ce7' },
    personality   = '밝고 긍정적',
    age           = 17,
    gender        = 'female',
  } = opts;

  const stylePreset = CHARACTER_STYLES[style] || CHARACTER_STYLES.webtoon_korea;

  // 캐릭터 베이스 프롬프트 (일관성 유지 핵심)
  const basePrompt = [
    `${stylePreset.prompt}`,
    `character design sheet for ${characterName}`,
    `${age} year old ${gender}`,
    `hair color ${colorTheme.hair}, eye color ${colorTheme.eyes}`,
    `wearing ${colorTheme.outfit} outfit`,
    `personality: ${personality}`,
    'white background, character reference sheet',
  ].join(', ');

  // 표정 패키지 (8종 감정)
  const emotionSheets = EMOTION_STATES.map(emotion => ({
    emotion: emotion.split(' ')[0],
    prompt:  `${basePrompt}, ${emotion}, full body`,
    negPrompt: stylePreset.negPrompt,
    size:    stylePreset.aspectRatio === '9:16' ? '512x910' : '512x512',
  }));

  // IP 자산 패키지 (굿즈용)
  const ipAssets = [
    { type: 'sticker',   prompt: `${basePrompt}, chibi style, cute, sticker pack, transparent bg` },
    { type: 'profile',   prompt: `${basePrompt}, face close-up, circle crop, profile picture` },
    { type: 'wallpaper', prompt: `${basePrompt}, full body, detailed background, wallpaper quality` },
    { type: 'goods_tshirt', prompt: `${basePrompt}, flat design, t-shirt print ready` },
  ];

  return {
    characterName,
    style:        stylePreset.label,
    colorTheme,
    basePrompt,
    emotionSheets,   // 8종 표정 프롬프트
    ipAssets,        // 4종 굿즈 자산
    consistency: {
      fixedElements: ['hair color', 'eye color', 'face shape', 'outfit style'],
      variableElements: ['pose', 'expression', 'background'],
      guideline: '모든 이미지 생성 시 basePrompt를 앞에 붙여 일관성 유지',
    },
    metadata: {
      totalImages: emotionSheets.length + ipAssets.length,
      estimatedCost: `약 ${(emotionSheets.length + ipAssets.length) * 0.02}달러 (DALL-E 3 기준)`,
      stub: true,
    },
  };
}

// ── 캐릭터 스토리 아크 ────────────────────────────────────────
function buildCharacterArc(opts = {}) {
  const { characterName = '주인공', genre = '로맨스', episodes = 12 } = opts;

  const arcStages = {
    setup:        Math.ceil(episodes * 0.25),
    conflict:     Math.ceil(episodes * 0.35),
    climax:       Math.ceil(episodes * 0.25),
    resolution:   Math.floor(episodes * 0.15),
  };

  return {
    characterName,
    genre,
    totalEpisodes: episodes,
    arcStages,
    emotionalJourney: [
      { stage: '도입부',   emotion: '설렘·호기심',   episodes: `1-${arcStages.setup}` },
      { stage: '갈등',     emotion: '긴장·불안',     episodes: `${arcStages.setup + 1}-${arcStages.setup + arcStages.conflict}` },
      { stage: '클라이맥스', emotion: '절정·결심',  episodes: `${episodes - arcStages.climax}-${episodes - arcStages.resolution}` },
      { stage: '해소',     emotion: '안도·성장',     episodes: `${episodes - arcStages.resolution + 1}-${episodes}` },
    ],
    characterGrowth: [
      '소극적 → 주체적',
      '의존 → 독립',
      '상처 → 치유',
    ],
  };
}

// ── AI영상생성 ────────────────────────────────────────────────
const VIDEO_STYLES = {
  cinematic:   { fps: 24, ratio: '16:9', look: 'cinematic, film grain, anamorphic lens' },
  social_short:{ fps: 30, ratio: '9:16', look: 'bright, punchy, social media optimized' },
  animation:   { fps: 24, ratio: '16:9', look: 'animation, smooth motion, vivid colors' },
  documentary: { fps: 25, ratio: '16:9', look: 'documentary, natural light, handheld camera' },
  music_video: { fps: 30, ratio: '16:9', look: 'music video, dynamic cuts, stylized' },
};

function generateVideoStoryboard(opts = {}) {
  const {
    title       = '영상 프로젝트',
    concept     = '제품 소개',
    duration    = 60,   // seconds
    style       = 'cinematic',
    scenes      = 5,
  } = opts;

  const vidStyle = VIDEO_STYLES[style] || VIDEO_STYLES.cinematic;
  const secPerScene = Math.floor(duration / scenes);

  const storyboard = Array.from({ length: scenes }, (_, i) => ({
    scene:     i + 1,
    duration:  secPerScene,
    type:      i === 0 ? 'opening' : i === scenes - 1 ? 'closing' : 'main',
    visual:    `Scene ${i + 1}: ${concept} — 시각적 묘사 (${vidStyle.look})`,
    voiceover: `씬 ${i + 1} 나레이션/대사 텍스트`,
    cameraMove: ['static', 'pan left', 'zoom in', 'tracking', 'crane up'][i % 5],
    aiPrompt:  `${vidStyle.look}, scene ${i + 1} of ${scenes}, ${concept}, ${vidStyle.ratio} aspect ratio, ${vidStyle.fps}fps`,
    transition: i < scenes - 1 ? ['cut', 'dissolve', 'wipe', 'fade'][i % 4] : 'fade out',
  }));

  // Sora/Runway/Pika 호환 프롬프트
  const aiVideoPrompts = {
    sora:   storyboard.map(s => `${s.aiPrompt}, cinematic quality, 4K`),
    runway: storyboard.map(s => `${s.aiPrompt}, stable generation, coherent motion`),
    pika:   storyboard.map(s => `${s.aiPrompt}, smooth motion, artistic`),
    kling:  storyboard.map(s => `${s.aiPrompt}, Korean market optimized`),
  };

  return {
    title,
    concept,
    totalDuration: `${duration}초`,
    style:         vidStyle,
    storyboard,
    aiVideoPrompts,
    productionNotes: {
      totalShots:    scenes,
      estimatedEdit: `${Math.ceil(duration / 10)}시간`,
      bgmRecommend:  `BPM ${style === 'social_short' ? '120-140' : '80-110'}, 장르: ${concept.includes('감성') ? '어쿠스틱' : '시네마틱 오케스트라'}`,
    },
    stub: true,
  };
}

// ── AI 음악 생성 (작곡 패키지) ───────────────────────────────
const GENRE_PRESETS = {
  kpop:       { bpm: [92, 128], key: ['C Major', 'A Minor', 'F Major'], instruments: ['synth', 'drum machine', 'bass', '808'] },
  ballad:     { bpm: [60, 80],  key: ['D Major', 'B Minor', 'G Major'], instruments: ['piano', 'strings', 'acoustic guitar'] },
  hiphop:     { bpm: [85, 100], key: ['G Minor', 'C Minor'],            instruments: ['808 bass', 'trap drums', 'piano keys'] },
  edm:        { bpm: [128, 145],key: ['A Minor', 'F Major'],            instruments: ['synth lead', 'drop bass', 'arpeggio'] },
  indie_pop:  { bpm: [100, 120],key: ['D Major', 'G Major'],            instruments: ['electric guitar', 'drums', 'bass', 'keys'] },
  cinematic:  { bpm: [60, 90],  key: ['C Minor', 'D Minor'],            instruments: ['orchestra', 'choir', 'timpani', 'strings'] },
  trot:       { bpm: [100, 130],key: ['C Major', 'F Major'],            instruments: ['accordion', 'brass', 'upright bass'] },
};

const CHORD_PROGRESSIONS = {
  happy:   ['I-V-vi-IV', 'I-IV-V-I', 'I-vi-IV-V'],
  sad:     ['vi-IV-I-V', 'i-VII-VI-VII', 'i-iv-VII-III'],
  tension: ['i-VII-i-VII', 'i-bVII-bVI-bVII', 'i-v-bVI-bVII'],
  epic:    ['I-bVII-bVI-bVII', 'i-bIII-bVII-IV', 'I-V-vi-iii-IV'],
};

function composeMusicPackage(opts = {}) {
  const {
    genre    = 'kpop',
    mood     = 'happy',
    title    = '제목 없음',
    theme    = '사랑',
    duration = 210,  // seconds (3:30)
  } = opts;

  const preset = GENRE_PRESETS[genre] || GENRE_PRESETS.kpop;
  const bpm = preset.bpm[0] + Math.floor(Math.random() * (preset.bpm[1] - preset.bpm[0]));
  const key = preset.key[Math.floor(Math.random() * preset.key.length)];
  const chords = CHORD_PROGRESSIONS[mood] || CHORD_PROGRESSIONS.happy;

  // 곡 구조
  const structure = buildSongStructure(genre, duration);

  // 가사 템플릿 (한국어)
  const lyrics = {
    verse1:   `[Verse 1]\n${theme}에 대한 첫 번째 절 가사\n감정을 담아 자연스럽게 흘러가도록\n일상의 순간에서 찾은 의미\n`,
    prechorus:`[Pre-Chorus]\n감정이 고조되는 브릿지 파트\n후렴으로 넘어가는 전환점\n`,
    chorus:   `[Chorus]\n가장 인상적인 후렴구 ×2\n${theme}의 핵심 메시지\n기억에 남는 훅 라인\n`,
    verse2:   `[Verse 2]\n두 번째 절 — 더 깊어진 감정\n`,
    bridge:   `[Bridge]\n예상치 못한 전환\n감정의 해소 또는 극적 반전\n`,
    outro:    `[Outro]\n부드럽게 마무리되는 아웃트로\n`,
  };

  // AI 작곡 툴 프롬프트
  const aiPrompts = {
    suno:    `${genre}, ${mood}, ${key}, ${bpm}bpm, ${theme}, Korean lyrics, ${duration}s`,
    udio:    `Genre: ${genre} | Key: ${key} | BPM: ${bpm} | Mood: ${mood} | Theme: ${theme}`,
    musicgen:`${preset.instruments.join(', ')}, ${bpm}bpm, ${key}, ${mood} mood, no vocals`,
    stable_audio: `${genre} instrumental, ${key}, ${bpm}bpm, ${preset.instruments.join('+')}`,
  };

  return {
    title,
    genre:      GENRE_PRESETS[genre] ? genre : 'kpop',
    mood,
    key,
    bpm,
    chordProgression: chords[0],
    instruments:  preset.instruments,
    structure,
    lyrics,
    aiPrompts,
    productionTips: [
      `메인 리프: ${key} 스케일에서 ${chords[0].split('-')[0]} 코드 중심`,
      `드럼 패턴: ${bpm >= 120 ? '16분음표 하이햇 + 2·4박 스네어' : '8분음표 그루브'}`,
      `믹싱: 보컬 -6dB ~ -3dB, 베이스 -12dB ~ -9dB`,
      `마스터링 목표 LUFS: -14 (스트리밍 최적화)`,
    ],
    estimatedLength: `${Math.floor(duration / 60)}분 ${duration % 60}초`,
    stub: true,
  };
}

function buildSongStructure(genre, duration) {
  const structures = {
    kpop:    ['Intro(8)', 'Verse1(16)', 'PreChorus(8)', 'Chorus(16)', 'Verse2(16)', 'PreChorus(8)', 'Chorus(16)', 'Bridge(8)', 'Chorus(16)', 'Outro(8)'],
    ballad:  ['Intro(8)', 'Verse1(24)', 'Chorus(16)', 'Verse2(24)', 'Chorus(16)', 'Bridge(16)', 'Chorus(16)', 'Outro(8)'],
    hiphop:  ['Intro(4)', 'Verse1(16)', 'Hook(8)', 'Verse2(16)', 'Hook(8)', 'Bridge(8)', 'Verse3(16)', 'Hook(8)', 'Outro(4)'],
    edm:     ['Intro(32)', 'BuildUp(16)', 'Drop1(32)', 'Break(16)', 'BuildUp2(16)', 'Drop2(32)', 'Outro(16)'],
  };
  return (structures[genre] || structures.kpop).map(s => {
    const [name, bars] = s.split('(');
    return { section: name, bars: parseInt(bars), seconds: Math.round(parseInt(bars) * (60 / 120)) };
  });
}

// ── AR 렌더링 (WebXR) ────────────────────────────────────────
function buildARScene(opts = {}) {
  const {
    type      = 'product_showcase', // product_showcase | interior | character | wayfinding
    target    = '상품',
    platform  = 'webxr',
  } = opts;

  const sceneConfig = {
    product_showcase: {
      desc: '상품 3D AR 뷰어',
      interactions: ['rotate', 'scale', 'place_on_surface'],
      lighting: 'environment_map',
      features: ['360° 회전', '실제 크기 배치', '색상 변경'],
    },
    interior: {
      desc: '인테리어 AR 시뮬레이터',
      interactions: ['place_furniture', 'change_material', 'measure'],
      lighting: 'directional_shadow',
      features: ['가구 배치', '색상 시뮬레이션', '면적 측정'],
    },
    character: {
      desc: 'AR 캐릭터 소환',
      interactions: ['animate', 'selfie_mode', 'scale'],
      lighting: 'ambient',
      features: ['표정 변환', '셀피 모드', '크기 조절'],
    },
  };

  const config = sceneConfig[type] || sceneConfig.product_showcase;

  return {
    type,
    target,
    platform,
    ...config,
    codeSnippet: `
// AR.js + Three.js WebXR
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.xr.enabled = true;
document.body.appendChild(ARButton.createButton(renderer));

// ${target} 3D 모델 로드
const loader = new THREE.GLTFLoader();
loader.load('model.glb', (gltf) => {
  scene.add(gltf.scene);
  // Hit-test 기반 배치
});
    `.trim(),
    stub: true,
  };
}

// ── 파이프라인 통합 execute ──────────────────────────────────
async function execute(opts = {}) {
  const { mode = 'character', ...params } = opts;
  switch (mode) {
    case 'character':    return generateCharacterSheet(params);
    case 'character_arc':return buildCharacterArc(params);
    case 'video':        return generateVideoStoryboard(params);
    case 'music':        return composeMusicPackage(params);
    case 'ar':           return buildARScene(params);
    default:             return generateCharacterSheet(params);
  }
}

module.exports = {
  execute,
  generateCharacterSheet,
  buildCharacterArc,
  generateVideoStoryboard,
  composeMusicPackage,
  buildARScene,
  CHARACTER_STYLES,
  VIDEO_STYLES,
  GENRE_PRESETS,
};
