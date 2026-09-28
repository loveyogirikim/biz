/**
 * dev-server.js — 로컬 개발 서버 (Node.js 18+, 추가 설치 없이 실행)
 * ============================================================
 *   npm install          # 최초 1회 (AI·문서 라이브러리)
 *   npm run dev          # .env 의 ANTHROPIC_API_KEY 로 실제 AI 사용
 *   npm run demo         # 키 없이 데모 모드(예시 응답)로 화면 흐름 확인
 *   → http://localhost:3000
 *
 * public/ 의 정적 파일을 서빙하고, /api/<이름> 요청은 api/<이름>.js 로 넘겨
 * Vercel과 같은 방식(req, res)으로 실행합니다. 배포 시에는 쓰이지 않습니다.
 * ============================================================
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 8 * 1024 * 1024;

/* ── .env 로드 (dotenv 없이) ─────────────────────────────── */
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return false;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value; // 셸에서 지정한 값이 우선
  });
  return true;
}
const envLoaded = loadEnv();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* ── Vercel 함수 시그니처 흉내 (res.status().json()) ─────── */
function decorate(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (obj) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(name, req, res) {
  const file = path.join(ROOT, "api", name + ".js");
  if (!/^[a-z-]+$/.test(name) || !fs.existsSync(file)) {
    return decorate(res).status(404).json({ error: "없는 API: " + name });
  }
  /* 수정 즉시 반영되도록 api/·lib/ 모듈 캐시를 비웁니다 */
  Object.keys(require.cache).forEach(function (k) {
    if (k.startsWith(path.join(ROOT, "api")) || k.startsWith(path.join(ROOT, "lib"))) delete require.cache[k];
  });
  try {
    req.body = req.method === "GET" ? {} : await readBody(req);
    await require(file)(req, decorate(res));
  } catch (err) {
    console.error("[dev-server] /api/" + name + " 실패:", err);
    if (!res.headersSent) decorate(res).status(err.message === "too large" ? 413 : 500).json({ error: "개발 서버 내부 오류" });
    else res.end();
  }
}

function serveStatic(pathname, res) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC, safe);
  if (!filePath.startsWith(PUBLIC)) return decorate(res).status(403).json({ error: "Forbidden" });
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("404 Not Found: " + pathname);
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(function (req, res) {
  const pathname = new URL(req.url, "http://" + (req.headers.host || "localhost")).pathname;
  const m = pathname.match(/^\/api\/([^/]+)\/?$/);
  if (m) return handleApi(m[1], req, res);
  serveStatic(pathname === "/" ? "/index.html" : pathname, res);
});

if (Number(process.versions.node.split(".")[0]) < 18) {
  console.error("✗ Node.js 18 이상이 필요합니다. 현재: v" + process.versions.node);
  process.exit(1);
}

server.listen(PORT, function () {
  const demo = process.env.LLM_MODE === "fake";
  console.log("");
  console.log("  사업계획서 도우미 — 로컬 개발 서버");
  console.log("  ───────────────────────────────────────────");
  console.log("  주소      http://localhost:" + PORT);
  console.log("  .env      " + (envLoaded ? "로드됨" : "없음 (.env.example 참고)"));
  console.log("  AI        " + (demo ? "데모 모드 (예시 응답, 키 불필요)"
    : process.env.ANTHROPIC_API_KEY ? "Claude 사용 (" + (process.env.CLAUDE_MODEL || "claude-opus-5") + ")"
      : "키 없음 — npm run demo 로 데모 모드를 쓰거나 .env 에 ANTHROPIC_API_KEY 를 넣으세요"));
  console.log("  ───────────────────────────────────────────");
  console.log("  종료: Ctrl + C");
  console.log("");
});
