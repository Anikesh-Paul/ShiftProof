/**
 * Demo inbox + findings for manager UI when live rows are empty or unavailable.
 * Shapes match types/shiftproof — not a second schema.
 */
import type { AgentJob, Finding, FindingStatus, Shift } from "../types/shiftproof";

function meta(id: string, createdAt: string) {
  return {
    $id: id,
    $createdAt: createdAt,
    $updatedAt: createdAt,
  };
}

export type ManagerShiftSummary = {
  shift: Shift;
  staffLabel: string;
  gapCount: number;
  unclearCount: number;
  passCount: number;
  findings: Finding[];
  latestJob?: AgentJob | null;
};

/** Boost #1 demo agent trace when no live job. Product-facing steps only. */
export const DEMO_AGENT_TRACE = {
  jobId: "demo_job_a",
  status: "done",
  steps: [
    "Load shift evidence and checklist",
    "Score each checklist item against SOP clauses",
    "Write findings with clause, quote, and confidence",
    "Mark job done and shift scored",
    "3 photos used · 8 findings written",
  ],
  raw: { mode: "stub", photoCount: 3, findingCount: 8 } as Record<
    string,
    unknown
  >,
};

/** Boost #6 demo repeat offenders. */
export const DEMO_REPEAT_OFFENDERS = [
  { itemId: "gloves_worn", label: "Gloves at prep", count: 3, of: 5 },
  { itemId: "counter_clean", label: "Prep counter clean", count: 2, of: 5 },
];

function finding(
  id: string,
  shiftId: string,
  itemId: string,
  status: FindingStatus,
  clauseId: string,
  quote: string,
  confidence: number,
  evidenceNote: string,
  createdAt: string,
): Finding {
  return {
    ...meta(id, createdAt),
    shiftId,
    itemId,
    status,
    clauseId,
    quote,
    confidence,
    evidenceNote,
    source: "ai",
  };
}

const t1 = "2026-07-18T05:42:00.000Z";
const t2 = "2026-07-18T06:10:00.000Z";
const t3 = "2026-07-18T04:55:00.000Z";

const shiftA: Shift = {
  ...meta("demo_shift_a", t1),
  siteId: "demo_cafe",
  checklistId: "opening_fs",
  createdBy: "demo_staff",
  status: "scored",
  photoFileIds: '["p1","p2","p3","p4"]',
  startedAt: t1,
  submittedAt: t1,
  scoredAt: t1,
};

const findingsA: Finding[] = [
  finding(
    "fa1",
    shiftA.$id,
    "gloves_worn",
    "gap",
    "FS-01",
    "Food handlers must wear clean disposable gloves at the prep station.",
    0.86,
    "Bare hands visible while handling utensils; no gloves in frame.",
    t1,
  ),
  finding(
    "fa2",
    shiftA.$id,
    "handwash_sink",
    "gap",
    "FS-02",
    "Handwash sink must be clear, stocked, and accessible before service.",
    0.78,
    "Sink blocked by crates; soap dispenser not visible.",
    t1,
  ),
  finding(
    "fa3",
    shiftA.$id,
    "counter_clean",
    "unclear",
    "FS-04",
    "Food-prep surfaces must be clean and free of debris before service.",
    0.41,
    "Heavy glare on stainless counter; surface condition not reliable.",
    t1,
  ),
  finding(
    "fa4",
    shiftA.$id,
    "fridge_temp",
    "pass",
    "FS-07",
    "Cold storage must show temperature within safe range at open.",
    0.91,
    "Thermometer reading visible within range.",
    t1,
  ),
  finding(
    "fa5",
    shiftA.$id,
    "floor_dry",
    "pass",
    "FS-09",
    "Service floor should be dry and free of slip hazards at open.",
    0.88,
    "Floor appears dry in both frames.",
    t1,
  ),
];

const shiftB: Shift = {
  ...meta("demo_shift_b", t2),
  siteId: "demo_cafe",
  checklistId: "opening_fs",
  createdBy: "demo_staff_2",
  status: "scored",
  photoFileIds: '["p5","p6","p7"]',
  startedAt: t2,
  submittedAt: t2,
  scoredAt: t2,
};

