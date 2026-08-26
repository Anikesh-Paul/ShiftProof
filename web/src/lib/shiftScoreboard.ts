/**
 * Denormalized scoreboard on the Shift row so the inbox does not list findings.
 * openFindingsJson holds only Gap/Unclear seeds (id + itemId + status) for
 * assign, item filter, preview, and repeat offenders.
 */
import type { Finding, FindingStatus, Shift } from "../types/shiftproof";
import type { ManagerShiftSummary } from "./managerDemo";

export type OpenFindingSeed = {
  $id: string;
  itemId: string;
  status: "gap" | "unclear";
};

export type ShiftScoreboard = {
  gapCount: number;
  unclearCount: number;
  passCount: number;
  openFindings: OpenFindingSeed[];
};

export function scoreboardFromFindings(
  findings: Array<{ $id: string; itemId: string; status: string }>,
): ShiftScoreboard {
  const openFindings: OpenFindingSeed[] = [];
  let gapCount = 0;
  let unclearCount = 0;
  let passCount = 0;
  for (const row of findings) {
    if (row.status === "gap") {
      gapCount += 1;
      openFindings.push({
        $id: row.$id,
        itemId: row.itemId,
        status: "gap",
      });
    } else if (row.status === "unclear") {
      unclearCount += 1;
      openFindings.push({
        $id: row.$id,
        itemId: row.itemId,
        status: "unclear",
      });
    } else if (row.status === "pass") {
      passCount += 1;
    }
  }
  return { gapCount, unclearCount, passCount, openFindings };
}

export function serializeOpenFindings(open: OpenFindingSeed[]): string {
  return JSON.stringify(
    open.map((row) => [row.$id, row.itemId, row.status === "gap" ? 0 : 1]),
  );
}

export function parseOpenFindings(raw?: string | null): OpenFindingSeed[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: OpenFindingSeed[] = [];
    for (const row of parsed) {
      if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
        out.push({
          $id: row[0],
          itemId: row[1],
          status: row[2] === 1 ? "unclear" : "gap",
        });
        continue;
      }
      if (
        row &&
        typeof row === "object" &&
        typeof (row as OpenFindingSeed).$id === "string" &&
        typeof (row as OpenFindingSeed).itemId === "string"
      ) {
        const status = (row as OpenFindingSeed).status;
        if (status === "gap" || status === "unclear") {
          out.push({
            $id: (row as OpenFindingSeed).$id,
            itemId: (row as OpenFindingSeed).itemId,
            status,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function shiftHasScoreboard(shift: {
  gapCount?: number | null;
  openFindingsJson?: string | null;
}): boolean {
  return typeof shift.openFindingsJson === "string";
}

export function scoreboardFromShift(shift: {
  gapCount?: number | null;
  unclearCount?: number | null;
  passCount?: number | null;
  openFindingsJson?: string | null;
}): ShiftScoreboard {
  const openFindings = parseOpenFindings(shift.openFindingsJson);
  if (typeof shift.gapCount === "number") {
    return {
      gapCount: shift.gapCount,
      unclearCount: shift.unclearCount ?? 0,
      passCount: shift.passCount ?? 0,
      openFindings,
    };
  }
  return {
    gapCount: openFindings.filter((row) => row.status === "gap").length,
    unclearCount: openFindings.filter((row) => row.status === "unclear").length,
    passCount: 0,
    openFindings,
  };
}

export function scoreboardWritePayload(board: ShiftScoreboard): {
  gapCount: number;
  unclearCount: number;
  passCount: number;
  openFindingsJson: string;
} {
  return {
    gapCount: board.gapCount,
    unclearCount: board.unclearCount,
    passCount: board.passCount,
    openFindingsJson: serializeOpenFindings(board.openFindings),
  };
}

/** Inbox-only Finding stubs — no quote/evidence. Scoreboard still loads live rows. */
export function inboxFindingsFromShift(
  shift: Shift,
  extras?: Finding[],
): Finding[] {
  const seeds = parseOpenFindings(shift.openFindingsJson);
  if (seeds.length === 0 && extras?.length) return extras;
  const at = shift.$updatedAt || shift.scoredAt || shift.submittedAt || "";
  return seeds.map((seed) => ({
    $id: seed.$id,
    $createdAt: at,
    $updatedAt: at,
    shiftId: shift.$id,
    itemId: seed.itemId,
    status: seed.status as FindingStatus,
    clauseId: "",
    quote: "",
    confidence: 0,
    evidenceNote: "",
    source: "ai",
  }));
}

export function applyScoreboardToSummary(
  item: ManagerShiftSummary,
): ManagerShiftSummary {
  if (!shiftHasScoreboard(item.shift)) return item;
  const board = scoreboardFromShift(item.shift);
  return {
    ...item,
    findings: inboxFindingsFromShift(item.shift),
    gapCount: board.gapCount,
    unclearCount: board.unclearCount,
    passCount: board.passCount,
  };
}
