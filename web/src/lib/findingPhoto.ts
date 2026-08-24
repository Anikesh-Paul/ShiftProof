/**
 * Map a finding to an evidence file. Slotted / 1:1 mapping is applied by
 * photoForItem; this fallback reads a "Photo N" cite from the evidence note
 * against the compact pool the scorer numbered (1-based).
 */

/** 1-based Photo N cite, or null when the note does not name a photo. */
export function photoIndexFromNote(note: string | undefined): number | null {
  if (!note) return null;
  const match =
    /\b(?:photos?|images?|imgs?|pics?|pictures?)\s*#?\s*(\d+)\b/i.exec(note);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** File id for Photo N in the compact evidence pool, or null if unmapped. */
export function photoIdFromNote(
  note: string | undefined,
  evidenceIds: string[],
): string | null {
  const n = photoIndexFromNote(note);
  if (n == null) return null;
  return evidenceIds[n - 1] ?? null;
}