const findingsB: Finding[] = [
  finding(
    "fb1",
    shiftB.$id,
    "trash_area",
    "gap",
    "FS-11",
    "Waste area must be tidy with lids closed before service.",
    0.82,
    "Open bin lid and bags on floor beside station.",
    t2,
  ),
  finding(
    "fb2",
    shiftB.$id,
    "gloves_worn",
    "pass",
    "FS-01",
    "Food handlers must wear clean disposable gloves at the prep station.",
    0.9,
    "Disposable gloves visible on both hands.",
    t2,
  ),
  finding(
    "fb3",
    shiftB.$id,
    "counter_clean",
    "pass",
    "FS-04",
    "Food-prep surfaces must be clean and free of debris before service.",
    0.84,
    "Clear prep surface; no debris visible.",
    t2,
  ),
  finding(
    "fb4",
    shiftB.$id,
    "signage",
    "unclear",
    "FS-12",
    "Allergy / allergen notice must be displayed at the counter.",
    0.52,
    "Sign partially cropped; text not legible.",
    t2,
  ),
  finding(
    "fb5",
    shiftB.$id,
    "floor_dry",
    "pass",
    "FS-09",
    "Service floor should be dry and free of slip hazards at open.",
    0.87,
    "No standing liquid visible.",
    t2,
  ),
];

/** Clean scored shift — only appears when “Show all shifts” is on */
const shiftC: Shift = {
  ...meta("demo_shift_c", t3),
  siteId: "demo_cafe",
  checklistId: "opening_fs",
  createdBy: "demo_staff",
  status: "scored",
  photoFileIds: '["p8","p9","p10"]',
  startedAt: t3,
  submittedAt: t3,
  scoredAt: t3,
};

const findingsC: Finding[] = [
  finding("fc1", shiftC.$id, "gloves_worn", "pass", "FS-01", "Gloves required at prep.", 0.93, "Gloves on.", t3),
  finding("fc2", shiftC.$id, "handwash_sink", "pass", "FS-02", "Handwash sink clear.", 0.9, "Sink clear.", t3),
  finding("fc3", shiftC.$id, "counter_clean", "pass", "FS-04", "Surfaces clean.", 0.89, "Clean counter.", t3),
  finding("fc4", shiftC.$id, "fridge_temp", "pass", "FS-07", "Cold storage safe.", 0.92, "Temp OK.", t3),
  finding("fc5", shiftC.$id, "floor_dry", "pass", "FS-09", "Floor dry.", 0.91, "Dry floor.", t3),
];

const ITEM_LABELS: Record<string, string> = {
  gloves_worn: "Gloves at prep",
  handwash_station: "Handwash station",
  handwash_sink: "Handwash station",
  sanitizer_available: "Sanitizer available",
  counter_clean: "Prep counter clean",
  fridge_temp: "Fridge temperature",
  hair_restraint: "Hair restraint",
  floor_clear: "Floor clear",
  floor_dry: "Floor clear",
  waste_bin_covered: "Waste bin covered",
  trash_area: "Waste bin covered",
  signage: "Allergen notice visible",
};

const liveLabels: Record<string, string> = { ...ITEM_LABELS };

/** Merge live checklist labels so inbox / scoreboard never show raw ids. */
export function hydrateItemLabels(
  items: { id: string; label: string }[],
): void {
  for (const item of items) {
    if (item.id && item.label?.trim()) liveLabels[item.id] = item.label.trim();
  }
}

