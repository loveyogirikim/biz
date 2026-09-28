# biz — 소상공인 지원사업 도우미

이 저장소에는 두 가지 도구가 들어 있습니다.

| 도구 | 하는 일 | 실행 위치 |
|---|---|---|
| **1. 사업계획서 도우미** (새로 추가) | 공고문을 올리면 신청 자격 점검 → 심사 평가기준에 맞춘 → 사업계획서 양식 그대로의 초안 작성 → 모의 심사 → Word 파일 | Vercel (웹) |
| **2. 기업마당 → Notion 수집기** (기존) | 서울·경기 지원사업 공고를 매일 Notion DB에 저장 | GitHub Actions |

설계 배경과 구조는 [docs/DESIGN.md](docs/DESIGN.md)에 정리했습니다.

---

## 1. 사업계획서 도우미

### 무엇을 해 주나요

| 단계 | 사장님이 하는 일 | 도우미가 하는 일 |
|---|---|---|
| ① 공고 올리기 | 공고문·양식·평가표 파일(HWP·HWPX·PDF·DOCX·사진)을 올리거나 붙여넣기 | 최근 공고 목록에서 고르고 첨부파일을 불러올 수도 있음 |
| ② 공고 분석 | 확인만 | 지원금·자부담·마감, **평가항목과 배점**, **양식 목차**, 자격·제외 대상, 제출서류 정리 |
| ③ 가게 정보 | 아는 만큼 입력 (모르면 비워둠) | — |
| ④ 자격·질문 | 추가 질문에 답하기 | 업력·근로자·매출·지역을 **계산으로 자동 판정**, 가점 기회, 점수에 필요한 질문, 사업명·핵심 메시지 제안 |
| ⑤ 초안 작성 | "AI로 전체 초안 작성" 클릭, 필요하면 직접 고치기 | 평가항목 **배점에 비례해 분량 배분**, 양식 목차 그대로 작성, 사업비 합계·자부담·한도 **자동 검증** |
| ⑥ 모의 심사 | "이대로 보완하기" 클릭 | 공고의 평가표로 항목별 채점, 약점·개선안·탈락 위험 알려줌 |
| ⑦ 완성 | 내려받기, 서류 체크 | 양식 글꼴·크기를 맞춘 Word(.docx), 표 모양 그대로 복사, 남은 [확인 필요] 목록 |

> AI는 입력하지 않은 매출·실적·인증을 지어내지 않고 **[확인 필요]** 로 표시합니다. 제출 전에 사실대로 채워 주세요.

### 바로 해보기 (내 컴퓨터)

Node.js 18 이상이 필요합니다.

```bash
npm install

# 1) 키 없이 화면 흐름만 체험 (예시 응답)
npm run demo

# 2) 실제 AI로 작성 — .env 에 ANTHROPIC_API_KEY 를 넣고
cp .env.example .env
npm run dev
```

브라우저에서 http://localhost:3000 → **예시 공고로 체험하기**를 누르면 가상 공고로 전체 과정을 해볼 수 있습니다.

### Vercel에 배포하기

