/**
 * api/prepare.js — 자격 점검 + 가점 + 추가 질문 + 작성 전략 (POST)
 * ============================================================
 * 요청 : { analysis, profile }
 * 응답 : { eligibility, small_business, bonus, questions, strategy }
 *
 * 숫자·지역 조건은 lib/eligibility 가 코드로 확정하고, 나머지만 AI가 판단합니다.
 * ============================================================
 */
const { guard, sendError } = require("../lib/http");
const llm = require("../lib/llm");
const prompts = require("../lib/prompts");
const schemas = require("../lib/schemas");
const { evaluateEligibility, mergeJudgements, checkSmallBusiness } = require("../lib/eligibility");

module.exports = async function handler(req, res) {
  const body = guard(req, res, { ai: true });
  if (!body) return;
  const analysis = body.analysis;
  const profile = body.profile || {};
  if (!analysis || !analysis.program) return sendError(res, 400, "공고 분석 결과가 없습니다. 1단계부터 다시 진행해 주세요.");

  const ruleResults = evaluateEligibility(analysis.eligibility, profile);
  const pending = ruleResults.filter(function (r) { return r.decided_by === "pending"; });

  try {
    const prep = await llm.generateJSON({
      task: "prepare",
      messages: llm.contextMessage(prompts.renderContext({ analysis: analysis, profile: profile }), prompts.prepareTask(pending)),
      schema: schemas.PREPARE,
      maxTokens: 16000,
      fakeData: { profile: profile, pending: pending },
    });
    res.status(200).json({
      eligibility: mergeJudgements(ruleResults, prep.eligibility_judgements),
      small_business: checkSmallBusiness(profile),
      bonus: prep.bonus_opportunities || [],
      questions: prep.questions || [],
      strategy: prep.strategy || {},
    });
  } catch (err) {
    sendError(res, err.status || 500, err.message);
  }
};
