import { useEffect, useState } from "react";

/** True after `delayMs` while still loading — for soft “still working” copy. */
export function useSlowLoading(loading: boolean, delayMs = 2000): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(id);
  }, [loading, delayMs]);

  return slow;
}
