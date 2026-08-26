/**
 * Apply Appwrite realtime payloads to the inbox in memory.
 * Scoring writes many finding rows; a full listRows per event is what blew
 * daily database reads. Patch locally; reload only when a new shift appears.
 */
import type { AgentJob, Finding, Shift, Task } from "../types/shiftproof";
import type { ManagerShiftSummary } from "./managerDemo";

export const MANAGER_LIVE_BATCH_MS = 80;

export type LiveTable = "shifts" | "findings" | "agent_jobs" | "tasks";
export type LiveAction = "create" | "update" | "delete";

export type ParsedLiveEvent = {
  table: LiveTable;
  action: LiveAction;
  payload: Record<string, unknown>;
};

export type LiveEventLike = {
  events?: string[];
  channels?: string[];
  payload?: unknown;
};

const TABLES: LiveTable[] = ["findings", "agent_jobs", "tasks", "shifts"];

export function countByStatus(findings: Finding[]) {
  return {
    gapCount: findings.filter((f) => f.status === "gap").length,
    unclearCount: findings.filter((f) => f.status === "unclear").length,
    passCount: findings.filter((f) => f.status === "pass").length,
  };
}

export function withFindingCounts(
  item: ManagerShiftSummary,
): ManagerShiftSummary {
  return { ...item, ...countByStatus(item.findings) };
}

function haystackOf(event: LiveEventLike): string {
  return [...(event.events ?? []), ...(event.channels ?? [])].join(" ");
}

export function parseLiveAction(event: LiveEventLike): LiveAction {
  const parts = [...(event.events ?? []), ...(event.channels ?? [])];
  for (const part of parts) {
    if (part.endsWith(".delete") || part.includes(".delete.")) return "delete";
    if (part.endsWith(".create") || part.includes(".create.")) return "create";
  }
  return "update";
}

export function parseLiveTable(event: LiveEventLike): LiveTable | null {
  const hay = haystackOf(event);
  for (const table of TABLES) {
    if (hay.includes(`.tables.${table}.`) || hay.includes(`.${table}.`)) {
      return table;
    }
  }
  return null;
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as Record<string, unknown>;
}

export function parseManagerLiveEvent(
  event: LiveEventLike,
): ParsedLiveEvent | null {
  const table = parseLiveTable(event);
  const payload = asRecord(event.payload);
  if (!table || !payload) return null;
  return { table, action: parseLiveAction(event), payload };
}

export function shiftIdOf(event: ParsedLiveEvent): string | null {
  const fromPayload = event.payload.shiftId;
  if (typeof fromPayload === "string" && fromPayload) return fromPayload;
  if (event.table === "shifts" && typeof event.payload.$id === "string") {
    return event.payload.$id;
  }
  return null;
}

function asFinding(payload: Record<string, unknown>): Finding | null {
  if (typeof payload.$id !== "string" || typeof payload.shiftId !== "string") {
    return null;
  }
  return payload as unknown as Finding;
}

function asShift(payload: Record<string, unknown>): Shift | null {
  if (typeof payload.$id !== "string") return null;
  return payload as unknown as Shift;
}

function asJob(payload: Record<string, unknown>): AgentJob | null {
  if (typeof payload.$id !== "string" || typeof payload.shiftId !== "string") {
    return null;
  }
  return payload as unknown as AgentJob;
}

function asTask(payload: Record<string, unknown>): Task | null {
  if (typeof payload.$id !== "string") return null;
  return payload as unknown as Task;
}

