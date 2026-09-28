/**
 * api/fetch-file.js — 기업마당 첨부파일 불러오기 (POST)
 * ============================================================
 * 요청 : { url }  — 기업마당(bizinfo.go.kr) 첨부파일 주소만 허용
 * 응답 : { name, data(base64), size }
 *
 * 브라우저는 다른 사이트 파일을 직접 받을 수 없어(CORS) 서버가 대신 받아옵니다.
 * 아무 주소나 받아오는 "열린 프록시"가 되지 않도록 도메인·크기·리다이렉트를 제한합니다.
 * ============================================================
 */
const { guard, sendError } = require("../lib/http");

const ALLOWED_HOST = /(^|\.)bizinfo\.go\.kr$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !ALLOWED_HOST.test(u.hostname)) return null;
  return u;
}

/** Content-Disposition 파일명 — filename*, 퍼센트 인코딩, UTF-8/EUC-KR 원시 바이트 모두 대응 */
function fileNameFrom(header, url) {
  const h = String(header || "");
  const star = h.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch (e) { /* 아래로 */ }
  }
  const plain = h.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) {
    const v = plain[1].trim();
    if (/%[0-9a-f]{2}/i.test(v)) {
      try { return decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { /* 아래로 */ }
    }
    const bytes = Buffer.from(v, "latin1");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder("euc-kr").decode(bytes);
    }
  }
  const last = decodeURIComponent(url.pathname.split("/").pop() || "");
  return last || "첨부파일";
}

module.exports = async function handler(req, res) {
  const body = guard(req, res, { ai: true });
  if (!body) return;

  let url = checkUrl(body.url);
  if (!url) return sendError(res, 400, "기업마당(bizinfo.go.kr) 첨부파일 주소만 불러올 수 있습니다.");

  try {
    let response;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "Mozilla/5.0 (sosang-plan)" },
      });
      if (response.status < 300 || response.status >= 400) break;
      url = checkUrl(new URL(response.headers.get("location") || "", url).toString());
      if (!url) return sendError(res, 400, "허용되지 않은 주소로 이동하는 파일입니다.");
    }
    if (!response.ok) return sendError(res, 502, "기업마당에서 파일을 받지 못했습니다(" + response.status + "). 직접 내려받아 올려 주세요.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return sendError(res, 413, "파일이 4MB보다 큽니다. 직접 내려받아 필요한 부분만 올려 주세요.");

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) return sendError(res, 413, "파일이 4MB보다 큽니다. 직접 내려받아 필요한 부분만 올려 주세요.");
    if (/text\/html/i.test(response.headers.get("content-type") || "")) {
      return sendError(res, 502, "파일 대신 웹페이지가 내려왔습니다. 공고 페이지에서 직접 내려받아 올려 주세요.");
    }

    res.status(200).json({
      name: fileNameFrom(response.headers.get("content-disposition"), url),
      data: buffer.toString("base64"),
      size: buffer.length,
    });
  } catch (err) {
    console.error("[api/fetch-file]", err && err.message);
    sendError(res, 502, "기업마당 파일을 불러오지 못했습니다. 공고 페이지에서 직접 내려받아 올려 주세요.");
  }
};

module.exports.fileNameFrom = fileNameFrom;
module.exports.checkUrl = checkUrl;
