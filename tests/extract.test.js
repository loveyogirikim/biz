'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const CFB = require('cfb');
const { zipSync, strToU8, deflateSync } = require('fflate');
const { extractDocument, normalizeText } = require('../lib/extract');
const { parseSectionRecords } = require('../lib/extract/hwp');
const { xmlToText, DOCX } = require('../lib/extract/xml-text');

// ---------- DOCX ----------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const wp = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.join('')}</w:p>`;
const wr = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const wtc = (...ps) => `<w:tc><w:tcPr/>${ps.join('')}</w:tc>`;
const wtbl = (...rows) => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.join('')}</w:tr>`).join('')}</w:tbl>`;

const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${wp(wr('사업명'), '<w:r><w:tab/></w:r>', wr('소상공인 &amp; 스마트 &lt;지원&gt; &quot;&apos; &#44032;&#xAC00;'))}
${wp('<w:r><w:t>첫 줄</w:t><w:br/><w:t>둘째 줄</w:t></w:r>', '<w:r><w:instrText> PAGE </w:instrText></w:r>')}
${wtbl(
    [wtc(wp(wr('구분'))), wtc(wp(wr('내용'))), wtc(wp(wr('배점')))],
    [wtc(wp(wr('사업성'))), wtc(wp(wr('시장 분석')), wp(wr(' 경쟁력 ')), '<w:p/>'),
      wtc(wp(wr('30')), wtbl([wtc(wp(wr('내부1'))), wtc(wp(wr('내|부2')))]), '<w:p/>')],
  )}
<w:p><w:r><mc:AlternateContent xmlns:mc="x"><mc:Choice><w:t>글상자</w:t></mc:Choice><mc:Fallback><w:t>글상자</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>
${wp(wr('마지막 문단'))}
<w:sectPr/></w:body></w:document>`;

test('DOCX: 문단·탭·줄바꿈·엔티티·표·중첩 표', () => {
  const buffer = Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(docxXml),
  }));
  const r = extractDocument({ name: '양식.docx', buffer });
  assert.equal(r.kind, 'docx');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.mediaType, null);
  assert.equal(r.base64, null);
  assert.equal(r.text, [
    '사업명\t소상공인 & 스마트 <지원> "\' 가가',
    '첫 줄',
    '둘째 줄',
    '',
    '| 구분 | 내용 | 배점 |',
    '| 사업성 | 시장 분석 / 경쟁력 | 30 / 내부1 / 내/부2 |',
    '',
    '글상자',
    '마지막 문단',
  ].join('\n'));
});

test('xml-text: 빈 문단은 빈 줄, CDATA 포함, t 밖 글자는 무시', () => {
  const xml = `<w:document ${W}><w:body><w:p><w:r><w:t><![CDATA[a<b]]></w:t></w:r>무시</w:p><w:p/><w:p><w:r><w:t>c</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(xmlToText(xml, DOCX), 'a<b\n\nc');
});

// ---------- HWPX ----------
const HP = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
const hp = (inner) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${inner}</hp:run></hp:p>`;
const ht = (t) => `<hp:t>${t}</hp:t>`;
const htc = (...ps) => `<hp:tc><hp:subList>${ps.join('')}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>`;
const htbl = (...rows) => `<hp:tbl rowCnt="${rows.length}"><hp:sz width="1"/>${rows.map((r) => `<hp:tr>${r.join('')}</hp:tr>`).join('')}</hp:tbl>`;
const sec = (...ps) => `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${HP}>${ps.join('')}</hs:sec>`;

test('HWPX: 탭·줄바꿈·엔티티·표(문단 안)·중첩 표·구역 순서(spine)', () => {
  const section0 = sec(
    hp('<hp:secPr><hp:grid/></hp:secPr><hp:ctrl><hp:colPr/></hp:ctrl>' + ht('2025년 소상공인 지원사업 공고')),
    hp(ht('항목<hp:tab width="4000" leader="0" type="1"/>내용')),
    hp(ht('윗줄<hp:lineBreak/>아랫줄 &amp; &quot;인용&quot; &#8251;')),
    hp(ht('표 앞 글') + htbl(
      [htc(hp(ht('평가항목'))), htc(hp(ht('세부내용'))), htc(hp(ht('배점')))],
      [htc(hp(ht('사업성'))), htc(hp(ht('시장성')), hp(ht('차별성'))),
        htc(hp(ht('40') + htbl([htc(hp(ht('가'))), htc(hp(ht('나')))])))],
    )),
    hp(ht('표 다음 글')),
  );
  const section1 = sec(hp(ht('두 번째 구역')));
  const hpf = `<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/>
  </opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section1" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
  const files = {
    mimetype: strToU8('application/hwp+zip'),
    'Contents/content.hpf': strToU8(hpf),
    'Contents/header.xml': strToU8('<hh:head/>'),
    'Contents/section0.xml': strToU8(section0),
    'Contents/section1.xml': strToU8(section1),
  };
  const r = extractDocument({ name: '공고문.hwpx', buffer: Buffer.from(zipSync(files)) });
  assert.equal(r.kind, 'hwpx');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.text, [
    '두 번째 구역',
    '',
    '2025년 소상공인 지원사업 공고',
    '항목\t내용',
    '윗줄',
    '아랫줄 & "인용" ※',
    '표 앞 글',
    '',
    '| 평가항목 | 세부내용 | 배점 |',
    '| 사업성 | 시장성 / 차별성 | 40 / 가 / 나 |',
    '',
    '표 다음 글',
  ].join('\n'));
});

