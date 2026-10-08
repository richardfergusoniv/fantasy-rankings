import { z } from "zod";
import {
  badRequest,
  getRequestUser,
  internalError,
  isAdminUserId,
  json,
} from "./_lib/api-utils.js";
import { canonicalTeam, fetchJson } from "./_lib/sleeper.js";

/**
 * GET /api/box-score?team=&opponent=&season=&week=
 *
 * Replaces `getMatchupBoxScore`. Admin-only (was owner-gated in Hatch).
 * Looks up a game's final score via ESPN's public scoreboard API.
 *
 * Query params:
 * - team (required): 2–3 letter code, e.g. "KC"
 * - opponent (required): 2–3 letter code
 * - season (required): e.g. 2026
 * - week (required): 1–18 regular season, 19–22 postseason
 */

const querySchema = z.object({
  team: z.string().trim().min(2).max(3),
  opponent: z.string().trim().min(2).max(3),
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
});

const matchupBoxScoreResponse = z.object({
  status: z.enum(["available", "not_final", "unavailable", "owner_required"]),
  game: z.object({
    title: z.string(),
    score: z.string(),
    state: z.string().nullable(),
    startsAt: z.string().nullable(),
    home: z.string().nullable(),
    away: z.string().nullable(),
    sourceLabel: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    fetchedAt: z.string(),
  }).nullable(),
});

export type MatchupBoxScore = z.infer<typeof matchupBoxScoreResponse>;

type EspnScoreboard = {
  season?: { year?: number };
  events?: Array<{
    id?: string;
    date?: string;
    name?: string;
    shortName?: string;
    links?: Array<{ href?: string }>;
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: string;
        winner?: boolean;
        score?: string;
        team?: { abbreviation?: string; displayName?: string };
      }>;
      status?: { type?: { completed?: boolean; description?: string } };
    }>;
  }>;
};

function espnWeekParams(week: number): { seasontype: number; week: number } {
  // ESPN numbers postseason weeks 1–4 within seasontype=3.
  if (week > 18) return { seasontype: 3, week: week - 18 };
  return { seasontype: 2, week };
}

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await getRequestUser(req);
    if (!isAdminUserId(user?.id)) {
      return json(matchupBoxScoreResponse.parse({ status: "owner_required", game: null }));
    }

    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({
      team: url.searchParams.get("team") ?? undefined,
      opponent: url.searchParams.get("opponent") ?? undefined,
      season: url.searchParams.get("season") === null ? undefined : Number(url.searchParams.get("season")),
      week: url.searchParams.get("week") === null ? undefined : Number(url.searchParams.get("week")),
    });
    if (!parsed.success) return badRequest("Invalid query params", parsed.error.issues);

    try {
      const team = canonicalTeam(parsed.data.team.toUpperCase());
      const opponent = canonicalTeam(parsed.data.opponent.toUpperCase());
      const { seasontype, week } = espnWeekParams(parsed.data.week);
      const board = await fetchJson<EspnScoreboard>(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&week=${week}`,
      );
      // Guard against ESPN returning the current season when the requested
      // season is historical.
      if (board.season?.year !== undefined && board.season.year !== parsed.data.season) {
        return json(matchupBoxScoreResponse.parse({ status: "unavailable", game: null }));
      }
      const event = (board.events ?? []).find((candidate) => {
        const codes = new Set(
          (candidate.competitions ?? []).flatMap((comp) =>
            (comp.competitors ?? []).map((c) => canonicalTeam((c.team?.abbreviation ?? "").toUpperCase())),
          ),
        );
        return codes.has(team) && codes.has(opponent);
      });
      if (!event) return json(matchupBoxScoreResponse.parse({ status: "unavailable", game: null }));

      const competition = event.competitions?.[0];
      const competitors = competition?.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      const homeAbbr = home?.team?.abbreviation ? canonicalTeam(home.team.abbreviation.toUpperCase()) : null;
      const awayAbbr = away?.team?.abbreviation ? canonicalTeam(away.team.abbreviation.toUpperCase()) : null;
      const homeScore = home?.score ?? "";
      const awayScore = away?.score ?? "";
      const state = competition?.status?.type?.description?.trim() || null;
      const isFinal = competition?.status?.type?.completed === true;
      const game = {
        title: event.shortName ?? event.name ?? `${awayAbbr ?? "?"} @ ${homeAbbr ?? "?"}`,
        score: homeScore && awayScore ? `${awayAbbr} ${awayScore} – ${homeAbbr} ${homeScore}` : "",
        state,
        startsAt: event.date ?? null,
        home: homeAbbr,
        away: awayAbbr,
        sourceLabel: "ESPN",
        sourceUrl: event.links?.[0]?.href ?? null,
        fetchedAt: new Date().toISOString(),
      };
      if (!isFinal || !game.score) {
        return json(matchupBoxScoreResponse.parse({ status: "not_final", game }));
      }
      return json(matchupBoxScoreResponse.parse({ status: "available", game }));
    } catch {
      return json(matchupBoxScoreResponse.parse({ status: "unavailable", game: null }));
    }
  } catch (err) {
    return internalError(err);
  }
}
