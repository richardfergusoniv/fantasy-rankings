/**
 * Head-to-head schedule for a Sleeper league: who plays whom each week.
 */
import type { OddsGame } from "./playoff-odds.js";
import { fetchJson, SLEEPER_BASE } from "./sleeper.js";

export type SleeperMatchupRow = { roster_id: number; matchup_id?: number | null; points?: number; custom_points?: number | null };
export type FetchWeek = (leagueId: string, week: number) => Promise<SleeperMatchupRow[]>;

export const DEFAULT_LAST_REGULAR_WEEK = 14;

export const defaultFetchWeek: FetchWeek = (leagueId, week) =>
  fetchJson<SleeperMatchupRow[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`);

/** Head-to-head pairs for each week; weeks that fail to load are reported, not guessed. */
export async function loadScheduleGames(
  leagueId: string,
  weeks: readonly number[],
  fetchWeek: FetchWeek = defaultFetchWeek,
): Promise<{ games: OddsGame[]; missingWeeks: number[] }> {
  const results = await Promise.allSettled(weeks.map((week) => fetchWeek(leagueId, week)));
  const games: OddsGame[] = [];
  const missingWeeks: number[] = [];
  results.forEach((result, i) => {
    const week = weeks[i]!;
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
      missingWeeks.push(week);
      return;
    }
    const byMatchup = new Map<number, number[]>();
    for (const row of result.value) {
      if (row.matchup_id == null) continue;
      byMatchup.set(row.matchup_id, [...(byMatchup.get(row.matchup_id) ?? []), row.roster_id]);
    }
    for (const pair of byMatchup.values()) {
      if (pair.length === 2) games.push({ week, a: pair[0]!, b: pair[1]! });
    }
  });
  return { games, missingWeeks };
}
