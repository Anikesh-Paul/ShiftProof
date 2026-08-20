/**
 * Open-fix Show all: group by item inside Waiting / Re-check.
 * Default expand stays a 4-row task list — this is only the overflow view.
 */
import type { Task } from "../types/shiftproof";
import {
  isHarnessName,
  itemLabel,
  knownItemFromText,
  shortItemLabel,
  type ManagerShiftSummary,
} from "./managerDemo.ts";

export type OpenFixItemGroup = {
  itemId: string;
  label: string;
  count: number;
  tasks: Task[];
};

function stamp(iso: string | undefined): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function findingForTask(task: Task, items: ManagerShiftSummary[]) {
  const shiftRow = items.find((s) => s.shift.$id === task.shiftId);
  return shiftRow?.findings.find((f) => f.$id === task.findingId);
}

/** Short item label for a task. Never a stored e2e title, never `Fix:`. */
export function openFixItemRef(
  task: { title: string },
  finding?: { itemId: string } | null,
): { itemId: string; label: string } {
  if (finding && !isHarnessName(finding.itemId)) {
    const label =
      shortItemLabel(finding.itemId) || itemLabel(finding.itemId);
    if (label && !isHarnessName(label)) {
      return { itemId: finding.itemId, label };
    }
  }
  const stripped = task.title.replace(/^(Fix|Retake):\s*/i, "").trim();
  const known = knownItemFromText(stripped);
  if (known) return known;
  if (stripped && !isHarnessName(stripped)) {
    return { itemId: stripped.toLowerCase(), label: stripped };
  }
  return { itemId: "_opening", label: "Opening item" };
}

export function groupOpenFixesByItem(
  tasks: Task[],
  items: ManagerShiftSummary[],
): OpenFixItemGroup[] {
  const groups = new Map<string, OpenFixItemGroup>();
  const order: string[] = [];
  for (const task of tasks) {
    const finding = findingForTask(task, items);
    const ref = openFixItemRef(task, finding);
    const key = ref.label.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      existing.count += 1;
      if (finding && !isHarnessName(finding.itemId)) {
        existing.itemId = finding.itemId;
        existing.label = ref.label;
      }
    } else {
      groups.set(key, {
        itemId: ref.itemId,
        label: ref.label,
        count: 1,
        tasks: [task],
      });
      order.push(key);
    }
  }
  return order
    .map((key) => {
      const group = groups.get(key);
      if (!group) throw new Error("open-fix group missing");
      const newestFirst = [...group.tasks].sort(
        (a, b) => stamp(b.createdAt) - stamp(a.createdAt),
      );
      return { ...group, tasks: newestFirst, count: newestFirst.length };
    })
    .sort((a, b) => {
      const byCount = b.count - a.count;
      if (byCount !== 0) return byCount;
      return a.label.localeCompare(b.label);
    });
}
