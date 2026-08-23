/**
 * Gemini thinking config per model.
 * 2.x: thinkingBudget 0. 3.x: MEDIUM (3.7 rejects MINIMAL with HTTP 400).
 * Extract passes "HIGH" and must not become thinking-off on 2.x.
 */
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
 * Scoring ladder is fixed (not GEMINI_MODEL):
 * lite answers; 3.6 is next; 3.7 is last because it 503s on scoring load.
 * Do not add 2.x: new AI Studio keys get 404 ("no longer available").
 */
const SCORING_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
];

function fallbackModels(primary, extras) {
  const p = String(primary || "gemini-flash-latest");
  const list = extras || FALLBACK_MODELS;
  return [p, ...list.filter((m) => m !== p)];
}

function scoringModels(_primary) {
  return SCORING_MODELS.slice();
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
