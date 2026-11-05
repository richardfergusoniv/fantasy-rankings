import { z } from "zod";
import {
  analyticsEntitySchema,
  analyticsSchema,
  nflTeamRecordSchema,
  teamUsageSchema,
} from "./dashboard-schemas.js";
import { canonicalTeam } from "./sleeper.js";
import {
  applySnapSharesToRows,
  enrichOpportunityMetrics,
  weeklySnapsByPlayerId,
  type ChartStatRow,
} from "./chart-metric-transforms.js";
import type { ChartExtrasSnapshot } from "./nflverse-chart-extras.js";
import { analyticsSleeperPlayerId } from "./analytics-player-id.js";
import type { PlayerInsightsSnapshot } from "./player-insights.js";

/**
 * Dashboard analytics (nflverse weekly player stats → entities / team
 * usage), computed by the refresh-player-insights cron job and stored in
 * the player-insights snapshot; dashboard builds read the stored result
 * instead of downloading and parsing the raw stats files themselves.
 *
 * The parse below streams the CSV one row at a time and projects only the
 * columns the row math reads. The previous in-build parse materialized
 * every row as a full ~150-column record before slimming it, a ~120MB
 * transient spike for a stage whose retained output is under 1MB; the
 * streaming parse holds one row at a time, so a build (or a Worker
 * isolate, if the app moves) never carries that spike.
 */

export const NFLVERSE_PLAYER_STATS_2026_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv";
export const NFLVERSE_PLAYER_STATS_2025_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";

export type StatRow = {
  id: string;
  name: string;
  team: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  season: number;
  week: number;
  gameId: string;
  values: Record<string, number>;
};

type AnalyticsEntity = z.infer<typeof analyticsEntitySchema>;
type TeamUsageRow = z.infer<typeof teamUsageSchema>;

const RATE_METRICS = new Set([
  "completion_pct",
  "cpoe",
  "epa_per_play",
  "target_share",
  "air_yards_share",
  "wopr",
  "racr",
  "fg_pct",
  "opportunity_share",
  "carry_share",
  "rb_target_share",
  "snap_share",
  "rz_target_share",
  "rz_carry_share",
]);

function numeric(row: Record<string, string>, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function optionalNumeric(row: Record<string, string>, key: string): number | null {
  const raw = row[key];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Every column the analytics row math reads; all other CSV columns are dropped as each row streams past. */
const ANALYTICS_COLUMNS: ReadonlySet<string> = new Set([
  "air_yards_share", "attempts", "carries", "completions", "def_2pt", "def_fg_blocks", "def_fumbles_forced", "def_interceptions", "def_pass_defended", "def_pat_blocks", "def_punt_blocks", "def_qb_hits", "def_sacks", "def_safeties", "def_tackles_for_loss", "def_tds", "fantasy_points", "fantasy_points_ppr", "fg_att", "fg_att_0_19", "fg_att_20_29", "fg_att_30_39", "fg_att_40_49", "fg_att_50_59", "fg_att_60_", "fg_made", "fg_made_0_19", "fg_made_20_29", "fg_made_30_39", "fg_made_40_49", "fg_made_50_59", "fg_made_60_", "fumble_recovery_opp", "game_id", "kickoff_return_tds", "kickoff_return_yards", "passing_2pt_conversions", "passing_air_yards", "passing_cpoe", "passing_epa", "passing_first_downs", "passing_interceptions", "passing_tds", "passing_yards", "pat_att", "pat_made", "player_display_name", "player_id", "player_name", "position", "punt_return_tds", "punt_return_yards", "racr", "receiving_2pt_conversions", "receiving_air_yards", "receiving_epa", "receiving_first_downs", "receiving_fumbles", "receiving_fumbles_lost", "receiving_tds", "receiving_yards", "receiving_yards_after_catch", "recent_team", "receptions", "rushing_2pt_conversions", "rushing_epa", "rushing_first_downs", "rushing_fumbles", "rushing_fumbles_lost", "rushing_tds", "rushing_yards", "sack_fumbles", "sack_fumbles_lost", "sack_yards", "sacks", "season", "season_type", "snap_share", "target_share", "targets", "team", "week", "wopr",
]);

/**
 * The dashboard build's old CSV state machine, yielding one row at a
 * time instead of collecting the whole file: same quote handling, same
 * skipped all-empty rows, same trailing-row rule.
 */
function* csvRowArrays(source: string): Generator<string[]> {
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) yield row;
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** Header-keyed records holding only ANALYTICS_COLUMNS, one row at a time. */
function* analyticsRecords(source: string): Generator<Record<string, string>> {
  const rows = csvRowArrays(source);
  const headerStep = rows.next();
  const headers = headerStep.done ? [] : headerStep.value;
  const columnIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (ANALYTICS_COLUMNS.has(header)) columnIndex.set(header, index);
  });
  for (const values of rows) {
    const record: Record<string, string> = {};
    for (const [column, index] of columnIndex) record[column] = values[index] ?? "";
    yield record;
  }
}

