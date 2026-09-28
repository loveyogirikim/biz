'use strict';
// 의존성 없는 XML 글자 추출기 (HWPX·DOCX 공용).
// 태그는 접두어(w:, hp:)를 뗀 로컬 이름으로 비교하고, t 요소 안의 글자만 모은다.

// 주석 | CDATA | 선언(<?..?>, <!..>) | 태그 | 글자
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

const DOCX = {
  p: 'p', t: 't', tbl: 'tbl', tr: 'tr', tc: 'tc',
  chars: { tab: '\t', ptab: '\t', br: '\n', cr: '\n', noBreakHyphen: '-' },
  skip: ['tabs', 'Fallback'], // tabs: 탭 위치 정의(글자 아님), Fallback: 글상자 중복 사본
};
const HWPX = {
  p: 'p', t: 't', tbl: 'tbl', tr: 'tr', tc: 'tc',
  chars: { tab: '\t', lineBreak: '\n', nbSpace: ' ', fwSpace: ' ', hyphen: '-' },
  skip: [],
};

const ENTITIES = new Map([['lt', '<'], ['gt', '>'], ['amp', '&'], ['quot', '"'], ['apos', "'"]]);

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
    if (e[0] !== '#') return ENTITIES.has(e) ? ENTITIES.get(e) : m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

// 셀 안 문단들을 한 줄로: ' / '로 잇고, 표 구분자와 겹치는 '|'는 '/'로 바꾼다
function cellText(paras) {
  return paras.join('\n').split('\n')
    .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
    .filter(Boolean).join(' / ').replace(/\|/g, '/');
}

// 표 출력: 최상위 표는 "| a | b |" 한 줄씩(앞뒤 빈 줄), 중첩 표는 바깥 셀의 문단으로 평탄화
function emitTable(out, rows, caption, nested) {
  const cap = caption.filter(function (s) { return s.trim(); });
  if (nested) {
    for (const s of cap) out.push(s);
    for (const row of rows) for (const c of row) { const s = cellText(c); if (s) out.push(s); }
    return;
  }
  out.push('');
  for (const s of cap) out.push(s);
  for (const row of rows) if (row.length) out.push('| ' + row.map(cellText).join(' | ') + ' |');
  out.push('');
}

function xmlToText(xml, cfg) {
  const doc = [];    // 최상위 줄
  const tables = []; // 열린 표 { rows, cell, caption }
  const paras = [];  // 열린 문단 { text, flushed } — HWPX는 표가 문단 안에 있어 중첩된다
  let inT = 0, skip = 0, m;
  const out = function () { const tb = tables[tables.length - 1]; return tb ? tb.cell || tb.caption : doc; };
  const endPara = function (p) { if (p.text.trim() || !p.flushed) out().push(p.text); };

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(xml))) {
    const cdata = m[1], close = m[2], qname = m[3], selfClose = m[5], text = m[6];
    if (qname === undefined) {
      if (inT && !skip && paras.length && (text !== undefined || cdata !== undefined)) {
        paras[paras.length - 1].text += cdata !== undefined ? cdata : decodeEntities(text);
      }
      continue;
    }
    const name = qname.slice(qname.indexOf(':') + 1);
    const open = !close, empty = !!selfClose;
    if (cfg.skip.includes(name)) { if (!empty) skip = Math.max(0, skip + (open ? 1 : -1)); continue; }
    if (skip) continue;
    const tb = tables[tables.length - 1];
    if (name === cfg.t) {
      if (!empty) inT = Math.max(0, inT + (open ? 1 : -1));
    } else if (name === cfg.p) {
      if (empty) { if (open) out().push(''); } else if (open) paras.push({ text: '', flushed: false });
      else if (paras.length) endPara(paras.pop());
    } else if (name === cfg.tbl) {
      if (empty) continue;
      if (open) {
        // 표 앞에 쓰인 문단 글자를 먼저 내보내 순서를 지킨다
        const p = paras[paras.length - 1];
        if (p) { if (p.text.trim()) out().push(p.text); p.text = ''; p.flushed = true; }
        tables.push({ rows: [], cell: null, caption: [] });
      } else if (tb) {
        tables.pop();
        emitTable(out(), tb.rows, tb.caption, tables.length > 0);
      }
    } else if (name === cfg.tr) {
      if (open && tb) tb.rows.push([]);
    } else if (name === cfg.tc) {
      if (!tb) continue;
      if (open) {
        if (!tb.rows.length) tb.rows.push([]);
        const cell = [];
        tb.rows[tb.rows.length - 1].push(cell);
        tb.cell = empty ? null : cell;
      } else tb.cell = null;
    } else if (open && paras.length && Object.hasOwn(cfg.chars, name)) {
      paras[paras.length - 1].text += cfg.chars[name];
    }
  }
  // 잘린 XML: 열린 표·문단을 마저 닫는다
  while (tables.length) { const tb = tables.pop(); emitTable(out(), tb.rows, tb.caption, tables.length > 0); }
  for (const p of paras) endPara(p);
  return doc.join('\n');
}

module.exports = { xmlToText, decodeEntities, cellText, emitTable, DOCX, HWPX };
