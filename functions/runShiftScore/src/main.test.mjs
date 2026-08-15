import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  extractJsonObject,
  isValidId,
  ID_PATTERN,
  clamp01,
  isRetryableModelOutputError,
  classifyGeminiError,
} = require("./main.js");

test("extracts JSON from a markdown fence", () => {
  const payload = extractJsonObject('```json\n{"items":[{"id":"gloves_worn"}]}\n```');
  assert.deepEqual(payload, { items: [{ id: "gloves_worn" }] });
});

test("truncated JSON is retryable", () => {
  let thrown;
  try {
    extractJsonObject('{"items":[{"id":"gloves_worn"');
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "expected extractJsonObject to throw");
  assert.equal(isRetryableModelOutputError(thrown), true);
});

test("junk ids are rejected", () => {
  assert.equal(ID_PATTERN.test("golden_gap_open"), true);
  assert.equal(isValidId("golden_gap_open"), true);
  assert.equal(isValidId("6a661669002e6d48db80"), true);
  assert.equal(isValidId(""), false);
  assert.equal(isValidId("!!!"), false);
  assert.equal(isValidId("has space"), false);
  assert.equal(isValidId("x".repeat(37)), false);
});

test("429 daily quota classifies as quota", () => {
  assert.equal(
    classifyGeminiError(429, "You exceeded your current quota: limit: 0 PerDay"),
    "quota",
  );
  assert.equal(classifyGeminiError(429, "rate limited, retry later"), "retryable");
  assert.equal(classifyGeminiError(400, "bad request"), "fatal");
});

test("clamp01 bounds confidence", () => {
  assert.equal(clamp01(0.91), 0.91);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01("nope"), 0);
});
