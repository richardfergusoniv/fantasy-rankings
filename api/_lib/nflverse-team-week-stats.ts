/**
 * nflverse week-by-week player stats for the Monitor "Team stats" panel.
 * Pure parse/build helpers — callers fetch CSVs SERVER-SIDE ONLY: GitHub
 * release assets send no CORS headers, so a browser fetch of these URLs
 * always fails (the panels read parsed rows from /api/pfn-tables instead).
 *
 * Sources (CC BY 4.0):
 * - stats_player_week_{season}.csv
 * - snap_counts_{season}.csv
 */

import { splitCsvLine } from "./chart-metric-transforms.js";
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";

export const TEAM_WEEK_STATS_STALE_MS = 6 * 60 * 60 * 1000;

export function nflversePlayerWeekStatsUrl(season: number): string {
  return `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
}

export function nflverseSnapCountsUrl(season: number): string {
  return `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
}

/** Canonical NFL team codes used across the app (JAC→JAX, etc.). */
export const NFL_TEAM_CODES = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;

export type NflTeamCode = (typeof NFL_TEAM_CODES)[number];

export type TeamStatsPosition = "QB" | "RB" | "WR" | "TE";

export type TeamStatsStatId =
  | "snaps"
  | "targets"
  | "receptions"
  | "receiving_yards"
  | "carries"
  | "rushing_yards"
  | "tds"
  | "fantasy_points";

export type TeamStatsStatDef = {
  id: TeamStatsStatId;
  label: string;
  /** When set, weekly cells stack count above this percentage value. */
  percentOf?: "snaps" | "targets";
};

export const TEAM_STATS_STAT_OPTIONS: readonly TeamStatsStatDef[] = [
  { id: "snaps", label: "Snaps", percentOf: "snaps" },
  { id: "targets", label: "Targets" },
  { id: "receptions", label: "Receptions" },
  { id: "receiving_yards", label: "Rec yards" },
  { id: "carries", label: "Carries" },
  { id: "rushing_yards", label: "Rush yards" },
  { id: "tds", label: "TDs" },
  { id: "fantasy_points", label: "Fantasy points" },
] as const;

export const TEAM_STATS_POSITIONS: readonly TeamStatsPosition[] = ["QB", "RB", "WR", "TE"];

/**
 * Display groups for the panel. WRs and TEs draw from the same pool of
 * targets and receiving production, so they are never split apart.
 */
export type TeamStatsGroupId = "ALL" | TeamStatsPosition;

export const TEAM_STATS_GROUPS: readonly { id: TeamStatsGroupId; label: string }[] = [
  { id: "ALL", label: "ALL" },
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR", label: "WR" },
  { id: "TE", label: "TE" },
];

export const TEAM_STATS_GROUP_POSITIONS: Record<TeamStatsGroupId, readonly TeamStatsPosition[]> = {
  ALL: ["QB", "RB", "WR", "TE"],
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
};

/** Links saved before WR and TE were split name the old combined group; they open on WR. */
export function parseTeamStatsGroup(value: string | null | undefined): TeamStatsGroupId | null {
  if (value === "WRTE") return "WR";
  return TEAM_STATS_GROUPS.find((group) => group.id === value)?.id ?? null;
}

export type TeamWeekStatRow = {
  playerId: string;
  name: string;
  team: string;
  /** Canonical opponent team code for that week; "" when the source row lacks one. */
  opponent: string;
  position: TeamStatsPosition;
  week: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  carries: number;
  rushingYards: number;
  receivingTds: number;
  rushingTds: number;
  passingTds: number;
  fantasyPpr: number;
  /** 0–100 when present. */
  targetShare: number | null;
  /** Extra fields reused by Monitor Props edge math. */
  completions: number;
  passAttempts: number;
  passingYards: number;
  interceptions: number;
  /** First downs by phase, for point-per-first-down league scoring. */
  passingFirstDowns: number;
  rushingFirstDowns: number;
  receivingFirstDowns: number;
  /** Sacks taken (the `sacks_suffered` column for offensive players). */
  sacksTaken: number;
  /** Total fumbles lost (`fumbles_lost_total`). */
  fumblesLost: number;
  /** Two-point conversions by phase. */
  passing2pt: number;
  rushing2pt: number;
  receiving2pt: number;
};

export type TeamWeekSnapRow = {
  name: string;
  team: string;
  position: TeamStatsPosition;
  week: number;
  offenseSnaps: number;
  /** 0–100. */
  offensePct: number;
};

