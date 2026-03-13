'use strict';
/**
 * Excel Pipeline — AI가 데이터/표를 생성하고 exceljs로 .xlsx 파일 출력
 */
const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// 테마 색상
const COLORS = {
  header:    '1E3A5F',
  headerFont:'FFFFFF',
  accent:    '4A90D9',
  altRow:    'EBF3FD',
  border:    'BDD7EE',
};

/**
 * AI 응답 텍스트에서 표(테이블) 추출
 * Markdown 표 형식: | 헤더1 | 헤더2 | ...
 */
function parseTable(text) {
  const lines = text.split('\n');
  const tables = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim());
      if (!current) {
        current = { headers: cells, rows: [] };
      } else if (trimmed.match(/^[\s|:-]+$/)) {
        // 구분선 (--- | ---) 무시
        continue;
      } else {
        current.rows.push(cells);
      }
    } else if (current && current.rows.length > 0) {
      tables.push(current);
      current = null;
    } else if (current) {
      current = null;
    }
  }
  if (current && current.rows.length > 0) tables.push(current);

  return tables;
}

/**
 * 단순 키-값 또는 리스트 형식 파싱 (표가 없을 때 fallback)
 */
function parseListData(text) {
  const rows = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const l = line.replace(/^[-*•\d.]+\s*/, '').trim();
    if (!l) continue;
    // "항목: 값" 형식
    const colonIdx = l.indexOf(':');
    if (colonIdx > 0) {
      rows.push([l.slice(0, colonIdx).trim(), l.slice(colonIdx + 1).trim()]);
    } else {
      rows.push([l]);
    }
  }
  return rows;
}

/**
 * exceljs로 워크북 생성
 */
async function buildExcel(topic, tables, rawText) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'AI Orchestrator';
  wb.created  = new Date();
  wb.modified = new Date();
  wb.lastModifiedBy = 'AI Platform';

  // ── 각 테이블 → 별도 시트 ──────────────────────────────────
  tables.forEach((table, tIdx) => {
    const sheetName = tables.length === 1 ? '데이터' : `시트${tIdx + 1}`;
    const ws = wb.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    // 헤더 행
    const headerRow = ws.addRow(table.headers);
    headerRow.height = 28;
    headerRow.eachCell(cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.header}` } };
      cell.font   = { bold: true, color: { argb: `FF${COLORS.headerFont}` }, size: 12 };
      cell.border = {
        top: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
        bottom: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
        left: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
        right: { style: 'thin', color: { argb: `FF${COLORS.border}` } },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    // 데이터 행
    table.rows.forEach((row, rIdx) => {
      const dataRow = ws.addRow(row);
      dataRow.height = 22;
      const isAlt = rIdx % 2 === 0;
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        if (colNum <= table.headers.length) {
          if (isAlt) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.altRow}` } };
          }
          cell.border = {
            top:    { style: 'hair', color: { argb: `FF${COLORS.border}` } },
            bottom: { style: 'hair', color: { argb: `FF${COLORS.border}` } },
            left:   { style: 'hair', color: { argb: `FF${COLORS.border}` } },
            right:  { style: 'hair', color: { argb: `FF${COLORS.border}` } },
          };
          cell.alignment = { vertical: 'middle', wrapText: true };
        }
      });
    });

    // 열 너비 자동 조정
    ws.columns.forEach((col, i) => {
      const maxLen = Math.max(
        table.headers[i]?.length || 10,
        ...table.rows.map(r => (r[i] || '').length)
      );
      col.width = Math.min(Math.max(maxLen + 4, 12), 40);
    });

    // 자동 필터
    if (table.headers.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.headers.length } };
    }

    // 틀 고정 (헤더)
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });

  // ── 원본 텍스트 시트 (참고용) ────────────────────────────────
  if (rawText) {
    const infoWs = wb.addWorksheet('AI 원본');
    infoWs.addRow(['주제', topic]);
    infoWs.addRow(['생성일', new Date().toLocaleDateString('ko-KR')]);
    infoWs.addRow(['생성자', 'AI Orchestrator']);
    infoWs.addRow([]);
    const lines = rawText.split('\n').filter(l => l.trim());
    lines.forEach(l => infoWs.addRow([l.replace(/^[-*•]\s*/, '')]));
    infoWs.getColumn(1).width = 20;
    infoWs.getColumn(2).width = 60;
  }

  const tmpDir  = os.tmpdir();
  const outFile = path.join(tmpDir, `excel_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(outFile);
  return outFile;
}

/**
 * 메인 실행 함수
 */
async function run(opts = {}) {
  const { topic = '데이터', content = null, aiGenerate = true } = opts;

  let rawText = content;

  // AI로 표 데이터 생성
  if (aiGenerate || !rawText) {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `당신은 데이터 분석 전문가입니다. 
요청된 주제에 대해 Markdown 표 형식으로 데이터를 생성하세요.
반드시 하나 이상의 표를 포함해야 합니다.
형식:
| 컬럼1 | 컬럼2 | 컬럼3 |
|-------|-------|-------|
| 데이터 | 데이터 | 데이터 |

표 외에도 핵심 인사이트를 불릿 포인트로 추가하세요.`,
      }, {
        role: 'user',
        content: `"${topic}"에 관한 데이터 표와 분석을 생성해주세요.`,
      }],
      temperature: 0.6,
      max_tokens:  2500,
    });
    rawText = resp.choices[0].message.content;
  }

  let tables = parseTable(rawText);

  // 표가 없으면 리스트 데이터로 fallback
  if (!tables.length) {
    const rows = parseListData(rawText);
    tables = [{ headers: ['항목', '내용'], rows }];
  }

  const outFile = await buildExcel(topic, tables, rawText);
  const buf     = fs.readFileSync(outFile);
  fs.unlinkSync(outFile);

  return {
    success:    true,
    fileBuf:    buf,
    fileName:   `${topic.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${Date.now()}.xlsx`,
    mimeType:   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    tableCount: tables.length,
    rowCount:   tables.reduce((s, t) => s + t.rows.length, 0),
    content:    rawText,
  };
}

module.exports = { run, parseTable, buildExcel };
