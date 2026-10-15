/**
 * Pure helpers for Monitor Props: current-week consensus lines, line movement
 * from our stored weekly pulls, and per-week history vs nflverse actuals.
 *
 * Line movement is derived only from `prop_line_snapshots` (opening vs latest
 * within a week, and pull history). Never call a paid odds API here.
 */

import {
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

export type PropHistory = {
  games: number;
  overs: number;
  unders: number;
  pushes: number;
  /** overs / (overs + unders); null when no decided games. */
  hitRate: number | null;
  /** unders / (overs + unders); null when no decided games. */
  underRate: number | null;
  /** Per-game results vs the current line, oldest → newest. */
  cells: PropGameCell[];
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

/**
 * Compare a line to the player's weekly actuals for that market — pure
 * history, no projection. `weekRows` should already be filtered to one
 * player and sorted by week.
 */
export function buildPropHistory(
  stat: string,
  line: number,
  weekRows: readonly TeamWeekStatRow[],
): PropHistory {
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
  if (cells.length === 0 || !Number.isFinite(line)) {
    return { games: 0, overs: 0, unders: 0, pushes: 0, hitRate: null, underRate: null, cells: [] };
  }
  const overs = cells.filter((cell) => cell.result === "over").length;
  const unders = cells.filter((cell) => cell.result === "under").length;
  const pushes = cells.filter((cell) => cell.result === "push").length;
  const decided = overs + unders;
  return {
    games: cells.length,
    overs,
    unders,
    pushes,
    hitRate: decided > 0 ? Number((overs / decided).toFixed(3)) : null,
    underRate: decided > 0 ? Number((unders / decided).toFixed(3)) : null,
    cells,
  };
}

/**
 * Implied probability of an American odds price: -150 -> 0.6, +150 -> 0.4.
 * Null for missing or invalid prices (0 is not a real price).
 */
export function impliedProbability(odds: number | null): number | null {
  if (odds === null || !Number.isFinite(odds) || odds === 0) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/**
 * Props table order: best over hit rate first. Rows with no decided games
 * (hitRate null) sink below every rated row, including a 0% rate; ties
 * fall back to player name, then stat.
 */
export function compareHitRateDesc(
  left: { hitRate: number | null; name: string; stat: string },
  right: { hitRate: number | null; name: string; stat: string },
): number {
  const leftRate = left.hitRate ?? -1;
  const rightRate = right.hitRate ?? -1;
  if (rightRate !== leftRate) return rightRate - leftRate;
  return left.name.localeCompare(right.name) || left.stat.localeCompare(right.stat);
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
