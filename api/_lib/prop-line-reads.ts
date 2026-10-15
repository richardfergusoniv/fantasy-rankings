/**
 * Pure helpers for Monitor Props: current-week consensus lines, line movement
 * from our stored weekly pulls, and edge math vs nflverse weekly actuals.
 *
 * Line movement is derived only from `prop_line_snapshots` (opening vs latest
 * within a week, and pull history). Never call a paid odds API here.
 */

import {
  canonicalNflTeam,
  normalizeTeamStatsPlayerName,
  type TeamWeekStatRow,
} from "./nflverse-team-week-stats.js";

/** Canonical prop stats written by the props ingest pipeline. */
export const PROP_STAT_IDS = [
  "pass_yards",
  "pass_tds",
  "pass_completions",
  "pass_attempts",
  "pass_interceptions",
  "rush_yards",
  "rush_attempts",
  "rec_yards",
  "receptions",
  "longest_reception",
  "anytime_td",
  "first_td",
  "sacks",
  "tackles",
  "kicker_points",
  "field_goals_made",
] as const;

export type PropStatId = (typeof PROP_STAT_IDS)[number];

export type PropStatDef = {
  id: PropStatId;
  label: string;
  short: string;
};

export const PROP_STAT_OPTIONS: readonly PropStatDef[] = [
  { id: "pass_yards", label: "Pass yards", short: "Pass yd" },
  { id: "pass_tds", label: "Pass TDs", short: "Pass TD" },
  { id: "pass_completions", label: "Completions", short: "Comp" },
  { id: "pass_attempts", label: "Pass attempts", short: "Att" },
  { id: "pass_interceptions", label: "Interceptions", short: "INT" },
  { id: "rush_yards", label: "Rush yards", short: "Rush yd" },
  { id: "rush_attempts", label: "Rush attempts", short: "Rush" },
  { id: "rec_yards", label: "Rec yards", short: "Rec yd" },
  { id: "receptions", label: "Receptions", short: "Rec" },
  { id: "longest_reception", label: "Longest reception", short: "Long" },
  { id: "anytime_td", label: "Anytime TD", short: "ATD" },
  { id: "first_td", label: "First TD", short: "1st TD" },
  { id: "sacks", label: "Sacks", short: "Sack" },
  { id: "tackles", label: "Tackles", short: "Tkl" },
  { id: "kicker_points", label: "Kicker points", short: "K pts" },
  { id: "field_goals_made", label: "Field goals", short: "FG" },
] as const;

export const PROP_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type PropPosition = (typeof PROP_POSITIONS)[number];

export type PropLinePull = {
  pulledAt: Date;
  line: number;
};

export type PropLineMovement = {
  /** Chronological pulls (oldest → newest). Ready for a future sparkline. */
  history: PropLinePull[];
  openingLine: number;
  latestLine: number;
  /**
   * `latest - opening`. Null when there is only one pull this week
   * (no movement to show).
   */
  move: number | null;
  latestPulledAt: Date;
  openingPulledAt: Date;
};

export type PropSnapshotPullRow = {
  playerId: string;
  stat: string;
  line: number;
  medianOverOdds: number | null;
  medianUnderOdds: number | null;
  bookCount: number;
  pulledAt: Date;
};

export type CurrentWeekPropLine = {
  playerId: string;
  stat: string;
  line: number;
  medianOverOdds: number | null;
  medianUnderOdds: number | null;
  bookCount: number;
  pulledAt: Date;
  openLine: number | null;
  move: number | null;
};

export type PropPlayerMeta = {
  name: string;
  team: string | null;
  position: string | null;
};

export type PropGameResult = "over" | "under" | "push";

export type PropGameCell = {
  week: number;
  actual: number;
  result: PropGameResult;
};

export type PropEdgeHistory = {
  games: number;
  average: number | null;
  median: number | null;
  overs: number;
  unders: number;
  pushes: number;
  /** overs / (overs + unders); null when no decided games. */
  hitRate: number | null;
  /** Per-game results vs the current line, oldest → newest. */
  cells: PropGameCell[];
  /** Actuals for the last up-to-3 games, oldest → newest. */
  last3: number[];
  projection: number | null;
  edge: number | null;
};

