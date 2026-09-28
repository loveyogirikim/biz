/* API 통합 테스트 — 데모 모드(LLM_MODE=fake)로 전체 흐름: 분석 → 준비 → 작성 → 심사 → DOCX */
process.env.LLM_MODE = "fake";
process.env.RATE_LIMIT_PER_HOUR = "0";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { unzipSync, strFromU8 } = require("fflate");

const ROOT = path.join(__dirname, "..");
const handler = (name) => require(path.join(ROOT, "api", name + ".js"));

function mockRes() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    chunks,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.headersSent = true; return this; },
    write(s) { chunks.push(Buffer.from(s)); this.headersSent = true; },
    end(b) { if (b) chunks.push(Buffer.from(b)); },
    flushHeaders() {},
  };
}

async function call(name, body, extra) {
  const res = mockRes();
  await handler(name)(Object.assign({ method: "POST", headers: { host: "localhost" }, body }, extra || {}), res);
  return res;
}

function events(res) {
  return Buffer.concat(res.chunks).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
}

const profile = {
  business_name: "행복한 반찬가게", owner_name: "김사장", open_date: "2021-03-02", region_sido: "서울",
  region_sigungu: "한빛구", industry: "반찬", industry_group: "음식점업", employees: 2, annual_revenue_krw: 180000000,
};

test("전체 흐름 (데모 모드)", async () => {
  const text = fs.readFileSync(path.join(ROOT, "public/samples/sample-announcement.txt"));
  let r = await call("analyze", { files: [{ name: "공고.txt", data: text.toString("base64") }] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.sources[0].kind, "text");
  const { analysis, outline } = r.body;
  assert.equal(outline.length, 7);

  r = await call("prepare", { analysis, profile });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.eligibility.find((e) => e.id === "E6").decided_by === "ai");
  const prep = r.body;

  const sections = {};
  for (const s of [...outline].sort((a, b) => a.order - b.order)) {
    r = await call("write", { analysis, outline, profile, strategy: prep.strategy, questions: prep.questions, answers: {}, section_id: s.id, sections });
    assert.equal(r.headers["content-type"], "application/x-ndjson; charset=utf-8");
    const done = events(r).find((e) => e.t === "done");
    assert.ok(done && done.text.length > 50, s.id + " 작성됨");
    sections[s.id] = done.text;
    if (s.kind === "budget") assert.deepEqual(done.budget.issues, []);
  }
  assert.match(sections.S1, /총사업비 [\d,]+원/); // 일반현황이 사업비 금액을 가져옴

  r = await call("write", { analysis, outline, profile, section_id: "S2", sections, mode: "revise", instruction: "표 추가" });
  assert.match(events(r).find((e) => e.t === "done").text, /보완/);

  r = await call("review", { analysis, outline, profile, sections });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.score.max, 100);
  assert.ok(r.body.score.total > 0 && r.body.score.total <= 100);

  r = await call("export", { analysis, outline, profile, sections, strategy: prep.strategy, options: { include_notes: true } });
  assert.equal(r.statusCode, 200);
  const files = unzipSync(new Uint8Array(Buffer.concat(r.chunks)));
  const xml = strFromU8(files["word/document.xml"]);
  assert.match(xml, /사 업 계 획 서/);
  assert.match(xml, /2\. 사업장 현황 및 문제점/);
  assert.match(xml, /제출 서류 체크리스트/);
});

test("입력 검증과 오류 응답", async () => {
  let r = await call("analyze", {});
  assert.equal(r.statusCode, 400);
  r = await call("prepare", {});
  assert.equal(r.statusCode, 400);
  r = await call("analyze", { text: "x" }, { method: "GET" });
  assert.equal(r.statusCode, 405);
  r = await call("analyze", { files: [{ name: "a.bin", data: Buffer.from([0, 1, 2, 0, 0, 3]).toString("base64") }] });
  assert.equal(r.statusCode, 422);
});

test("CORS·이용 코드", async () => {
  let r = await call("prepare", {}, { headers: { host: "a.com", origin: "https://evil.com" } });
  assert.equal(r.statusCode, 403);
  process.env.ALLOWED_ORIGINS = "https://sosang-helper.vercel.app";
  r = await call("prepare", {}, { headers: { host: "a.com", origin: "https://sosang-helper.vercel.app" } });
  assert.equal(r.headers["access-control-allow-origin"], "https://sosang-helper.vercel.app");
  delete process.env.ALLOWED_ORIGINS;

  process.env.ACCESS_CODE = "secret";
  r = await call("prepare", {});
  assert.equal(r.statusCode, 401);
  r = await call("prepare", {}, { headers: { host: "localhost", "x-access-code": "secret" } });
  assert.equal(r.statusCode, 400); // 코드 통과 후 본문 검증
  delete process.env.ACCESS_CODE;
});

test("첨부파일 프록시는 기업마당 주소만 허용", async () => {
  const { checkUrl, fileNameFrom } = handler("fetch-file");
  assert.ok(checkUrl("https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=1"));
  assert.equal(checkUrl("https://bizinfo.go.kr.evil.com/x"), null);
  assert.equal(checkUrl("file:///etc/passwd"), null);
  assert.equal(checkUrl("http://169.254.169.254/"), null);
  const r = await call("fetch-file", { url: "https://example.com/a.hwp" });
  assert.equal(r.statusCode, 400);

  const u = new URL("https://www.bizinfo.go.kr/x/y.hwp");
  assert.equal(fileNameFrom("attachment; filename*=UTF-8''%EA%B3%B5%EA%B3%A0.hwp", u), "공고.hwp");
  assert.equal(fileNameFrom('attachment; filename="%EA%B3%B5%EA%B3%A0.pdf"', u), "공고.pdf");
  const eucKr = Buffer.from([0xb0, 0xf8, 0xb0, 0xed, 0x2e, 0x68, 0x77, 0x70]).toString("latin1"); // "공고.hwp"
  assert.equal(fileNameFrom('attachment; filename="' + eucKr + '"', u), "공고.hwp");
  assert.equal(fileNameFrom("", u), "y.hwp");
});
