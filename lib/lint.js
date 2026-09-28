/**
 * lib/lint.js — 사업계획서 초안 자동 점검 (AI 없이 규칙으로)
 * ============================================================
 *  - 빈 섹션, 분량 과부족, 쪽수 제한 초과
 *  - 남아 있는 [확인 필요] 표시
 *  - 연결된 평가항목의 핵심 키워드 누락
 * 모의 심사(AI)와 함께 보여주고, 심사 AI에게도 참고 자료로 전달합니다.
 * ============================================================
 */
const shared = require("../public/shared.js");
const { CHARS_PER_PAGE } = require("./strategy");

function squash(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

/**
 * @param {object} p
 * @param {Array} p.outline   buildOutline() 결과
 * @param {Object<string,string>} p.sections  섹션 id → 본문
 * @param {object} p.analysis 공고 분석 결과
 */
function lintDraft(p) {
  const outline = p.outline || [];
  const sections = p.sections || {};
  const criteria = ((p.analysis && p.analysis.evaluation && p.analysis.evaluation.criteria) || []);
  const byId = {};
  criteria.forEach(function (c) { byId[c.id] = c; });

  let totalChars = 0;
  let placeholderCount = 0;
  const overall = [];

  const perSection = outline.map(function (sec) {
    const text = sections[sec.id] || "";
    const chars = shared.countChars(text);
    const placeholders = shared.findPlaceholders(text);
    const issues = [];
    totalChars += chars;
    placeholderCount += placeholders.length;

    if (!text.trim()) {
      issues.push({ level: "error", message: "아직 작성되지 않았습니다." });
    } else if (sec.target_chars > 0) {
      if (chars < sec.target_chars * 0.6) {
        issues.push({ level: "warn", message: "분량이 적습니다 (" + chars + "자 / 목표 " + sec.target_chars + "자). 배점 대비 근거가 부족해 보일 수 있습니다." });
      } else if (chars > sec.target_chars * 1.6) {
        issues.push({ level: "warn", message: "분량이 많습니다 (" + chars + "자 / 목표 " + sec.target_chars + "자). 핵심 위주로 줄이세요." });
      }
    }
    if (sec.max_pages && chars > sec.max_pages * CHARS_PER_PAGE) {
      issues.push({ level: "error", message: "양식의 분량 제한(" + sec.max_pages + "쪽)을 넘을 수 있습니다." });
    }
    if (placeholders.length) {
      issues.push({ level: "warn", message: "[확인 필요] " + placeholders.length + "곳을 직접 채워야 합니다." });
    }

    /* 평가 키워드 — 본문에 한 번도 안 나오면 심사위원이 해당 포인트를 못 찾을 수 있음 */
    const missing = [];
    if (text.trim()) {
      const hay = squash(text);
      (sec.criteria || []).forEach(function (c) {
        ((byId[c.id] && byId[c.id].keywords) || []).forEach(function (k) {
          const key = squash(k);
          if (key.length >= 2 && hay.indexOf(key) < 0 && missing.indexOf(k) < 0) missing.push(k);
        });
      });
      if (missing.length) {
        issues.push({ level: "info", message: "평가 키워드가 보이지 않습니다: " + missing.slice(0, 6).join(", ") });
      }
    }

    return {
      id: sec.id,
      title: sec.title,
      chars: chars,
      target_chars: sec.target_chars,
      placeholders: placeholders,
      missing_keywords: missing,
      issues: issues,
    };
  });

  const pageLimit = p.analysis && p.analysis.template && p.analysis.template.page_limit;
  const pageEstimate = Math.round((totalChars / CHARS_PER_PAGE) * 10) / 10;
  if (pageLimit && pageEstimate > pageLimit) {
    overall.push({ level: "error", message: "전체 분량이 약 " + pageEstimate + "쪽으로 제한(" + pageLimit + "쪽)을 넘을 수 있습니다." });
  }
  if (placeholderCount) {
    overall.push({ level: "warn", message: "제출 전 [확인 필요] " + placeholderCount + "곳을 사실대로 채우거나 지우세요." });
  }

  return {
    total_chars: totalChars,
    page_estimate: pageEstimate,
    placeholder_count: placeholderCount,
    sections: perSection,
    issues: overall,
  };
}

/** 심사 AI에게 넘길 요약 텍스트 */
function lintToText(lint) {
  const lines = ["전체 약 " + lint.page_estimate + "쪽, [확인 필요] " + lint.placeholder_count + "곳"];
  lint.issues.forEach(function (i) { lines.push("- (전체) " + i.message); });
  lint.sections.forEach(function (s) {
    s.issues.forEach(function (i) { lines.push("- (" + s.id + " " + s.title + ") " + i.message); });
  });
  return lines.join("\n");
}

module.exports = { lintDraft: lintDraft, lintToText: lintToText };
