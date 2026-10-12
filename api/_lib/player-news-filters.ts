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
