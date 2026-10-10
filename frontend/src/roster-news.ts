import type { PlayerNews, PlayerNewsItem } from "./dashboard-types";

/** Latest shared news for players on the selected-league roster (ticker). */
export function rosterNewsForTicker(
  news: PlayerNews | undefined,
  rosterPlayerIds: Set<string>,
): PlayerNewsItem[] {
  const seen = new Set<string>();
  return (news?.runs ?? [])
    .flatMap((run) => run.items)
    .filter((item) => {
      if (!rosterPlayerIds.has(item.playerId) || seen.has(item.change)) return false;
      seen.add(item.change);
      return true;
    });
}
