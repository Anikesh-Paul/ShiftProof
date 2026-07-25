import {
  tables,
  storage,
  functions,
  DB,
  ID,
  Query,
  Permission,
  Role,
} from "./appwrite";
import {
  APPWRITE_IDS,
  type Site,
  type Sop,
  type Checklist,
  type ChecklistItem,
  type Shift,
  type AgentJob,
  type AuditEvent,
} from "../types/shiftproof";

const T = APPWRITE_IDS.tables;
const seed = APPWRITE_IDS.seed;
const SOP_MAX_BYTES = 10 * 1024 * 1024;

/** TablesDB row payloads are schema-flexible; cast after fetch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowData = Record<string, any>;

export async function getSite(): Promise<Site> {
  const row = await tables.getRow({
    databaseId: DB,
    tableId: T.sites,
    rowId: seed.siteId,
  });
  return row as unknown as Site;
}

export async function getChecklist(): Promise<Checklist> {
  const row = await tables.getRow({
    databaseId: DB,
    tableId: T.checklists,
    rowId: seed.checklistId,
  });
  return row as unknown as Checklist;
}

/** API.md — Get SOP meta (`sops` / `cafe_sop_v1`). */
export async function getSop(): Promise<Sop> {
  const row = await tables.getRow({
    databaseId: DB,
    tableId: T.sops,
    rowId: seed.sopId,
  });
  return row as unknown as Sop;
}

/** True when fileId points at a real Storage object (not seed placeholder). */
export function isSopFileReady(fileId: string | undefined | null): boolean {
  if (!fileId?.trim()) return false;
  if (/^TODO/i.test(fileId)) return false;
  return true;
}

/**
 * Upload SOP PDF → bucket `sop_files`, then set `sops.cafe_sop_v1.fileId`.
 * Manager-only product intent; client relies on Appwrite permissions.
 */
export async function uploadSopPdf(file: File): Promise<Sop> {
  const name = file.name.toLowerCase();
  const isPdf =
    file.type === "application/pdf" ||
    file.type === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!isPdf) {
    throw new Error("Upload a PDF file.");
  }
  if (file.size > SOP_MAX_BYTES) {
    throw new Error("PDF must be 10 MB or smaller.");
  }

  const created = await storage.createFile({
    bucketId: APPWRITE_IDS.buckets.sop_files,
    fileId: ID.unique(),
    file,
  });

  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.sops,
    rowId: seed.sopId,
    data: {
      fileId: created.$id,
    } as RowData,
  });
  return row as unknown as Sop;
}

/** View/download URL for an SOP PDF in `sop_files`. */
export function getSopFileUrl(fileId: string): string {
  return storage.getFileView({
    bucketId: APPWRITE_IDS.buckets.sop_files,
    fileId,
  });
}

export function parseChecklistItems(checklist: Checklist): ChecklistItem[] {
  try {
    const parsed = JSON.parse(checklist.itemsJson) as ChecklistItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parsePhotoFileIds(photoFileIds?: string): string[] {
  if (!photoFileIds) return [];
  try {
    const parsed = JSON.parse(photoFileIds) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Create draft shift with rowSecurity permissions for creator + users read. */
export async function createDraftShift(userId: string): Promise<Shift> {
  const data: RowData = {
    siteId: seed.siteId,
    checklistId: seed.checklistId,
    createdBy: userId,
    status: "draft",
    photoFileIds: "[]",
    startedAt: new Date().toISOString(),
  };

  const permissions = [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
    Permission.read(Role.users()),
  ];

  const row = await tables.createRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: ID.unique(),
    data,
    permissions,
  });
  return row as unknown as Shift;
}

export async function getShift(shiftId: string): Promise<Shift> {
  const row = await tables.getRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
  });
  return row as unknown as Shift;
}

/** Upload one evidence photo to the evidence bucket. */
export async function uploadEvidence(file: File): Promise<string> {
  const result = await storage.createFile({
    bucketId: APPWRITE_IDS.buckets.evidence,
    fileId: ID.unique(),
    file,
  });
  return result.$id;
}

/** Preview URL for an evidence file (bucket `evidence`). */
export function getEvidencePreviewUrl(fileId: string): string {
  return storage.getFileView({
    bucketId: APPWRITE_IDS.buckets.evidence,
    fileId,
  });
}

