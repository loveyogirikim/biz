/**
 * lib/llm.js — Claude API 호출 (서버에서만 실행)
 * ============================================================
 *   generateJSON() : 구조화 출력(JSON Schema) — 공고 분석, 작성 준비, 사업비, 모의 심사
 *   streamText()   : 스트리밍 텍스트 — 섹션 본문 작성·보완
 *
 * 환경변수
 *   ANTHROPIC_API_KEY  (필수) Claude API 키 — Vercel 환경변수에만 저장
 *   CLAUDE_MODEL       (선택) 기본 claude-opus-5
 *   CLAUDE_EFFORT      (선택) low | medium | high(기본) | xhigh | max
 *   LLM_MODE=fake      (선택) 키 없이 화면 흐름을 시험하는 데모 모드
 *
 * 비용을 줄이는 장치
 *   - 공고 분석·가게 정보 등 섹션 작성 동안 변하지 않는 부분에 프롬프트 캐시를 걸어
 *     섹션을 연달아 쓸 때 입력 토큰을 재사용합니다.
 * ============================================================
 */
const { Anthropic } = require("@anthropic-ai/sdk");
const prompts = require("./prompts");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const EFFORT = process.env.CLAUDE_EFFORT || "high";

class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

function isFake() {
  return process.env.LLM_MODE === "fake";
}

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new LlmError("서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. (.env 또는 Vercel 환경변수)", 500);
    }
    /* 분석 한 번에 1~3분 걸릴 수 있어 넉넉히 — Vercel 함수 제한(maxDuration)보다 짧게 */
    client = new Anthropic({ timeout: 280 * 1000, maxRetries: 1 });
  }
  return client;
}

/* Haiku 4.5 는 adaptive thinking·effort 를 지원하지 않습니다 */
function supportsAdaptive(model) {
  return !/haiku/.test(model);
}
/* 거절(refusal) 시 서버가 다른 모델로 이어서 처리하도록 — Opus 5 / Fable 계열 */
function supportsFallback(model) {
  return /^claude-(opus-5|fable-5)/.test(model);
}

function buildParams(o) {
  const params = {
    model: MODEL,
    max_tokens: o.maxTokens || 16000,
    system: prompts.SYSTEM,
    messages: o.messages,
  };
  const outputConfig = {};
  if (supportsAdaptive(MODEL)) {
    params.thinking = { type: "adaptive" };
    outputConfig.effort = o.effort || EFFORT;
  }
  if (o.schema) outputConfig.format = { type: "json_schema", schema: o.schema };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;
  if (supportsFallback(MODEL)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

/** 캐시할 공통 맥락 + 호출별 작업 지시로 user 메시지를 만듭니다 */
function contextMessage(contextText, taskText) {
  return [{
    role: "user",
    content: [
      { type: "text", text: contextText, cache_control: { type: "ephemeral" } },
      { type: "text", text: taskText },
    ],
  }];
}

function finalText(message) {
  return message.content
    .filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; })
    .join("");
}

function checkStop(message) {
  if (message.stop_reason === "refusal") {
    throw new LlmError("AI가 이 요청을 처리하지 않았습니다. 내용을 조금 바꿔 다시 시도해 주세요.", 422);
  }
}

function translateError(err) {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("Claude API 키가 올바르지 않습니다.", 500);
  if (err instanceof Anthropic.RateLimitError) return new LlmError("요청이 몰려 잠시 제한되었습니다. 1분 뒤 다시 시도해 주세요.", 429);
  if (err instanceof Anthropic.BadRequestError) {
    console.error("[llm] BadRequest:", err.message);
    return new LlmError("AI 요청 형식 오류입니다. 문서가 너무 크거나 손상되었을 수 있습니다.", 400);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
  if (err instanceof Anthropic.APIError) {
    console.error("[llm] API error", err.status, err.message);
    return new LlmError("AI 서비스 오류(" + (err.status || "연결") + ")입니다. 잠시 후 다시 시도해 주세요.", 502);
  }
  console.error("[llm] unexpected", err);
  return new LlmError("AI 처리 중 알 수 없는 오류가 발생했습니다.", 500);
}

/**
 * 구조화 출력 — 응답을 JSON 객체로 돌려줍니다.
 * @param {object} o { task, messages, schema, maxTokens?, effort?, fakeData? }
 */
async function generateJSON(o) {
  if (isFake()) return require("./llm-fake").generateJSON(o);
  try {
    /* 큰 출력도 HTTP 타임아웃 없이 받도록 스트리밍으로 요청하고 최종 메시지만 사용 */
    const stream = getClient().beta.messages.stream(buildParams(o));
    const message = await stream.finalMessage();
    checkStop(message);
    if (message.stop_reason === "max_tokens") {
      throw new LlmError("AI 응답이 너무 길어 잘렸습니다. 문서를 나눠서 다시 시도해 주세요.", 413);
    }
    logUsage(o.task, message);
    return JSON.parse(finalText(message));
  } catch (err) {
    if (err instanceof SyntaxError) throw new LlmError("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
    throw translateError(err);
  }
}

/**
 * 스트리밍 텍스트 — onEvent({t:"thinking"}) / onEvent({t:"delta", v}) 를 호출하고
 * 최종 본문(fallback 전환 등을 반영한 확정본)을 돌려줍니다.
 */
async function streamText(o, onEvent) {
  if (isFake()) return require("./llm-fake").streamText(o, onEvent);
  try {
    const stream = getClient().beta.messages.stream(buildParams(o));
    let announcedThinking = false;
    stream.on("thinking", function () {
      if (!announcedThinking) {
        announcedThinking = true;
        onEvent({ t: "thinking" });
      }
    });
    stream.on("text", function (delta) {
      onEvent({ t: "delta", v: delta });
    });
    const message = await stream.finalMessage();
    checkStop(message);
    logUsage(o.task, message);
    return { text: finalText(message).trim(), truncated: message.stop_reason === "max_tokens" };
  } catch (err) {
    throw translateError(err);
  }
}

function logUsage(task, message) {
  const u = message.usage || {};
  console.log("[llm] " + task + " model=" + message.model +
    " in=" + (u.input_tokens || 0) + " cache_read=" + (u.cache_read_input_tokens || 0) +
    " cache_write=" + (u.cache_creation_input_tokens || 0) + " out=" + (u.output_tokens || 0));
}

function info() {
  return { mode: isFake() ? "demo" : "live", model: isFake() ? "demo" : MODEL, hasKey: !!process.env.ANTHROPIC_API_KEY };
}

module.exports = {
  generateJSON: generateJSON,
  streamText: streamText,
  contextMessage: contextMessage,
  buildParams: buildParams,
  LlmError: LlmError,
  info: info,
};