test('HWPX: content.hpf가 없으면 구역 번호순(숫자 기준)', () => {
  const files = { mimetype: strToU8('application/hwp+zip') };
  for (const n of [10, 2, 0, 1]) files[`Contents/section${n}.xml`] = strToU8(sec(hp(ht('S' + n))));
  const r = extractDocument({ name: 'x.hwpx', buffer: zipSync(files) });
  assert.equal(r.kind, 'hwpx');
  assert.equal(r.text, 'S0\n\nS1\n\nS2\n\nS10');
});

// ---------- HWP 5.0 ----------
const T = { PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 };

function rec(tag, level, payload, forceExtSize = false) {
  const ext = forceExtSize || payload.length >= 0xfff;
  const h = Buffer.alloc(ext ? 8 : 4);
  h.writeUInt32LE((((ext ? 0xfff : payload.length) << 20) | (level << 10) | tag) >>> 0, 0);
  if (ext) h.writeUInt32LE(payload.length, 4);
  return Buffer.concat([h, payload]);
}
const units = (...codes) => { const b = Buffer.alloc(codes.length * 2); codes.forEach((c, i) => b.writeUInt16LE(c, i * 2)); return b; };
// 문자열 또는 UTF-16 코드 배열을 이어 붙여 PARA_TEXT 페이로드를 만든다 (끝에 문단 끝 13)
const paraText = (...parts) => Buffer.concat([...parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf16le') : units(...p))), units(13)]);
const TAB = [9, 0, 0, 0, 0, 0, 0, 9]; // 인라인 컨트롤(8칸)
const EXT_TBL = [11, 0x6c20, 0x7462, 0, 0, 0, 0, 11]; // 확장 컨트롤(8칸)
const ctrlHeader = (id) => { const b = Buffer.alloc(46); b.writeUInt32LE(((id.charCodeAt(0) << 24) | (id.charCodeAt(1) << 16) | (id.charCodeAt(2) << 8) | id.charCodeAt(3)) >>> 0, 0); return b; };
const tableBody = (rows, cols) => { const b = Buffer.alloc(22); b.writeUInt16LE(rows, 4); b.writeUInt16LE(cols, 6); return b; };
const cellHeader = (col, row) => { const b = Buffer.alloc(34); b.writeUInt16LE(1, 0); b.writeUInt16LE(col, 8); b.writeUInt16LE(row, 10); b.writeUInt16LE(1, 12); b.writeUInt16LE(1, 14); return b; };
const para = (level, ...parts) => [rec(T.PARA_HEADER, level, Buffer.alloc(22)), rec(T.PARA_TEXT, level + 1, paraText(...parts))];
const cell = (L, col, row, ...texts) => [rec(T.LIST_HEADER, L + 1, cellHeader(col, row)), ...texts.flatMap((t) => para(L + 1, t))];

function sampleSection() {
  return Buffer.concat([
    ...para(0, '사업 개요', TAB, '(요약)'),
    ...para(0, '줄1', [10], '줄2', [24], '하이픈', [30], '끝', [25]),
    rec(T.PARA_HEADER, 0, Buffer.alloc(22)), // 글자 없는 빈 문단
    rec(T.PARA_HEADER, 0, Buffer.alloc(22)),
    rec(T.PARA_TEXT, 1, paraText('표 제목', EXT_TBL), true), // 0xFFF 확장 크기 헤더
    rec(0x10 + 52, 1, Buffer.alloc(8)), // PARA_CHAR_SHAPE (무시)
    rec(T.CTRL_HEADER, 1, ctrlHeader('tbl ')),
    rec(T.LIST_HEADER, 2, Buffer.alloc(16)), ...para(2, '<표 1> 평가표'), // TABLE 앞 = 캡션
    rec(T.TABLE, 2, tableBody(2, 3)),
    ...cell(1, 0, 0, '구분'), ...cell(1, 1, 0, '내용'), ...cell(1, 2, 0, '배점'),
    ...cell(1, 1, 1, '시장', '경쟁 | 우위'), ...cell(1, 0, 1, '사업성'), // 순서가 뒤섞여도 열 번호로 정렬
    rec(T.LIST_HEADER, 2, cellHeader(2, 1)),
    ...para(2, '30', EXT_TBL),
    rec(T.CTRL_HEADER, 3, ctrlHeader('tbl ')), // 셀 안 중첩 표
    rec(T.TABLE, 4, tableBody(1, 2)),
    ...cell(3, 0, 0, '안1'), ...cell(3, 1, 0, '안2'),
    ...para(0, '표 다음 문단'),
  ]);
}

const SAMPLE_TEXT = [
  '사업 개요\t(요약)',
  '줄1',
  '줄2-하이픈 끝',
  '',
  '표 제목',
  '',
  '<표 1> 평가표',
  '| 구분 | 내용 | 배점 |',
  '| 사업성 | 시장 / 경쟁 / 우위 | 30 / 안1 / 안2 |',
  '',
  '표 다음 문단',
].join('\n');

test('HWP 레코드: 컨트롤 문자·확장 크기·표·캡션·중첩 표', () => {
  assert.equal(normalizeText(parseSectionRecords(sampleSection())), SAMPLE_TEXT);
});

test('HWP 레코드: 셀 주소가 이상하거나 데이터가 잘려도 죽지 않는다', () => {
  const data = Buffer.concat([
    rec(T.CTRL_HEADER, 0, ctrlHeader('tbl ')),
    rec(T.TABLE, 1, tableBody(1, 2)),
    rec(T.LIST_HEADER, 1, Buffer.alloc(6)), ...para(1, 'A'), // 너무 짧음 → 다음 칸으로 추정
    rec(T.LIST_HEADER, 1, cellHeader(900, 900)), ...para(1, 'B'), // 말이 안 되는 주소
    ...para(0, '끝'),
  ]);
  assert.equal(normalizeText(parseSectionRecords(data)), '| A | B |\n\n끝');
  const cut = parseSectionRecords(data.subarray(0, data.length - 3));
  assert.equal(normalizeText(cut), '| A | B |');
  assert.equal(parseSectionRecords(Buffer.from([1, 2, 3])), '');
});

function fileHeader(flags) {
  const b = Buffer.alloc(256);
  b.write('HWP Document File', 0, 'latin1');
  b.writeUInt32LE(0x05010100, 32);
  b.writeUInt32LE(flags, 36);
  return b;
}

function buildHwp(flags, sections, extra = {}) {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/FileHeader', fileHeader(flags));
  CFB.utils.cfb_add(cfb, '/DocInfo', Buffer.from(deflateSync(Buffer.alloc(16))));
  sections.forEach((s, i) => CFB.utils.cfb_add(cfb, `/BodyText/Section${i}`, flags & 1 ? Buffer.from(deflateSync(s)) : s));
  for (const [path, content] of Object.entries(extra)) CFB.utils.cfb_add(cfb, path, content);
  return CFB.write(cfb, { type: 'buffer' });
}

test('HWP 파일: 압축된 본문, 여러 구역', () => {
  const buffer = buildHwp(1, [sampleSection(), Buffer.concat(para(0, '둘째 구역'))]);
  const r = extractDocument({ name: '공고문.hwp', buffer });
  assert.equal(r.kind, 'hwp');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.text, SAMPLE_TEXT + '\n\n둘째 구역');
});

test('HWP 파일: 압축 안 된 본문도 읽는다', () => {
  const r = extractDocument({ name: 'a.hwp', buffer: buildHwp(0, [Buffer.concat(para(0, '비압축'))]) });
  assert.equal(r.kind, 'hwp');
  assert.equal(r.text, '비압축');
});

test('HWP 파일: 암호 문서', () => {
  const r = extractDocument({ name: 'a.hwp', buffer: buildHwp(1 | 2, [Buffer.from('encrypted')]) });
  assert.equal(r.kind, 'hwp');
  assert.equal(r.text, '');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /암호/);
});

