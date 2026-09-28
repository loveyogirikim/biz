/* 규칙 기반 모듈 테스트: 자격 판정, 사업비 검증, 분량 배분, 자동 점검, 분석 후처리, 일반현황, 공용 파서 */
const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("../public/shared.js");
const { evaluateEligibility, mergeJudgements, checkSmallBusiness, regionMatches } = require("../lib/eligibility");
const { validateBudget, renderBudgetMarkdown } = require("../lib/budget");
const { buildOutline, criteriaPoints } = require("../lib/strategy");
const { lintDraft } = require("../lib/lint");
const { normalizeAnalysis } = require("../lib/analysis");
const { renderGeneralInfo } = require("../lib/general-info");
const { styleFromRules } = require("../lib/docx-export");
const sample = require("../lib/fixtures/sample-analysis");

const clone = (o) => JSON.parse(JSON.stringify(o));
const TODAY = new Date("2026-09-28T09:00:00+09:00");

const profile = {
  business_name: "행복한 반찬가게", owner_name: "김사장", owner_birth_year: 1990, open_date: "2021-03-02",
  region_sido: "서울", region_sigungu: "한빛구", industry: "반찬 제조·판매", industry_group: "음식점업",
  employees: "2", annual_revenue_krw: "180000000",
};

test("자격: 숫자·지역 조건은 코드가 판정하고 other 는 pending", () => {
  const r = evaluateEligibility(sample.eligibility, profile, TODAY);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(by.E1.status, "pass");
  assert.equal(by.E2.status, "pass");
  assert.match(by.E2.reason, /5년 6개월/);
  assert.equal(by.E3.status, "pass");
  assert.equal(by.E4.status, "pass");
  assert.equal(by.E5.status, "pass");
  assert.equal(by.E6.decided_by, "pending");
});

test("자격: 미충족과 정보 부족을 구분", () => {
  const r = evaluateEligibility(sample.eligibility, { ...profile, employees: 7, open_date: "", region_sido: "경기", region_sigungu: "수원시" }, TODAY);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(by.E1.status, "fail");
  assert.equal(by.E2.status, "unknown");
  assert.equal(by.E3.status, "fail");
});

test("자격: 만 나이는 생일을 몰라 경계에서 unknown", () => {
  const rule = [{ id: "A", text: "만 39세 이하", rule_type: "owner_age", op: "lte", number: 39, values: [] }];
  assert.equal(evaluateEligibility(rule, { owner_birth_year: 1990 }, TODAY)[0].status, "pass"); // 35~36세
  assert.equal(evaluateEligibility(rule, { owner_birth_year: 1987 }, TODAY)[0].status, "pass"); // 38~39세
  assert.equal(evaluateEligibility(rule, { owner_birth_year: 1986 }, TODAY)[0].status, "unknown"); // 39~40세
  assert.equal(evaluateEligibility(rule, { owner_birth_year: 1980 }, TODAY)[0].status, "fail");
});

test("자격: AI 판정은 pending 항목에만 합쳐짐", () => {
  const r = evaluateEligibility(sample.eligibility, profile, TODAY);
  const merged = mergeJudgements(r, [
    { id: "E6", status: "pass", reason: "수혜 이력 없음" },
    { id: "E1", status: "fail", reason: "AI가 덮어쓰면 안 됨" },
  ]);
  const by = Object.fromEntries(merged.map((x) => [x.id, x]));
  assert.equal(by.E6.status, "pass");
  assert.equal(by.E6.decided_by, "ai");
  assert.equal(by.E1.status, "pass");
  assert.equal(by.E1.decided_by, "rule");
});

test("지역: 시·도 별칭과 시·군·구 조합", () => {
  const p = { region_sido: "서울", region_sigungu: "마포구" };
  assert.ok(regionMatches(p, "서울특별시"));
  assert.ok(regionMatches(p, "서울 마포구"));
  assert.ok(regionMatches(p, "마포구"));
  assert.ok(!regionMatches(p, "서울 강남구"));
  assert.ok(!regionMatches(p, "경기"));
  assert.ok(!regionMatches({ region_sido: "경기", region_sigungu: "수원시" }, "서울"));
});

test("소상공인 기준: 업종별 5인/10인", () => {
  assert.equal(checkSmallBusiness({ employees: 4, industry_group: "음식점업" }).status, "pass");
  assert.equal(checkSmallBusiness({ employees: 7, industry_group: "음식점업" }).status, "fail");
  assert.equal(checkSmallBusiness({ employees: 7, industry_group: "제조업" }).status, "pass");
  assert.equal(checkSmallBusiness({}).status, "unknown");
});

test("사업비: 한도 초과·자부담 부족·불가 비목을 잡아냄", () => {
  const bad = validateBudget({
    items: [
      { category: "외주용역비", item: "홈페이지", basis: "", gov_krw: 4500000, self_cash_krw: 100000, self_inkind_krw: 0 },
      { category: "인건비", item: "아르바이트 인건비", basis: "", gov_krw: 1000000, self_cash_krw: 0, self_inkind_krw: 0 },
    ],
  }, sample);
  const msgs = bad.issues.map((i) => i.message).join("\n");
  assert.match(msgs, /최대 지원금/);
  assert.match(msgs, /자부담 비율/);
  assert.match(msgs, /사용 불가 비목\('인건비'\)/);

  const ok = validateBudget({
    items: [{ category: "외주용역비", item: "홈페이지", basis: "", gov_krw: 5000000, self_cash_krw: 560000, self_inkind_krw: 0 }],
  }, sample);
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.totals.total, 5560000);
  const md = renderBudgetMarkdown(ok, sample, ["부가세 별도"]);
  assert.match(md, /총사업비 5,560,000원 = 정부지원금 5,000,000원 \+ 자부담 560,000원/);
  assert.match(md, /※ 부가세 별도/);
});

