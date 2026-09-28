/**
 * lib/llm-fake.js — 데모 모드(LLM_MODE=fake) 응답
 * ============================================================
 * API 키 없이 화면 흐름 전체를 시험하거나 시연할 때 씁니다.
 * 실제 AI 대신 입력값을 조합한 "예시 문장"을 돌려주며, 결과물에는
 * 데모 모드라는 표시가 붙습니다. (실제 제출용 문서로 쓰면 안 됩니다)
 * ============================================================
 */
const sampleAnalysis = require("./fixtures/sample-analysis");

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function val(profile, key, fallback) {
  const v = profile && profile[key];
  return v !== undefined && v !== null && String(v).trim() ? String(v).trim() : fallback;
}

function prepare(d) {
  const profile = d.profile || {};
  const questions = [];
  if (!val(profile, "customers")) {
    questions.push({ id: "Q1", question: "하루 평균 손님은 몇 명이고, 주로 어떤 분들이 오시나요?", why: "사업 필요성(현황 분석) 점수에 필요합니다.", criteria_ids: ["C1"], example: "평일 50명, 주말 80명. 인근 아파트 30~40대 주부가 70%", priority: "high" });
  }
  if (!val(profile, "goals")) {
    questions.push({ id: "Q2", question: "지원을 받으면 1년 안에 매출이 얼마나 늘 것으로 보시나요?", why: "기대 효과(정량 목표) 항목 배점이 25점입니다.", criteria_ids: ["C4"], example: "월매출 1,500만원 → 1,900만원", priority: "high" });
  }
  questions.push({ id: "Q3", question: "자부담 금액은 어떻게 마련하실 계획인가요?", why: "실현 가능성(자부담 능력) 평가에 들어갑니다.", criteria_ids: ["C3"], example: "운영자금 통장에서 현금으로 부담", priority: "medium" });
  questions.push({ id: "Q4", question: "사업이 끝난 뒤에도 온라인 채널을 누가, 어떻게 운영하실 건가요?", why: "기대 효과의 지속 가능성 평가에 필요합니다.", criteria_ids: ["C4"], example: "대표가 주 3회 게시물 업로드, 월 1회 리뷰 이벤트", priority: "medium" });

  return {
    eligibility_judgements: (d.pending || []).map(function (r) {
      return { id: r.id, status: "unknown", reason: "데모 모드 — 최근 3년 내 유사 사업 수혜 이력을 직접 확인하세요." };
    }),
    bonus_opportunities: [
      { name: "착한가격업소 지정", status: /착한가격/.test(val(profile, "achievements", "")) ? "해당" : "확인 필요", action: "지정서 사본을 가점 증빙으로 제출" },
      { name: "노란우산공제 가입", status: /노란우산/.test(val(profile, "achievements", "")) ? "해당" : "가능성 있음", action: "가입증명서 제출 (미가입 시 신청 전 가입 검토)" },
    ],
    questions: questions,
    strategy: {
      concept_title: val(profile, "business_name", "우리 가게") + " 온라인 주문 도입을 통한 매출 다변화",
      one_liner: "오프라인 단골 기반을 온라인 주문으로 넓혀 매출 구조를 안정화하는 계획",
      key_messages: ["현황 수치로 증명한 명확한 문제", "지원금 사용처와 성과 목표의 1:1 대응", "사업 종료 후에도 대표가 직접 운영 가능한 구조"],
      differentiators: [val(profile, "strengths", "[확인 필요: 가게의 강점]")],
      weak_points: ["온라인 운영 경험이 적다는 점 — 교육 이수·운영 계획으로 보완"],
      numbers_to_prepare: ["최근 1년 월별 매출", "홈페이지·촬영 견적서 2곳 이상"],
    },
  };
}

function budget(d) {
  const a = d.analysis || sampleAnalysis;
  const max = (a.program && a.program.max_support_krw) || 5000000;
  const ratio = (a.program && a.program.self_pay_ratio_pct) || 10;
  const gov = Math.floor(max / 100000) * 100000;
  const total = Math.ceil(gov / (1 - ratio / 100) / 10000) * 10000;
  const self = total - gov;
  const split = [0.5, 0.3, 0.2];
  const names = [
    ["외주용역비", "자사 주문 홈페이지 구축", "홈페이지 제작 1식"],
    ["홍보·마케팅비", "상품 상세페이지 촬영·제작", "상세페이지 10건"],
    ["홍보·마케팅비", "온라인 광고", "검색광고 3개월"],
  ];
  let govLeft = gov;
  let selfLeft = self;
  const items = names.map(function (n, i) {
    const g = i === 2 ? govLeft : Math.round((gov * split[i]) / 10000) * 10000;
    const s = i === 2 ? selfLeft : Math.round((self * split[i]) / 1000) * 1000;
    govLeft -= g;
    selfLeft -= s;
    const t = g + s;
    const unit = i === 1 ? t / 10 : i === 2 ? t / 3 : t;
    const qty = i === 1 ? "10건" : i === 2 ? "3개월" : "1식";
    return { category: n[0], item: n[1], basis: Math.round(unit).toLocaleString("ko-KR") + "원 × " + qty + " (견적 확인 필요)", gov_krw: g, self_cash_krw: s, self_inkind_krw: 0 };
  });
  return { items: items, notes: ["데모 모드 예시 금액입니다. 실제 견적으로 바꾸세요.", "부가가치세 별도(업체 부담)"] };
}