function playerValues(row: Record<string, string>, position: "QB" | "RB" | "WR" | "TE" | "K"): Record<string, number> {
  const completions = numeric(row, "completions");
  const attempts = numeric(row, "attempts");
  const passingTds = numeric(row, "passing_tds");
  const rushingTds = numeric(row, "rushing_tds");
  const receivingTds = numeric(row, "receiving_tds");
  const fantasyStandard = numeric(row, "fantasy_points");
  const fantasyPpr = numeric(row, "fantasy_points_ppr");
  const values: Record<string, number> = {
    fantasy_ppr: fantasyPpr,
    fantasy_half_ppr: (fantasyStandard + fantasyPpr) / 2,
    fantasy_standard: fantasyStandard,
    total_tds: passingTds + rushingTds + receivingTds,
    passing_first_downs: numeric(row, "passing_first_downs"),
    rushing_first_downs: numeric(row, "rushing_first_downs"),
    receiving_first_downs: numeric(row, "receiving_first_downs"),
    passing_2pt_conversions: numeric(row, "passing_2pt_conversions"),
    rushing_2pt_conversions: numeric(row, "rushing_2pt_conversions"),
    receiving_2pt_conversions: numeric(row, "receiving_2pt_conversions"),
    fumbles: numeric(row, "sack_fumbles") + numeric(row, "rushing_fumbles") + numeric(row, "receiving_fumbles"),
    fumbles_lost: numeric(row, "sack_fumbles_lost") + numeric(row, "rushing_fumbles_lost") + numeric(row, "receiving_fumbles_lost"),
    punt_return_yards: numeric(row, "punt_return_yards"),
    kickoff_return_yards: numeric(row, "kickoff_return_yards"),
    punt_return_tds: numeric(row, "punt_return_tds"),
    kickoff_return_tds: numeric(row, "kickoff_return_tds"),
  };
  if (position === "QB") {
    const passingEpa = numeric(row, "passing_epa");
    const passingSacks = numeric(row, "sacks");
    const passingPlays = attempts + passingSacks;
    Object.assign(values, {
      completions,
      pass_attempts: attempts,
      completion_pct: attempts > 0 ? (completions / attempts) * 100 : 0,
      passing_yards: numeric(row, "passing_yards"),
      passing_tds: passingTds,
      interceptions: numeric(row, "passing_interceptions"),
      passing_air_yards: numeric(row, "passing_air_yards"),
      passing_epa: passingEpa,
      epa_per_play: passingPlays > 0 ? passingEpa / passingPlays : 0,
      passing_sacks: passingSacks,
      sack_yards: numeric(row, "sack_yards"),
      carries: numeric(row, "carries"),
      rushing_yards: numeric(row, "rushing_yards"),
      rushing_tds: rushingTds,
    });
    const cpoe = optionalNumeric(row, "passing_cpoe");
    if (cpoe !== null) values.cpoe = cpoe;
  } else if (position === "RB") {
    const carries = numeric(row, "carries");
    const targets = numeric(row, "targets");
    const receptions = numeric(row, "receptions");
    const rushingYards = numeric(row, "rushing_yards");
    const receivingYards = numeric(row, "receiving_yards");
    Object.assign(values, {
      carries,
      targets,
      touches: carries + receptions,
      receptions,
      rushing_yards: rushingYards,
      receiving_yards: receivingYards,
      scrimmage_yards: rushingYards + receivingYards,
      rushing_tds: rushingTds,
      receiving_tds: receivingTds,
      rushing_epa: numeric(row, "rushing_epa"),
      receiving_epa: numeric(row, "receiving_epa"),
    });
    const targetShare = optionalNumeric(row, "target_share");
    if (targetShare !== null) values.target_share = targetShare * 100;
  } else if (position === "WR" || position === "TE") {
    Object.assign(values, {
      carries: numeric(row, "carries"),
      rushing_yards: numeric(row, "rushing_yards"),
      rushing_tds: rushingTds,
      targets: numeric(row, "targets"),
      receptions: numeric(row, "receptions"),
      receiving_yards: numeric(row, "receiving_yards"),
      receiving_air_yards: numeric(row, "receiving_air_yards"),
      receiving_tds: receivingTds,
      receiving_epa: numeric(row, "receiving_epa"),
      yards_after_catch: numeric(row, "receiving_yards_after_catch"),
    });
    const ratios: Array<[string, string, number]> = [
      ["target_share", "target_share", 100],
      ["air_yards_share", "air_yards_share", 100],
      ["wopr", "wopr", 1],
      ["racr", "racr", 1],
    ];
    for (const [metric, field, multiplier] of ratios) {
      const value = optionalNumeric(row, field);
      if (value !== null) values[metric] = value * multiplier;
    }
  } else {
    const fgMade = numeric(row, "fg_made");
    const fgAtt = numeric(row, "fg_att");
    const patMade = numeric(row, "pat_made");
    const patAtt = numeric(row, "pat_att");
    Object.assign(values, {
      fg_made: fgMade,
      fg_attempts: fgAtt,
      fg_pct: fgAtt > 0 ? (fgMade / fgAtt) * 100 : 0,
      fg_made_0_19: numeric(row, "fg_made_0_19"),
      fg_made_20_29: numeric(row, "fg_made_20_29"),
      fg_made_30_39: numeric(row, "fg_made_30_39"),
      fg_made_40_49: numeric(row, "fg_made_40_49"),
      fg_made_50_59: numeric(row, "fg_made_50_59"),
      fg_made_60_plus: numeric(row, "fg_made_60_"),
      fg_attempts_0_19: numeric(row, "fg_att_0_19"),
      fg_attempts_20_29: numeric(row, "fg_att_20_29"),
      fg_attempts_30_39: numeric(row, "fg_att_30_39"),
      fg_attempts_40_49: numeric(row, "fg_att_40_49"),
      fg_attempts_50_59: numeric(row, "fg_att_50_59"),
      fg_attempts_60_plus: numeric(row, "fg_att_60_"),
      fg_40_plus: numeric(row, "fg_made_40_49") + numeric(row, "fg_made_50_59") + numeric(row, "fg_made_60_"),
      fg_50_plus: numeric(row, "fg_made_50_59") + numeric(row, "fg_made_60_"),
      pat_made: patMade,
      pat_attempts: patAtt,
      kicks_made: fgMade + patMade,
    });
  }
  const snapShare = optionalNumeric(row, "snap_share");
  if (snapShare !== null) values.snap_share = snapShare * 100;
  return values;
}

