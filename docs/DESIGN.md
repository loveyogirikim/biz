# 사업계획서 자동작성 — 설계서

> 공고문을 올리면 **신청 자격 → 심사위원 평가기준 → 사업계획서 양식**에 맞춘 초안을 만들고,
> 같은 평가표로 **모의 심사**까지 해 주는 소상공인용 도구입니다.

---

## 1. 왜 필요한가

소상공인이 지원사업에서 떨어지는 이유는 사업이 나빠서라기보다 **서류가 평가표에 답하지 못해서**인 경우가 많습니다.

| 사장님이 겪는 어려움 | 이 도구가 대신 하는 일 |
|---|---|
| 공고문이 HWP 수십 쪽이라 자격·배점·양식을 찾기 어렵다 | 공고문·양식·평가표를 읽어 한 화면으로 정리 |
| 내가 신청 대상인지 헷갈린다 | 업력·근로자 수·매출·지역은 **계산으로** 자동 판정 |
| 무엇을 얼마나 써야 점수가 나오는지 모른다 | 평가항목 배점에 맞춰 섹션별 분량·논점 배분 |
| 양식 목차·분량·글꼴 규정을 놓친다 | 양식 목차 그대로 작성, 유의사항의 글꼴·크기를 DOCX에 적용 |
| 사업비 표 숫자가 안 맞아 감점된다 | 한도·자부담 비율·불가 비목을 코드로 검증 |
| 제출 전에 어디가 약한지 모른다 | 같은 평가표로 모의 채점 + "이대로 보완하기" |

---

## 2. 저장소 조사 결과 (다시 정리)

`sosang-helper.vercel.app` 원본 소스를 찾기 위해 접근 가능한 GitHub 저장소 9개를 모두 확인했습니다.

| 저장소 | 내용 | 이번 작업과의 관계 |
|---|---|---|
| **biz** (이 저장소) | 기업마당 API → Notion 공고 수집 (Python, GitHub Actions) | ✅ 기능을 여기에 구현 |
| mybot_gemini | Daily Insights: 바닐라 JS + Vercel 서버리스(`api/chat.js`, Gemini) + 기업마당 서울·경기 지원사업 | 📐 구조·관례를 그대로 따름 |
| mybot | 위와 같은 앱의 GitHub Pages 버전 (AI 없음) | 참고 |
| daily, myhome, my-portfolio, page, page-1 | 대시보드·홈페이지·갤러리 | 관련 없음 |
| ifa | 빈 저장소 | — |

- `sosang-helper` 소스는 **어디에도 없습니다**. `sosang` 문자열도 전혀 없어, 다른 계정의 저장소이거나 GitHub 연동 없이 Vercel/AI 빌더로 바로 배포된 것으로 보입니다.
- 그래서 이 기능은 **biz 저장소에 독립 앱**으로 만들고, 사장님이 이미 쓰는 구조(`mybot_gemini`)를 그대로 따랐습니다.
  - 빌드 도구 없는 HTML + CSS + Vanilla JS
  - `api/*.js` Vercel 서버리스 함수, `module.exports = async function handler(req, res)`
  - API 키는 Vercel 환경변수에만 (브라우저 노출 없음)
  - GitHub Actions가 `data/*.json`을 커밋 → Vercel 자동 재배포
  - 의존성 없는 `dev-server.js`로 로컬 실행
