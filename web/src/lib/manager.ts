/**
 * Manager journey ops — docs/API.md manager §1–4 + Realtime.
 * Only listed Appwrite operations; no invented endpoints.
 */
import { tables, DB, ID, Query, realtime, Channel } from "./appwrite";
import {
  APPWRITE_IDS,
  type AgentJob,
  type ChecklistItem,
  type Finding,
  type FindingStatus,
  type Shift,
  type Task,
  type AuditEvent,
} from "../types/shiftproof";
import {
  DEMO_MANAGER_INBOX,
  DEMO_AGENT_TRACE,
  DEMO_REPEAT_OFFENDERS,
  citationForFinding,
  getDemoShift,
  hydrateItemLabels,
  itemLabel,
  type ManagerShiftSummary,
} from "./managerDemo";
import { resolveStaffLabel } from "./staffNames";
import {
  getLatestJob,
  listFindingsByShiftIds,
  listLatestJobsByShiftIds,
  loadChecklistItems,
  syncShiftScoreboard,
} from "./shifts";
import {
  INBOX_EVIDENCE_PAGES,
  INBOX_RECENCY_LIMIT,
  inboxRecencyTruncated,
  mergeRecencyWithEvidence,
} from "./inboxFetch";
import {
  applyLiveEventsToInbox,
  applyLiveToSummary as patchSummary,
  applyLiveToTasks,
  countByStatus,
  parseManagerLiveEvent,
  repeatOffendersFromInbox,
  MANAGER_LIVE_BATCH_MS,
  type LiveEventLike,
} from "./managerLive";
import {
  peekLatestJob,
  rememberLatestJob,
  rememberSummaryRows,
  upsertCachedFinding,
} from "./rowCache";
import {
  applyScoreboardToSummary,
  inboxFindingsFromShift,
  scoreboardFromShift,
  shiftHasScoreboard,
} from "./shiftScoreboard";

const T = APPWRITE_IDS.tables;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowData = Record<string, any>;

export type { ManagerShiftSummary };
export {
  citationForFinding,
  formatManagerWhen,
  formatManagerWhenRange,
  hydrateItemLabels,
  inboxCopy,
  isHarnessName,
  isKnownItemId,
  itemLabel,
  openFixTitle,
  openGapCount,
  shiftsWithOpenGaps,
  shortItemLabel,
} from "./managerDemo";
export type { FindingCitation, InboxCopyInput, InboxCopyView } from "./managerDemo";
export { DEMO_MANAGER_INBOX } from "./managerDemo";
export {
  parseManagerLiveEvent,
  repeatOffendersFromInbox,
  shiftIdOf,
} from "./managerLive";

const STUCK_MS = 10 * 60 * 1000;
const DEFAULT_TZ = "Asia/Kolkata";

export function isSameLocalDay(
  iso: string | undefined,
  timeZone = DEFAULT_TZ,
): boolean {
  if (!iso) return false;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(iso)) === fmt.format(new Date());
  } catch {
    return false;
  }
}

/**
 * submitted/scoring longer than 10 minutes — manager can retry or close.
 * A waiting/running job that is itself not stale means not stuck, even when
 * submittedAt is old (Retry just created a live job).
 */
export function isStuckScoring(
  shift: Shift,
  latestJob?: AgentJob | null,
): boolean {
  if (shift.status !== "submitted" && shift.status !== "scoring") return false;
  if (
    latestJob &&
    (latestJob.status === "waiting" || latestJob.status === "running")
  ) {
    return isStaleAgentJob(latestJob);
  }
  const t = Date.parse(shift.submittedAt || shift.startedAt || "");
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STUCK_MS;
}

/** waiting/running job older than the same 10-minute stuck threshold. */
export function isStaleAgentJob(job: AgentJob): boolean {
  if (job.status !== "waiting" && job.status !== "running") return false;
  const t = Date.parse(job.startedAt || job.$createdAt || "");
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STUCK_MS;
}

