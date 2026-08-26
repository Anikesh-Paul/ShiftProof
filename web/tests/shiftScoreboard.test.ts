import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyScoreboardToSummary,
  inboxFindingsFromShift,
  parseOpenFindings,
  scoreboardFromFindings,
  scoreboardFromShift,
  scoreboardWritePayload,
  serializeOpenFindings,
  shiftHasScoreboard,
} from "../src/lib/shiftScoreboard.ts";
import type { Shift } from "../src/types/shiftproof.ts";

test("scoreboardFromFindings counts and keeps only open ids", () => {
  const board = scoreboardFromFindings([
    { $id: "f1", itemId: "gloves_worn", status: "gap" },
    { $id: "f2", itemId: "handwash_station", status: "unclear" },
    { $id: "f3", itemId: "floor_clear", status: "pass" },
    { $id: "f4", itemId: "fridge_temp", status: "pass" },
  ]);
  assert.equal(board.gapCount, 1);
  assert.equal(board.unclearCount, 1);
  assert.equal(board.passCount, 2);
  assert.deepEqual(
    board.openFindings.map((row) => row.$id),
    ["f1", "f2"],
  );
});

test("open findings round-trip through the compact JSON", () => {
  const board = scoreboardFromFindings([
    { $id: "abc", itemId: "gloves_worn", status: "gap" },
    { $id: "def", itemId: "sink", status: "unclear" },
  ]);
  const payload = scoreboardWritePayload(board);
  assert.equal(payload.gapCount, 1);
  const parsed = parseOpenFindings(payload.openFindingsJson);
  assert.deepEqual(parsed, board.openFindings);
  const compact = serializeOpenFindings(board.openFindings);
  assert.ok(compact.length < 80);
});

test("shiftHasScoreboard is true only when openFindingsJson was written", () => {
  assert.equal(shiftHasScoreboard({}), false);
  assert.equal(shiftHasScoreboard({ gapCount: 0 }), false);
  assert.equal(shiftHasScoreboard({ openFindingsJson: "[]" }), true);
  assert.equal(shiftHasScoreboard({ gapCount: 3, openFindingsJson: "[]" }), true);
});

test("inboxFindingsFromShift hydrates assign/filter seeds without quotes", () => {
  const shift = {
    $id: "s1",
    $createdAt: "t",
    $updatedAt: "t",
    siteId: "demo",
    checklistId: "opening_fs",
    createdBy: "staff",
    status: "scored" as const,
    startedAt: "t",
    gapCount: 1,
    unclearCount: 1,
    passCount: 6,
    openFindingsJson: serializeOpenFindings([
      { $id: "f1", itemId: "gloves_worn", status: "gap" },
      { $id: "f2", itemId: "handwash_station", status: "unclear" },
    ]),
  } satisfies Shift;
  const rows = inboxFindingsFromShift(shift);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.$id, "f1");
  assert.equal(rows[0]?.itemId, "gloves_worn");
  assert.equal(rows[0]?.status, "gap");
  assert.equal(rows[0]?.quote, "");
  const board = scoreboardFromShift(shift);
  assert.equal(board.passCount, 6);
  assert.equal(board.gapCount, 1);
});

test("applyScoreboardToSummary fills Gap ids for assign and filter", () => {
  const shift = {
    $id: "s1",
    $createdAt: "t",
    $updatedAt: "t",
    siteId: "demo",
    checklistId: "opening_fs",
    createdBy: "staff",
    status: "scored" as const,
    startedAt: "t",
    gapCount: 1,
    unclearCount: 0,
    passCount: 7,
    openFindingsJson: serializeOpenFindings([
      { $id: "f1", itemId: "gloves_worn", status: "gap" },
    ]),
  } satisfies Shift;
  const next = applyScoreboardToSummary({
    shift,
    staffLabel: "Priya",
    gapCount: 0,
    unclearCount: 0,
    passCount: 0,
    findings: [],
  });
  assert.equal(next.gapCount, 1);
  assert.equal(next.findings[0]?.$id, "f1");
  assert.equal(next.findings[0]?.itemId, "gloves_worn");
});
