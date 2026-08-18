/**
 * Map an extracted SOP list onto the opening Checklist (ADR 0004).
 * Known café Clauses keep stable item ids; unknown ids slug from the Clause.
 */

const KNOWN_CLAUSE_ITEM_IDS = {
  "FS-01": "gloves_worn",
  "FS-02": "handwash_station",
  "FS-03": "sanitizer_available",
  "FS-04": "counter_clean",
  "FS-05": "fridge_temp",
  "FS-06": "hair_restraint",
  "FS-07": "floor_clear",
  "FS-08": "waste_bin_covered",
};

const EXTRACT_MIN = 3;
const EXTRACT_MAX = 8;

function itemIdForClause(clauseId) {
  const id = String(clauseId || "").trim();
  if (KNOWN_CLAUSE_ITEM_IDS[id]) return KNOWN_CLAUSE_ITEM_IDS[id];
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "clause";
}

function asItemList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

/** Cap at 8. Fewer than 3 is failure — do not rewrite the live set. */
function parseExtractPayload(payload) {
  const rows = [];
  for (const row of asItemList(payload)) {
    if (!row || typeof row !== "object") continue;
    const clauseId = String(row.clause_id || row.clauseId || "").trim();
    if (!clauseId) continue;
    const label = String(row.label || "").trim() || clauseId;
    const quote =
      String(row.quote || "").trim() || `Clause ${clauseId} must be met.`;
    rows.push({ clause_id: clauseId, label, quote });
    if (rows.length >= EXTRACT_MAX) break;
  }
  if (rows.length < EXTRACT_MIN) {
    throw new Error(
      `Need at least ${EXTRACT_MIN} photo-provable opening rules, got ${rows.length}`,
    );
  }
  return rows;
}

function toChecklistItems(extracted) {
  return extracted.map((row) => ({
    id: itemIdForClause(row.clause_id),
    label: row.label,
    requiredPhoto: false,
    relatedClauseIds: [row.clause_id],
    quote: String(row.quote || "").slice(0, 1000),
  }));
}

function bumpVersion(version) {
  const n = Number.parseInt(String(version || ""), 10);
  if (Number.isFinite(n) && n > 0) return String(n + 1);
  return "2";
}

module.exports = {
  KNOWN_CLAUSE_ITEM_IDS,
  EXTRACT_MIN,
  EXTRACT_MAX,
  itemIdForClause,
  parseExtractPayload,
  toChecklistItems,
  bumpVersion,
};
