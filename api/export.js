/**
 * api/export.js — 사업계획서 DOCX 내려받기 (POST)
 * ============================================================
 * 요청 : { analysis, profile, strategy, outline, sections, options: {include_notes} }
 * 응답 : .docx 파일 (한글 프로그램에서도 열립니다)
 * AI를 쓰지 않으므로 이용 코드·호출 제한을 적용하지 않습니다.
 * ============================================================
 */
const { guard, sendError } = require("../lib/http");
const { buildOutline } = require("../lib/strategy");
const { buildDocx } = require("../lib/docx-export");

module.exports = async function handler(req, res) {
  const body = guard(req, res);
  if (!body) return;
  const analysis = body.analysis;
  if (!analysis || !analysis.template) return sendError(res, 400, "공고 분석 결과가 없습니다.");

  try {
    const outline = Array.isArray(body.outline) && body.outline.length ? body.outline : buildOutline(analysis);
    const buffer = await buildDocx({
      analysis: analysis,
      profile: body.profile || {},
      strategy: body.strategy || {},
      outline: outline,
      sections: body.sections || {},
      options: body.options || {},
    });
    const name = ((body.profile && body.profile.business_name) || "사업계획서") + "_사업계획서.docx";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=\"business-plan.docx\"; filename*=UTF-8''" + encodeURIComponent(name));
    res.statusCode = 200;
    res.end(buffer);
  } catch (err) {
    console.error("[api/export]", err);
    sendError(res, 500, "문서 파일을 만들지 못했습니다.");
  }
};
