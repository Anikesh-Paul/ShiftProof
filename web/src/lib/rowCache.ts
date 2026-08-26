/**
 * Session-scoped row cache so inbox/detail/staff do not re-list the same
 * findings and jobs on every realtime tick or navigation.
 */
import type { AgentJob, Finding } from "../types/shiftproof";

const findingsByShift = new Map<string, Finding[]>();
const jobsByShift = new Map<string, AgentJob>();

export function peekFindings(shiftId: string): Finding[] | undefined {
  return findingsByShift.get(shiftId);
}

export function rememberFindings(shiftId: string, findings: Finding[]): void {
  findingsByShift.set(shiftId, findings);
}

/** Empty lists are not cached — scoring rows start empty and must re-list. */
export function rememberFindingsIfPresent(
  shiftId: string,
  findings: Finding[],
): void {
  if (findings.length === 0) return;
  rememberFindings(shiftId, findings);
}

export function forgetFindings(shiftId?: string): void {
  if (shiftId) findingsByShift.delete(shiftId);
  else findingsByShift.clear();
}

export function upsertCachedFinding(finding: Finding): void {
  const current = findingsByShift.get(finding.shiftId);
  if (!current) return;
  const next = current.filter((row) => row.$id !== finding.$id);
  next.push(finding);
  findingsByShift.set(finding.shiftId, next);
}

export function removeCachedFinding(shiftId: string, findingId: string): void {
  const current = findingsByShift.get(shiftId);
  if (!current) return;
  findingsByShift.set(
    shiftId,
    current.filter((row) => row.$id !== findingId),
  );
}

export function peekLatestJob(shiftId: string): AgentJob | undefined {
  return jobsByShift.get(shiftId);
}

export function rememberLatestJob(shiftId: string, job: AgentJob): void {
  const existing = jobsByShift.get(shiftId);
  if (existing && existing.$id === job.$id) {
    if ((existing.$updatedAt || "") > (job.$updatedAt || "")) return;
  } else if (existing && isNewerJob(existing, job)) {
    return;
  }
  jobsByShift.set(shiftId, job);
}

export function forgetLatestJob(shiftId?: string): void {
  if (shiftId) jobsByShift.delete(shiftId);
  else jobsByShift.clear();
}

export function isNewerJob(current: AgentJob, candidate: AgentJob): boolean {
  const a = current.$createdAt || "";
  const b = candidate.$createdAt || "";
  return a > b;
}

export function resetRowCaches(): void {
  findingsByShift.clear();
  jobsByShift.clear();
}

/** Keep the list cache in sync after a local realtime patch. */
export function rememberSummaryRows(item: {
  shift: { $id: string };
  findings: Finding[];
  latestJob?: AgentJob | null;
}): void {
  if (peekFindings(item.shift.$id)) {
    if (item.findings.length) rememberFindings(item.shift.$id, item.findings);
    else forgetFindings(item.shift.$id);
  }
  if (item.latestJob) rememberLatestJob(item.shift.$id, item.latestJob);
}