test('HWP 파일: 배포용 문서는 PrvText 미리보기 + 경고', () => {
  const buffer = buildHwp(1 | 4, [], { '/PrvText': Buffer.from('미리보기 <공고>\r\n내용\0\0', 'utf16le'), '/ViewText/Section0': Buffer.alloc(300, 7) });
  const r = extractDocument({ name: 'a.hwp', buffer });
  assert.equal(r.kind, 'hwp');
  assert.equal(r.text, '미리보기 <공고>\n내용');
  assert.match(r.warnings[0], /배포용/);
  const none = extractDocument({ name: 'a.hwp', buffer: buildHwp(1 | 4, []) });
  assert.equal(none.text, '');
  assert.match(none.warnings[0], /배포용/);
});

// 배포용 ViewText 구역을 같은 알고리즘으로 암호화해 만든다
function msvcXorStream(seed) {
  let state = seed >>> 0, key = 0, count = 0;
  const rand = () => { state = (Math.imul(state, 214013) + 2531011) >>> 0; return (state >>> 16) & 0x7fff; };
  return Array.from({ length: 256 }, () => {
    if (count === 0) { key = rand() & 0xff; count = (rand() & 0x0f) + 1; }
    count--;
    return key;
  });
}

function viewTextSection(sectionPlain, seed, aesKey) {
  const data = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) data[i] = (i * 37 + 11) & 0xff;
  data.writeUInt32LE(seed, 0);
  aesKey.copy(data, 4 + (seed & 0x0f));
  const xs = msvcXorStream(seed);
  for (let i = 4; i < 256; i++) data[i] ^= xs[i];
  const deflated = Buffer.from(deflateSync(sectionPlain));
  const padded = Buffer.alloc(Math.ceil(deflated.length / 16) * 16);
  deflated.copy(padded);
  const c = crypto.createCipheriv('aes-128-ecb', aesKey, null);
  c.setAutoPadding(false);
  return Buffer.concat([rec(28, 0, data), c.update(padded), c.final()]);
}