export function propGameResult(actual: number, line: number): PropGameResult {
  if (actual > line) return "over";
  if (actual < line) return "under";
  return "push";
}

const PROP_STAT_SET = new Set<string>(PROP_STAT_IDS);

export function isPropStatId(value: string): value is PropStatId {
  return PROP_STAT_SET.has(value);
}

export function propStatDef(statId: string): PropStatDef | null {
  if (!isPropStatId(statId)) return null;
  return PROP_STAT_OPTIONS.find((option) => option.id === statId) ?? null;
}

/**
 * Summarize opening → latest movement from our own dated pulls.
 * Used for player props today; the same helper is ready for game-line
 * (spread/total) week pulls once those land in storage — never a paid odds API.
 * History is sorted oldest → newest so future charts can reuse it.
 */
export function summarizePropLineMovement(pulls: readonly PropLinePull[]): PropLineMovement | null {
  if (pulls.length === 0) return null;
  const history = [...pulls].sort((left, right) => {
    const delta = left.pulledAt.getTime() - right.pulledAt.getTime();
    if (delta !== 0) return delta;
    return left.line - right.line;
  });
  const opening = history[0]!;
  const latest = history[history.length - 1]!;
  const move = history.length >= 2
    ? Number((latest.line - opening.line).toFixed(3))
    : null;
  return {
    history,
    openingLine: opening.line,
    latestLine: latest.line,
    move,
    latestPulledAt: latest.pulledAt,
    openingPulledAt: opening.pulledAt,
  };
}

/**
 * Collapse raw week pulls to one current line per (playerId, stat), keeping
 * opening line / move when that market was pulled 2+ times this week.
 */
export function currentWeekPropLines(rows: readonly PropSnapshotPullRow[]): CurrentWeekPropLine[] {
  const byKey = new Map<string, PropSnapshotPullRow[]>();
  for (const row of rows) {
    if (!row.playerId || !row.stat || !Number.isFinite(row.line)) continue;
    const key = `${row.playerId}|${row.stat}`;
    const group = byKey.get(key);
    if (group) group.push(row);
    else byKey.set(key, [row]);
  }

  const output: CurrentWeekPropLine[] = [];
  for (const group of byKey.values()) {
    const movement = summarizePropLineMovement(
      group.map((row) => ({ pulledAt: row.pulledAt, line: row.line })),
    );
    if (!movement) continue;
    const latestRow = group.reduce((best, row) => (
      row.pulledAt.getTime() > best.pulledAt.getTime() ? row : best
    ));
    output.push({
      playerId: latestRow.playerId,
      stat: latestRow.stat,
      line: movement.latestLine,
      medianOverOdds: latestRow.medianOverOdds,
      medianUnderOdds: latestRow.medianUnderOdds,
      bookCount: latestRow.bookCount,
      pulledAt: movement.latestPulledAt,
      openLine: movement.move === null ? null : movement.openingLine,
      move: movement.move,
    });
  }

  return output.sort((left, right) => (
    left.playerId.localeCompare(right.playerId) || left.stat.localeCompare(right.stat)
  ));
}

/**
 * Actual for a prop market from one nflverse week row.
 * Returns null when the market is not supported from weekly player stats
 * (e.g. longest reception, first TD, defense/kicker until those rows exist).
 */
export function propStatActual(stat: string, week: TeamWeekStatRow): number | null {
  if (!isPropStatId(stat)) return null;
  switch (stat) {
    case "pass_yards":
      return week.passingYards;
    case "pass_tds":
      return week.passingTds;
    case "pass_completions":
      return week.completions;
    case "pass_attempts":
      return week.passAttempts;
    case "pass_interceptions":
      return week.interceptions;
    case "rush_yards":
      return week.rushingYards;
    case "rush_attempts":
      return week.carries;
    case "rec_yards":
      return week.receivingYards;
    case "receptions":
      return week.receptions;
    case "anytime_td":
      // Scorer props only — thrown TDs do not count.
      return week.rushingTds + week.receivingTds;
    case "longest_reception":
    case "first_td":
    case "sacks":
    case "tackles":
    case "kicker_points":
    case "field_goals_made":
      return null;
    default: {
      const _exhaustive: never = stat;
      return _exhaustive;
    }
  }
}

