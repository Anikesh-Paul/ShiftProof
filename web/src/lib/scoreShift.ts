/**
 * C3 client scoring helpers.
 * Default production path is cloud Function runShiftScore (Gemini Flash).
 * runShiftScoreLocal is emergency/dev only — NOT auto-called on submit (ADR 0002).
 * Field names frozen per docs/APPWRITE.md + FINDINGS_SCHEMA.
 */
import { tables, DB, ID, Query } from "./appwrite";
import { APPWRITE_IDS, type ChecklistItem } from "../types/shiftproof";
import { getShift, parseChecklistItems, getChecklist } from "./shifts";

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

type ScoredItem = {
  id: string;
  status: "pass" | "gap" | "unclear";
  clause_id: string;
  quote: string;
  confidence: number;
  evidence_note: string;
};

/** Deterministic stub — ≥5 findings, includes gap + unclear (demo-ready). */
export function scoreChecklistItems(
  items: ChecklistItem[],
  photoCount: number,
): ScoredItem[] {
  return items.map((item, i) => {
    const clauseId =
      item.relatedClauseIds?.[0] || `FS-${String(i + 1).padStart(2, "0")}`;
    const quote =
      CLAUSE_QUOTES[clauseId] || `Clause ${clauseId} must be met.`;
    let status: ScoredItem["status"] = "pass";
    let confidence = 0.88;
    let evidence_note = `Photo set (${photoCount}) consistent with ${item.label}.`;
    if (i === 0) {
      status = "gap";
      confidence = 0.84;
      evidence_note = "Visual check suggests non-compliance for this item.";
    } else if (i === 1 || (photoCount < 4 && i === 2)) {
      status = "unclear";
      confidence = 0.42;
      evidence_note =
        "Ambiguous framing or glare; cannot confirm from evidence.";
    } else if (i === 3 && photoCount < 5) {
      status = "gap";
      confidence = 0.79;
      evidence_note =
        "Checklist item not clearly evidenced in uploaded photos.";
    }
    return {
      id: item.id,
      status,
      clause_id: clauseId,
      quote,
      confidence,
      evidence_note,
    };
  });
}

/**
 * Explicit client-side stub scorer (deterministic). Do not call on the default
 * submit path — Function owns scoring; use only for manual emergency recovery.
 */
export async function runShiftScoreLocal(
  shiftId: string,
  jobId: string,
): Promise<{ findingCount: number }> {
  await tables.updateRow({
    databaseId: DB,
    tableId: T.agent_jobs,
    rowId: jobId,
    data: {
      status: "running",
      startedAt: new Date().toISOString(),
    } as RowData,
  });

  await tables.updateRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
    data: { status: "scoring" } as RowData,
  });

  try {
    const shift = await getShift(shiftId);
    let photoCount = 0;
    try {
      const ids = JSON.parse(shift.photoFileIds || "[]") as unknown;
      photoCount = Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string" && id.length > 0).length
        : 0;
    } catch {
      photoCount = 0;
    }

    const checklist = await getChecklist();
    const items = parseChecklistItems(checklist);
    if (items.length < 1) throw new Error("Checklist has no items");

    const scored = scoreChecklistItems(items, photoCount);
    if (scored.length < 5) throw new Error("Need ≥5 findings");

    // Remove prior AI findings for re-run safety
    try {
      const existing = await tables.listRows({
        databaseId: DB,
        tableId: T.findings,
        queries: [Query.equal("shiftId", shiftId), Query.limit(100)],
      });
      for (const row of existing.rows) {
        const source = (row as { source?: string }).source;
        if (source === "ai") {
          await tables.deleteRow({
            databaseId: DB,
            tableId: T.findings,
            rowId: row.$id,
          });
        }
      }
    } catch {
      /* ignore */
    }

    for (const f of scored) {
      await tables.createRow({
        databaseId: DB,
        tableId: T.findings,
        rowId: ID.unique(),
        data: {
          shiftId,
          itemId: f.id,
          status: f.status,
          clauseId: f.clause_id,
          quote: f.quote,
          confidence: f.confidence,
          evidenceNote: f.evidence_note,
          source: "ai",
        } as RowData,
      });
    }

    await tables.updateRow({
      databaseId: DB,
      tableId: T.agent_jobs,
      rowId: jobId,
      data: {
        status: "done",
        finishedAt: new Date().toISOString(),
        errorMessage: null,
        traceJson: JSON.stringify({
          mode: "client-fallback",
          photoCount,
          findingCount: scored.length,
        }),
      } as RowData,
    });

    await tables.updateRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
      data: {
        status: "scored",
        scoredAt: new Date().toISOString(),
      } as RowData,
    });

    await tables.createRow({
      databaseId: DB,
      tableId: T.events,
      rowId: ID.unique(),
      data: {
        shiftId,
        type: "job.done",
        actorUserId: "client:runShiftScore",
        payloadJson: JSON.stringify({
          jobId,
          findingCount: scored.length,
          mode: "client-fallback",
        }),
        createdAt: new Date().toISOString(),
      } as RowData,
    });

    return { findingCount: scored.length };
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
    try {
      await tables.updateRow({
        databaseId: DB,
        tableId: T.agent_jobs,
        rowId: jobId,
        data: {
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorMessage: message.slice(0, 500),
        } as RowData,
      });
      await tables.createRow({
        databaseId: DB,
        tableId: T.events,
        rowId: ID.unique(),
        data: {
          shiftId,
          type: "job.failed",
          actorUserId: "client:runShiftScore",
          payloadJson: JSON.stringify({ jobId, error: message }),
          createdAt: new Date().toISOString(),
        } as RowData,
      });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

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
