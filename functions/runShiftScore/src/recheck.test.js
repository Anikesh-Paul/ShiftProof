const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runRecheck } = require("./recheck");

const LIVE_GLOVES = {
  id: "gloves_worn",
  label: "Gloves at the prep line",
  relatedClauseIds: ["FS-01"],
  quote: "Wear clean disposable gloves at the food-prep station.",
};

const LIVE_FLOOR = {
  id: "floor_clear",
  label: "Floor clear of slip hazards",
  relatedClauseIds: ["FS-07"],
  quote: "Service floor should be clear of slip hazards at open.",
};

function store() {
  const glovesFinding = {
    $id: "finding_gloves",
    shiftId: "shift_1",
    itemId: "gloves_worn",
    status: "gap",
    clauseId: "FS-01",
    quote: "Wear clean disposable gloves at the food-prep station.",
    confidence: 0.84,
    evidenceNote: "Bare hands at prep.",
    source: "manager_override",
    overrideReason: "Looked like a miss from here.",
    overriddenBy: "demo_manager",
    overriddenAt: "2026-08-17T08:00:00.000Z",
  };
  const floorFinding = {
    $id: "finding_floor",
    shiftId: "shift_1",
    itemId: "floor_clear",
    status: "gap",
    clauseId: "FS-07",
    quote: "Service floor should be clear of slip hazards at open.",
    confidence: 0.79,
    evidenceNote: "Wet patch by the pass.",
    source: "ai",
  };
  const data = {
    tasks: {
      task_gloves: {
        $id: "task_gloves",
        shiftId: "shift_1",
        findingId: "finding_gloves",
        status: "open",
        recheckFileId: "recheck_photo_1",
      },
    },
    findings: {
      finding_gloves: glovesFinding,
      finding_floor: floorFinding,
    },
    shifts: {
      shift_1: {
        $id: "shift_1",
        checklistId: "opening_fs",
        status: "scored",
        photoFileIds: JSON.stringify(["pool_a", "pool_b"]),
      },
    },
    checklists: {
      opening_fs: {
        $id: "opening_fs",
        itemsJson: JSON.stringify([LIVE_GLOVES, LIVE_FLOOR]),
      },
    },
    events: {},
    agent_jobs: {},
    _updates: [],
    _creates: [],
    _deletes: [],
  };

  const tables = {
    async getRow({ tableId, rowId }) {
      const row = data[tableId] && data[tableId][rowId];
      if (!row) throw new Error(`missing ${tableId}/${rowId}`);
      return { ...row };
    },
    async updateRow({ tableId, rowId, data: patch }) {
      data._updates.push({ tableId, rowId, data: patch });
      data[tableId][rowId] = { ...data[tableId][rowId], ...patch };
      return { ...data[tableId][rowId] };
    },
    async createRow({ tableId, rowId, data: row }) {
      data._creates.push({ tableId, rowId, data: row });
      data[tableId][rowId] = { $id: rowId, ...row };
      return data[tableId][rowId];
    },
    async deleteRow({ tableId, rowId }) {
      data._deletes.push({ tableId, rowId });
      delete data[tableId][rowId];
    },
    async listRows({ tableId }) {
      return { rows: Object.values(data[tableId] || {}) };
    },
  };

  return { data, tables };
}

test("recheck writes an AI Pass on that Finding and records finding.rescored", async () => {
  const { data, tables } = store();
  let scored = null;

  await runRecheck({
    tables,
    taskId: "task_gloves",
    scoreOneItem: async ({ item, photoFileId }) => {
      scored = { item, photoFileId };
      return {
        id: item.id,
        status: "pass",
        clause_id: "FS-01",
        quote: "",
        confidence: 0.93,
        evidence_note: "Gloves visible at the prep line.",
      };
    },
    newRowId: () => "event_rescored",
    now: () => "2026-08-17T09:00:00.000Z",
  });

  assert.equal(scored.photoFileId, "recheck_photo_1");
  assert.equal(scored.item.id, "gloves_worn");
  assert.equal(scored.item.relatedClauseIds[0], "FS-01");

  const finding = data.findings.finding_gloves;
  assert.equal(finding.status, "pass");
  assert.equal(finding.source, "ai");
  assert.equal(finding.confidence, 0.93);
  assert.equal(finding.evidenceNote, "Gloves visible at the prep line.");
  assert.equal(finding.clauseId, "FS-01");
  assert.equal(
    finding.quote,
    "Wear clean disposable gloves at the food-prep station.",
  );
  assert.equal(finding.overrideReason, null);
  assert.equal(finding.overriddenBy, null);
  assert.equal(finding.overriddenAt, null);

  const event = data.events.event_rescored;
  assert.ok(event);
  assert.equal(event.type, "finding.rescored");
  assert.equal(event.shiftId, "shift_1");
});

test("recheck does not flip Shift status or delete other Findings", async () => {
  const { data, tables } = store();

  await runRecheck({
    tables,
    taskId: "task_gloves",
    scoreOneItem: async ({ item }) => ({
      id: item.id,
      status: "pass",
      clause_id: "FS-01",
      quote: item.quote,
      confidence: 0.9,
      evidence_note: "Gloves on.",
    }),
    newRowId: () => "event_rescored",
    now: () => "2026-08-17T09:00:00.000Z",
  });

  assert.equal(data.shifts.shift_1.status, "scored");
  assert.equal(data.shifts.shift_1.photoFileIds, JSON.stringify(["pool_a", "pool_b"]));
  assert.equal(data.findings.finding_floor.status, "gap");
  assert.equal(data.findings.finding_floor.source, "ai");
  assert.deepEqual(data._deletes, []);
  assert.equal(
    data._updates.some((u) => u.tableId === "shifts"),
    false,
  );
  assert.equal(
    data._creates.some((c) => c.tableId === "agent_jobs"),
    false,
  );
  assert.equal(
    data._updates.some((u) => u.tableId === "agent_jobs"),
    false,
  );
});

test("recheck ignores ALLOW_DEMO_STUB_SCORES and writes nothing when scoring throws", async () => {
  const { data, tables } = store();
  const prev = process.env.ALLOW_DEMO_STUB_SCORES;
  process.env.ALLOW_DEMO_STUB_SCORES = "1";

  await assert.rejects(
    () =>
      runRecheck({
        tables,
        taskId: "task_gloves",
        scoreOneItem: async () => {
          throw new Error("Gemini HTTP 429");
        },
        newRowId: () => "event_should_not_exist",
        now: () => "2026-08-17T09:00:00.000Z",
      }),
    /Gemini HTTP 429/,
  );

  process.env.ALLOW_DEMO_STUB_SCORES = prev;

  const finding = data.findings.finding_gloves;
  assert.equal(finding.status, "gap");
  assert.equal(finding.source, "manager_override");
  assert.equal(finding.overrideReason, "Looked like a miss from here.");
  assert.equal(data.events.event_should_not_exist, undefined);
  assert.equal(data.shifts.shift_1.status, "scored");
});
