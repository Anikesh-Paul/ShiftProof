import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLiveEventsToInbox,
  applyLiveToInbox,
  applyLiveToTasks,
  countByStatus,
  parseManagerLiveEvent,
  repeatOffendersFromInbox,
} from "../src/lib/managerLive.ts";
import { resetRowCaches } from "../src/lib/rowCache.ts";
import type { ManagerShiftSummary } from "../src/lib/managerDemo.ts";
import type { Finding, Shift, Task } from "../src/types/shiftproof.ts";

function finding(
  shiftId: string,
  itemId: string,
  status: Finding["status"],
): Finding {
  return {
    $id: `f_${shiftId}_${itemId}`,
    $createdAt: "2026-08-18T20:30:00.000Z",
    $updatedAt: "2026-08-18T20:30:00.000Z",
    shiftId,
    itemId,
    status,
    clauseId: "FS-01",
    quote: "quote",
    confidence: 0.8,
    evidenceNote: "note",
    source: "ai",
  };
}

function summary(id: string, findings: Finding[]): ManagerShiftSummary {
  const submittedAt = "2026-08-18T20:30:00.000Z";
  const shift: Shift = {
    $id: id,
    $createdAt: submittedAt,
    $updatedAt: submittedAt,
    siteId: "demo",
    checklistId: "opening_fs",
    createdBy: "staff_1",
    status: "scored",
    photoFileIds: '["a"]',
    startedAt: submittedAt,
    submittedAt,
  };
  return {
    shift,
    staffLabel: "Priya",
    findings,
    ...countByStatus(findings),
  };
}

test("parseManagerLiveEvent reads tablesdb channel + action", () => {
  const parsed = parseManagerLiveEvent({
    events: [
      "databases.shiftproof.tables.findings.rows.f1.create",
    ],
    channels: ["tablesdb.shiftproof.tables.findings.rows"],
    payload: { $id: "f1", shiftId: "s1", status: "gap" },
  });
  assert.equal(parsed?.table, "findings");
  assert.equal(parsed?.action, "create");
});

test("finding create patches counts without needing a reload", () => {
  resetRowCaches();
  const items = [summary("s1", [finding("s1", "gloves", "unclear")])];
  const parsed = parseManagerLiveEvent({
    events: ["tables.findings.rows.f_s1_sink.create"],
    payload: finding("s1", "sink", "gap"),
  });
  assert.ok(parsed);
  const next = applyLiveToInbox(items, parsed);
  assert.equal(next.needsReload, false);
  assert.equal(next.items[0]?.gapCount, 1);
  assert.equal(next.items[0]?.unclearCount, 1);
  assert.equal(next.items[0]?.findings.length, 2);
});

test("finding update recounts the same row", () => {
  resetRowCaches();
  const gap = finding("s1", "gloves", "gap");
  const items = [summary("s1", [gap])];
  const parsed = parseManagerLiveEvent({
    events: ["tables.findings.rows.f_s1_gloves.update"],
    payload: { ...gap, status: "pass" },
  });
  assert.ok(parsed);
  const next = applyLiveToInbox(items, parsed);
  assert.equal(next.items[0]?.gapCount, 0);
  assert.equal(next.items[0]?.passCount, 1);
});

test("closing a shift drops it from the inbox locally", () => {
  const items = [summary("s1", [finding("s1", "gloves", "gap")])];
  const parsed = parseManagerLiveEvent({
    events: ["tables.shifts.rows.s1.update"],
    payload: { ...items[0]!.shift, status: "closed" },
  });
  assert.ok(parsed);
  const next = applyLiveToInbox(items, parsed);
  assert.equal(next.needsReload, false);
  assert.equal(next.items.length, 0);
});

test("a new submitted shift asks for one list reload", () => {
  const items = [summary("s1", [])];
  const parsed = parseManagerLiveEvent({
    events: ["tables.shifts.rows.s2.create"],
    payload: {
      $id: "s2",
      status: "submitted",
      createdBy: "staff_2",
    },
  });
  assert.ok(parsed);
  const next = applyLiveToInbox(items, parsed);
  assert.equal(next.needsReload, true);
  assert.equal(next.items.length, 1);
});

test("unrelated finding create for an unknown shift asks reload", () => {
  const items = [summary("s1", [])];
  const parsed = parseManagerLiveEvent({
    events: ["tables.findings.rows.fx.create"],
    payload: finding("other", "gloves", "gap"),
  });
  assert.ok(parsed);
  const next = applyLiveToInbox(items, parsed);
  assert.equal(next.needsReload, true);
});

test("applyLiveEventsToInbox collapses a scoring burst into one state", () => {
  resetRowCaches();
  const items = [summary("s1", [])];
  const events = ["a", "b", "c"].map((itemId) =>
    parseManagerLiveEvent({
      events: [`tables.findings.rows.${itemId}.create`],
      payload: finding("s1", itemId, "gap"),
    }),
  );
  const next = applyLiveEventsToInbox(
    items,
    events.filter((e): e is NonNullable<typeof e> => e != null),
  );
  assert.equal(next.items[0]?.gapCount, 3);
  assert.equal(next.needsReload, false);
});

test("done tasks drop from the open list", () => {
  const open: Task = {
    $id: "t1",
    $createdAt: "t",
    $updatedAt: "t",
    shiftId: "s1",
    findingId: "f1",
    title: "Fix: Gloves",
    status: "open",
    createdBy: "mgr",
    createdAt: "t",
  };
  const parsed = parseManagerLiveEvent({
    events: ["tables.tasks.rows.t1.update"],
    payload: { ...open, status: "done" },
  });
  assert.ok(parsed);
  assert.equal(applyLiveToTasks([open], parsed).length, 0);
});

test("repeatOffendersFromInbox uses already-loaded findings", () => {
  const a = summary("s1", [finding("s1", "gloves_worn", "gap")]);
  const b = summary("s2", [finding("s2", "gloves_worn", "gap")]);
  const rows = repeatOffendersFromInbox([a, b], 5);
  assert.equal(rows[0]?.itemId, "gloves_worn");
  assert.equal(rows[0]?.count, 2);
});
