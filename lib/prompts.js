/**
 * lib/prompts.js — AI 지시문 모음
 * ============================================================
 * 구조
 *   SYSTEM            : 모든 호출에 공통인 역할·원칙 (고정 → 프롬프트 캐시 대상)
 *   renderContext()   : 공고 분석 + 가게 정보 + 답변 + 전략 (섹션 작성 동안 고정 → 캐시)
 *   *Task()           : 호출마다 달라지는 작업 지시 (캐시 뒤에 붙음)
 * ============================================================
 */
const shared = require("../public/shared.js");
const { presetsToText } = require("./presets");

const SYSTEM = [
  "당신은 '소상공인 사업계획서 도우미'입니다. 정부·지자체·공공기관의 소상공인·창업 지원사업 사업계획서를 수백 건 컨설팅했고, 서류·발표 심사위원으로도 활동한 전문가로서 일합니다. 사용자는 문서 작업이 익숙하지 않은 소상공인 사장님입니다.",
  "",
  "## 반드시 지킬 원칙",
  "1. 사실만 씁니다. 사장님이 알려준 정보와 공고문에 있는 내용만 사실로 사용합니다. 매출·고객 수·계약·인증·특허·수상·언론 보도·시장 통계처럼 주어지지 않은 사실과 수치는 절대 만들어내지 않습니다. 필요하지만 모르는 내용은 `[확인 필요: 무엇을 어떻게 채울지]` 형식으로 남깁니다. 허위 기재는 선정 취소와 지원금 환수 사유이기 때문입니다.",
  "2. 평가기준에 답합니다. 심사위원은 평가표를 옆에 두고 항목별로 점수를 매깁니다. 각 내용이 어느 평가항목의 어떤 심사 포인트에 답하는지 분명해야 하고, 배점이 높은 항목일수록 근거를 더 충실히 씁니다.",
  "3. 양식을 지킵니다. 공고의 사업계획서 양식 목차·작성요령·분량 제한을 그대로 따르고, 양식에 없는 항목을 임의로 만들지 않습니다.",
  "4. 구체적으로 씁니다. '최선을 다하겠음' 같은 다짐 대신 무엇을·언제·얼마로·어떻게 할지와 측정 가능한 목표(수치·기한)를 씁니다. 목표 수치는 사장님이 준 현재 수치에 근거한 현실적인 범위로 잡고 근거를 함께 적습니다.",
  "5. 공문서 문체로 씁니다. 개조식(□ 소제목, ○ 항목, - 세부, · 보충) 위주, '~함·~임·~예정' 종결, 한 줄에 한 메시지. 비교·수치·일정은 마크다운 표를 활용합니다. 양식이 서술형을 요구하면 그에 따릅니다.",
  "6. 신청 자격·지원 제외 조건과 모순되는 내용, 사용 불가 비목에 지원금을 쓰는 계획은 쓰지 않습니다.",
].join("\n");

/* ── 공고 분석 ──────────────────────────────────────────── */

