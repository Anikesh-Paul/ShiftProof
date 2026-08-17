const { test } = require("node:test");
const assert = require("node:assert/strict");
const { thinkingConfigFor, fallbackModels, extractCallPolicy } = require(
  "./thinking",
);

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

test("extract is one HIGH attempt with no MEDIUM retry or 2.x fallback", () => {
  const policy = extractCallPolicy("gemini-flash-latest");
  assert.deepEqual(policy.thinkingConfig, { thinkingLevel: "HIGH" });
  assert.equal(policy.maxAttempts, 1);
  assert.equal(policy.allowModelFallback, false);
  assert.equal(policy.allowThinkingDowngrade, false);
});
