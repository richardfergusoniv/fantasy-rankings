/**
 * Pure helpers for Monitor Props: current-week consensus lines, line movement
 * from our stored weekly pulls, and per-week history vs nflverse actuals.
 *
 * Line movement is derived only from `prop_line_snapshots` (opening vs latest
 * within a week, and pull history). Never call a paid odds API here.
 */

import {
  normalizeTeamStatsPlayerName,
  type TeamWeekSnapRow,
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
  /** The player's own closing line for that week. */
  line: number;
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
  /** Per-game results, each graded against that week's own line, oldest → newest. */
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

/** Live consensus lines for these markets are always 0.5 — hide from UI only. */
const HIDDEN_HALF_POINT_PROP_STATS = new Set<string>([
  "anytime_td",
  "first_td",
  "pass_interceptions",
]);

export function isHiddenHalfPointPropStat(stat: string): boolean {
  return HIDDEN_HALF_POINT_PROP_STATS.has(stat);
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

/** All-zero week row: the actuals of a player who played but recorded nothing. */
const ZERO_WEEK_ROW: TeamWeekStatRow = {
  playerId: "",
  name: "",
  team: "",
  opponent: "",
  position: "WR",
  week: 0,
  targets: 0,
  receptions: 0,
  receivingYards: 0,
  carries: 0,
  rushingYards: 0,
  receivingTds: 0,
  rushingTds: 0,
  passingTds: 0,
  fantasyPpr: 0,
  targetShare: null,
  completions: 0,
  passAttempts: 0,
  passingYards: 0,
  interceptions: 0,
  passingFirstDowns: 0,
  rushingFirstDowns: 0,
  receivingFirstDowns: 0,
  sacksTaken: 0,
  fumblesLost: 0,
  passing2pt: 0,
  rushing2pt: 0,
  receiving2pt: 0,
};

/**
 * Backtest this week's line against the player's season: every prior
 * week he played is graded against the one current line, so the hit
 * count reads "how many times this season he cleared this week's line".
 * A week he played (snap counts show offense snaps) but recorded no
 * stats has no nflverse stat row; it still counts, as an actual of 0 —
 * but only when the stats dataset itself covers that week
 * (`statWeeks`). Without that guard, a week the stats file has not
 * published yet (or a failed stats load) would zero-fill into a false
 * under. Weeks he did not play are skipped entirely. `weekRows`,
 * `playedWeeks`, and `statWeeks` should already be limited to prior
 * weeks and to this one player.
 */
export function buildPropHistory(
  stat: string,
  line: number,
  weekRows: readonly TeamWeekStatRow[],
  playedWeeks: ReadonlySet<number>,
  statWeeks: ReadonlySet<number>,
): PropHistory {
  const rowByWeek = new Map(weekRows.map((row) => [row.week, row]));
  const cells: PropGameCell[] = [];
  if (!Number.isFinite(line)) {
    return { games: 0, overs: 0, unders: 0, pushes: 0, hitRate: null, underRate: null, cells };
  }
  const weeks = new Set<number>([...rowByWeek.keys()].filter((week) => playedWeeks.has(week)));
  for (const week of playedWeeks) {
    if (statWeeks.has(week)) weeks.add(week);
  }
  for (const week of [...weeks].sort((left, right) => left - right)) {
    const row = rowByWeek.get(week);
    const actual = row
      ? propStatActual(stat, row)
      : propStatActual(stat, ZERO_WEEK_ROW);
    if (actual === null) continue;
    cells.push({
      week,
      line,
      actual,
      result: propGameResult(actual, line),
    });
  }
  if (cells.length === 0) {
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
 * Props table order: quantity of hits first — the line whose played side
 * has hit most often leads the board, and the hit rate only breaks ties
 * between lines with the same hit count (a 3-for-6 sits above a 2-for-2;
 * percentages never outrank raw hits). Rows with no decided games
 * (hitRate null) sink below every rated row, including a 0-hit one;
 * remaining ties fall back to player name, then stat. A row that does not
 * carry a hit count sorts as if it had none, below every counted row.
 * The order is a fixed key per row, so comparisons stay transitive even
 * when a list mixes rows with and without hit counts.
 */
export function compareHitsDesc(
  left: { hitRate: number | null; hits?: number; name: string; stat: string },
  right: { hitRate: number | null; hits?: number; name: string; stat: string },
): number {
  const keyOf = (row: { hitRate: number | null; hits?: number }): [number, number, number] => [
    row.hitRate === null ? 1 : 0,
    -(row.hits ?? -1),
    -(row.hitRate ?? -1),
  ];
  const leftKey = keyOf(left);
  const rightKey = keyOf(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return leftKey[index] - rightKey[index];
  }
  return left.name.localeCompare(right.name) || left.stat.localeCompare(right.stat);
}

export function propPlayerMatchKey(name: string, team: string | null | undefined, position: string): string {
  const teamKey = team ? team.trim().toUpperCase() : "";
  return `${position}|${teamKey}|${normalizeTeamStatsPlayerName(name)}`;
}

/** Name+position only — used for id-less rows when the name+position is unambiguous. */
export function propPlayerNamePositionKey(name: string, position: string): string {
  return `${position}|*|${normalizeTeamStatsPlayerName(name)}`;
}

function mergeWeekStatRows(existing: TeamWeekStatRow[], row: TeamWeekStatRow): void {
  const prior = existing.findIndex((item) => item.week === row.week);
  if (prior >= 0) existing[prior] = row;
  else existing.push(row);
}

function addWeekStatKey(
  byKey: Map<string, TeamWeekStatRow[]>,
  key: string,
  row: TeamWeekStatRow,
): void {
  const group = byKey.get(key);
  if (group) mergeWeekStatRows(group, row);
  else byKey.set(key, [row]);
}

/**
 * Name+position keys that appear on two+ teams in the same week — distinct
 * players sharing a normalized name, so cross-team joining would mix them.
 */
function ambiguousNamePositionKeys(
  rows: ReadonlyArray<{ name: string; team: string; position: string; week: number }>,
): Set<string> {
  const teamsByWeek = new Map<string, Map<number, Set<string>>>();
  for (const row of rows) {
    const key = propPlayerNamePositionKey(row.name, row.position);
    const team = row.team.trim().toUpperCase();
    let byWeek = teamsByWeek.get(key);
    if (!byWeek) {
      byWeek = new Map();
      teamsByWeek.set(key, byWeek);
    }
    const teams = byWeek.get(row.week);
    if (teams) teams.add(team);
    else byWeek.set(row.week, new Set([team]));
  }
  const ambiguous = new Set<string>();
  for (const [key, byWeek] of teamsByWeek) {
    for (const teams of byWeek.values()) {
      if (teams.size > 1) {
        ambiguous.add(key);
        break;
      }
    }
  }
  return ambiguous;
}

/**
 * Weeks each player actually played (at least one offensive snap). Always
 * keyed by name+team+position; also by name+position across teams when that
 * identity is unambiguous (no same-week multi-team clash). A played week with
 * no stat row is a zero week, not a missed game.
 */
export function indexPlayedWeeks(
  snaps: readonly TeamWeekSnapRow[],
): Map<string, Set<number>> {
  const played = snaps.filter((snap) => snap.offenseSnaps > 0);
  const ambiguous = ambiguousNamePositionKeys(played);
  const byKey = new Map<string, Set<number>>();
  for (const snap of played) {
    const teamKey = propPlayerMatchKey(snap.name, snap.team, snap.position);
    const teamGroup = byKey.get(teamKey);
    if (teamGroup) teamGroup.add(snap.week);
    else byKey.set(teamKey, new Set([snap.week]));

    const crossKey = propPlayerNamePositionKey(snap.name, snap.position);
    if (ambiguous.has(crossKey)) continue;
    const crossGroup = byKey.get(crossKey);
    if (crossGroup) crossGroup.add(snap.week);
    else byKey.set(crossKey, new Set([snap.week]));
  }
  return byKey;
}

/**
 * Index nflverse week rows by player id (when present) and name+team+position.
 * Rows also get a name+position key when that identity is unambiguous, so
 * mid-season team changes still join without mixing distinct players.
 */
export function indexWeekStatsByPlayer(rows: readonly TeamWeekStatRow[]): Map<string, TeamWeekStatRow[]> {
  const byKey = new Map<string, TeamWeekStatRow[]>();
  const ambiguous = ambiguousNamePositionKeys(rows);
  // Consumers carry Sleeper IDs, while nflverse rows carry GSIS IDs. Permit
  // name/position fallback across teams only when it resolves to one identity.
  const idsByName = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.playerId) continue;
    const key = propPlayerNamePositionKey(row.name, row.position);
    const ids = idsByName.get(key) ?? new Set<string>();
    ids.add(row.playerId);
    idsByName.set(key, ids);
    if (ids.size > 1) ambiguous.add(key);
  }
  for (const row of rows) {
    if (row.playerId) addWeekStatKey(byKey, row.playerId, row);
    addWeekStatKey(byKey, propPlayerMatchKey(row.name, row.team, row.position), row);
    const crossKey = propPlayerNamePositionKey(row.name, row.position);
    if (!ambiguous.has(crossKey)) addWeekStatKey(byKey, crossKey, row);
  }
  for (const group of byKey.values()) {
    group.sort((left, right) => left.week - right.week);
  }
  return byKey;
}

export type PropHistoryPlayerRef = {
  playerId?: string | null;
  name: string;
  team?: string | null;
  position: string;
};

/** Prefer player id, then unambiguous name+position, then name+team+position. */
export function weekStatsForPlayer(
  index: ReadonlyMap<string, TeamWeekStatRow[]>,
  player: PropHistoryPlayerRef,
): TeamWeekStatRow[] {
  if (player.playerId) {
    const byId = index.get(player.playerId);
    if (byId?.length) return byId;
  }
  const byNamePos = index.get(propPlayerNamePositionKey(player.name, player.position));
  if (byNamePos?.length) return byNamePos;
  return index.get(propPlayerMatchKey(player.name, player.team, player.position)) ?? [];
}

/** Prefer unambiguous name+position across teams, then the team-keyed match. */
export function playedWeeksForPlayer(
  index: ReadonlyMap<string, Set<number>>,
  player: PropHistoryPlayerRef,
): Set<number> {
  const byNamePos = index.get(propPlayerNamePositionKey(player.name, player.position));
  if (byNamePos?.size) return byNamePos;
  return index.get(propPlayerMatchKey(player.name, player.team, player.position)) ?? new Set();
}
