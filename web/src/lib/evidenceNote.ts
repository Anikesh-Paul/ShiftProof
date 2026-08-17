/**
 * Stored evidence note as shown to people. Pack and staff Your scores
 * hide seeded / e2e placeholder strings — never invent a retake line.
 */
export function displayEvidenceNote(note: string | undefined): string | null {
  if (!note?.trim()) return null;
  if (/seeded e2e finding\.?/i.test(note.trim())) return null;
  if (/seeded/i.test(note.trim())) return null;
  return note;
}
