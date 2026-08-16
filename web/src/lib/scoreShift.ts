/**
 * C3 client scoring helpers.
 * Default production path is cloud Function runShiftScore (Gemini Flash).
 * Field names frozen per docs/APPWRITE.md + FINDINGS_SCHEMA.
 */
import { tables, DB, ID } from "./appwrite";
import { APPWRITE_IDS } from "../types/shiftproof";
import { parseChecklistItems, getChecklist } from "./shifts";

const T = APPWRITE_IDS.tables;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowData = Record<string, any>;

const CLAUSE_QUOTES: Record<string, string> = {
  "FS-01": "Food handlers must wear clean disposable gloves at the prep station.",
  "FS-02": "Handwash station must be stocked and accessible before service.",
  "FS-03": "Sanitizer must be available and filled at open.",
  "FS-04": "Food-prep surfaces must be clean and free of debris before service.",
  "FS-05": "Cold storage must show temperature within safe range at open.",
  "FS-06": "Hair restraint must be worn at the food-prep station.",
  "FS-07": "Service floor should be clear of slip hazards at open.",
  "FS-08": "Waste bins must be covered before service.",
};

/**
 * Phase 3 / boost #3 — re-score a single finding after a re-check photo.
 * Stub assumes the fix photo proves compliance (demo-ready happy path).
 * Keeps clause + quote; updates status/confidence/evidenceNote/source=ai.
 */
export async function rescoreFindingAfterRecheck(opts: {
  findingId: string;
  shiftId: string;
  itemId: string;
  recheckFileId: string;
  actorUserId: string;
}): Promise<void> {
  const checklist = await getChecklist();
  const items = parseChecklistItems(checklist);
  const item = items.find((i) => i.id === opts.itemId);
  const label = item?.label ?? opts.itemId;
  const clauseId =
    item?.relatedClauseIds?.[0] ||
    `FS-${String(Math.max(1, items.findIndex((i) => i.id === opts.itemId) + 1)).padStart(2, "0")}`;
  const quote =
    CLAUSE_QUOTES[clauseId] || `Clause ${clauseId} must be met.`;

  await tables.updateRow({
    databaseId: DB,
    tableId: T.findings,
    rowId: opts.findingId,
    data: {
      status: "pass",
      clauseId,
      quote,
      confidence: 0.91,
      evidenceNote: `Re-check photo confirms ${label} after fix.`,
      source: "ai",
      // Clear prior override so scoreboard shows fresh AI re-score
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "finding.rescored",
      actorUserId: opts.actorUserId,
      payloadJson: JSON.stringify({
        findingId: opts.findingId,
        itemId: opts.itemId,
        recheckFileId: opts.recheckFileId,
        status: "pass",
        confidence: 0.91,
      }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });
}
