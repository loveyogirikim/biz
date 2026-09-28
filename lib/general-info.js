/**
 * lib/general-info.js — "일반현황" 표를 가게 정보로 채우기 (AI 사용 안 함)
 * ============================================================
 * 일반현황은 사실 정보만 들어가는 칸이라 AI가 쓸 이유가 없습니다.
 * 양식의 필수 항목 이름을 보고 가게 정보 값을 찾아 넣고,
 * 모르는 칸은 [확인 필요]로 남깁니다.
 * ============================================================
 */
const shared = require("../public/shared.js");
const { businessAgeYears, formatAge } = require("./eligibility");

const DEFAULT_ITEMS = ["상호", "대표자", "개업일", "사업장 소재지", "업종", "상시근로자 수", "전년도 매출액", "주요 상품·서비스", "사업명(과제명)", "신청 금액"];

function has(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

/** 사업비 섹션 본문의 "※ 총사업비 X원 = 정부지원금 Y원 + 자부담 Z원" 줄에서 금액 추출 */
function budgetLine(sections) {
  const all = Object.keys(sections || {}).map(function (k) { return sections[k] || ""; }).join("\n");
  const m = all.match(/총사업비\s*([\d,]+)원\s*=\s*정부지원금\s*([\d,]+)원\s*\+\s*자부담\s*([\d,]+)원/);
  return m ? "총사업비 " + m[1] + "원 (지원금 " + m[2] + "원 / 자부담 " + m[3] + "원)" : null;
}

function valueFor(label, ctx) {
  const p = ctx.profile || {};
  const need = function (what) { return "[확인 필요: " + what + "]"; };

  if (/상호|기업명|업체명|회사명/.test(label)) return has(p.business_name) ? p.business_name : need("상호");
  if (/대표자/.test(label)) return has(p.owner_name) ? p.owner_name : need("대표자 이름");
  if (/개업|설립|창업일|등록일/.test(label)) {
    if (p.is_pre_startup) return "예비창업자(사업자등록 전)";
    if (!has(p.open_date)) return need("개업일");
    const age = businessAgeYears(p.open_date, ctx.today);
    return p.open_date + (age !== null && age >= 0 ? " (업력 " + formatAge(age) + ")" : "");
  }
  if (/소재지|주소|지역/.test(label)) {
    const r = [p.region_sido, p.region_sigungu].filter(has).join(" ");
    return r ? r + " [확인 필요: 상세 주소]" : need("사업장 주소");
  }
  if (/업종|업태/.test(label)) return has(p.industry) ? p.industry : need("업종");
  if (/근로자|종업원|고용|직원/.test(label)) return has(p.employees) ? p.employees + "명" : need("상시근로자 수");
  if (/매출/.test(label)) return has(p.annual_revenue_krw) ? shared.formatWon(Number(p.annual_revenue_krw)) : need("전년도 매출액(부가세 과세표준증명원 기준)");
  if (/(제품|상품|서비스|아이템)/.test(label)) return has(p.products) ? String(p.products).split("\n")[0] : need("주요 상품·서비스");
  if (/사업명|과제명/.test(label)) return (ctx.strategy && ctx.strategy.concept_title) || need("사업명");
  if (/신청\s?금액|사업비|지원\s?금액/.test(label)) return budgetLine(ctx.sections) || need("사업비 집행계획 작성 후 자동 입력");
  if (/신청\s?분야|지원\s?분야/.test(label)) return need("신청 분야 선택");
  return need("직접 기입");
}

/** @returns {string} 마크다운 표 */
function renderGeneralInfo(ctx) {
  const sec = ctx.section || {};
  const items = (sec.required_items && sec.required_items.length) ? sec.required_items : DEFAULT_ITEMS;
  const rows = items.map(function (label) {
    return "| " + String(label).replace(/\|/g, "/") + " | " + String(valueFor(label, ctx)).replace(/\|/g, "/").replace(/\n/g, " ") + " |";
  });
  return ["| 구분 | 내용 |", "|---|---|"].concat(rows).join("\n");
}

module.exports = { renderGeneralInfo: renderGeneralInfo };
