/**
 * api/review.js — 모의 심사 (POST)
 * ============================================================
 * 요청 : { analysis, profile, questions, answers, strategy, outline, sections }
 * 응답 : { review, lint, score: {total, max, pct} }
 *
 * 자동 점검(lib/lint, 규칙)과 AI 심사위원 채점을 함께 돌려줍니다.
 * ============================================================
 */
const { guard, sendError } = require("../lib/http");
const llm = require("../lib/llm");
const prompts = require("../lib/prompts");
const schemas = require("../lib/schemas");
const { buildOutline, criteriaPoints } = require("../lib/strategy");
const { lintDraft, lintToText } = require("../lib/lint");

module.exports = async function handler(req, res) {
  const body = guard(req, res, { ai: true });
  if (!body) return;
  const analysis = body.analysis;
  if (!analysis || !analysis.template) return sendError(res, 400, "공고 분석 결과가 없습니다.");

  const outline = Array.isArray(body.outline) && body.outline.length ? body.outline : buildOutline(analysis);
  const sections = body.sections || {};
  const written = outline.filter(function (s) { return (sections[s.id] || "").trim(); });
  if (!written.length) return sendError(res, 400, "작성된 섹션이 없습니다. 먼저 초안을 작성해 주세요.");

  const lint = lintDraft({ outline: outline, sections: sections, analysis: analysis });
  const draftText = outline.map(function (s) {
    return "## " + s.id + ". " + s.title + "\n" + ((sections[s.id] || "").trim() || "(미작성)");
  }).join("\n\n");

  try {
    const review = await llm.generateJSON({
      task: "review",
      messages: llm.contextMessage(
        prompts.renderContext({ analysis: analysis, profile: body.profile, questions: body.questions, answers: body.answers, strategy: body.strategy }),
        prompts.reviewTask({ draftText: draftText, lintText: lintToText(lint) })
      ),
      schema: schemas.REVIEW,
      maxTokens: 16000,
      fakeData: { analysis: analysis, lint: lint },
    });

    /* 배점 정합성: AI가 준 만점 대신 공고 배점을 쓰고, 점수는 0~만점으로 자릅니다 */
    const points = criteriaPoints((analysis.evaluation && analysis.evaluation.criteria) || []);
    let total = 0;
    let max = 0;
    (review.criteria || []).forEach(function (c) {
      const m = points[c.criterion_id] || c.max_score || 0;
      c.max_score = Math.round(m * 10) / 10;
      c.score = Math.round(Math.min(Math.max(Number(c.score) || 0, 0), c.max_score) * 10) / 10;
      total += c.score;
      max += c.max_score;
    });
    res.status(200).json({
      review: review,
      lint: lint,
      score: { total: Math.round(total * 10) / 10, max: Math.round(max * 10) / 10, pct: max ? Math.round((total / max) * 100) : 0 },
    });
  } catch (err) {
    sendError(res, err.status || 500, err.message);
  }
};
