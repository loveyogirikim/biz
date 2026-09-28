'use strict';
// HWP 5.0 (OLE 복합문서) 본문 추출
const crypto = require('node:crypto');
const CFB = require('cfb');
const { inflateSync, unzlibSync } = require('fflate');
const { cellText, emitTable } = require('./xml-text');

// 레코드 태그 (HWPTAG_BEGIN = 0x10)
const PARA_HEADER = 0x10 + 50, PARA_TEXT = 0x10 + 51, CTRL_HEADER = 0x10 + 55;
const LIST_HEADER = 0x10 + 56, TABLE = 0x10 + 61, DISTRIBUTE_DOC_DATA = 0x10 + 12;

const MSG = {
  encrypted: '암호가 걸린 한글 파일이라 읽을 수 없습니다. 암호를 풀거나 PDF로 저장해서 올려주세요.',
  distributionOk: '배포용(읽기 전용) 한글 문서를 해독해 읽었습니다. 표 모양이 일부 다를 수 있습니다.',
  distribution: '배포용(읽기 전용) 한글 문서라 앞부분 미리보기만 읽었습니다. 정확한 분석을 위해 한글에서 PDF로 저장해서 올려주세요.',
  distributionEmpty: '배포용(읽기 전용) 한글 문서라 내용을 읽을 수 없습니다. 한글에서 PDF로 저장해서 올려주세요.',
  preview: '한글 파일 본문을 제대로 읽지 못해 앞부분 미리보기만 읽었습니다. 정확한 분석을 위해 한글에서 PDF로 저장해서 올려주세요.',
  section: function (i) { return '한글 파일의 ' + i + '번째 구역을 읽지 못해 일부 내용이 빠졌을 수 있습니다. 한글에서 PDF로 저장해서 올려주시면 더 정확합니다.'; },
};

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

// 레코드 헤더: tagId 10비트 | level 10비트 | size 12비트 (0xFFF면 다음 4바이트가 실제 크기)
function readRecords(data) {
  const recs = [];
  let p = 0;
  while (p + 4 <= data.length) {
    const h = u32(data, p);
    let size = h >>> 20;
    p += 4;
    if (size === 0xfff) { if (p + 4 > data.length) break; size = u32(data, p); p += 4; }
    const end = Math.min(p + size, data.length); // 잘린 데이터는 남은 만큼만
    recs.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, payload: data.subarray(p, end) });
    p = end;
  }
  return recs;
}

// PARA_TEXT: UTF-16LE. 32 미만은 컨트롤 문자 — 문자형은 1칸, 인라인·확장형은 8칸을 차지한다
function decodeParaText(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length;) {
    const c = u16(b, i);
    if (c >= 32) { s += String.fromCharCode(c); i += 2; continue; }
    if (c === 0 || c === 10 || c === 13 || c >= 24) {
      s += c === 10 || c === 13 ? '\n' : c === 24 ? '-' : c >= 30 ? ' ' : '';
      i += 2;
    } else {
      if (c === 9) s += '\t'; // 인라인 컨트롤 중 탭만 글자로 살린다
      i += 16;
    }
  }
  return s.replace(/\n+$/, '');
}

function ctrlId(b) {
  if (b.length < 4) return '';
  const v = u32(b, 0);
  return String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

// 셀 주소: LIST_HEADER 오프셋 8(열)·10(행). 이상하면 현재 행의 다음 칸으로 추정
function addCell(tb, b) {
  let col = b.length >= 12 ? u16(b, 8) : -1, row = b.length >= 12 ? u16(b, 10) : -1;
  const ok = col >= 0 && col < 500 && row < 500 && (!tb.nCols || col < tb.nCols) &&
    (!tb.nRows || row < tb.nRows) && !tb.seen.has(row + ',' + col);
  if (!ok) {
    const last = tb.cells[tb.cells.length - 1];
    row = last ? last.row : 0;
    col = last ? last.col + 1 : 0;
  }
  tb.seen.add(row + ',' + col);
  const cell = { row: row, col: col, paras: [] };
  tb.cells.push(cell);
  return cell;
}

// 셀을 행 번호·열 번호 순으로 정렬해 [[문단[]]] 형태로
function tableRows(tb) {
  const byRow = new Map();
  for (const c of tb.cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c); }
  return Array.from(byRow.keys()).sort(function (a, b) { return a - b; }).map(function (r) {
    return byRow.get(r).sort(function (a, b) { return a.col - b.col; }).map(function (c) { return c.paras; });
  });
}

