/**
 * lib/budget.js — 사업비 집행계획 검증 + 표 만들기
 * ============================================================
 * 사업비는 숫자가 하나라도 안 맞으면 서류에서 바로 감점·보완 요청을 받습니다.
 * 그래서 AI는 항목(JSON)만 만들고, 합계·자부담 비율·한도 검사와 표 작성은
 * 이 파일이 계산으로 처리합니다.
 * ============================================================
 */

function toInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

function won(n) {
  return toInt(n).toLocaleString("ko-KR");
}

/**
 * @param {{items: Array, notes?: string[]}} budget  AI가 만든 사업비 항목
 * @param {object} analysis  공고 분석 결과 (program.max_support_krw 등)
 * @returns {{rows, totals, selfRatioPct, issues: Array<{level, message}>}}
 */
function validateBudget(budget, analysis) {
  const program = (analysis && analysis.program) || {};
  const rules = (analysis && analysis.budget_rules) || {};
  const issues = [];

  const rows = ((budget && budget.items) || []).map(function (it) {
    const row = {
      category: String(it.category || "").trim(),
      item: String(it.item || "").trim(),
      basis: String(it.basis || "").trim(),
      gov_krw: toInt(it.gov_krw),
      self_cash_krw: toInt(it.self_cash_krw),
      self_inkind_krw: toInt(it.self_inkind_krw),
    };
    row.total_krw = row.gov_krw + row.self_cash_krw + row.self_inkind_krw;
    return row;
  });

  const totals = rows.reduce(function (t, r) {
    t.gov += r.gov_krw;
    t.self_cash += r.self_cash_krw;
    t.self_inkind += r.self_inkind_krw;
    return t;
  }, { gov: 0, self_cash: 0, self_inkind: 0 });
  totals.self = totals.self_cash + totals.self_inkind;
  totals.total = totals.gov + totals.self;

  if (!rows.length || totals.total <= 0) {
    issues.push({ level: "error", message: "사업비 항목이 비어 있습니다." });
  }

  rows.forEach(function (r) {
    if (r.gov_krw < 0 || r.self_cash_krw < 0 || r.self_inkind_krw < 0) {
      issues.push({ level: "error", message: "'" + r.item + "' 금액에 음수가 있습니다." });
    }
    if (r.total_krw % 1000 !== 0) {
      issues.push({ level: "warn", message: "'" + r.item + "' 금액이 천원 단위로 끊어지지 않습니다 (" + won(r.total_krw) + "원)." });
    }
  });

  const max = program.max_support_krw;
  if (max && totals.gov > max) {
    issues.push({
      level: "error",
      message: "정부지원금 합계 " + won(totals.gov) + "원이 최대 지원금 " + won(max) + "원을 넘습니다.",
    });
  }

  const selfRatioPct = totals.total > 0 ? (totals.self / totals.total) * 100 : 0;
  const required = program.self_pay_ratio_pct;
  if (required && selfRatioPct + 0.05 < required) {
    issues.push({
      level: "error",
      message: "자부담 비율이 " + selfRatioPct.toFixed(1) + "%로 공고 기준(총사업비의 " + required + "% 이상)보다 낮습니다.",
    });
  }

  /* 사용 불가 비목과 겹치는 항목 — 키워드가 짧으면 오탐이 많아 2글자 이상만 */
  (rules.disallowed_items || []).forEach(function (bad) {
    const key = String(bad || "").replace(/\s+/g, "");
    if (key.length < 2) return;
    rows.forEach(function (r) {
      const hay = (r.category + r.item + r.basis).replace(/\s+/g, "");
      if (hay.includes(key)) {
        issues.push({ level: "warn", message: "'" + r.item + "' 항목이 사용 불가 비목('" + bad + "')에 해당할 수 있습니다." });
      }
    });
  });

  return { rows: rows, totals: totals, selfRatioPct: selfRatioPct, issues: issues };
}

/** 검증 결과 → 사업계획서에 넣을 마크다운 표 */
function renderBudgetMarkdown(result, analysis, notes) {
  const program = (analysis && analysis.program) || {};
  const lines = [
    "| 비목 | 세부 내용 | 산출 근거 | 정부지원금(원) | 자부담 현금(원) | 자부담 현물(원) | 합계(원) |",
    "|---|---|---|---:|---:|---:|---:|",
  ];
  result.rows.forEach(function (r) {
    lines.push("| " + [r.category, r.item, r.basis, won(r.gov_krw), won(r.self_cash_krw), won(r.self_inkind_krw), won(r.total_krw)]
      .map(function (c) { return String(c).replace(/\|/g, "/"); }).join(" | ") + " |");
  });
  const t = result.totals;
  lines.push("| **합계** |  |  | **" + won(t.gov) + "** | **" + won(t.self_cash) + "** | **" + won(t.self_inkind) + "** | **" + won(t.total) + "** |");

  const out = [lines.join("\n"), ""];
  const ratioLine = "※ 총사업비 " + won(t.total) + "원 = 정부지원금 " + won(t.gov) + "원 + 자부담 " + won(t.self) +
    "원 (자부담 비율 " + result.selfRatioPct.toFixed(1) + "%" +
    (program.self_pay_ratio_pct ? ", 공고 기준 " + program.self_pay_ratio_pct + "% 이상" : "") + ")";
  out.push(ratioLine);
  (notes || []).forEach(function (n) { if (n) out.push("※ " + n); });
  return out.join("\n");
}

module.exports = { validateBudget: validateBudget, renderBudgetMarkdown: renderBudgetMarkdown };