export type TeamStatsWeekCell = {
  week: number;
  /** Primary display value (count for stacked %, else the stat). */
  value: number;
  /** Present for snap % / target share cells. */
  percent: number | null;
  /** Whether the stats (or, for snaps, snap-count) source row exists for this week; false means the player had no row, e.g. a bye. */
  hasSourceRow: boolean;
};

export type TeamStatsPlayerRow = {
  key: string;
  playerId: string | null;
  name: string;
  team: string;
  position: TeamStatsPosition;
  weeks: TeamStatsWeekCell[];
  /** Season total of the countable / primary value (not the %). */
  total: number;
};

const SKILL = new Set<string>(["QB", "RB", "WR", "TE"]);

export function canonicalNflTeam(team: string): string {
  const raw = team.trim().toUpperCase();
  if (raw === "JAC") return "JAX";
  if (raw === "LA") return "LAR";
  if (raw === "LVR" || raw === "OAK") return "LV";
  if (raw === "WSH") return "WAS";
  return raw;
}

export function normalizeTeamStatsPlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/jr$|sr$|ii$|iii$|iv$/g, "");
}

function cell(cells: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return cells[index] ?? "";
}

function parseNumber(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function parseOptionalRatio(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

function asSkillPosition(value: string): TeamStatsPosition | null {
  if (value === "QB" || value === "RB" || value === "WR" || value === "TE") return value;
  return null;
}

/** Parse nflverse player week stats into compact skill-position rows (REG only). */
export function parsePlayerWeekStatsCsv(csv: string): TeamWeekStatRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0] ?? "");
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const required = [
    "player_id",
    "player_display_name",
    "position",
    "team",
    "week",
    "season_type",
  ] as const;
  for (const key of required) {
    if (index[key] === undefined) return [];
  }

  const output: TeamWeekStatRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (cell(cells, index.season_type).trim() !== "REG") continue;
    const position = asSkillPosition(cell(cells, index.position).trim());
    if (!position) continue;
    const week = Number(cell(cells, index.week));
    const playerId = cell(cells, index.player_id).trim();
    const name = cell(cells, index.player_display_name).trim()
      || cell(cells, index.player_name).trim();
    const team = canonicalNflTeam(cell(cells, index.team).trim());
    if (!playerId || !name || !team || !Number.isFinite(week)) continue;
    const opponent = canonicalNflTeam(cell(cells, index.opponent_team));
    const targetShareRaw = parseOptionalRatio(cell(cells, index.target_share));
    output.push({
      playerId,
      name,
      team,
      opponent,
      position,
      week,
      targets: parseNumber(cell(cells, index.targets)),
      receptions: parseNumber(cell(cells, index.receptions)),
      receivingYards: parseNumber(cell(cells, index.receiving_yards)),
      carries: parseNumber(cell(cells, index.carries)),
      rushingYards: parseNumber(cell(cells, index.rushing_yards)),
      receivingTds: parseNumber(cell(cells, index.receiving_tds)),
      rushingTds: parseNumber(cell(cells, index.rushing_tds)),
      passingTds: parseNumber(cell(cells, index.passing_tds)),
      fantasyPpr: parseNumber(cell(cells, index.fantasy_points_ppr)),
      targetShare: targetShareRaw === null ? null : targetShareRaw * 100,
      completions: parseNumber(cell(cells, index.completions)),
      passAttempts: parseNumber(cell(cells, index.attempts)),
      passingYards: parseNumber(cell(cells, index.passing_yards)),
      interceptions: parseNumber(cell(cells, index.passing_interceptions)),
      passingFirstDowns: parseNumber(cell(cells, index.passing_first_downs)),
      rushingFirstDowns: parseNumber(cell(cells, index.rushing_first_downs)),
      receivingFirstDowns: parseNumber(cell(cells, index.receiving_first_downs)),
      sacksTaken: parseNumber(cell(cells, index.sacks_suffered)),
      fumblesLost: parseNumber(cell(cells, index.fumbles_lost_total)),
      passing2pt: parseNumber(cell(cells, index.passing_2pt_conversions)),
      rushing2pt: parseNumber(cell(cells, index.rushing_2pt_conversions)),
      receiving2pt: parseNumber(cell(cells, index.receiving_2pt_conversions)),
    });
  }
  return output;
}

