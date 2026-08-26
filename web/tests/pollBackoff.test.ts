import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextPollDelay,
  pollDelaySequence,
  POLL_INITIAL_MS,
} from "../src/lib/pollBackoff.ts";

test("first wait is the initial interval", () => {
  assert.equal(nextPollDelay(null), POLL_INITIAL_MS);
});

test("delays grow then cap", () => {
  const seq = pollDelaySequence(180_000);
  assert.ok(seq.length < 90, `expected far fewer than 90 polls, got ${seq.length}`);
  assert.ok(seq.length >= 16);
  assert.equal(seq[0], 2_000);
  assert.ok(seq.every((ms) => ms <= 12_000));
  assert.equal(seq[seq.length - 1], 12_000);
});
