import type { AuditEvent, FindingSource } from "../types/shiftproof";

/** Product labels for finding source. Never present staff_recheck as AI. */
export function formatFindingSource(source: FindingSource | string): string {
  switch (source) {
    case "staff_recheck":
      return "Staff attested";
    case "manager_override":
      return "Manager override";
    default:
      return "AI";
  }
}

/** Product labels for audit event types. */
export function formatEventType(type: string): string {
  switch (type) {
    case "finding.overridden":
      return "Override";
    case "task.created":
      return "Task created";
    case "task.recheck":
      return "Re-check photo";
    case "finding.attested":
      return "Staff attested";
    case "finding.rescored":
      return "Re-scored";
    case "task.done":
      return "Task done";
    case "shift.submitted":
      return "Submitted";
    case "shift.closed":
      return "Closed";
    case "job.done":
      return "Scored";
    case "job.failed":
      return "Score failed";
    case "job.retry":
      return "Score retried";
    default:
      return type;
  }
}

/** Reason on the newest event payload, if present (e.g. shift.closed). */
export function latestEventReason(events: AuditEvent[]): string | undefined {
  const latest = events[0];
  if (!latest?.payloadJson) return undefined;
  try {
    const payload = JSON.parse(latest.payloadJson) as { reason?: unknown };
    return typeof payload.reason === "string" ? payload.reason : undefined;
  } catch {
    return undefined;
  }
}
