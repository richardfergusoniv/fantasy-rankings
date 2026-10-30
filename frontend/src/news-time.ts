/**
 * News timestamp labels. Kept free of React/UI imports so vitest can cover them.
 */

export function newsAbsoluteTimeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Relative time for article news ("just now" / "5m ago" / "3h ago"); older falls back to absolute. */
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

/** Article items use relative time; X / Sleeper keep the absolute stamp. */
export function newsItemTimeLabel(
  item: { source?: string | null; sourcePublishedAt?: string | null },
  nowMs = Date.now(),
): string {
  if (!item.sourcePublishedAt) return "Recent";
  if (item.source === "article") return newsRelativeTimeLabel(item.sourcePublishedAt, nowMs);
  return newsAbsoluteTimeLabel(item.sourcePublishedAt);
}