function analyzeTask(meta) {
  meta = meta || {};
  const metaLines = [];
  if (meta.title) metaLines.push("- 공고명(목록 기준): " + meta.title);
  if (meta.agency) metaLines.push("- 공고기관: " + meta.agency);
  if (meta.url) metaLines.push("- 공고 URL: " + meta.url);
  if (meta.period) metaLines.push("- 접수기간: " + meta.period);

  return [
    "위 문서는 지원사업 공고문과 첨부 자료(사업계획서 양식, 평가표 등)입니다. 사업계획서 자동 작성에 필요한 정보를 지정된 JSON 구조로 정리하세요.",
    metaLines.length ? "\n[공고 목록 정보]\n" + metaLines.join("\n") : "",
    "",
    "## 정리 규칙",
    "- 문서에 있는 내용은 원문 표현을 살려 정확히 옮깁니다. 특히 평가항목명·배점·양식 목차 제목은 원문 그대로 씁니다.",
    "- program.max_support_krw: 업체당 최대 지원금(원 단위 정수, 500만원 → 5000000). 없으면 null.",
    "- program.self_pay_ratio_pct: 총사업비 대비 자부담 비율(%). '지원금의 10%'처럼 기준이 다르면 총사업비 기준으로 환산하고(지원금의 10% → 총사업비의 약 9.1%) self_pay_note에 원문 기준과 현금·현물 구분을 적습니다. 없으면 null.",
    "- eligibility: 신청 자격을 조건 하나씩 나눕니다. 기계적으로 판정할 수 있는 조건은 rule_type·op·number·values를 채웁니다.",
    "  · '창업 3년 이내' → business_age_years, lte, 3 / '사업자등록 후 6개월 이상' → business_age_years, gte, 0.5",
    "  · '상시근로자 5인 미만' → employees, lt, 5",
    "  · '연매출 3억원 이하' → annual_revenue_krw, lte, 300000000",
    "  · '서울시 소재 사업장' → region, in, [\"서울\"] (시·도는 '서울'·'경기'처럼 짧게, 시·군·구는 '서울 마포구'처럼 시·도를 붙여서)",
    "  · '만 39세 이하' → owner_age, lte, 39",
    "  · 예비창업자만 신청 가능 → pre_startup_only / 사업자등록 필수 → registered_business_only",
    "  · 업종 제한 → industry, in 또는 not_in, 업종명 목록",
    "  · 그 밖의 조건 → other, none, number null, values []",
    "  source_quote에는 근거가 된 원문 문장을 짧게 인용합니다.",
    "- exclusions: 지원 제외 대상(휴·폐업, 세금 체납, 제외 업종, 중복 수혜 제한 등)을 빠짐없이.",
    "- evaluation.criteria: 평가표의 대항목 단위. points는 숫자만. sub_items는 세부 평가항목과 배점. look_for에는 심사위원이 그 항목에서 확인할 구체적인 포인트를, keywords에는 그 항목 채점에 쓰이는 핵심 용어(2~6개)를 적습니다.",
    "  평가표가 문서에 없으면 아래 [참고 양식]에서 사업 유형에 맞는 기준을 골라 추정하고 evaluation.source를 \"추정\"으로 합니다(추정 배점도 합계 100).",
    "- evaluation.bonus: 가점 항목·조건·점수. evaluation.cutoff: 과락·선정 기준(없으면 빈 문자열).",
    "- template.sections: 사업계획서 양식의 목차를 순서대로. title은 원문 그대로(번호 포함). guide에는 양식의 작성요령(※ 안내, 예시 문구)을 요약. required_items에는 양식 표에서 반드시 채워야 하는 칸/항목.",
    "  kind: general_info(일반현황·기업정보 표) / summary(요약·개요) / narrative(서술형 본문) / budget(사업비·자금 집행계획) / schedule(추진 일정) / team(대표자·인력 역량).",
    "  criteria_ids: 그 섹션이 답하는 평가항목 id. 모든 평가항목은 최소 한 섹션에 매핑되어야 합니다.",
    "  양식이 문서에 없으면 [참고 양식]에서 가장 맞는 구조를 골라 template.source를 \"추정\", preset_used에 그 이름을 적습니다. 양식이 있으면 preset_used는 빈 문자열.",
    "- template.page_limit: 전체 분량 제한(쪽). template.format_rules: 분량·글꼴·작성 방식·금지 사항(기업명·개인정보 노출 금지 등) 같은 작성 유의사항.",
    "- budget_rules: 사용 가능/불가 비목과 사업비 관련 규정.",
    "- required_documents: 제출 서류 목록. cautions: 신청 시 주의사항.",
    "- missing_info: 문서에서 찾지 못해 추정했거나 사장님이 공고 원문으로 꼭 확인해야 할 사항.",
    "- id 형식: 자격 E1…, 제외 X1…, 평가 C1…, 섹션 S1…",
    "",
    "[참고 양식] (공고에 양식·평가표가 없을 때만 사용)",
    presetsToText(),
  ].join("\n");
}