test('HWP 파일: 배포용 문서를 해독해 전체 본문을 읽는다', () => {
  const key = Buffer.from('0123456789abcdef');
  const prv = { '/PrvText': Buffer.from('미리보기만', 'utf16le') };
  const view = {
    ...prv,
    '/ViewText/Section0': viewTextSection(sampleSection(), 0x1234abcd, key),
    '/ViewText/Section1': viewTextSection(Buffer.concat(para(0, '둘째 구역 Section')), 7, Buffer.from('fedcba9876543210')),
  };
  const r = extractDocument({ name: '공고문.hwp', buffer: buildHwp(1 | 4, [], view) });
  assert.equal(r.kind, 'hwp');
  assert.equal(r.text, SAMPLE_TEXT + '\n\n둘째 구역 Section');
  assert.deepEqual(r.warnings, ['배포용(읽기 전용) 한글 문서를 해독해 읽었습니다. 표 모양이 일부 다를 수 있습니다.']);

  // 암호문이 깨지면 PrvText 미리보기로 대체
  const broken = viewTextSection(sampleSection(), 0x1234abcd, key);
  for (let i = 260; i < broken.length; i++) broken[i] ^= 0x5a;
  const b = extractDocument({ name: '공고문.hwp', buffer: buildHwp(1 | 4, [], { ...prv, '/ViewText/Section0': broken }) });
  assert.equal(b.kind, 'hwp');
  assert.equal(b.text, '미리보기만');
  assert.equal(b.warnings.length, 1);
  assert.match(b.warnings[0], /미리보기/);
});

test('HWP 파일: 본문이 깨지면 PrvText로 대체', () => {
  const extra = { '/BodyText/Section0': Buffer.from('not deflate at all', 'latin1'), '/PrvText': Buffer.from('앞부분', 'utf16le') };
  const r = extractDocument({ name: 'a.hwp', buffer: buildHwp(1, [], extra) });
  assert.equal(r.kind, 'hwp');
  assert.equal(r.text, '앞부분');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /미리보기/);
});