async function ensureItemLabels(): Promise<void> {
  try {
    hydrateItemLabels(await loadChecklistItems());
  } catch {
    /* keep static map */
  }
}



async function listManagerShiftPage(opts?: {
  offset?: number;
}): Promise<{ rows: Shift[]; total: number }> {
  const queries = [
    Query.equal("status", ["submitted", "scoring", "scored"]),
    Query.orderDesc("submittedAt"),
    Query.limit(INBOX_RECENCY_LIMIT),
  ];
  if (opts?.offset) queries.push(Query.offset(opts.offset));
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.shifts,
    queries,
  });
  return {
    rows: result.rows as unknown as Shift[],
    total: result.total,
  };
}

/** Recency page only — glance chips stay on the latest scored openings. */
export async function listManagerShifts(): Promise<Shift[]> {
  const page = await listManagerShiftPage();
  return page.rows;
}

/**
 * Recency 50 plus older photo rows that the recency page dropped.
 * Today still day-scopes; Backlog rank can lift photo + N Gap.
 */
export async function listManagerInboxWindow(): Promise<{
  shifts: Shift[];
  truncated: boolean;
}> {
  const recent = await listManagerShiftPage();
  const knownMore = inboxRecencyTruncated(recent.total, recent.rows.length);
  const maybeMore =
    recent.total === 0 && recent.rows.length === INBOX_RECENCY_LIMIT;
  if (!knownMore && !maybeMore) {
    return { shifts: recent.rows, truncated: false };
  }

  const older: Shift[] = [];
  try {
    for (let i = 1; i <= INBOX_EVIDENCE_PAGES; i++) {
      const page = await listManagerShiftPage({
        offset: INBOX_RECENCY_LIMIT * i,
      });
      older.push(...page.rows);
      if (page.rows.length < INBOX_RECENCY_LIMIT) break;
    }
  } catch {
    /* Recency page still paints. */
  }

  return {
    shifts: mergeRecencyWithEvidence(recent.rows, older),
    truncated: knownMore || older.length > 0,
  };
}

/** API.md manager §2 / staff §6 — findings by shiftId. */
export async function listFindings(shiftId: string): Promise<Finding[]> {
  const map = await listFindingsByShiftIds([shiftId]);
  return map.get(shiftId) ?? [];
}

function toSummary(
  shift: Shift,
  findings: Finding[],
  staffLabel?: string,
  latestJob?: AgentJob | null,
): ManagerShiftSummary {
  return {
    shift,
    staffLabel: staffLabel ?? resolveStaffLabel(shift.createdBy),
    findings,
    latestJob,
    ...countByStatus(findings),
  };
}

const INBOX_MEMO_MS = 60_000;

type InboxLoad = {
  items: ManagerShiftSummary[];
  source: "live" | "demo";
  truncated: boolean;
};

let inboxMemo: { at: number; result: InboxLoad } | null = null;
let inboxInflight: Promise<InboxLoad> | null = null;

export function peekManagerInbox(): InboxLoad | null {
  return inboxMemo?.result ?? null;
}

export function rememberInboxItems(items: ManagerShiftSummary[]): void {
  if (!inboxMemo || inboxMemo.result.source !== "live") return;
  inboxMemo = {
    at: Date.now(),
    result: { ...inboxMemo.result, items },
  };
}