1. [vercel.com](https://vercel.com) → **Add New… → Project** → 이 GitHub 저장소(`biz`) 선택
2. Framework Preset은 **Other** 그대로 두세요 (`vercel.json`이 설정을 담고 있습니다)
3. **Environment Variables**에 아래 값을 등록
4. **Deploy** → 나온 주소로 접속

| 환경변수 | 필수 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API 키 ([console.anthropic.com](https://console.anthropic.com)). 서버에만 저장되고 브라우저에 노출되지 않습니다 |
| `ACCESS_CODE` | 권장 | 설정하면 이 코드를 아는 사람만 AI 기능을 씁니다 (API 비용 보호). 화면에서 처음 한 번 입력 |
| `CLAUDE_MODEL` | | 기본 `claude-opus-5` |
| `CLAUDE_EFFORT` | | `low`·`medium`·`high`(기본). 낮추면 빠르고 저렴하지만 품질이 떨어질 수 있음 |
| `ALLOWED_ORIGINS` | | 다른 사이트(예: sosang-helper)에서 이 API를 부를 때 그 주소 |
| `RATE_LIMIT_PER_HOUR` | | IP당 시간당 AI 호출 한도 (기본 60) |

- 공고 분석은 문서 양에 따라 1~3분 걸립니다. `vercel.json`에서 함수 최대 실행 시간을 300초로 잡아 두었습니다. 배포 때 `maxDuration` 오류가 나면 Vercel 프로젝트 설정에서 **Fluid Compute**가 켜져 있는지 확인하세요.
- 1건(분석~심사)에 대략 1~2달러의 API 비용이 드는 것으로 추정합니다. 자세한 내용은 [설계서 7장](docs/DESIGN.md#7-보안비용)을 보세요.

### 공고 목록 자동 갱신 (선택)

화면의 **최근 공고에서 고르기** 목록은 `.github/workflows/announcements.yml`이 하루 두 번 기업마당에서 가져와 `public/data/announcements.json`에 커밋합니다 (Vercel이 자동 재배포).

- 필요한 Secret은 아래 2부의 `BIZINFO_API_KEY` 하나입니다 (이미 등록했다면 추가 설정 없음).
- GitHub → **Actions → 공고 목록 갱신 (사업계획서 도우미) → Run workflow**로 바로 실행해 볼 수 있습니다.
- 지역은 `ANNOUNCE_REGIONS`(기본 `서울,경기,전국`)로 바꿀 수 있습니다.

### 테스트

```bash
npm test                                            # 문서 추출·규칙·API 흐름 (데모 모드)
python -m unittest discover -s tests -p "test_*.py" # 공고 목록 변환
```

---

## 2. 기업마당 → Notion 지원사업 공고 자동 수집기

bizinfo.go.kr(기업마당)에서 당일 등록된 서울·경기 지역 지원사업 공고를 Notion 데이터베이스에 자동으로 저장합니다.

---

### 준비물

- Python 3.8 이상
- bizinfo.go.kr API 키
- Notion Integration Token
- Notion 데이터베이스

---

### 1단계: bizinfo API 키 발급

1. [bizinfo.go.kr](https://www.bizinfo.go.kr) 접속 후 회원가입 및 로그인
2. 상단 메뉴 **활용정보 → 정책정보 개방** 클릭
3. **지원사업정보 API** 의 사용신청 버튼 클릭
4. 양식 작성 후 제출 (승인까지 소요시간 있을 수 있음)
5. 승인 완료 후 마이페이지에서 **API 키** 복사

---

### 2단계: Notion Integration 생성

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) 접속
2. **New integration** 클릭
3. 이름 입력 후 저장
4. **Internal Integration Token** 복사 (`secret_xxx...` 형태 or `ntn_xxx...`)

---

### 3단계: Notion 데이터베이스 준비

#### 3-1. 데이터베이스 속성 추가

Notion에서 사용할 데이터베이스에 아래 속성을 추가합니다.

| 속성명 | 타입 |
|---|---|
| 제목 | 제목 (기본값) |
| 지역 | 선택 |
| 공고기관 | 텍스트 |
| 공고ID | 텍스트 |
| 등록일 | 날짜 |
| 접수마감일 | 텍스트 (날짜·문자 혼합: "2026-03-19", "예산 소진시까지", "상시 접수" 등) |
| 공고URL | URL |
| 지원분야 | 다중 선택 |

#### 3-2. Integration 연결

1. Notion 데이터베이스 페이지 우측 상단 **`···`** 클릭
2. **연결(Connections)** → 2단계에서 만든 Integration 검색 후 연결

#### 3-3. 데이터베이스 ID 확인

데이터베이스 URL에서 ID를 복사합니다.

```
https://www.notion.so/3148d1f64171805f85b1da16d13bafcc?v=xxx
                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                       이 부분이 DB ID
```

---

### 4단계: 프로젝트 설정

#### 4-1. 가상환경 생성 및 활성화

```bash
# 프로젝트 폴더로 이동
cd 프로젝트_폴더_경로

# 가상환경 생성
python -m venv venv

# 가상환경 활성화
# Mac / Linux
source venv/bin/activate

# Windows
venv\Scripts\activate
```

활성화되면 터미널 앞에 `(venv)` 가 붙습니다.

#### 4-2. 라이브러리 설치

```bash
pip install -r requirements.txt
```

#### 4-3. .env 파일 작성

`.env` 파일을 열고 아래 세 가지 값을 채웁니다.

```
BIZINFO_API_KEY=발급받은_API_키
NOTION_TOKEN=secret_xxx...
NOTION_DB_ID=3148d1f64171805f85b1da16d13bafcc
```

---

### 5단계: API 응답 필드 확인 (최초 1회)

`main.py` 안의 아래 주석을 **일시적으로 해제**하고 실행합니다.

```python
# import json; print(json.dumps(data, ensure_ascii=False, indent=2))
```

출력된 JSON을 보고 실제 필드명(`title`, `pblancNm` 등)을 확인한 뒤,
`main.py`의 필드명 매핑 부분을 실제 응답에 맞게 수정합니다.

확인이 끝나면 다시 주석 처리합니다.

---

### 6단계: 실행

```bash
python main.py
```

정상 실행 시 아래와 같이 출력됩니다.

```
[2026-02-27] 지원사업 공고 수집 시작
당일 공고 총 12건 발견
  [OK] 20260227_서울 청년창업 지원사업
  [OK] 20260227_경기 소상공인 특별지원
  [SKIP] 중복: 이미 등록된 공고
  ...
완료 — 생성: 11건 / 중복 건너뜀: 1건
```

---

### 7단계: 자동화 (매일 자동 실행)

#### 방법 A: 로컬 cron (Mac/Linux)

```bash
crontab -e
```

아래 내용 추가 (매일 오전 9시 실행):

```
0 9 * * * /프로젝트경로/venv/bin/python /프로젝트경로/main.py >> /프로젝트경로/run.log 2>&1
```

#### 방법 B: GitHub Actions (무료, 서버 불필요 — 추천)

1. GitHub에 이 프로젝트를 private 레포지토리로 업로드
2. 레포 **Settings → Secrets and variables → Actions → Repository secrets → New repository secret ** 에서 아래 3개 등록

| Secret 이름 | 값 |
|---|---|
| `BIZINFO_API_KEY` | API 키 |
| `NOTION_TOKEN` | Integration Token |
| `NOTION_DB_ID` | 데이터베이스 ID |

3. `.github/workflows/daily.yml` 파일 생성

```yaml
name: 매일 공고 수집

on:
  schedule:
    - cron: '0 0 * * *'  # UTC 00:00 = KST 09:00
  workflow_dispatch:       # 수동 실행 버튼도 활성화

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: python main.py
        env:
          BIZINFO_API_KEY: ${{ secrets.BIZINFO_API_KEY }}
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DB_ID: ${{ secrets.NOTION_DB_ID }}
```

---

---

## 파일 구성

```
biz/
├── public/          # 사업계획서 도우미 화면 (Vercel 정적 배포)
├── api/             # 사업계획서 도우미 서버리스 함수 (Claude 호출)
├── lib/             # 문서 추출·자격 판정·사업비 검증·프롬프트 등
├── scripts/         # 공고 목록 JSON 만들기
├── tests/           # 테스트
├── docs/DESIGN.md   # 설계서
├── main.py          # 기업마당 → Notion 수집기
├── .env             # API 키 (절대 GitHub에 올리지 말 것)
├── .env.example     # 환경변수 예시
└── README.md        # 이 파일
```

> ⚠️ `.env` 파일은 반드시 `.gitignore`에 추가해서 GitHub에 올라가지 않도록 주의하세요.
> ```
> # .gitignore
> .env
> ```