/** Parse nflverse snap_counts CSV including offense snap counts (REG only). */
export function parseTeamWeekSnapCountsCsv(csv: string): TeamWeekSnapRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0] ?? "");
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const required = ["week", "player", "team", "position", "offense_snaps", "offense_pct"] as const;
  for (const key of required) {
    if (index[key] === undefined) return [];
  }

  const output: TeamWeekSnapRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (index.game_type !== undefined && cell(cells, index.game_type) && cell(cells, index.game_type) !== "REG") {
      continue;
    }
    // Snap counts label some teams' running backs "HB" (Cincinnati in 2026).
    const rawPosition = cell(cells, index.position).trim();
    const position = asSkillPosition(rawPosition === "HB" ? "RB" : rawPosition);
    if (!position || !SKILL.has(position)) continue;
    const week = Number(cell(cells, index.week));
    const name = cell(cells, index.player).trim();
    const team = canonicalNflTeam(cell(cells, index.team).trim());
    const offenseSnaps = parseNumber(cell(cells, index.offense_snaps));
    const offensePctRaw = parseOptionalRatio(cell(cells, index.offense_pct));
    if (!name || !team || !Number.isFinite(week) || offensePctRaw === null) continue;
    output.push({
      name,
      team,
      position,
      week,
      offenseSnaps,
      offensePct: offensePctRaw * 100,
    });
  }
  return output;
}

function playerKey(name: string, team: string, position: string): string {
  return `${position}|${team}|${normalizeTeamStatsPlayerName(name)}`;
}

function weekValueForStat(
  statId: TeamStatsStatId,
  weekStats: TeamWeekStatRow | undefined,
  weekSnap: TeamWeekSnapRow | undefined,
  scoringSettings?: Record<string, number>,
): { value: number; percent: number | null } {
  switch (statId) {
    case "snaps":
      return {
        value: weekSnap?.offenseSnaps ?? 0,
        percent: weekSnap ? weekSnap.offensePct : null,
      };
    case "targets":
      return { value: weekStats?.targets ?? 0, percent: weekStats?.targetShare ?? null };
    case "receptions":
      return { value: weekStats?.receptions ?? 0, percent: null };
    case "receiving_yards":
      return { value: weekStats?.receivingYards ?? 0, percent: null };
    case "carries":
      return { value: weekStats?.carries ?? 0, percent: null };
    case "rushing_yards":
      return { value: weekStats?.rushingYards ?? 0, percent: null };
    case "tds": {
      const total = (weekStats?.passingTds ?? 0)
        + (weekStats?.rushingTds ?? 0)
        + (weekStats?.receivingTds ?? 0);
      return { value: total, percent: null };
    }
    case "fantasy_points": {
      if (!weekStats) return { value: 0, percent: null };
      // Without the league's settings (older payloads), fall back to the
      // nflverse PPR total; with them, score the week in league format.
      // An empty settings object counts as absent (it would zero every week).
      if (!scoringSettings || Object.keys(scoringSettings).length === 0) {
        return { value: weekStats.fantasyPpr, percent: null };
      }
      const stats: Record<string, number> = {
        pass_yd: weekStats.passingYards,
        pass_td: weekStats.passingTds,
        pass_int: weekStats.interceptions,
        pass_cmp: weekStats.completions,
        pass_att: weekStats.passAttempts,
        pass_inc: Math.max(0, weekStats.passAttempts - weekStats.completions),
        pass_sack: weekStats.sacksTaken,
        pass_fd: weekStats.passingFirstDowns,
        rush_att: weekStats.carries,
        rush_yd: weekStats.rushingYards,
        rush_td: weekStats.rushingTds,
        rush_fd: weekStats.rushingFirstDowns,
        rec: weekStats.receptions,
        rec_yd: weekStats.receivingYards,
        rec_td: weekStats.receivingTds,
        rec_fd: weekStats.receivingFirstDowns,
        fum_lost: weekStats.fumblesLost,
        pass_2pt: weekStats.passing2pt,
        rush_2pt: weekStats.rushing2pt,
        rec_2pt: weekStats.receiving2pt,
      };
      return { value: scoreProjectedPlayerStats(weekStats.position, stats, scoringSettings), percent: null };
    }
    default: {
      const _exhaustive: never = statId;
      throw new Error(`Unhandled team stats stat: ${_exhaustive}`);
    }
  }
}

/**
 * Weeks (1..throughWeek) with at least one recorded source row for the team
 * and positions: snap rows for snaps, stat rows otherwise. Read before
 * buildTeamStatsTable drops players with no season activity, so a week only
 * those players appeared in (a zero-TD week) still counts as played.
 */