/** Recent-weighted projection: game i (oldest→newest) gets weight i+1. */
export function weightedRecentProjection(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) continue;
    const weight = index + 1;
    weightedSum += value * weight;
    weightTotal += weight;
  }
  if (weightTotal <= 0) return null;
  return Number((weightedSum / weightTotal).toFixed(3));
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Number((((sorted[mid - 1]! + sorted[mid]!) / 2)).toFixed(3));
}

export function averageOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number((sum / values.length).toFixed(3));
}

/**
 * Compare a line to the player's 2026 weekly actuals for that market.
 * `weekRows` should already be filtered to one player and sorted by week.
 */
export function buildPropEdgeHistory(
  stat: string,
  line: number,
  weekRows: readonly TeamWeekStatRow[],
): PropEdgeHistory {
  const cells: PropGameCell[] = [];
  for (const row of weekRows) {
    const actual = propStatActual(stat, row);
    if (actual === null) continue;
    cells.push({
      week: row.week,
      actual,
      result: propGameResult(actual, line),
    });
  }
  const actuals = cells.map((cell) => cell.actual);
  if (actuals.length === 0 || !Number.isFinite(line)) {
    return {
      games: 0,
      average: null,
      median: null,
      overs: 0,
      unders: 0,
      pushes: 0,
      hitRate: null,
      cells: [],
      last3: [],
      projection: null,
      edge: null,
    };
  }
  const overs = cells.filter((cell) => cell.result === "over").length;
  const unders = cells.filter((cell) => cell.result === "under").length;
  const pushes = cells.filter((cell) => cell.result === "push").length;
  const decided = overs + unders;
  const last3 = actuals.slice(-3);
  const projection = weightedRecentProjection(actuals);
  const edge = projection === null ? null : Number((projection - line).toFixed(3));
  return {
    games: actuals.length,
    average: averageOf(actuals),
    median: medianOf(actuals),
    overs,
    unders,
    pushes,
    hitRate: decided > 0 ? Number((overs / decided).toFixed(3)) : null,
    cells,
    last3,
    projection,
    edge,
  };
}

export type OpponentAllowance = {
  /** Mean of the per-game position-group totals allowed (see below). */
  allowed: number;
  /** Games (weeks) the average is built from. */
  games: number;
};

/** Map key for opponent allowances: defense team | position | prop stat. */
export function opponentAllowanceKey(defenseTeam: string, position: string, stat: string): string {
  return `${canonicalNflTeam(defenseTeam)}|${position}|${stat}`;
}

/**
 * What a defense allows an entire position group per game: for every
 * (defense, week) sum every opposing player's actual at the position,
 * then average those group totals across the games the defense played
 * (a game where the group recorded nothing counts as 0, per PR #128).
 * A player's personal Opp figure is this total times his share of his
 * own group's production — see buildPlayerStatShares. Per-coverage (CB)
 * matchup data does not exist in nflverse, so the share split is the
 * finest granularity available.
 */
