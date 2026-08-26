/**
 * Re-check route: one Task photo against that Finding’s live Clause.
 * Does not flip Shift status, create an Agent job, or delete other Findings.
 * Ignores ALLOW_DEMO_STUB_SCORES — a scoring throw writes nothing.
 */
const { Query } = require("node-appwrite");
const { normalizeFindings } = require("./findings");
const {
  scoreboardFromFindings,
  scoreboardWritePayload,
} = require("./shiftScoreboard");

const DB = "shiftproof";

function parseChecklistItems(checklist) {
  try {
    const items = JSON.parse(checklist.itemsJson || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function runRecheck({
  tables,
  taskId,
  scoreOneItem,
  newRowId,
  now,
  log = () => {},
}) {
  const task = await tables.getRow({
    databaseId: DB,
    tableId: "tasks",
    rowId: taskId,
  });
  const photoFileId = String(task.recheckFileId || "").trim();
  if (!photoFileId) {
    throw new Error("Re-check photo missing on Task");
  }

  const finding = await tables.getRow({
    databaseId: DB,
    tableId: "findings",
    rowId: task.findingId,
  });
  const shift = await tables.getRow({
    databaseId: DB,
    tableId: "shifts",
    rowId: task.shiftId,
  });
  const checklist = await tables.getRow({
    databaseId: DB,
    tableId: "checklists",
    rowId: shift.checklistId || "opening_fs",
  });
  const items = parseChecklistItems(checklist);
  const item = items.find((row) => row.id === finding.itemId);
  if (!item) {
    throw new Error("Live Clause missing for this Finding");
  }

  log(
    `runShiftScore action=recheck taskId=${taskId} item=${item.id} photo=${photoFileId}`,
  );

  const modelItem = await scoreOneItem({ item, photoFileId });
  const [scored] = normalizeFindings(
    {
      items: [
        modelItem && typeof modelItem === "object"
          ? { ...modelItem, id: item.id }
          : { id: item.id },
      ],
    },
    [item],
    1,
  );

  const createdAt = now();
  await tables.updateRow({
    databaseId: DB,
    tableId: "findings",
    rowId: finding.$id,
    data: {
      status: scored.status,
      confidence: scored.confidence,
      evidenceNote: scored.evidence_note,
      quote: scored.quote,
      clauseId: finding.clauseId,
      source: "ai",
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
    },
  });

  await tables.createRow({
    databaseId: DB,
    tableId: "events",
    rowId: newRowId(),
    data: {
      shiftId: task.shiftId,
      type: "finding.rescored",
      actorUserId: "function:runShiftScore",
      payloadJson: JSON.stringify({
        findingId: finding.$id,
        taskId,
        itemId: finding.itemId,
        recheckFileId: photoFileId,
        status: scored.status,
        source: "ai",
      }),
      createdAt,
    },
  });

  try {
    const listed = await tables.listRows({
      databaseId: DB,
      tableId: "findings",
      queries: [Query.equal("shiftId", task.shiftId), Query.limit(100)],
    });
    await tables.updateRow({
      databaseId: DB,
      tableId: "shifts",
      rowId: task.shiftId,
      data: scoreboardWritePayload(
        scoreboardFromFindings(listed.rows || []),
      ),
    });
  } catch (err) {
    log(`scoreboard write skipped: ${err.message || err}`);
  }

  return {
    ok: true,
    findingId: finding.$id,
    status: scored.status,
  };
}

module.exports = { runRecheck };
