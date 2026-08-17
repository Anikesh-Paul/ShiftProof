/**
 * Turn a model payload + live Checklist into Finding rows (ADR 0004).
 * Quotes and Clause ids come from the live set, never a hardcoded café map.
 */

const LOW_CONFIDENCE = 0.55;
/** Every stored Evidence photo is scored; eight is the product max. */
const MAX_PHOTOS = 8;
const ALLOWED_STATUS = new Set(["pass", "gap", "unclear"]);

function photoIdsForScore(photoFileIds) {
  return (Array.isArray(photoFileIds) ? photoFileIds : []).slice(0, MAX_PHOTOS);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function quoteForItem(item, clauseId) {
  const stored = item && String(item.quote || "").trim();
  if (stored) return stored.slice(0, 1000);
  return `Clause ${clauseId} must be met.`;
}

function clauseIdForItem(item, i) {
  return (
    (item && item.relatedClauseIds && item.relatedClauseIds[0]) ||
    `FS-${String(Math.max(1, i + 1)).padStart(2, "0")}`
  );
}

/**
 * Parse Gemini JSON → FINDINGS_SCHEMA items; fill missing checklist rows;
 * force low conf → unclear. Quote fallback is the live item, then generic.
 */
function normalizeFindings(payload, items) {
  const byId = new Map();
  const list =
    payload && Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    if (!id) continue;
    let status = String(row.status || "unclear").toLowerCase();
    if (!ALLOWED_STATUS.has(status)) status = "unclear";
    let confidence = clamp01(row.confidence);
    if (confidence < LOW_CONFIDENCE) status = "unclear";
    const idx = items.findIndex((it) => it.id === id);
    const item = idx >= 0 ? items[idx] : null;
    const clauseId = clauseIdForItem(item, idx);
    const modelClause = String(row.clause_id || "").trim();
    let quote = String(row.quote || "").trim();
    const clauseMatches = !modelClause || modelClause === clauseId;
    if (!quote || !clauseMatches) quote = quoteForItem(item, clauseId);
    let evidence_note = String(row.evidence_note || "").trim();
    if (!evidence_note) {
      evidence_note =
        status === "unclear"
          ? "Insufficient visual evidence to score this item."
          : `Scored from evidence photos for ${item ? item.label : id}.`;
    }
    quote = quote.slice(0, 1000);
    evidence_note = evidence_note.slice(0, 1000);
    byId.set(id, {
      id,
      status,
      clause_id: clauseId.slice(0, 32),
      quote,
      confidence,
      evidence_note,
    });
  }

  return items.map((item, i) => {
    if (byId.has(item.id)) return byId.get(item.id);
    const clauseId = clauseIdForItem(item, i);
    return {
      id: item.id,
      status: "unclear",
      clause_id: clauseId,
      quote: quoteForItem(item, clauseId),
      confidence: 0.3,
      evidence_note: "Model omitted this item; marked unclear.",
    };
  });
}

module.exports = {
  LOW_CONFIDENCE,
  MAX_PHOTOS,
  quoteForItem,
  clauseIdForItem,
  photoIdsForScore,
  normalizeFindings,
};