function titleCaseItemId(itemId: string): string {
  return itemId
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function itemLabel(itemId: string): string {
  return liveLabels[itemId] ?? ITEM_LABELS[itemId] ?? titleCaseItemId(itemId);
}

/** True when the id is on the opening check (static map or hydrated live set). */
export function isKnownItemId(itemId: string): boolean {
  if (!itemId || isHarnessName(itemId)) return false;
  return Object.prototype.hasOwnProperty.call(liveLabels, itemId);
}

/** e2e / harness ids and titles must never surface in the manager inbox. */
export function isHarnessName(text: string): boolean {
  return /\be2e\b/i.test(text) || /durability[-_ ]/i.test(text);
}

function shortenLabelText(live: string): string {
  if (live.length <= 28) return live;
  const beforeMark = live.split(/[?]/)[0]?.trim() ?? live;
  if (beforeMark.length <= 32) return beforeMark;
  return beforeMark.split(/\s+/).slice(0, 3).join(" ");
}

/**
 * Glanceable inbox label. Prefers the short map so live SOP questions
 * do not become chips, row previews, or the H1.
 */
export function shortItemLabel(itemId: string): string {
  if (isHarnessName(itemId)) return "";
  const known = ITEM_LABELS[itemId];
  if (known) return known;
  const live = liveLabels[itemId] ?? titleCaseItemId(itemId);
  if (isHarnessName(live)) return "";
  return shortenLabelText(live);
}

/** Always `Fix:` / `Retake:` + a short item. Never a bare Fix or a full SOP question. */
export function openFixTitle(
  task: { title: string },
  finding?: { itemId: string },
): string {
  const kind = /^retake:/i.test(task.title) ? "Retake" : "Fix";
  if (finding && !isHarnessName(finding.itemId)) {
    const label =
      shortItemLabel(finding.itemId) ||
      shortenLabelText(itemLabel(finding.itemId));
    if (label && !isHarnessName(label)) return `${kind}: ${label}`;
  }
  const stripped = task.title.replace(/^(Fix|Retake):\s*/i, "").trim();
  if (stripped && !isHarnessName(stripped)) {
    const fromId = shortItemLabel(stripped);
    if (fromId) return `${kind}: ${fromId}`;
    const shortened = shortenLabelText(stripped);
    if (shortened && !isHarnessName(shortened)) return `${kind}: ${shortened}`;
  }
  return `${kind}: Opening item`;
}

/** One manager clock: Asia/Kolkata, 24h. */
export function formatManagerWhen(
  iso: string,
  opts?: { year?: boolean },
): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      ...(opts?.year ? { year: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Same clock, collapsed to a range when openings span minutes. */
export function formatManagerWhenRange(fromIso: string, toIso: string): string {
  if (!fromIso) return toIso ? formatManagerWhen(toIso) : "";
  if (!toIso || fromIso === toIso) return formatManagerWhen(fromIso);
  try {
    const zone = "Asia/Kolkata";
    const dateFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
    });
    const timeFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
    const from = new Date(fromIso);
    const to = new Date(toIso);
    const fromTime = timeFmt.format(from);
    const toTime = timeFmt.format(to);
    if (dateFmt.format(from) === dateFmt.format(to)) {
      if (fromTime === toTime) return formatManagerWhen(fromIso);
      return `${dateFmt.format(from)}, ${fromTime}–${toTime}`;
    }
    return `${formatManagerWhen(fromIso)} – ${formatManagerWhen(toIso)}`;
  } catch {
    return formatManagerWhen(fromIso);
  }
}

function summarize(
  shift: Shift,
  staffLabel: string,
  findings: Finding[],
): ManagerShiftSummary {
  return {
    shift,
    staffLabel,
    gapCount: findings.filter((f) => f.status === "gap").length,
    unclearCount: findings.filter((f) => f.status === "unclear").length,
    passCount: findings.filter((f) => f.status === "pass").length,
    findings,
  };
}

export const DEMO_MANAGER_INBOX: ManagerShiftSummary[] = [
  summarize(shiftA, "Priya · Opening", findingsA),
  summarize(shiftB, "Arjun · Opening", findingsB),
  summarize(shiftC, "Priya · Opening", findingsC),
];

export function getDemoShift(shiftId: string): ManagerShiftSummary | undefined {
  return DEMO_MANAGER_INBOX.find((s) => s.shift.$id === shiftId);
}

export function openGapCount(summaries: ManagerShiftSummary[]): number {
  return summaries.reduce((n, s) => n + s.gapCount + s.unclearCount, 0);
}

export function shiftsWithOpenGaps(
  summaries: ManagerShiftSummary[],
): ManagerShiftSummary[] {
  return summaries.filter((s) => s.gapCount + s.unclearCount > 0);
}
