/**
 * League Outcomes API: each team's chance to make the playoffs and to finish
 * last, now and against an earlier comparison point. The math lives in an
 * engine (outcomes-engines.ts); this file is the HTTP and validation layer.
 */
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import {
  leagueOutcomesSchema,
  type FetchWeek,
  type LeagueOutcomes,
} from "./league-outcomes-contract.js";
import { resolveOutcomesEngine } from "./outcomes-engines.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

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

const querySchema = z.object({ leagueId: z.string().min(1) });

/** GET /api/data/league-outcomes?leagueId= */
export async function handleLeagueOutcomes(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({ leagueId: url.searchParams.get("leagueId") ?? "" });
    if (!parsed.success) return badRequest("Invalid query params.", parsed.error.issues);

    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");
    if (!(await viewerBelongsToLeague(sleeperUserId, parsed.data.leagueId))) {
      return forbidden("League is not in your Sleeper account.");
    }
    const cached = await readUserDashboardCache(sleeperUserId);
    const league = cached?.dashboard.leagues.find((item) => item.id === parsed.data.leagueId);
    if (!cached || !league) return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);

    const result = await buildLeagueOutcomes(league, { season: cached.dashboard.season, week: cached.dashboard.week });
    if ("error" in result) return json({ ok: false, error: result.error }, 422);
    return json(result);
  } catch (err) {
    return internalError(err);
  }
}