export function parseAnalyticsRows(csv: string): StatRow[] {
  const output: StatRow[] = [];
  const defenses = new Map<string, StatRow>();
  const offenseYardsByGameTeam = new Map<string, number>();
  const teamsByGame = new Map<string, Set<string>>();
  for (const row of analyticsRecords(csv)) {
    if (row.season_type !== "REG") continue;
    const season = Number(row.season);
    const week = Number(row.week);
    const gameId = row.game_id ?? "";
    const team = canonicalTeam(row.team ?? row.recent_team ?? "");
    // Weeks must be integers: the stored snapshot schema validates throughWeek
    // and the weekly entries as ints, so one fractional-week source row would
    // make the whole snapshot fail its read-side parse.
    if (!Number.isFinite(season) || !Number.isInteger(week) || !gameId || !team) continue;
    const gameKey = `${season}:${gameId}`;
    const gameTeams = teamsByGame.get(gameKey) ?? new Set<string>();
    gameTeams.add(team);
    teamsByGame.set(gameKey, gameTeams);
    const offenseKey = `${gameKey}:${team}`;
    offenseYardsByGameTeam.set(offenseKey, (offenseYardsByGameTeam.get(offenseKey) ?? 0) + numeric(row, "passing_yards") + numeric(row, "rushing_yards"));
    const position = row.position;
    if (position === "QB" || position === "RB" || position === "WR" || position === "TE" || position === "K") {
      const id = row.player_id ?? "";
      const name = row.player_display_name ?? row.player_name ?? "";
      if (id && name) output.push({ id, name, team, position, season, week, gameId, values: playerValues(row, position) });
    }

    const defenseKey = `${season}:${gameId}:${team}`;
    const defense = defenses.get(defenseKey) ?? {
      id: team,
      name: `${team} Defense`,
      team,
      position: "DEF" as const,
      season,
      week,
      gameId,
      values: {
        sacks: 0,
        interceptions: 0,
        forced_fumbles: 0,
        fumble_recoveries: 0,
        takeaways: 0,
        tackles_for_loss: 0,
        qb_hits: 0,
        passes_defended: 0,
        defensive_tds: 0,
        blocked_kicks: 0,
        safeties: 0,
        defensive_two_point_returns: 0,
        return_tds: 0,
        return_yards: 0,
      },
    };
    const interceptions = numeric(row, "def_interceptions");
    const recoveries = numeric(row, "fumble_recovery_opp");
    defense.values.sacks = (defense.values.sacks ?? 0) + numeric(row, "def_sacks");
    defense.values.interceptions = (defense.values.interceptions ?? 0) + interceptions;
    defense.values.forced_fumbles = (defense.values.forced_fumbles ?? 0) + numeric(row, "def_fumbles_forced");
    defense.values.fumble_recoveries = (defense.values.fumble_recoveries ?? 0) + recoveries;
    defense.values.takeaways = (defense.values.takeaways ?? 0) + interceptions + recoveries;
    defense.values.tackles_for_loss = (defense.values.tackles_for_loss ?? 0) + numeric(row, "def_tackles_for_loss");
    defense.values.qb_hits = (defense.values.qb_hits ?? 0) + numeric(row, "def_qb_hits");
    defense.values.passes_defended = (defense.values.passes_defended ?? 0) + numeric(row, "def_pass_defended");
    defense.values.defensive_tds = (defense.values.defensive_tds ?? 0) + numeric(row, "def_tds");
    defense.values.blocked_kicks = (defense.values.blocked_kicks ?? 0) + numeric(row, "def_punt_blocks") + numeric(row, "def_pat_blocks") + numeric(row, "def_fg_blocks");
    defense.values.safeties = (defense.values.safeties ?? 0) + numeric(row, "def_safeties");
    defense.values.defensive_two_point_returns = (defense.values.defensive_two_point_returns ?? 0) + numeric(row, "def_2pt");
    defense.values.return_tds = (defense.values.return_tds ?? 0) + numeric(row, "punt_return_tds") + numeric(row, "kickoff_return_tds");
    defense.values.return_yards = (defense.values.return_yards ?? 0) + numeric(row, "punt_return_yards") + numeric(row, "kickoff_return_yards");
    defenses.set(defenseKey, defense);
  }
  for (const defense of defenses.values()) {
    const gameKey = `${defense.season}:${defense.gameId}`;
    const opponent = [...(teamsByGame.get(gameKey) ?? [])].find((team) => team !== defense.team);
    if (!opponent) continue;
    const yardsAllowed = offenseYardsByGameTeam.get(`${gameKey}:${opponent}`);
    if (yardsAllowed !== undefined) defense.values.yards_allowed = yardsAllowed;
  }
  return [...output, ...defenses.values()];
}

