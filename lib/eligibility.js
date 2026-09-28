/**
 * lib/eligibility.js — 신청 자격 규칙 판정 (AI 없이 코드로 확정)
 * ============================================================
 * 공고 분석(AI)이 뽑아낸 자격 조건 중 숫자·지역처럼 기계적으로 판정할 수 있는
 * 것은 여기서 확정합니다. 판정할 수 없는 조건(other·industry 등)은
 * status "unknown" 으로 남겨 두고, api/prepare 에서 AI가 사유와 함께 판단합니다.
 *
 * status: "pass"(충족) | "fail"(미충족) | "unknown"(확인 필요)
 * ============================================================
 */

/* 소상공인기본법 기준: 상시근로자 5명 미만 (광업·제조업·건설업·운수업은 10명 미만) */
const TEN_PERSON_GROUPS = ["제조업", "건설업", "운수업", "광업"];

const SIDO_ALIASES = {
  서울: ["서울", "서울특별시", "서울시"],
  경기: ["경기", "경기도"],
  인천: ["인천", "인천광역시"],
  부산: ["부산", "부산광역시"],
  대구: ["대구", "대구광역시"],
  광주: ["광주", "광주광역시"],
  대전: ["대전", "대전광역시"],
  울산: ["울산", "울산광역시"],
  세종: ["세종", "세종특별자치시"],
  강원: ["강원", "강원도", "강원특별자치도"],
  충북: ["충북", "충청북도"],
  충남: ["충남", "충청남도"],
  전북: ["전북", "전라북도", "전북특별자치도"],
  전남: ["전남", "전라남도"],
  경북: ["경북", "경상북도"],
  경남: ["경남", "경상남도"],
  제주: ["제주", "제주도", "제주특별자치도"],
};

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s원명]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 개업일 기준 업력(년, 소수) — 개업일이 없거나 잘못되면 null */
function businessAgeYears(openDate, today) {
  if (!openDate) return null;
  const d = new Date(openDate);
  if (isNaN(d.getTime())) return null;
  const ms = (today || new Date()).getTime() - d.getTime();
  return ms / (365.2425 * 24 * 3600 * 1000);
}

