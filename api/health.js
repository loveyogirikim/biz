/**
 * api/health.js — 서버 상태 (GET)
 * 화면이 처음 열릴 때 데모 모드 여부·이용 코드 필요 여부를 확인합니다.
 */
const { guard } = require("../lib/http");
const llm = require("../lib/llm");

module.exports = async function handler(req, res) {
  if (!guard(req, res, { methods: ["GET"] })) return;
  const info = llm.info();
  res.status(200).json({
    ok: true,
    mode: info.mode,
    model: info.model,
    ready: info.mode === "demo" || info.hasKey,
    accessCodeRequired: !!process.env.ACCESS_CODE,
  });
};