function averageMetrics(rows: StatRow[]): Record<string, number> {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.values)) {
      totals.set(key, (totals.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const output: Record<string, number> = {};
  for (const [key, total] of totals) {
    const divisor = RATE_METRICS.has(key) ? (counts.get(key) ?? rows.length) : rows.length;
    if (divisor > 0) output[key] = Number((total / divisor).toFixed(3));
  }
  return output;
}

type TeamGameProduction = {
  passAttempts: number;
  rushAttempts: number;
  passingYards: number;
  sackYards: number;
  rushingYards: number;
  receivingTouchdowns: number;
  rushingTouchdowns: number;
  returnTouchdowns: number;
  defensiveTouchdowns: number;
  fieldGoals: number;
  extraPoints: number;
  twoPointConversions: number;
  safeties: number;
  defensiveTwoPointReturns: number;
  interceptionsThrown: number;
  fumblesLost: number;
};

function emptyTeamGameProduction(): TeamGameProduction {
  return {
    passAttempts: 0,
    rushAttempts: 0,
    passingYards: 0,
    sackYards: 0,
    rushingYards: 0,
    receivingTouchdowns: 0,
    rushingTouchdowns: 0,
    returnTouchdowns: 0,
    defensiveTouchdowns: 0,
    fieldGoals: 0,
    extraPoints: 0,
    twoPointConversions: 0,
    safeties: 0,
    defensiveTwoPointReturns: 0,
    interceptionsThrown: 0,
    fumblesLost: 0,
  };
}

function buildTeamUsage(rows: StatRow[], teamProe?: Map<string, number>): z.infer<typeof teamUsageSchema>[] {
  const byTeam = new Map<string, Map<string, TeamGameProduction>>();
  for (const row of rows) {
    const teamGames = byTeam.get(row.team) ?? new Map<string, TeamGameProduction>();
    const game = teamGames.get(row.gameId) ?? emptyTeamGameProduction();
    if (row.position === "QB") {
      game.passAttempts += row.values.pass_attempts ?? 0;
      game.passingYards += row.values.passing_yards ?? 0;
      game.sackYards += row.values.sack_yards ?? 0;
      game.interceptionsThrown += row.values.interceptions ?? 0;
    }
    if ((["QB", "RB", "WR", "TE"] as string[]).includes(row.position)) {
      game.rushAttempts += row.values.carries ?? 0;
      game.rushingYards += row.values.rushing_yards ?? 0;
      game.receivingTouchdowns += row.values.receiving_tds ?? 0;
      game.rushingTouchdowns += row.values.rushing_tds ?? 0;
      game.twoPointConversions += (row.values.rushing_2pt_conversions ?? 0) + (row.values.receiving_2pt_conversions ?? 0);
      game.fumblesLost += row.values.fumbles_lost ?? 0;
    }
    if (row.position !== "DEF") {
      game.returnTouchdowns += (row.values.punt_return_tds ?? 0) + (row.values.kickoff_return_tds ?? 0);
    }
    if (row.position === "K") {
      game.fieldGoals += row.values.fg_made ?? 0;
      game.extraPoints += row.values.pat_made ?? 0;
    }
    if (row.position === "DEF") {
      game.defensiveTouchdowns += row.values.defensive_tds ?? 0;
      game.safeties += row.values.safeties ?? 0;
      game.defensiveTwoPointReturns += row.values.defensive_two_point_returns ?? 0;
    }
    teamGames.set(row.gameId, game);
    byTeam.set(row.team, teamGames);
  }
  return [...byTeam.entries()].flatMap(([team, games]) => {
    if (games.size === 0) return [];
    const totals = emptyTeamGameProduction();
    for (const game of games.values()) {
      for (const key of Object.keys(totals) as Array<keyof TeamGameProduction>) {
        totals[key] += game[key];
      }
    }
    const plays = totals.passAttempts + totals.rushAttempts;
    if (plays <= 0) return [];
    const passingYards = Math.max(0, Math.round(totals.passingYards - totals.sackYards));
    const rushingYards = Math.round(totals.rushingYards);
    const offensiveTouchdowns = Math.round(totals.receivingTouchdowns + totals.rushingTouchdowns);
    const pointsScored = Math.round(
      (offensiveTouchdowns + totals.returnTouchdowns + totals.defensiveTouchdowns) * 6
      + totals.fieldGoals * 3
      + totals.extraPoints
      + (totals.twoPointConversions + totals.safeties + totals.defensiveTwoPointReturns) * 2,
    );
    return [{
      team,
      games: games.size,
      pointsScored,
      totalYards: passingYards + rushingYards,
      passingYards,
      rushingYards,
      offensiveTouchdowns,
      turnovers: Math.round(totals.interceptionsThrown + totals.fumblesLost),
      playsPerGame: Number((plays / games.size).toFixed(1)),
      passPct: Number(((totals.passAttempts / plays) * 100).toFixed(1)),
      runPct: Number(((totals.rushAttempts / plays) * 100).toFixed(1)),
      ...(teamProe?.has(team) ? { proe: teamProe.get(team) } : {}),
    }];
  }).sort((a, b) => a.team.localeCompare(b.team));
}

function applyChartExtrasToRows(rows: StatRow[], extras: ChartExtrasSnapshot | null): void {
  enrichOpportunityMetrics(rows as ChartStatRow[]);
  if (!extras) return;
  applySnapSharesToRows(rows as ChartStatRow[], extras.snaps);
  for (const row of rows) {
    if (row.position === "K" || row.position === "DEF") continue;
    const rz = extras.players[row.id];
    if (!rz) continue;
    if (typeof rz.rzTargetShare === "number") row.values.rz_target_share = rz.rzTargetShare;
    if (typeof rz.rzCarryShare === "number") row.values.rz_carry_share = rz.rzCarryShare;
  }
}

export function buildAnalytics(
  previousCsv: string,
  currentCsv: string,
  season: number,
  extras: ChartExtrasSnapshot | null = null,
  insights: PlayerInsightsSnapshot | null = null,
): { throughWeek: number | null; entities: AnalyticsEntity[]; teamUsage: z.infer<typeof teamUsageSchema>[] } {
  const allRows = [...parseAnalyticsRows(previousCsv), ...parseAnalyticsRows(currentCsv)];
  applyChartExtrasToRows(allRows, extras);
  const currentRows = allRows.filter((row) => row.season === season);
  const activeKeys = new Set(currentRows.map((row) => `${row.position}:${row.id}`));
  const byKey = new Map<string, StatRow[]>();
  for (const row of allRows) {
    const key = `${row.position}:${row.id}`;
    if (!activeKeys.has(key)) continue;
    const group = byKey.get(key) ?? [];
    group.push(row);
    byKey.set(key, group);
  }
  const weeklySnaps = weeklySnapsByPlayerId(currentRows as ChartStatRow[], season);
  const entities: AnalyticsEntity[] = [];
  for (const [key, rowsForEntity] of byKey) {
    const ordered = rowsForEntity.slice().sort((a, b) => b.season - a.season || b.week - a.week);
    const latest = ordered[0];
    if (!latest) continue;
    const seasonRows = ordered.filter((row) => row.season === season);
    const rollingRows = ordered.slice(0, 17);
    if (seasonRows.length === 0) continue;
    const seasonMetrics = averageMetrics(seasonRows);
    const rollingMetrics = averageMetrics(rollingRows);
    // Red-zone shares are season aggregates from pbp; keep them on both windows.
    const rz = extras?.players[latest.id];
    if (rz) {
      if (typeof rz.rzTargetShare === "number") {
        seasonMetrics.rz_target_share = rz.rzTargetShare;
        rollingMetrics.rz_target_share = rz.rzTargetShare;
      }
      if (typeof rz.rzCarryShare === "number") {
        seasonMetrics.rz_carry_share = rz.rzCarryShare;
        rollingMetrics.rz_carry_share = rz.rzCarryShare;
      }
    }
    // Expected points and Next Gen Stats cover this season only, so they stay off
    // the rolling-17 window, which reaches back into last season.
    const opportunity = insights?.opportunity[latest.id];
    if (opportunity && opportunity.games > 0) {
      seasonMetrics.expected_points = opportunity.expected / opportunity.games;
      seasonMetrics.points_over_expected = (opportunity.actual - opportunity.expected) / opportunity.games;
    }
    const ngs = latest.position === "K" || latest.position === "DEF" ? undefined : insights?.ngs[latest.id];
    if (ngs) Object.assign(seasonMetrics, ngs);
    // `latest.id` is nflverse GSIS for skill/K; Sleeper roster ids need the mapped playerId.
    const playerId = analyticsSleeperPlayerId(latest.position, latest.id, latest.team, insights?.sleeperByGsis);
    entities.push({
      id: key,
      name: latest.name,
      team: latest.team,
      position: latest.position,
      playerId,
      seasonGames: seasonRows.length,
      rollingGames: rollingRows.length,
      season: seasonMetrics,
      rolling17: rollingMetrics,
      weeklySnaps: weeklySnaps.get(latest.id) ?? [],
      weeklyExpected: (opportunity?.weeks ?? []).map(([week, expected, actual]) => ({ week, expected, actual })),
    });
  }
  entities.sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  const throughWeek = currentRows.reduce<number | null>((maximum, row) => maximum === null ? row.week : Math.max(maximum, row.week), null);
  const proeByTeam = new Map<string, number>();
  if (extras) {
    for (const [team, value] of Object.entries(extras.teams)) {
      proeByTeam.set(team, value.proe);
    }
  }
  return { throughWeek, entities, teamUsage: buildTeamUsage(currentRows, proeByTeam) };
}

// ---------------------------------------------------------------------------
// Precomputed analytics (stored in the player-insights snapshot)
// ---------------------------------------------------------------------------

/** What the insights refresh stores: buildAnalytics output plus when it ran. */
export type AnalyticsPrecompute = {
  computedAt: string;
  throughWeek: number | null;
  entities: AnalyticsEntity[];
  teamUsage: TeamUsageRow[];
};

/**
 * The dashboard's analytics section from a stored precompute, or null
 * when the snapshot carries none yet (the build then reports advanced
 * stats unavailable, the same degraded section a failed stats download
 * produced when builds parsed the files themselves). `asOf` is the
 * precompute time: that is when the underlying stats were read.
 */
export function analyticsSectionFromPrecompute(
  precompute: AnalyticsPrecompute | null | undefined,
  teamRecords: z.infer<typeof nflTeamRecordSchema>[],
): z.infer<typeof analyticsSchema> | null {
  if (!precompute) return null;
  return {
    asOf: precompute.computedAt,
    throughWeek: precompute.throughWeek,
    sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL,
    entities: precompute.entities,
    teamUsage: precompute.teamUsage,
    teamRecords,
  };
}
