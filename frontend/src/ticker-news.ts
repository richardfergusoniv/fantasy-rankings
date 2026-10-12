import { isSleeperTimestampOnlyNews } from "../../api/_lib/player-news-filters";
import type { PlayerNews, PlayerNewsItem } from "./dashboard-types";

/** Max items shown in the live ticker strip. */
export const TICKER_NEWS_LIMIT = 10;

/** Season-long overall ranks at or below this count as prominent. */
export const PROMINENT_OVERALL_RANK_LIMIT = 150;

/**
 * News items at or above this score qualify as prominent even when the player
 * is outside the season-long top {@link PROMINENT_OVERALL_RANK_LIMIT}.
 * Scores are 0–100 from the shared news pipeline.
 */
export const HIGH_NEWS_SCORE = 70;

function flattenNews(news: PlayerNews | undefined): PlayerNewsItem[] {
  return (news?.runs ?? [])
    .flatMap((run) => run.items)
    .filter((item) => !isSleeperTimestampOnlyNews(item));
}

/** Highest score first, then newest published time. Missing score sorts last. */
function compareNewsPriority(a: PlayerNewsItem, b: PlayerNewsItem): number {
  const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
  if (scoreDiff !== 0) return scoreDiff;
  const aTime = a.sourcePublishedAt ?? "";
  const bTime = b.sourcePublishedAt ?? "";
  return bTime.localeCompare(aTime);
}

function isProminentItem(
  item: PlayerNewsItem,
  prominentPlayerIds: Set<string>,
  highScore: number,
): boolean {
  if (prominentPlayerIds.has(item.playerId)) return true;
  return (item.score ?? -1) >= highScore;
}

/**
 * Ordered player-news feed for the ticker:
 * 1) selected-league roster news,
 * 2) current-week opponent roster news,
 * 3) remaining prominent shared news (top season-long ranks or high score).
 * Dedupes by identical `change` text and caps at `limit`.
 */
export function newsForTicker(
  news: PlayerNews | undefined,
  rosterPlayerIds: Set<string>,
  opponentPlayerIds: Set<string>,
  prominentPlayerIds: Set<string>,
  options?: { limit?: number; highScore?: number },
): PlayerNewsItem[] {
  const limit = options?.limit ?? TICKER_NEWS_LIMIT;
  const highScore = options?.highScore ?? HIGH_NEWS_SCORE;
  if (limit <= 0) return [];

  const all = flattenNews(news);
  const seenText = new Set<string>();
  const out: PlayerNewsItem[] = [];

  const take = (items: PlayerNewsItem[]) => {
    for (const item of items) {
      if (out.length >= limit) return;
      if (seenText.has(item.change)) continue;
      seenText.add(item.change);
      out.push(item);
    }
  };

  take(
    all
      .filter((item) => rosterPlayerIds.has(item.playerId))
      .sort(compareNewsPriority),
  );

  take(
    all
      .filter((item) => opponentPlayerIds.has(item.playerId) && !rosterPlayerIds.has(item.playerId))
      .sort(compareNewsPriority),
  );

  take(
    all
      .filter((item) => (
        !rosterPlayerIds.has(item.playerId)
        && !opponentPlayerIds.has(item.playerId)
        && isProminentItem(item, prominentPlayerIds, highScore)
      ))
      .sort(compareNewsPriority),
  );

  return out;
}
