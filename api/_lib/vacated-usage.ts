/**
 * Vacated-usage inputs for the Week N blend (docs/scoring/SCORING_SPEC.md
 * "Teammate injuries" row): when a teammate is Out or Doubtful, his season
 * usage comes off the board for the rest of the team.
 *
 * Model: for each scored player, `vacatedTargetSharePts` is the summed season
 * target share (percentage points) of his out teammates and
 * `vacatedCarriesPerGame` their summed carries per game. The spec's refit note
 * says "no mechanical redistribution" — every healthy teammate gets the team's
 * total vacated usage and the ridge coefficient carries the magnitude.
 *
 * Coverage limit: the injured pool is the caller's candidate list (rosters +
 * rankings for the league), so an out teammate with no dashboard or ranking
 * row contributes nothing. Usage comes from the nflverse week-stat rows;
 * injured players with fewer than MIN_GAMES stat weeks don't vacate.
 */
import { isUnavailableForCurrentWeek, normalizedAvailabilityStatus } from "./sleeper.js";
import {
  indexWeekStatsByPlayer,
  weekStatsForPlayer,
  type PropHistoryPlayerRef,
} from "./prop-line-reads.js";
import type { TeamWeekStatRow } from "./nflverse-team-week-stats.js";

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
/** Weeks below this don't establish a usage rate worth vacating. */
const MIN_GAMES = 2;

export type VacatedUsageCandidate = PropHistoryPlayerRef & {
  injuryStatus?: string | null;
};

export type VacatedUsage = {
  vacatedTargetSharePts: number;
  vacatedCarriesPerGame: number;
};

const vacates = (status: string | null | undefined): boolean =>
  isUnavailableForCurrentWeek(status) || normalizedAvailabilityStatus(status ?? "") === "doubtful";

export function buildVacatedUsage(
  candidates: readonly VacatedUsageCandidate[],
  statRows: readonly TeamWeekStatRow[],
): Map<string, VacatedUsage> {
  const result = new Map<string, VacatedUsage>();
  if (statRows.length === 0) return result;
  const statsIndex = indexWeekStatsByPlayer(statRows);

  const usageFor = (player: VacatedUsageCandidate) => {
    const rows = weekStatsForPlayer(statsIndex, player);
    if (rows.length < MIN_GAMES) return null;
    const shares = rows.map((row) => row.targetShare).filter((v): v is number => v != null);
    const carries = rows.reduce((sum, row) => sum + row.carries, 0) / rows.length;
    return {
      targetSharePct: shares.length > 0 ? shares.reduce((sum, v) => sum + v, 0) / shares.length : 0,
      carriesPerGame: carries,
    };
  };

  // Callers often pass roster ∪ rankings; the same Out player can appear in
  // both. Dedupe by playerId so each injured teammate vacates once.
  const seen = new Set<string>();
  const byTeam = new Map<string, VacatedUsageCandidate[]>();
  for (const player of candidates) {
    if (!player.team || !SKILL_POSITIONS.has(player.position)) continue;
    const key = player.playerId || `${player.team}:${player.name}:${player.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byTeam.get(player.team) ?? [];
    list.push(player);
    byTeam.set(player.team, list);
  }

  const round2 = (value: number) => Math.round(value * 100) / 100;
  for (const teamPlayers of byTeam.values()) {
    let vacatedShare = 0;
    let vacatedCarries = 0;
    for (const player of teamPlayers) {
      if (!vacates(player.injuryStatus)) continue;
      const usage = usageFor(player);
      if (!usage) continue;
      vacatedShare += usage.targetSharePct;
      vacatedCarries += usage.carriesPerGame;
    }
    if (vacatedShare === 0 && vacatedCarries === 0) continue;
    for (const player of teamPlayers) {
      if (!player.playerId || vacates(player.injuryStatus)) continue;
      result.set(player.playerId, {
        vacatedTargetSharePts: round2(vacatedShare),
        vacatedCarriesPerGame: round2(vacatedCarries),
      });
    }
  }
  return result;
}
