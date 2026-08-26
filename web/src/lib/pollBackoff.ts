/** Job-status poll waits: start short, then back off so a 3-minute wait is not 90 reads. */
export const POLL_INITIAL_MS = 2_000;
export const POLL_MAX_MS = 12_000;
export const POLL_FACTOR = 1.5;

export function nextPollDelay(
  previousMs: number | null,
  opts?: { initialMs?: number; maxMs?: number; factor?: number },
): number {
  const initialMs = opts?.initialMs ?? POLL_INITIAL_MS;
  const maxMs = opts?.maxMs ?? POLL_MAX_MS;
  const factor = opts?.factor ?? POLL_FACTOR;
  if (previousMs == null || previousMs <= 0) return initialMs;
  return Math.min(maxMs, Math.round(previousMs * factor));
}

export function pollDelaySequence(
  timeoutMs: number,
  opts?: { initialMs?: number; maxMs?: number; factor?: number },
): number[] {
  const delays: number[] = [];
  let wait: number | null = null;
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    wait = nextPollDelay(wait, opts);
    delays.push(wait);
    elapsed += wait;
  }
  return delays;
}
