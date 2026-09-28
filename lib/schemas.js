/**
 * lib/schemas.js — AI 응답 구조(JSON Schema, structured outputs)
 * ============================================================
 * Claude structured outputs 제약: 모든 object 에 additionalProperties:false,
 * minimum/maxLength 같은 수치 제약은 쓰지 않습니다. 값이 없을 수 있는 숫자는
 * anyOf [number, null] 로 표현합니다.
 * ============================================================
 */

function obj(props) {
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}
function arr(items) {
  return { type: "array", items: items };
}
function nullable(type) {
  return { anyOf: [{ type: type }, { type: "null" }] };
}
const str = { type: "string" };
const strList = arr(str);

const RULE_TYPES = [
  "business_age_years", "employees", "annual_revenue_krw", "region", "industry",
  "owner_age", "pre_startup_only", "registered_business_only", "other",
];
const OPS = ["lt", "lte", "gt", "gte", "eq", "in", "not_in", "none"];
const SECTION_KINDS = ["general_info", "summary", "narrative", "budget", "schedule", "team"];

/* 1) 공고문 분석 */
const ANALYSIS = obj({
  program: obj({
    name: str,
    agency: str,
    program_type: { type: "string", enum: ["창업", "경영개선", "판로·마케팅", "시설·환경개선", "디지털전환", "재기·재창업", "교육·컨설팅", "기타"] },
    purpose: str,
    summary: str,
    support_content: str,
    max_support_krw: nullable("integer"),
    self_pay_ratio_pct: nullable("number"),
    self_pay_note: str,
    selection_scale: str,
    application_period: str,
    deadline: str,
    how_to_apply: str,
    contact: str,
  }),
  eligibility: arr(obj({
    id: str,
    text: str,
    rule_type: { type: "string", enum: RULE_TYPES },
    op: { type: "string", enum: OPS },
    number: nullable("number"),
    values: strList,
    source_quote: str,
  })),
  exclusions: arr(obj({ id: str, text: str })),
  evaluation: obj({
    source: { type: "string", enum: ["공고문", "평가표", "추정"] },
    stages: strList,
    criteria: arr(obj({
      id: str,
      name: str,
      points: nullable("number"),
      description: str,
      sub_items: arr(obj({ name: str, points: nullable("number") })),
      look_for: strList,
      keywords: strList,
    })),
    bonus: arr(obj({ name: str, points: nullable("number"), condition: str })),
    cutoff: str,
  }),
  template: obj({
    source: { type: "string", enum: ["양식파일", "공고문", "추정"] },
    preset_used: str,
    page_limit: nullable("number"),
    format_rules: strList,
    sections: arr(obj({
      id: str,
      title: str,
      kind: { type: "string", enum: SECTION_KINDS },
      guide: str,
      criteria_ids: strList,
      max_pages: nullable("number"),
      required_items: strList,
    })),
  }),
  budget_rules: obj({ allowed_items: strList, disallowed_items: strList, notes: strList }),
  required_documents: strList,
  cautions: strList,
  missing_info: strList,
});

/* 2) 작성 준비: AI 자격 판정 + 가점 + 추가 질문 + 전략 */
const PREPARE = obj({
  eligibility_judgements: arr(obj({
    id: str,
    status: { type: "string", enum: ["pass", "fail", "unknown"] },
    reason: str,
  })),
  bonus_opportunities: arr(obj({
    name: str,
    status: { type: "string", enum: ["해당", "가능성 있음", "해당 없음", "확인 필요"] },
    action: str,
  })),
  questions: arr(obj({
    id: str,
    question: str,
    why: str,
    criteria_ids: strList,
    example: str,
    priority: { type: "string", enum: ["high", "medium", "low"] },
  })),
  strategy: obj({
    concept_title: str,
    one_liner: str,
    key_messages: strList,
    differentiators: strList,
    weak_points: strList,
    numbers_to_prepare: strList,
  }),
});

/* 3) 사업비 항목 — 합계·비율 검증은 lib/budget.js 가 계산 */
const BUDGET = obj({
  items: arr(obj({
    category: str,
    item: str,
    basis: str,
    gov_krw: { type: "integer" },
    self_cash_krw: { type: "integer" },
    self_inkind_krw: { type: "integer" },
  })),
  notes: strList,
});

/* 4) 모의 심사 */
const REVIEW = obj({
  overall_comment: str,
  pass_likelihood: { type: "string", enum: ["높음", "보통", "낮음"] },
  criteria: arr(obj({
    criterion_id: str,
    score: { type: "number" },
    max_score: { type: "number" },
    strengths: strList,
    weaknesses: strList,
    improvements: strList,
    section_ids: strList,
  })),
  top_fixes: arr(obj({
    section_id: str,
    priority: { type: "string", enum: ["high", "medium", "low"] },
    instruction: str,
  })),
  red_flags: strList,
});

module.exports = { ANALYSIS: ANALYSIS, PREPARE: PREPARE, BUDGET: BUDGET, REVIEW: REVIEW, SECTION_KINDS: SECTION_KINDS };