/** List agent_jobs for a shift (API.md staff §7). */
export async function listJobsForShift(shiftId: string): Promise<AgentJob[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.agent_jobs,
    queries: [Query.equal("shiftId", shiftId), Query.limit(10)],
  });
  return result.rows as unknown as AgentJob[];
}

export async function setShiftPhotos(
  shiftId: string,
  fileIds: string[],
): Promise<Shift> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
    data: {
      photoFileIds: JSON.stringify(fileIds),
    } as RowData,
  });
  return row as unknown as Shift;
}

/**
 * API.md §4 — trigger runShiftScore when Function is available.
 * Soft-fails if Function not deployed (job stays waiting).
 */
export async function triggerRunShiftScore(
  shiftId: string,
  jobId: string,
): Promise<{ triggered: boolean; error?: string }> {
  try {
    await functions.createExecution({
      functionId: APPWRITE_IDS.functions.runShiftScore,
      body: JSON.stringify({ shiftId, jobId }),
      async: true,
    });
    // Mark shift scoring while Function runs (API journey)
    try {
      await tables.updateRow({
        databaseId: DB,
        tableId: T.shifts,
        rowId: shiftId,
        data: { status: "scoring" } as RowData,
      });
    } catch {
      // non-fatal
    }
    return { triggered: true };
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : "Function not available";
    return { triggered: false, error: message };
  }
}

/**
 * Submit shift: status submitted → agent_jobs waiting → events shift.submitted
 * → best-effort runShiftScore (C3).
 */
export async function submitShift(
  shiftId: string,
  userId: string,
  photoCount: number,
): Promise<{
  shift: Shift;
  job: AgentJob;
  event: AuditEvent;
  scoreTrigger: { triggered: boolean; error?: string };
}> {
  const shiftRow = await tables.updateRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
    data: {
      status: "submitted",
      submittedAt: new Date().toISOString(),
    } as RowData,
  });

  // API.md §3 — agent_jobs waiting
  const jobRow = await tables.createRow({
    databaseId: DB,
    tableId: T.agent_jobs,
    rowId: ID.unique(),
    data: {
      shiftId,
      status: "waiting",
      startedAt: null,
      errorMessage: null,
      finishedAt: null,
      traceJson: null,
    } as RowData,
  });

  const eventRow = await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId,
      type: "shift.submitted",
      actorUserId: userId,
      payloadJson: JSON.stringify({ photoCount }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  const job = jobRow as unknown as AgentJob;
  // Prefer cloud Function only (Gemini). No silent client stub (ADR 0002 / S1).
  // Explicit emergency: Function env ALLOW_DEMO_STUB_SCORES=1 — not the client.
  const scoreTrigger = await triggerRunShiftScore(shiftId, job.$id);

  let shift = shiftRow as unknown as Shift;
  try {
    shift = await getShift(shiftId);
  } catch {
    /* keep submitted row */
  }

  let jobOut = job;
  try {
    const latest = await getLatestJob(shiftId);
    if (latest) jobOut = latest;
  } catch {
    /* keep created job */
  }

  return {
    shift,
    job: jobOut,
    event: eventRow as unknown as AuditEvent,
    scoreTrigger: {
      triggered: scoreTrigger.triggered,
      error: scoreTrigger.triggered ? undefined : scoreTrigger.error,
    },
  };
}

/** Poll latest agent_job for a shift (API.md §7). */
export async function getLatestJob(shiftId: string): Promise<AgentJob | null> {
  const jobs = await listJobsForShift(shiftId);
  if (!jobs.length) return null;
  return jobs[0] ?? null;
}

/** Poll until job done/failed or timeout (ms). */
export async function pollJobUntilSettled(
  shiftId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<AgentJob | null> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const start = Date.now();
  let last: AgentJob | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await getLatestJob(shiftId);
    if (last && (last.status === "done" || last.status === "failed")) {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

export async function listMyShifts(userId: string): Promise<Shift[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.shifts,
    queries: [Query.equal("createdBy", userId), Query.orderDesc("startedAt")],
  });
  return result.rows as unknown as Shift[];
}

export const PHOTO_MIN = 3;
export const PHOTO_MAX = 8;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export function validatePhotoFile(file: File): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  const name = file.name.toLowerCase();
  const extOk =
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp");
  if (!allowed.includes(file.type) && !extOk) {
    return "Only JPG, PNG, or WebP photos are allowed.";
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return "Each photo must be 10 MB or smaller.";
  }
  return null;
}
