/**
 * Markers / predicates for shared player-news rows.
 * Kept free of Node-only imports so the frontend can reuse them.
 */

/** roleContext written for legacy Sleeper news_updated-only pings (no longer created). */
export const SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT =
  "Sleeper news_updated timestamp changed without new injury notes.";

export function isSleeperTimestampOnlyNews(item: { roleContext: string }): boolean {
  return item.roleContext === SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT;
}

/**
 * Grouping key for global/league-wide feeds (ticker, multi-player chat).
 * One X roundup may have many rows (one per player); collapse by post id
 * (or source URL when there is no external id) so the post shows once.
 */
export function newsPostDedupeKey(item: {
  source?: string | null;
  externalId?: string | null;
  sourceUrl: string;
}): string {
  const externalId = item.externalId?.trim();
  if (externalId) {
    const source = (item.source ?? "").trim() || "unknown";
    return `${source}:${externalId}`;
  }
  return `url:${item.sourceUrl.trim()}`;
}
