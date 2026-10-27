/**
 * Which league the user is looking at, told to the model on every chat turn.
 *
 * The client sends the selected league's id with each chat POST; the server
 * resolves it against the viewer's own cached dashboard, so only a league
 * the viewer actually belongs to can be named in the prompt, and the name
 * and format come from server data rather than the request body. On a cold
 * dashboard cache, fall back to the lightweight user-leagues list (still
 * membership-checked) so tools and the prompt keep a default.
 */
import { readUserDashboardCache } from "./dashboard-build.js";
import { isDynasticalPpfdLeague, seasonLongFormatForLeague } from "./sleeper.js";
import { readUserLeagues } from "./user-leagues.js";

export type ViewingLeague = {
  id: string;
  name: string;
  scoringLabel: string;
  isDynasty: boolean;
};

function scoringLabelForSleeperLeague(
  league: Parameters<typeof seasonLongFormatForLeague>[0],
): string {
  if (isDynasticalPpfdLeague(league)) return "PPR proxy · PPFD league";
  const format = seasonLongFormatForLeague(league);
  if (format.ppr === 1) return "PPR";
  if (format.ppr === 0.5) return "Half PPR";
  return "Standard";
}

export async function resolveViewingLeague(
  sleeperUserId: string | null | undefined,
  leagueId: string | null | undefined,
): Promise<ViewingLeague | null> {
  if (!sleeperUserId || !leagueId) return null;
  try {
    const cached = await readUserDashboardCache(sleeperUserId);
    const league = cached?.dashboard.leagues.find((item) => item.id === leagueId);
    if (league) {
      return {
        id: league.id,
        name: league.name,
        scoringLabel: league.scoringLabel,
        isDynasty: league.seasonLongFormat.isDynasty,
      };
    }
  } catch {
    // Fall through to the lightweight leagues list.
  }

  try {
    const { leagues } = await readUserLeagues(sleeperUserId);
    const league = leagues.find((item) => item.league_id === leagueId);
    if (!league) return null;
    const format = seasonLongFormatForLeague(league);
    return {
      id: league.league_id,
      name: league.name,
      scoringLabel: scoringLabelForSleeperLeague(league),
      isDynasty: format.isDynasty,
    };
  } catch {
    return null;
  }
}

/** League names are member-chosen; keep the prompt line single-line and bounded. */
function promptSafeLeagueName(name: string): string {
  return name.replace(/[\r\n"]+/g, " ").trim().slice(0, 80) || "Unnamed league";
}

export function viewingLeaguePromptLines(league: ViewingLeague): string {
  const format = `${league.scoringLabel}, ${league.isDynasty ? "dynasty" : "redraft"}`;
  return [
    `The user is currently viewing the league "${promptSafeLeagueName(league.name)}" (${format}; league id ${league.id}).`,
    `When they say "this team", "my team", or "this league" without naming a league, they mean this league: use league id ${league.id} for tool calls unless they name a different league.`,
  ].join("\n");
}

export function appendViewingLeague(systemPrompt: string, league: ViewingLeague | null): string {
  return league ? `${systemPrompt}\n\n${viewingLeaguePromptLines(league)}` : systemPrompt;
}