function review(d) {
  const a = d.analysis || sampleAnalysis;
  const lint = d.lint || { sections: [] };
  const criteria = (a.evaluation && a.evaluation.criteria) || [];
  const empty = lint.sections.filter(function (s) { return !s.chars; }).length;
  const ph = lint.placeholder_count || 0;
  const factor = Math.max(0.45, 0.82 - empty * 0.08 - Math.min(ph, 10) * 0.012);
  return {
    overall_comment: "데모 모드 채점입니다. 문제와 지원 계획의 연결은 좋지만, [확인 필요]로 남은 수치를 채우면 점수가 크게 오릅니다.",
    pass_likelihood: factor > 0.75 ? "높음" : factor > 0.6 ? "보통" : "낮음",
    criteria: criteria.map(function (c, i) {
      const max = c.points || 25;
      const sections = ((a.template && a.template.sections) || []).filter(function (s) { return (s.criteria_ids || []).indexOf(c.id) >= 0; });
      return {
        criterion_id: c.id,
        score: Math.round(max * (factor - (i % 2) * 0.05) * 10) / 10,
        max_score: max,
        strengths: ["평가 항목 순서에 맞춰 개조식으로 정리됨"],
        weaknesses: ph ? ["확인되지 않은 수치가 남아 있어 근거가 약함"] : ["목표 산정 근거가 한 줄로만 제시됨"],
        improvements: ["현재 수치 → 목표 수치를 표로 정리하고 산정 근거(월 방문객 × 전환율 등)를 추가"],
        section_ids: sections.map(function (s) { return s.id; }),
      };
    }),
    top_fixes: criteria.slice(0, 2).map(function (c) {
      const s = ((a.template && a.template.sections) || []).find(function (x) { return (x.criteria_ids || []).indexOf(c.id) >= 0 && x.kind !== "budget"; });
      return { section_id: s ? s.id : "", priority: "high", instruction: "'" + c.name + "' 심사 포인트(" + (c.look_for || []).join(", ") + ")별로 소제목을 나누고, 각 포인트에 현재 수치와 목표 수치를 표로 제시하세요." };
    }),
    red_flags: ph ? ["[확인 필요] " + ph + "곳이 남아 있음 — 제출 전 반드시 사실대로 채워야 함"] : [],
  };
}

function sectionText(d) {
  const sec = d.section || { title: "섹션", criteria: [] };
  const p = d.profile || {};
  const name = val(p, "business_name", "[확인 필요: 상호]");
  const crit = (sec.criteria || []).map(function (c) { return c.name; }).join("·") || "양식 요건";

  if (d.mode === "revise") {
    return "□ (보완) " + crit + " 중심으로 다시 정리\n" + (d.current || "") +
      "\n\n□ 보완 사항 반영\n ○ " + (d.instruction || "심사 지적사항 반영") + "\n  - 현재 → 목표를 표로 정리함\n\n| 구분 | 현재 | 목표(사업 종료 후 6개월) |\n|---|---|---|\n| 월매출 | [확인 필요: 현재 월매출] | [확인 필요: 목표 월매출] |\n| 온라인 주문 비중 | 0% | 15% |";
  }

  if (sec.kind === "schedule") {
    return "| 추진 내용 | 세부 내용 | 기간 |\n|---|---|---|\n| 협약 및 업체 선정 | 견적 비교 후 외주업체 계약 | 11월 1주 |\n| 홈페이지 구축 | 기획·디자인·개발·테스트 | 11월 1~3주 |\n| 상세페이지 촬영 | 대표 상품 10종 촬영·제작 | 11월 2주 |\n| 온라인 광고 | 검색광고 집행 및 성과 점검 | 11월 3주~ |\n| 정산 | 증빙 제출 및 결과 보고 | 11월 4주 |";
  }

  return [
    "□ " + crit + "에 대한 " + name + "의 현황",
    " ○ " + name + "은(는) " + val(p, "industry", "[확인 필요: 업종]") + " 업체로 " + val(p, "region_sigungu", "[확인 필요: 소재지]") + "에서 영업 중임",
    "  - 주요 상품: " + val(p, "products", "[확인 필요: 주요 상품과 가격대]"),
    "  - 주요 고객: " + val(p, "customers", "[확인 필요: 주 고객층과 하루 방문객 수]"),
    " ○ 현재 어려움: " + val(p, "problems", "[확인 필요: 현재 겪는 어려움]"),
    "",
    "□ 해결 방안 및 계획",
    " ○ " + val(p, "plan", "[확인 필요: 지원금 활용 계획]"),
    "  - 실행 방법: 견적 비교 후 전문 업체와 계약, 대표가 직접 운영 교육 이수",
    "  - 강점 활용: " + val(p, "strengths", "[확인 필요: 차별점]"),
    "",
    "| 구분 | 현재 | 목표 |",
    "|---|---|---|",
    "| 월매출 | [확인 필요: 현재 월매출] | [확인 필요: 목표 월매출] |",
    "| 온라인 주문 | 없음 | 월 100건 |",
    "",
    "※ 데모 모드로 만든 예시 문장입니다. 실제 모드에서는 공고 평가기준에 맞춰 AI가 작성합니다.",
  ].join("\n");
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function generateJSON(o) {
  const d = o.fakeData || {};
  await sleep(300);
  switch (o.task) {
    case "analyze": return clone(sampleAnalysis);
    case "prepare": return prepare(d);
    case "budget": return budget(d);
    case "review": return review(d);
    default: throw new Error("fake: unknown task " + o.task);
  }
}

async function streamText(o, onEvent) {
  const text = sectionText(o.fakeData || {});
  onEvent({ t: "thinking" });
  await sleep(200);
  for (let i = 0; i < text.length; i += 24) {
    onEvent({ t: "delta", v: text.slice(i, i + 24) });
    await sleep(12);
  }
  return { text: text, truncated: false };
}

module.exports = { generateJSON: generateJSON, streamText: streamText };
