/**
 * api/analyze.js — 공고문 분석 (POST)
 * ============================================================
 * 요청 : { files?: [{name, data(base64)}], text?: string, meta?: {title, agency, url, period} }
 * 응답 : { analysis, outline, sources: [{name, kind, chars, warnings}], notes: string[] }
 *
 * HWP·HWPX·DOCX·TXT 는 서버에서 글자를 뽑고, PDF·이미지는 Claude에 문서로 그대로 보냅니다.
 * ============================================================
 */
const { guard, sendError } = require("../lib/http");
const llm = require("../lib/llm");
const prompts = require("../lib/prompts");
const schemas = require("../lib/schemas");
const { extractDocument } = require("../lib/extract");
const { normalizeAnalysis } = require("../lib/analysis");
const { buildOutline } = require("../lib/strategy");

const MAX_FILES = 6;
const MAX_TEXT_CHARS = 300000;

module.exports = async function handler(req, res) {
  const body = guard(req, res, { ai: true });
  if (!body) return;

  const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
  const pasted = String(body.text || "").trim();
  if (!files.length && !pasted) {
    return sendError(res, 400, "공고문 파일을 올리거나 공고 내용을 붙여넣어 주세요.");
  }

  const sources = [];
  const blocks = [];
  let totalChars = 0;

  files.forEach(function (f) {
    const name = String(f.name || "첨부파일").slice(0, 200);
    const doc = extractDocument({ name: name, buffer: Buffer.from(String(f.data || ""), "base64") });
    sources.push({ name: name, kind: doc.kind, chars: doc.text.length, warnings: doc.warnings });

    if (doc.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 }, title: name });
    } else if (doc.kind === "image") {
      blocks.push({ type: "text", text: "=== 이미지 파일: " + name + " ===" });
      blocks.push({ type: "image", source: { type: "base64", media_type: doc.mediaType, data: doc.base64 } });
    } else if (doc.text) {
      blocks.push({ type: "text", text: "=== 파일: " + name + " ===\n" + doc.text });
      totalChars += doc.text.length;
    }
  });

  if (pasted) {
    blocks.push({ type: "text", text: "=== 붙여넣은 공고 내용 ===\n" + pasted });
    totalChars += pasted.length;
  }

  if (!blocks.length) {
    const why = sources.map(function (s) { return s.warnings.join(" "); }).filter(Boolean).join(" ");
    return sendError(res, 422, "파일에서 내용을 읽지 못했습니다. " + (why || "PDF로 저장해서 다시 올려 주세요."));
  }
  if (totalChars > MAX_TEXT_CHARS) {
    return sendError(res, 413, "문서가 너무 깁니다(" + totalChars.toLocaleString("ko-KR") + "자). 공고문 본문과 사업계획서 양식·평가표만 올려 주세요.");
  }

  try {
    const analysis = await llm.generateJSON({
      task: "analyze",
      messages: [{ role: "user", content: blocks.concat([{ type: "text", text: prompts.analyzeTask(body.meta) }]) }],
      schema: schemas.ANALYSIS,
      maxTokens: 32000,
    });
    const notes = normalizeAnalysis(analysis);
    res.status(200).json({ analysis: analysis, outline: buildOutline(analysis), sources: sources, notes: notes });
  } catch (err) {
    sendError(res, err.status || 500, err.message);
  }
};
