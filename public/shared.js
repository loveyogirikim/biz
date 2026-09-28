/**
 * shared.js — 브라우저와 서버(api/*)가 함께 쓰는 공용 모듈
 * ============================================================
 *  - PROFILE_FIELDS : "우리 가게 정보" 입력 항목 정의 (화면 폼 + AI 프롬프트 공용)
 *  - parseMarkdown  : AI가 쓴 개조식 본문(□ ○ - ·, 표)을 블록 단위로 해석
 *  - parseInline    : **굵게**, [확인 필요: …] 표시를 조각으로 분리
 *
 * 브라우저에서는 window.SosangShared, 서버에서는 require() 로 씁니다.
 * ============================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SosangShared = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ── 가게 정보 입력 항목 ───────────────────────────────────
     group : 화면에서 묶어 보여줄 단위
     type  : text | textarea | number | date | select | checkbox
     hint  : 입력칸 안내(placeholder) — 사장님이 무엇을 쓰면 되는지 예시로 */
  var PROFILE_FIELDS = [
    { key: "business_name", label: "상호(가게 이름)", group: "기본 정보", type: "text", hint: "예) 행복한 반찬가게" },
    { key: "owner_name", label: "대표자 이름", group: "기본 정보", type: "text", hint: "예) 홍길동" },
    { key: "owner_birth_year", label: "대표자 출생연도", group: "기본 정보", type: "number", hint: "예) 1985 (청년·중장년 조건 판정용)" },
    { key: "is_pre_startup", label: "아직 사업자등록 전(예비창업자)입니다", group: "기본 정보", type: "checkbox" },
    { key: "open_date", label: "개업일(사업자등록일)", group: "기본 정보", type: "date" },
    { key: "region_sido", label: "사업장 시·도", group: "기본 정보", type: "select",
      options: ["", "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"] },
    { key: "region_sigungu", label: "사업장 시·군·구", group: "기본 정보", type: "text", hint: "예) 마포구" },
    { key: "industry", label: "업종(구체적으로)", group: "기본 정보", type: "text", hint: "예) 반찬 제조·판매(음식점업), 네일숍, 수제 가구 제작" },
    { key: "industry_group", label: "업종 구분", group: "기본 정보", type: "select",
      options: ["", "음식점업", "도소매업", "서비스업", "제조업", "건설업", "운수업", "광업", "기타"] },
    { key: "employees", label: "상시근로자 수(대표자 제외, 명)", group: "기본 정보", type: "number", hint: "예) 2" },
    { key: "annual_revenue_krw", label: "작년 연매출(원)", group: "기본 정보", type: "number", hint: "예) 180000000 (모르면 비워두세요)" },

    { key: "products", label: "주요 상품·서비스와 가격대", group: "가게 이야기", type: "textarea", hint: "예) 수제 반찬 30종, 1팩 5,000~9,000원. 도시락 정기배송 월 12만원" },
    { key: "customers", label: "주요 고객과 현재 판매 현황", group: "가게 이야기", type: "textarea", hint: "예) 인근 아파트 30~40대 맞벌이. 하루 방문 60명, 재구매율 높음. 월매출 1,500만원" },
    { key: "strengths", label: "우리 가게만의 강점·차별점", group: "가게 이야기", type: "textarea", hint: "예) 국내산 재료만 사용, 당일 조리·당일 판매, 20년 한식 조리 경력" },
    { key: "problems", label: "요즘 가장 큰 어려움", group: "가게 이야기", type: "textarea", hint: "예) 배달앱 수수료 부담, 온라인 주문 창구 없음, 주방 설비 노후" },
    { key: "online_channels", label: "온라인 채널(스마트스토어·인스타·배달앱 등)", group: "가게 이야기", type: "textarea", hint: "예) 네이버 플레이스 리뷰 320개, 인스타 팔로워 800명, 배민 입점" },

    { key: "plan", label: "지원금으로 하고 싶은 일", group: "지원사업 활용 계획", type: "textarea", hint: "예) 온라인 정기배송 시작 — 자사몰 구축, 포장재 개선, 상세페이지 촬영" },
    { key: "budget_wish", label: "쓰고 싶은 곳과 대략의 금액(견적이 있으면 함께)", group: "지원사업 활용 계획", type: "textarea", hint: "예) 홈페이지 제작 250만원(견적 받음), 포장 디자인 100만원, 광고 150만원" },
    { key: "goals", label: "지원 후 이루고 싶은 목표(숫자로)", group: "지원사업 활용 계획", type: "textarea", hint: "예) 1년 안에 온라인 매출 월 500만원, 정기배송 회원 100명, 직원 1명 추가 채용" },

    { key: "owner_career", label: "대표자 경력·교육 이수", group: "역량과 실적", type: "textarea", hint: "예) 한식조리기능사, 호텔 조리 10년, 소상공인 역량강화 교육 수료(2025)" },
    { key: "team", label: "함께 일하는 사람(직원·가족·협력업체)", group: "역량과 실적", type: "textarea", hint: "예) 주방 직원 2명(5년 근속), 포장재 협력업체 1곳" },
    { key: "achievements", label: "인증·수상·특허·언론 소개", group: "역량과 실적", type: "textarea", hint: "예) 착한가격업소 지정(2024), 지역 신문 소개 1회, 노란우산 가입" },
    { key: "extra", label: "그 밖에 심사위원이 알면 좋을 내용", group: "역량과 실적", type: "textarea", hint: "예) 여성 대표, 지역 경로당에 월 1회 반찬 나눔" }
  ];

  /* AI 프롬프트에 넣을 가게 정보 텍스트 — 빈 항목은 "(미입력)" 으로 남겨
     AI가 모르는 정보를 지어내지 않고 [확인 필요]로 표시하도록 합니다 */
  function profileToText(profile) {
    profile = profile || {};
    return PROFILE_FIELDS.map(function (f) {
      var v = profile[f.key];
      if (f.type === "checkbox") return "- " + f.label + ": " + (v ? "예" : "아니오");
      if (v === undefined || v === null || String(v).trim() === "") return "- " + f.label + ": (미입력)";
      if (f.key === "annual_revenue_krw" && !isNaN(Number(v))) v = formatWon(Number(v));
      return "- " + f.label + ": " + String(v).trim();
    }).join("\n");
  }

  function formatWon(n) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return Math.round(n).toLocaleString("ko-KR") + "원";
  }

  /* ── [확인 필요: …] 표시 ─────────────────────────────────── */
  var PLACEHOLDER_RE = /\[확인\s?필요[^\]]*\]/g;

  function findPlaceholders(text) {
    return String(text || "").match(PLACEHOLDER_RE) || [];
  }

  /* ── 개조식 마크다운 해석 ───────────────────────────────────
     □ ■ → 0단계, ○ ● → 1단계, - * • → 2단계, · ◦ ▪ → 3단계
     (앞 공백 2칸마다 한 단계씩 더 들여씀) */
  var MARKER_LEVEL = { "□": 0, "■": 0, "○": 1, "●": 1, "-": 2, "*": 2, "•": 2, "·": 3, "◦": 3, "▪": 3 };
  var ITEM_RE = /^(\s*)([□■○●◦•\-\*·▪]|※)\s+(.*)$/;
  var HEADING_RE = /^(#{1,6})\s+(.*)$/;

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
    return s.split("|").map(function (c) { return c.trim(); });
  }

  function isSeparatorRow(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }

  function parseMarkdown(md) {
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) { i++; continue; }

      /* 코드 펜스는 내용만 살리고 펜스 자체는 버립니다 */
      if (/^```/.test(trimmed)) { i++; continue; }

      if (trimmed.charAt(0) === "|") {
        var rows = [];
        while (i < lines.length && lines[i].trim().charAt(0) === "|") {
          if (!isSeparatorRow(lines[i])) rows.push(splitRow(lines[i]));
          i++;
        }
        if (rows.length) blocks.push({ type: "table", rows: rows });
        continue;
      }

      var h = trimmed.match(HEADING_RE);
      if (h) {
        blocks.push({ type: "heading", level: h[1].length, text: h[2].replace(/\s*#+\s*$/, "") });
        i++;
        continue;
      }

      var m = line.match(ITEM_RE);
      if (m) {
        var indent = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        var marker = m[2];
        var base = marker === "※" ? indent : (MARKER_LEVEL[marker] || 0);
        /* 마크다운식 "- " 목록은 들여쓰기로만 단계를 표현하므로 기본 단계를 낮춥니다 */
        if (marker === "-" || marker === "*") base = 1 + indent;
        else base = Math.max(base, indent);
        blocks.push({ type: "item", marker: marker === "*" ? "-" : marker, level: Math.min(base, 4), text: m[3] });
        i++;
        continue;
      }

      blocks.push({ type: "para", text: trimmed });
      i++;
    }
    return blocks;
  }

  /* **굵게** 와 [확인 필요] 를 분리 → [{text, bold, placeholder}] */
  function parseInline(text) {
    var out = [];
    var re = /(\*\*[^*]+\*\*|\[확인\s?필요[^\]]*\])/g;
    var last = 0;
    var s = String(text || "");
    var m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      var tok = m[0];
      if (tok.charAt(0) === "*") out.push({ text: tok.slice(2, -2), bold: true });
      else out.push({ text: tok, placeholder: true });
      last = m.index + tok.length;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }

  /* 공백 포함 글자 수 (표 구분선·마크다운 기호 제외) */
  function countChars(md) {
    return String(md || "")
      .replace(/^\s*\|?\s*:?-{2,}.*$/gm, "")
      .replace(/[#*|]/g, "")
      .replace(/\s+/g, " ")
      .trim().length;
  }

  return {
    PROFILE_FIELDS: PROFILE_FIELDS,
    profileToText: profileToText,
    formatWon: formatWon,
    PLACEHOLDER_RE: PLACEHOLDER_RE,
    findPlaceholders: findPlaceholders,
    parseMarkdown: parseMarkdown,
    parseInline: parseInline,
    countChars: countChars
  };
});
