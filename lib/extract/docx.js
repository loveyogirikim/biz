'use strict';
// DOCX(워드) 본문 추출 — word/document.xml 본문만 읽는다 (머리말·각주 제외)
const { unzipSync } = require('fflate');
const { xmlToText, DOCX } = require('./xml-text');

// input: zip 바이트 또는 이미 푼 { 경로: Uint8Array }
function extractDocx(input) {
  const files = input instanceof Uint8Array
    ? unzipSync(input, { filter: function (f) { return f.name === 'word/document.xml'; } })
    : input;
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('word/document.xml 없음');
  return { text: xmlToText(new TextDecoder().decode(xml), DOCX), warnings: [] };
}

module.exports = { extractDocx };