export function teamStatsRecordedWeeks(options: {
  stats: TeamWeekStatRow[];
  snaps: TeamWeekSnapRow[];
  team: string;
  positions: readonly TeamStatsPosition[];
  statId: TeamStatsStatId;
  throughWeek: number;
}): number[] {
  const team = canonicalNflTeam(options.team);
  const throughWeek = Math.max(1, Math.floor(options.throughWeek));
  const source: ReadonlyArray<{ team: string; position: TeamStatsPosition; week: number }> = options.statId === "snaps"
    ? options.snaps
    : options.stats;
  const weeks = new Set<number>();
  for (const row of source) {
    if (row.team !== team || !options.positions.includes(row.position)) continue;
    if (row.week < 1 || row.week > throughWeek) continue;
    weeks.add(row.week);
  }
  return [...weeks].sort((a, b) => a - b);
}

/**
 * Build week-by-week rows for one team + position group + stat.
 * Columns span weeks 1..throughWeek; sorted by season total descending.
 */
export function buildTeamStatsTable(options: {
  stats: TeamWeekStatRow[];
  snaps: TeamWeekSnapRow[];
  team: string;
  positions: readonly TeamStatsPosition[];
  statId: TeamStatsStatId;
  throughWeek: number;
  /** League scoring settings; scores the fantasy_points stat in league format. */
  scoringSettings?: Record<string, number>;
}): TeamStatsPlayerRow[] {
  const team = canonicalNflTeam(options.team);
  const throughWeek = Math.max(1, Math.floor(options.throughWeek));
  const weeks = Array.from({ length: throughWeek }, (_, index) => index + 1);

  type Acc = {
    playerId: string | null;
    name: string;
    team: string;
    position: TeamStatsPosition;
    byWeekStats: Map<number, TeamWeekStatRow>;
    byWeekSnaps: Map<number, TeamWeekSnapRow>;
  };

  const players = new Map<string, Acc>();

  for (const row of options.stats) {
    if (row.team !== team || !options.positions.includes(row.position)) continue;
    if (row.week < 1 || row.week > throughWeek) continue;
    const key = playerKey(row.name, row.team, row.position);
    const acc = players.get(key) ?? {
      playerId: row.playerId,
      name: row.name,
      team: row.team,
      position: row.position,
      byWeekStats: new Map(),
      byWeekSnaps: new Map(),
    };
    acc.playerId = acc.playerId ?? row.playerId;
    acc.byWeekStats.set(row.week, row);
    players.set(key, acc);
  }

  for (const row of options.snaps) {
    if (row.team !== team || !options.positions.includes(row.position)) continue;
    if (row.week < 1 || row.week > throughWeek) continue;
    const key = playerKey(row.name, row.team, row.position);
    const acc = players.get(key) ?? {
      playerId: null,
      name: row.name,
      team: row.team,
      position: row.position,
      byWeekStats: new Map(),
      byWeekSnaps: new Map(),
    };
    acc.byWeekSnaps.set(row.week, row);
    players.set(key, acc);
  }

  const output: TeamStatsPlayerRow[] = [];
  for (const [key, acc] of players) {
    const weekCells: TeamStatsWeekCell[] = weeks.map((week) => {
      const weekStats = acc.byWeekStats.get(week);
      const weekSnap = acc.byWeekSnaps.get(week);
      const { value, percent } = weekValueForStat(options.statId, weekStats, weekSnap, options.scoringSettings);
      const hasSourceRow = options.statId === "snaps" ? weekSnap !== undefined : weekStats !== undefined;
      return { week, value, percent, hasSourceRow };
    });
    const total = weekCells.reduce((sum, cell) => sum + cell.value, 0);
    // Drop players with no countable activity in-range (keeps table focused).
    if (total <= 0 && !weekCells.some((cell) => cell.percent !== null && cell.percent > 0)) {
      continue;
    }
    output.push({
      key,
      playerId: acc.playerId,
      name: acc.name,
      team: acc.team,
      position: acc.position,
      weeks: weekCells,
      total: Number(total.toFixed(2)),
    });
  }

  return output.sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    return left.name.localeCompare(right.name);
  });
}

export type TeamStatsStackSegment = {
  key: string;
  name: string;
  value: number;
  /** 0–1 share of the week's position-group total. */
  share: number;
};

