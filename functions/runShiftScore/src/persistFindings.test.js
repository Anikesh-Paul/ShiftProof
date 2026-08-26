const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planFindingWrites } = require("./persistFindings");

function row(id, itemId, source = "ai") {
  return { $id: id, itemId, source };
}

test("first score creates every item", () => {
  const plan = planFindingWrites([], [
    { id: "gloves" },
    { id: "sink" },
  ]);
  assert.equal(plan.creates.length, 2);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test("re-score updates AI rows instead of delete+create", () => {
  const plan = planFindingWrites(
    [row("r1", "gloves"), row("r2", "sink")],
    [{ id: "gloves" }, { id: "sink" }],
  );
  assert.deepEqual(
    plan.updates.map((u) => u.rowId).sort(),
    ["r1", "r2"],
  );
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test("manager override is left in place", () => {
  const plan = planFindingWrites(
    [row("r1", "gloves", "manager_override"), row("r2", "sink")],
    [{ id: "gloves" }, { id: "sink" }],
  );
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowId, "r2");
  assert.equal(plan.creates.length, 0);
  assert.ok(!plan.deletes.some((d) => d.$id === "r1"));
});

test("dropped checklist item deletes the leftover AI row", () => {
  const plan = planFindingWrites(
    [row("r1", "gloves"), row("r2", "old_item")],
    [{ id: "gloves" }],
  );
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.deletes.length, 1);
  assert.equal(plan.deletes[0].$id, "r2");
});
