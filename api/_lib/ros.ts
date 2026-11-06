/**
 * Rest-of-season evidence spine: per-week lineup points for the weeks left in
 * the fantasy regular season, scored from Sleeper's future-week projections.
 *
 * Data discipline (roster-aware scoring plan):
 * - A week that fails to load is unknown: excluded from totals and disclosed
 *   in `missingWeeks`, never silently filled or averaged in.
 * - A week counts toward the delta only when every player on either roster
 *   has a projection row or a schedule bye. The optimizer is not linear: an
 *   unknown player scored 0 can change which added or dropped player starts,
 *   so even a missing bench row can distort the comparison. Weeks with any
 *   unknown rostered player are excluded from both sides and disclosed in
 *   `unknownPlayerWeeks`. Players missing from every covered week are also
 *   named in the absent-player list.
 * - Byes come from the NFL schedule (byeWeeksByTeam), not from missing rows.
 */
import type { Dashboard } from "./dashboard-schemas.js";
import { scoreProjectedDefenseStats } from "./defense-scoring.js";
import { optimizeTradeRoster, type OptimizablePlayer } from "./lineup-optimizer.js";
import { scoreSleeperPlayerProjection } from "./player-projection-merge.js";
import { DEFAULT_LAST_REGULAR_WEEK } from "./league-schedule.js";
import { canonicalTeam } from "./sleeper.js";
import { loadWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";

type League = Dashboard["leagues"][number];

type LeagueScoring = Pick<League, "scoringSettings" | "rankingField">;

/**
 * League-scored points for one future-week projection row, or null when the
 * row carries no usable score: neither a league-scored value nor the selected
 * fallback field exists. An explicit 0 in the fallback field is a real score;
 * a missing one is unknown, and callers must not silently treat it as 0.
 */
function rosPlayerPointsOrNull(
  player: { position: string },
  entry: { stats: Record<string, number> } | undefined,
  league: LeagueScoring,
): number | null {
  if (!entry) return null;
  const fallback = league.rankingField === "halfPpr" ? entry.stats.pts_half_ppr : entry.stats.pts_ppr;
  if (player.position === "DEF") {
    const scored = league.scoringSettings ? scoreProjectedDefenseStats(entry.stats, league.scoringSettings) : null;
    return scored ?? fallback ?? null;
  }
  const scored = league.scoringSettings
    ? scoreSleeperPlayerProjection(player.position as "QB", entry.stats, league.scoringSettings)
    : null;
  return scored ?? fallback ?? null;
}

/** League-scored points for one future-week projection row (same rule as projected-standings: no row → 0). */
export function rosPlayerPoints(
  player: { position: string },
  entry: { stats: Record<string, number> } | undefined,
  league: LeagueScoring,
): number {
  return rosPlayerPointsOrNull(player, entry, league) ?? 0;
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
  deadlineAtMs?: number,
): Promise<RosContext> {
  const wanted = Array.from({ length: Math.max(0, throughWeek - fromWeek + 1) }, (_, i) => fromWeek + i)
    .filter((week) => week >= 1 && week <= 18);
  // Optional caller deadline (the chat agent's answer budget): a week whose
  // load cannot finish in time is disclosed as missing, so a slow projection
  // pull can never run the caller past its deadline. The abandoned load keeps
  // running in the background and still warms the cache.
  const withinBudget = (load: Promise<WeekProjections>): Promise<WeekProjections> => {
    if (deadlineAtMs == null) return load;
    load.catch(() => undefined);
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) return Promise.reject(new Error("ROS projection load skipped: deadline reached"));
    return Promise.race([
      load,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("ROS projection load timed out: deadline reached")), remainingMs);
      }),
    ]);
  };
  const results = await Promise.allSettled(wanted.map((week) => withinBudget(loadProjections(season, week))));
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

/** NFL byes only ever fall inside this window; a gap outside it is a data gap, not a bye. */
const BYE_WINDOW = { first: 5, last: 14 } as const;

