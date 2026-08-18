import assert from "node:assert/strict";
import { test } from "node:test";
import { confidenceBand } from "../src/lib/confidence.ts";

test("0.42 is Low", () => {
  assert.equal(confidenceBand(0.42), "Low");
});

test("0.80 is High", () => {
  assert.equal(confidenceBand(0.80), "High");
});

test("0.72 is Medium", () => {
  assert.equal(confidenceBand(0.72), "Medium");
});

test("0.91 is High", () => {
  assert.equal(confidenceBand(0.91), "High");
});