export type TeamStatsWeekStack = {
  week: number;
  /** Sum of the week's values across the position group. */
  total: number;
  /**
   * Whether any player recorded a nonzero value that week. Negative
   * values (a QB's fantasy_ppr after interceptions) count as activity
   * even though they never enter the positive-only bar total.
   */
  hasActivity: boolean;
  /** Largest first; sub-`minShare` players are merged into a trailing "Other". */
  segments: TeamStatsStackSegment[];
};

/**
 * Reshape table rows into per-week 100%-stack segments: each week's bar is
 * the position group's total, split by each player's share of it.
 */
export function buildTeamStatsWeekStacks(
  rows: readonly TeamStatsPlayerRow[],
  minShare = 0.02,
): TeamStatsWeekStack[] {
  const weekNumbers = new Set<number>();
  for (const row of rows) {
    for (const cell of row.weeks) weekNumbers.add(cell.week);
  }
  const stacks: TeamStatsWeekStack[] = [];
  for (const week of [...weekNumbers].sort((a, b) => a - b)) {
    const segments: TeamStatsStackSegment[] = [];
    let total = 0;
    let hasActivity = false;
    for (const row of rows) {
      const cell = row.weeks.find((candidate) => candidate.week === week);
      if (!cell) continue;
      if (cell.value !== 0) hasActivity = true;
      if (cell.value <= 0) continue;
      total += cell.value;
      segments.push({ key: row.key, name: row.name, value: cell.value, share: 0 });
    }
    if (total <= 0) {
      stacks.push({ week, total: 0, hasActivity, segments: [] });
      continue;
    }
    segments.sort((left, right) => right.value - left.value);
    const kept: TeamStatsStackSegment[] = [];
    let otherValue = 0;
    for (const segment of segments) {
      segment.share = segment.value / total;
      if (segment.share < minShare) {
        otherValue += segment.value;
      } else {
        kept.push(segment);
      }
    }
    if (otherValue > 0) {
      kept.push({ key: "__other__", name: "Other", value: otherValue, share: otherValue / total });
    }
    stacks.push({ week, total: Number(total.toFixed(2)), hasActivity, segments: kept });
  }
  return stacks;
}

/** Prefer the user's most common roster NFL team; fall back to first code. */
export function defaultTeamStatsTeam(rosterTeams: readonly (string | null | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const raw of rosterTeams) {
    if (!raw) continue;
    const team = canonicalNflTeam(raw);
    if (!NFL_TEAM_CODES.includes(team as NflTeamCode)) continue;
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [team, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || team.localeCompare(best) < 0))) {
      best = team;
      bestCount = count;
    }
  }
  return best ?? NFL_TEAM_CODES[0]!;
}

/** Prefer the display group the user actually rostered most on `team`, else WR/TE. */
export function defaultTeamStatsGroup(
  rosterPlayers: readonly { team: string | null; position: string }[],
  team: string,
): TeamStatsGroupId {
  const target = canonicalNflTeam(team);
  const counts = new Map<TeamStatsPosition, number>();
  for (const player of rosterPlayers) {
    if (!player.team || canonicalNflTeam(player.team) !== target) continue;
    const position = asSkillPosition(player.position);
    if (!position) continue;
    counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  // The default is the position group holding most of the roster's players on this team.
  let best: TeamStatsGroupId = "WR";
  let bestCount = 0;
  for (const group of TEAM_STATS_GROUPS) {
    if (group.id === "ALL") continue;
    const count = counts.get(group.id) ?? 0;
    if (count > bestCount) {
      best = group.id;
      bestCount = count;
    }
  }
  return best;
}

export function teamStatsStatDef(statId: TeamStatsStatId): TeamStatsStatDef {
  const found = TEAM_STATS_STAT_OPTIONS.find((option) => option.id === statId);
  return found ?? TEAM_STATS_STAT_OPTIONS[0]!;
}

/** Format a primary cell value (counts as ints; PPR keeps one decimal when needed). */
export function formatTeamStatsValue(statId: TeamStatsStatId, value: number): string {
  if (statId === "fantasy_points") {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  return String(Math.round(value));
}

/**
 * What the Avg column means. Snap % is each player's own rate,
 * not a split of one total, so a position group's rows can add to more than 100%.
 */
export function teamStatsLegendCaption(statId: TeamStatsStatId): string {
  if (statId === "snaps") return "Average snap % per game. Players share the field, so rows can add to more than 100%.";
  return `${teamStatsStatDef(statId).label}, average per game.`;
}

export function formatTeamStatsPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}
