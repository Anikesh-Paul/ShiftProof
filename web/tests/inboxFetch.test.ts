import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INBOX_RECENCY_LIMIT,
  inboxRecencyTruncated,
  mergeRecencyWithEvidence,
  shiftHasListedPhoto,
} from "../src/lib/inboxFetch.ts";

function shift(
  id: string,
  photos: string | undefined,
): { $id: string; photoFileIds?: string } {
  return { $id: id, photoFileIds: photos };
}

test("recency cap is 50", () => {
  assert.equal(INBOX_RECENCY_LIMIT, 50);
});

test("inboxRecencyTruncated is true when total outruns the page", () => {
  assert.equal(inboxRecencyTruncated(51, 50), true);
  assert.equal(inboxRecencyTruncated(50, 50), false);
  assert.equal(inboxRecencyTruncated(8, 8), false);
});

test("mergeRecencyWithEvidence pins an older photo row the 50 dropped", () => {
  const recent = Array.from({ length: 50 }, (_, i) =>
    shift(`recent-${i}`, "[]"),
  );
  const photoGap = shift("6a833d900036a8f52d07", '["file-1","file-2"]');
  const noPhoto = shift("older-swarm", "[]");
  const merged = mergeRecencyWithEvidence(recent, [photoGap, noPhoto]);
  assert.equal(merged.length, 51);
  assert.equal(merged[50]?.$id, photoGap.$id);
  assert.ok(!merged.some((row) => row.$id === noPhoto.$id));
});

test("mergeRecencyWithEvidence drops duplicate ids already in recency", () => {
  const recent = [shift("same", '["a"]')];
  const merged = mergeRecencyWithEvidence(recent, [shift("same", '["a"]')]);
  assert.equal(merged.length, 1);
});

test("shiftHasListedPhoto ignores empty, dash, and invalid JSON", () => {
  assert.equal(shiftHasListedPhoto(shift("a", undefined)), false);
  assert.equal(shiftHasListedPhoto(shift("b", "[]")), false);
  assert.equal(shiftHasListedPhoto(shift("c", '["—"]')), false);
  assert.equal(shiftHasListedPhoto(shift("d", "not-json")), false);
  assert.equal(shiftHasListedPhoto(shift("e", '["file-1"]')), true);
});
