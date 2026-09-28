'use strict';
// 업로드 문서(공고문·사업계획서 양식·평가표)에서 LLM에 넣을 글자를 뽑는다.
// 형식은 확장자가 아니라 파일 앞부분(매직 바이트)으로 판별하고, 확장자는 애매할 때만 참고한다.
const { unzipSync } = require('fflate');
const { extractHwp } = require('./hwp');
const { extractHwpx } = require('./hwpx');
const { extractDocx } = require('./docx');

const MSG = {
  emptyFile: '빈 파일입니다. 파일을 다시 확인해 주세요.',
  broken: '파일이 손상되었거나 읽을 수 없는 형식입니다. 원본 파일을 다시 확인하거나 PDF로 저장해서 올려주세요.',
  oldOffice: '구형 .doc/.xls 등은 지원하지 않습니다. PDF나 DOCX로 저장해서 올려주세요.',
  hwp3: '아주 오래된 한글 파일(HWP 3.0 이하)은 읽을 수 없습니다. 최신 한글에서 다시 저장하거나 PDF로 저장해서 올려주세요.',
  office: '엑셀·파워포인트 파일은 지원하지 않습니다. PDF로 저장해서 올려주세요.',
  zip: '압축(ZIP) 파일은 바로 읽을 수 없습니다. 압축을 풀어서 문서를 하나씩 올려주세요.',
  unknown: '알 수 없는 파일 형식입니다. 한글(HWP·HWPX), 워드(DOCX), PDF, 이미지, 텍스트 파일로 올려주세요.',
  noText: '문서에서 글자를 찾지 못했습니다. 스캔한 이미지로 만든 문서일 수 있으니 PDF로 저장해서 올려주세요.',
};

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_WANTED = /^(mimetype|word\/document\.xml|Contents\/(content\.hpf|section\d+\.xml))$/;

function startsWith(buf, bytes, offset) {
  const o = offset || 0;
  if (typeof bytes === 'string') bytes = Array.from(bytes, function (ch) { return ch.charCodeAt(0); });
  if (buf.length < o + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[o + i] !== bytes[i]) return false;
  return true;
}

function toBuffer(b) {
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return Buffer.alloc(0);
}

function imageType(buf) {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, 'GIF87a') || startsWith(buf, 'GIF89a')) return 'image/gif';
  if (startsWith(buf, 'RIFF') && startsWith(buf, 'WEBP', 8)) return 'image/webp';
  return null;
}

function extractOle(buf, ext) {
  const r = extractHwp(buf);
  if (r) return { kind: 'hwp', text: r.text, warnings: r.warnings };
  return { kind: 'unsupported', warnings: [ext === 'hwp' ? MSG.broken : MSG.oldOffice] };
}

function extractZip(buf, ext) {
  const names = [];
  const files = unzipSync(buf, { filter: function (f) { names.push(f.name); return ZIP_WANTED.test(f.name); } });
  const mime = files.mimetype ? new TextDecoder().decode(files.mimetype) : '';
  const isHwpx = !!files['Contents/section0.xml'] || mime.includes('hwp+zip');
  const isDocx = !!files['word/document.xml'];
  if (isHwpx && (!isDocx || ext !== 'docx')) return Object.assign({ kind: 'hwpx' }, extractHwpx(files));
  if (isDocx) return Object.assign({ kind: 'docx' }, extractDocx(files));
  const office = names.some(function (n) { return /^(xl|ppt)\//.test(n); }) || /^(xlsx|pptx)$/.test(ext);
  return { kind: 'unsupported', warnings: [office ? MSG.office : ext === 'zip' ? MSG.zip : MSG.broken] };
}

function countBad(s) {
  let bad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13)) bad++;
  }
  return bad;
}

// 텍스트: BOM → UTF-8(엄격) → 안 되면 UTF-8·EUC-KR(CP949) 중 깨진 글자가 적은 쪽
function decodeText(buf) {
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (startsWith(buf, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (startsWith(buf, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { /* EUC-KR 시도 */ }
  const euckr = new TextDecoder('euc-kr').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return countBad(utf8) < countBad(euckr) ? utf8 : euckr;
}

function extractText(buf) {
  const text = decodeText(buf);
  const sample = text.slice(0, 65536);
  if (sample.includes('\0') || countBad(sample) > sample.length * 0.05) return { kind: 'unsupported', warnings: [MSG.unknown] };
  return { kind: 'text', text: text };
}

function detectAndExtract(buf, ext) {
  if (startsWith(buf, OLE)) return extractOle(buf, ext);
  if (startsWith(buf, 'PK\x03\x04') || startsWith(buf, 'PK\x05\x06')) return extractZip(buf, ext);
  if (startsWith(buf, '%PDF') || (ext === 'pdf' && buf.subarray(0, 1024).includes('%PDF'))) {
    return { kind: 'pdf', mediaType: 'application/pdf', base64: buf.toString('base64') };
  }
  const img = imageType(buf);
  if (img) return { kind: 'image', mediaType: img, base64: buf.toString('base64') };
  if (startsWith(buf, 'HWP Document File')) return { kind: 'unsupported', warnings: [MSG.hwp3] };
  return extractText(buf);
}

// 줄바꿈·공백 정리 (글자를 자르지는 않는다)
function normalizeText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufeff]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function extractDocument(input) {
  const name = (input && input.name) || '';
  const ext = (name.match(/\.([^./\\]+)$/) || ['', ''])[1].toLowerCase();
  const res = { name: name, kind: 'unsupported', text: '', mediaType: null, base64: null, warnings: [] };
  const buf = toBuffer(input && input.buffer);
  if (!buf.length) { res.warnings.push(MSG.emptyFile); return res; }
  try {
    const r = detectAndExtract(buf, ext);
    res.kind = r.kind;
    res.text = normalizeText(r.text);
    res.mediaType = r.mediaType || null;
    res.base64 = r.base64 || null;
    res.warnings = (r.warnings || []).slice();
  } catch (e) {
    res.kind = 'unsupported';
    res.text = '';
    res.warnings = [MSG.broken];
  }
  if (/^(hwp|hwpx|docx|text)$/.test(res.kind) && !res.text && !res.warnings.length) {
    res.warnings.push(res.kind === 'text' ? MSG.emptyFile : MSG.noText);
  }
  return res;
}

module.exports = { extractDocument, normalizeText };