function formatAge(years) {
  const totalMonths = Math.floor(years * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  return (y ? y + "년 " : "") + m + "개월";
}

function compare(a, op, b) {
  switch (op) {
    case "lt": return a < b;
    case "lte": return a <= b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "eq": return a === b;
    default: return null;
  }
}

const OP_TEXT = { lt: "미만", lte: "이하", gt: "초과", gte: "이상", eq: "" };

function normalizeRegion(s) {
  return String(s || "").replace(/\s+/g, "");
}

/** 조건 값이 어느 시·도로 시작하는지 — 가장 긴 별칭부터 비교 ("서울특별시" > "서울") */
function findSido(v) {
  let best = null;
  Object.keys(SIDO_ALIASES).forEach(function (key) {
    SIDO_ALIASES[key].forEach(function (alias) {
      if (v.startsWith(alias) && (!best || alias.length > best.alias.length)) best = { key: key, alias: alias };
    });
  });
  return best;
}

function sameArea(a, b) {
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

/** 사업장 지역이 조건 값(시·도 또는 "시·도 시·군·구" 또는 시·군·구) 에 해당하는지 */
function regionMatches(profile, value) {
  const v = normalizeRegion(value);
  if (!v) return false;
  const sigungu = normalizeRegion(profile.region_sigungu);
  const sido = findSido(v);
  if (sido) {
    if (sido.key !== profile.region_sido) return false;
    const rest = v.slice(sido.alias.length);
    return !rest || sameArea(rest, sigungu); // "서울" 또는 "서울마포구"
  }
  return sameArea(v, sigungu); // "마포구" 처럼 시·군·구만 적힌 조건
}

function result(rule, status, reason) {
  return { id: rule.id, text: rule.text, status: status, reason: reason, decided_by: "rule" };
}

function evaluateRule(rule, profile, today) {
  const op = rule.op;
  const n = toNumber(rule.number);

  switch (rule.rule_type) {
    case "business_age_years": {
      if (profile.is_pre_startup) {
        return result(rule, "unknown", "예비창업자라 업력 조건 적용 여부를 공고문에서 확인하세요.");
      }
      const age = businessAgeYears(profile.open_date, today);
      if (age === null) return result(rule, "unknown", "개업일을 입력하면 자동으로 판정합니다.");
      if (n === null || !OP_TEXT.hasOwnProperty(op)) return result(rule, "unknown", "조건 해석이 불명확합니다.");
      const ok = compare(age, op, n);
      return result(rule, ok ? "pass" : "fail",
        "업력 " + formatAge(age) + " (기준: " + n + "년 " + OP_TEXT[op] + ")");
    }

    case "employees": {
      const emp = toNumber(profile.employees);
      if (emp === null) return result(rule, "unknown", "상시근로자 수를 입력하면 자동으로 판정합니다.");
      if (n === null || !OP_TEXT.hasOwnProperty(op)) return result(rule, "unknown", "조건 해석이 불명확합니다.");
      return result(rule, compare(emp, op, n) ? "pass" : "fail",
        "상시근로자 " + emp + "명 (기준: " + n + "명 " + OP_TEXT[op] + ")");
    }

    case "annual_revenue_krw": {
      const rev = toNumber(profile.annual_revenue_krw);
      if (rev === null) return result(rule, "unknown", "연매출을 입력하면 자동으로 판정합니다.");
      if (n === null || !OP_TEXT.hasOwnProperty(op)) return result(rule, "unknown", "조건 해석이 불명확합니다.");
      return result(rule, compare(rev, op, n) ? "pass" : "fail",
        "연매출 " + rev.toLocaleString("ko-KR") + "원 (기준: " + n.toLocaleString("ko-KR") + "원 " + OP_TEXT[op] + ")");
    }

    case "region": {
      const values = (rule.values || []).filter(Boolean);
      if (!profile.region_sido && !profile.region_sigungu) {
        return result(rule, "unknown", "사업장 지역을 입력하면 자동으로 판정합니다.");
      }
      if (!values.length) return result(rule, "unknown", "지역 조건 해석이 불명확합니다.");
      const hit = values.some(function (v) { return regionMatches(profile, v); });
      const where = [profile.region_sido, profile.region_sigungu].filter(Boolean).join(" ");
      if (op === "not_in") {
        return result(rule, hit ? "fail" : "pass", "사업장 " + where + " (제외 지역: " + values.join(", ") + ")");
      }
      return result(rule, hit ? "pass" : "fail", "사업장 " + where + " (대상 지역: " + values.join(", ") + ")");
    }

    case "owner_age": {
      const birth = toNumber(profile.owner_birth_year);
      if (birth === null) return result(rule, "unknown", "대표자 출생연도를 입력하면 자동으로 판정합니다.");
      if (n === null || !OP_TEXT.hasOwnProperty(op)) return result(rule, "unknown", "조건 해석이 불명확합니다.");
      /* 생일을 모르므로 만 나이는 (올해-출생연도-1) ~ (올해-출생연도) 사이 */
      const year = (today || new Date()).getFullYear();
      const hi = year - birth;
      const lo = hi - 1;
      const okHi = compare(hi, op, n);
      const okLo = compare(lo, op, n);
      if (okHi && okLo) return result(rule, "pass", "만 " + lo + "~" + hi + "세 (기준: 만 " + n + "세 " + OP_TEXT[op] + ")");
      if (!okHi && !okLo) return result(rule, "fail", "만 " + lo + "~" + hi + "세 (기준: 만 " + n + "세 " + OP_TEXT[op] + ")");
      return result(rule, "unknown", "생일에 따라 달라집니다 — 공고 기준일의 만 나이를 확인하세요 (기준: 만 " + n + "세 " + OP_TEXT[op] + ")");
    }

    case "pre_startup_only":
      return result(rule, profile.is_pre_startup ? "pass" : "fail",
        profile.is_pre_startup ? "사업자등록 전(예비창업자)" : "이미 사업자등록을 한 경우 신청 불가 조건");

    case "registered_business_only":
      return result(rule, profile.is_pre_startup ? "fail" : "pass",
        profile.is_pre_startup ? "사업자등록이 필요합니다" : "사업자등록 보유");

    default:
      return { id: rule.id, text: rule.text, status: "unknown", reason: "", decided_by: "pending" };
  }
}

/** 소상공인 해당 여부(상시근로자 기준만 — 매출 기준은 업종별로 달라 확인서로 확인) */
function checkSmallBusiness(profile) {
  const emp = toNumber(profile.employees);
  if (profile.is_pre_startup) {
    return { status: "unknown", reason: "예비창업자 — 사업자등록 후 소상공인 확인서로 확인합니다." };
  }
  if (emp === null) return { status: "unknown", reason: "상시근로자 수를 입력하면 판정합니다." };
  const limit = TEN_PERSON_GROUPS.indexOf(profile.industry_group) >= 0 ? 10 : 5;
  const ok = emp < limit;
  return {
    status: ok ? "pass" : "fail",
    reason: "상시근로자 " + emp + "명 / " + (profile.industry_group || "해당 업종") + " 기준 " + limit + "명 미만" +
      (ok ? "" : " — 소상공인 전용 사업은 신청이 어려울 수 있습니다") +
      ". 매출 기준은 업종별로 달라 소상공인확인서(소상공인24)로 최종 확인하세요.",
  };
}

/** 모든 자격 조건 판정 — AI 판정이 필요한 항목은 decided_by: "pending" */
function evaluateEligibility(rules, profile, today) {
  return (rules || []).map(function (rule) {
    return evaluateRule(rule, profile || {}, today);
  });
}

/** AI 판정 결과를 pending 항목에만 합칩니다 (코드 판정은 AI가 덮어쓰지 못함) */
function mergeJudgements(results, judgements) {
  const byId = {};
  (judgements || []).forEach(function (j) { byId[j.id] = j; });
  return results.map(function (r) {
    if (r.decided_by !== "pending") return r;
    const j = byId[r.id];
    if (!j) return Object.assign({}, r, { decided_by: "ai", reason: "공고문 원문으로 확인하세요." });
    return Object.assign({}, r, { status: j.status, reason: j.reason, decided_by: "ai" });
  });
}

module.exports = {
  businessAgeYears: businessAgeYears,
  formatAge: formatAge,
  evaluateEligibility: evaluateEligibility,
  mergeJudgements: mergeJudgements,
  checkSmallBusiness: checkSmallBusiness,
  regionMatches: regionMatches,
};
