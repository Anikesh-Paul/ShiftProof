/**
 * Today inbox clustering: same staff + kind + open-item signature.
 * All stays an unclustered ledger — call asInboxClusters there.
 * Backlog clusters sort with backlogInboxRank (photo + N Gap first).
 */
import { displayStaffName } from "./staffNames";
import { isSameLocalDay, isStuckScoring } from "./manager";
import { shortItemLabel, type ManagerShiftSummary } from "./managerDemo";
import { clusterSubmittedAt } from "./inboxRank";

export {
  backlogInboxRank,
  clusterSubmittedAt,
  rowHasInboxPhoto,
  sortBacklogClusters,
  sortBacklogInbox,
} from "./inboxRank";

export const CLUSTER_SIBLING_CAP = 4;

export type InboxCluster = {
  row: ManagerShiftSummary;
  members: ManagerShiftSummary[];
  count: number;
  from: string;
  to: string;
};

export function todayInboxRank(row: ManagerShiftSummary): number {
  if (row.gapCount > 0) return 0;
  if (row.unclearCount > 0) return 1;
  if (row.latestJob?.status === "failed") return 3;
  if (
    isStuckScoring(row.shift, row.latestJob) ||
    row.shift.status === "submitted" ||
    row.shift.status === "scoring"
  ) {
    return 2;
  }
  return 4;
}

export function sortTodayInbox(
  rows: ManagerShiftSummary[],
): ManagerShiftSummary[] {
  return [...rows].sort((a, b) => todayInboxRank(a) - todayInboxRank(b));
}

export function inboxClusterKey(row: ManagerShiftSummary): string {
  const staff = row.shift.createdBy || displayStaffName(row.staffLabel);
  const kind =
    row.gapCount > 0
      ? "gap"
      : row.unclearCount > 0
        ? "unclear"
        : row.latestJob?.status === "failed"
          ? "failed"
          : isStuckScoring(row.shift, row.latestJob)
            ? "stuck"
            : "wait";
  const open = row.findings
    .filter((f) => f.status === "gap" || f.status === "unclear")
    .map((f) => `${f.itemId}:${f.status}`)
    .sort()
    .join(",");
  return `${staff}|${kind}|${open}`;
}

function stamp(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function pickClusterRepresentative(
  members: ManagerShiftSummary[],
): ManagerShiftSummary {
  const first = members[0];
  if (!first) {
    throw new Error("inbox cluster is empty");
  }
  let best = first;
  for (const row of members) {
    const rank = todayInboxRank(row) - todayInboxRank(best);
    if (rank < 0) {
      best = row;
      continue;
    }
    if (
      rank === 0 &&
      stamp(clusterSubmittedAt(row)) > stamp(clusterSubmittedAt(best))
    ) {
      best = row;
    }
  }
  return best;
}

export function asInboxClusters(rows: ManagerShiftSummary[]): InboxCluster[] {
  return rows.map((row) => {
    const when = clusterSubmittedAt(row);
    return { row, members: [row], count: 1, from: when, to: when };
  });
}

export function clusterInboxRows(rows: ManagerShiftSummary[]): InboxCluster[] {
  const groups = new Map<string, ManagerShiftSummary[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = inboxClusterKey(row);
    const list = groups.get(key);
    if (list) {
      list.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = groups.get(key) ?? [];
    const row = pickClusterRepresentative(members);
    const times = members.map(clusterSubmittedAt).filter(Boolean).sort();
    return {
      row,
      members,
      count: members.length,
      from: times[0] || clusterSubmittedAt(row),
      to: times[times.length - 1] || clusterSubmittedAt(row),
    };
  });
}

export function todayInboxNeeds(
  items: ManagerShiftSummary[],
  timeZone: string,
): ManagerShiftSummary[] {
  const todayNeeds = items.filter((s) => {
    if (!isSameLocalDay(s.shift.submittedAt || s.shift.startedAt, timeZone)) {
      return false;
    }
    if (isStuckScoring(s.shift, s.latestJob)) return false;
    if (
      s.latestJob?.status === "failed" &&
      s.gapCount === 0 &&
      s.unclearCount === 0
    ) {
      return false;
    }
    return (
      s.gapCount > 0 ||
      s.unclearCount > 0 ||
      s.shift.status === "submitted" ||
      s.shift.status === "scoring"
    );
  });
  return sortTodayInbox(todayNeeds);
}

export type InboxListView = "today" | "backlog" | "all";

function backlogInboxNeeds(
  items: ManagerShiftSummary[],
  timeZone: string,
): ManagerShiftSummary[] {
  return items.filter((s) => {
    if (isSameLocalDay(s.shift.submittedAt || s.shift.startedAt, timeZone)) {
      return false;
    }
    if (isStuckScoring(s.shift, s.latestJob)) return false;
    return s.gapCount > 0 || s.unclearCount > 0;
  });
}

function matchesInboxItem(
  row: ManagerShiftSummary,
  itemId: string,
): boolean {
  return row.findings.some(
    (f) =>
      f.itemId === itemId &&
      (f.status === "gap" || f.status === "unclear"),
  );
}

/**
 * View first, then item. A chip must not replace Today with the all-time list.
 */
export function inboxRowsForView(
  items: ManagerShiftSummary[],
  view: InboxListView,
  timeZone: string,
  itemFilter?: string | null,
): ManagerShiftSummary[] {
  const scoped =
    view === "all"
      ? items
      : view === "backlog"
        ? backlogInboxNeeds(items, timeZone)
        : todayInboxNeeds(items, timeZone);
  if (!itemFilter) return scoped;
  return scoped.filter((row) => matchesInboxItem(row, itemFilter));
}

export function todayClusterForShift(
  items: ManagerShiftSummary[],
  shiftId: string,
  timeZone: string,
): InboxCluster | null {
  const clusters = clusterInboxRows(todayInboxNeeds(items, timeZone));
  return (
    clusters.find((c) => c.members.some((m) => m.shift.$id === shiftId)) ??
    null
  );
}

export type ClusterRemainder = {
  line: string;
  action: string;
  siblings: ManagerShiftSummary[];
};

export function clusterRemainderCopy(
  cluster: InboxCluster,
  currentId: string,
): ClusterRemainder | null {
  if (cluster.count < 2) return null;
  const siblings = cluster.members
    .filter((m) => m.shift.$id !== currentId)
    .sort(
      (a, b) => stamp(clusterSubmittedAt(b)) - stamp(clusterSubmittedAt(a)),
    );
  if (siblings.length === 0) return null;

  const item = cluster.row.findings.find(
    (f) => f.status === "gap" || f.status === "unclear",
  );
  const label = item ? shortItemLabel(item.itemId).toLowerCase() : "";
  const kindBit =
    cluster.row.gapCount > 0
      ? "gaps"
      : cluster.row.unclearCount > 0
        ? "unclear"
        : "waiting";
  const line = label
    ? `1 of ${cluster.count} same-staff ${label} ${kindBit} today`
    : `1 of ${cluster.count} same-staff ${kindBit} today`;
  const other = siblings.length;
  const action =
    other === 1 ? "See the other opening" : `See the other ${other}`;
  return { line, action, siblings };
}