/**
 * Team → bye week from the season schedule. A bye is inferred only from
 * positive completeness evidence, never from absence alone: the team must
 * play in exactly `lastWeek - 1` distinct weeks (a complete NFL season is 17
 * games over 18 weeks) AND the single missing week must fall inside the NFL
 * bye window. Any other shape — a partial schedule, an omitted game, an
 * extra gap — yields no entry, so a missing projection row stays disclosed
 * as unknown instead of being misread as a real bye-week 0.
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
  const first = Math.max(1, BYE_WINDOW.first);
  const last = Math.min(lastWeek, BYE_WINDOW.last);
  for (const [team, played] of playedByTeam) {
    // Completeness first: without a full slate of games a missing week is a
    // data gap, not evidence of a bye.
    if (played.size !== lastWeek - 1) continue;
    const missingInWindow: number[] = [];
    for (let week = first; week <= last; week += 1) {
      if (!played.has(week)) missingInWindow.push(week);
    }
    if (missingInWindow.length === 1) out.set(team, missingInWindow[0]!);
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

/** A covered week excluded from the delta because a moved player's week is unknown. */
export type RosUnknownPlayerWeek = { week: number; players: string[] };

/**
 * Per-week optimized lineup totals for two roster variants over the weeks
 * where every rostered player has projection coverage. A week that failed
 * to load never enters the loop. A week where ANY player on either roster
 * has no projection row and no schedule bye is excluded from BOTH sides and
 * disclosed in `unknownPlayerWeeks`: the optimizer is not linear, so a
 * zeroed unknown can change which moved player starts, and no subset of the
 * roster is safe to score 0.
 *
 * `startedInWeeks` names each week the added player lands in the after-lineup.
 * The note states no reason: whether the start came from a bye or from
 * out-projecting a starter cannot be proven from the optimized lineup alone,
 * so no cause is attributed.
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
  /** Canonicalizes roster-team aliases (LA/JAC/WSH/LVR) to the schedule's team keys. */
  normalizeTeam?: (team: string) => string;
}): { totalDelta: number; weeks: RosWeekLineup[]; startedInWeeks: RosStartNote[]; unknownPlayerWeeks: RosUnknownPlayerWeek[] } {
  const weeks: RosWeekLineup[] = [];
  const startedInWeeks: RosStartNote[] = [];
  const unknownPlayerWeeks: RosUnknownPlayerWeek[] = [];
  const normalize = args.normalizeTeam ?? canonicalTeam;
  /** The player's schedule bye week, when his team is known and has one. */
  const byeWeekOf = (player: RosterInput): number | null => {
    const team = player.team ?? args.teamById?.get(player.playerId);
    if (team == null || team === "") return null;
    return args.byeWeeks?.get(normalize(team)) ?? null;
  };
  // Every player on either roster must be known for the comparison to be
  // sound: the optimizer is not linear, so an unknown player scored 0 can
  // change which added or dropped player starts and distort the delta even
  // though he appears on both sides. Draft picks are assets, not players:
  // they never have a projection row or a team, so they are excluded rather
  // than allowed to zero out every covered week.
  const rostered = [...args.before, ...args.after].filter(
    (player, index, all) =>
      player.playerId !== "0"
      && player.position !== "PICK"
      && all.findIndex((other) => other.playerId === player.playerId) === index,
  );
  for (const week of args.ros.coveredWeeks) {
    const projections = args.ros.weeks.get(week);
    if (!projections) continue;
    // A rostered player with no usable score this week (no row, or a row
    // with neither a league-scored value nor the selected fallback field) is
    // a real 0 only when the schedule says his team is on bye; otherwise his
    // week is unknown.
    const unknown = rostered.filter((player) => {
      if (rosPlayerPointsOrNull(player, projections.players.get(player.playerId), args.league) != null) return false;
      return byeWeekOf(player) !== week;
    });
    if (unknown.length > 0) {
      unknownPlayerWeeks.push({
        week,
        players: unknown.map((player) => player.name ?? args.nameById?.get(player.playerId) ?? player.playerId),
      });
      continue;
    }
    // A player whose team is on a schedule bye scores a real 0 even when a
    // stale cached row (e.g. from before a trade to a team with a different
    // bye) still holds points for him.
    const pointsOf = (player: RosterInput) =>
      byeWeekOf(player) === week
        ? 0
        : rosPlayerPoints(player, projections.players.get(player.playerId), args.league);
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
      // Neutral by design: the optimized lineup shows THAT the add starts,
      // not WHY - a bye or an out-projection cannot be proven from this
      // lineup alone, so no reason is stated.
      startedInWeeks.push({
        week,
        note: `Starts for you in week ${week}.`,
      });
    }
  }
  return {
    totalDelta: Number(weeks.reduce((sum, row) => sum + row.delta, 0).toFixed(2)),
    weeks,
    startedInWeeks,
    unknownPlayerWeeks,
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
  roster: readonly { playerId: string; name: string; position: string; team?: string | null; injuryStatus?: string | null }[];
  involved: ReadonlyArray<{ playerId: string; name: string; position?: string; team?: string | null; injuryStatus?: string | null }>;
  ros: RosContext;
  league: Pick<League, "scoringSettings" | "rankingField">;
  isDesignated: (status: string | null | undefined) => boolean;
  byeWeeks?: ReadonlyMap<string, number>;
  teamById?: ReadonlyMap<string, string>;
  /** Canonicalizes roster-team aliases (LA/JAC/WSH/LVR) to the schedule's team keys. */
  normalizeTeam?: (team: string) => string;
}): {
  designatedPlayers: string[];
  designatedProjectedShare: number | null;
  absentPlayers: string[];
  partialPlayers: string[];
} {
  const normalize = args.normalizeTeam ?? canonicalTeam;
  const byeWeekOf = (player: { playerId: string; team?: string | null }): number | null => {
    const team = player.team ?? args.teamById?.get(player.playerId);
    if (team == null || team === "") return null;
    return args.byeWeeks?.get(normalize(team)) ?? null;
  };
  const designatedPlayers = args.involved
    .filter((player) => args.isDesignated(player.injuryStatus))
    .map((player) => `${player.name} (${player.injuryStatus})`);
  const designatedIds = new Set(
    args.roster.filter((player) => args.isDesignated(player.injuryStatus)).map((player) => player.playerId),
  );
  // Presence is tracked over roster ∪ involved — an incoming player with no
  // future projection row is named unknown, not silently dropped.
  const checked = new Map<string, { playerId: string; name: string; position: string; team?: string | null }>();
  for (const player of [...args.roster, ...args.involved]) {
    // Vacant starter slots and draft picks are not players: neither has a
    // projection row, so without this filter they surface as unknowns.
    if (player.playerId === "0" || player.position === "PICK") continue;
    checked.set(player.playerId, { ...player, position: player.position ?? "" });
  }
  const present = new Set<string>();
  // Players whose covered weeks are entirely byes: that span is a known 0, so
  // they must not be reported as unknown.
  const byeCovered = new Set<string>();
  // Covered non-bye weeks where the player has no usable row: the share sums
  // other players' points for those weeks, so the gap must be disclosed, not
  // dropped from the math. A schedule bye is a real 0, never a gap; a stale
  // cached row on a bye week counts 0, never its stale points.
  const gapWeeksById = new Map<string, number>();
  let designatedTotal = 0;
  let rosterTotal = 0;
  for (const week of args.ros.coveredWeeks) {
    const projections = args.ros.weeks.get(week);
    if (!projections) continue;
    for (const player of checked.values()) {
      if (byeWeekOf(player) === week) {
        byeCovered.add(player.playerId);
        continue;
      }
      const points = rosPlayerPointsOrNull(player, projections.players.get(player.playerId), args.league);
      if (points != null) present.add(player.playerId);
      else gapWeeksById.set(player.playerId, (gapWeeksById.get(player.playerId) ?? 0) + 1);
    }
    for (const player of args.roster) {
      if (byeWeekOf(player) === week) continue;
      const points = rosPlayerPointsOrNull(player, projections.players.get(player.playerId), args.league);
      if (points == null) continue;
      rosterTotal += points;
      if (designatedIds.has(player.playerId)) designatedTotal += points;
    }
  }
  const absentPlayers = [...checked.values()]
    // Absent means an actual unknown non-bye week (or no evidence at all): a
    // player whose covered span is entirely byes is fully known, not absent.
    .filter((player) => !present.has(player.playerId)
      && (!byeCovered.has(player.playerId) || (gapWeeksById.get(player.playerId) ?? 0) > 0))
    .map((player) => player.name);
  const partialPlayers = [...checked.values()]
    .filter((player) => present.has(player.playerId) && (gapWeeksById.get(player.playerId) ?? 0) > 0)
    .map((player) => player.name);
  return {
    designatedPlayers,
    designatedProjectedShare: rosterTotal > 0 ? Number((designatedTotal / rosterTotal).toFixed(3)) : null,
    absentPlayers,
    partialPlayers,
  };
}

/** Weeks through the fantasy regular-season end (playoff weekStart − 1). */
export function regularSeasonEndWeek(league: Pick<League, "playoffs">): number {
  return league.playoffs?.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK;
}