- sosang-helper와 합치는 방법은 [9장](#9-sosang-helper와-연결하는-방법)에 정리했습니다.

---

## 3. 전체 흐름

```
 ① 공고 올리기          ② 공고 분석              ③ 가게 정보        ④ 자격·질문
 HWP/HWPX/PDF/DOCX  →  자격 조건(구조화)      →  22개 항목 폼   →  자격 자동 판정
 붙여넣기 / 공고 목록    평가표(항목·배점·포인트)                    가점 기회
                        양식 목차(섹션·작성요령)                     부족 정보 질문 ≤8개
                        사업비 규정·제출서류                         작성 전략(사업명·핵심 메시지)
                                  │
                                  ▼
 ⑦ 완성               ⑥ 모의 심사              ⑤ 초안 작성
 DOCX(양식 글꼴)   ←   평가표로 항목별 채점   ←  섹션별 스트리밍 작성
 표 유지 복사          약점·개선안·탈락 위험      배점 → 분량 배분
 [확인 필요] 목록      "이대로 보완하기"          사업비: AI 항목 + 코드 검증
 제출서류 체크                                   일반현황: 코드가 자동 입력
```

### 평가기준 역설계 — 이 도구의 핵심

```
 평가표                       양식 섹션                         초안
 C1 사업 필요성 25점 ──┬──→ S2 사업장 현황 및 문제점   (C1 12.5점 → 약 650자)
                      └──→ S3 지원 필요성 및 목표     (C1 12.5 + C4 12.5 → 약 1,300자)
 C2 계획의 구체성 30점 ─┬─→ S4 세부 추진계획 ...
                       ├─→ S5 사업비 집행계획
                       └─→ S6 추진일정
 C4 기대 효과 25점 ────┬──→ S3 …
                      └──→ S7 기대효과
```

1. 공고 분석 때 **모든 평가항목을 최소 한 섹션에 매핑**합니다 (AI가 빠뜨리면 코드가 가장 가까운 섹션에 연결).
2. 섹션 목표 분량 = 연결된 평가항목 배점의 합 비율 × 전체 분량(쪽수 제한 × 1,000자 × 0.85).
3. 섹션을 쓸 때 AI에게 "이 섹션이 답해야 할 평가항목·심사 포인트·키워드"를 줍니다.
4. 다 쓴 뒤 **같은 평가표**로 모의 채점하고, 점수 상승 효과가 큰 순서로 보완 지시를 만듭니다.

---

## 4. AI와 코드의 역할 분담

"AI가 틀리면 안 되는 것"은 코드가 계산합니다.

| 일 | 담당 | 이유 |
|---|---|---|
| 공고문 해석(자격·평가표·양식 구조화) | AI (구조화 출력) | 공고마다 형식이 제각각 |
| 업력·근로자 수·매출·지역·나이 판정 | **코드** (`lib/eligibility.js`) | 숫자 비교는 틀리면 안 됨 |
| "3년 내 유사사업 수혜" 같은 비정형 자격 | AI | 해석이 필요 |
| 섹션별 분량 배분 | **코드** (`lib/strategy.js`) | 배점 비례 계산 |
| 본문 작성·보완 | AI (스트리밍) | 글쓰기 |
| 사업비 항목·산출근거 | AI (구조화 출력) | 계획과 연결된 항목 구성 |
| 사업비 합계·자부담 비율·한도·불가 비목 | **코드** (`lib/budget.js`) | 숫자가 하나라도 틀리면 감점 |
| 일반현황 표 | **코드** (`lib/general-info.js`) | 사실 정보만 들어가는 칸 |
| 분량·[확인 필요]·평가 키워드 점검 | **코드** (`lib/lint.js`) | 규칙으로 충분 |
| 모의 심사 | AI + 코드 점검 결과 참고 | 배점은 코드가 공고 기준으로 보정 |
| DOCX 만들기 | **코드** (`lib/docx-export.js`) | 양식 글꼴·크기 적용 |

### 사실 기반 원칙 (허위 기재 방지)

- AI는 사장님이 입력한 정보와 공고문 내용만 사실로 씁니다.
- 매출·고객 수·인증·특허·수상·통계 등 **주어지지 않은 사실은 `[확인 필요: …]`로 표시**합니다.
- 화면과 DOCX에서 노란색으로 강조하고, 완성 단계에서 남은 개수와 위치를 목록으로 보여줍니다.
- 허위 기재는 선정 취소·환수 사유이기 때문에, 그럴듯한 가짜 수치보다 빈칸 표시가 사장님에게 안전합니다.

---

## 5. 구성 요소

```
biz/
├── public/                     ← 화면 (Vercel 정적 배포, outputDirectory)
│   ├── index.html · style.css · app.js   7단계 마법사 (Vanilla JS, 상태는 localStorage)
│   ├── shared.js               가게 정보 항목 정의 + 개조식 마크다운 파서 (화면·서버 공용)
│   ├── data/announcements.json 최근 공고 목록 (Actions가 갱신)
│   └── samples/                예시(가상) 공고문
├── api/                        ← Vercel 서버리스 함수
│   ├── health.js               GET  데모 모드·이용 코드 여부
│   ├── analyze.js              POST 공고문 분석
│   ├── prepare.js              POST 자격·가점·추가 질문·작성 전략
│   ├── write.js                POST 섹션 작성·보완 (NDJSON 스트리밍)
│   ├── review.js               POST 모의 심사 + 자동 점검
│   ├── export.js               POST DOCX 내려받기
│   └── fetch-file.js           POST 기업마당 첨부파일 불러오기 (bizinfo.go.kr만)
├── lib/
│   ├── extract/                HWP(배포용 포함)·HWPX·DOCX·텍스트 추출, PDF·이미지 판별
│   ├── llm.js · llm-fake.js    Claude 호출 / 데모 모드 응답
│   ├── prompts.js · schemas.js 지시문 / 구조화 출력 스키마
│   ├── eligibility.js · budget.js · strategy.js · lint.js · general-info.js · analysis.js
│   ├── presets.js              양식·평가표가 없을 때 쓰는 참고 구조 4종
│   ├── docx-export.js · http.js
│   └── fixtures/sample-analysis.js
├── scripts/export_announcements.py   기업마당 → public/data/announcements.json
├── .github/workflows/announcements.yml  하루 2번 공고 목록 갱신
├── main.py · daily.yml          (기존) 기업마당 → Notion 수집기 — 그대로 유지
├── dev-server.js · vercel.json · .vercelignore · .env.example
└── tests/                      Node 테스트 + Python 테스트
```

### 문서 추출

| 형식 | 처리 |
|---|---|
| HWP 5.0 | OLE → BodyText 레코드 파싱, 표는 `\| 칸 \| 칸 \|` 행으로 복원 |
| HWP 배포용(읽기 전용) | ViewText 복호화(AES-128) → 실패 시 미리보기(PrvText) + 안내 |
| HWPX / DOCX | ZIP → XML 본문·표 추출 |
| PDF / 이미지 | 서버에서 뜯지 않고 Claude에 문서·이미지로 그대로 전달 |
| TXT | UTF-8 / EUC-KR 자동 판별 |

---

## 6. API

모든 AI 엔드포인트는 서버에 상태를 저장하지 않습니다. 화면이 매 요청에 필요한 정보를 함께 보냅니다 (서버리스에 맞는 구조).

| 엔드포인트 | 요청 | 응답 |
|---|---|---|
| `GET /api/health` | — | `{mode, model, ready, accessCodeRequired}` |
| `POST /api/analyze` | `{files:[{name,data(base64)}], text?, meta?}` | `{analysis, outline, sources, notes}` |
| `POST /api/prepare` | `{analysis, profile}` | `{eligibility, small_business, bonus, questions, strategy}` |
| `POST /api/write` | `{analysis, outline, profile, questions, answers, strategy, sections, section_id, mode, instruction?}` | NDJSON: `thinking` → `delta`… → `done{text, budget?}` / `error` |
| `POST /api/review` | 위와 같음 | `{review, lint, score:{total,max,pct}}` |
| `POST /api/export` | 위와 같음 + `options.include_notes` | `.docx` |
| `POST /api/fetch-file` | `{url}` (bizinfo.go.kr) | `{name, data, size}` |

오류는 `{error: "사장님이 이해할 수 있는 한국어 문장"}` 형식입니다.

---

## 7. 보안·비용

| 항목 | 방식 |
|---|---|
| API 키 | `ANTHROPIC_API_KEY`는 Vercel 환경변수에만. 브라우저로 내려가지 않음 |
| 무단 사용 | `ACCESS_CODE` 설정 시 코드가 있어야 AI 호출 가능 + IP당 시간당 호출 제한 |
| 외부 사이트 호출 | 같은 도메인만 허용, 다른 사이트는 `ALLOWED_ORIGINS`에 등록해야 함 |
| 첨부파일 프록시 | `bizinfo.go.kr`만, 리다이렉트도 재검사, 4MB 제한 (열린 프록시 방지) |
| 개인정보 | 가게 정보는 브라우저 localStorage에만 저장. 서버는 저장하지 않고, 작성 요청 때만 Claude로 전송 |

**비용 (추정)**: 기본 모델 `claude-opus-5` 기준으로 사업계획서 1건(분석 1 + 준비 1 + 섹션 7 + 심사 1)에 입력 약 10만 토큰, 출력(추론 포함) 약 3만~5만 토큰입니다. 대략 **1건당 1~2달러**로 추정하며, 실제 사용량은 서버 로그(`[llm] … in= out=`)로 확인할 수 있습니다.

- 섹션을 연달아 쓸 때는 공고 분석·가게 정보 부분에 **프롬프트 캐시**가 걸려 입력 비용이 크게 줄어듭니다.
- `CLAUDE_EFFORT=medium`으로 낮추면 더 빠르고 저렴하지만, 품질은 예시 공고로 비교해 보고 정하세요.

---

## 8. 한계 (정직하게)

- **실제 Claude 호출은 개발 환경에서 검증하지 못했습니다.** 이 환경에는 API 키가 없어서, 전체 흐름은 데모 모드(가짜 응답)와 단위 테스트로 검증했습니다. 첫 배포 후 예시 공고로 한 번 끝까지 돌려 확인해야 합니다.
- **HWP**: 표 셀 좌표와 배포용 문서 복호화는 공개된 명세·오픈소스 구현을 따랐지만, 실제 한컴 파일로는 아직 검증하지 않았습니다. 잘 안 읽히면 한글에서 **PDF로 저장해 올리는 것**이 가장 확실합니다. 복호화 결과가 이상하면 자동으로 미리보기 텍스트로 돌아갑니다.
- **한글(HWP) 파일로 직접 출력하지 않습니다.** DOCX(한글에서 열림)와 "표 모양 그대로 복사"로 양식에 옮겨 붙이는 방식입니다.
- 모의 심사 점수는 AI의 추정이며 실제 심사 결과를 보장하지 않습니다.
- 공고 목록 수집(`export_announcements.py`)은 기업마당 API 필드명(`flpthNm`·`fileNm` 등)을 기준으로 방어적으로 작성했으며, 첫 실행 결과를 확인해야 합니다.

---

## 9. sosang-helper와 연결하는 방법

원본 소스를 찾지 못했으므로, 소스 위치에 따라 세 가지 중 하나를 고르면 됩니다.

| 방법 | 작업량 | 방법 |
|---|---|---|
| **A. 링크로 연결** (가장 쉬움) | 5분 | 이 앱을 별도 Vercel 프로젝트로 배포하고, sosang-helper의 공고 카드에 "사업계획서 쓰기" 버튼을 달아 이동 |
| **B. API만 가져다 쓰기** | 반나절 | 이 앱 배포 후 `ALLOWED_ORIGINS=https://sosang-helper.vercel.app` 설정 → sosang-helper 화면에서 `/api/*` 호출 |
| **C. 한 프로젝트로 합치기** | 1~2일 | sosang-helper 저장소에 `api/`·`lib/`·`public/` 파일을 옮김 (같은 Vercel 구조라 대부분 그대로 동작) |

sosang-helper 저장소 주소를 알려주시면 B·C 작업을 이어서 할 수 있습니다.

---

## 10. 다음 단계 제안

1. **실제 공고 3~5건으로 품질 점검**: 서울·경기 소상공인 공고의 HWP 원본으로 분석 정확도(배점·목차)를 확인하고 프롬프트를 조정
2. **공고 분석 캐시**: 같은 공고를 여러 사장님이 쓰면 분석 결과를 공유 (공고 ID 기준) → 비용·시간 절감
3. **HWPX 양식 직접 채우기**: 공고의 HWPX 양식 파일에 섹션 본문을 끼워 넣어 그대로 제출 가능한 파일 생성
4. **발표평가 대비**: 사업계획서로 5분 발표 요약과 예상 질문·답변 생성
5. **증빙서류 도우미**: 제출 서류별 발급처(홈택스·소상공인24 등) 안내와 체크리스트
6. **계정·저장**: 여러 기기에서 이어 쓰기 (지금은 "작업 파일 저장/불러오기"로 대체)
