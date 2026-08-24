/**
 * Turn a model payload + live Checklist into Finding rows (ADR 0004 / 0006).
 * Quotes and Clause ids come from the live set, never a hardcoded café map.
 * Confidence is derived sufficiency; extra rubric / photo-index keys are discarded.
 */

const LOW_CONFIDENCE = 0.55;
const PASS_CONFIDENCE = 0.8;
const CITE_CAP = 0.5;
const NOTE_CAP = 0.45;
/** Every stored Evidence photo is scored; eight is the product max. */
const MAX_PHOTOS = 8;
const ALLOWED_STATUS = new Set(["pass", "gap", "unclear"]);
const RUBRIC_KEYS = ["subject", "visibility", "lighting", "coverage"];
const UNREADABLE_NOTE =
  /cannot see|cannot confirm|\bglare\b|\bdark\b|\bcropped\b|not visible|\bambiguous\b|\bplaceholder\b/i;

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

function factorValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return null;
  const x = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(x)) return null;
  return clamp01(x);
}

function confidenceFromRow(row) {
  const factors = [];
  for (const key of RUBRIC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = factorValue(row[key]);
    if (value !== null) factors.push(value);
  }
  if (factors.length) return Math.min(...factors);
  return clamp01(row.confidence);
}

function photoIndexesFrom(row) {
  return Array.isArray(row.photo_indexes) ? row.photo_indexes : [];
}

function hasValidPhotoCite(row, photoCount) {
  if (!(photoCount >= 1)) return false;
  return photoIndexesFrom(row).some((idx) => {
    const n = typeof idx === "number" ? idx : Number(idx);
    return Number.isInteger(n) && n >= 1 && n <= photoCount;
  });
}

function applyConfidenceCaps(confidence, row, photoCount) {
  let next = confidence;
  if (!hasValidPhotoCite(row, photoCount)) next = Math.min(next, CITE_CAP);
  const note = String(row.evidence_note || "");
  if (note && UNREADABLE_NOTE.test(note)) next = Math.min(next, NOTE_CAP);
  return next;
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
 * Parse Gemini JSON → FINDINGS_SCHEMA items; fill missing checklist rows.
 * Derives Confidence from rubric factors + photo cites, then caps and
 * status gates (Low → Unclear; AI Pass requires High). Extra keys stay off
 * the Finding. Quote fallback is the live item, then generic.
 */
function normalizeFindings(payload, items, photoCount = 0) {
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
    let confidence = applyConfidenceCaps(
      confidenceFromRow(row),
      row,
      photoCount,
    );
    if (confidence < LOW_CONFIDENCE) status = "unclear";
    if (status === "pass" && confidence < PASS_CONFIDENCE) status = "unclear";
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
    const validPhotoIndex = photoIndexesFrom(row).find((idx) => {
      const n = typeof idx === "number" ? idx : Number(idx);
      return (
        Number.isInteger(n) && n >= 1 && (photoCount === 0 || n <= photoCount)
      );
    });
    if (
      photoCount > 1 &&
      validPhotoIndex != null &&
      !/\b(?:photos?|images?|imgs?|pics?|pictures?)\s*#?\s*\d+\b/i.test(
        evidence_note,
      )
    ) {
      evidence_note = `Photo ${validPhotoIndex}: ${evidence_note}`;
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
  PASS_CONFIDENCE,
  MAX_PHOTOS,
  quoteForItem,
  clauseIdForItem,
  photoIdsForScore,
  normalizeFindings,
};
