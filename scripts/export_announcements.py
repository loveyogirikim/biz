"""
export_announcements.py — 기업마당 공고 → public/data/announcements.json
============================================================
사업계획서 도우미 화면의 "최근 공고에서 고르기" 목록을 만듭니다.
GitHub Actions(announcements.yml)가 매일 실행해 JSON을 커밋하면,
Vercel이 push를 감지해 자동으로 재배포합니다.

main.py(Notion 수집기)와 같은 기업마당 API 키를 씁니다.
  BIZINFO_API_KEY   (필수)
  ANNOUNCE_REGIONS  (선택) 쉼표 구분. 기본 "서울,경기,전국"
                    "전국" = 중소벤처기업부·소상공인시장진흥공단 등 전국 대상 기관
                    "전체" = 지역 구분 없이 모두
  ANNOUNCE_PAGES    (선택) 100건 단위로 몇 페이지 읽을지. 기본 3
============================================================
"""
import html
import json
import os
import re
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
SITE = "https://www.bizinfo.go.kr"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "data", "announcements.json")
KST = timezone(timedelta(hours=9))

NATIONAL_AGENCIES = ("중소벤처기업부", "소상공인시장진흥공단", "창업진흥원", "중소기업기술정보진흥원", "중소벤처기업진흥공단")
SOSANG_KEYWORDS = ("소상공인", "자영업", "전통시장", "골목", "상점", "상인", "점포", "가게", "착한가격", "희망리턴")
OPEN_ENDED = ("상시", "예산", "소진", "선착순", "별도", "추후")


def region_of(agency):
    """공고기관 이름으로 지역 판별 (main.py 와 같은 기준 + 전국 기관)"""
    if "서울" in agency:
        return "서울"
    if "경기도" in agency or agency.startswith("경기"):
        return "경기"
    if any(n in agency for n in NATIONAL_AGENCIES):
        return "전국"
    return "기타"


def absolute(url):
    url = (url or "").strip()
    if url.startswith("/"):
        return SITE + url
    return url


def strip_html(text, limit=300):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def split_multi(value):
    """첨부파일 경로·이름은 여러 개일 때 '@' 로 이어져 옵니다"""
    return [v.strip() for v in (value or "").split("@") if v.strip()]


def attachments(item):
    files = []
    for path_key, name_key in (("printFlpthNm", "printFileNm"), ("flpthNm", "fileNm")):
        paths = split_multi(item.get(path_key))
        names = split_multi(item.get(name_key))
        for i, p in enumerate(paths):
            url = absolute(p)
            if not url or any(f["url"] == url for f in files):
                continue
            name = names[i] if i < len(names) else url.rsplit("/", 1)[-1]
            files.append({"name": name, "url": url})
    return files


def parse_deadline(period):
    """'2026-02-13 ~ 2026-03-19' → '2026-03-19', 날짜가 아니면 ''"""
    end = (period or "").split("~")[-1].strip()
    m = re.match(r"^(\d{4})[-.](\d{1,2})[-.](\d{1,2})", end)
    if not m:
        return ""
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))


def is_open(period, deadline, today):
    if deadline:
        return deadline >= today
    return any(k in (period or "") for k in OPEN_ENDED) or not period


def normalize(item, today):
    """API 응답 한 건 → 화면용 공고 (마감된 공고·대상 지역 밖이면 None)"""
    title = (item.get("pblancNm") or "").strip()
    pblanc_id = (item.get("pblancId") or "").strip()
    if not title or not pblanc_id:
        return None
    agency = (item.get("jrsdInsttNm") or "").strip()
    period = (item.get("reqstBeginEndDe") or "").strip()
    deadline = parse_deadline(period)
    if not is_open(period, deadline, today):
        return None
    target = strip_html(item.get("trgetNm"), 120)
    summary = strip_html(item.get("bsnsSumryCn"))
    hay = " ".join([title, target, summary, item.get("hashtags") or ""])
    return {
        "id": pblanc_id,
        "title": title,
        "agency": agency,
        "exec_agency": (item.get("excInsttNm") or "").strip(),
        "region": region_of(agency),
        "category": (item.get("pldirSportRealmLclasCodeNm") or "").strip(),
        "period": period,
        "deadline": deadline,
        "registered": (item.get("creatPnttm") or "")[:10],
        "url": absolute(item.get("pblancUrl")),
        "target": target,
        "summary": summary,
        "files": attachments(item),
        "sosang": any(k in hay for k in SOSANG_KEYWORDS),
    }


def fetch_items(api_key, pages):
    items = []
    for page in range(1, pages + 1):
        params = {"crtfcKey": api_key, "dataType": "json", "pageIndex": page, "pageUnit": 100}
        res = requests.get(BASE_URL, params=params, timeout=20)
        res.raise_for_status()
        data = res.json()
        rows = data.get("jsonArray", data.get("items", []))
        if isinstance(rows, dict):
            rows = [rows]
        if not rows:
            break
        items.extend(rows)
    return items


def build(raw_items, regions, today):
    seen = set()
    out = []
    for item in raw_items:
        a = normalize(item, today)
        if not a or a["id"] in seen:
            continue
        if "전체" not in regions and a["region"] not in regions:
            continue
        seen.add(a["id"])
        out.append(a)
    # 소상공인 관련 → 마감 임박 순 (상시 공고는 뒤로)
    out.sort(key=lambda a: (not a["sosang"], a["deadline"] or "9999-99-99"))
    return out


def main():
    api_key = os.getenv("BIZINFO_API_KEY")
    if not api_key:
        raise SystemExit("BIZINFO_API_KEY 환경변수가 없습니다.")
    regions = [r.strip() for r in os.getenv("ANNOUNCE_REGIONS", "서울,경기,전국").split(",") if r.strip()]
    pages = int(os.getenv("ANNOUNCE_PAGES", "3"))
    now = datetime.now(KST)

    items = build(fetch_items(api_key, pages), regions, now.strftime("%Y-%m-%d"))
    payload = {"updated_at": now.strftime("%Y-%m-%d %H:%M"), "regions": regions, "items": items}

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print("공고 %d건 저장 (소상공인 관련 %d건) → %s" % (len(items), sum(a["sosang"] for a in items), os.path.normpath(OUT_PATH)))


if __name__ == "__main__":
    main()
