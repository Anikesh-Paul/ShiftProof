const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  thinkingConfigFor,
  fallbackModels,
  scoringModels,
  shouldSwitchGeminiModel,
  extractCallPolicy,
} = require("./thinking");

test("gemini-3.7-flash uses MEDIUM, not MINIMAL (API 400)", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.7-flash"), {
    thinkingLevel: "MEDIUM",
  });
});

test("gemini-flash-latest uses MEDIUM (alias now resolves to 3.7)", () => {
  assert.deepEqual(thinkingConfigFor("gemini-flash-latest"), {
    thinkingLevel: "MEDIUM",
  });
});

test("gemini-2.5-flash still disables thinking via budget", () => {
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash"), {
    thinkingBudget: 0,
  });
});

test("3.7 keeps primary first and has a lighter 503 fallback", () => {
  const models = fallbackModels("gemini-3.7-flash");
  assert.equal(models[0], "gemini-3.7-flash");
  assert.ok(models.includes("gemini-3.6-flash"));
});

test("scoring tries lite before the hanging 3.6", () => {
  const models = scoringModels("gemini-3.7-flash");
  assert.deepEqual(models, [
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
  ]);
  assert.ok(!models.some((m) => /2\.[05]/.test(m)));
});

test("scoring timeout must switch model (not retry the same one)", () => {
  assert.equal(
    shouldSwitchGeminiModel({
      thinkingLevel: "MEDIUM",
      status: undefined,
      timedOut: true,
      hasNext: true,
    }),
    true,
    "today's hang: 3.6 times out and we never reach lite",
  );
});

test("scoring empty answer must switch model", () => {
  assert.equal(
    shouldSwitchGeminiModel({
      thinkingLevel: "MEDIUM",
      status: undefined,
      timedOut: false,
      noAnswer: true,
      hasNext: true,
    }),
    true,
  );
});

test("scoring 503 still switches; last model does not", () => {
  assert.equal(
    shouldSwitchGeminiModel({
      thinkingLevel: "MEDIUM",
      status: 503,
      timedOut: false,
      hasNext: true,
    }),
    true,
  );
  assert.equal(
    shouldSwitchGeminiModel({
      thinkingLevel: "MEDIUM",
      status: undefined,
      timedOut: true,
      hasNext: false,
    }),
    false,
  );
});

test("extract asks HIGH on 3.x", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.7-flash", "HIGH"), {
    thinkingLevel: "HIGH",
  });
  assert.deepEqual(thinkingConfigFor("gemini-flash-latest", "HIGH"), {
    thinkingLevel: "HIGH",
  });
});

test("extract refuses 2.x so HIGH cannot become thinking off", () => {
  assert.throws(
    () => thinkingConfigFor("gemini-2.5-flash", "HIGH"),
    /2\.x|refuse/i,
  );
});

test("extract starts on 3.7 HIGH and falls back to 3.6 then 3.5-lite", () => {
  const policy = extractCallPolicy();
  assert.equal(policy.model, "gemini-3.7-flash");
  assert.deepEqual(policy.thinkingConfig, { thinkingLevel: "HIGH" });
  assert.deepEqual(policy.models, [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ]);
  assert.equal(policy.allowThinkingDowngrade, false);
});
