/**
 * Rest-of-season evidence spine: per-week lineup points for the weeks left in
 * the fantasy regular season, scored from Sleeper's future-week projections.
 *
 * Data discipline (roster-aware scoring plan):
 * - A week that fails to load is unknown: excluded from totals and disclosed
 *   in `missingWeeks`, never silently filled or averaged in.
 * - A player with no projection row is unknown (bye, out, or simply not
 *   projected): he scores 0 in the lineup math — the same rule the projected
 *   standings use — and disclosure happens through the absent-player list.
 * - Byes come from the NFL schedule (byeWeeksByTeam), not from missing rows.
 */
import type { Dashboard } from "./dashboard-schemas.js";
import { scoreProjectedDefenseStats } from "./defense-scoring.js";
import { optimizeTradeRoster, type OptimizablePlayer } from "./lineup-optimizer.js";
import { scoreSleeperPlayerProjection } from "./player-projection-merge.js";
import { DEFAULT_LAST_REGULAR_WEEK } from "./league-schedule.js";
import { loadWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";

type League = Dashboard["leagues"][number];

type LeagueScoring = Pick<League, "scoringSettings" | "rankingField">;

/** League-scored points for one future-week projection row (same rule as projected-standings: no row → 0). */
export function rosPlayerPoints(
  player: { position: string },
  entry: { stats: Record<string, number> } | undefined,
  league: LeagueScoring,
): number {
  if (!entry) return 0;
  const fallback = league.rankingField === "halfPpr" ? entry.stats.pts_half_ppr : entry.stats.pts_ppr;
  if (player.position === "DEF") {
    const scored = league.scoringSettings ? scoreProjectedDefenseStats(entry.stats, league.scoringSettings) : null;
    return scored ?? fallback ?? 0;
  }
  const scored = league.scoringSettings
    ? scoreSleeperPlayerProjection(player.position as "QB", entry.stats, league.scoringSettings)
    : null;
  return scored ?? fallback ?? 0;
}

export type RosContext = {
  /** Weeks that loaded successfully. */
  weeks: Map<number, WeekProjections>;
  /** Sorted loaded weeks — the only weeks totals ever cover. */
  coveredWeeks: number[];
  /** Weeks that failed to load — disclosed gaps, never filled. */
  missingWeeks: number[];
  /** Oldest projection pull used, ISO time. */
  asOf: string | null;
};

/** Load a span of weekly projections. Each failure is reported, not guessed. */
export async function loadRosContext(
  season: number,
  fromWeek: number,
  throughWeek: number,
  loadProjections: (season: number, week: number) => Promise<WeekProjections> = loadWeekProjections,
): Promise<RosContext> {
  const wanted = Array.from({ length: Math.max(0, throughWeek - fromWeek + 1) }, (_, i) => fromWeek + i)
    .filter((week) => week >= 1 && week <= 18);
  const results = await Promise.allSettled(wanted.map((week) => loadProjections(season, week)));
  const weeks = new Map<number, WeekProjections>();
  const missingWeeks: number[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") weeks.set(wanted[i]!, result.value);
    else missingWeeks.push(wanted[i]!);
  });
  const asOfs = [...weeks.values()].map((week) => week.asOf).sort();
  return {
    weeks,
    coveredWeeks: [...weeks.keys()].sort((a, b) => a - b),
    missingWeeks: missingWeeks.sort((a, b) => a - b),
    asOf: asOfs[0] ?? null,
  };
}

/**
 * Team → bye week from the season schedule: the first week of the NFL bye
 * window where the team has no game. A team with a game every week gets no
 * entry.
 */
export function byeWeeksByTeam(
  schedule: ReadonlyArray<{ week?: number; home?: string; away?: string }>,
  normalize: (team: string) => string,
  lastWeek = 18,
): Map<string, number> {
  const playedByTeam = new Map<string, Set<number>>();
  for (const game of schedule) {
    if (typeof game.week !== "number" || !game.home || !game.away) continue;
    for (const raw of [game.home, game.away]) {
      const team = normalize(raw);
      const played = playedByTeam.get(team) ?? new Set<number>();
      played.add(game.week);
      playedByTeam.set(team, played);
    }
  }
  const out = new Map<string, number>();
  for (const [team, played] of playedByTeam) {
    for (let week = 1; week <= lastWeek; week += 1) {
      if (!played.has(week)) {
        out.set(team, week);
        break;
      }
    }
  }
  return out;
}

type RosterInput = Pick<OptimizablePlayer, "playerId" | "position"> & { name?: string; team?: string | null };

const toOptimizable = (players: readonly RosterInput[], pointsOf: (player: RosterInput) => number): OptimizablePlayer[] =>
  players
    .filter((player) => player.playerId !== "0")
    .map((player) => ({
      playerId: player.playerId,
      position: player.position,
      lineupSlot: null,
      isStarter: false,
      projection: pointsOf(player),
      actual: null,
    }));

export type RosWeekLineup = {
  week: number;
  before: number;
  after: number;
  delta: number;
  /** Slot the added player fills this week, when he starts after the move. */
  addSlot: string | null;
};

