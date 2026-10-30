import {
  isSleeperTimestampOnlyNews,
  newsPostDedupeKey,
  newsVisibleInContext,
} from "../../api/_lib/player-news-filters";
import type { PlayerNews, PlayerNewsItem } from "./dashboard-types";

/** Latest shared news for players on the selected-league roster (ticker). */
export function rosterNewsForTicker(
  news: PlayerNews | undefined,
  rosterPlayerIds: Set<string>,
  options?: { isDynastyContext?: boolean },
): PlayerNewsItem[] {
  const isDynastyContext = options?.isDynastyContext ?? false;
  const seenPost = new Set<string>();
  const seenText = new Set<string>();
  return (news?.runs ?? [])
    .flatMap((run) => run.items)
    .filter((item) => {
      if (isSleeperTimestampOnlyNews(item)) return false;
      if (!newsVisibleInContext(item, isDynastyContext)) return false;
      if (!item.playerId || !rosterPlayerIds.has(item.playerId)) return false;
      const postKey = newsPostDedupeKey(item);
      if (seenPost.has(postKey) || seenText.has(item.change)) return false;
      seenPost.add(postKey);
      seenText.add(item.change);
      return true;
    });
}
