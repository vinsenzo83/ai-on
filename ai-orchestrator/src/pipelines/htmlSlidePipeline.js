'use strict';
/**
 * htmlSlidePipeline.js  v3.0
 * 슬라이드 타입별 전용 레이아웃 + SVG 인라인 차트 + Puppeteer 고화질 캡처
 *
 * 지원 타입:
 *   cover       - 표지 (그라데이션 + 배경 오브 + 태그)
 *   kpi         - KPI 4개 그리드
 *   bar_chart   - SVG 막대 차트
 *   donut_chart - SVG 도넛 차트
 *   comparison  - 좌우 2열 비교
 *   bullets     - 불릿 리스트 + 하이라이트
 *   timeline    - 수직 타임라인
 *   risk        - 리스크 카드 2×2
 *   outlook     - 전망 아이템 + 목표지표
 *   conclusion  - 결론 + 투자의견
 *   end         - 마지막 슬라이드
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const pptx = require('pptxgenjs');

// ── 테마 ─────────────────────────────────────────────────────
const THEMES = {
  modern: {
    bg:      'linear-gradient(135deg,#0f0c29 0%,#1a1a4e 55%,#16213e 100%)',
    bgSolid: '#0f0c29',
    accent:  '#7c3aed', accent2: '#06b6d4',
    text: '#ffffff', sub: 'rgba(255,255,255,0.68)',
    card: 'rgba(255,255,255,0.07)', border: 'rgba(124,58,237,0.35)',
    coverBg: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#16213e 100%)',
  },
  corporate: {
    bg:      'linear-gradient(135deg,#0d1b2a 0%,#1a2744 55%,#0f3460 100%)',
    bgSolid: '#0d1b2a',
    accent:  '#e94560', accent2: '#4cc9f0',
    text: '#ffffff', sub: 'rgba(255,255,255,0.68)',
    card: 'rgba(255,255,255,0.06)', border: 'rgba(233,69,96,0.35)',
    coverBg: 'linear-gradient(135deg,#0d1b2a 0%,#0f3460 100%)',
  },
  nature: {
    bg:      'linear-gradient(135deg,#0d1b2a 0%,#1b3a2f 55%,#081c15 100%)',
    bgSolid: '#0d1b2a',
    accent:  '#52b788', accent2: '#74c69d',
    text: '#ffffff', sub: 'rgba(255,255,255,0.68)',
    card: 'rgba(255,255,255,0.07)', border: 'rgba(82,183,136,0.35)',
    coverBg: 'linear-gradient(135deg,#0d1b2a 0%,#1b4332 100%)',
  },
  executive: {
    bg:      'linear-gradient(135deg,#111113 0%,#1c1c22 55%,#2a2a35 100%)',
    bgSolid: '#111113',
    accent:  '#ff9f0a', accent2: '#ff6b35',
    text: '#ffffff', sub: 'rgba(255,255,255,0.68)',
    card: 'rgba(255,255,255,0.06)', border: 'rgba(255,159,10,0.35)',
    coverBg: 'linear-gradient(135deg,#111113 0%,#2a2a35 100%)',
  },
};

// ── 공통 CSS ─────────────────────────────────────────────────
function baseCss(t) {
  return `
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1280px;height:720px;overflow:hidden;
    font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo','Segoe UI',Arial,sans-serif;
    background:${t.bg};color:${t.text};}
  .slide{width:1280px;height:720px;position:relative;padding:42px 58px 42px 58px;display:flex;flex-direction:column;}
  .top-bar{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,${t.accent},${t.accent2});}
  .bot-bar{position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${t.accent2},${t.accent});opacity:0.45;}
  .tag{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;
    letter-spacing:2px;text-transform:uppercase;background:${t.accent}22;color:${t.accent};
    border:1px solid ${t.border};margin-bottom:11px;width:fit-content;}
  .title{font-size:36px;font-weight:900;line-height:1.2;margin-bottom:18px;
    background:linear-gradient(90deg,#fff 60%,rgba(255,255,255,0.7));
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;}
  .card{background:${t.card};border:1px solid ${t.border};border-radius:14px;padding:18px 22px;}
  .num{position:absolute;bottom:15px;right:56px;font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:2px;}
  .hl-box{background:linear-gradient(135deg,${t.accent}1a,${t.accent2}0d);
    border-left:4px solid ${t.accent};border-radius:0 10px 10px 0;
    padding:13px 18px;font-size:15px;color:${t.sub};font-style:italic;margin-top:14px;}
  `;
}

// ── 1. COVER ─────────────────────────────────────────────────
function buildCover(data, theme) {
  const t = THEMES[theme] || THEMES.modern;
  const today = new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});
  const tags = [data.keyMessage, data.dataSource].filter(Boolean).slice(0,2);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1280px;height:720px;overflow:hidden;
    font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif;
    color:#fff;background:${t.coverBg};}
  .cover{width:1280px;height:720px;display:flex;flex-direction:column;
    justify-content:center;align-items:center;text-align:center;padding:60px;position:relative;}
  .c1{position:absolute;width:620px;height:620px;border-radius:50%;
    background:${t.accent}14;top:-140px;right:-140px;pointer-events:none;}
  .c2{position:absolute;width:420px;height:420px;border-radius:50%;
    background:${t.accent2}0f;bottom:-100px;left:-80px;pointer-events:none;}
  .c3{position:absolute;width:200px;height:200px;border-radius:50%;
    background:${t.accent}10;top:40%;left:5%;pointer-events:none;}
  .tbar{position:absolute;top:0;left:0;right:0;height:5px;
    background:linear-gradient(90deg,${t.accent},${t.accent2});}
  .bbar{position:absolute;bottom:0;left:0;right:0;height:3px;
    background:linear-gradient(90deg,${t.accent2},${t.accent});opacity:0.4;}
  .eye{font-size:12px;font-weight:700;letter-spacing:5px;color:${t.accent};margin-bottom:22px;text-transform:uppercase;}
  .main{font-size:66px;font-weight:900;line-height:1.08;margin-bottom:10px;
    background:linear-gradient(135deg,#fff 30%,${t.accent} 65%,${t.accent2});
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;}
  .sub{font-size:21px;color:rgba(255,255,255,0.6);margin-bottom:10px;}
  .line{width:80px;height:3px;background:linear-gradient(90deg,${t.accent},${t.accent2});
    border-radius:2px;margin:22px auto;}
  .desc{font-size:17px;color:rgba(255,255,255,0.55);margin-bottom:36px;line-height:1.65;max-width:700px;}
  .tags{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:30px;}
  .tag{padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1px;
    background:${t.accent}20;color:${t.accent};border:1px solid ${t.accent}44;}
  .meta{display:flex;gap:36px;align-items:center;}
  .mi{font-size:12px;color:rgba(255,255,255,0.35);letter-spacing:1px;}
  .dot{width:4px;height:4px;border-radius:50%;background:${t.accent};opacity:0.6;}
  </style></head><body><div class="cover">
  <div class="c1"></div><div class="c2"></div><div class="c3"></div><div class="tbar"></div>
  <div class="eye">AI Research Report</div>
  <div class="main">${data.title||'리서치 리포트'}</div>
  <div class="sub">${data.subtitle||''}</div>
  <div class="line"></div>
  <div class="desc">${data.keyMessage||''}</div>
  <div class="tags">${tags.map(tg=>`<div class="tag">${tg}</div>`).join('')}</div>
  <div class="meta">
    <div class="mi">${today}</div><div class="dot"></div>
    <div class="mi">AI GENERATED</div><div class="dot"></div>
    <div class="mi">${data.dataSource||'Web Research'}</div>
  </div>
  <div class="bbar"></div>
  </div></body></html>`;
}

// ── 2. KPI ───────────────────────────────────────────────────
function buildKpi(s, t, n, tot) {
  const kpis = (s.kpis||[]).slice(0,4);
  while(kpis.length < 4) kpis.push({ value:'—', label:'', sub:'', color: t.accent });
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;flex:1;}
  .kpi-card{background:${t.card};border:1px solid ${t.border};border-radius:16px;
    display:flex;flex-direction:column;justify-content:center;align-items:center;
    padding:24px 14px;position:relative;overflow:hidden;}
  .kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--c);}
  .kpi-val{font-size:38px;font-weight:900;margin-bottom:7px;color:var(--c);}
  .kpi-lbl{font-size:13px;color:${t.sub};letter-spacing:1px;margin-bottom:5px;text-align:center;}
  .kpi-sub{font-size:12px;font-weight:700;color:var(--c);opacity:0.85;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="kpi-grid">
  ${kpis.map(k=>`<div class="kpi-card" style="--c:${k.color||t.accent}">
    <div class="kpi-val">${k.value||'—'}</div>
    <div class="kpi-lbl">${k.label||''}</div>
    <div class="kpi-sub">${k.sub||''}</div>
  </div>`).join('')}
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 3. BAR CHART (SVG) ───────────────────────────────────────
function buildBarChart(s, t, n, tot) {
  const cd = s.chartData || {};
  const bars = (cd.bars||[]).slice(0,12);
  if (!bars.length) return buildBullets(s, t, n, tot);

  const maxV = cd.maxValue || Math.max(...bars.map(b=>b.value||0), 1);
  const unit  = cd.unit || '';
  const W = 1120, H = 420, pad = 30;
  const gap = 6;
  const barW = Math.floor((W - pad*2) / bars.length) - gap;

  const svgBars = bars.map((b, i) => {
    const bh = Math.max(Math.round(((b.value||0) / maxV) * (H - 70)), 4);
    const x  = pad + i * ((W - pad*2) / bars.length) + gap/2;
    const y  = H - 40 - bh;
    const col = b.highlight ? t.accent2 : (b.color || t.accent);
    const glow = b.highlight ? `filter:drop-shadow(0 0 10px ${col});` : '';
    return `
      <text x="${x + barW/2}" y="${y - 7}" text-anchor="middle" fill="${col}" font-size="12" font-weight="700" font-family="sans-serif">${b.value}${unit}</text>
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="url(#bg${i})" style="${glow}"/>
      <defs><linearGradient id="bg${i}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}"/><stop offset="100%" stop-color="${col}55"/>
      </linearGradient></defs>
      <text x="${x + barW/2}" y="${H - 18}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="10" font-family="sans-serif">${b.label||''}</text>`;
  }).join('');

  const note = cd.note || s.highlight || '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .chart-wrap{flex:1;display:flex;flex-direction:column;}
  .note{margin-top:10px;padding:11px 16px;background:${t.accent}18;
    border-left:3px solid ${t.accent};border-radius:0 8px 8px 0;
    font-size:14px;color:${t.sub};font-style:italic;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="chart-wrap">
    <div class="card" style="padding:16px 20px;flex:1;display:flex;flex-direction:column;">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="flex:1">
        <line x1="${pad}" y1="10" x2="${pad}" y2="${H-40}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <line x1="${pad}" y1="${H-40}" x2="${W-pad}" y2="${H-40}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
        ${svgBars}
      </svg>
      ${note ? `<div class="note">📊 ${note}</div>` : ''}
    </div>
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 4. DONUT CHART (SVG) ────────────────────────────────────
function buildDonutChart(s, t, n, tot) {
  const cd = s.chartData || {};
  const segs = (cd.segments||[]).slice(0,6);
  if (!segs.length) return buildBullets(s, t, n, tot);

  const cx=250, cy=250, R=210, r=110;
  let angle = -Math.PI/2;
  const total = segs.reduce((a,sg)=>a+(sg.pct||sg.value||0),0)||100;
  const paths = segs.map(sg=>{
    const pct = (sg.pct||sg.value||0)/total;
    const a2  = angle + pct * 2 * Math.PI;
    const x1=cx+R*Math.cos(angle), y1=cy+R*Math.sin(angle);
    const x2=cx+R*Math.cos(a2),   y2=cy+R*Math.sin(a2);
    const xi=cx+r*Math.cos(angle), yi=cy+r*Math.sin(angle);
    const xe=cx+r*Math.cos(a2),   ye=cy+r*Math.sin(a2);
    const lg = pct > 0.5 ? 1 : 0;
    const d  = `M ${xi} ${yi} L ${x1} ${y1} A ${R} ${R} 0 ${lg} 1 ${x2} ${y2} L ${xe} ${ye} A ${r} ${r} 0 ${lg} 0 ${xi} ${yi} Z`;
    angle = a2;
    return `<path d="${d}" fill="${sg.color||t.accent}" opacity="0.93"/>`;
  }).join('');

  const legend = segs.map((sg,i)=>`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:10px 14px;background:${t.card};border-radius:10px;border:1px solid ${t.border};">
      <div style="width:14px;height:14px;border-radius:4px;background:${sg.color||t.accent};flex-shrink:0;"></div>
      <span style="font-size:15px;flex:1;font-weight:500;">${sg.label||''}</span>
      <span style="font-size:18px;font-weight:800;color:${sg.color||t.accent};">${sg.pct||sg.value||0}%</span>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .row{display:grid;grid-template-columns:520px 1fr;gap:24px;flex:1;align-items:center;}
  .donut-wrap{display:flex;align-items:center;justify-content:center;position:relative;}
  .center-lbl{position:absolute;text-align:center;pointer-events:none;}
  .cv{font-size:36px;font-weight:900;color:${t.accent};}
  .cl{font-size:13px;color:${t.sub};margin-top:5px;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="row">
    <div class="donut-wrap">
      <svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">${paths}</svg>
      <div class="center-lbl">
        <div class="cv">${cd.centerValue||''}</div>
        <div class="cl">${cd.centerLabel||''}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:center;">${legend}</div>
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 5. COMPARISON ────────────────────────────────────────────
function buildComparison(s, t, n, tot) {
  const L = s.leftCol||{};
  const R = s.rightCol||{};
  const col = (side, c) => `<div class="card" style="display:flex;flex-direction:column;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid ${t.border};">
      <span style="font-size:28px;">${side.icon||'📌'}</span>
      <span style="font-size:18px;font-weight:800;color:${c};">${side.title||''}</span>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;">
    ${(side.points||[]).map(p=>`<div style="display:flex;gap:10px;font-size:14px;line-height:1.6;padding:7px 0;border-bottom:1px solid ${t.border}22;">
      <div style="width:7px;height:7px;border-radius:50%;background:${c};margin-top:7px;flex-shrink:0;"></div>
      <span style="color:rgba(255,255,255,0.88);">${p}</span>
    </div>`).join('')}
    </div>
  </div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="two-col">
    ${col(L, L.color||t.accent)}
    ${col(R, R.color||t.accent2)}
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 6. BULLETS ───────────────────────────────────────────────
function buildBullets(s, t, n, tot) {
  const bullets = (s.bullets||[]).slice(0,6);
  const hasStatBox = !!s.stat?.value;
  const statBlock = hasStatBox ? `
    <div style="flex-shrink:0;width:230px;background:linear-gradient(135deg,${t.accent}33,${t.accent2}1a);
      border:1px solid ${t.border};border-radius:16px;
      display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px 14px;">
      <div style="font-size:12px;color:${t.sub};letter-spacing:1px;margin-bottom:10px;text-align:center;">${s.stat.label||''}</div>
      <div style="font-size:42px;font-weight:900;background:linear-gradient(135deg,${t.accent},${t.accent2});
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;">${s.stat.value}</div>
      <div style="font-size:28px;margin-top:12px;">${s.stat.trend==='up'?'📈':s.stat.trend==='down'?'📉':'📊'}</div>
    </div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .bl-wrap{flex:1;display:flex;gap:16px;}
  .bl-main{flex:1;display:flex;flex-direction:column;}
  .bl-list{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:16px 20px;}
  .bl-item{display:flex;align-items:flex-start;gap:12px;font-size:15px;line-height:1.6;padding:8px 0;border-bottom:1px solid ${t.border}22;}
  .bl-item:last-child{border-bottom:none;}
  .bl-dot{width:8px;height:8px;border-radius:50%;background:${t.accent};margin-top:7px;flex-shrink:0;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  ${s.content ? `<div style="font-size:14px;color:${t.sub};margin-bottom:12px;line-height:1.65;">${s.content}</div>` : ''}
  <div class="bl-wrap">
    <div class="bl-main">
      <div class="card bl-list">
        ${bullets.map(b=>`<div class="bl-item"><div class="bl-dot"></div><span>${b}</span></div>`).join('')}
      </div>
      ${s.highlight ? `<div class="hl-box" style="margin-top:10px;">${s.highlight}</div>` : ''}
    </div>
    ${statBlock}
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 7. TIMELINE ──────────────────────────────────────────────
function buildTimeline(s, t, n, tot) {
  const tl = (s.timeline||[]).slice(0,6);
  if (!tl.length) return buildBullets(s, t, n, tot);
  const half = Math.ceil(tl.length/2);
  const left  = tl.slice(0, half);
  const right = tl.slice(half);
  const renderItems = (items) => items.map((item, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;flex:1;">
      <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;">
        <div style="width:42px;height:42px;border-radius:50%;background:${item.color||t.accent}33;
          border:2px solid ${item.color||t.accent};display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:800;color:${item.color||t.accent};text-align:center;line-height:1.2;padding:2px;">${item.year||i+1}</div>
        ${i < items.length-1 ? `<div style="width:2px;flex:1;min-height:16px;background:${t.border};margin-top:3px;"></div>` : ''}
      </div>
      <div style="padding-top:8px;flex:1;">
        <div style="font-size:13px;font-weight:700;color:${item.color||t.accent};margin-bottom:4px;">${item.year||''}</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.85);line-height:1.6;">${item.event||''}</div>
      </div>
    </div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .tl-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;}
  .tl-col{display:flex;flex-direction:column;gap:0;justify-content:space-between;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="tl-grid">
    <div class="card tl-col">${renderItems(left)}</div>
    <div class="card tl-col">${renderItems(right)}</div>
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 8. RISK ──────────────────────────────────────────────────
function buildRisk(s, t, n, tot) {
  const risks = (s.risks||[]).slice(0,4);
  while(risks.length < 4) risks.push({ icon:'⚡', title:'', desc:'', level:'low' });
  const levelColor = { high:'#ef4444', mid:'#f59e0b', low:'#10b981' };
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .risk-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;}
  .rc{display:flex;gap:14px;align-items:flex-start;padding:18px 20px;}
  .rc-icon{font-size:28px;flex-shrink:0;margin-top:2px;}
  .lv{display:inline-block;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:800;
    letter-spacing:1px;margin-left:8px;text-transform:uppercase;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="risk-grid">
  ${risks.map(r=>{
    const lc = levelColor[r.level||'low'];
    return `<div class="card rc">
      <div class="rc-icon">${r.icon||'⚠️'}</div>
      <div>
        <div style="font-size:15px;font-weight:800;color:${lc};margin-bottom:5px;">
          ${r.title||''}
          <span class="lv" style="background:${lc}22;color:${lc};">${r.level||'low'}</span>
        </div>
        <div style="font-size:14px;color:${t.sub};line-height:1.6;">${r.desc||''}</div>
      </div>
    </div>`;
  }).join('')}
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 9. OUTLOOK ───────────────────────────────────────────────
function buildOutlook(s, t, n, tot) {
  const items = (s.items||[]).slice(0,6);
  const tgt = s.target||{};
  const hasTarget = !!tgt.value;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .items-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;flex:1;${hasTarget?'padding-right:260px;':''}}
  .oi{display:flex;align-items:flex-start;gap:13px;padding:14px 18px;}
  .tp-box{position:absolute;right:58px;top:120px;bottom:56px;width:234px;
    background:linear-gradient(135deg,${t.accent}3a,${t.accent2}22);
    border:1px solid ${t.border};border-radius:18px;
    display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px;}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div style="flex:1;position:relative;">
    <div class="items-grid">
    ${items.map(it=>`<div class="card oi">
      <div style="font-size:26px;flex-shrink:0;">${it.icon||'🔹'}</div>
      <div>
        <div style="font-size:14px;font-weight:800;color:${t.accent};margin-bottom:3px;">${it.title||''}</div>
        <div style="font-size:13px;color:${t.sub};line-height:1.55;">${it.desc||''}</div>
      </div>
    </div>`).join('')}
    </div>
    ${hasTarget ? `<div class="tp-box">
      <div style="font-size:11px;color:${t.sub};letter-spacing:2px;margin-bottom:12px;text-align:center;">${tgt.label||''}</div>
      <div style="font-size:28px;font-weight:900;background:linear-gradient(90deg,${t.accent},${t.accent2});
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;text-align:center;line-height:1.3;">${tgt.value||''}</div>
      <div style="font-size:12px;color:${t.sub};margin-top:10px;text-align:center;">${tgt.sub||''}</div>
    </div>` : ''}
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 10. CONCLUSION ───────────────────────────────────────────
function buildConclusion(s, t, n, tot) {
  const pts = (s.points||[]).slice(0,4);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss(t)}
  .row{display:grid;grid-template-columns:1fr 280px;gap:22px;flex:1;}
  .rating-box{background:linear-gradient(135deg,${t.accent}3a,${t.accent2}22);
    border:2px solid ${t.accent};border-radius:20px;
    display:flex;flex-direction:column;justify-content:center;align-items:center;padding:28px 20px;}
  .rt{font-size:64px;font-weight:900;background:linear-gradient(135deg,#10b981,${t.accent2});
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;}
  .msg{font-size:17px;font-weight:600;line-height:1.7;white-space:pre-line;
    background:${t.accent}14;border-radius:10px;padding:14px 18px;margin-bottom:16px;color:rgba(255,255,255,0.9);}
  </style></head><body><div class="slide">
  <div class="top-bar"></div>
  <div class="tag">${s.tag||''}</div>
  <div class="title">${s.title||''}</div>
  <div class="row">
    <div class="card" style="display:flex;flex-direction:column;gap:0;">
      ${s.message ? `<div class="msg">${s.message}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px;">
      ${pts.map(p=>`<div style="display:flex;gap:10px;font-size:15px;line-height:1.65;">
        <span style="color:${t.accent};font-size:17px;flex-shrink:0;">✓</span><span>${p}</span>
      </div>`).join('')}
      </div>
    </div>
    <div class="rating-box">
      <div style="font-size:11px;color:${t.sub};letter-spacing:3px;margin-bottom:14px;">투자의견</div>
      <div class="rt">${s.rating||'BUY'}</div>
      ${s.tp ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid ${t.border};width:100%;text-align:center;">
        <div style="font-size:11px;color:${t.sub};letter-spacing:1px;margin-bottom:6px;">목표주가</div>
        <div style="font-size:20px;font-weight:900;color:#f59e0b;">${s.tp}</div>
      </div>` : ''}
    </div>
  </div>
  <div class="bot-bar"></div><div class="num">${n} · ${tot}</div>
  </div></body></html>`;
}

// ── 11. END ──────────────────────────────────────────────────
function buildEnd(data, theme) {
  const t = THEMES[theme] || THEMES.modern;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1280px;height:720px;overflow:hidden;
    font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#fff;background:${t.coverBg};}
  .end{width:1280px;height:720px;display:flex;flex-direction:column;
    justify-content:center;align-items:center;text-align:center;position:relative;}
  .c{position:absolute;width:500px;height:500px;border-radius:50%;background:${t.accent}12;}
  .box{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
    border-radius:20px;padding:32px 56px;max-width:760px;margin-bottom:36px;}
  .txt{font-size:18px;color:rgba(255,255,255,0.75);line-height:1.75;}
  .thanks{font-size:72px;font-weight:900;background:linear-gradient(135deg,#fff,${t.accent},${t.accent2});
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px;}
  .bar{position:absolute;bottom:0;left:0;right:0;height:4px;
    background:linear-gradient(90deg,${t.accent},${t.accent2});}
  </style></head><body><div class="end">
  <div class="c"></div>
  <div class="thanks">감사합니다</div>
  ${data.conclusion ? `<div class="box"><div class="txt">${data.conclusion}</div></div>` : ''}
  <div style="font-size:13px;color:rgba(255,255,255,0.3);letter-spacing:3px;">AI RESEARCH · GENERATED REPORT</div>
  <div class="bar"></div>
  </div></body></html>`;
}

// ── 타입별 빌더 라우팅 ────────────────────────────────────────
function buildSlideHtml(s, theme, n, tot) {
  const t = THEMES[theme] || THEMES.modern;
  switch ((s.type||'bullets').toLowerCase()) {
    case 'kpi':         return buildKpi(s, t, n, tot);
    case 'bar_chart':   return buildBarChart(s, t, n, tot);
    case 'donut_chart': return buildDonutChart(s, t, n, tot);
    case 'comparison':  return buildComparison(s, t, n, tot);
    case 'timeline':    return buildTimeline(s, t, n, tot);
    case 'risk':        return buildRisk(s, t, n, tot);
    case 'outlook':     return buildOutlook(s, t, n, tot);
    case 'conclusion':  return buildConclusion(s, t, n, tot);
    default:            return buildBullets(s, t, n, tot);
  }
}

// ── Puppeteer 캡처 ────────────────────────────────────────────
async function captureSlides(htmlPages) {
  const chromiumPaths = [
    // Playwright 캐시 (이 환경의 실제 위치)
    '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
    // 시스템 설치 경로들
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  let executablePath = null;
  for (const p of chromiumPaths) {
    try { if (require('fs').existsSync(p)) { executablePath = p; break; } } catch {}
  }
  if (!executablePath) {
    console.warn('[htmlSlidePipeline] Chromium 없음 → PNG 스킵');
    return null;
  }
  console.log(`[htmlSlidePipeline] Chromium 발견: ${executablePath}`);

  let browser = null;
  const images = [];
  try {
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-gpu','--font-render-hinting=none'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });

    for (let i = 0; i < htmlPages.length; i++) {
      await page.setContent(htmlPages[i], { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await new Promise(r => setTimeout(r, 400));
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      images.push(buf);
      console.log(`[htmlSlidePipeline] 캡처 ${i+1}/${htmlPages.length}`);
    }
  } catch (e) {
    console.error('[htmlSlidePipeline] Puppeteer 에러:', e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return images.length > 0 ? images : null;
}

// ── 이미지 → PPTX ─────────────────────────────────────────────
async function imagesToPptx(images, topic) {
  const prs = new pptx();
  prs.defineLayout({ name: 'WS', width: 13.33, height: 7.5 });
  prs.layout = 'WS';
  prs.title  = topic;
  for (const imgBuf of images) {
    const slide = prs.addSlide();
    slide.addImage({ data: 'image/png;base64,' + imgBuf.toString('base64'), x:0, y:0, w:13.33, h:7.5 });
  }
  const tmp = path.join(os.tmpdir(), `ppt_${Date.now()}.pptx`);
  await prs.writeFile({ fileName: tmp });
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

// ── 메인 실행 ─────────────────────────────────────────────────
async function run(opts = {}) {
  const { structured, topic = '', theme = 'modern', usePuppeteer = true } = opts;

  if (!structured?.sections?.length) {
    throw new Error('structured 데이터 없음. researchPipeline을 먼저 실행하세요.');
  }

  const data  = structured;
  const secs  = data.sections;
  const total = secs.length + 2;
  console.log(`[htmlSlidePipeline] v3.0 슬라이드 ${total}장 생성 시작`);

  const htmlPages = [
    buildCover(data, theme),
    ...secs.map((sec, i) => buildSlideHtml(sec, theme, i+1, secs.length)),
    buildEnd(data, theme),
  ];

  let pptxBuf = null, method = 'html_only';

  if (usePuppeteer) {
    const images = await captureSlides(htmlPages);
    if (images) {
      pptxBuf = await imagesToPptx(images, topic || data.title);
      method  = 'puppeteer_pptx';
      console.log(`[htmlSlidePipeline] ✅ PPTX 완료 (Puppeteer) ${pptxBuf.length} bytes`);
    }
  }

  if (!pptxBuf) {
    console.log('[htmlSlidePipeline] Puppeteer 스킵 → pptxgenjs fallback');
    const { buildPptx, parseSlides } = require('./pptPipeline');
    // 타입별 텍스트 추출 (kpi, bar_chart, donut_chart 등 포함)
    const slideText = secs.map((sec, i) => {
      const title = sec.title || `슬라이드 ${i+1}`;
      let bullets = [];
      if (sec.type === 'kpi' && Array.isArray(sec.kpis)) {
        bullets = sec.kpis.map(k => `${k.label}: ${k.value} (${k.sub || ''})`);
      } else if (sec.type === 'bar_chart' && sec.chartData?.bars) {
        bullets = sec.chartData.bars.map(b => `${b.label}: ${b.value}${sec.chartData.unit || ''}`);
        if (sec.chartData.note) bullets.push(sec.chartData.note);
      } else if (sec.type === 'donut_chart' && sec.chartData?.segments) {
        bullets = sec.chartData.segments.map(s => `${s.label}: ${s.pct || s.value}%`);
      } else if (sec.type === 'comparison') {
        const l = (sec.leftCol?.points || []).map(p => `✓ ${p}`);
        const r = (sec.rightCol?.points || []).map(p => `✗ ${p}`);
        bullets = [...l.slice(0,3), ...r.slice(0,3)];
      } else if (sec.type === 'timeline' && Array.isArray(sec.timeline)) {
        bullets = sec.timeline.map(t => `[${t.year}] ${t.event}`);
      } else if (sec.type === 'risk' && Array.isArray(sec.risks)) {
        bullets = sec.risks.map(r => `[${r.level?.toUpperCase() || 'MID'}] ${r.title}: ${r.desc}`);
      } else if (sec.type === 'outlook' && Array.isArray(sec.items)) {
        bullets = sec.items.map(it => `${it.icon || ''} ${it.title}: ${it.desc}`);
      } else if (sec.type === 'conclusion') {
        bullets = [sec.message || '', ...(sec.points || [])].filter(Boolean);
      } else {
        bullets = sec.bullets || ['내용 없음'];
      }
      return `## 슬라이드 ${i+1}: ${title}\n${bullets.map(b => `- ${b}`).join('\n')}`;
    }).join('\n\n');
    const slides = parseSlides(slideText);
    const tmpFile = await buildPptx(topic || data.title, slides, 'dark');
    pptxBuf = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    method = 'pptxgenjs_fallback';
  }

  const fileName = `${(topic || data.title || 'report').replace(/[^a-zA-Z0-9가-힣]/g,'_')}_${Date.now()}.pptx`;

  return {
    success: true, fileBuf: pptxBuf, fileName,
    slideCount: total, method, htmlPages,
    topic: topic || data.title, structured: data,
  };
}

module.exports = { run, buildCover, buildSlideHtml, buildEnd, captureSlides, THEMES };
