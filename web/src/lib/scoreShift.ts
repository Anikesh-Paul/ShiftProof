/**
 * C3 client scoring helpers.
 * Default production path is cloud Function runShiftScore (Gemini Flash).
 * Field names frozen per docs/APPWRITE.md + FINDINGS_SCHEMA.
 */
import { tables, DB, ID } from "./appwrite";
import { APPWRITE_IDS, type Finding } from "../types/shiftproof";
import { upsertCachedFinding } from "./rowCache";

const T = APPWRITE_IDS.tables;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowData = Record<string, any>;

/** Staff toast when Gemini does not score the Re-check (ADR 0005). */
export const RECHECK_FALLBACK_TOAST =
  "AI could not re-score — sent as staff attestation.";

/**
 * Staff Attestation after a Re-check photo (ADR 0005 fallback).
 * Flips the Finding to Pass with source staff_recheck. Keeps clause, quote,
 * confidence, and any manager Override fields. Records who attested and when
 * on the finding.attested event — no invented confidence.
 */
export async function rescoreFindingAfterRecheck(opts: {
  findingId: string;
  shiftId: string;
  itemId: string;
  recheckFileId: string;
  actorUserId: string;
}): Promise<void> {
  const attestedAt = new Date().toISOString();
  const evidenceNote = `Staff attested after fix. Re-check photo ${opts.recheckFileId} is the basis.`;

  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.findings,
    rowId: opts.findingId,
    data: {
      status: "pass",
      evidenceNote,
      source: "staff_recheck",
    } as RowData,
  });
  upsertCachedFinding(row as unknown as Finding);
  const { syncShiftScoreboard } = await import("./shifts");
  await syncShiftScoreboard(opts.shiftId);

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "finding.attested",
      actorUserId: opts.actorUserId,
      payloadJson: JSON.stringify({
        findingId: opts.findingId,
        itemId: opts.itemId,
        recheckFileId: opts.recheckFileId,
        status: "pass",
        attestedBy: opts.actorUserId,
        attestedAt,
      }),
      createdAt: attestedAt,
    } as RowData,
  });
}
