const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreboardFromFindings,
  scoreboardWritePayload,
} = require("./shiftScoreboard");

test("function scoreboard matches inbox compact shape", () => {
  const board = scoreboardFromFindings([
    { $id: "f1", itemId: "gloves_worn", status: "gap" },
    { $id: "f2", itemId: "sink", status: "pass" },
  ]);
  const payload = scoreboardWritePayload(board);
  assert.equal(payload.gapCount, 1);
  assert.equal(payload.passCount, 1);
  assert.equal(payload.unclearCount, 0);
  assert.equal(payload.openFindingsJson, JSON.stringify([["f1", "gloves_worn", 0]]));
});
