'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync, spawn } = require('child_process');

const PORT     = 8080;
const WEBAPP   = '/home/user/webapp';
const SLIDES   = path.join(WEBAPP, 'samsung_slides');
const CAPTURES = path.join(WEBAPP, 'slide_captures');
const ORCH_PORT = 3000; // AI Orchestrator port

// ══════════════════════════════════════════════════════════════
//  30 COLOR THEMES
// ══════════════════════════════════════════════════════════════
const THEMES = {
  // ── DARK SERIES ──────────────────────────────────────────────
  dark_cosmos:    { name:'Dark Cosmos',    emoji:'🌌', dark:true,  bg1:'#0f0c29', bg2:'#1a1a4e', bg3:'#16213e', accent:'#7c3aed', accent2:'#06b6d4', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,255,255,0.07)', border:'rgba(124,58,237,0.35)', tag:'rgba(124,58,237,0.2)', coverBg:'linear-gradient(135deg,#0f0c29 0%,#1a1a4e 40%,#0f3460 100%)' },
  midnight_blue:  { name:'Midnight Blue',  emoji:'🌊', dark:true,  bg1:'#020617', bg2:'#0f172a', bg3:'#1e293b', accent:'#3b82f6', accent2:'#06b6d4', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,255,255,0.06)', border:'rgba(59,130,246,0.35)', tag:'rgba(59,130,246,0.2)', coverBg:'linear-gradient(135deg,#020617 0%,#0f172a 50%,#1e3a5f 100%)' },
  emerald_dark:   { name:'Emerald Dark',   emoji:'🌿', dark:true,  bg1:'#022c22', bg2:'#064e3b', bg3:'#065f46', accent:'#10b981', accent2:'#34d399', text:'#ffffff', sub:'rgba(255,255,255,0.75)', card:'rgba(255,255,255,0.06)', border:'rgba(16,185,129,0.3)', tag:'rgba(16,185,129,0.2)', coverBg:'linear-gradient(135deg,#022c22 0%,#064e3b 50%,#065f46 100%)' },
  crimson_night:  { name:'Crimson Night',  emoji:'🔴', dark:true,  bg1:'#1a0a0a', bg2:'#2d1010', bg3:'#1f1520', accent:'#ef4444', accent2:'#f97316', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,255,255,0.06)', border:'rgba(239,68,68,0.3)', tag:'rgba(239,68,68,0.2)', coverBg:'linear-gradient(135deg,#1a0a0a 0%,#2d1010 50%,#3d1515 100%)' },
  golden_hour:    { name:'Golden Hour',    emoji:'✨', dark:true,  bg1:'#1a1000', bg2:'#2d1f00', bg3:'#1f1a0d', accent:'#f59e0b', accent2:'#fb923c', text:'#ffffff', sub:'rgba(255,255,255,0.75)', card:'rgba(255,255,255,0.07)', border:'rgba(245,158,11,0.35)', tag:'rgba(245,158,11,0.2)', coverBg:'linear-gradient(135deg,#1a1000 0%,#2d1f00 50%,#3d2a00 100%)' },
  rose_quartz:    { name:'Rose Quartz',    emoji:'🌸', dark:true,  bg1:'#1a0d15', bg2:'#2d1528', bg3:'#1f1020', accent:'#ec4899', accent2:'#a855f7', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,255,255,0.06)', border:'rgba(236,72,153,0.3)', tag:'rgba(236,72,153,0.2)', coverBg:'linear-gradient(135deg,#1a0d15 0%,#2d1528 50%,#1f1035 100%)' },
  neon_cyber:     { name:'Neon Cyber',     emoji:'⚡', dark:true,  bg1:'#000000', bg2:'#050510', bg3:'#0a0018', accent:'#00ff88', accent2:'#00ccff', text:'#ffffff', sub:'rgba(255,255,255,0.65)', card:'rgba(0,255,136,0.06)', border:'rgba(0,255,136,0.25)', tag:'rgba(0,255,136,0.15)', coverBg:'linear-gradient(135deg,#000000 0%,#050510 50%,#0a0020 100%)' },
  aurora_borealis:{ name:'Aurora Borealis',emoji:'🌈', dark:true,  bg1:'#020f1a', bg2:'#041c2c', bg3:'#062a3f', accent:'#00d4ff', accent2:'#a0ff6e', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(0,212,255,0.07)', border:'rgba(0,212,255,0.3)', tag:'rgba(0,212,255,0.2)', coverBg:'linear-gradient(135deg,#020f1a 0%,#041c2c 40%,#0a2540 100%)' },
  void_purple:    { name:'Void Purple',    emoji:'💜', dark:true,  bg1:'#07030f', bg2:'#0f0520', bg3:'#16082e', accent:'#9333ea', accent2:'#c084fc', text:'#ffffff', sub:'rgba(255,255,255,0.65)', card:'rgba(147,51,234,0.08)', border:'rgba(147,51,234,0.3)', tag:'rgba(147,51,234,0.2)', coverBg:'linear-gradient(135deg,#07030f 0%,#0f0520 50%,#1a0a38 100%)' },
  obsidian:       { name:'Obsidian',       emoji:'🖤', dark:true,  bg1:'#0a0a0a', bg2:'#141414', bg3:'#1a1a1a', accent:'#e2e8f0', accent2:'#94a3b8', text:'#ffffff', sub:'rgba(255,255,255,0.6)', card:'rgba(255,255,255,0.05)', border:'rgba(226,232,240,0.2)', tag:'rgba(226,232,240,0.1)', coverBg:'linear-gradient(135deg,#0a0a0a 0%,#141414 50%,#1e1e1e 100%)' },

  // ── GRADIENT DARK ─────────────────────────────────────────────
  deep_ocean:     { name:'Deep Ocean',     emoji:'🐋', dark:true,  bg1:'#001520', bg2:'#002540', bg3:'#003055', accent:'#00bfff', accent2:'#4dd0e1', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(0,191,255,0.07)', border:'rgba(0,191,255,0.3)', tag:'rgba(0,191,255,0.2)', coverBg:'linear-gradient(135deg,#001520 0%,#002540 50%,#004060 100%)' },
  sunset_glow:    { name:'Sunset Glow',    emoji:'🌅', dark:true,  bg1:'#1a0810', bg2:'#2d0f1a', bg3:'#3d1520', accent:'#ff6b6b', accent2:'#ffa500', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,107,107,0.07)', border:'rgba(255,107,107,0.3)', tag:'rgba(255,107,107,0.2)', coverBg:'linear-gradient(135deg,#1a0810 0%,#2d0f1a 40%,#3d1a0a 100%)' },
  forest_night:   { name:'Forest Night',   emoji:'🌲', dark:true,  bg1:'#061208', bg2:'#0a1f0c', bg3:'#0f2b10', accent:'#4ade80', accent2:'#86efac', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(74,222,128,0.07)', border:'rgba(74,222,128,0.3)', tag:'rgba(74,222,128,0.2)', coverBg:'linear-gradient(135deg,#061208 0%,#0a1f0c 50%,#102510 100%)' },
  electric_indigo:{ name:'Electric Indigo',emoji:'⚡', dark:true,  bg1:'#0c0520', bg2:'#160a35', bg3:'#1e1045', accent:'#818cf8', accent2:'#a78bfa', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(129,140,248,0.07)', border:'rgba(129,140,248,0.3)', tag:'rgba(129,140,248,0.2)', coverBg:'linear-gradient(135deg,#0c0520 0%,#160a35 50%,#200f4a 100%)' },
  copper_dark:    { name:'Copper Dark',    emoji:'🔶', dark:true,  bg1:'#180a00', bg2:'#2a1500', bg3:'#351a00', accent:'#ea580c', accent2:'#f97316', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(234,88,12,0.07)', border:'rgba(234,88,12,0.3)', tag:'rgba(234,88,12,0.2)', coverBg:'linear-gradient(135deg,#180a00 0%,#2a1500 50%,#382000 100%)' },

  // ── LIGHT / CORPORATE ─────────────────────────────────────────
  corporate_white:{ name:'Corporate White',emoji:'🏢', dark:false, bg1:'#f8fafc', bg2:'#f1f5f9', bg3:'#e2e8f0', accent:'#1e40af', accent2:'#0891b2', text:'#0f172a', sub:'rgba(15,23,42,0.65)', card:'rgba(15,23,42,0.05)', border:'rgba(30,64,175,0.2)', tag:'rgba(30,64,175,0.1)', coverBg:'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 50%,#dbeafe 100%)' },
  sky_light:      { name:'Sky Light',      emoji:'☁️', dark:false, bg1:'#f0f9ff', bg2:'#e0f2fe', bg3:'#bae6fd', accent:'#0284c7', accent2:'#0369a1', text:'#0c4a6e', sub:'rgba(12,74,110,0.65)', card:'rgba(2,132,199,0.08)', border:'rgba(2,132,199,0.2)', tag:'rgba(2,132,199,0.15)', coverBg:'linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 50%,#bae6fd 100%)' },
  mint_fresh:     { name:'Mint Fresh',     emoji:'🍃', dark:false, bg1:'#f0fdf4', bg2:'#dcfce7', bg3:'#bbf7d0', accent:'#15803d', accent2:'#059669', text:'#14532d', sub:'rgba(20,83,45,0.65)', card:'rgba(21,128,61,0.08)', border:'rgba(21,128,61,0.2)', tag:'rgba(21,128,61,0.15)', coverBg:'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 50%,#bbf7d0 100%)' },
  warm_sand:      { name:'Warm Sand',      emoji:'🏖️', dark:false, bg1:'#fefce8', bg2:'#fef3c7', bg3:'#fde68a', accent:'#b45309', accent2:'#d97706', text:'#78350f', sub:'rgba(120,53,15,0.65)', card:'rgba(180,83,9,0.08)', border:'rgba(180,83,9,0.2)', tag:'rgba(180,83,9,0.15)', coverBg:'linear-gradient(135deg,#fefce8 0%,#fef3c7 50%,#fde68a 100%)' },
  rose_light:     { name:'Rose Light',     emoji:'🌹', dark:false, bg1:'#fff1f2', bg2:'#ffe4e6', bg3:'#fecdd3', accent:'#be123c', accent2:'#e11d48', text:'#881337', sub:'rgba(136,19,55,0.65)', card:'rgba(190,18,60,0.08)', border:'rgba(190,18,60,0.2)', tag:'rgba(190,18,60,0.15)', coverBg:'linear-gradient(135deg,#fff1f2 0%,#ffe4e6 50%,#fecdd3 100%)' },

  // ── PREMIUM / SPECIAL ─────────────────────────────────────────
  samsung_blue:   { name:'Samsung Blue',   emoji:'📱', dark:true,  bg1:'#000918', bg2:'#001228', bg3:'#001a35', accent:'#1428a0', accent2:'#00b3e6', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(0,179,230,0.07)', border:'rgba(20,40,160,0.4)', tag:'rgba(0,179,230,0.2)', coverBg:'linear-gradient(135deg,#000918 0%,#001228 40%,#001a35 100%)' },
  galaxy_dark:    { name:'Galaxy Dark',    emoji:'🌠', dark:true,  bg1:'#050508', bg2:'#0a0a15', bg3:'#0f0f22', accent:'#6366f1', accent2:'#8b5cf6', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(99,102,241,0.07)', border:'rgba(99,102,241,0.3)', tag:'rgba(99,102,241,0.2)', coverBg:'linear-gradient(135deg,#050508 0%,#0a0a15 40%,#12103a 100%)' },
  finance_dark:   { name:'Finance Dark',   emoji:'💰', dark:true,  bg1:'#030c09', bg2:'#051a12', bg3:'#07251a', accent:'#00c853', accent2:'#69f0ae', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(0,200,83,0.07)', border:'rgba(0,200,83,0.3)', tag:'rgba(0,200,83,0.2)', coverBg:'linear-gradient(135deg,#030c09 0%,#051a12 40%,#082e1e 100%)' },
  tech_teal:      { name:'Tech Teal',      emoji:'🤖', dark:true,  bg1:'#011b1a', bg2:'#02302e', bg3:'#034040', accent:'#14b8a6', accent2:'#2dd4bf', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(20,184,166,0.07)', border:'rgba(20,184,166,0.3)', tag:'rgba(20,184,166,0.2)', coverBg:'linear-gradient(135deg,#011b1a 0%,#02302e 50%,#034545 100%)' },
  luxury_gold:    { name:'Luxury Gold',    emoji:'👑', dark:true,  bg1:'#0d0900', bg2:'#1a1200', bg3:'#261a00', accent:'#d4af37', accent2:'#ffd700', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(212,175,55,0.08)', border:'rgba(212,175,55,0.35)', tag:'rgba(212,175,55,0.2)', coverBg:'linear-gradient(135deg,#0d0900 0%,#1a1200 50%,#2a1c00 100%)' },
  steel_blue:     { name:'Steel Blue',     emoji:'🔩', dark:true,  bg1:'#0a1628', bg2:'#0f2040', bg3:'#152850', accent:'#5b9bd5', accent2:'#7dbcea', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(91,155,213,0.07)', border:'rgba(91,155,213,0.3)', tag:'rgba(91,155,213,0.2)', coverBg:'linear-gradient(135deg,#0a1628 0%,#0f2040 50%,#152855 100%)' },
  // ── BONUS 4 ────────────────────────────────────────────────
  ice_crystal:    { name:'Ice Crystal',    emoji:'❄️', dark:false, bg1:'#eef9ff', bg2:'#d6f1ff', bg3:'#b8e8ff', accent:'#0369a1', accent2:'#0ea5e9', text:'#0c2a3d', sub:'rgba(12,42,61,0.65)', card:'rgba(3,105,161,0.07)', border:'rgba(3,105,161,0.2)', tag:'rgba(3,105,161,0.12)', coverBg:'linear-gradient(135deg,#eef9ff 0%,#d6f1ff 50%,#b8e8ff 100%)' },
  molten_lava:    { name:'Molten Lava',    emoji:'🌋', dark:true,  bg1:'#150000', bg2:'#2a0500', bg3:'#350a00', accent:'#ff4500', accent2:'#ff8c00', text:'#ffffff', sub:'rgba(255,255,255,0.7)', card:'rgba(255,69,0,0.07)', border:'rgba(255,69,0,0.3)', tag:'rgba(255,69,0,0.2)', coverBg:'linear-gradient(135deg,#150000 0%,#2a0500 50%,#380a00 100%)' },
  carbon_fiber:   { name:'Carbon Fiber',  emoji:'🏎️', dark:true,  bg1:'#0a0a0a', bg2:'#111111', bg3:'#181818', accent:'#c0c0c0', accent2:'#e8e8e8', text:'#ffffff', sub:'rgba(255,255,255,0.6)', card:'rgba(192,192,192,0.06)', border:'rgba(192,192,192,0.2)', tag:'rgba(192,192,192,0.12)', coverBg:'linear-gradient(135deg,#0a0a0a 0%,#111111 50%,#1c1c1c 100%)' },
  ocean_breeze:   { name:'Ocean Breeze',  emoji:'🌊', dark:false, bg1:'#f0f8ff', bg2:'#e0f0ff', bg3:'#c8e6ff', accent:'#1565c0', accent2:'#42a5f5', text:'#0a2540', sub:'rgba(10,37,64,0.65)', card:'rgba(21,101,192,0.07)', border:'rgba(21,101,192,0.2)', tag:'rgba(21,101,192,0.12)', coverBg:'linear-gradient(135deg,#f0f8ff 0%,#e0f0ff 50%,#c8e6ff 100%)' },
};

// ══════════════════════════════════════════════════════════════
//  10 FONT COMBOS
// ══════════════════════════════════════════════════════════════
const FONTS = {
  noto_sans_kr:   { name:'Noto Sans KR',       label:'깔끔·가독성', sample:'나눔 Aa',  family:"'Noto Sans KR','Malgun Gothic',sans-serif",  gfontUrl:'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap', localPath:null },
  nanum_square:   { name:'NanumSquare',         label:'임팩트·현대적', sample:'스퀘어 Aa', family:"'NanumSquare','나눔스퀘어',sans-serif",      gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumSquareEB.ttf' },
  nanum_barun:    { name:'NanumBarunGothic',    label:'명확·프로', sample:'바른 Aa',   family:"'NanumBarunGothic','나눔바른고딕',sans-serif",gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf' },
  noto_serif_kr:  { name:'Noto Serif KR',       label:'격식·고급', sample:'세리프 Aa', family:"'Noto Serif CJK KR','나눔명조',serif",         gfontUrl:null, localPath:'/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc' },
  nanum_gothic:   { name:'NanumGothic',         label:'대중·범용', sample:'고딕 Aa',   family:"'NanumGothic','나눔고딕',sans-serif",          gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf' },
  nanum_myeongjo: { name:'NanumMyeongjo',       label:'전통·고전', sample:'명조 Aa',   family:"'NanumMyeongjo','나눔명조',serif",             gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumMyeongjoExtraBold.ttf' },
  nanum_square_round:{ name:'NanumSquareRound', label:'친근·부드러움', sample:'둥근 Aa', family:"'NanumSquareRound','나눔스퀘어라운드',sans-serif", gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumSquareRoundEB.ttf' },
  nanum_barun_pen:{ name:'NanumBarunpen',       label:'손글씨·개성', sample:'펜 Aa',    family:"'NanumBarunpen','나눔바른펜',sans-serif",      gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumBarunpen.ttf' },
  noto_sans_cjk:  { name:'Noto Sans CJK KR',   label:'범용·균형', sample:'CJK Aa',    family:"'Noto Sans CJK KR','Noto Sans KR',sans-serif", gfontUrl:null, localPath:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc' },
  nanum_brush:    { name:'Nanum Brush',         label:'아트·붓글씨', sample:'붓 Aa',    family:"'Nanum Brush Script','나눔손글씨 붓',cursive", gfontUrl:null, localPath:'/usr/share/fonts/truetype/nanum/NanumBrush.ttf' },
};

// ══════════════════════════════════════════════════════════════
//  SLIDES DATA (full)
// ══════════════════════════════════════════════════════════════
const SLIDE_DATA = {
  slides: [
    { type:'summary',    tag:'핵심 요약',   title:'2025년 삼성전자\n사상 최대 실적 달성',
      kpis:[
        { value:'333.6조', label:'연간 매출',      sub:'역대 최고치',    color:'#7c3aed' },
        { value:'43.6조',  label:'영업이익',       sub:'전년比 +33%',    color:'#06b6d4' },
        { value:'45.2조',  label:'순이익',         sub:'전년比 +31%',    color:'#10b981' },
        { value:'20.1조',  label:'Q4 영업이익',    sub:'분기 역대 최고', color:'#f59e0b' },
      ]
    },
    { type:'chart_bar',  tag:'실적 추이',   title:'분기별 영업이익 흐름 (2024~2025)',
      bars:[
        { label:'24Q1', value:6.6,  color:'#4f46e5' },
        { label:'24Q2', value:10.4, color:'#4f46e5' },
        { label:'24Q3', value:9.2,  color:'#4f46e5' },
        { label:'24Q4', value:6.5,  color:'#4f46e5' },
        { label:'25Q1', value:6.7,  color:'#7c3aed' },
        { label:'25Q2', value:10.1, color:'#7c3aed' },
        { label:'25Q3', value:9.2,  color:'#7c3aed' },
        { label:'25Q4', value:20.1, color:'#06b6d4', highlight:true },
      ],
      unit:'조원', note:'2025년 4분기 20.1조원 — 분기 창사 이래 최초 20조 돌파'
    },
    { type:'division',   tag:'사업부 분석', title:'2025 Q4 사업부별 성과',
      divisions:[
        { name:'DS (반도체)',   revenue:'44조',  profit:'16.4조', share:'81.7', icon:'🔵', note:'HBM3E 본격 공급·서버D램 급성장', color:'#7c3aed' },
        { name:'DX (MX+가전)', revenue:'44.3조',profit:'1.3조',  share:'6.5',  icon:'📱', note:'갤럭시S25 판매 호조, 가전 부진', color:'#06b6d4' },
        { name:'Harman',       revenue:'4.6조', profit:'0.6조',  share:'3.0',  icon:'🎵', note:'프리미엄 오디오 안정적 성장',   color:'#10b981' },
      ]
    },
    { type:'hbm',        tag:'HBM 전략',    title:'AI 반도체 HBM — 핵심 성장 동력',
      points:[
        '2025년 HBM 매출 약 9조원 (전년比 3배↑)',
        '2026년 HBM 매출 3배 추가 확대 목표',
        'HBM3E (5세대) 엔비디아 H200·GB200 공급 확대',
        '2026년 2월 업계 최초 HBM4 양산 출하 발표',
        '반도체 DS 부문, 전체 영업이익의 81.7% 기여',
        '서버 D램 수요 급증 → ASP(평균판가) 지속 상승',
      ],
      stat:{ label:'DS 영업이익 증가율', value:'+465%', sub:'전년 동기 대비' }
    },
    { type:'comparison', tag:'파운드리 경쟁', title:'삼성 vs TSMC — 파운드리 전쟁',
      left:{
        title:'삼성 파운드리', icon:'🇰🇷', color:'#7c3aed',
        points:['2nm 공정 수율 20~40% (개선 중)','엑시노스 2600 자체 칩 채택','2026년 GAA 2nm 수주 확대 추진','퀄컴·구글 일부 물량 수주 성공','TSMC 독점 구조 일부 균열 시작'],
      },
      right:{
        title:'TSMC', icon:'🇹🇼', color:'#06b6d4',
        points:['2nm 수율 60% 이상 (압도적 우위)','애플·엔비디아·AMD 2nm 독점','2026년 매출 +30% 성장 가이던스','2nm CoWoS 패키징 기술 선도','시가총액 삼성 대비 2배 이상'],
      },
    },
    { type:'mobile',     tag:'모바일 전략', title:'갤럭시 AI — 스마트폰 경쟁력',
      points:[
        '2025 글로벌 스마트폰 출하 1위 유지 (60.6M units/Q1)',
        '갤럭시 S25 · Z폴드7 · Z플립7 판매 호조',
        'Galaxy AI 기능 전 라인업 확대',
        '갤럭시 S26 시리즈 2026 상반기 공개 예정',
        '엑시노스 2600 자체 탑재로 AP 원가 절감',
        '미주 매출 비중 39.9% (133조원) 역대 최고',
      ],
      stat:{ label:'MX 상반기 영업이익', value:'7.4조', sub:'2025 상반기 누적' }
    },
    { type:'region',     tag:'글로벌 매출', title:'2025 매출 지역 구조',
      regions:[
        { name:'미주',  value:133.3, pct:40, color:'#7c3aed' },
        { name:'아시아',value:73.4,  pct:22, color:'#06b6d4' },
        { name:'유럽',  value:46.7,  pct:14, color:'#10b981' },
        { name:'중국',  value:46.7,  pct:14, color:'#f59e0b' },
        { name:'기타',  value:33.5,  pct:10, color:'#ec4899' },
      ],
      note:'미주 비중 역대 최고(40%) — AI 데이터센터 수요 집중'
    },
    { type:'risk',       tag:'리스크 분석', title:'2026 주요 리스크 요인',
      risks:[
        { icon:'🇺🇸', title:'미국 관세 리스크',   level:'high', desc:'트럼프 관세 25% 부과시 MX 수익성 급격 악화 가능', response:'현지화·공급망 다변화로 대응' },
        { icon:'⚙️', title:'파운드리 수율 격차',  level:'high', desc:'TSMC 대비 2nm 수율 열세로 고마진 수주 제한',    response:'GAA 2nm 기술 집중 투자 중' },
        { icon:'📉', title:'메모리 가격 변동성', level:'mid',  desc:'2026 공급 과잉 시 DRAM ASP 하락 우려',         response:'HBM·서버D램 프리미엄 전환' },
        { icon:'💹', title:'AI 버블 우려',        level:'mid',  desc:'빅테크 AI 투자 감속 시 HBM/서버D램 수요 위축', response:'다양한 고객사·제품군 확대' },
      ]
    },
    { type:'outlook',    tag:'2026 전망',   title:'2026 성장 전략 및 목표',
      items:[
        { icon:'🚀', title:'HBM4 양산 확대',    desc:'HBM4 생산 3배 확대 목표, 차세대 AI 가속기 공급' },
        { icon:'⚡', title:'2nm 파운드리 반격', desc:'GAA 2nm 수율 개선으로 퀄컴·구글 수주 확대' },
        { icon:'📱', title:'갤럭시 S26 출격',   desc:'온디바이스 AI·엑시노스 탑재, 폼팩터 혁신' },
        { icon:'🤖', title:'AI 데이터센터',     desc:'HBM+서버D램+파운드리 통합 솔루션 공급' },
        { icon:'💎', title:'주주환원 강화',     desc:'배당 확대·자사주 매입으로 주주가치 제고' },
      ],
      target:{ label:'목표 주가', value:'27~32만원', sub:'+30~50% 상승여력' }
    },
    { type:'conclusion', tag:'투자 결론',  title:'삼성전자 투자 의견',
      message:'2025 사상 최대 실적 달성을 확인했습니다. HBM4 양산, 2nm 파운드리 회복, AI 수요 수혜로 2026년 추가 성장이 기대됩니다.',
      points:[
        'HBM4 양산 선도로 AI 반도체 시장 재편 수혜',
        '2nm GAA 수율 개선 시 파운드리 점유율 확대',
        'DS 부문 영업레버리지 효과 지속',
        '주주환원 정책 강화로 밸류에이션 재평가 기대',
      ],
      rating:{ grade:'BUY', price:'29만원', range:'27~32만원' }
    },
  ]
};

// ── HTML SLIDE GENERATORS ────────────────────────────────────────
function makeCSS(t, f) {
  const fontImport = f.gfontUrl ? `@import url('${f.gfontUrl}');` : '';
  const fontFace   = f.localPath ? `
@font-face {
  font-family: '${f.name}';
  src: url('${f.localPath}') format('truetype');
  font-weight: 700;
}` : '';
  return `${fontImport}${fontFace}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:1280px;height:720px;overflow:hidden;background:${t.bg1};}
body{font-family:${f.family};color:${t.text};background:${t.bg1};display:flex;flex-direction:column;}
.slide{width:1280px;height:720px;display:flex;flex-direction:column;position:relative;overflow:hidden;background:linear-gradient(160deg,${t.bg1} 0%,${t.bg2} 60%,${t.bg3} 100%);}
.top-bar{height:5px;background:linear-gradient(90deg,${t.accent},${t.accent2});width:100%;flex-shrink:0;}
.bot-bar{height:3px;background:linear-gradient(90deg,${t.accent}88,${t.accent2}88);width:100%;flex-shrink:0;margin-top:auto;}
.header{padding:18px 40px 10px;flex-shrink:0;}
.tag{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;background:${t.tag};color:${t.accent};border:1px solid ${t.border};margin-bottom:8px;}
.title{font-size:28px;font-weight:900;line-height:1.25;color:${t.text};}
.title span{color:${t.accent};}
.body{flex:1;display:flex;padding:0 40px 16px;gap:20px;min-height:0;}
.num{position:absolute;bottom:14px;right:24px;font-size:10px;color:${t.sub};opacity:0.5;}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;width:100%;}
.kpi-card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:20px;display:flex;flex-direction:column;justify-content:space-between;min-height:120px;}
.kpi-val{font-size:34px;font-weight:900;line-height:1;}
.kpi-label{font-size:13px;color:${t.sub};margin-top:6px;}
.kpi-sub{font-size:11px;color:${t.sub};opacity:0.8;margin-top:4px;}
.card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:18px;}
.stat-box{background:linear-gradient(135deg,${t.accent}22,${t.accent2}22);border:1px solid ${t.accent};border-radius:14px;padding:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
.stat-val{font-size:42px;font-weight:900;color:${t.accent};line-height:1;}
.stat-label{font-size:12px;color:${t.sub};margin-bottom:4px;}
.stat-sub{font-size:11px;color:${t.sub};margin-top:6px;opacity:0.8;}
.pt-list{display:flex;flex-direction:column;gap:10px;}
.pt{display:flex;align-items:flex-start;gap:10px;font-size:13.5px;line-height:1.5;color:${t.text};}
.pt::before{content:'▶';color:${t.accent};font-size:10px;margin-top:3px;flex-shrink:0;}
.bar-area{display:flex;align-items:flex-end;gap:8px;height:200px;padding-bottom:28px;border-bottom:1px solid ${t.border};position:relative;}
.bar-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;}
.bar{border-radius:6px 6px 0 0;transition:all .3s;position:relative;min-height:8px;}
.bar-val{font-size:11px;font-weight:700;color:${t.text};text-align:center;}
.bar-lbl{font-size:11px;color:${t.sub};text-align:center;margin-top:4px;}
.hl-bar{box-shadow:0 0 16px ${t.accent}88;}
.note{font-size:11.5px;color:${t.sub};margin-top:10px;padding:8px 14px;background:${t.card};border-radius:8px;border-left:3px solid ${t.accent};}
.div-grid{display:flex;flex-direction:column;gap:14px;flex:1;}
.div-card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:20px;flex:1;}
.div-icon{font-size:28px;flex-shrink:0;}
.div-info{flex:1;}
.div-name{font-size:15px;font-weight:800;margin-bottom:4px;}
.div-metrics{display:flex;gap:20px;margin-top:6px;}
.div-metric{display:flex;flex-direction:column;}
.dm-val{font-size:20px;font-weight:900;}
.dm-key{font-size:10px;color:${t.sub};}
.div-bar-bg{height:6px;background:${t.border};border-radius:3px;margin-top:8px;flex:1;}
.div-bar-fill{height:6px;border-radius:3px;}
.cmp-wrap{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;flex:1;align-items:stretch;}
.cmp-card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:8px;}
.cmp-title{font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px;}
.cmp-vs{display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:${t.accent};}
.cmp-pt{font-size:12.5px;color:${t.sub};padding:6px 8px;background:${t.bg2};border-radius:6px;border-left:3px solid ${t.accent};}
.rg-wrap{flex:1;display:flex;flex-direction:column;gap:10px;justify-content:space-around;}
.rg-row{display:flex;align-items:center;gap:12px;}
.rg-name{width:50px;font-size:12px;color:${t.sub};text-align:right;flex-shrink:0;}
.rg-bar-bg{flex:1;height:24px;background:${t.border};border-radius:4px;overflow:hidden;}
.rg-bar-fill{height:100%;border-radius:4px;display:flex;align-items:center;padding-left:8px;font-size:12px;font-weight:700;color:#fff;}
.rg-val{width:60px;font-size:12px;font-weight:700;text-align:right;flex-shrink:0;}
.risk-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;}
.risk-card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;}
.risk-head{display:flex;align-items:center;gap:10px;}
.risk-icon{font-size:22px;}
.risk-title{font-size:14px;font-weight:800;}
.risk-badge{margin-left:auto;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;}
.badge-high{background:#ef444422;color:#ef4444;border:1px solid #ef444444;}
.badge-mid{background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44;}
.risk-desc{font-size:12px;color:${t.sub};line-height:1.5;}
.risk-resp{font-size:11px;color:${t.accent};border-top:1px solid ${t.border};padding-top:6px;margin-top:auto;}
.otl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;flex:1;}
.otl-card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px;}
.otl-icon{font-size:24px;}
.otl-title{font-size:13px;font-weight:800;}
.otl-desc{font-size:11.5px;color:${t.sub};line-height:1.4;flex:1;}
.otl-side{display:flex;flex-direction:column;gap:12px;width:220px;flex-shrink:0;}
.target-box{background:linear-gradient(135deg,${t.accent}22,${t.accent2}22);border:1px solid ${t.accent};border-radius:14px;padding:20px;text-align:center;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.target-label{font-size:11px;color:${t.sub};margin-bottom:6px;}
.target-val{font-size:28px;font-weight:900;color:${t.accent};}
.target-sub{font-size:12px;color:${t.sub};margin-top:4px;}
.conc-body{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;}
.msg-box{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:20px;font-size:13.5px;line-height:1.7;color:${t.text};grid-column:1/-1;}
.conc-pts{display:flex;flex-direction:column;gap:10px;padding:16px;background:${t.card};border:1px solid ${t.border};border-radius:14px;}
.rating-box{background:linear-gradient(135deg,${t.accent}22,${t.accent2}22);border:2px solid ${t.accent};border-radius:14px;padding:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;}
.rating-grade{font-size:40px;font-weight:900;color:${t.accent};}
.rating-price{font-size:22px;font-weight:900;}
.rating-range{font-size:12px;color:${t.sub};}`;
}

function slideHTML(body, theme, font, num, tot) {
  const css = makeCSS(theme, font);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body><div class="slide">
<div class="top-bar"></div>
${body}
<div class="bot-bar"></div>
<div class="num">${num} / ${tot}</div>
</div></body></html>`;
}

function genCover(t, f) {
  const css = makeCSS(t, f);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}
.cover{width:1280px;height:720px;background:${t.coverBg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;position:relative;}
.cover-tag{padding:6px 20px;border-radius:30px;background:${t.accent}22;border:1px solid ${t.accent};color:${t.accent};font-size:12px;font-weight:700;letter-spacing:2px;}
.cover-title{font-size:52px;font-weight:900;text-align:center;line-height:1.15;}
.cover-sub{font-size:18px;color:${t.sub};text-align:center;}
.cover-line{width:120px;height:3px;background:linear-gradient(90deg,${t.accent},${t.accent2});border-radius:2px;}
.cover-date{font-size:12px;color:${t.sub};opacity:0.6;position:absolute;bottom:24px;}
.deco{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none;}
</style></head><body><div class="cover">
<div class="deco" style="width:400px;height:400px;background:${t.accent}15;top:-100px;left:-80px;"></div>
<div class="deco" style="width:350px;height:350px;background:${t.accent2}15;bottom:-80px;right:-60px;"></div>
<div class="cover-tag">SAMSUNG ELECTRONICS 2025</div>
<div class="cover-title" style="color:${t.text}">삼성전자<br><span style="color:${t.accent}">2025 종합 분석</span></div>
<div class="cover-line"></div>
<div class="cover-sub">HBM 반도체 주도 · 사상 최대 실적 달성 · 2026 성장 전략</div>
<div class="cover-date">2026년 3월 · 투자분석 리포트</div>
</div></body></html>`;
}

function genSlide(s, t, f, n, tot) {
  let body = '';
  if (s.type === 'summary') {
    const kpiHtml = s.kpis.map(k => `
<div class="kpi-card" style="border-color:${k.color}44;">
  <div>
    <div class="kpi-val" style="color:${k.color}">${k.value}</div>
    <div class="kpi-label">${k.label}</div>
  </div>
  <div class="kpi-sub">${k.sub}</div>
</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title.replace('\n','<br>')}</div></div>
<div class="body"><div class="kpi-grid">${kpiHtml}</div></div>`;
  }
  else if (s.type === 'chart_bar') {
    const maxV = Math.max(...s.bars.map(b=>b.value));
    const barHtml = s.bars.map(b=>`
<div class="bar-wrap">
  <div class="bar-val">${b.value}조</div>
  <div class="bar ${b.highlight?'hl-bar':''}" style="width:100%;height:${Math.max(8,Math.round(b.value/maxV*180))}px;background:${b.highlight?t.accent:b.color};"></div>
  <div class="bar-lbl">${b.label}</div>
</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="flex-direction:column;">
  <div class="bar-area">${barHtml}</div>
  <div class="note">${s.note}</div>
</div>`;
  }
  else if (s.type === 'division') {
    const divHtml = s.divisions.map(d=>`
<div class="div-card" style="border-color:${d.color}44;">
  <div class="div-icon">${d.icon}</div>
  <div class="div-info" style="flex:1;">
    <div class="div-name" style="color:${d.color}">${d.name}</div>
    <div style="font-size:11.5px;color:${t.sub}">${d.note}</div>
    <div class="div-metrics">
      <div class="div-metric"><div class="dm-val" style="color:${d.color}">${d.revenue}</div><div class="dm-key">매출</div></div>
      <div class="div-metric"><div class="dm-val" style="color:${d.color}">${d.profit}</div><div class="dm-key">영업이익</div></div>
      <div class="div-metric"><div class="dm-val" style="color:${d.color}">${d.share}%</div><div class="dm-key">이익 비중</div></div>
    </div>
  </div>
  <div style="width:180px;flex-shrink:0;">
    <div style="font-size:10px;color:${t.sub};margin-bottom:4px;">이익 비중</div>
    <div class="div-bar-bg"><div class="div-bar-fill" style="width:${d.share}%;background:${d.color};height:6px;border-radius:3px;"></div></div>
    <div style="font-size:18px;font-weight:900;color:${d.color};margin-top:6px;">${d.share}%</div>
  </div>
</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body"><div class="div-grid">${divHtml}</div></div>`;
  }
  else if (s.type === 'hbm') {
    const rows = [s.points.slice(0,3), s.points.slice(3,6)];
    const ptsHtml = rows.map(row => `<div style="display:flex;flex-direction:column;gap:10px;flex:1;">${
      row.map(p=>`<div style="background:${t.card};border:1px solid ${t.border};border-radius:10px;padding:12px 14px;font-size:13px;color:${t.text};line-height:1.5;display:flex;align-items:flex-start;gap:8px;">
        <span style="color:${t.accent};font-weight:700;flex-shrink:0;">▶</span>${p}</div>`).join('')
    }</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="gap:16px;">
  <div style="flex:1;display:flex;gap:14px;">${ptsHtml}</div>
  <div class="stat-box" style="width:200px;flex-shrink:0;">
    <div class="stat-label">${s.stat.label}</div>
    <div class="stat-val">${s.stat.value}</div>
    <div class="stat-sub">${s.stat.sub}</div>
  </div>
</div>`;
  }
  else if (s.type === 'comparison') {
    const lp = s.left.points.map(p=>`<div class="cmp-pt" style="border-left-color:${s.left.color}">${p}</div>`).join('');
    const rp = s.right.points.map(p=>`<div class="cmp-pt" style="border-left-color:${s.right.color}">${p}</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body">
  <div class="cmp-wrap">
    <div class="cmp-card" style="border-color:${s.left.color}55;">
      <div class="cmp-title" style="color:${s.left.color}">${s.left.icon} ${s.left.title}</div>
      ${lp}
    </div>
    <div class="cmp-vs">VS</div>
    <div class="cmp-card" style="border-color:${s.right.color}55;">
      <div class="cmp-title" style="color:${s.right.color}">${s.right.icon} ${s.right.title}</div>
      ${rp}
    </div>
  </div>
</div>`;
  }
  else if (s.type === 'mobile') {
    const pts = s.points.map(p=>`<div class="pt">${p}</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="gap:16px;">
  <div class="card pt-list" style="flex:1;">${pts}</div>
  <div class="stat-box" style="width:200px;flex-shrink:0;">
    <div class="stat-label">${s.stat.label}</div>
    <div class="stat-val">${s.stat.value}</div>
    <div class="stat-sub">${s.stat.sub}</div>
  </div>
</div>`;
  }
  else if (s.type === 'region') {
    const maxV = Math.max(...s.regions.map(r=>r.value));
    const rows = s.regions.map(r=>`
<div class="rg-row">
  <div class="rg-name">${r.name}</div>
  <div class="rg-bar-bg"><div class="rg-bar-fill" style="width:${Math.round(r.value/maxV*100)}%;background:${r.color};">${r.pct}%</div></div>
  <div class="rg-val" style="color:${r.color}">${r.value}조</div>
</div>`).join('');
    const donutArcs = (() => {
      let offset = 0; const r=80, cx=100, cy=100;
      return s.regions.map(reg => {
        const arc = reg.pct / 100 * 2 * Math.PI;
        const x1 = cx + r*Math.sin(offset), y1 = cy - r*Math.cos(offset);
        offset += arc;
        const x2 = cx + r*Math.sin(offset), y2 = cy - r*Math.cos(offset);
        const large = arc > Math.PI ? 1 : 0;
        return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${reg.color}" opacity="0.85"/>`;
      }).join('');
    })();
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="gap:20px;">
  <div class="rg-wrap" style="flex:1;">${rows}<div class="note">${s.note}</div></div>
  <div style="width:220px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
    <svg width="200" height="200" viewBox="0 0 200 200">
      ${donutArcs}
      <circle cx="100" cy="100" r="45" fill="${t.bg2}"/>
      <text x="100" y="97" text-anchor="middle" fill="${t.text}" font-size="13" font-weight="900" font-family="${f.family}">매출</text>
      <text x="100" y="113" text-anchor="middle" fill="${t.accent}" font-size="11" font-weight="700" font-family="${f.family}">333.6조</text>
    </svg>
  </div>
</div>`;
  }
  else if (s.type === 'risk') {
    const rHtml = s.risks.map(r=>`
<div class="risk-card" style="border-color:${r.level==='high'?'#ef444444':'#f59e0b44'}">
  <div class="risk-head">
    <div class="risk-icon">${r.icon}</div>
    <div class="risk-title">${r.title}</div>
    <span class="risk-badge ${r.level==='high'?'badge-high':'badge-mid'}">${r.level.toUpperCase()}</span>
  </div>
  <div class="risk-desc">${r.desc}</div>
  <div class="risk-resp">💡 대응: ${r.response}</div>
</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body"><div class="risk-grid">${rHtml}</div></div>`;
  }
  else if (s.type === 'outlook') {
    const oHtml = s.items.map(i=>`
<div class="otl-card">
  <div class="otl-icon">${i.icon}</div>
  <div class="otl-title">${i.title}</div>
  <div class="otl-desc">${i.desc}</div>
</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="gap:16px;">
  <div class="otl-grid" style="flex:1;">${oHtml}</div>
  <div class="otl-side">
    <div class="target-box">
      <div class="target-label">${s.target.label}</div>
      <div class="target-val">${s.target.value}</div>
      <div class="target-sub">${s.target.sub}</div>
    </div>
  </div>
</div>`;
  }
  else if (s.type === 'conclusion') {
    const pts = s.points.map(p=>`<div class="pt">${p}</div>`).join('');
    body = `<div class="header"><span class="tag">${s.tag}</span><div class="title">${s.title}</div></div>
<div class="body" style="flex-direction:column;gap:12px;">
  <div class="msg-box">${s.message}</div>
  <div style="display:grid;grid-template-columns:1fr auto;gap:12px;flex:1;">
    <div class="conc-pts pt-list">${pts}</div>
    <div class="rating-box" style="width:200px;">
      <div style="font-size:11px;color:${t.sub}">투자의견</div>
      <div class="rating-grade">${s.rating.grade}</div>
      <div class="rating-price" style="color:${t.accent}">${s.rating.price}</div>
      <div class="rating-range">${s.rating.range}</div>
    </div>
  </div>
</div>`;
  }
  return slideHTML(body, t, f, n, tot);
}

// ── Apply prompt modifications ────────────────────────────────
function applyPrompt(data, prompt) {
  if (!prompt || !prompt.trim()) return data;
  const d = JSON.parse(JSON.stringify(data));  // deep copy
  const p = prompt.toLowerCase();

  // Title changes
  if (p.includes('제목') || p.includes('title')) {
    const m = prompt.match(/제목[을을]?\s*["']?(.+?)["']?\s*(로|으로|변경|수정)/);
    if (m) { d.slides[0].title = m[1]; }
  }
  // KPI value changes
  if (p.includes('매출') && (p.includes('변경') || p.includes('수정'))) {
    const m = prompt.match(/매출.*?(\d+(?:\.\d+)?조)/);
    if (m && d.slides[0].kpis[0]) { d.slides[0].kpis[0].value = m[1]; }
  }
  // Note changes
  if (p.includes('노트') || p.includes('note')) {
    const m = prompt.match(/노트[를을]?\s*["']?(.+?)["']?\s*(로|으로|변경|수정)/);
    if (m && d.slides[1]) { d.slides[1].note = m[1]; }
  }
  // Rating changes
  if (p.includes('투자의견') || p.includes('목표주가')) {
    const m = prompt.match(/(buy|sell|hold|중립|매수|매도)/i);
    if (m) {
      const last = d.slides[d.slides.length-1];
      if (last.rating) last.rating.grade = m[1].toUpperCase();
    }
  }
  // Add/remove slides
  if (p.includes('결론 슬라이드') && p.includes('추가')) {
    // duplicate conclusion
    const last = d.slides[d.slides.length-1];
    if (last.type === 'conclusion') {
      d.slides.push({...last, tag:'추가 결론', title:'투자 결론 (보완)'});
    }
  }
  return d;
}

// ── Generate slides for theme/font/prompt ─────────────────────
function generateSlides(themeKey, fontKey, prompt) {
  const theme = THEMES[themeKey] || THEMES.dark_cosmos;
  const font  = FONTS[fontKey]   || FONTS.noto_sans_kr;
  let   data  = applyPrompt(SLIDE_DATA, prompt);

  const slides = data.slides;
  const tot    = slides.length + 1;  // cover + n slides
  const cover  = genCover(theme, font);
  const htmls  = [cover, ...slides.map((s,i) => genSlide(s, theme, font, i+2, tot))];

  // Write HTML files
  if (!fs.existsSync(SLIDES)) fs.mkdirSync(SLIDES, {recursive:true});
  htmls.forEach((h,i) => {
    fs.writeFileSync(path.join(SLIDES, `slide_${String(i).padStart(2,'0')}.html`), h, 'utf8');
  });
  return htmls.length;
}

// ── Capture slides with Playwright ────────────────────────────
async function captureSlides() {
  const script = `
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SLIDES = '${SLIDES}';
const OUT = '${CAPTURES}';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, {recursive:true});
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({width:1280, height:720});
  const files = fs.readdirSync(SLIDES).filter(f=>f.endsWith('.html')).sort();
  for (const f of files) {
    const fp = path.join(SLIDES, f);
    await page.goto('file://' + fp, {waitUntil:'networkidle'});
    await page.waitForTimeout(600);
    const name = f.replace('.html','.png');
    await page.screenshot({path: path.join(OUT, name), fullPage:false});
    process.stdout.write('captured: ' + name + '\\n');
  }
  await browser.close();
  console.log('DONE:' + files.length);
})();`;
  const scriptPath = path.join(WEBAPP, '_capture_tmp.js');
  fs.writeFileSync(scriptPath, script, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {cwd: WEBAPP});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      fs.unlinkSync(scriptPath);
      if (code === 0 || out.includes('DONE:')) resolve(out);
      else reject(new Error('Capture failed: ' + out.slice(-500)));
    });
  });
}

// ── Build PPTX ────────────────────────────────────────────────
function buildPptx() {
  const script = `
const pptx = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const OUT = '${CAPTURES}';
const prs = new pptx();
prs.layout = 'LAYOUT_WIDE';
prs.title  = '삼성전자 2025 종합 분석';
const files = fs.readdirSync(OUT).filter(f=>f.endsWith('.png')).sort();
files.forEach(f => {
  const slide = prs.addSlide();
  slide.addImage({path: path.join(OUT,f), x:0, y:0, w:'100%', h:'100%'});
});
prs.writeFile({fileName: '${WEBAPP}/samsung_premium.pptx'}).then(()=>{
  console.log('PPTX_DONE:' + files.length);
}).catch(e => { console.error('PPTX_ERR:' + e.message); process.exit(1); });`;
  const scriptPath = path.join(WEBAPP, '_pptx_tmp.js');
  fs.writeFileSync(scriptPath, script, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {cwd: WEBAPP});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      fs.unlinkSync(scriptPath);
      if (out.includes('PPTX_DONE:')) resolve(out);
      else reject(new Error('PPTX build failed: ' + out.slice(-500)));
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  ORCHESTRATOR PROXY HELPERS
// ══════════════════════════════════════════════════════════════
function proxyPost(port, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'localhost', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 180000  // research_ppt 파이프라인 최대 3분
    };
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve({ reply: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Orchestrator timeout')); });
    req.write(data);
    req.end();
  });
}

function proxyGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET', timeout: 5000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve({ status: 'ok' }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cors = () => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
  };
  cors();
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/themes
  if (req.method === 'GET' && url.pathname === '/api/themes') {
    const out = Object.entries(THEMES).map(([k,v])=>({
      key:k, name:v.name, emoji:v.emoji, dark:v.dark,
      preview:`linear-gradient(135deg,${v.bg1} 0%,${v.bg2} 50%,${v.accent} 100%)`
    }));
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(out)); return;
  }
  // GET /api/fonts
  if (req.method === 'GET' && url.pathname === '/api/fonts') {
    const out = Object.entries(FONTS).map(([k,v])=>({
      key:k, name:v.name, label:v.label, sample:v.sample, family:v.family
    }));
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(out)); return;
  }
  // GET /api/status
  if (req.method === 'GET' && url.pathname === '/api/status') {
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({themes: Object.keys(THEMES).length, fonts: Object.keys(FONTS).length, combos: Object.keys(THEMES).length * Object.keys(FONTS).length, slides: SLIDE_DATA.slides.length + 1}));
    return;
  }

  // POST /api/regenerate
  if (req.method === 'POST' && url.pathname === '/api/regenerate') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const { theme='dark_cosmos', font='noto_sans_kr', prompt='' } = JSON.parse(body||'{}');
        const t0 = Date.now();
        // 1. Generate HTML slides
        const cnt = generateSlides(theme, font, prompt);
        // 2. Capture screenshots
        await captureSlides();
        // 3. Build PPTX
        await buildPptx();
        const elapsed = ((Date.now()-t0)/1000).toFixed(1);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, slides:cnt, slideCount:cnt, elapsed, pptxUrl:'/samsung_premium.pptx', msg:`${cnt}장 슬라이드 생성 완료 (${elapsed}s)`}));
      } catch(e) {
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:e.message}));
      }
    });
    return;
  }

  // ── POST /api/chat — Proxy to AI Orchestrator ──────────────
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const orchRes = await proxyPost(ORCH_PORT, '/api/message', payload);

        // research_ppt 파이프라인이 파일을 생성한 경우 → 저장 후 URL 반환
        const pd = orchRes.pipelineData;
        if (pd?.fileBase64 && pd?.fileName) {
          try {
            const buf = Buffer.from(pd.fileBase64, 'base64');
            const saveName = pd.fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
            const savePath = path.join(WEBAPP, saveName);
            fs.writeFileSync(savePath, buf);
            orchRes.pptxUrl  = '/' + saveName;
            orchRes.reply    = `✅ PPT 생성 완료! **${pd.slideCount || ''}장** 슬라이드\n\n📥 [다운로드](/${saveName})`;
            orchRes.hasFile  = true;
            orchRes.fileName = saveName;
            console.log('[chat] PPT 파일 저장:', savePath, buf.length, 'bytes');
          } catch(fe) {
            console.error('[chat] 파일 저장 실패:', fe.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orchRes));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          reply: `AI 오케스트라 연결 오류: ${e.message}. 직접 PPT 생성 모드로 전환합니다.`,
          error: e.message
        }));
      }
    });
    return;
  }

  // ── POST /api/generate-from-topic — Generate PPT from text topic ──
  if (req.method === 'POST' && url.pathname === '/api/generate-from-topic') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const { topic, theme='dark_cosmos', font='noto_sans_kr' } = JSON.parse(body || '{}');
        const t0 = Date.now();
        
        // Try orchestrator for enhanced content
        let prompt = topic;
        try {
          const orchData = await proxyPost(ORCH_PORT, '/api/message', {
            message: `다음 주제로 PPT 슬라이드 내용을 구조화해줘: ${topic}`,
            sessionId: `ppt_gen_${Date.now()}`
          });
          if (orchData.reply) prompt = `${topic}\n\n[AI 분석]: ${orchData.reply}`;
        } catch(e) { /* use original topic */ }

        const cnt = generateSlides(theme, font, prompt);
        await captureSlides();
        await buildPptx();
        const elapsed = ((Date.now()-t0)/1000).toFixed(1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true, slideCount: cnt, elapsed,
          pptxUrl: '/samsung_premium.pptx',
          msg: `${cnt}장 슬라이드 생성 완료 (${elapsed}s)`
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── GET /api/orchestrator/status — Check orchestrator health ──
  if (req.method === 'GET' && url.pathname === '/api/orchestrator/status') {
    try {
      const status = await proxyGet(ORCH_PORT, '/health');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: true, ...status }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: false, error: e.message }));
    }
    return;
  }

  // GET /api/preview/:theme/:font  — return single slide HTML for preview
  const previewM = url.pathname.match(/^\/api\/preview\/([^/]+)\/([^/]+)(?:\/(\d+))?$/);
  if (req.method === 'GET' && previewM) {
    const [, tKey, fKey, idxStr] = previewM;
    const idx = parseInt(idxStr||'0',10);
    const theme = THEMES[tKey] || THEMES.dark_cosmos;
    const font  = FONTS[fKey]  || FONTS.noto_sans_kr;
    const tot   = SLIDE_DATA.slides.length + 1;
    let html;
    if (idx === 0) html = genCover(theme, font);
    else           html = genSlide(SLIDE_DATA.slides[idx-1]||SLIDE_DATA.slides[0], theme, font, idx+1, tot);
    res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
    res.end(html); return;
  }

  // ── Static file serving ─────────────────────────────────────
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  // Redirect root to studio
  if (url.pathname === '/') { res.writeHead(302,{Location:'/ppt_studio.html'}); res.end(); return; }
  const absPath = path.join(WEBAPP, filePath);
  const ext = path.extname(absPath).toLowerCase();
  const mimes = {
    '.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript',
    '.png':'image/png','.jpg':'image/jpeg','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.json':'application/json','.ttf':'font/truetype','.otf':'font/otf','.woff2':'font/woff2',
    '.svg':'image/svg+xml','.ico':'image/x-icon',
  };
  try {
    if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found: ' + filePath); return;
    }
    res.writeHead(200,{
      'Content-Type': mimes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.pptx' ? 'no-cache' : 'public,max-age=10',
      'Access-Control-Allow-Origin':'*',
    });
    fs.createReadStream(absPath).pipe(res);
  } catch(e) {
    res.writeHead(500); res.end('Server error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ PPT Studio API Server running on port ${PORT}`);
  console.log(`   Themes: ${Object.keys(THEMES).length}  Fonts: ${Object.keys(FONTS).length}  Combos: ${Object.keys(THEMES).length * Object.keys(FONTS).length}`);
});