test('OLE이지만 HWP가 아니면(구형 .doc) unsupported', () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/WordDocument', Buffer.alloc(600, 1));
  const r = extractDocument({ name: '옛날.doc', buffer: CFB.write(cfb, { type: 'buffer' }) });
  assert.equal(r.kind, 'unsupported');
  assert.equal(r.text, '');
  assert.match(r.warnings[0], /\.doc/);
});

// ---------- 텍스트 ----------
test('텍스트: UTF-8 BOM, EUC-KR, UTF-16LE', () => {
  const bom = extractDocument({ name: 'a.txt', buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('안녕\r\n세상  \r\n')]) });
  assert.equal(bom.kind, 'text');
  assert.equal(bom.text, '안녕\n세상');
  // '공고 가나' — EUC-KR: 가 = B0 A1, 나 = B3 AA, 공 = B0 F8, 고 = B0 ED
  const euc = extractDocument({ name: 'a.txt', buffer: Buffer.from([0xb0, 0xf8, 0xb0, 0xed, 0x20, 0xb0, 0xa1, 0xb3, 0xaa]) });
  assert.equal(euc.kind, 'text');
  assert.equal(euc.text, '공고 가나');
  const u16 = extractDocument({ name: 'a.txt', buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('유니코드', 'utf16le')]) });
  assert.equal(u16.text, '유니코드');
  assert.deepEqual(u16.warnings, []);
});

test('알 수 없는 바이너리·손상 파일·빈 입력은 예외 없이 처리', () => {
  const garbage = Buffer.alloc(4096);
  let x = 12345;
  for (let i = 0; i < garbage.length; i++) { x = (x * 1103515245 + 12345) >>> 0; garbage[i] = x >>> 24; }
  const kinds = ['hwp', 'hwpx', 'docx', 'pdf', 'image', 'text', 'unsupported'];
  const inputs = [
    { name: 'x.bin', buffer: garbage },
    { name: 'x.hwp', buffer: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), garbage]) },
    { name: 'x.hwpx', buffer: Buffer.concat([Buffer.from('PK\x03\x04'), garbage]) },
    { name: 'x.hwp', buffer: Buffer.from('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05', 'latin1') },
    { name: 'x.txt', buffer: Buffer.alloc(0) },
    { name: 'x.txt', buffer: undefined },
    {},
  ];
  for (const input of inputs) {
    const r = extractDocument(input);
    assert.ok(kinds.includes(r.kind));
    assert.equal(typeof r.text, 'string');
    assert.ok(Array.isArray(r.warnings));
  }
  const g = extractDocument(inputs[0]);
  assert.equal(g.kind, 'unsupported');
  assert.ok(g.warnings.length > 0);
  assert.match(extractDocument(inputs[3]).warnings[0], /HWP 3\.0/);
});

test('ZIP: 엑셀·일반 압축 파일은 unsupported', () => {
  const xlsx = extractDocument({ name: 'a.xlsx', buffer: zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') }) });
  assert.equal(xlsx.kind, 'unsupported');
  assert.match(xlsx.warnings[0], /엑셀/);
  const zip = extractDocument({ name: '첨부.zip', buffer: zipSync({ 'a.hwp': new Uint8Array(10) }) });
  assert.equal(zip.kind, 'unsupported');
  assert.match(zip.warnings[0], /압축/);
});

// ---------- PDF·이미지 ----------
test('PDF·이미지는 base64와 mediaType을 돌려준다', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const r = extractDocument({ name: 'a.pdf', buffer: pdf });
  assert.deepEqual(r, { name: 'a.pdf', kind: 'pdf', text: '', mediaType: 'application/pdf', base64: pdf.toString('base64'), warnings: [] });
  const cases = [
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0], 'image/png'],
    [[0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'image/jpeg'],
    [[...Buffer.from('GIF89a'), 1, 0], 'image/gif'],
    [[...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')], 'image/webp'],
  ];
  for (const [bytes, type] of cases) {
    const buf = Buffer.from(bytes);
    const img = extractDocument({ name: 'photo.dat', buffer: new Uint8Array(buf) });
    assert.equal(img.kind, 'image');
    assert.equal(img.mediaType, type);
    assert.equal(img.base64, buf.toString('base64'));
    assert.equal(img.text, '');
  }
});

test('normalizeText', () => {
  assert.equal(normalizeText('  a\u00a0b  \r\nc\t \r\n\n\n\n\n\nd  \n'), 'a b\nc\n\n\nd');
  assert.equal(normalizeText(''), '');
});
