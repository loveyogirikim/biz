/**
 * api/write.js — 사업계획서 섹션 하나 작성·보완 (POST, NDJSON 스트리밍)
 * ============================================================
 * 요청 : { analysis, profile, questions, answers, strategy, outline,
 *          section_id, sections: {섹션id: 본문}, mode: "write"|"revise", instruction? }
 * 응답 : 한 줄에 JSON 하나
 *   {"t":"thinking"}                      AI가 검토 중
 *   {"t":"delta","v":"…"}                 본문 조각 (화면에 바로 표시)
 *   {"t":"done","text":"…", "budget"?:…}  최종 확정본 — 조각 대신 이 값을 저장
 *   {"t":"error","message":"…"}
 *
 * 섹션 유형별 처리
 *   general_info → 가게 정보로 표 채우기 (AI 없음)
 *   budget       → AI가 항목(JSON) 작성 → 코드가 합계·자부담·한도 검증 후 표 작성
 *   그 외        → AI가 평가항목에 맞춰 본문 작성 (스트리밍)
 * ============================================================
 */
const { guard, sendError, ndjson } = require("../lib/http");
const llm = require("../lib/llm");
const prompts = require("../lib/prompts");
const schemas = require("../lib/schemas");
const { buildOutline } = require("../lib/strategy");
const { validateBudget, renderBudgetMarkdown } = require("../lib/budget");
const { renderGeneralInfo } = require("../lib/general-info");

module.exports = async function handler(req, res) {
  const body = guard(req, res, { ai: true });
  if (!body) return;
  const analysis = body.analysis;
  if (!analysis || !analysis.template) return sendError(res, 400, "공고 분석 결과가 없습니다.");

  const outline = Array.isArray(body.outline) && body.outline.length ? body.outline : buildOutline(analysis);
  const section = outline.find(function (s) { return s.id === body.section_id; });
  if (!section) return sendError(res, 400, "작성할 섹션을 찾지 못했습니다.");

  const sections = body.sections || {};
  const mode = body.mode === "revise" ? "revise" : "write";
  const others = outline
    .filter(function (s) { return s.id !== section.id; })
    .map(function (s) { return { title: s.title, kind: s.kind, content: sections[s.id] || "" }; });
  const context = prompts.renderContext({
    analysis: analysis,
    profile: body.profile,
    questions: body.questions,
    answers: body.answers,
    strategy: body.strategy,
  });

  const out = ndjson(res);
  try {
    if (section.kind === "general_info") {
      out.send({
        t: "done",
        text: renderGeneralInfo({ section: section, profile: body.profile, strategy: body.strategy, sections: sections }),
      });
    } else if (section.kind === "budget") {
      out.send({ t: "thinking" });
      const budget = await llm.generateJSON({
        task: "budget",
        messages: llm.contextMessage(context, prompts.budgetTask({ section: section, others: others, mode: mode, instruction: body.instruction })),
        schema: schemas.BUDGET,
        maxTokens: 16000,
        fakeData: { analysis: analysis },
      });
      const check = validateBudget(budget, analysis);
      out.send({
        t: "done",
        text: renderBudgetMarkdown(check, analysis, budget.notes),
        budget: { totals: check.totals, self_ratio_pct: check.selfRatioPct, issues: check.issues },
      });
    } else {
      const result = await llm.streamText({
        task: "write:" + section.id,
        messages: llm.contextMessage(context, prompts.sectionTask({
          section: section,
          others: others,
          mode: mode,
          instruction: body.instruction,
          current: sections[section.id],
        })),
        maxTokens: 16000,
        fakeData: { section: section, profile: body.profile, mode: mode, current: sections[section.id], instruction: body.instruction },
      }, out.send);
      out.send({ t: "done", text: result.text, truncated: result.truncated });
    }
  } catch (err) {
    out.send({ t: "error", message: err.message || "작성 중 오류가 발생했습니다." });
  }
  out.end();
};
