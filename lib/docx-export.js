/**
 * lib/docx-export.js — 사업계획서 DOCX 만들기
 * ============================================================
 *  - 공고의 작성 유의사항에서 글꼴·글자 크기를 읽어 적용 (예: "맑은 고딕 11pt")
 *  - 표지 → 양식 목차 순서대로 섹션 → (선택) 제출 전 확인용 부록
 *  - 본문의 개조식(□ ○ - ·)·표·굵게·[확인 필요](노란 형광) 를 그대로 옮김
 * .docx 는 한글(HWP) 프로그램에서도 열 수 있어, 한글 양식에 옮겨 붙이기 쉽습니다.
 * ============================================================
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel,
  WidthType, AlignmentType, ShadingType, Footer, PageNumber, PageBreak,
} = require("docx");
const shared = require("../public/shared.js");

const FONTS = ["맑은 고딕", "함초롬바탕", "함초롬돋움", "나눔고딕", "나눔명조", "바탕", "굴림", "돋움", "휴먼명조"];

/** 작성 유의사항 → {font, sizePt} */
function styleFromRules(rules) {
  const text = (rules || []).join(" ");
  const squashed = text.replace(/\s+/g, "");
  const font = FONTS.find(function (f) { return squashed.indexOf(f.replace(/\s+/g, "")) >= 0; }) || "맑은 고딕";
  const m = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:pt|포인트|point)/i);
  const size = m ? Number(m[1]) : 11;
  return { font: font, sizePt: size >= 8 && size <= 16 ? size : 11 };
}

function runs(text, opts) {
  opts = opts || {};
  return shared.parseInline(text).map(function (seg) {
    return new TextRun({
      text: seg.text,
      bold: seg.bold || opts.bold,
      highlight: seg.placeholder ? "yellow" : undefined,
      size: opts.size,
    });
  });
}

function tableFrom(rows) {
  const width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(function (cells, ri) {
      const padded = cells.concat(Array(width - cells.length).fill(""));
      return new TableRow({
        tableHeader: ri === 0,
        children: padded.map(function (c) {
          return new TableCell({
            shading: ri === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "E8F0EC" } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: ri === 0 ? AlignmentType.CENTER : /^[\d,.\s%원*]+$/.test(c) && c.trim() ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: runs(c, { bold: ri === 0 }),
            })],
          });
        }),
      });
    }),
  });
}

/** 섹션 본문(마크다운) → docx 요소 목록 */
function renderBlocks(md) {
  const out = [];
  shared.parseMarkdown(md).forEach(function (b) {
    if (b.type === "table") {
      out.push(tableFrom(b.rows));
      out.push(new Paragraph({ children: [] }));
    } else if (b.type === "heading") {
      out.push(new Paragraph({ heading: b.level <= 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(b.text) }));
    } else if (b.type === "item") {
      const left = 200 + b.level * 280;
      const isBox = b.marker === "□" || b.marker === "■";
      out.push(new Paragraph({
        indent: { left: left + 280, hanging: 280 },
        spacing: { before: isBox ? 160 : 40, after: 40 },
        children: [new TextRun({ text: b.marker + " ", bold: isBox })].concat(runs(b.text, { bold: isBox })),
      }));
    } else {
      out.push(new Paragraph({ spacing: { after: 80 }, children: runs(b.text) }));
    }
  });
  return out;
}

function coverPage(ctx) {
  const p = ctx.analysis.program || {};
  const today = new Date();
  const date = today.getFullYear() + ". " + (today.getMonth() + 1) + ". " + today.getDate() + ".";
  const title = (ctx.strategy && ctx.strategy.concept_title) || "";
  return [
    new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.name || "지원사업", size: 26 })] }),
    new Paragraph({ spacing: { before: 400, after: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "사 업 계 획 서", bold: true, size: 52 })] }),
    title ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "「" + title + "」", size: 30 })] }) : null,
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    tableFrom([
      ["신청 기업", ctx.profile.business_name || "[확인 필요: 상호]"],
      ["대표자", ctx.profile.owner_name || "[확인 필요: 대표자]"],
      ["작성일", date],
    ]),
    new Paragraph({ children: [new PageBreak()] }),
  ].filter(Boolean);
}

function notesAppendix(ctx) {
  const out = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("[부록] 제출 전 확인 메모 — 제출본에서는 이 부록을 삭제하세요")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("평가기준과 섹션 연결")] }),
  ];
  const rows = [["섹션", "대응 평가항목", "목표 분량"]];
  ctx.outline.forEach(function (s) {
    rows.push([s.title, s.criteria.map(function (c) { return c.name + (c.points != null ? "(" + c.points + "점)" : ""); }).join(", ") || "-", s.target_chars ? s.target_chars + "자" : "-"]);
  });
  out.push(tableFrom(rows));

  const pending = [];
  ctx.outline.forEach(function (s) {
    shared.findPlaceholders(ctx.sections[s.id]).forEach(function (ph) { pending.push(s.title + " — " + ph); });
  });
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("직접 채워야 할 곳 (" + pending.length + ")")] }));
  (pending.length ? pending : ["없음"]).forEach(function (t) {
    out.push(new Paragraph({ indent: { left: 280 }, children: runs("- " + t) }));
  });

  const docs = ctx.analysis.required_documents || [];
  if (docs.length) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("제출 서류 체크리스트")] }));
    docs.forEach(function (d) { out.push(new Paragraph({ indent: { left: 280 }, children: [new TextRun("☐ " + d)] })); });
  }
  return out;
}

/**
 * @param {object} ctx { analysis, profile, strategy, outline, sections, options }
 * @returns {Promise<Buffer>}
 */
async function buildDocx(ctx) {
  const style = styleFromRules(ctx.analysis.template && ctx.analysis.template.format_rules);
  const size = Math.round(style.sizePt * 2);
  const body = [];

  ctx.outline.forEach(function (s) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun(s.title)] }));
    const md = (ctx.sections[s.id] || "").trim();
    if (md) body.push.apply(body, renderBlocks(md));
    else body.push(new Paragraph({ children: runs("[확인 필요: 이 항목을 작성하세요]") }));
  });

  const children = coverPage(ctx).concat(body);
  if (ctx.options && ctx.options.include_notes) children.push.apply(children, notesAppendix(ctx));

  const doc = new Document({
    creator: "소상공인 사업계획서 도우미",
    title: ((ctx.analysis.program && ctx.analysis.program.name) || "") + " 사업계획서",
    styles: {
      default: {
        document: { run: { font: style.font, size: size }, paragraph: { spacing: { line: 312 } } },
        heading1: { run: { font: style.font, size: size + 6, bold: true, color: "1F4E3D" } },
        heading2: { run: { font: style.font, size: size + 2, bold: true } },
        heading3: { run: { font: style.font, size: size, bold: true } },
      },
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["- ", PageNumber.CURRENT, " -"], size: 18 })] })],
        }),
      },
      children: children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx: buildDocx, styleFromRules: styleFromRules };
