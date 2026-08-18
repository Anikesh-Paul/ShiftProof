import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupOpenFixesByItem,
  openFixItemRef,
} from "../src/lib/openFixGroups.ts";
import type { ManagerShiftSummary } from "../src/lib/managerDemo.ts";
import type { Finding, Shift, Task } from "../src/types/shiftproof.ts";

function task(opts: {
  id: string;
  title: string;
  findingId?: string;
  shiftId?: string;
  createdAt?: string;
}): Task {
  const at = opts.createdAt ?? "2026-08-18T20:30:00.000Z";
  return {
    $id: opts.id,
    $createdAt: at,
    $updatedAt: at,
    shiftId: opts.shiftId ?? "s1",
    findingId: opts.findingId ?? `f_${opts.id}`,
    title: opts.title,
    status: "open",
    createdBy: "mgr",
    createdAt: at,
  };
}

function summary(opts: {
  shiftId: string;
  findingId: string;
  itemId: string;
}): ManagerShiftSummary {
  const at = "2026-08-18T20:30:00.000Z";
  const shift: Shift = {
    $id: opts.shiftId,
    $createdAt: at,
    $updatedAt: at,
    siteId: "demo",
    checklistId: "opening_fs",
    createdBy: "staff_priya",
    status: "scored",
    photoFileIds: '["p1"]',
    startedAt: at,
    submittedAt: at,
  };
  const finding: Finding = {
    $id: opts.findingId,
    $createdAt: at,
    $updatedAt: at,
    shiftId: opts.shiftId,
    itemId: opts.itemId,
    status: "gap",
    clauseId: "FS-01",
    quote: "",
    confidence: 0.8,
    evidenceNote: "",
    source: "ai",
  };
  return {
    shift,
    staffLabel: "Priya",
    gapCount: 1,
    unclearCount: 0,
    passCount: 0,
    findings: [finding],
  };
}

test("openFixItemRef prefers the short item, not the stored task title", () => {
  const ref = openFixItemRef(
    { title: "E2e Assign Durability Alpha" },
    { itemId: "gloves_worn" },
  );
  assert.equal(ref.itemId, "gloves_worn");
  assert.equal(ref.label, "Gloves at prep");
});

test("groupOpenFixesByItem collapses title-case wobble into one item", () => {
  const groups = groupOpenFixesByItem(
    [
      task({ id: "a", title: "Fix: Gloves at prep" }),
      task({ id: "b", title: "Fix: Gloves At Prep" }),
      task({ id: "c", title: "Fix: Prep counter clean" }),
    ],
    [],
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.label, "Gloves at prep");
  assert.equal(groups[0]?.count, 2);
  assert.equal(groups[1]?.label, "Prep counter clean");
  assert.equal(groups[1]?.count, 1);
});

test("groupOpenFixesByItem ranks the swarm first and keeps newest task first", () => {
  const items = [
    summary({
      shiftId: "s-old",
      findingId: "f-old",
      itemId: "gloves_worn",
    }),
    summary({
      shiftId: "s-new",
      findingId: "f-new",
      itemId: "gloves_worn",
    }),
    summary({
      shiftId: "s-prep",
      findingId: "f-prep",
      itemId: "counter_clean",
    }),
  ];
  const groups = groupOpenFixesByItem(
    [
      task({
        id: "old",
        title: "Fix: Gloves At Prep",
        findingId: "f-old",
        shiftId: "s-old",
        createdAt: "2026-08-18T10:00:00.000Z",
      }),
      task({
        id: "prep",
        title: "Fix: Prep counter clean",
        findingId: "f-prep",
        shiftId: "s-prep",
        createdAt: "2026-08-18T22:00:00.000Z",
      }),
      task({
        id: "new",
        title: "Fix: Gloves at prep",
        findingId: "f-new",
        shiftId: "s-new",
        createdAt: "2026-08-18T21:00:00.000Z",
      }),
    ],
    items,
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.itemId, "gloves_worn");
  assert.equal(groups[0]?.label, "Gloves at prep");
  assert.equal(groups[0]?.count, 2);
  assert.equal(groups[0]?.tasks[0]?.$id, "new");
  assert.equal(groups[1]?.itemId, "counter_clean");
  assert.equal(groups[1]?.count, 1);
});
