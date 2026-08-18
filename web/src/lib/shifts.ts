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
  type Finding,
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

const EXTRACT_KEEP_PREVIOUS =
  "The new file was not read. The previous opening check is still in force.";

/**
 * Extract the live clause set from the SOP file now on record.
 * Waits on the Function. Writes nothing on the client — the Function
 * rewrites the Checklist only after a successful extract.
 */
export async function extractSopLiveSet(): Promise<ChecklistItem[]> {
  let execution;
  try {
    execution = await functions.createExecution({
      functionId: APPWRITE_IDS.functions.runShiftScore,
      body: JSON.stringify({ action: "extract" }),
      async: false,
    });
  } catch {
    throw new Error(EXTRACT_KEEP_PREVIOUS);
  }
  let payload: { ok?: boolean; items?: ChecklistItem[]; error?: string } = {};
  try {
    payload = JSON.parse(execution.responseBody || "{}") as {
      ok?: boolean;
      items?: ChecklistItem[];
      error?: string;
    };
  } catch {
    payload = {};
  }
  const failed =
    execution.status === "failed" ||
    execution.responseStatusCode >= 400 ||
    payload.ok === false;
  if (failed) {
    throw new Error(EXTRACT_KEEP_PREVIOUS);
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

/**
 * Score one Re-check photo against that Task’s Finding (sync wait).
 * Function writes the Finding. Client must persist task.recheckFileId first.
 */
export async function runRecheckScore(taskId: string): Promise<void> {
  const execution = await functions.createExecution({
    functionId: APPWRITE_IDS.functions.runShiftScore,
    body: JSON.stringify({ action: "recheck", taskId }),
    async: false,
  });
  let payload: { ok?: boolean; error?: string } = {};
  try {
    payload = JSON.parse(execution.responseBody || "{}") as {
      ok?: boolean;
      error?: string;
    };
  } catch {
    payload = {};
  }
  const failed =
    execution.status === "failed" ||
    execution.responseStatusCode >= 400 ||
    payload.ok === false;
  if (failed) {
    throw new Error(payload.error || "Re-check score did not run");
  }
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

let checklistItemCache: ChecklistItem[] = [];

export function peekChecklistItems(): ChecklistItem[] {
  return checklistItemCache;
}

export async function loadChecklistItems(): Promise<ChecklistItem[]> {
  const checklist = await getChecklist();
  const items = parseChecklistItems(checklist);
  checklistItemCache = items;
  return items;
}

export function parsePhotoFileIds(photoFileIds?: string): string[] {
  if (!photoFileIds) return [];
  try {
    const parsed = JSON.parse(photoFileIds) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (id): id is string =>
            typeof id === "string" && id.trim().length > 0 && id.trim() !== "—",
        )
      : [];
  } catch {
    return [];
  }
}

/** File id for a checklist item when photos are slotted or 1:1 with items. */
export function photoForItem(
  itemId: string,
  photoFileIds: string | undefined,
  items: ChecklistItem[],
): string | null {
  if (!photoFileIds || items.length === 0) return null;
  const slotted = parsePhotoSlots(photoFileIds, items);
  if (slotted.slots[itemId]) return slotted.slots[itemId];
  try {
    const parsed = JSON.parse(photoFileIds) as unknown;
    if (!Array.isArray(parsed)) return null;
    const filled = parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    const idx = items.findIndex((item) => item.id === itemId);
    if (idx >= 0 && filled.length === items.length && filled[idx]) {
      return filled[idx];
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Slotted layout: empty strings mark unused checklist rows. Compact arrays are extras. */
export function parsePhotoSlots(
  photoFileIds: string | undefined,
  items: ChecklistItem[],
): { slots: Record<string, string>; extras: string[] } {
  const empty = { slots: {} as Record<string, string>, extras: [] as string[] };
  if (!photoFileIds) return empty;
  try {
    const parsed = JSON.parse(photoFileIds) as unknown;
    if (!Array.isArray(parsed)) return empty;
    const strings = parsed.filter((id): id is string => typeof id === "string");
    const hasBlank = strings.some((id) => id.length === 0);
    const filled = strings.filter((id) => id.length > 0);
    if (!hasBlank || items.length === 0) {
      return { slots: {}, extras: filled };
    }
    const slots: Record<string, string> = {};
    const extras: string[] = [];
    strings.forEach((id, i) => {
      if (!id) return;
      if (i < items.length) slots[items[i].id] = id;
      else extras.push(id);
    });
    return { slots, extras };
  } catch {
    return empty;
  }
}

export function serializePhotoSlots(
  items: ChecklistItem[],
  slots: Record<string, string>,
  extras: string[],
): string[] {
  return [...items.map((item) => slots[item.id] ?? ""), ...extras];
}

/** API.md §5b — delete one evidence file (best-effort). */
export async function deleteEvidenceFile(fileId: string): Promise<void> {
  try {
    await storage.deleteFile({
      bucketId: APPWRITE_IDS.buckets.evidence,
      fileId,
    });
  } catch {
    /* orphan file — ignore */
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

const EVIDENCE_MAX_EDGE = 1280;
const EVIDENCE_JPEG_QUALITY = 0.72;
const EVIDENCE_SKIP_COMPRESS_BYTES = 350_000;

/** Shrink phone photos before Storage + Gemini. Kit JPGs under 350KB pass through. */
export async function compressEvidenceFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    return file;
  }
  if (file.size <= EVIDENCE_SKIP_COMPRESS_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(
      1,
      EVIDENCE_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    if (scale === 1 && file.size <= EVIDENCE_SKIP_COMPRESS_BYTES) {
      bitmap.close();
      return file;
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", EVIDENCE_JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "evidence";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Upload one evidence photo to the evidence bucket. */
export async function uploadEvidence(file: File): Promise<string> {
  const toUpload = await compressEvidenceFile(file);
  const result = await storage.createFile({
    bucketId: APPWRITE_IDS.buckets.evidence,
    fileId: ID.unique(),
    file: toUpload,
  });
  return result.$id;
}

/** Full-size view URL for lightbox / download. */
export function getEvidenceFileUrl(fileId: string): string {
  return storage.getFileView({
    bucketId: APPWRITE_IDS.buckets.evidence,
    fileId,
  });
}

/**
 * Grid thumb. Uses file view — Appwrite image preview returns a pink
 * placeholder on this project, so resized preview is not safe.
 */
export function getEvidencePreviewUrl(fileId: string): string {
  return getEvidenceFileUrl(fileId);
}

/** List agent_jobs for a shift (API.md staff §7). */
export async function listJobsForShift(shiftId: string): Promise<AgentJob[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.agent_jobs,
    queries: [
      Query.equal("shiftId", shiftId),
      Query.orderDesc("$createdAt"),
      Query.limit(10),
    ],
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

/** Shift row is submitted but the Agent job / audit event never landed. */
export class SubmitInterruptedError extends Error {
  readonly shift: Shift;
  readonly job: AgentJob | null;
  constructor(shift: Shift, job: AgentJob | null) {
    super("Scoring did not start. Try again.");
    this.name = "SubmitInterruptedError";
    this.shift = shift;
    this.job = job;
  }
}

function isLiveJob(job: AgentJob | null): job is AgentJob {
  return job != null && (job.status === "waiting" || job.status === "running");
}

/**
 * Submit shift: status submitted → agent_jobs waiting → events shift.submitted
 * → best-effort runShiftScore (C3).
 *
 * If job/event creation fails after the Shift update, throws
 * SubmitInterruptedError so Retry can finish the job instead of stranding.
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
  const submitted = shiftRow as unknown as Shift;

  let job: AgentJob | null = null;
  let eventRow: unknown;
  try {
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
    job = jobRow as unknown as AgentJob;

    eventRow = await tables.createRow({
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
  } catch {
    throw new SubmitInterruptedError(submitted, job);
  }
  if (!job || !eventRow) {
    throw new SubmitInterruptedError(submitted, job);
  }

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

/** API.md §4 retry — ensure a live job + runShiftScore. Leaves any old job in place. */
export async function retryShiftScore(
  shiftId: string,
  userId: string,
): Promise<{
  shift: Shift;
  job: AgentJob;
  scoreTrigger: { triggered: boolean; error?: string };
}> {
  const existing = await getLatestJob(shiftId);
  let job: AgentJob;
  if (isLiveJob(existing)) {
    job = existing;
  } else {
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
    job = jobRow as unknown as AgentJob;
  }

  try {
    await tables.createRow({
      databaseId: DB,
      tableId: T.events,
      rowId: ID.unique(),
      data: {
        shiftId,
        type: "job.retry",
        actorUserId: userId,
        payloadJson: JSON.stringify({ jobId: job.$id }),
        createdAt: new Date().toISOString(),
      } as RowData,
    });
  } catch {
    /* event is best-effort */
  }

  const scoreTrigger = await triggerRunShiftScore(shiftId, job.$id);
  let shift = await getShift(shiftId);
  return {
    shift,
    job,
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
  const sorted = [...jobs].sort((a, b) =>
    (b.$createdAt || b.startedAt || "").localeCompare(
      a.$createdAt || a.startedAt || "",
    ),
  );
  return sorted[0] ?? null;
}

/** Poll until job done/failed, timeout (ms), or `isCancelled` reports true. */
export async function pollJobUntilSettled(
  shiftId: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    isCancelled?: () => boolean;
  },
): Promise<AgentJob | null> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const isCancelled = opts?.isCancelled ?? (() => false);
  const start = Date.now();
  let last: AgentJob | null = null;
  while (Date.now() - start < timeoutMs) {
    if (isCancelled()) return last;
    last = await getLatestJob(shiftId);
    if (isCancelled()) return last;
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
    queries: [
      Query.equal("createdBy", userId),
      Query.orderDesc("startedAt"),
      Query.limit(100),
    ],
  });
  return result.rows as unknown as Shift[];
}

export function isEmptyDraft(shift: Shift): boolean {
  return (
    shift.status === "draft" && parsePhotoFileIds(shift.photoFileIds).length === 0
  );
}

/** Prefer a draft that already has photos; otherwise the newest empty draft. */
export function pickResumableDraft(shifts: Shift[]): Shift | null {
  const drafts = shifts.filter((s) => s.status === "draft");
  if (!drafts.length) return null;
  return (
    drafts.find((s) => parsePhotoFileIds(s.photoFileIds).length > 0) ??
    drafts[0] ??
    null
  );
}

/** API.md staff §5b — delete own draft; evidence cleanup is best-effort. */
export async function deleteDraftShift(
  shiftId: string,
  fileIds: string[] = [],
): Promise<void> {
  await tables.deleteRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: shiftId,
  });
  for (const fileId of fileIds) {
    try {
      await storage.deleteFile({
        bucketId: APPWRITE_IDS.buckets.evidence,
        fileId,
      });
    } catch {
      /* orphan file — ignore */
    }
  }
}

/** API.md staff §6 — findings for a shift the staff member can read. */
export async function listFindingsForShift(
  shiftId: string,
): Promise<Finding[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.findings,
    queries: [Query.equal("shiftId", shiftId), Query.limit(100)],
  });
  return result.rows as unknown as Finding[];
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
