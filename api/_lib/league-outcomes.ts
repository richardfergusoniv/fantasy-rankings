/**
 * Playoff and last-place odds for the chat `get_playoff_odds` calculator tool.
 * Not shown in the app UI (the app presents data; the AI does the projecting).
 * The math lives in an engine (outcomes-engines.ts); this file validates it.
 */
import type { Dashboard } from "./dashboard-schemas.js";
import {
  leagueOutcomesSchema,
  type FetchWeek,
  type LeagueOutcomes,
} from "./league-outcomes-contract.js";
import { resolveOutcomesEngine } from "./outcomes-engines.js";

export type { LeagueOutcomes, OutcomeTeam, FetchWeek } from "./league-outcomes-contract.js";
export { loadScheduleGames, rewindWeek } from "./outcomes-engine-pace.js";

type League = Dashboard["leagues"][number];

/** Run the selected engine and validate its output against the contract. */
export async function buildLeagueOutcomes(
  league: League,
  options: { season?: number; week?: number; fetchWeek?: FetchWeek; engine?: string } = {},
): Promise<LeagueOutcomes | { error: string }> {
  const engine = resolveOutcomesEngine(options.engine);
  const result = await engine.run({
    league,
    season: options.season ?? new Date().getUTCFullYear(),
    week: options.week ?? 0,
    fetchWeek: options.fetchWeek,
  });
  if ("error" in result) return result;
  const checked = leagueOutcomesSchema.safeParse(result);
  if (!checked.success) {
    console.error("[league-outcomes] engine output failed validation", engine.id, checked.error.issues.slice(0, 3));
    return { error: "Outcome odds failed validation." };
  }
  return checked.data;
}