test("분량 배분: 배점이 큰 섹션일수록 목표 분량이 큼", () => {
  const outline = buildOutline(sample);
  const by = Object.fromEntries(outline.map((s) => [s.id, s]));
  assert.equal(by.S1.target_chars, 0); // 일반현황은 자동 입력
  assert.ok(by.S3.target_chars > by.S2.target_chars); // C1+C4 > C1 절반
  assert.ok(by.S2.target_chars <= 900); // 양식 1쪽 제한
  assert.equal(by.S1.order, 6); // 일반현황은 사업비 뒤에
  assert.ok(outline.every((s) => s.criteria.every((c) => c.name)));
});

test("분량 배분: 배점이 없으면 균등 배분", () => {
  const pts = criteriaPoints([{ id: "C1", points: null }, { id: "C2", points: 30 }]);
  assert.equal(pts.C1, 50);
  assert.equal(pts.C2, 50);
});

test("분석 후처리: 매핑 안 된 평가항목 연결, 잘못된 id 제거, 빈 양식 대체", () => {
  const a = clone(sample);
  a.template.sections.forEach((s) => { s.criteria_ids = s.criteria_ids.filter((c) => c !== "C3"); });
  a.template.sections[1].criteria_ids.push("C99");
  const notes = normalizeAnalysis(a);
  assert.ok(a.template.sections.some((s) => s.criteria_ids.includes("C3")));
  assert.ok(!a.template.sections[1].criteria_ids.includes("C99"));
  assert.ok(notes.some((n) => n.includes("실현 가능성")));

  const b = clone(sample);
  b.template.sections = [];
  b.evaluation.source = "추정";
  const notes2 = normalizeAnalysis(b);
  assert.ok(b.template.sections.length >= 5);
  assert.equal(b.template.source, "추정");
  assert.equal(notes2.length >= 2, true);
});

test("자동 점검: 빈 섹션·확인 필요·키워드 누락", () => {
  const outline = buildOutline(sample);
  const lint = lintDraft({
    outline,
    analysis: sample,
    sections: { S2: "□ 현황\n ○ 월매출 [확인 필요: 월매출]\n ○ 문제점 분석", S3: "짧은 글" },
  });
  const s2 = lint.sections.find((s) => s.id === "S2");
  assert.equal(s2.placeholders.length, 1);
  assert.deepEqual(s2.missing_keywords, ["필요성"]);
  assert.ok(lint.sections.find((s) => s.id === "S4").issues.some((i) => i.level === "error"));
  assert.equal(lint.placeholder_count, 1);
});

test("일반현황: 양식 필수 항목을 가게 정보로 채우고 모르는 칸은 [확인 필요]", () => {
  const md = renderGeneralInfo({
    section: sample.template.sections[0],
    profile,
    strategy: { concept_title: "온라인 주문 도입" },
    sections: { S5: "※ 총사업비 5,560,000원 = 정부지원금 5,000,000원 + 자부담 560,000원 (자부담 비율 10.1%)" },
    today: TODAY,
  });
  assert.match(md, /\| 상호 \| 행복한 반찬가게 \|/);
  assert.match(md, /업력 5년 6개월/);
  assert.match(md, /\| 사업자등록번호 \| \[확인 필요: 직접 기입\] \|/);
  assert.match(md, /\| 신청 금액 \| 총사업비 5,560,000원 \(지원금 5,000,000원 \/ 자부담 560,000원\) \|/);
  assert.match(md, /\| 전년도 매출액 \| 180,000,000원 \|/);
});

test("공용 파서: 개조식·표·굵게·확인 필요", () => {
  const blocks = shared.parseMarkdown("□ 현황\n ○ 항목\n  - 세부 **강조**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n### 소제목\n일반 문단");
  assert.deepEqual(blocks.map((b) => b.type), ["item", "item", "item", "table", "heading", "para"]);
  assert.equal(blocks[0].level, 0);
  assert.equal(blocks[1].level, 1);
  assert.equal(blocks[2].level, 2);
  assert.deepEqual(blocks[3].rows, [["a", "b"], ["1", "2"]]);
  const segs = shared.parseInline("값 **굵게** [확인 필요: 매출] 끝");
  assert.deepEqual(segs.map((s) => [s.text, !!s.bold, !!s.placeholder]), [
    ["값 ", false, false], ["굵게", true, false], [" ", false, false], ["[확인 필요: 매출]", false, true], [" 끝", false, false],
  ]);
  assert.match(shared.profileToText({ business_name: "가게" }), /- 상호\(가게 이름\): 가게\n- 대표자 이름: \(미입력\)/);
});

test("DOCX 글꼴: 공고 작성 유의사항에서 글꼴·크기 읽기", () => {
  assert.deepEqual(styleFromRules(["맑은 고딕 11pt", "개조식"]), { font: "맑은 고딕", sizePt: 11 });
  assert.deepEqual(styleFromRules(["휴먼명조 12 포인트"]), { font: "휴먼명조", sizePt: 12 });
  assert.deepEqual(styleFromRules([]), { font: "맑은 고딕", sizePt: 11 });
});
