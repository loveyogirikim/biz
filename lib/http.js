/**
 * lib/http.js — api/*.js 공통 처리
 * ============================================================
 *  - CORS: 같은 도메인은 항상 허용, 외부 도메인은 ALLOWED_ORIGINS 에 있을 때만
 *          (예: sosang-helper 같은 다른 사이트에서 이 API를 호출할 때)
 *  - ACCESS_CODE: 설정하면 요청 헤더 x-access-code 가 같아야 AI 호출 허용
 *                 (유료 API 키를 아무나 쓰지 못하게 하는 간단한 잠금)
 *  - 호출 제한: IP당 시간당 RATE_LIMIT_PER_HOUR 회 (기본 60, 인스턴스별 best-effort)
 *  - NDJSON 스트리밍 응답 도우미
 * ============================================================
 */

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return req.body;
}

/** @returns {string|null|false} 허용 Origin / Origin 없음 / 차단 */
function resolveOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  let host;
  try {
    host = new URL(origin).host;
  } catch (e) {
    return false;
  }
  if (host === req.headers.host) return origin;
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (s) { return s.trim().replace(/\/+$/, ""); })
    .filter(Boolean);
  return allowed.includes(origin.replace(/\/+$/, "")) ? origin : false;
}

function sendError(res, status, message) {
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}

/* ── IP별 호출 제한 (서버리스 인스턴스마다 따로 세므로 대략적인 보호) ── */
const hits = new Map();

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return fwd.split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
}

function rateLimited(req) {
  const limit = Number(process.env.RATE_LIMIT_PER_HOUR || 60);
  if (!limit) return false;
  const now = Date.now();
  const ip = clientIp(req);
  const list = (hits.get(ip) || []).filter(function (t) { return now - t < 3600 * 1000; });
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > limit;
}

/**
 * 모든 AI 엔드포인트 앞단 공통 검사.
 * @returns {object|null} 요청 본문 — null 이면 이미 응답을 보낸 것
 */
function guard(req, res, opts) {
  opts = opts || {};
  const methods = opts.methods || ["POST"];
  const origin = resolveOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (origin === false) {
      res.status(403).end();
      return null;
    }
    res.setHeader("Access-Control-Allow-Methods", methods.concat("OPTIONS").join(", "));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return null;
  }
  res.setHeader("Cache-Control", "no-store");
  if (methods.indexOf(req.method) < 0) {
    res.setHeader("Allow", methods.concat("OPTIONS").join(", "));
    sendError(res, 405, methods.join("/") + " 요청만 허용됩니다.");
    return null;
  }
  if (origin === false) {
    sendError(res, 403, "허용되지 않은 도메인입니다. ALLOWED_ORIGINS 환경변수를 확인하세요.");
    return null;
  }
  if (opts.ai) {
    const code = process.env.ACCESS_CODE;
    if (code && req.headers["x-access-code"] !== code) {
      sendError(res, 401, "이용 코드가 필요합니다. 운영자에게 받은 코드를 입력해 주세요.");
      return null;
    }
    if (rateLimited(req)) {
      sendError(res, 429, "짧은 시간에 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      return null;
    }
  }
  return readBody(req);
}

/** NDJSON 스트림: 한 줄에 JSON 하나 — {t:"delta"|"thinking"|"done"|"error", ...} */
function ndjson(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  return {
    send: function (obj) {
      res.write(JSON.stringify(obj) + "\n");
    },
    end: function () {
      res.end();
    },
  };
}

module.exports = { readBody: readBody, resolveOrigin: resolveOrigin, guard: guard, sendError: sendError, ndjson: ndjson };
