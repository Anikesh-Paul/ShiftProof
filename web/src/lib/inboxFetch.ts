/**
 * Inbox list window: recency page plus pinned photo rows that recency dropped.
 * Rank (backlogInboxRank) can only lift rows this window actually fetched.
 */
export const INBOX_RECENCY_LIMIT = 50;
export const INBOX_EVIDENCE_PAGES = 2;

export type InboxShiftSeed = {
  $id: string;
  photoFileIds?: string;
};

/** Same keep-rule as parsePhotoFileIds / rowHasInboxPhoto. */
export function shiftHasListedPhoto(shift: InboxShiftSeed): boolean {
  const raw = shift.photoFileIds;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return (
      Array.isArray(parsed) &&
      parsed.some(
        (id) =>
          typeof id === "string" && id.trim().length > 0 && id.trim() !== "—",
      )
    );
  } catch {
    return false;
  }
}

export function inboxRecencyTruncated(
  total: number,
  recencyCount: number,
): boolean {
  return total > recencyCount;
}

/** Recency first; older photo rows appended, de-duped. No-photo extras stay dropped. */
export function mergeRecencyWithEvidence<T extends InboxShiftSeed>(
  recent: T[],
  older: T[],
): T[] {
  const seen = new Set(recent.map((row) => row.$id));
  const pinned: T[] = [];
  for (const row of older) {
    if (seen.has(row.$id)) continue;
    if (!shiftHasListedPhoto(row)) continue;
    seen.add(row.$id);
    pinned.push(row);
  }
  return recent.concat(pinned);
}
