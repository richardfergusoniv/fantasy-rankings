/**
 * News timestamp labels. Kept free of React/UI imports so vitest can cover them.
 * Absolute stamps use Pacific time so ticker, player-card, and news-modal labels match.
 */

const NEWS_TIME_ZONE = "America/Los_Angeles";

export function newsAbsoluteTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: NEWS_TIME_ZONE,
  }).format(new Date(value));
}

/** Relative time ("just now" / "5m ago" / "3h ago"); older falls back to absolute Pacific. */
export function newsRelativeTimeLabel(value: string, nowMs = Date.now()): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Recent";
  const diffMs = Math.max(0, nowMs - time);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return newsAbsoluteTimeLabel(value);
}

/** Same relative/absolute treatment for every news source (article, X, Sleeper). */
export function newsItemTimeLabel(
  item: { source?: string | null; sourcePublishedAt?: string | null },
  nowMs = Date.now(),
): string {
  if (!item.sourcePublishedAt) return "Recent";
  return newsRelativeTimeLabel(item.sourcePublishedAt, nowMs);
}