export function applyLiveToSummary(
  item: ManagerShiftSummary,
  event: ParsedLiveEvent,
): ManagerShiftSummary {
  if (event.table === "findings") {
    const finding = asFinding(event.payload);
    const findingId =
      (typeof event.payload.$id === "string" && event.payload.$id) ||
      finding?.$id;
    if (event.action === "delete" && findingId) {
      const findings = item.findings.filter((row) => row.$id !== findingId);
      return withFindingCounts({ ...item, findings });
    }
    if (!finding || finding.shiftId !== item.shift.$id) return item;
    const previous = item.findings.find((row) => row.$id === finding.$id);
    const merged = previous ? { ...previous, ...finding } : finding;
    const findings = item.findings.filter((row) => row.$id !== merged.$id);
    if (event.action !== "delete") findings.push(merged);
    return withFindingCounts({ ...item, findings });
  }

  if (event.table === "shifts") {
    const shift = asShift(event.payload);
    if (!shift || shift.$id !== item.shift.$id) return item;
    return { ...item, shift: { ...item.shift, ...shift } };
  }

  if (event.table === "agent_jobs") {
    const job = asJob(event.payload);
    if (!job || job.shiftId !== item.shift.$id) return item;
    const current = item.latestJob;
    if (current && current.$createdAt > job.$createdAt) return item;
    return { ...item, latestJob: job };
  }

  return item;
}

export type InboxLiveResult = {
  items: ManagerShiftSummary[];
  needsReload: boolean;
};

const INBOX_STATUSES = new Set(["submitted", "scoring", "scored"]);

export function applyLiveToInbox(
  items: ManagerShiftSummary[],
  event: ParsedLiveEvent,
): InboxLiveResult {
  const shiftId = shiftIdOf(event);

  if (event.table === "shifts") {
    const shift = asShift(event.payload);
    if (!shift) return { items, needsReload: true };
    const index = items.findIndex((row) => row.shift.$id === shift.$id);
    if (event.action === "delete" || !INBOX_STATUSES.has(shift.status)) {
      if (index < 0) return { items, needsReload: false };
      return {
        items: items.filter((row) => row.shift.$id !== shift.$id),
        needsReload: false,
      };
    }
    if (index < 0) {
      return { items, needsReload: true };
    }
    const next = items.slice();
    next[index] = { ...next[index], shift: { ...next[index].shift, ...shift } };
    return { items: next, needsReload: false };
  }

  if (event.table === "findings" || event.table === "agent_jobs") {
    if (!shiftId) return { items, needsReload: false };
    const index = items.findIndex((row) => row.shift.$id === shiftId);
    if (index < 0) {
      return {
        items,
        needsReload: event.table === "findings" && event.action === "create",
      };
    }
    const next = items.slice();
    next[index] = applyLiveToSummary(next[index], event);
    return { items: next, needsReload: false };
  }

  return { items, needsReload: false };
}

export function applyLiveEventsToInbox(
  items: ManagerShiftSummary[],
  events: ParsedLiveEvent[],
): InboxLiveResult {
  let current = items;
  let needsReload = false;
  for (const event of events) {
    const next = applyLiveToInbox(current, event);
    current = next.items;
    needsReload = needsReload || next.needsReload;
  }
  return { items: current, needsReload };
}

export function applyLiveToTasks(tasks: Task[], event: ParsedLiveEvent): Task[] {
  if (event.table !== "tasks") return tasks;
  const task = asTask(event.payload);
  const id = (typeof event.payload.$id === "string" && event.payload.$id) || task?.$id;
  if (event.action === "delete" && id) {
    return tasks.filter((row) => row.$id !== id);
  }
  if (!task) return tasks;
  const rest = tasks.filter((row) => row.$id !== task.$id);
  if (task.status === "done") return rest;
  return [task, ...rest];
}

/** Repeat offenders from rows already on the inbox — no extra listRows. */
export function repeatOffendersFromInbox(
  items: ManagerShiftSummary[],
  limitShifts = 5,
): { itemId: string; label: string; count: number; of: number }[] {
  const scored = items
    .filter(
      (row) =>
        row.shift.status === "scored" || row.shift.status === "closed",
    )
    .slice(0, limitShifts);
  if (scored.length === 0) return [];

  const counts = new Map<string, number>();
  for (const row of scored) {
    const bad = new Set(
      row.findings
        .filter((f) => f.status === "gap" || f.status === "unclear")
        .map((f) => f.itemId),
    );
    for (const id of bad) counts.set(id, (counts.get(id) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([itemId, count]) => ({
      itemId,
      label: itemId,
      count,
      of: scored.length,
    }))
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}