export function buildOpponentGroupAllowances(
  stats: readonly TeamWeekStatRow[],
): Map<string, OpponentAllowance> {
  // defense -> weeks it actually played (appeared as an opponent).
  const defenseWeeks = new Map<string, Set<number>>();
  // defense|position|stat|week -> the whole group's actual that week.
  const gameTotals = new Map<string, number>();
  // Position|stat pairs that produced a value for at least one defense.
  const applicablePairs = new Set<string>();
  for (const row of stats) {
    if (!row.opponent) continue;
    const defense = canonicalNflTeam(row.opponent);
    const weeks = defenseWeeks.get(defense) ?? new Set<number>();
    weeks.add(row.week);
    defenseWeeks.set(defense, weeks);
    for (const stat of PROP_STAT_IDS) {
      const actual = propStatActual(stat, row);
      if (actual === null) continue;
      applicablePairs.add(`${row.position}|${stat}`);
      const key = `${defense}|${row.position}|${stat}|${row.week}`;
      gameTotals.set(key, (gameTotals.get(key) ?? 0) + actual);
    }
  }
  const output = new Map<string, OpponentAllowance>();
  for (const [defense, weeks] of defenseWeeks) {
    for (const pair of applicablePairs) {
      let sum = 0;
      for (const week of weeks) {
        sum += gameTotals.get(`${defense}|${pair}|${week}`) ?? 0;
      }
      output.set(`${defense}|${pair}`, {
        allowed: Number((sum / weeks.size).toFixed(3)),
        games: weeks.size,
      });
    }
  }
  return output;
}

/**
 * Each player's share of his own team's position-group production, per
 * stat: player total ÷ group total over the given rows, keyed
 * `${playerMatchKey}|${stat}`. Clamped to [0, 1] because small negative
 * rushing/receiving weeks can otherwise skew the ratio. Pairs whose
 * group produced nothing are omitted (no basis for a share).
 */
export function buildPlayerStatShares(
  stats: readonly TeamWeekStatRow[],
): Map<string, number> {
  const playerTotals = new Map<string, number>();
  const groupTotals = new Map<string, number>();
  for (const row of stats) {
    const playerKey = propPlayerMatchKey(row.name, row.team, row.position);
    const groupKey = `${canonicalNflTeam(row.team)}|${row.position}`;
    for (const stat of PROP_STAT_IDS) {
      const actual = propStatActual(stat, row);
      if (actual === null) continue;
      const pKey = `${playerKey}|${stat}`;
      playerTotals.set(pKey, (playerTotals.get(pKey) ?? 0) + actual);
      const gKey = `${groupKey}|${stat}`;
      groupTotals.set(gKey, (groupTotals.get(gKey) ?? 0) + actual);
    }
  }
  const shares = new Map<string, number>();
  for (const [pKey, total] of playerTotals) {
    // Match keys are `${position}|${team}|${name}`; the stat rides last.
    const parts = pKey.split("|");
    const stat = parts[parts.length - 1] ?? "";
    const position = parts[0] ?? "";
    const team = parts[1] ?? "";
    const groupTotal = groupTotals.get(`${team}|${position}|${stat}`) ?? 0;
    if (groupTotal <= 0) continue;
    const share = Math.min(1, Math.max(0, total / groupTotal));
    shares.set(pKey, Number(share.toFixed(4)));
  }
  return shares;
}

/**
 * The Edge shown in the props table: the player's projection and his
 * share-adjusted opponent allowance are two independent estimates of
 * the same game, so they get equal weight — edge = mean(projection,
 * allowance) − line. Without an allowance it falls back to
 * projection − line.
 */
export function blendedPropEdge(
  projection: number | null,
  opponentAllowed: number | null,
  line: number,
): number | null {
  if (projection === null || !Number.isFinite(line)) return null;
  if (opponentAllowed === null) return Number((projection - line).toFixed(3));
  return Number((((projection + opponentAllowed) / 2) - line).toFixed(3));
}

export function propPlayerMatchKey(name: string, team: string | null | undefined, position: string): string {
  const teamKey = team ? team.trim().toUpperCase() : "";
  return `${position}|${teamKey}|${normalizeTeamStatsPlayerName(name)}`;
}

/** Index nflverse week rows by name+team+position for joining to Sleeper ids. */
export function indexWeekStatsByPlayer(rows: readonly TeamWeekStatRow[]): Map<string, TeamWeekStatRow[]> {
  const byKey = new Map<string, TeamWeekStatRow[]>();
  for (const row of rows) {
    const key = propPlayerMatchKey(row.name, row.team, row.position);
    const group = byKey.get(key);
    if (group) group.push(row);
    else byKey.set(key, [row]);
  }
  for (const group of byKey.values()) {
    group.sort((left, right) => left.week - right.week);
  }
  return byKey;
}
