/**
 * lib/analysis.js — AI 공고 분석 결과 후처리
 * ============================================================
 * AI가 가끔 놓치는 구조적 빈틈을 코드로 메웁니다.
 *  - id 누락·중복 → 재부여
 *  - 존재하지 않는 평가항목 id 매핑 제거
 *  - 어느 섹션에도 매핑되지 않은 평가항목 → 가장 알맞은 서술 섹션에 연결
 *  - 양식 섹션이 비어 있으면 참고 양식(소상공인 일반형)으로 대체
 * ============================================================
 */
const { PRESETS } = require("./presets");

function ensureIds(list, prefix) {
  const seen = {};
  (list || []).forEach(function (item, i) {
    if (!item.id || seen[item.id]) item.id = prefix + (i + 1);
    seen[item.id] = true;
  });
}

function squash(s) {
  return String(s || "").replace(/\s+/g, "");
}

/** 평가항목과 섹션 제목·작성요령이 글자를 얼마나 공유하는지 (2글자 단위) */
function overlapScore(criterion, section) {
  const hay = squash(section.title + section.guide);
  const words = [criterion.name].concat(criterion.keywords || []).map(squash).filter(Boolean);
  let score = 0;
  words.forEach(function (w) {
    for (let i = 0; i + 2 <= w.length; i++) {
      if (hay.indexOf(w.slice(i, i + 2)) >= 0) score++;
    }
  });
  return score;
}

function presetSections() {
  const preset = PRESETS.find(function (p) { return p.id === "sosang-general"; });
  return preset.sections.map(function (s, i) {
    return { id: "S" + (i + 1), title: s.title, kind: s.kind, guide: s.guide, criteria_ids: [], max_pages: null, required_items: [] };
  });
}

/** @returns {string[]} 사장님께 보여줄 보정 안내 */
function normalizeAnalysis(a) {
  const notes = [];
  a.program = a.program || {};
  a.evaluation = a.evaluation || { source: "추정", stages: [], criteria: [], bonus: [], cutoff: "" };
  a.template = a.template || { source: "추정", preset_used: "", page_limit: null, format_rules: [], sections: [] };
  a.budget_rules = a.budget_rules || { allowed_items: [], disallowed_items: [], notes: [] };
  ["eligibility", "exclusions", "required_documents", "cautions", "missing_info"].forEach(function (k) {
    if (!Array.isArray(a[k])) a[k] = [];
  });

  ensureIds(a.eligibility, "E");
  ensureIds(a.exclusions, "X");
  ensureIds(a.evaluation.criteria, "C");

  if (!a.template.sections || !a.template.sections.length) {
    a.template.sections = presetSections();
    a.template.source = "추정";
    a.template.preset_used = "소상공인 경영개선·성장 지원형";
    notes.push("공고에서 사업계획서 양식을 찾지 못해 일반적인 소상공인 양식 구조를 사용했습니다.");
  }
  ensureIds(a.template.sections, "S");

  const criteriaIds = {};
  a.evaluation.criteria.forEach(function (c) { criteriaIds[c.id] = true; });
  a.template.sections.forEach(function (s) {
    s.criteria_ids = (s.criteria_ids || []).filter(function (id) { return criteriaIds[id]; });
  });

  /* 매핑되지 않은 평가항목 연결 */
  const writable = a.template.sections.filter(function (s) {
    return s.kind === "narrative" || s.kind === "team";
  });
  a.evaluation.criteria.forEach(function (c) {
    const mapped = a.template.sections.some(function (s) { return s.criteria_ids.indexOf(c.id) >= 0; });
    if (mapped || !writable.length) return;
    let best = writable[0];
    let bestScore = -1;
    writable.forEach(function (s) {
      const sc = overlapScore(c, s);
      if (sc > bestScore) { best = s; bestScore = sc; }
    });
    best.criteria_ids.push(c.id);
    notes.push("평가항목 '" + c.name + "'을(를) '" + best.title + "' 섹션에서 다루도록 연결했습니다.");
  });

  if (a.evaluation.source === "추정") {
    notes.push("공고에서 평가표를 찾지 못해 사업 유형에 맞는 일반 평가기준으로 추정했습니다. 실제 평가표가 있으면 함께 올려 주세요.");
  }
  return notes;
}

module.exports = { normalizeAnalysis: normalizeAnalysis };
