/**
 * Gate league-scoped (and format-scoped) shared writes on the viewer's own
 * Sleeper leagues. Signed-in alone is not enough: any `leagueId` / formatKey
 * would otherwise amplify FantasyCalc / Sleeper fetches into shared tables.
 */
import { redraftTwinFormat } from "./season-long-format.js";
import { resolveFantasyCalcSnapshotFormatKey } from "./player-value-history.js";
import { seasonLongFormatForLeague } from "./sleeper.js";
import { readUserLeagues } from "./user-leagues.js";

/** Membership checks must not authorize from an expired league-list cache. */
const membershipLeagueOptions = { allowStaleOnError: false } as const;

export async function viewerBelongsToLeague(
  sleeperUserId: string,
  leagueId: string,
): Promise<boolean> {
  const { leagues } = await readUserLeagues(sleeperUserId, false, membershipLeagueOptions);
  return leagues.some((league) => league.league_id === leagueId);
}

/**
 * True when `formatKey` maps to a FantasyCalc snapshot preset that one of the
 * viewer's leagues (or that league's redraft twin) also maps to. Dynasty UIs
 * request the redraft twin for ROS / redraft-mode charts.
 */
export async function viewerUsesValueHistoryFormat(
  sleeperUserId: string,
  formatKey: string,
): Promise<boolean> {
  const requested = resolveFantasyCalcSnapshotFormatKey(formatKey);
  const { leagues } = await readUserLeagues(sleeperUserId, false, membershipLeagueOptions);
  for (const league of leagues) {
    const format = seasonLongFormatForLeague(league);
    if (resolveFantasyCalcSnapshotFormatKey(format.key) === requested) return true;
    if (format.isDynasty) {
      const twin = redraftTwinFormat(format);
      if (resolveFantasyCalcSnapshotFormatKey(twin.key) === requested) return true;
    }
  }
  return false;
}
