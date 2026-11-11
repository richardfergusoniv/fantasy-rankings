/**
 * Trade ideas for the Trade tab's Assistant card: the same finder the chat uses
 * (toolSuggestTrades), loaded on demand when the tab opens, so nothing extra is
 * stored or computed at refresh. Served by api/data/[kind] as kind=trade-ideas.
 */
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
// chat-tools must load before chat-tools-extended: the two import each other, and chat-tools reads the extended definitions when it loads.
import type { ChatToolContext } from "./chat-tools.js";
import "./chat-tools.js";
import { toolSuggestTrades } from "./chat-tools-extended.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

const querySchema = z.object({ leagueId: z.string().min(1).max(64) });

/** Ideas shown on the card; the chat tool caps at 8. */
const IDEA_LIMIT = 5;
/** Time the finder gets before optional rest-of-season loading yields (the function runs up to 60 seconds). */
const BUDGET_MS = 45_000;

export type TradeIdeaAsset = { playerId: string; name: string; position: string; value: number };

export type TradeIdea = {
  partnerRosterId: number | null;
  partner: string;
  give: TradeIdeaAsset[];
  get: TradeIdeaAsset[];
  /** Verdict label for the window the league is judged on (e.g. "Good for you"). */
  verdict: string;
  verdictScore: number;
  /** Market value each side, before roster fit. */
  giveTotal: number;
  getTotal: number;
  week: { lineupBefore: number; lineupAfter: number };
  seasonLong: { starterValueBefore: number; starterValueAfter: number; powerRankBefore: number; powerRankAfter: number; fillsHole: boolean };
  /** Lineup points over the rest of the season; null when those weeks weren't available. */
  restOfSeason: { pointsDelta: number; coveredWeeks: number[]; partial: boolean } | null;
  partnerWeekDelta: number;
  partnerRestOfSeason: { pointsDelta: number } | null;
  injuryExposure: { designatedPlayers: string[]; absentPlayers: string[] } | null;
};

export type TradeIdeasResponse = { leagueId: string; needs: string[]; ideas: TradeIdea[] };

type Suggestion = Extract<Awaited<ReturnType<typeof toolSuggestTrades>>, { ok: true }>["suggestions"][number];

/** Trims a finder suggestion to what the card and its sheet show. */
export function toTradeIdea(suggestion: Suggestion): TradeIdea {
  const ros = suggestion.utility.yourUtilityDelta.restOfSeason ?? null;
  const partnerRos = suggestion.utility.partnerUtilityDelta.restOfSeason ?? null;
  const asset = (a: Suggestion["give"][number]): TradeIdeaAsset => ({ playerId: a.playerId, name: a.name, position: a.position, value: a.value });
  return {
    partnerRosterId: suggestion.partnerRosterId,
    partner: suggestion.partner,
    give: suggestion.give.map(asset),
    get: suggestion.get.map(asset),
    verdict: suggestion.primaryLabel,
    verdictScore: suggestion.primaryScore,
    giveTotal: suggestion.giveTotal,
    getTotal: suggestion.getTotal,
    week: { lineupBefore: suggestion.rosterImpact.week.lineupPointsBefore, lineupAfter: suggestion.rosterImpact.week.lineupPointsAfter },
    seasonLong: suggestion.rosterImpact.seasonLong,
    restOfSeason: ros ? { pointsDelta: ros.pointsDelta, coveredWeeks: ros.coveredWeeks, partial: ros.partial } : null,
    partnerWeekDelta: suggestion.utility.partnerUtilityDelta.weekLineupPoints,
    partnerRestOfSeason: partnerRos ? { pointsDelta: partnerRos.pointsDelta } : null,
    injuryExposure: suggestion.injuryExposure
      ? { designatedPlayers: suggestion.injuryExposure.designatedPlayers, absentPlayers: suggestion.injuryExposure.absentPlayers }
      : null,
  };
}

export async function handleTradeIdeas(req: Request): Promise<Response> {
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
    if (!cached?.dashboard.leagues.some((league) => league.id === parsed.data.leagueId)) {
      return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);
    }

    const ctx: ChatToolContext = {
      userId: "",
      sleeperUserId,
      dashboardPromise: Promise.resolve(cached.dashboard),
      scoringWindow: "season_long",
      chatDeadlineAtMs: Date.now() + BUDGET_MS,
    };
    const result = await toolSuggestTrades(ctx, { leagueId: parsed.data.leagueId, limit: IDEA_LIMIT });
    if (!result.ok) return json({ ok: false, error: result.error }, 404);

    const body: TradeIdeasResponse = {
      leagueId: parsed.data.leagueId,
      needs: [...result.myNeeds],
      ideas: result.suggestions.map(toTradeIdea),
    };
    return json(body);
  } catch (err) {
    return internalError(err);
  }
}