// 구역(Section) 레코드 → 글자. 표는 xml-text와 같은 모양으로 그린다
function parseSectionRecords(data) {
  const doc = [];
  const tables = []; // 열린 표 스택 { level, cells, cell, caption, body, nRows, nCols, seen }
  const target = function () { const t = tables[tables.length - 1]; return t ? (t.cell ? t.cell.paras : t.caption) : doc; };
  const close = function () { const tb = tables.pop(); emitTable(target(), tableRows(tb), tb.caption, tables.length > 0); };

  for (const r of readRecords(data)) {
    while (tables.length && r.level <= tables[tables.length - 1].level) close();
    const tb = tables[tables.length - 1];
    if (r.tag === PARA_HEADER) target().push('');
    else if (r.tag === PARA_TEXT) {
      const t = target();
      if (!t.length) t.push('');
      t[t.length - 1] += decodeParaText(r.payload);
    } else if (r.tag === CTRL_HEADER && ctrlId(r.payload) === 'tbl ') {
      tables.push({ level: r.level, cells: [], cell: null, caption: [], body: false, nRows: 0, nCols: 0, seen: new Set() });
    } else if (tb && r.level === tb.level + 1 && r.tag === TABLE) {
      tb.body = true;
      if (r.payload.length >= 8) { tb.nRows = u16(r.payload, 4); tb.nCols = u16(r.payload, 6); }
    } else if (tb && r.level === tb.level + 1 && r.tag === LIST_HEADER) {
      tb.cell = tb.body ? addCell(tb, r.payload) : null; // 표 본체(TABLE) 앞의 리스트는 캡션
    }
  }
  while (tables.length) close();
  return doc.join('\n');
}

function stream(cfb, path) {
  const e = CFB.find(cfb, path);
  if (!e) return null;
  const c = e.content || [];
  return c instanceof Uint8Array ? c : Uint8Array.from(c);
}

function inflate(raw) {
  try { return inflateSync(raw); } catch (e) {
    try { return unzlibSync(raw); } catch (_) { throw e; }
  }
}

// 배포용 문서 데이터(256바이트) → AES 키. MSVC rand()로 만든 XOR 열로 4번째 바이트부터 풀고,
// 오프셋 4 + (seed & 0x0F)에서 16바이트를 키로 쓴다
function distributionKey(payload) {
  const data = Uint8Array.from(payload);
  const seed = u32(data, 0);
  let state = seed;
  const rand = function () { state = (Math.imul(state, 214013) + 2531011) >>> 0; return (state >>> 16) & 0x7fff; };
  let key = 0, count = 0;
  for (let i = 0; i < 256; i++) {
    if (count === 0) { key = rand() & 0xff; count = (rand() & 0x0f) + 1; }
    if (i >= 4) data[i] ^= key;
    count--;
  }
  const off = 4 + (seed & 0x0f);
  return data.subarray(off, off + 16);
}

// ViewText 구역: [DISTRIBUTE_DOC_DATA 레코드(헤더 4 + 256)] + AES-128-ECB 암호문
function decryptViewSection(raw) {
  const h = raw.length >= 276 ? u32(raw, 0) : 0;
  if ((h & 0x3ff) !== DISTRIBUTE_DOC_DATA || h >>> 20 !== 256) throw new Error('배포용 문서 데이터 없음');
  const body = raw.subarray(260, 260 + ((raw.length - 260) & ~15));
  const d = crypto.createDecipheriv('aes-128-ecb', distributionKey(raw.subarray(4, 260)), null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(body), d.final()]);
}

// 해독 결과가 글자다운지: 한글·영문이 있고 깨진 글자(U+FFFD·제어문자)가 2% 미만
function plausibleText(s) {
  if (!/[가-힣A-Za-z]/.test(s)) return false;
  let bad = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10)) bad++; }
  return bad < s.length * 0.02;
}

// 구역 스트림(dir + 0, 1, …)을 차례로 읽는다. 깨진 구역은 건너뛰고 경고
function readSections(cfb, dir, compressed, decrypt) {
  const parts = [], warnings = [];
  for (let i = 0; ; i++) {
    const raw = stream(cfb, dir + i);
    if (!raw) break;
    try {
      const plain = decrypt ? decrypt(raw) : raw;
      parts.push(parseSectionRecords(compressed ? inflate(plain) : plain));
    } catch (e) { warnings.push(MSG.section(i + 1)); }
  }
  return { text: parts.join('\n\n'), warnings: warnings };
}

// PrvText: 문서 앞부분 미리보기 (UTF-16LE, 압축 없음)
function previewText(cfb) {
  const b = stream(cfb, '/PrvText');
  return b ? new TextDecoder('utf-16le').decode(b).replace(/\0+$/, '').trim() : '';
}

// HWP 5.0이면 { text, warnings }, OLE이지만 HWP가 아니면 null
function extractHwp(buffer) {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const header = stream(cfb, '/FileHeader');
  if (!header || String.fromCharCode.apply(null, header.subarray(0, 17)) !== 'HWP Document File') return null;
  const flags = header.length >= 40 ? u32(header, 36) : 0;
  if (flags & 2) return { text: '', warnings: [MSG.encrypted] };
  if (flags & 4) {
    // 배포용: ViewText를 해독해 전체 본문을 읽고, 실패하면 PrvText 미리보기로 대체
    const view = readSections(cfb, '/ViewText/Section', flags & 1, decryptViewSection);
    if (plausibleText(view.text)) return { text: view.text, warnings: [MSG.distributionOk].concat(view.warnings) };
    const prv = previewText(cfb);
    return { text: prv, warnings: [prv ? MSG.distribution : MSG.distributionEmpty] };
  }
  const body = readSections(cfb, '/BodyText/Section', flags & 1, null);
  if (!body.text.trim()) {
    const prv = previewText(cfb);
    if (prv) return { text: prv, warnings: [MSG.preview] };
  }
  return body;
}

module.exports = { extractHwp, parseSectionRecords, decodeParaText, readRecords, distributionKey };