/* ── 공통 맥락(캐시 대상) ───────────────────────────────── */

function list(items, prefix) {
  return (items || []).filter(Boolean).map(function (s) { return (prefix || "- ") + s; }).join("\n");
}

function renderAnalysis(a) {
  const p = a.program || {};
  const ev = a.evaluation || {};
  const t = a.template || {};
  const br = a.budget_rules || {};
  const out = [];

  out.push("[공고 개요]");
  out.push("- 사업명: " + p.name + (p.agency ? " (" + p.agency + ")" : ""));
  if (p.purpose) out.push("- 사업 목적: " + p.purpose);
  if (p.support_content) out.push("- 지원 내용: " + p.support_content);
  out.push("- 업체당 최대 지원금: " + (p.max_support_krw ? shared.formatWon(p.max_support_krw) : "공고에 명시 없음"));
  out.push("- 자부담: " + (p.self_pay_ratio_pct ? "총사업비의 " + p.self_pay_ratio_pct + "% 이상" : "명시 없음") + (p.self_pay_note ? " — " + p.self_pay_note : ""));
  if (p.deadline) out.push("- 마감: " + p.deadline);

  out.push("\n[평가 기준] (출처: " + (ev.source || "공고문") + ")");
  (ev.criteria || []).forEach(function (c) {
    out.push(c.id + ". " + c.name + (c.points != null ? " (" + c.points + "점)" : "") + (c.description ? " — " + c.description : ""));
    (c.sub_items || []).forEach(function (s) { out.push("   · 세부: " + s.name + (s.points != null ? " (" + s.points + "점)" : "")); });
    if ((c.look_for || []).length) out.push("   · 심사 포인트: " + c.look_for.join(" / "));
    if ((c.keywords || []).length) out.push("   · 키워드: " + c.keywords.join(", "));
  });
  if ((ev.bonus || []).length) {
    out.push("가점: " + ev.bonus.map(function (b) { return b.name + (b.points != null ? "(" + b.points + "점)" : "") + (b.condition ? " — " + b.condition : ""); }).join(" / "));
  }
  if (ev.cutoff) out.push("선정 기준: " + ev.cutoff);

  out.push("\n[사업계획서 양식] (출처: " + (t.source || "공고문") + (t.preset_used ? ", " + t.preset_used : "") + ")");
  if (t.page_limit) out.push("전체 분량 제한: " + t.page_limit + "쪽");
  (t.sections || []).forEach(function (s) {
    out.push(s.id + ". " + s.title + " [" + s.kind + "]" + (s.criteria_ids && s.criteria_ids.length ? " ← 평가 " + s.criteria_ids.join(",") : ""));
    if (s.guide) out.push("   · 작성요령: " + s.guide);
    if ((s.required_items || []).length) out.push("   · 필수 항목: " + s.required_items.join(", "));
    if (s.max_pages) out.push("   · 분량: " + s.max_pages + "쪽 이내");
  });
  if ((t.format_rules || []).length) out.push("작성 유의사항:\n" + list(t.format_rules));

  if ((br.allowed_items || []).length || (br.disallowed_items || []).length || (br.notes || []).length) {
    out.push("\n[사업비 규정]");
    if ((br.allowed_items || []).length) out.push("- 사용 가능: " + br.allowed_items.join(", "));
    if ((br.disallowed_items || []).length) out.push("- 사용 불가: " + br.disallowed_items.join(", "));
    if ((br.notes || []).length) out.push(list(br.notes));
  }
  if ((a.cautions || []).length) out.push("\n[신청 유의사항]\n" + list(a.cautions));
  return out.join("\n");
}

/**
 * @param {object} c { analysis, profile, answers?, questions?, strategy? }
 */
