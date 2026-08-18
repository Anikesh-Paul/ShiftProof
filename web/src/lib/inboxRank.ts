import type { ManagerShiftSummary } from "./managerDemo";

export type BacklogCluster = {
  row: ManagerShiftSummary;
  members: ManagerShiftSummary[];
  count: number;
  from: string;
  to: string;
};

export function clusterSubmittedAt(row: ManagerShiftSummary): string {
  return row.shift.submittedAt || row.shift.startedAt || "";
}

function stamp(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

/** Same keep-rule as parsePhotoFileIds — no shifts import (keeps rank testable). */
export function rowHasInboxPhoto(row: ManagerShiftSummary): boolean {
  const raw = row.shift.photoFileIds;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return (
      Array.isArray(parsed) &&
      parsed.some(
        (id) => typeof id === "string" && id.trim().length > 0 && id.trim() !== "—",
      )
    );
  } catch {
    return false;
  }
}

/** Backlog: evidence first, then severity. Photo + N Gap before no-photo swarms. */
export function backlogInboxRank(row: ManagerShiftSummary): number {
  const photo = rowHasInboxPhoto(row);
  if (photo && row.gapCount > 0) return 0;
  if (photo && row.unclearCount > 0) return 1;
  if (row.gapCount > 0) return 2;
  if (row.unclearCount > 0) return 3;
  return 4;
}

export function sortBacklogInbox(
  rows: ManagerShiftSummary[],
): ManagerShiftSummary[] {
  return [...rows].sort((a, b) => {
    const rank = backlogInboxRank(a) - backlogInboxRank(b);
    if (rank !== 0) return rank;
    if (a.gapCount !== b.gapCount) return b.gapCount - a.gapCount;
    return stamp(clusterSubmittedAt(b)) - stamp(clusterSubmittedAt(a));
  });
}

function pickBacklogRepresentative(
  members: ManagerShiftSummary[],
): ManagerShiftSummary {
  const first = members[0];
  if (!first) {
    throw new Error("inbox cluster is empty");
  }
  let best = first;
  for (const row of members) {
    const rank = backlogInboxRank(row) - backlogInboxRank(best);
    if (rank < 0) {
      best = row;
      continue;
    }
    if (rank !== 0) continue;
    if (row.gapCount !== best.gapCount) {
      if (row.gapCount > best.gapCount) best = row;
      continue;
    }
    if (stamp(clusterSubmittedAt(row)) > stamp(clusterSubmittedAt(best))) {
      best = row;
    }
  }
  return best;
}

export function sortBacklogClusters<T extends BacklogCluster>(
  clusters: T[],
): T[] {
  return clusters
    .map((cluster) => ({
      ...cluster,
      row: pickBacklogRepresentative(cluster.members),
    }))
    .sort((a, b) => {
      const rank = backlogInboxRank(a.row) - backlogInboxRank(b.row);
      if (rank !== 0) return rank;
      const aGaps = a.row.gapCount * a.count;
      const bGaps = b.row.gapCount * b.count;
      if (aGaps !== bGaps) return bGaps - aGaps;
      return stamp(clusterSubmittedAt(b.row)) - stamp(clusterSubmittedAt(a.row));
    });
}
