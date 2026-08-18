import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backlogInboxRank,
  sortBacklogClusters,
  sortBacklogInbox,
} from "../src/lib/inboxRank.ts";
import type { ManagerShiftSummary } from "../src/lib/managerDemo.ts";
import type { Finding, FindingStatus, Shift } from "../src/types/shiftproof.ts";

function finding(
  shiftId: string,
  itemId: string,
  status: FindingStatus,
  at: string,
): Finding {
  return {
    $id: `f_${shiftId}_${itemId}`,
    $createdAt: at,
    $updatedAt: at,
    shiftId,
    itemId,
    status,
    clauseId: "FS-01",
    quote: "",
    confidence: 0.8,
    evidenceNote: "",
    source: "ai",
  };
}

function row(opts: {
  id: string;
  photos?: string;
  gapCount: number;
  unclearCount?: number;
  submittedAt?: string;
  createdBy?: string;
  itemId?: string;
}): ManagerShiftSummary {
  const submittedAt = opts.submittedAt ?? "2026-08-18T20:30:00.000Z";
  const itemId = opts.itemId ?? "gloves_worn";
  const status: FindingStatus = opts.gapCount > 0 ? "gap" : "unclear";
  const shift: Shift = {
    $id: opts.id,
    $createdAt: submittedAt,
    $updatedAt: submittedAt,
    siteId: "demo",
    checklistId: "opening_fs",
    createdBy: opts.createdBy ?? "staff_priya",
    status: "scored",
    photoFileIds: opts.photos ?? "[]",
    startedAt: submittedAt,
    submittedAt,
  };
  return {
    shift,
    staffLabel: "Priya",
    gapCount: opts.gapCount,
    unclearCount: opts.unclearCount ?? 0,
    passCount: 0,
    findings: [finding(opts.id, itemId, status, submittedAt)],
  };
}

function cluster(
  members: ManagerShiftSummary[],
  representative = members[0],
) {
  if (!representative) throw new Error("empty cluster");
  const times = members
    .map((m) => m.shift.submittedAt || m.shift.startedAt)
    .filter(Boolean)
    .sort();
  return {
    row: representative,
    members,
    count: members.length,
    from: times[0] || "",
    to: times[times.length - 1] || "",
  };
}

test("backlogInboxRank puts photo + Gap above no-photo Gap", () => {
  const photoGap = row({
    id: "photo",
    photos: '["p1","p2"]',
    gapCount: 1,
  });
  const swarm = row({ id: "swarm", photos: "[]", gapCount: 1 });
  const photoUnclear = row({
    id: "photo-u",
    photos: '["p1"]',
    gapCount: 0,
    unclearCount: 1,
  });
  const noPhotoUnclear = row({
    id: "bare-u",
    photos: "[]",
    gapCount: 0,
    unclearCount: 1,
  });
  assert.equal(backlogInboxRank(photoGap), 0);
  assert.equal(backlogInboxRank(photoUnclear), 1);
  assert.equal(backlogInboxRank(swarm), 2);
  assert.equal(backlogInboxRank(noPhotoUnclear), 3);
  assert.ok(backlogInboxRank(photoGap) < backlogInboxRank(swarm));
});

test("sortBacklogInbox ranks photo + 8 Gap above a newer no-photo 1 Gap", () => {
  const swarm = row({
    id: "swarm",
    photos: "[]",
    gapCount: 1,
    submittedAt: "2026-08-18T23:00:00.000Z",
  });
  const photoBoard = row({
    id: "6a833d900036a8f52d07",
    photos: '["p1","p2","p3","p4","p5","p6","p7","p8"]',
    gapCount: 8,
    submittedAt: "2026-08-18T15:00:00.000Z",
  });
  const sorted = sortBacklogInbox([swarm, photoBoard]);
  assert.equal(sorted[0]?.shift.$id, "6a833d900036a8f52d07");
});

test("Backlog clusters put photo + N Gap above a newer no-photo swarm", () => {
  const swarm = Array.from({ length: 28 }, (_, i) =>
    row({
      id: `swarm_${i}`,
      photos: "[]",
      gapCount: 1,
      createdBy: "staff_priya",
      itemId: "gloves_worn",
      submittedAt: `2026-08-18T23:${String(i).padStart(2, "0")}:00.000Z`,
    }),
  );
  const photoBoard = row({
    id: "6a833d900036a8f52d07",
    photos: '["p1","p2","p3","p4","p5","p6","p7","p8"]',
    gapCount: 8,
    createdBy: "staff_meera",
    itemId: "fridge_temp",
    submittedAt: "2026-08-18T15:00:00.000Z",
  });
  const listed = sortBacklogClusters([
    cluster(swarm),
    cluster([photoBoard]),
  ]);
  assert.equal(listed[0]?.row.shift.$id, "6a833d900036a8f52d07");
  assert.equal(listed[0]?.count, 1);
  assert.equal(listed[1]?.count, 28);
  assert.equal(listed.length, 2);
});

test("each Backlog cluster still has one representative row", () => {
  const members = [
    row({
      id: "a",
      photos: "[]",
      gapCount: 1,
      submittedAt: "2026-08-18T22:00:00.000Z",
    }),
    row({
      id: "b",
      photos: '["p1"]',
      gapCount: 1,
      submittedAt: "2026-08-18T21:00:00.000Z",
    }),
  ];
  const [grouped] = sortBacklogClusters([cluster(members)]);
  assert.ok(grouped);
  assert.equal(grouped.count, 2);
  assert.equal(grouped.row.shift.$id, "b");
  assert.equal(grouped.members.length, 2);
});
