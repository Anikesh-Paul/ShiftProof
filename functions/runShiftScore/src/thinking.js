/**
 * Gemini thinking config per model.
 * 2.x: thinkingBudget 0. 3.x: MEDIUM (3.7 rejects MINIMAL with HTTP 400).
 * Extract passes "HIGH" and must not become thinking-off on 2.x.
 */
const { geminiProvider } = require("./geminiClient");

function isGemini2x(model) {
  const m = String(model || "").toLowerCase();
  return m.includes("2.5") || m.includes("2.0");
}

function thinkingConfigFor(model, level) {
  if (level === "HIGH") {
    if (isGemini2x(model)) {
      throw new Error(
        "Extract refuses Gemini 2.x — HIGH thinking cannot become thinking off",
      );
    }
    return { thinkingLevel: "HIGH" };
  }
  if (isGemini2x(model)) {
    return { thinkingBudget: 0 };
  }
  // MEDIUM is the 3.x default — enough judgment for Pass/Gap/Unclear.
  // MINIMAL 400s on 3.7; HIGH burns output tokens and Function time.
  return { thinkingLevel: "MEDIUM" };
}

/** Same Flash ladder as scoring. Thinking stays HIGH; never MEDIUM or 2.x. */
const EXTRACT_MODEL = "gemini-3.7-flash";

function extractCallPolicy() {
  return {
    model: EXTRACT_MODEL,
    thinkingConfig: thinkingConfigFor(EXTRACT_MODEL, "HIGH"),
    models: fallbackModels(EXTRACT_MODEL),
    allowThinkingDowngrade: false,
  };
}

/** Extract stays on 3.x so HIGH thinking never becomes thinking-off. */
const FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
/**
 * Studio scoring: lite first because 3.7 503s on that pool.
 * Vertex scoring: 3.7 first (validated locally); 3.6 then lite if 503/timeout.
 * Do not add 2.x: new AI Studio keys get 404 ("no longer available").
 */
const SCORING_MODELS_STUDIO = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
];
const SCORING_MODELS_VERTEX = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];

function fallbackModels(primary, extras) {
  const p = String(primary || "gemini-flash-latest");
  const list = extras || FALLBACK_MODELS;
  return [p, ...list.filter((m) => m !== p)];
}

function scoringModels(_primary, env) {
  const e = env || process.env;
  const dryRun = String(e.SHIFTPROOF_LOCAL_DRY_RUN || "").trim() === "1";
  const forced = String(e.GEMINI_FORCE_SCORING_MODEL || "").trim();
  // Local dry-run only — deployed Function has neither of these vars.
  if (dryRun && forced) return [forced];
  if (geminiProvider(e) === "vertex") return SCORING_MODELS_VERTEX.slice();
  return SCORING_MODELS_STUDIO.slice();
}

/**
 * After a retryable miss, switch model instead of waiting on the same one.
 * Scoring (MEDIUM): switch on 503 or timeout. Extract (HIGH): any retryable.
 */
function shouldSwitchGeminiModel({
  thinkingLevel,
  status,
  timedOut,
  hasNext,
  noAnswer,
}) {
  if (!hasNext) return false;
  if (thinkingLevel === "HIGH") return true;
  return status === 503 || Boolean(timedOut) || Boolean(noAnswer);
}

module.exports = {
  thinkingConfigFor,
  fallbackModels,
  scoringModels,
  shouldSwitchGeminiModel,
  extractCallPolicy,
};
