import { useEffect, useState } from "react";

/** Re-render once a minute so relative article timestamps stay fresh. */
export function useMinuteNow(enabled = true): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return nowMs;
}
