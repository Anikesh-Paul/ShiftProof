/**
 * Re-run safe finding writes: update existing AI rows in place.
 * Delete+create doubled writes and flooded manager realtime (each event used
 * to trigger a full findings list for the inbox).
 */

const KEEP_SOURCES = new Set(["manager_override", "staff_recheck"]);

function scoredPayload(shiftId, f) {
  return {
    shiftId,
    itemId: f.id,
    status: f.status,
    clauseId: f.clause_id,
    quote: f.quote,
    confidence: f.confidence,
    evidenceNote: f.evidence_note,
    source: "ai",
  };
}

/**
 * @param {Array<{ $id: string, itemId: string, source?: string }>} existing
 * @param {Array<{ id: string }>} scored
 */
function planFindingWrites(existing, scored) {
  const rows = Array.isArray(existing) ? existing : [];
  const keepByItem = new Map();
  const extras = [];
  for (const row of rows) {
    if (KEEP_SOURCES.has(row.source)) {
      keepByItem.set(row.itemId, row);
      continue;
    }
    const current = keepByItem.get(row.itemId);
    if (!current) keepByItem.set(row.itemId, row);
    else if (KEEP_SOURCES.has(current.source)) extras.push(row);
    else extras.push(row);
  }

  const scoredIds = new Set(scored.map((f) => f.id));
  const updates = [];
  const creates = [];
  const deletes = [...extras];

  for (const f of scored) {
    const row = keepByItem.get(f.id);
    if (row && KEEP_SOURCES.has(row.source)) continue;
    if (row) updates.push({ rowId: row.$id, itemId: f.id, scored: f });
    else creates.push({ scored: f });
  }

  for (const row of rows) {
    if (KEEP_SOURCES.has(row.source)) continue;
    if (scoredIds.has(row.itemId)) continue;
    if (deletes.some((d) => d.$id === row.$id)) continue;
    if (updates.some((u) => u.rowId === row.$id)) continue;
    deletes.push(row);
  }

  return { updates, creates, deletes };
}

async function persistScoredFindings({
  tables,
  databaseId,
  tableId,
  ID,
  shiftId,
  scored,
  existing,
  log,
}) {
  const plan = planFindingWrites(existing, scored);
  log?.(
    `persist findings update=${plan.updates.length} create=${plan.creates.length} delete=${plan.deletes.length}`,
  );

  for (const row of plan.deletes) {
    await tables.deleteRow({
      databaseId,
      tableId,
      rowId: row.$id,
    });
  }

  await Promise.all(
    plan.updates.map((item) =>
      tables.updateRow({
        databaseId,
        tableId,
        rowId: item.rowId,
        data: scoredPayload(shiftId, item.scored),
      }),
    ),
  );

  await Promise.all(
    plan.creates.map((item) =>
      tables.createRow({
        databaseId,
        tableId,
        rowId: ID.unique(),
        data: scoredPayload(shiftId, item.scored),
      }),
    ),
  );

  return plan;
}

module.exports = {
  KEEP_SOURCES,
  planFindingWrites,
  persistScoredFindings,
  scoredPayload,
};