function renderContext(c) {
  const out = [renderAnalysis(c.analysis || {})];
  out.push("\n[사장님 가게 정보]\n" + shared.profileToText(c.profile));

  const answered = (c.questions || []).filter(function (q) {
    return c.answers && c.answers[q.id] && String(c.answers[q.id]).trim();
  });
  if (answered.length) {
    out.push("\n[추가 질문에 대한 사장님 답변]");
    answered.forEach(function (q) { out.push("Q. " + q.question + "\nA. " + String(c.answers[q.id]).trim()); });
  }

  const s = c.strategy;
  if (s && (s.concept_title || s.one_liner)) {
    out.push("\n[작성 전략]");
    if (s.concept_title) out.push("- 사업명(과제명): " + s.concept_title);
    if (s.one_liner) out.push("- 한 줄 요약: " + s.one_liner);
    if ((s.key_messages || []).length) out.push("- 핵심 메시지:\n" + list(s.key_messages, "  · "));
    if ((s.differentiators || []).length) out.push("- 차별점:\n" + list(s.differentiators, "  · "));
    if ((s.weak_points || []).length) out.push("- 보완할 약점:\n" + list(s.weak_points, "  · "));
  }
  return out.join("\n");
}

/* ── 작성 준비(자격·가점·질문·전략) ─────────────────────── */

function prepareTask(pending) {
  return [
    "위 공고와 가게 정보를 보고 사업계획서 작성을 준비하세요.",
    "",
    "1. eligibility_judgements: 아래 [자동 판정이 안 된 자격 조건] 각각에 대해 가게 정보로 판단합니다. 근거가 부족하면 unknown으로 하고 reason에 사장님이 무엇을 확인해야 하는지 씁니다.",
    pending.length ? pending.map(function (r) { return "   - " + r.id + ": " + r.text; }).join("\n") : "   (없음 — 빈 배열로 두세요)",
    "2. bonus_opportunities: 가점 항목마다 해당 여부와, 받기 위해 할 일(필요 서류·가입 등). 가점이 없으면 빈 배열.",
    "3. questions: 평가기준에 비해 가게 정보가 부족해 점수가 깎일 부분을 사장님께 묻습니다. 최대 8개, 배점이 큰 항목 먼저.",
    "   - 사장님이 바로 답할 수 있는 쉬운 말로, 한 질문에 하나만 묻습니다. 이미 가게 정보에 있는 내용은 묻지 않습니다.",
    "   - why: 어느 평가항목 때문에 필요한지 한 문장. example: 답변 예시. id: Q1, Q2 …",
    "4. strategy:",
    "   - concept_title: 사업계획서에 쓸 사업명(과제명). 지원사업 목적과 가게의 핵심 변화가 드러나게 30자 이내.",
    "   - one_liner: 이 계획을 한 문장으로.",
    "   - key_messages: 심사위원에게 각인시킬 핵심 메시지 3~5개(평가항목과 연결).",
    "   - differentiators: 가게의 차별점(가게 정보에 근거한 것만).",
    "   - weak_points: 심사에서 약점이 될 부분과 보완 방향.",
    "   - numbers_to_prepare: 설득력을 높이려면 사장님이 준비할 수치·자료(견적서, 매출 증빙 등).",
  ].join("\n");
}

/* ── 섹션 작성 ─────────────────────────────────────────── */

function describeSection(sec) {
  const lines = [
    "제목: " + sec.title,
    "유형: " + sec.kind,
  ];
  if (sec.guide) lines.push("양식 작성요령: " + sec.guide);
  if ((sec.required_items || []).length) lines.push("반드시 포함할 항목: " + sec.required_items.join(", "));
  if ((sec.criteria || []).length) {
    lines.push("이 섹션이 답해야 할 평가항목: " + sec.criteria.map(function (c) {
      return c.id + " " + c.name + (c.points != null ? "(" + c.points + "점)" : "");
    }).join(", "));
  } else {
    lines.push("연결된 평가항목: 없음 — 양식 요건을 충실히 채우는 데 집중");
  }
  if (sec.target_chars) lines.push("목표 분량: 약 " + sec.target_chars + "자(공백 포함, ±20%)" + (sec.max_pages ? ", 최대 " + sec.max_pages + "쪽" : ""));
  return lines.join("\n");
}

