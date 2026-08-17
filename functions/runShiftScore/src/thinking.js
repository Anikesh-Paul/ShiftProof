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

/** One HIGH attempt. No MEDIUM retry, no 2.x fallback, no thinking-off retry. */
function extractCallPolicy(model) {
  return {
    thinkingConfig: thinkingConfigFor(model, "HIGH"),
    maxAttempts: 1,
    allowModelFallback: false,
    allowThinkingDowngrade: false,
  };
}

/** Primary first, then lighter Flash models when the primary 503s. */
const FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];

function fallbackModels(primary) {
  const p = String(primary || "gemini-flash-latest");
  return [p, ...FALLBACK_MODELS.filter((m) => m !== p)];
}

module.exports = { thinkingConfigFor, fallbackModels, extractCallPolicy };
