import {
  isPlayerScopedNews,
  isSleeperTimestampOnlyNews,
  newsPostDedupeKey,
  newsVisibleInContext,
} from "../../../api/_lib/player-news-filters";
import type { League, PlayerNews, PlayerNewsItem } from "../dashboard-types";

/** Monitor shows news from the last three days. */
export const MONITOR_NEWS_WINDOW_MS = 72 * 60 * 60 * 1000;
/** Monitor shows at most this many items. */
export const MONITOR_NEWS_LIMIT = 5;

export type MonitorNewsEntry = {
  item: PlayerNewsItem;
  /** Leagues where this player is on your roster and the news applies. */
  leagues: Array<{ id: string; name: string }>;
};

type RosterLeague = Pick<League, "id" | "name" | "starters" | "bench"> & {
  seasonLongFormat: Pick<League["seasonLongFormat"], "isDynasty">;
  /** Every roster in the league; the user's entry also holds players in IR and taxi slots, which starters and bench leave out. */
  tradeTeams?: ReadonlyArray<{ isUser: boolean; players: ReadonlyArray<{ playerId: string }> }>;
};

/**
 * The most important news about players you roster in any league: newest three
 * days only, highest news score first, then newest. Dynasty-tagged news counts
 * only for dynasty leagues. A post that names several players appears once.
 */
export function monitorNews(
  news: PlayerNews | undefined,
  leagues: readonly RosterLeague[],
  now = Date.now(),
  limit = MONITOR_NEWS_LIMIT,
): MonitorNewsEntry[] {
  if (!news || limit <= 0) return [];
  const leaguesByPlayer = new Map<string, RosterLeague[]>();
  for (const league of leagues) {
    const owned = new Set<string>();
    for (const player of [...league.starters, ...league.bench, ...(league.tradeTeams?.find((team) => team.isUser)?.players ?? [])]) {
      if (player.playerId !== "0") owned.add(player.playerId);
    }
    for (const playerId of owned) {
      const list = leaguesByPlayer.get(playerId) ?? [];
      list.push(league);
      leaguesByPlayer.set(playerId, list);
    }
  }

  const candidates: MonitorNewsEntry[] = [];
  for (const run of news.runs) {
    for (const item of run.items) {
      if (isSleeperTimestampOnlyNews(item) || !isPlayerScopedNews(item) || item.playerId == null) continue;
      const published = item.sourcePublishedAt ? Date.parse(item.sourcePublishedAt) : Date.parse(run.checkedAt);
      if (!Number.isFinite(published) || now - published > MONITOR_NEWS_WINDOW_MS) continue;
      const applicable = (leaguesByPlayer.get(item.playerId) ?? [])
        .filter((league) => newsVisibleInContext(item, league.seasonLongFormat.isDynasty));
      if (applicable.length === 0) continue;
      candidates.push({ item, leagues: applicable.map((league) => ({ id: league.id, name: league.name })) });
    }
  }

  const time = (entry: MonitorNewsEntry) => Date.parse(entry.item.sourcePublishedAt ?? "") || 0;
  candidates.sort((a, b) => (b.item.score ?? -1) - (a.item.score ?? -1) || time(b) - time(a));

  const seenPost = new Set<string>();
  const seenText = new Set<string>();
  const out: MonitorNewsEntry[] = [];
  for (const entry of candidates) {
    const postKey = newsPostDedupeKey(entry.item);
    if (seenPost.has(postKey) || seenText.has(entry.item.change)) continue;
    seenPost.add(postKey);
    seenText.add(entry.item.change);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
