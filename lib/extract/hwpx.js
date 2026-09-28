'use strict';
// HWPX(한글 XML 형식, zip) 본문 추출
const { unzipSync } = require('fflate');
const { xmlToText, HWPX } = require('./xml-text');

const SECTION = /^Contents\/section(\d+)\.xml$/;

function attr(tag, key) {
  const m = tag.match(new RegExp('\\s' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')'));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
}

// 구역 순서: content.hpf의 spine을 따르고, 없거나 빠진 구역은 번호순으로 붙인다
function sectionOrder(files) {
  const names = Object.keys(files).filter(function (n) { return SECTION.test(n); })
    .sort(function (a, b) { return a.match(SECTION)[1] - b.match(SECTION)[1]; });
  const spine = [];
  if (files['Contents/content.hpf']) {
    const hpf = new TextDecoder().decode(files['Contents/content.hpf']);
    const href = new Map();
    for (const m of hpf.matchAll(/<(?:[\w.-]+:)?item\b[^>]*>/g)) href.set(attr(m[0], 'id'), attr(m[0], 'href'));
    for (const m of hpf.matchAll(/<(?:[\w.-]+:)?itemref\b[^>]*>/g)) {
      const h = href.get(attr(m[0], 'idref'));
      const n = h && [h, 'Contents/' + h].find(function (p) { return names.includes(p); });
      if (n && !spine.includes(n)) spine.push(n);
    }
  }
  return spine.concat(names.filter(function (n) { return !spine.includes(n); }));
}

// input: zip 바이트 또는 이미 푼 { 경로: Uint8Array }
function extractHwpx(input) {
  const files = input instanceof Uint8Array
    ? unzipSync(input, { filter: function (f) { return SECTION.test(f.name) || f.name === 'Contents/content.hpf'; } })
    : input;
  const decoder = new TextDecoder();
  const parts = sectionOrder(files).map(function (n) { return xmlToText(decoder.decode(files[n]), HWPX); });
  return { text: parts.join('\n\n'), warnings: [] };
}

module.exports = { extractHwpx };
