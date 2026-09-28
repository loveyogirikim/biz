/**
 * lib/strategy.js — 평가 배점 → 섹션별 작성 분량 배분
 * ============================================================
 * "배점이 높은 항목에 더 많은 근거와 분량을" — 심사위원이 채점표 순서대로
 * 읽는다는 전제에서, 양식의 각 섹션에 연결된 평가항목 배점을 합산해
 * 섹션별 목표 글자 수를 정합니다.
 *
 * 한 평가항목이 여러 섹션에 걸쳐 있으면 배점을 섹션 수로 나눠 배분합니다.
 * ============================================================
 */

const CHARS_PER_PAGE = 1000;       // A4 한 쪽(표·여백 포함) 평균 글자 수
const DEFAULT_TOTAL_CHARS = 9000;  // 분량 제한이 없을 때 전체 목표(약 9~10쪽)
const MIN_SECTION_CHARS = 500;
const MAX_SECTION_CHARS = 4000;

/* 서술 분량을 배점과 무관하게 고정하는 섹션 */
const FIXED_CHARS = { general_info: 0, budget: 900, schedule: 600, summary: 700 };

/** 평가항목 배점 — 배점이 없으면 균등 배분(합계 100) */
function criteriaPoints(criteria) {
  const list = criteria || [];
  const known = list.filter(function (c) { return typeof c.points === "number" && c.points > 0; });
  const fallback = list.length ? 100 / list.length : 0;
  const map = {};
  list.forEach(function (c) {
    map[c.id] = known.length === list.length ? c.points : fallback;
  });
  return map;
}

/**
 * @param {object} analysis 공고 분석 결과
 * @returns {Array<{id,title,kind,guide,required_items,max_pages,criteria,weight_pct,target_chars,order}>}
 */
function buildOutline(analysis) {
  const template = (analysis && analysis.template) || {};
  const sections = template.sections || [];
  const criteria = (analysis && analysis.evaluation && analysis.evaluation.criteria) || [];
  const points = criteriaPoints(criteria);
  const byId = {};
  criteria.forEach(function (c) { byId[c.id] = c; });

  /* 각 평가항목이 몇 개 섹션에 매핑됐는지 */
  const mapCount = {};
  sections.forEach(function (s) {
    (s.criteria_ids || []).forEach(function (cid) {
      if (byId[cid]) mapCount[cid] = (mapCount[cid] || 0) + 1;
    });
  });

  const weights = sections.map(function (s) {
    return (s.criteria_ids || []).reduce(function (sum, cid) {
      return byId[cid] ? sum + points[cid] / mapCount[cid] : sum;
    }, 0);
  });

  const total = template.page_limit ? Math.round(template.page_limit * CHARS_PER_PAGE * 0.85) : DEFAULT_TOTAL_CHARS;
  const fixedSum = sections.reduce(function (sum, s) {
    return sum + (FIXED_CHARS.hasOwnProperty(s.kind) ? FIXED_CHARS[s.kind] : 0);
  }, 0);
  const flexible = sections.filter(function (s) { return !FIXED_CHARS.hasOwnProperty(s.kind); });
  const flexibleBudget = Math.max(total - fixedSum, flexible.length * MIN_SECTION_CHARS);

  /* 평가항목이 매핑되지 않은 서술 섹션은 최소 가중치를 받습니다 */
  const positive = weights.filter(function (w) { return w > 0; });
  const floorWeight = positive.length ? Math.min.apply(null, positive) * 0.5 : 1;
  const flexWeights = sections.map(function (s, i) {
    if (FIXED_CHARS.hasOwnProperty(s.kind)) return 0;
    return weights[i] > 0 ? weights[i] : floorWeight;
  });
  const flexSum = flexWeights.reduce(function (a, b) { return a + b; }, 0) || 1;
  const weightSum = weights.reduce(function (a, b) { return a + b; }, 0) || 1;

  return sections.map(function (s, i) {
    let target;
    if (FIXED_CHARS.hasOwnProperty(s.kind)) {
      target = FIXED_CHARS[s.kind];
    } else {
      target = Math.round((flexibleBudget * flexWeights[i]) / flexSum / 50) * 50;
      target = Math.min(Math.max(target, MIN_SECTION_CHARS), MAX_SECTION_CHARS);
    }
    if (s.max_pages) target = Math.min(target, Math.round(s.max_pages * CHARS_PER_PAGE * 0.9));

    return {
      id: s.id,
      title: s.title,
      kind: s.kind,
      guide: s.guide || "",
      required_items: s.required_items || [],
      max_pages: s.max_pages || null,
      criteria: (s.criteria_ids || []).filter(function (cid) { return byId[cid]; }).map(function (cid) {
        return {
          id: cid,
          name: byId[cid].name,
          points: byId[cid].points,
          share: Math.round((points[cid] / mapCount[cid]) * 10) / 10,
        };
      }),
      weight_pct: Math.round((weights[i] / weightSum) * 1000) / 10,
      target_chars: target,
      order: writeOrder(s.kind),
    };
  });
}

/** 자동 작성 순서: 본문 → 역량 → 사업비·일정 → 요약 → 일반현황(신청 금액을 사업비에서 가져오므로 맨 마지막) */
function writeOrder(kind) {
  return { narrative: 1, team: 2, budget: 3, schedule: 4, summary: 5, general_info: 6 }[kind] || 1;
}

module.exports = { buildOutline: buildOutline, criteriaPoints: criteriaPoints, CHARS_PER_PAGE: CHARS_PER_PAGE };