function othersDigest(others, full) {
  const parts = (others || []).filter(function (o) { return o.content && o.content.trim(); }).map(function (o) {
    const body = full || o.kind === "budget" ? o.content : o.content.slice(0, 700) + (o.content.length > 700 ? " …(생략)" : "");
    return "### " + o.title + "\n" + body;
  });
  return parts.length ? parts.join("\n\n") : "(아직 작성된 섹션 없음)";
}

/**
 * @param {object} p { section, others: [{title, kind, content}], mode: "write"|"revise", instruction, current }
 */
function sectionTask(p) {
  const sec = p.section;
  const isSummary = sec.kind === "summary";
  const out = [
    "[작성할 섹션]",
    describeSection(sec),
    "",
    "[다른 섹션 내용] — 수치·금액·일정·용어가 서로 맞아야 합니다" + (isSummary ? " (요약 섹션이므로 전체를 반영)" : ""),
    othersDigest(p.others, isSummary),
    "",
  ];

  if (p.mode === "revise") {
    out.push("[현재 초안]", p.current || "(비어 있음)", "");
    out.push("[보완 지시]", p.instruction || "심사위원 관점에서 약한 부분을 보완하세요.", "");
    out.push("현재 초안을 보완 지시에 맞게 다시 쓰세요. 초안에 있던 사실(수치·경력·계획)은 유지하고, 새 사실을 지어내지 마세요. 필요한 정보가 없으면 [확인 필요: …]로 남깁니다.");
  } else {
    out.push("이 섹션의 본문을 쓰세요.");
  }

  out.push(
    "",
    "## 작성 방법",
    "- 섹션 제목은 쓰지 말고 본문만 씁니다(제목은 양식에 이미 있음). 하위 구분은 '□ 소제목' 줄로 합니다.",
    "- 연결된 평가항목의 심사 포인트를 하나도 빠뜨리지 말고 답하고, 소제목과 문장에 평가 키워드를 자연스럽게 넣어 심사위원이 채점 근거를 바로 찾게 합니다.",
    "- 현황 → 문제 → 해결 방법 → 기대 성과가 끊기지 않게 연결하고, 지원금 사용처와 성과 목표가 서로 대응되게 합니다.",
    "- 수치 목표는 '현재 → 목표(기한)' 형식으로, 근거와 함께. 비교·일정·목표는 표로 정리하면 좋습니다.",
    "- 모르는 사실은 지어내지 말고 [확인 필요: 무엇을 채울지]로 남깁니다. 시장 통계가 필요하면 출처를 쓸 자리를 [확인 필요: 통계 출처(예: 통계청 ○○조사)]로 둡니다.",
    sec.kind === "schedule" ? "- 추진 일정은 | 추진 내용 | 세부 내용 | 기간 | 표로 작성하고, 사업 기간 안에서 월 단위로 씁니다. 사업비 항목과 일정이 대응되게 합니다." : null,
    sec.kind === "team" ? "- 대표자·인력 역량은 이 사업 수행과 직접 관련된 경험·자격 위주로, 가게 정보에 있는 것만 씁니다. 채용 계획이 있으면 직무·시기·인원을 표로 씁니다." : null,
    isSummary ? "- 요약은 다른 섹션의 핵심(문제·해결·사업비·목표)을 한눈에 보이게 압축하고, 새 내용을 추가하지 않습니다." : null,
    "- 출력은 본문 마크다운만 씁니다. 인사말·설명·코드블록은 쓰지 않습니다."
  );
  return out.filter(function (l) { return l !== null; }).join("\n");
}

