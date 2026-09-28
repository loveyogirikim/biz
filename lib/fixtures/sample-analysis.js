/**
 * 예시 공고(public/samples/sample-announcement.txt)의 모범 분석 결과.
 * 데모 모드(LLM_MODE=fake)의 공고 분석 응답과 테스트 기준값으로 씁니다.
 */
module.exports = {
  program: {
    name: "2026년 한빛구 소상공인 온라인 판로 및 경영환경 개선 지원사업",
    agency: "한빛구청 지역경제과",
    program_type: "경영개선",
    purpose: "소상공인의 온라인 판로 개척 및 점포 경영환경 개선을 지원하여 매출 증대와 경쟁력 강화",
    summary: "한빛구 소상공인 40개사 내외에 업체당 최대 500만원을 온라인 판로·경영환경 개선 비용으로 지원(자부담 10% 이상, 후정산).",
    support_content: "온라인 판로(홈페이지·쇼핑몰, 상세페이지, 온라인 광고, 라이브커머스) 및 경영환경 개선(인테리어, 간판, 설비, 키오스크) 비용 지원. 두 분야 합산 한도 500만원.",
    max_support_krw: 5000000,
    self_pay_ratio_pct: 10,
    self_pay_note: "총사업비의 10% 이상, 현금 부담 원칙",
    selection_scale: "40개사 내외",
    application_period: "2026-10-01 ~ 2026-10-20 18:00",
    deadline: "2026-10-20",
    how_to_apply: "이메일 접수 (sosang@hanbit.example.kr)",
    contact: "한빛구청 지역경제과 02-000-0000",
  },
  eligibility: [
    { id: "E1", text: "한빛구에 사업장 소재", rule_type: "region", op: "in", number: null, values: ["한빛구"], source_quote: "공고일 현재 한빛구에 사업장을 두고" },
    { id: "E2", text: "사업자등록 후 6개월 이상 영업", rule_type: "business_age_years", op: "gte", number: 0.5, values: [], source_quote: "사업자등록 후 6개월 이상 영업 중인 소상공인" },
    { id: "E3", text: "상시근로자 5인 미만(제조업 등 10인 미만)", rule_type: "employees", op: "lt", number: 5, values: [], source_quote: "상시근로자 5인 미만 (제조업·건설업·운수업·광업은 10인 미만)" },
    { id: "E4", text: "전년도 매출액 10억원 이하", rule_type: "annual_revenue_krw", op: "lte", number: 1000000000, values: [], source_quote: "전년도 매출액 10억원 이하" },
    { id: "E5", text: "사업자등록 필수", rule_type: "registered_business_only", op: "none", number: null, values: [], source_quote: "사업자등록 후 6개월 이상" },
    { id: "E6", text: "최근 3년 이내 본 사업·유사 사업 수혜 이력 없음", rule_type: "other", op: "none", number: null, values: [], source_quote: "최근 3년 이내 본 사업 또는 유사 사업에 선정되어 지원받은 업체" },
  ],
  exclusions: [
    { id: "X1", text: "휴업 또는 폐업 중인 사업체" },
    { id: "X2", text: "국세·지방세 체납 중인 사업체" },
    { id: "X3", text: "유흥·사행성 업종 등 소상공인 정책자금 융자제외 대상 업종" },
    { id: "X4", text: "최근 3년 이내 본 사업 또는 유사 사업 수혜 업체" },
  ],
  evaluation: {
    source: "공고문",
    stages: ["요건 검토", "서류평가", "현장 실사", "최종 선정"],
    criteria: [
      { id: "C1", name: "사업 필요성", points: 25, description: "사업장 현황 및 문제점 분석의 구체성, 지원 필요성의 타당성",
        sub_items: [], look_for: ["현황·매출 추이의 구체적 수치", "문제의 원인 분석", "지원과 문제 해결의 연결"], keywords: ["현황", "문제점", "필요성"] },
      { id: "C2", name: "계획의 구체성", points: 30, description: "추진 내용·방법·일정의 구체성, 사업비 산출근거의 적정성",
        sub_items: [], look_for: ["분야별 실행 방법", "월별 일정", "단가×수량 산출근거와 견적"], keywords: ["추진 내용", "일정", "산출근거"] },
      { id: "C3", name: "실현 가능성", points: 20, description: "대표자의 역량과 추진 의지, 자부담 능력",
        sub_items: [], look_for: ["대표자 경력·교육", "자부담 조달 방법", "운영 인력"], keywords: ["역량", "자부담", "추진 의지"] },
      { id: "C4", name: "기대 효과", points: 25, description: "매출·고객 증대 등 정량 목표의 타당성, 사업 종료 후 지속 가능성",
        sub_items: [], look_for: ["현재 대비 정량 목표", "목표 산정 근거", "사업 종료 후 운영 계획"], keywords: ["매출", "고객", "지속"] },
    ],
    bonus: [
      { name: "착한가격업소 지정", points: 2, condition: "착한가격업소 지정 업체" },
      { name: "노란우산공제 가입", points: 1, condition: "노란우산공제 가입 업체" },
      { name: "여성기업·장애인기업", points: 2, condition: "여성기업 또는 장애인기업 확인" },
    ],
    cutoff: "서류평가 70점 이상 중 고득점순 (동점 시 사업 필요성 점수 우선)",
  },
  template: {
    source: "양식파일",
    preset_used: "",
    page_limit: 6,
    format_rules: ["전체 6쪽 이내", "맑은 고딕 11pt", "개조식 작성", "사업비 산출근거는 단가×수량, 견적서 첨부"],
    sections: [
      { id: "S1", title: "1. 일반현황", kind: "general_info", guide: "상호, 대표자, 사업자등록번호, 개업일, 소재지, 업종, 상시근로자, 전년도 매출, 신청 분야, 신청 금액", criteria_ids: [], max_pages: null,
        required_items: ["상호", "대표자", "사업자등록번호", "개업일", "사업장 소재지", "업종", "상시근로자 수", "전년도 매출액", "신청 분야", "신청 금액"] },
      { id: "S2", title: "2. 사업장 현황 및 문제점", kind: "narrative", guide: "주요 상품·서비스, 고객층, 매출 추이, 현재 겪는 어려움을 구체적으로", criteria_ids: ["C1"], max_pages: 1, required_items: ["주요 상품·서비스", "고객층", "매출 추이", "어려움"] },
      { id: "S3", title: "3. 지원 필요성 및 사업 목표", kind: "narrative", guide: "지원이 필요한 이유와 지원 후 달성할 목표를 수치로", criteria_ids: ["C1", "C4"], max_pages: null, required_items: ["지원 필요성", "정량 목표"] },
      { id: "S4", title: "4. 세부 추진계획", kind: "narrative", guide: "추진 내용과 방법을 분야별로 구체적으로", criteria_ids: ["C2", "C3"], max_pages: null, required_items: ["분야별 추진 내용", "추진 방법"] },
      { id: "S5", title: "5. 사업비 집행계획", kind: "budget", guide: "비목, 세부내용, 산출근거(단가×수량), 지원금, 자부담, 합계. 견적서 첨부", criteria_ids: ["C2", "C3"], max_pages: null, required_items: ["비목", "산출근거", "지원금", "자부담"] },
      { id: "S6", title: "6. 추진일정", kind: "schedule", guide: "협약일~11.30. 월별 추진 일정", criteria_ids: ["C2"], max_pages: null, required_items: [] },
      { id: "S7", title: "7. 기대효과", kind: "narrative", guide: "정량적 효과(매출, 고객 수 등)와 정성적 효과 구분", criteria_ids: ["C4"], max_pages: null, required_items: ["정량적 효과", "정성적 효과"] },
    ],
  },
  budget_rules: {
    allowed_items: ["홍보·마케팅비", "시설개선비", "기자재 구입비", "외주용역비"],
    disallowed_items: ["인건비", "임차료", "공과금", "차량 구입비", "부가가치세", "중고 물품"],
    notes: ["선집행 후 증빙 제출 시 지원금 지급(후정산)", "부가가치세는 업체 부담"],
  },
  required_documents: [
    "참여신청서 및 사업계획서(붙임1)", "사업자등록증명원", "소상공인 확인서", "국세·지방세 완납증명서",
    "전년도 부가가치세 과세표준증명원", "개인정보 수집·이용 동의서(붙임2)", "가점 증빙서류(해당자)",
  ],
  cautions: ["제출서류가 사실과 다르면 선정 취소 및 환수", "동일 품목 타 기관 지원금 중복 수령 불가", "예산 소진 시 조기 마감"],
  missing_info: ["사업기간이 짧아(협약일~11.30.) 일정 계획을 촘촘히 잡아야 함", "현물 자부담 인정 여부 명시 없음 — 현금 부담 원칙"],
};
