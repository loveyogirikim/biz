"""scripts/export_announcements.py 변환 규칙 테스트 — python -m unittest discover tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import export_announcements as ex  # noqa: E402

TODAY = "2026-09-28"


def item(**kw):
    base = {
        "pblancId": "PBLN_1", "pblancNm": "2026년 마포구 소상공인 경영개선 지원", "jrsdInsttNm": "서울특별시 마포구",
        "reqstBeginEndDe": "2026-09-20 ~ 2026-10-15", "pblancUrl": "/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_1",
        "creatPnttm": "2026-09-20 10:00:00", "bsnsSumryCn": "<p>소상공인 &amp; 자영업자 지원</p>",
        "flpthNm": "/cmm/fms/a.do?id=1@/cmm/fms/a.do?id=2", "fileNm": "공고문.hwp@양식.hwpx",
        "printFlpthNm": "/cmm/fms/p.do?id=9", "printFileNm": "본문.pdf",
    }
    base.update(kw)
    return base


class ExportTest(unittest.TestCase):
    def test_normalize(self):
        a = ex.normalize(item(), TODAY)
        self.assertEqual(a["region"], "서울")
        self.assertEqual(a["deadline"], "2026-10-15")
        self.assertTrue(a["url"].startswith("https://www.bizinfo.go.kr/"))
        self.assertEqual(a["summary"], "소상공인 & 자영업자 지원")
        self.assertTrue(a["sosang"])
        self.assertEqual([f["name"] for f in a["files"]], ["본문.pdf", "공고문.hwp", "양식.hwpx"])

    def test_closed_and_open_ended(self):
        self.assertIsNone(ex.normalize(item(reqstBeginEndDe="2026-08-01 ~ 2026-09-01"), TODAY))
        self.assertIsNotNone(ex.normalize(item(reqstBeginEndDe="예산 소진시까지"), TODAY))

    def test_regions_and_sort(self):
        raw = [
            item(pblancId="A", pblancNm="수출 지원", jrsdInsttNm="부산광역시"),
            item(pblancId="B", pblancNm="R&D 과제", jrsdInsttNm="경기도", reqstBeginEndDe="2026-10-01 ~ 2026-10-02", bsnsSumryCn="기술개발 과제 지원"),
            item(pblancId="C", jrsdInsttNm="소상공인시장진흥공단", reqstBeginEndDe="2026-10-30 ~ 2026-11-30"),
            item(pblancId="D"),
            item(pblancId="D"),
        ]
        out = ex.build(raw, ["서울", "경기", "전국"], TODAY)
        self.assertEqual([a["id"] for a in out], ["D", "C", "B"])
        self.assertEqual(len(ex.build(raw, ["전체"], TODAY)), 4)


if __name__ == "__main__":
    unittest.main()