async function loadManagerInboxNow(): Promise<InboxLoad> {
  try {
    await ensureItemLabels();
    const { shifts, truncated } = await listManagerInboxWindow();
    if (shifts.length === 0) {
      return { items: DEMO_MANAGER_INBOX, source: "demo", truncated: false };
    }

    const scoringIds = shifts
      .filter((s) => s.status === "submitted" || s.status === "scoring")
      .map((s) => s.$id);
    const missingScoreboard = shifts
      .filter((s) => !shiftHasScoreboard(s))
      .map((s) => s.$id);
    const [findingsByShift, jobsByShift] = await Promise.all([
      missingScoreboard.length
        ? listFindingsByShiftIds(missingScoreboard)
        : Promise.resolve(new Map<string, Finding[]>()),
      scoringIds.length
        ? listLatestJobsByShiftIds(scoringIds)
        : Promise.resolve(new Map<string, AgentJob>()),
    ]);
    for (const [id, job] of jobsByShift) rememberLatestJob(id, job);
    const items = shifts.map((shift) => {
      const latestJob =
        jobsByShift.get(shift.$id) ?? peekLatestJob(shift.$id) ?? null;
      if (shiftHasScoreboard(shift)) {
        const board = scoreboardFromShift(shift);
        return {
          shift,
          staffLabel: resolveStaffLabel(shift.createdBy),
          findings: inboxFindingsFromShift(shift),
          latestJob,
          gapCount: board.gapCount,
          unclearCount: board.unclearCount,
          passCount: board.passCount,
        };
      }
      return toSummary(
        shift,
        findingsByShift.get(shift.$id) ?? [],
        undefined,
        latestJob,
      );
    });
    const result: InboxLoad = { items, source: "live", truncated };
    inboxMemo = { at: Date.now(), result };
    return result;
  } catch {
    return { items: DEMO_MANAGER_INBOX, source: "demo", truncated: false };
  }
}

/**
 * Live inbox first (API.md). Demo pack only when:
 * - network/permission failure, or
 * - zero live shifts (empty café).
 * Never hide real submitted shifts behind demo.
 * `fresh` skips the memo used when navigating inbox → detail.
 * Concurrent callers share one in-flight list (Strict Mode, home+detail).
 */
export async function loadManagerInbox(opts?: {
  fresh?: boolean;
}): Promise<InboxLoad> {
  if (
    !opts?.fresh &&
    inboxMemo &&
    inboxMemo.result.source === "live" &&
    Date.now() - inboxMemo.at < INBOX_MEMO_MS
  ) {
    return inboxMemo.result;
  }
  if (inboxInflight) return inboxInflight;
  inboxInflight = loadManagerInboxNow().finally(() => {
    inboxInflight = null;
  });
  return inboxInflight;
}

export async function loadManagerShift(shiftId: string): Promise<{
  item: ManagerShiftSummary;
  source: "live" | "demo";
} | null> {
  const demo = getDemoShift(shiftId);
  await ensureItemLabels();
  try {
    const shift = (await tables.getRow({
      databaseId: DB,
      tableId: T.shifts,
      rowId: shiftId,
    })) as unknown as Shift;

    let findings: Finding[] = [];
    try {
      findings = await listFindings(shiftId);
    } catch {
      findings = [];
    }

    // Demo scoreboard only for demo_shift_* ids when live row missing findings
    if (findings.length === 0 && demo && shiftId.startsWith("demo_shift_")) {
      return { item: demo, source: "demo" };
    }

    const needsJob =
      shift.status === "submitted" || shift.status === "scoring";
    const latestJob = needsJob
      ? await getLatestJob(shiftId).catch(() => null)
      : null;

    return {
      item: toSummary(shift, findings, undefined, latestJob),
      source: "live",
    };
  } catch {
    if (demo) return { item: demo, source: "demo" };
    return null;
  }
}