/* ── 사업비 ────────────────────────────────────────────── */

function budgetTask(p) {
  const sec = p.section;
  return [
    "[작성할 섹션]",
    describeSection(sec),
    "",
    "[다른 섹션 내용]",
    othersDigest(p.others, false),
    "",
    p.mode === "revise" && p.instruction ? "[보완 지시]\n" + p.instruction + "\n" : "",
    "이 사업의 사업비 집행계획 항목을 JSON으로 만드세요.",
    "- 정부지원금 합계는 업체당 최대 지원금을 넘지 않게 하고, 계획 실행에 필요한 만큼 편성합니다.",
    "- 자부담은 공고 기준 비율 이상이 되게 self_cash_krw(현금)·self_inkind_krw(현물)에 나눠 넣습니다. 현물 인정 여부가 불명확하면 현금으로 잡습니다. 자부담 규정이 없으면 0으로 둡니다.",
    "- 사용 가능한 비목만 쓰고, 사용 불가 비목(예: 인건비·임차료가 불가인 경우)은 넣지 않습니다.",
    "- 사장님이 적은 희망 사용처와 견적을 우선 반영합니다.",
    "- basis(산출 근거)는 '단가 × 수량' 형식으로 씁니다. 사장님이 준 견적이 없는 단가는 통상적인 수준으로 잡고 뒤에 '(견적 확인 필요)'를 붙입니다.",
    "- 금액은 원 단위 정수, 각 항목 합계가 천원 단위로 끊어지게 합니다.",
    "- category는 공고의 비목 명칭(예: 홍보·마케팅비, 시설개선비, 기자재 구입비)을 따릅니다.",
    "- notes에는 표 아래 붙일 주석(부가세 포함 여부, 견적 첨부 예정 등)을 짧게 적습니다.",
  ].filter(Boolean).join("\n");
}

/* ── 모의 심사 ─────────────────────────────────────────── */

function reviewTask(p) {
  return [
    "[사업계획서 초안]",
    p.draftText,
    "",
    "[자동 점검 결과]",
    p.lintText,
    "",
    "당신은 이 지원사업의 서류평가 심사위원입니다. 위 평가 기준표에 따라 사업계획서 초안을 엄격하게 채점하세요. 여러 신청서 가운데 상위만 선정되는 상대평가라고 가정합니다.",
    "- criteria: 평가항목마다 criterion_id, max_score(배점, 배점이 없으면 균등 배분한 값), score(0~max_score). 근거 없는 주장, 남아 있는 [확인 필요], 빠진 심사 포인트는 감점합니다.",
    "- strengths·weaknesses는 초안의 구체적 부분을 짚어 씁니다.",
    "- improvements는 바로 고쳐 쓸 수 있게 구체적으로 씁니다(예: '2절에 월 방문객 수 현황과 목표를 표로 추가').",
    "- section_ids: 그 항목 점수를 올리려면 고쳐야 할 섹션 id.",
    "- top_fixes: 점수 상승 효과가 큰 순서로 최대 5개. instruction은 그 섹션을 다시 쓰는 AI에게 줄 구체적인 지시문(사장님이 추가로 확인해야 할 사실이 있으면 [확인 필요]로 남기라고 지시).",
    "- red_flags: 자격 요건 위반 소지, 사실 확인이 안 된 내용, 양식·분량 위반, 사업비 규정 위반 등 탈락 위험 요소. 없으면 빈 배열.",
    "- overall_comment: 사장님께 드리는 총평 2~3문장(쉬운 말로). pass_likelihood: 현재 상태로의 선정 가능성.",
  ].join("\n");
}

module.exports = {
  SYSTEM: SYSTEM,
  analyzeTask: analyzeTask,
  renderAnalysis: renderAnalysis,
  renderContext: renderContext,
  prepareTask: prepareTask,
  sectionTask: sectionTask,
  budgetTask: budgetTask,
  reviewTask: reviewTask,
};