export type RosStartNote = { week: number; note: string };

/**
 * Per-week optimized lineup totals for two roster variants over the same
 * covered weeks — a missing week or player row moves both sides equally, so
 * it cannot manufacture a delta.
 *
 * `startedInWeeks` names each week the added player lands in the after-lineup,
 * with the schedule-derived reason: a before-starter whose team is on bye that
 * week, or the add simply outscoring the last prior starter.
 */
export function rosLineupDelta(args: {
  before: readonly RosterInput[];
  after: readonly RosterInput[];
  slots: readonly string[];
  league: Pick<League, "scoringSettings" | "rankingField">;
  ros: RosContext;
  addId?: string;
  addName?: string;
  byeWeeks?: ReadonlyMap<string, number>;
  teamById?: ReadonlyMap<string, string>;
  nameById?: ReadonlyMap<string, string>;
}): { totalDelta: number; weeks: RosWeekLineup[]; startedInWeeks: RosStartNote[] } {
  const weeks: RosWeekLineup[] = [];
  const startedInWeeks: RosStartNote[] = [];
  for (const week of args.ros.coveredWeeks) {
    const projections = args.ros.weeks.get(week);
    if (!projections) continue;
    const pointsOf = (player: RosterInput) =>
      rosPlayerPoints(player, projections.players.get(player.playerId), args.league);
    const before = optimizeTradeRoster(toOptimizable(args.before, pointsOf), [...args.slots]);
    const after = optimizeTradeRoster(toOptimizable(args.after, pointsOf), [...args.slots]);
    const addStarter = args.addId ? after.starters.find((player) => player.playerId === args.addId) : undefined;
    weeks.push({
      week,
      before: before.score,
      after: after.score,
      delta: Number((after.score - before.score).toFixed(2)),
      addSlot: addStarter?.lineupSlot ?? null,
    });
    if (addStarter && args.addId) {
      const byeStarter = before.starters.find((player) => {
        const team = args.teamById?.get(player.playerId);
        return team != null && args.byeWeeks?.get(team) === week;
      });
      const byeName = byeStarter ? (args.nameById?.get(byeStarter.playerId) ?? byeStarter.playerId) : null;
      startedInWeeks.push({
        week,
        note: byeName
          ? `Starts for you in week ${week} (${byeName}'s bye).`
          : `Starts for you in week ${week} (${args.addName ?? args.addId} out-projects the last starter).`,
      });
    }
  }
  return {
    totalDelta: Number(weeks.reduce((sum, row) => sum + row.delta, 0).toFixed(2)),
    weeks,
    startedInWeeks,
  };
}

/**
 * Descriptive injury exposure: current designations of the players involved
 * and the share of the roster's remaining projected points carried by
 * designated players — facts about the roster today, never an invented risk
 * score or a future-injury probability. Players with no projection row in any
 * covered week are named as unknown instead of being dropped from the math.
 */
export function injuryExposureFacts(args: {
  roster: readonly { playerId: string; name: string; position: string; injuryStatus?: string | null }[];
  involved: ReadonlyArray<{ playerId: string; name: string; injuryStatus?: string | null }>;
  ros: RosContext;
  league: Pick<League, "scoringSettings" | "rankingField">;
  isDesignated: (status: string | null | undefined) => boolean;
}): {
  designatedPlayers: string[];
  designatedProjectedShare: number | null;
  absentPlayers: string[];
} {
  const designatedPlayers = args.involved
    .filter((player) => args.isDesignated(player.injuryStatus))
    .map((player) => `${player.name} (${player.injuryStatus})`);
  const designatedIds = new Set(
    args.roster.filter((player) => args.isDesignated(player.injuryStatus)).map((player) => player.playerId),
  );
  // Presence is tracked over roster ∪ involved — an incoming player with no
  // future projection row is named unknown, not silently dropped.
  const checked = new Map<string, { playerId: string; name: string }>();
  for (const player of [...args.roster, ...args.involved]) {
    checked.set(player.playerId, player);
  }
  const present = new Set<string>();
  let designatedTotal = 0;
  let rosterTotal = 0;
  for (const week of args.ros.coveredWeeks) {
    const projections = args.ros.weeks.get(week);
    if (!projections) continue;
    for (const player of checked.values()) {
      if (!projections.players.has(player.playerId)) continue;
      present.add(player.playerId);
    }
    for (const player of args.roster) {
      const entry = projections.players.get(player.playerId);
      if (!entry) continue;
      const points = rosPlayerPoints(player, entry, args.league);
      rosterTotal += points;
      if (designatedIds.has(player.playerId)) designatedTotal += points;
    }
  }
  const absentPlayers = [...checked.values()]
    .filter((player) => !present.has(player.playerId))
    .map((player) => player.name);
  return {
    designatedPlayers,
    designatedProjectedShare: rosterTotal > 0 ? Number((designatedTotal / rosterTotal).toFixed(3)) : null,
    absentPlayers,
  };
}

/** Weeks through the fantasy regular-season end (playoff weekStart − 1). */
export function regularSeasonEndWeek(league: Pick<League, "playoffs">): number {
  return league.playoffs?.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK;
}