/** API.md manager §3 — override + event finding.overridden */
export async function overrideFinding(opts: {
  findingId: string;
  shiftId: string;
  from: FindingStatus;
  to: FindingStatus;
  reason: string;
  userId: string;
}): Promise<Finding> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.findings,
    rowId: opts.findingId,
    data: {
      status: opts.to,
      source: "manager_override",
      overrideReason: opts.reason,
      overriddenBy: opts.userId,
      overriddenAt: new Date().toISOString(),
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "finding.overridden",
      actorUserId: opts.userId,
      payloadJson: JSON.stringify({
        findingId: opts.findingId,
        from: opts.from,
        to: opts.to,
        reason: opts.reason,
      }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  const finding = row as unknown as Finding;
  upsertCachedFinding(finding);
  await syncShiftScoreboard(opts.shiftId);
  return finding;
}

/** API.md manager §4 — create task + event task.created (assignedTo = staff). */
export async function assignFixTask(opts: {
  shiftId: string;
  findingId: string;
  title: string;
  userId: string;
  /** Staff who should upload the re-check (usually shift.createdBy). */
  assignedTo?: string | null;
}): Promise<Task> {
  const row = await tables.createRow({
    databaseId: DB,
    tableId: T.tasks,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      findingId: opts.findingId,
      title: opts.title,
      status: "open",
      assignedTo: opts.assignedTo ?? null,
      createdBy: opts.userId,
      recheckFileId: null,
      createdAt: new Date().toISOString(),
      doneAt: null,
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "task.created",
      actorUserId: opts.userId,
      payloadJson: JSON.stringify({
        findingId: opts.findingId,
        taskId: row.$id,
        title: opts.title,
        assignedTo: opts.assignedTo ?? null,
      }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  return row as unknown as Task;
}

/** API.md manager §5 — mark task done + event task.done. */
export async function markTaskDone(opts: {
  taskId: string;
  shiftId: string;
  userId: string;
}): Promise<Task> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.tasks,
    rowId: opts.taskId,
    data: {
      status: "done",
      doneAt: new Date().toISOString(),
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "task.done",
      actorUserId: opts.userId,
      payloadJson: JSON.stringify({ taskId: opts.taskId }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  return row as unknown as Task;
}

/** List tasks for a shift. */
export async function listTasks(shiftId: string): Promise<Task[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.tasks,
    queries: [Query.equal("shiftId", shiftId), Query.limit(50)],
  });
  return result.rows as unknown as Task[];
}

/** Get one finding by id (for re-score after re-check). */
export async function getFinding(findingId: string): Promise<Finding> {
  const row = await tables.getRow({
    databaseId: DB,
    tableId: T.findings,
    rowId: findingId,
  });
  return row as unknown as Finding;
}

/** Fast path — one query. Paint these before scanning own shifts. */
export async function listAssignedOpenTasks(userId: string): Promise<Task[]> {
  try {
    const assigned = await tables.listRows({
      databaseId: DB,
      tableId: T.tasks,
      queries: [
        Query.equal("assignedTo", userId),
        Query.equal("status", "open"),
        Query.limit(50),
      ],
    });
    return assigned.rows as unknown as Task[];
  } catch {
    try {
      const open = await tables.listRows({
        databaseId: DB,
        tableId: T.tasks,
        queries: [Query.equal("status", "open"), Query.limit(100)],
      });
      return (open.rows as unknown as Task[]).filter(
        (t) => t.assignedTo === userId,
      );
    } catch {
      return [];
    }
  }
}

/**
 * Phase 3 — open fix tasks for a staff user:
 * assigned to them, or on shifts they created (legacy tasks without assignedTo).
 * Call `onPartial` as soon as the assigned query returns so Opening can paint.
 */
export async function listOpenFixTasksForStaff(
  userId: string,
  onPartial?: (tasks: Task[]) => void,
): Promise<Task[]> {
  const byId = new Map<string, Task>();

  const [assigned, shiftRows] = await Promise.all([
    listAssignedOpenTasks(userId),
    tables
      .listRows({
        databaseId: DB,
        tableId: T.shifts,
        queries: [
          Query.equal("createdBy", userId),
          Query.orderDesc("startedAt"),
          Query.limit(50),
        ],
      })
      .then((r) => r.rows)
      .catch(() => [] as { $id: string }[]),
  ]);

  for (const t of assigned) byId.set(t.$id, t);
  onPartial?.([...byId.values()]);

  const mine = new Set(shiftRows.map((s) => s.$id));
  if (mine.size === 0) {
    return [...byId.values()].sort(byTaskRecency);
  }

  try {
    const open = await tables.listRows({
      databaseId: DB,
      tableId: T.tasks,
      queries: [
        Query.equal("shiftId", [...mine]),
        Query.equal("status", "open"),
        Query.limit(100),
      ],
    });
    for (const row of open.rows) {
      const t = row as unknown as Task;
      if (t.status !== "open") continue;
      if (t.assignedTo === userId || (mine.has(t.shiftId) && !t.assignedTo)) {
        byId.set(t.$id, t);
      }
    }
  } catch {
    const batches = await Promise.all(
      [...mine].map((id) => listTasks(id).catch(() => [] as Task[])),
    );
    for (const tasks of batches) {
      for (const t of tasks) {
        if (t.status !== "open") continue;
        if (!t.assignedTo || t.assignedTo === userId) byId.set(t.$id, t);
      }
    }
  }

  return [...byId.values()].sort(byTaskRecency);
}

function byTaskRecency(a: Task, b: Task) {
  return (b.createdAt || b.$createdAt).localeCompare(a.createdAt || a.$createdAt);
}

export type RecheckAttachResult = {
  task: Task;
  /** True when the Function or wait failed and the client wrote Attestation. */
  fallback: boolean;
};

/**
 * Persist the Re-check file on the Task, then score it via runShiftScore.
 * Function writes the Finding (AI Pass / Gap / Unclear). Task stays open.
 * Function or wait failure: client writes Attestation; Function wrote nothing.
 */
export async function attachRecheckAndRescore(opts: {
  taskId: string;
  shiftId: string;
  findingId: string;
  recheckFileId: string;
  userId: string;
}): Promise<RecheckAttachResult> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.tasks,
    rowId: opts.taskId,
    data: {
      recheckFileId: opts.recheckFileId,
      // stays open until manager marks done
      status: "open",
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "task.recheck",
      actorUserId: opts.userId,
      payloadJson: JSON.stringify({
        taskId: opts.taskId,
        findingId: opts.findingId,
        recheckFileId: opts.recheckFileId,
      }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  const task = row as unknown as Task;

  if (opts.shiftId.startsWith("demo_shift_")) {
    await writeStaffAttestation(opts);
    return { task, fallback: false };
  }

  const { runRecheckScore } = await import("./shifts");
  try {
    await runRecheckScore(opts.taskId);
    return { task, fallback: false };
  } catch {
    await writeStaffAttestation(opts);
    return { task, fallback: true };
  }
}

async function writeStaffAttestation(opts: {
  findingId: string;
  shiftId: string;
  recheckFileId: string;
  userId: string;
}): Promise<void> {
  const finding = await getFinding(opts.findingId);
  const { rescoreFindingAfterRecheck } = await import("./scoreShift");
  await rescoreFindingAfterRecheck({
    findingId: opts.findingId,
    shiftId: opts.shiftId,
    itemId: finding.itemId,
    recheckFileId: opts.recheckFileId,
    actorUserId: opts.userId,
  });
}

/** API.md manager §9 — mark a stale waiting/running job failed. Shift unchanged. */
export async function failStaleJob(
  jobId: string,
  shiftId: string,
  userId: string,
): Promise<AgentJob> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.agent_jobs,
    rowId: jobId,
    data: {
      status: "failed",
      errorMessage: "Timed out after 10 minutes",
      finishedAt: new Date().toISOString(),
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId,
      type: "job.failed",
      actorUserId: userId,
      payloadJson: JSON.stringify({ jobId, reason: "stale" }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  return row as unknown as AgentJob;
}

const SWEEP_EVERY_MS = 10 * 60 * 1000;
let lastSweepAt = 0;

/** At most once per 10 minutes — fail waiting/running jobs older than 10 minutes. */
export async function sweepStaleJobs(
  items: ManagerShiftSummary[],
  userId: string,
): Promise<void> {
  if (Date.now() - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = Date.now();
  await Promise.all(
    items.map(async (item) => {
      const job = item.latestJob;
      if (!job || !isStaleAgentJob(job)) return;
      try {
        const failed = await failStaleJob(job.$id, item.shift.$id, userId);
        item.latestJob = failed;
      } catch {
        /* best-effort */
      }
    }),
  );
}

/** API.md manager §8 — close shift so it leaves the inbox. */
export async function closeShift(opts: {
  shiftId: string;
  userId: string;
  reason?: string;
}): Promise<Shift> {
  const row = await tables.updateRow({
    databaseId: DB,
    tableId: T.shifts,
    rowId: opts.shiftId,
    data: {
      status: "closed",
    } as RowData,
  });

  await tables.createRow({
    databaseId: DB,
    tableId: T.events,
    rowId: ID.unique(),
    data: {
      shiftId: opts.shiftId,
      type: "shift.closed",
      actorUserId: opts.userId,
      payloadJson: JSON.stringify({ reason: opts.reason ?? "reviewed" }),
      createdAt: new Date().toISOString(),
    } as RowData,
  });

  return row as unknown as Shift;
}

/** API.md manager §10 — all open fix / retake tasks. */
export async function listOpenTasks(): Promise<Task[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.tasks,
    queries: [
      Query.equal("status", "open"),
      Query.orderDesc("createdAt"),
      Query.limit(50),
    ],
  });
  return result.rows as unknown as Task[];
}

/** Union by `$id`. `preferred` wins on conflict and keeps its order first. */
export function mergeTasksById(preferred: Task[], other: Task[]): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of preferred) {
    if (seen.has(t.$id)) continue;
    seen.add(t.$id);
    out.push(t);
  }
  for (const t of other) {
    if (seen.has(t.$id)) continue;
    seen.add(t.$id);
    out.push(t);
  }
  return out;
}

/** API.md manager §6 — audit events for a shift. */
export async function listEvents(shiftId: string): Promise<AuditEvent[]> {
  const result = await tables.listRows({
    databaseId: DB,
    tableId: T.events,
    queries: [
      Query.equal("shiftId", shiftId),
      Query.orderDesc("createdAt"),
      Query.limit(40),
    ],
  });
  return result.rows as unknown as AuditEvent[];
}

/** Boost #1 — load agent_jobs.traceJson for a shift. */
export async function getAgentJobTrace(
  shiftId: string,
  knownJob?: AgentJob | null,
): Promise<{
  jobId: string;
  status: string;
  steps: string[];
  raw: Record<string, unknown> | null;
} | null> {
  const job = knownJob ?? (await getLatestJob(shiftId));
  if (!job) return null;

  let raw: Record<string, unknown> | null = null;
  try {
    raw = job.traceJson ? (JSON.parse(job.traceJson) as Record<string, unknown>) : null;
  } catch {
    raw = null;
  }

  // Product-facing steps only — no mode/stub debug, no leading numbers (rendered in <ol>)
  const steps: string[] = [
    "Load shift evidence and checklist",
    "Score each checklist item against SOP clauses",
    "Write findings with clause, quote, and confidence",
    "Mark job done and shift scored",
  ];
  if (raw?.photoCount != null || raw?.findingCount != null) {
    const parts: string[] = [];
    if (raw?.photoCount != null) parts.push(`${raw.photoCount} photos used`);
    if (raw?.findingCount != null)
      parts.push(`${raw.findingCount} findings written`);
    steps.push(parts.join(" · "));
  }
  if (job.status === "failed" && job.errorMessage)
    steps.push(`Scoring failed: ${job.errorMessage}`);

  return {
    jobId: job.$id,
    status: job.status || "unknown",
    steps,
    raw,
  };
}

/** Boost #6 — count gap/unclear by itemId across recent scored shifts. */
export async function loadRepeatOffenders(limitShifts = 5): Promise<
  { itemId: string; label: string; count: number; of: number }[]
> {
  try {
    const inbox = await loadManagerInbox();
    const rows = repeatOffendersFromInbox(inbox.items, limitShifts).map(
      (row) => ({ ...row, label: itemLabel(row.itemId) }),
    );
    if (rows.length) return rows;
    return inbox.source === "demo" ? DEMO_REPEAT_OFFENDERS : [];
  } catch {
    return DEMO_REPEAT_OFFENDERS;
  }
}

export { DEMO_AGENT_TRACE, DEMO_REPEAT_OFFENDERS };

/** Boost #1 — every finding must expose clause + quote + confidence. */
export function hasForcedCitation(
  f: Finding,
  items: ChecklistItem[] = [],
): boolean {
  const cite = citationForFinding(f, items);
  return Boolean(
    !cite.gap &&
      cite.clauseId &&
      cite.quote &&
      typeof f.confidence === "number" &&
      f.confidence >= 0 &&
      f.confidence <= 1,
  );
}

/** Scoring writes many rows; collapse them into one local apply. */
export const MANAGER_REALTIME_DEBOUNCE_MS = MANAGER_LIVE_BATCH_MS;

/**
 * API.md Realtime — subscribe to shifts, findings, agent_jobs, tasks.
 * Channel: tablesdb.{db}.tables.{table}.rows
 * Hidden tabs do not flush; the pending batch applies on focus.
 * Callers must apply payloads locally — do not listRows the inbox per event.
 */
export function subscribeManagerTables(
  onEvents: (events: LiveEventLike[]) => void,
): () => void {
  const db = Channel.tablesdb(DB);
  const channels = [
    db.table(T.shifts).row(),
    db.table(T.findings).row(),
    db.table(T.agent_jobs).row(),
    db.table(T.tasks).row(),
  ];

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let batch: LiveEventLike[] = [];

  const fire = () => {
    timer = null;
    if (typeof document !== "undefined" && document.hidden) {
      pending = true;
      return;
    }
    const events = batch;
    batch = [];
    pending = false;
    if (events.length) onEvents(events);
  };

  const queued = (event: LiveEventLike) => {
    batch.push(event);
    pending = true;
    if (timer) return;
    timer = setTimeout(fire, MANAGER_LIVE_BATCH_MS);
  };

  const onVisibility = () => {
    if (typeof document === "undefined" || document.hidden || !pending) return;
    if (timer) clearTimeout(timer);
    fire();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  const sub = realtime.subscribe(channels, (event) => {
    queued(event);
  });

  return () => {
    if (timer) clearTimeout(timer);
    pending = false;
    batch = [];
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    void Promise.resolve(sub).then((s) => {
      const handle = s as {
        close?: () => void;
        unsubscribe?: () => void;
      };
      if (typeof handle.unsubscribe === "function") handle.unsubscribe();
      else if (typeof handle.close === "function") handle.close();
    });
  };
}

export function applyLiveToSummary(
  item: ManagerShiftSummary,
  event: Parameters<typeof patchSummary>[1],
): ManagerShiftSummary {
  const next = applyScoreboardToSummary(patchSummary(item, event));
  rememberSummaryRows(next);
  return next;
}

export function applyInboxLiveEvents(
  items: ManagerShiftSummary[],
  events: LiveEventLike[],
) {
  const parsed = events
    .map(parseManagerLiveEvent)
    .filter((event): event is NonNullable<typeof event> => event != null);
  const result = applyLiveEventsToInbox(items, parsed);
  result.items = result.items.map(applyScoreboardToSummary);
  for (const item of result.items) rememberSummaryRows(item);
  return result;
}

export function applyTaskLiveEvents(tasks: Task[], events: LiveEventLike[]) {
  const parsed = events
    .map(parseManagerLiveEvent)
    .filter((event): event is NonNullable<typeof event> => event != null);
  return parsed.reduce(applyLiveToTasks, tasks);
}

export function applyLocalOverride(
  item: ManagerShiftSummary,
  findingId: string,
  to: FindingStatus,
  reason: string,
  userId: string,
): ManagerShiftSummary {
  const findings = item.findings.map((f) =>
    f.$id === findingId
      ? {
          ...f,
          status: to,
          source: "manager_override" as const,
          overrideReason: reason,
          overriddenBy: userId,
          overriddenAt: new Date().toISOString(),
        }
      : f,
  );
  return {
    ...item,
    findings,
    ...countByStatus(findings),
  };
}

export type { AuditEvent };
