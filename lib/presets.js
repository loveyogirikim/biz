/**
 * lib/presets.js — 참고용 사업계획서 구조
 * ============================================================
 * 공고문에 사업계획서 양식이나 평가표가 없을 때만 AI가 골라 쓰는 "일반적인 구조"
 * 입니다. 실제 공고의 양식·배점이 있으면 항상 그것이 우선이며, 이 프리셋을 쓴
 * 경우 분석 결과에 source: "추정" 으로 표시되어 화면에 안내됩니다.
 *
 * 배점은 특정 사업의 공식 배점이 아니라 균형 잡힌 예시값입니다.
 * ============================================================
 */

const PRESETS = [
  {
    id: "startup-psst",
    name: "창업 지원형 (PSST: 문제인식·실현가능성·성장전략·팀구성)",
    when: "예비·초기 창업 지원, 창업사관학교, 신사업 창업 등 창업 아이템을 평가하는 사업",
    sections: [
      { title: "일반현황", kind: "general_info", guide: "기업명, 대표자, 개업일, 소재지, 업종, 고용 현황, 신청 금액" },
      { title: "창업 아이템 개요(요약)", kind: "summary", guide: "아이템 소개, 문제·해결·성장·팀을 한눈에 요약" },
      { title: "1. 문제 인식 (Problem)", kind: "narrative", guide: "창업 동기, 고객이 겪는 문제와 근거, 시장 현황" },
      { title: "2. 실현 가능성 (Solution)", kind: "narrative", guide: "해결 방안, 차별성·경쟁력, 개발·준비 현황, 사업비 집행 계획" },
      { title: "3. 성장 전략 (Scale-up)", kind: "narrative", guide: "목표 시장 진입 전략, 판로, 자금 조달, 단계별 성과 목표" },
      { title: "4. 팀 구성 (Team)", kind: "team", guide: "대표자 역량, 팀원·협력 네트워크, 고용 계획" },
    ],
    criteria: [
      { name: "문제 인식", points: 25, look_for: ["창업 동기의 타당성", "고객 문제의 구체성과 근거"] },
      { name: "실현 가능성", points: 30, look_for: ["해결책의 구체성", "차별성·경쟁력", "사업비 계획의 적정성"] },
      { name: "성장 전략", points: 25, look_for: ["시장 진입 전략", "매출·고용 목표의 현실성"] },
      { name: "팀 구성", points: 20, look_for: ["대표자 전문성", "실행 인력 확보"] },
    ],
  },
  {
    id: "sosang-general",
    name: "소상공인 경영개선·성장 지원형",
    when: "경영환경 개선, 역량 강화, 성장 지원, 지자체 소상공인 지원사업 대부분",
    sections: [
      { title: "일반현황", kind: "general_info", guide: "상호, 대표자, 개업일, 소재지, 업종, 상시근로자, 매출" },
      { title: "1. 사업장 현황 및 문제점", kind: "narrative", guide: "주력 상품·고객·매출 현황, 현재 겪는 어려움과 원인" },
      { title: "2. 지원 필요성 및 목표", kind: "narrative", guide: "왜 지원이 필요한지, 지원 후 달라질 모습과 정량 목표" },
      { title: "3. 세부 추진 계획", kind: "narrative", guide: "무엇을 어떻게 할지 단계별 실행 방법" },
      { title: "4. 사업비 집행 계획", kind: "budget", guide: "비목별 금액과 산출 근거, 자부담" },
      { title: "5. 추진 일정", kind: "schedule", guide: "월별 추진 일정" },
      { title: "6. 기대 효과 및 성과 지표", kind: "narrative", guide: "매출·고객·고용 등 정량 성과와 지역·사회적 효과" },
    ],
    criteria: [
      { name: "사업의 필요성", points: 25, look_for: ["현황 분석의 구체성", "문제와 지원 내용의 연결"] },
      { name: "계획의 구체성·적정성", points: 30, look_for: ["실행 방법과 일정", "사업비 산출 근거"] },
      { name: "실현 가능성", points: 25, look_for: ["대표자 역량·의지", "자부담·준비 정도"] },
      { name: "기대 효과", points: 20, look_for: ["정량 목표의 타당성", "지속 가능성"] },
    ],
  },
  {
    id: "market-online",
    name: "판로·온라인 진출 지원형",
    when: "온라인 판로, 라이브커머스, 수출·박람회, 브랜드·마케팅 지원",
    sections: [
      { title: "일반현황", kind: "general_info", guide: "기업·대표자 정보, 주요 제품" },
      { title: "1. 제품·서비스 소개", kind: "narrative", guide: "제품 특징, 가격, 품질·인증" },
      { title: "2. 목표 시장 및 고객", kind: "narrative", guide: "타깃 고객, 시장 현황, 경쟁 제품 비교" },
      { title: "3. 판로 개척·마케팅 전략", kind: "narrative", guide: "채널별 전략, 콘텐츠·광고 계획" },
      { title: "4. 사업비 집행 계획", kind: "budget", guide: "비목별 금액과 산출 근거" },
      { title: "5. 추진 일정", kind: "schedule", guide: "월별 일정" },
      { title: "6. 성과 목표", kind: "narrative", guide: "매출·판매량·신규 고객 목표" },
    ],
    criteria: [
      { name: "제품 경쟁력", points: 30, look_for: ["차별성", "품질·가격 경쟁력"] },
      { name: "시장성·판로 전략", points: 30, look_for: ["타깃 명확성", "채널 전략의 구체성"] },
      { name: "사업 수행 역량", points: 20, look_for: ["운영 경험", "준비 정도"] },
      { name: "성과 목표의 타당성", points: 20, look_for: ["정량 목표", "근거"] },
    ],
  },
  {
    id: "facility-smart",
    name: "시설·환경 개선 / 스마트 기술 도입형",
    when: "점포 환경개선, 스마트상점 기술보급, 키오스크·서빙로봇 등 설비 도입",
    sections: [
      { title: "일반현황", kind: "general_info", guide: "기업·대표자 정보, 점포 면적·임차 현황" },
      { title: "1. 사업장 현황", kind: "narrative", guide: "점포 운영 현황, 고객 동선, 기존 설비" },
      { title: "2. 개선 필요성", kind: "narrative", guide: "현재 문제(노후·비효율·인력난)와 개선 시 효과" },
      { title: "3. 개선·도입 계획", kind: "narrative", guide: "도입할 시설·기술, 공급 업체, 활용 계획" },
      { title: "4. 사업비 집행 계획", kind: "budget", guide: "품목별 견적 기준 금액, 자부담" },
      { title: "5. 기대 효과", kind: "narrative", guide: "매출·인건비·고객 만족 등 개선 효과" },
    ],
    criteria: [
      { name: "개선 필요성", points: 30, look_for: ["현황 문제의 구체성"] },
      { name: "계획의 적정성", points: 30, look_for: ["도입 품목의 적합성", "견적·사업비 타당성"] },
      { name: "활용 역량", points: 20, look_for: ["운영·유지 계획"] },
      { name: "기대 효과", points: 20, look_for: ["정량 효과", "지속성"] },
    ],
  },
];

/** 분석 프롬프트에 넣을 참고 양식 텍스트 */
function presetsToText() {
  return PRESETS.map(function (p) {
    return [
      "■ " + p.name,
      "  적용: " + p.when,
      "  목차: " + p.sections.map(function (s) { return s.title + "(" + s.kind + ")"; }).join(" / "),
      "  평가(예시 배점): " + p.criteria.map(function (c) { return c.name + " " + c.points + "점"; }).join(", "),
    ].join("\n");
  }).join("\n");
}

module.exports = { PRESETS: PRESETS, presetsToText: presetsToText };
