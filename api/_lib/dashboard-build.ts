import { and, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";
import {
  analyticsEntitySchema,
  analyticsSchema,
  dashboardResponse,
  defenseSchema,
  nflTeamRecordSchema,
  parseUsableDashboard,
  powerRankingSchema,
  rankingSchema,
  rosterAssignmentSchema,
  rosterPlayerSchema,
  seasonLongRankingSchema,
  strengthOfScheduleEntrySchema,
  suggestionSchema,
  teamUsageSchema,
  tradeTeamSchema,
  tradeValuationSchema,
  type Dashboard,
} from "./dashboard-schemas.js";
import { CACHE_KEY } from "./dashboard-schemas.js";
import { readOwnerSleeperUserId } from "./auth.js";
import { readNflState, readUserLeagues } from "./user-leagues.js";
import {
  DRAFT_MARKET_CACHE_KEY,
  DYNASTICAL_CUCKS_LEAGUE_ID,
  FANTASY_CALC_VALUES_URL,
  REFRESH_TIMEOUT_MS,
  SLEEPER_BASE,
  SOURCE_TIMEOUT_MS,
  SLEEPER_PROJECTIONS_BASE,
  canonicalTeam,
  fetchJson,
  fetchText,
  isDynasticalPpfdLeague,
  isUnavailableForCurrentWeek,
  normalizePosition,
  normalizedPlayerName,
  scoreProjectedPlayerStats,
  seasonLongFormatForLeague,
  settingValue,
  weeklyAvailabilityStatus,
  withDeadline,
  type FantasyCalcRow,
  type SeasonLongFormat,
  type SleeperLeague,
  type SleeperPlayer,
  type SleeperRoster,
} from "./sleeper.js";

/**
 * Per-user dashboard builder (Phase 2).
 *
 * Faithful port of `buildDashboard` from the original Hatch artifact
 * (`app/server/src/actions.ts`), adapted for the Vercel/Supabase runtime:
 *
 * - The Sleeper account is a parameter (`sleeperUserId`). Scheduled jobs
 *   pass `OWNER_SLEEPER_USER_ID`; interactive routes pass the signed-in user.
 * - `ctx.db` reads/writes go through the shared Drizzle client (`./db.js`).
 * - `ctx.viewer` owner checks are gone: the connected user is always the
 *   owner of their own build.
 * - The `ctx.tool.web_search` kickoff-time fallback is dropped. Kickoff
 *   times come from the ESPN scoreboard, and the Sleeper schedule feed
 *   backfills any team ESPN missed.
 * - Prediction-market game lines (Polymarket/Kalshi) stay disabled, as in
 *   the rest of this codebase since 2026-09-29; defenses therefore carry
 *   `opponentProjectedPoints: null` in per-user builds.
 *
 * Built dashboards are cached per user in `source_cache` under
 * `dashboard:user:<sleeper_user_id>` for USER_DASHBOARD_CACHE_MS.
 */

export const USER_DASHBOARD_CACHE_MS = 10 * 60 * 1000; // 10 minutes
export const BUILD_DEADLINE_MS = 55_000; // stay inside the 60s function budget

const NFLVERSE_PLAYER_STATS_2026_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv";
const NFLVERSE_PLAYER_STATS_2025_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";
const MIN_VEGAS_PLAYER_COVERAGE = 200;
const MIN_FIRST_DOWN_PLAYER_COVERAGE = 150;
const STRENGTH_OF_SCHEDULE_CACHE_PREFIX = "strength-of-schedule-v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Ranking = z.infer<typeof rankingSchema>;
type RosterPlayer = z.infer<typeof rosterPlayerSchema>;
type SeasonLongRanking = z.infer<typeof seasonLongRankingSchema>;
type AnalyticsEntity = z.infer<typeof analyticsEntitySchema>;
type TradeValuation = z.infer<typeof tradeValuationSchema>;

type SleeperMatchup = {
  roster_id: number;
  matchup_id?: number | null;
  points?: number;
  players_points?: Record<string, number>;
};

type SleeperTradedPick = {
  season?: string;
  round?: number;
  roster_id?: number;
  owner_id?: number;
  previous_owner_id?: number;
};

type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};

type SleeperProjection = {
  player_id?: string;
  team?: string;
  player?: { position?: string };
  stats?: Record<string, number> & { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number };
};

type SleeperGame = {
  status?: string;
  week?: number;
  home?: string;
  away?: string;
  date?: string;
};

type EspnScoreboard = {
  events?: Array<{
    date?: string;
    competitions?: Array<{
      competitors?: Array<{
        team?: { abbreviation?: string };
        records?: Array<{ type?: string; summary?: string }>;
      }>;
    }>;
  }>;
};

type StatRow = {
  id: string;
  name: string;
  team: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  season: number;
  week: number;
  gameId: string;
  values: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Schemas for payloads that only this builder reads
// ---------------------------------------------------------------------------

const vegasLineSchema = z.object({
  source: z.enum(["Polymarket", "Kalshi"]),
  matchupCode: z.string(),
  marketType: z.enum(["total", "spread"]),
  team: z.string().nullable(),
  line: z.number(),
  probability: z.number().nullable(),
});

const vegasProjectionLeagueSchema = z.object({
  league_id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
});

const vegasPlayerProjectionSchema = z.object({
  player: z.string().min(1).max(160),
  team: z.string().min(1).max(12),
  position: z.string().min(1).max(12),
  opponent: z.string().max(12).nullable(),
  expected_stats: z.record(z.string(), z.number()),
  td_probability: z.union([z.number(), z.record(z.string(), z.number())]).nullable(),
  coverage: z.object({
    stats: z.union([z.number(), z.array(z.string()), z.record(z.string(), z.number())]),
    provider_count: z.number().int().nonnegative(),
    book_count: z.number().int().nonnegative(),
  }),
  leagues: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.record(z.string(), z.number())),
});

const vegasProjectionPayloadSchema = z.object({
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
  built_at: z.string().datetime(),
  source: z.string().min(1).max(160),
  leagues: z.array(vegasProjectionLeagueSchema).max(32),
  projections: z.array(vegasPlayerProjectionSchema).max(2500),
});

type VegasProjectionPayload = z.infer<typeof vegasProjectionPayloadSchema>;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

// ---------------------------------------------------------------------------
// Analytics (nflverse CSV → entities / team usage)
// ---------------------------------------------------------------------------

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
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
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const RATE_METRICS = new Set(["completion_pct", "cpoe", "epa_per_play", "target_share", "air_yards_share", "wopr", "racr", "fg_pct"]);

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

function csvRecords(source: string): Record<string, string>[] {
  const rows = parseCsv(source);
  const headers = rows[0] ?? [];
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
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

function parseAnalyticsRows(csv: string): StatRow[] {
  const rows = csvRecords(csv).filter((row) => row.season_type === "REG");
  const output: StatRow[] = [];
  const defenses = new Map<string, StatRow>();
  const offenseYardsByGameTeam = new Map<string, number>();
  const teamsByGame = new Map<string, Set<string>>();
  for (const row of rows) {
    const season = Number(row.season);
    const week = Number(row.week);
    const gameId = row.game_id ?? "";
    const team = canonicalTeam(row.team ?? row.recent_team ?? "");
    if (!Number.isFinite(season) || !Number.isFinite(week) || !gameId || !team) continue;
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

function buildTeamUsage(rows: StatRow[]): z.infer<typeof teamUsageSchema>[] {
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
    }];
  }).sort((a, b) => a.team.localeCompare(b.team));
}

function buildAnalytics(previousCsv: string, currentCsv: string, season: number): { throughWeek: number | null; entities: AnalyticsEntity[]; teamUsage: z.infer<typeof teamUsageSchema>[] } {
  const allRows = [...parseAnalyticsRows(previousCsv), ...parseAnalyticsRows(currentCsv)];
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
  const entities: AnalyticsEntity[] = [];
  for (const [key, rowsForEntity] of byKey) {
    const ordered = rowsForEntity.slice().sort((a, b) => b.season - a.season || b.week - a.week);
    const latest = ordered[0];
    if (!latest) continue;
    const seasonRows = ordered.filter((row) => row.season === season);
    const rollingRows = ordered.slice(0, 17);
    if (seasonRows.length === 0) continue;
    entities.push({
      id: key,
      name: latest.name,
      team: latest.team,
      position: latest.position,
      seasonGames: seasonRows.length,
      rollingGames: rollingRows.length,
      season: averageMetrics(seasonRows),
      rolling17: averageMetrics(rollingRows),
    });
  }
  entities.sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  const throughWeek = currentRows.reduce<number | null>((maximum, row) => maximum === null ? row.week : Math.max(maximum, row.week), null);
  return { throughWeek, entities, teamUsage: buildTeamUsage(currentRows) };
}

function nflTeamRecordsFromScoreboard(scoreboard: EspnScoreboard): z.infer<typeof nflTeamRecordSchema>[] {
  const records = new Map<string, z.infer<typeof nflTeamRecordSchema>>();
  for (const event of scoreboard.events ?? []) {
    for (const competition of event.competitions ?? []) {
      for (const competitor of competition.competitors ?? []) {
        const abbreviation = competitor.team?.abbreviation;
        if (!abbreviation) continue;
        const summary = competitor.records?.find((record) => record.type === "total")?.summary
          ?? competitor.records?.[0]?.summary;
        if (!summary) continue;
        const parts = summary.split("-").map(Number);
        const wins = parts[0];
        const losses = parts[1];
        const ties = parts[2] ?? 0;
        if (wins === undefined || losses === undefined || !Number.isInteger(wins) || !Number.isInteger(losses) || !Number.isInteger(ties)) continue;
        records.set(canonicalTeam(abbreviation), { team: canonicalTeam(abbreviation), wins, losses, ties });
      }
    }
  }
  return [...records.values()].sort((a, b) => a.team.localeCompare(b.team));
}

// ---------------------------------------------------------------------------
// Lineup optimizer + suggestions
// ---------------------------------------------------------------------------

function isEligible(position: string, slot: string): boolean {
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  return false;
}

const FLEX_LINEUP_SLOTS = new Set(["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"]);

function relabelOptimizedLineup(players: RosterPlayer[], slots: string[]): RosterPlayer[] {
  if (players.length !== slots.length || players.length === 0) return players;
  type LabelState = { flexTotal: number; flexValues: number[]; exactCount: number; assignments: number[] };
  const compareFlexValues = (left: number[], right: number[]) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return left.length - right.length;
  };
  let states = new Map<number, LabelState>([[0, { flexTotal: 0, flexValues: [], exactCount: 0, assignments: [] }]]);

  slots.forEach((slot) => {
    const next = new Map<number, LabelState>();
    for (const [mask, state] of states) {
      players.forEach((player, playerIndex) => {
        const bit = 2 ** playerIndex;
        if ((mask & bit) !== 0 || !isEligible(player.position, slot)) return;
        const flexValue = player.projection ?? -1000;
        const isFlexSlot = FLEX_LINEUP_SLOTS.has(slot);
        const candidate: LabelState = {
          flexTotal: state.flexTotal + (isFlexSlot ? flexValue : 0),
          flexValues: isFlexSlot ? [...state.flexValues, flexValue] : state.flexValues,
          exactCount: state.exactCount + (slot === player.position ? 1 : 0),
          assignments: [...state.assignments, playerIndex],
        };
        const nextMask = mask | bit;
        const existing = next.get(nextMask);
        const flexOrder = existing ? compareFlexValues(candidate.flexValues, existing.flexValues) : -1;
        if (
          !existing
          || candidate.flexTotal < existing.flexTotal
          || (candidate.flexTotal === existing.flexTotal && flexOrder < 0)
          || (candidate.flexTotal === existing.flexTotal && flexOrder === 0 && candidate.exactCount > existing.exactCount)
        ) {
          next.set(nextMask, candidate);
        }
      });
    }
    states = next;
  });

  const fullMask = 2 ** players.length - 1;
  const best = states.get(fullMask);
  if (!best) return players;
  const assignments = best.assignments.map((playerIndex) => players[playerIndex]).filter((player): player is RosterPlayer => Boolean(player));
  return assignments.map((player, index) => ({ ...player, isStarter: true, lineupSlot: slots[index] ?? player.position }));
}

function effectiveOptimizerValue(player: RosterPlayer): number {
  return player.gamePhase === "final"
    ? (player.actual ?? player.projection ?? -1000)
    : (player.projection ?? -1000);
}

function optimizeWeeklyPowerLineup(startersInput: RosterPlayer[], benchInput: RosterPlayer[]): RosterPlayer[] {
  // Keep this in lockstep with the Matchup view's optimizer. In particular,
  // derive slots from the submitted lineup (so an empty Sleeper slot stays
  // empty), optimize on the same displayed values (final actuals once games
  // are final), and prefer the submitted starter when two choices are equal.
  const slots = startersInput.map((player) => player.lineupSlot ?? player.position);
  const roster = [...startersInput, ...benchInput];
  const currentStarterIds = new Set(startersInput.map((player) => player.playerId));
  type State = { score: number; currentCount: number; assignments: Array<RosterPlayer | undefined> };
  let states = new Map<number, State>([[0, { score: 0, currentCount: 0, assignments: Array.from({ length: slots.length }) }]]);

  for (const player of roster) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      slots.forEach((slot, slotIndex) => {
        const bit = 2 ** slotIndex;
        if ((mask & bit) !== 0 || !isEligible(player.position, slot)) return;
        const nextMask = mask | bit;
        const contender: State = {
          score: state.score + effectiveOptimizerValue(player),
          currentCount: state.currentCount + (currentStarterIds.has(player.playerId) ? 1 : 0),
          assignments: state.assignments.map((assigned, index) => index === slotIndex ? player : assigned),
        };
        const existing = next.get(nextMask);
        if (!existing || contender.score > existing.score || (contender.score === existing.score && contender.currentCount > existing.currentCount)) {
          next.set(nextMask, contender);
        }
      });
    }
    states = next;
  }

  const countBits = (value: number): number => value.toString(2).replaceAll("0", "").length;
  let bestMask = 0;
  let bestState = states.get(0) ?? { score: 0, currentCount: 0, assignments: [] };
  for (const [mask, state] of states) {
    const filled = countBits(mask);
    const bestFilled = countBits(bestMask);
    if (filled > bestFilled || (filled === bestFilled && (state.score > bestState.score || (state.score === bestState.score && state.currentCount > bestState.currentCount)))) {
      bestMask = mask;
      bestState = state;
    }
  }

  const optimized = bestState.assignments.flatMap((player) => player ? [player] : []);
  const filledSlots = bestState.assignments.flatMap((player, index) => player ? [slots[index] ?? player.position] : []);
  return relabelOptimizedLineup(optimized, filledSlots);
}

function makeSuggestion(starters: RosterPlayer[], bench: RosterPlayer[]): z.infer<typeof suggestionSchema> {
  let best: z.infer<typeof suggestionSchema> = null;
  for (const reserve of bench) {
    if (reserve.projection === null && (reserve.gamePhase !== "final" || reserve.actual === null)) continue;
    for (const starter of starters) {
      if (
        !starter.lineupSlot
        || (starter.projection === null && (starter.gamePhase !== "final" || starter.actual === null))
        || !isEligible(reserve.position, starter.lineupSlot)
      ) continue;
      const delta = effectiveOptimizerValue(reserve) - effectiveOptimizerValue(starter);
      if (delta >= 0.5 && (!best || delta > best.delta)) {
        best = { inPlayer: reserve.name, outPlayer: starter.name, delta, slot: starter.lineupSlot };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// FantasyCalc season-long rankings
// ---------------------------------------------------------------------------

const FANTASY_CALC_PRESETS: Array<{ format: SeasonLongFormat; url: string }> = [
  {
    format: { key: "redraft-1qb-12t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "redraft-1qb-10t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Redraft · 10-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=10&ppr=0.5`,
  },
  {
    format: { key: "redraft-1qb-12t-1ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, label: "Redraft · 12-team · 1QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=1`,
  },
  {
    format: { key: "redraft-2qb-14t-1ppr", isDynasty: false, numQbs: 2, numTeams: 14, ppr: 1, label: "Redraft · 14-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=14&ppr=1`,
  },
  {
    format: { key: "redraft-2qb-12t-0.5ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · Superflex / 2QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "redraft-2qb-12t-1ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 1, label: "Redraft · 12-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=1`,
  },
  {
    format: { key: "dynasty-1qb-10t-0.5ppr", isDynasty: true, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Dynasty · 10-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=10&ppr=0.5`,
  },
  {
    format: { key: "dynasty-1qb-12t-1ppr", isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · 1QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=12&ppr=1`,
  },
  {
    format: { key: "dynasty-2qb-14t-1ppr", isDynasty: true, numQbs: 2, numTeams: 14, ppr: 1, label: "Dynasty · 14-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=14&ppr=1`,
  },
  {
    format: { key: "dynasty-2qb-12t-0.5ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Dynasty · 12-team · Superflex / 2QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "dynasty-2qb-12t-1ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=1`,
  },
];

// ---------------------------------------------------------------------------
// FantasyCalc season-long rankings (with a daily cache in `source_cache`)
// ---------------------------------------------------------------------------

/**
 * Daily cache of raw FantasyCalc API rows, one entry per preset key.
 * Refreshed by the `refresh-fantasycalc` cron job; dashboard builds read
 * from it when fresh so 12 external API calls collapse to one DB read.
 */
const FANTASYCALC_CACHE_KEY = "fantasycalc:presets";
const FANTASYCALC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function readFantasyCalcCache(): Promise<{
  presets: Record<string, FantasyCalcRow[]>;
  fetchedAt: Date;
} | null> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, FANTASYCALC_CACHE_KEY))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      presets?: Record<string, FantasyCalcRow[]>;
    };
    if (!payload.presets || typeof payload.presets !== "object") return null;
    return { presets: payload.presets, fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

function mapPresetRows(
  rows: FantasyCalcRow[],
  format: (typeof FANTASY_CALC_PRESETS)[number]["format"],
  sleeperPlayers: Record<string, SleeperPlayer>,
): SeasonLongRanking[] {
  const positions = new Set(format.isDynasty ? ["QB", "RB", "WR", "TE", "PICK"] : ["QB", "RB", "WR", "TE"]);
  return rows.flatMap((row) => {
    const playerId = row.player?.sleeperId;
    const position = row.player?.position;
    if (!playerId || !position || !positions.has(position) || typeof row.player?.name !== "string" || typeof row.value !== "number" || typeof row.overallRank !== "number" || typeof row.positionRank !== "number") return [];
    return [{
      formatKey: format.key,
      playerId,
      name: row.player.name,
      team: row.player.maybeTeam ?? null,
      position: position as "QB" | "RB" | "WR" | "TE" | "PICK",
      overallRank: row.overallRank,
      positionRank: row.positionRank,
      value: Math.round(row.value),
      trend30Day: typeof row.trend30Day === "number" ? Math.round(row.trend30Day) : null,
      isRookie: position !== "PICK" && sleeperPlayers[playerId]?.years_exp === 0,
    }];
  });
}

async function loadPreset(
  { format, url }: (typeof FANTASY_CALC_PRESETS)[number],
  sleeperPlayers: Record<string, SleeperPlayer>,
): Promise<SeasonLongRanking[]> {
  const rows = await fetchJson<FantasyCalcRow[]>(url);
  return mapPresetRows(rows, format, sleeperPlayers);
}

/**
 * Fetch every FantasyCalc preset raw (with one retry) and store the rows in
 * `source_cache` for dashboard builds to consume. Called by the cron job.
 */
export async function refreshFantasyCalcCache(): Promise<{
  presets: number;
  rows: number;
  failed: number;
  asOf: string;
}> {
  const presets: Record<string, FantasyCalcRow[]> = {};
  let failed = 0;
  // Leave room for one timed-out fetch before the 60s Hobby cap.
  // Stopping here skips the cache write, so the previous snapshot stays.
  const presetBudgetMs = SOURCE_TIMEOUT_MS + 5_000;
  const deadlineAt = Date.now() + REFRESH_TIMEOUT_MS;
  for (const preset of FANTASY_CALC_PRESETS) {
    if (deadlineAt - Date.now() < presetBudgetMs) {
      throw new Error("FantasyCalc refresh stopped early to stay within the 60s hosting limit.");
    }
    let rows: FantasyCalcRow[] | undefined;
    for (let attempt = 0; attempt < 2 && !rows; attempt += 1) {
      try {
        rows = await fetchJson<FantasyCalcRow[]>(preset.url);
      } catch {
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    if (rows) presets[preset.format.key] = rows;
    else failed += 1;
  }
  const rowCount = Object.values(presets).reduce((total, rows) => total + rows.length, 0);
  const fetchedAt = new Date();
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: FANTASYCALC_CACHE_KEY,
      payload: JSON.stringify({ presets }),
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: JSON.stringify({ presets }), fetchedAt },
    });
  return { presets: Object.keys(presets).length, rows: rowCount, failed, asOf: fetchedAt.toISOString() };
}

async function fetchFantasyCalcRankings(sleeperPlayers: Record<string, SleeperPlayer>): Promise<{ rows: SeasonLongRanking[]; failedPresets: number }> {
  // Prefer the daily cache (refreshed by cron) over 12 live API calls.
  const cached = await readFantasyCalcCache();
  if (cached && Date.now() - cached.fetchedAt.getTime() < FANTASYCALC_CACHE_TTL_MS) {
    const rows = FANTASY_CALC_PRESETS.flatMap((preset) => {
      const raw = cached.presets[preset.format.key];
      return raw ? mapPresetRows(raw, preset.format, sleeperPlayers) : [];
    });
    if (rows.length > 0) return { rows, failedPresets: 0 };
    // Cache parsed but yielded nothing usable; fall through to live fetch.
  }

  const results = await Promise.allSettled(FANTASY_CALC_PRESETS.map((preset) => loadPreset(preset, sleeperPlayers)));
  const rowsByPreset: Array<SeasonLongRanking[] | undefined> = results.map((result) => result.status === "fulfilled" ? result.value : undefined);
  const failedPresetIndexes = results.flatMap((result, index) => result.status === "rejected" ? [index] : []);
  let failedPresets = 0;

  for (const index of failedPresetIndexes) {
    const preset = FANTASY_CALC_PRESETS[index];
    if (!preset) {
      failedPresets += 1;
      continue;
    }

    let recoveredRows: SeasonLongRanking[] | undefined;
    for (let retry = 0; retry < 2; retry += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      try {
        recoveredRows = await loadPreset(preset, sleeperPlayers);
        break;
      } catch {
        // Retry this preset once more before marking it unavailable.
      }
    }

    if (recoveredRows) rowsByPreset[index] = recoveredRows;
    else failedPresets += 1;
  }

  return {
    rows: rowsByPreset.flatMap((rows) => rows ?? []),
    failedPresets,
  };
}

// ---------------------------------------------------------------------------
// Projection scoring / merging
// ---------------------------------------------------------------------------

function normalizeGamePhase(status: string | undefined): "pregame" | "live" | "final" | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (["complete", "final", "post_game"].includes(normalized)) return "final";
  if (["pre_game", "pregame", "scheduled"].includes(normalized)) return "pregame";
  return "live";
}

function sumActualsAndRemainingProjections(players: RosterPlayer[]): number | null {
  const values = players.flatMap((player) => {
    const value = player.gamePhase === "final" ? player.actual : player.projection;
    return value === null ? [] : [value];
  });
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

function adaptVegasStatsForScorer(
  position: Ranking["position"],
  stats: Record<string, number>,
  tdProbability: number | Record<string, number> | null,
): Record<string, number> {
  const sourcesBySleeperKey: Record<string, readonly string[]> = {
    pass_yd: ["pass_yd", "pass_yards"],
    pass_td: ["pass_td", "pass_tds", "passing_tds", "passing_touchdowns"],
    pass_int: ["pass_int", "pass_interceptions", "interceptions"],
    pass_cmp: ["pass_cmp", "pass_completions", "completions"],
    pass_att: ["pass_att", "pass_attempts"],
    pass_inc: ["pass_inc", "pass_incompletions", "incompletions"],
    pass_sack: ["pass_sack", "pass_sacks", "sacks_taken"],
    pass_fd: ["pass_fd", "pass_first_downs"],
    pass_2pt: ["pass_2pt", "pass_two_point_conversions"],
    rush_yd: ["rush_yd", "rush_yards", "rushing_yards"],
    rush_td: ["rush_td", "rush_tds", "rushing_tds", "rushing_touchdowns"],
    rush_att: ["rush_att", "rush_attempts", "carries"],
    rush_fd: ["rush_fd", "rush_first_downs"],
    rush_2pt: ["rush_2pt", "rush_two_point_conversions"],
    rec: ["rec", "receptions"],
    rec_yd: ["rec_yd", "rec_yards", "receiving_yards"],
    rec_td: ["rec_td", "rec_tds", "receiving_tds", "receiving_touchdowns"],
    rec_fd: ["rec_fd", "rec_first_downs", "receiving_first_downs"],
    rec_2pt: ["rec_2pt", "rec_two_point_conversions", "receiving_two_point_conversions"],
    fum: ["fum", "fumbles"],
    fum_lost: ["fum_lost", "fumbles_lost"],
    pr_yd: ["pr_yd", "punt_return_yards"],
    kr_yd: ["kr_yd", "kick_return_yards"],
    pr_td: ["pr_td", "punt_return_tds"],
    kr_td: ["kr_td", "kick_return_tds"],
    fgm: ["fgm", "field_goals_made"],
    fgmiss: ["fgmiss", "field_goals_missed"],
    fgm_0_19: ["fgm_0_19"],
    fgm_20_29: ["fgm_20_29"],
    fgm_30_39: ["fgm_30_39"],
    fgm_40_49: ["fgm_40_49"],
    fgm_50_59: ["fgm_50_59"],
    fgm_60p: ["fgm_60p"],
    fgm_50p: ["fgm_50p"],
    xpm: ["xpm", "extra_points_made"],
    xpmiss: ["xpmiss", "extra_points_missed"],
  };
  const normalized: Record<string, number> = {};
  for (const [sleeperKey, sourceKeys] of Object.entries(sourcesBySleeperKey)) {
    const value = sourceKeys
      .map((sourceKey) => stats[sourceKey])
      .find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
    if (typeof value === "number") normalized[sleeperKey] = value;
  }

  const hasExplicitSkillTouchdown = typeof normalized.rush_td === "number" || typeof normalized.rec_td === "number";
  if (!hasExplicitSkillTouchdown) {
    const fallbackTouchdownProbability = typeof tdProbability === "number"
      ? tdProbability
      : tdProbability
        ? (tdProbability.anytime_td ?? tdProbability.anytime ?? tdProbability.touchdown ?? tdProbability.td ?? null)
        : null;
    if (typeof fallbackTouchdownProbability === "number" && Number.isFinite(fallbackTouchdownProbability)) {
      if (position === "WR" || position === "TE") normalized.rec_td = fallbackTouchdownProbability;
      else if (position === "QB" || position === "RB") normalized.rush_td = fallbackTouchdownProbability;
    }
  }
  return normalized;
}

function scoreSleeperPlayerProjection(position: Ranking["position"], stats: Record<string, number> | undefined, settings: Record<string, number> | undefined): number | null {
  if (!stats) return null;
  const projectionKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt", "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td", "fgm", "fgmiss", "fgm_0_19", "fgm_20_29",
    "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p", "fgm_50p", "xpm", "xpmiss",
  ];
  if (!projectionKeys.some((key) => typeof stats[key] === "number")) return null;
  return scoreProjectedPlayerStats(position, stats, settings);
}

// Canonical full-PPR scoring for the league-independent Vegas baseline shown in
// the player comparison tool. Deliberately excludes league quirks (yardage/TD
// bonuses, TE premium, the PPFD rec_fd proxy) so "Vegas projection" is a neutral
// number comparable across leagues and distinct from the league-scored projection.
const VEGAS_CANONICAL_PPR_SCORING: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

function mergeVegasPlayerProjections(
  leagueId: string,
  rankingField: "ppr" | "halfPpr",
  baseRows: Ranking[],
  snapshot: VegasProjectionPayload | null,
  useVegasPrimary: boolean,
  sleeperProjectionsByPlayerId: Map<string, SleeperProjection>,
  scoringSettings: Record<string, number> | undefined,
  defenseRankByTeam: Map<string, number>,
): Ranking[] {
  const feedByPlayer = new Map<string, VegasProjectionPayload["projections"][number]>();
  const feedByNamePosition = new Map<string, VegasProjectionPayload["projections"][number]>();
  for (const projection of snapshot?.projections ?? []) {
    const position = normalizePosition(projection.position);
    const exactKey = `${normalizedPlayerName(projection.player)}:${canonicalTeam(projection.team)}:${position}`;
    feedByPlayer.set(exactKey, projection);
    const namePositionKey = `${normalizedPlayerName(projection.player)}:${position}`;
    if (!feedByNamePosition.has(namePositionKey)) feedByNamePosition.set(namePositionKey, projection);
  }

  const merged = baseRows.flatMap((base): Ranking[] => {
    // Weekly availability overrides every numeric source. Consensus and Sleeper
    // feeds can lag official out/IR designations and otherwise leave a ruled-out
    // player with a non-zero projection.
    if (isUnavailableForCurrentWeek(base.injuryStatus)) {
      return [{
        ...base,
        leagueId,
        ppr: 0,
        halfPpr: 0,
        standard: 0,
        leagueProjection: 0,
        vegasProjection: null,
        sleeperProjection: null,
        projectionSource: "fallback",
        projectionComponents: null,
      }];
    }
    const sleeperStats = sleeperProjectionsByPlayerId.get(base.playerId)?.stats;
    const sleeperPoints = scoreSleeperPlayerProjection(base.position, sleeperStats, scoringSettings)
      ?? (rankingField === "ppr" ? sleeperStats?.pts_ppr : sleeperStats?.pts_half_ppr)
      ?? sleeperStats?.pts_ppr
      ?? sleeperStats?.pts_half_ppr
      ?? sleeperStats?.pts_std
      ?? null;
    const validSleeperPoints = typeof sleeperPoints === "number" && Number.isFinite(sleeperPoints) ? sleeperPoints : null;
    if (base.position === "K") {
      if (validSleeperPoints !== null) {
        return [{
          ...base,
          leagueId,
          ppr: rankingField === "ppr" ? validSleeperPoints : base.ppr,
          halfPpr: rankingField === "halfPpr" ? validSleeperPoints : base.halfPpr,
          leagueProjection: validSleeperPoints,
          vegasProjection: null,
          sleeperProjection: validSleeperPoints,
          projectionSource: "sleeper",
          projectionComponents: sleeperStats ?? null,
        }];
      }
      return [{
        ...base,
        leagueId,
        leagueProjection: null,
        vegasProjection: null,
        sleeperProjection: null,
        projectionSource: "fallback",
        projectionComponents: null,
      }];
    }

    const exactKey = `${normalizedPlayerName(base.name)}:${canonicalTeam(base.team)}:${base.position}`;
    const feed = feedByPlayer.get(exactKey) ?? feedByNamePosition.get(`${normalizedPlayerName(base.name)}:${base.position}`);
    const feedTeam = feed?.team ? canonicalTeam(feed.team) : null;
    const baseTeam = canonicalTeam(base.team ?? "");
    const teamCompatible = feedTeam !== null && feedTeam === baseTeam;
    // The consensus feed supplies projected football stats. Score those stats
    // here through this league's exact Sleeper scoring rules so weekly roster
    // utility never falls back to FantasyCalc market value or a generic PPR total.
    // A First Down fallback snapshot is the exception: it is points-only by
    // contract (its projected total is replicated across leagues and its stat
    // lines carry no TD split to rescore), so use its staged per-league total
    // verbatim and tag it with its real source.
    const isFirstDownSnapshot = snapshot?.source === "first_down";
    let leaguePoints: number | null = null;
    let vegasPoints: number | null = null;
    let projectionComponents: Record<string, number> | null = null;
    if (useVegasPrimary && feed && isFirstDownSnapshot) {
      const stagedPoints = feed.leagues[leagueId] ?? feed.expected_stats.projected_points;
      leaguePoints = typeof stagedPoints === "number" && Number.isFinite(stagedPoints) ? stagedPoints : null;
    } else if (useVegasPrimary && feed) {
      const scorerStats = adaptVegasStatsForScorer(base.position, feed.expected_stats, feed.td_probability);
      leaguePoints = scoreProjectedPlayerStats(base.position, scorerStats, scoringSettings, { recFdProxy: true });
      // League-independent Vegas baseline: same stats through canonical PPR so
      // the comparison tool's "Vegas projection" never duplicates the
      // league-scored number.
      const canonicalPoints = scoreProjectedPlayerStats(base.position, scorerStats, VEGAS_CANONICAL_PPR_SCORING);
      vegasPoints = Number.isFinite(canonicalPoints) ? canonicalPoints : null;
      projectionComponents = scorerStats;
    }
    if (typeof leaguePoints === "number" && Number.isFinite(leaguePoints)) {
      return [{
        ...base,
        leagueId,
        team: teamCompatible ? feedTeam : base.team,
        opponent: teamCompatible && feed?.opponent ? canonicalTeam(feed.opponent) : base.opponent,
        ppr: rankingField === "ppr" ? leaguePoints : base.ppr,
        halfPpr: rankingField === "halfPpr" ? leaguePoints : base.halfPpr,
        leagueProjection: leaguePoints,
        vegasProjection: vegasPoints,
        sleeperProjection: validSleeperPoints,
        projectionSource: isFirstDownSnapshot ? "first_down" : "vegas",
        projectionComponents,
      }];
    }

    // Keep the player visible with schedule context when the saved Vegas feed
    // does not contain a projection. Never revive a prior-week row.
    return [{
      ...base,
      leagueId,
      leagueProjection: null,
      vegasProjection: null,
      sleeperProjection: validSleeperPoints,
      projectionSource: "fallback",
      projectionComponents: null,
    }];
  });

  for (const position of ["QB", "RB", "WR", "TE", "K"] as const) {
    const group = merged
      .filter((row) => row.position === position)
      .sort((a, b) => {
        if (position === "K") {
          const aOpponentDefenseRank = a.opponent ? defenseRankByTeam.get(canonicalTeam(a.opponent)) : undefined;
          const bOpponentDefenseRank = b.opponent ? defenseRankByTeam.get(canonicalTeam(b.opponent)) : undefined;
          if (aOpponentDefenseRank !== bOpponentDefenseRank) {
            return (bOpponentDefenseRank ?? -1) - (aOpponentDefenseRank ?? -1);
          }
        }
        return (b.leagueProjection ?? -1) - (a.leagueProjection ?? -1) || a.name.localeCompare(b.name);
      });
    group.forEach((row, index) => {
      row.leagueRank = index + 1;
      if (rankingField === "ppr") row.pprRank = index + 1;
      else row.halfPprRank = index + 1;
    });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Defenses + Vegas team totals
// ---------------------------------------------------------------------------

function deriveTradeValuation(
  league: SleeperLeague,
  projectionAsOf: string | null,
): TradeValuation {
  const settings = league.scoring_settings ?? {};
  const warnings: string[] = [];
  const rosterPositions = league.roster_positions ?? [];
  const addWarning = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  const reception = settingValue(settings, "rec");
  if (![0, 0.5, 1].includes(reception)) addWarning(`${reception}-point receptions are not a FantasyCalc market preset.`);
  if (settingValue(settings, "pass_td") !== 4) addWarning(`${settingValue(settings, "pass_td")}-point passing TDs are not reflected in the FantasyCalc market price.`);
  const tePremium = settingValue(settings, "bonus_rec_te");
  if (tePremium !== 0) addWarning(`TE premium (+${tePremium} per catch) is not reflected in the FantasyCalc market price.`);
  const firstDownKeys = ["pass_fd", "rush_fd", "rec_fd"];
  if (firstDownKeys.some((key) => settingValue(settings, key) !== 0)) addWarning("Points per first down are not supported by FantasyCalc's closest format.");
  const bonusKeys = Object.keys(settings).filter((key) => key.startsWith("bonus_") && key !== "bonus_rec_te" && settingValue(settings, key) !== 0);
  if (bonusKeys.length > 0) addWarning("Custom yardage or milestone bonuses are not reflected in the FantasyCalc market price.");
  if (rosterPositions.includes("K") || rosterPositions.includes("DEF")) addWarning("Kicker and defense assets are not priced by FantasyCalc.");

  return { unsupportedSettings: warnings, projectionAsOf, optimizerVersion: "lineup-dp-v1" };
}

function tierScore(value: number, settings: Record<string, number> | undefined, tiers: Array<[number, string]>): number {
  const tier = tiers.find(([upperBound]) => value <= upperBound) ?? tiers[tiers.length - 1];
  return tier ? settingValue(settings, tier[1]) : 0;
}

function scoreProjectedDefenseStats(stats: Record<string, number>, settings: Record<string, number> | undefined): number | null {
  const directKeys = ["sack", "int", "fum_rec", "def_td", "safe", "blk_kick", "def_2pt", "st_td", "st_fum_rec", "pr_yd", "kr_yd", "pr_td", "kr_td"];
  let matched = false;
  let total = 0;
  for (const key of directKeys) {
    if (typeof stats[key] !== "number") continue;
    matched = true;
    total += (stats[key] ?? 0) * settingValue(settings, key);
  }
  const pointsAllowed = stats.pts_allow;
  if (typeof pointsAllowed === "number") {
    matched = true;
    total += tierScore(pointsAllowed, settings, [
      [0, "pts_allow_0"], [6, "pts_allow_1_6"], [13, "pts_allow_7_13"], [20, "pts_allow_14_20"],
      [27, "pts_allow_21_27"], [34, "pts_allow_28_34"], [Infinity, "pts_allow_35p"],
    ]) + pointsAllowed * settingValue(settings, "pts_allow");
  }
  const yardsAllowed = stats.yds_allow;
  if (typeof yardsAllowed === "number") {
    matched = true;
    total += tierScore(yardsAllowed, settings, [
      [100, "yds_allow_0_100"], [199, "yds_allow_100_199"], [299, "yds_allow_200_299"], [349, "yds_allow_300_349"],
      [399, "yds_allow_350_399"], [449, "yds_allow_400_449"], [499, "yds_allow_450_499"], [Infinity, "yds_allow_500p"],
    ]) + yardsAllowed * settingValue(settings, "yds_allow");
  }
  return matched ? Number(total.toFixed(2)) : null;
}

function buildDefenses(
  leagueId: string,
  scoringSettings: Record<string, number> | undefined,
  schedule: SleeperGame[],
  week: number,
  vegasTeamTotals: Map<string, number>,
  gamePhaseByTeam: Map<string, "pregame" | "live" | "final">,
  gameTimeByTeam: Map<string, string>,
  sleeperProjections: Map<string, SleeperProjection>,
): z.infer<typeof defenseSchema>[] {
  const opponents = new Map<string, string>();
  const awayTeams = new Set<string>();
  for (const game of schedule) {
    if (game.week !== week || !game.home || !game.away) continue;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    opponents.set(home, away);
    opponents.set(away, home);
    awayTeams.add(away);
  }
  const base = [...opponents.entries()].map(([team, opponent]) => {
    const opponentProjectedPoints = vegasTeamTotals.get(opponent) ?? null;
    const gamePhase = gamePhaseByTeam.get(team) ?? null;
    const sleeperStats = sleeperProjections.get(team)?.stats;
    const leagueProjection = sleeperStats ? scoreProjectedDefenseStats(sleeperStats, scoringSettings) : null;
    const fallbackProjection = sleeperStats?.pts_ppr ?? sleeperStats?.pts_half_ppr ?? sleeperStats?.pts_std ?? null;
    const pregameProjection = leagueProjection ?? fallbackProjection;
    return {
      leagueId,
      team,
      opponent,
      isAway: awayTeams.has(team),
      opponentProjectedPoints,
      projectedPointsSource: opponentProjectedPoints === null ? "unavailable" as const : "vegas" as const,
      pregameProjection,
      displayProjection: gamePhase === "final" ? null : pregameProjection,
      projectionSource: gamePhase === "final" || pregameProjection === null ? null : "sleeper" as const,
      actualScore: null,
      gamePhase,
      gameTime: gameTimeByTeam.get(team) ?? null,
      components: sleeperStats ?? null,
      rank: null as number | null,
    };
  });
  const ranked = base.filter((row) => row.pregameProjection !== null)
    .sort((a, b) => (b.pregameProjection ?? -Infinity) - (a.pregameProjection ?? -Infinity) || a.team.localeCompare(b.team));
  ranked.forEach((row, index) => { row.rank = index + 1; });
  return base.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.team.localeCompare(b.team));
}

function matchupCodeVariants(away: string, home: string): string[] {
  const aliases = (team: string): string[] => {
    const canonical = canonicalTeam(team);
    if (canonical === "JAX") return ["JAX", "JAC"];
    if (canonical === "WSH") return ["WSH", "WAS"];
    if (canonical === "LV") return ["LV", "LVR"];
    return [canonical];
  };
  return aliases(away).flatMap((awayCode) => aliases(home).flatMap((homeCode) => [`${awayCode}${homeCode}`, `${homeCode}${awayCode}`]));
}

function selectConsensusLine(lines: z.infer<typeof vegasLineSchema>[]): z.infer<typeof vegasLineSchema> | null {
  if (lines.length === 0) return null;
  return [...lines].sort((a, b) => {
    const aDistance = a.probability === null ? 100 : Math.abs(a.probability - 50);
    const bDistance = b.probability === null ? 100 : Math.abs(b.probability - 50);
    return aDistance - bDistance || a.source.localeCompare(b.source);
  })[0] ?? null;
}

function buildVegasTeamTotals(lines: z.infer<typeof vegasLineSchema>[], schedule: SleeperGame[], week: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const game of schedule) {
    if (game.week !== week || !game.away || !game.home) continue;
    const away = canonicalTeam(game.away);
    const home = canonicalTeam(game.home);
    const codes = new Set(matchupCodeVariants(away, home));
    const gameLines = lines.filter((line) => codes.has(line.matchupCode));
    const totalLine = selectConsensusLine(gameLines.filter((line) => line.marketType === "total"));
    if (!totalLine) continue;
    const spreadLine = selectConsensusLine(gameLines.filter((line) => line.marketType === "spread" && line.team));
    const favoredTeam = spreadLine?.team ? canonicalTeam(spreadLine.team) : null;
    const margin = spreadLine && favoredTeam && (favoredTeam === away || favoredTeam === home) ? spreadLine.line : 0;
    const awayTotal = favoredTeam === away ? (totalLine.line + margin) / 2 : favoredTeam === home ? (totalLine.line - margin) / 2 : totalLine.line / 2;
    totals.set(away, Number(awayTotal.toFixed(2)));
    totals.set(home, Number((totalLine.line - awayTotal).toFixed(2)));
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Database-backed inputs
// ---------------------------------------------------------------------------

async function loadVegasProjectionSnapshot(season: number, week: number): Promise<VegasProjectionPayload | null> {
  const rows = await db
    .select()
    .from(schema.vegasProjectionSnapshots)
    .where(and(eq(schema.vegasProjectionSnapshots.season, season), eq(schema.vegasProjectionSnapshots.week, week)))
    .orderBy(desc(schema.vegasProjectionSnapshots.builtAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return vegasProjectionPayloadSchema.parse(JSON.parse(row.payload));
  } catch {
    return null;
  }
}

async function loadStrengthOfSchedule(
  leagueIds: string[],
): Promise<z.infer<typeof strengthOfScheduleEntrySchema>[]> {
  if (leagueIds.length === 0) return [];
  const keys = leagueIds.map((leagueId) => `${STRENGTH_OF_SCHEDULE_CACHE_PREFIX}:${leagueId}`);
  const rows = await db.select().from(schema.sourceCache)
    .where(inArray(schema.sourceCache.cacheKey, keys));
  const entries: z.infer<typeof strengthOfScheduleEntrySchema>[] = [];
  for (const row of rows) {
    try {
      entries.push(strengthOfScheduleEntrySchema.parse(JSON.parse(row.payload)));
    } catch { /* skip malformed rows */ }
  }
  return entries;
}

/**
 * Prediction-market game lines for defense team totals. The betting sources
 * are intentionally disabled in this codebase (removed 2026-09-29, see
 * api/draft-center.ts), so this reads the shared draft-market cache and
 * returns whatever lines it holds — empty in practice, which leaves defense
 * `opponentProjectedPoints` null without changing the response shape.
 */
async function loadDashboardVegasLines(): Promise<z.infer<typeof vegasLineSchema>[]> {
  try {
    const rows = await db.select().from(schema.sourceCache)
      .where(eq(schema.sourceCache.cacheKey, DRAFT_MARKET_CACHE_KEY))
      .limit(1);
    const cached = rows[0];
    if (!cached) return [];
    const payload = JSON.parse(cached.payload) as { vegasLines?: unknown };
    const parsed = z.array(vegasLineSchema).safeParse(payload.vegasLines ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function saveProjectionAccuracy(dashboard: Dashboard): Promise<void> {
  const vegasById = new Map(dashboard.rankings.map((row) => [`${row.leagueId}:${row.playerId}`, row]));
  for (const league of dashboard.leagues) {
    const playerRows = [
      ...league.starters,
      ...league.bench,
      ...(league.opponentTeam?.starters ?? []),
      ...(league.opponentTeam?.bench ?? []),
    ];
    const unique = new Map(playerRows.map((player) => [player.playerId, player]));
    const isPpfdLeague = league.id === DYNASTICAL_CUCKS_LEAGUE_ID;
    const values = [...unique.values()].flatMap((player) => {
      const vegas = vegasById.get(`${league.id}:${player.playerId}`);
      if (!vegas) return [];
      const vegasProjection = vegas.projectionSource === "vegas" ? vegas.leagueProjection : null;
      if (vegasProjection === null) return [];
      return [{
        id: `${dashboard.season}:${dashboard.week}:${league.id}:${player.playerId}`,
        season: dashboard.season,
        week: dashboard.week,
        leagueId: league.id,
        scoring: isPpfdLeague ? "ppfd" : league.rankingField,
        playerId: player.playerId,
        playerName: player.name,
        position: player.position,
        vegasProjection: Math.round(vegasProjection * 100),
        // Dynastical's projections are disclosed PPR proxies, while Sleeper's
        // actuals are PPFD. Keep the proxy snapshot, but exclude that mismatched
        // pair from MAE by leaving the actual leg empty. Sleeper reports zeroes
        // before kickoff, so keep pregame actuals null until play begins.
        actualScore: isPpfdLeague || player.gamePhase === "pregame" || player.actual === null
          ? null
          : Math.round(player.actual * 100),
        capturedAt: new Date(dashboard.asOf),
      }];
    });
    for (let index = 0; index < values.length; index += 100) {
      const chunk = values.slice(index, index + 100);
      if (!chunk.length) continue;
      for (const row of chunk) {
        const insert = db.insert(schema.projectionAccuracy).values(row);
        if (dashboard.week === 3) {
          // Week 3 is the pre-calibration baseline. Keep its identity and Vegas
          // projection frozen while allowing the outcome leg to fill in.
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              actualScore: row.actualScore,
            },
          });
        } else {
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              scoring: row.scoring,
              vegasProjection: row.vegasProjection,
              actualScore: row.actualScore,
              capturedAt: row.capturedAt,
            },
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/**
 * Build a dashboard from scratch for one Sleeper user. Ported from the
 * original `buildDashboard(ctx)` with the Sleeper account parameterized.
 */
export async function buildUserDashboard(sleeperUserId: string, fresh = false): Promise<Dashboard> {
  const sourceErrors: string[] = [];
  let season: number;
  let week: number;
  try {
    const state = await readNflState(fresh);
    season = state.season;
    week = state.week;
  } catch (err) {
    console.error("[dashboard] NFL state lookup failed", err instanceof Error ? err.stack : err);
    throw new Error("Sleeper leagues are unavailable");
  }
  const vegasProjectionSnapshot = await loadVegasProjectionSnapshot(season, week);

  const [leagueResult, playersResult, sleeperProjectionResult, scheduleResult, currentStatsResult, previousStatsResult, kickoffResult] = await Promise.allSettled([
    readUserLeagues(sleeperUserId, fresh),
    fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`),
    fetchJson<SleeperProjection[]>(`${SLEEPER_PROJECTIONS_BASE}/projections/nfl/${season}/${week}?season_type=regular&order_by=pts_ppr`),
    fetchJson<SleeperGame[]>(`${SLEEPER_BASE.replace("/v1", "")}/schedule/nfl/regular/${season}`),
    fetchText(NFLVERSE_PLAYER_STATS_2026_URL),
    fetchText(NFLVERSE_PLAYER_STATS_2025_URL),
    fetchJson<EspnScoreboard>(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`),
  ]);

  if (leagueResult.status === "rejected") {
    console.error("[dashboard] league lookup failed", leagueResult.reason);
    throw new Error("Sleeper leagues are unavailable");
  }
  const sleeperLeagues = leagueResult.value.leagues;
  if (sleeperLeagues.length === 0) sourceErrors.push("No Sleeper leagues for this season.");
  if (playersResult.status === "rejected") throw new Error("Sleeper player data is unavailable");

  const vegasTeamTotals = new Map<string, number>();

  const sleeperProjectionsByPlayerId = new Map<string, SleeperProjection>();
  const sleeperDefenseProjections = new Map<string, SleeperProjection>();
  if (sleeperProjectionResult.status === "fulfilled") {
    for (const row of sleeperProjectionResult.value) {
      if (row.player_id) sleeperProjectionsByPlayerId.set(row.player_id, row);
      const defenseTeam = row.team ?? row.player_id;
      if (row.player?.position === "DEF" && defenseTeam && row.stats) {
        sleeperDefenseProjections.set(canonicalTeam(defenseTeam), row);
      }
    }
  } else sourceErrors.push("Sleeper projections are unavailable; kicker and DST rankings cannot update, and in-progress players may show their pregame projection.");

  // FantasyCalc and the per-league Sleeper requests are independent once the
  // shared player dictionary is available. Start this now so a slow source
  // does not create another serial network phase in the refresh action.
  const fantasyCalcPromise = fetchFantasyCalcRankings(playersResult.value);
  const marketLinesPromise = loadDashboardVegasLines();

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
  const gamePhaseByTeam = new Map<string, "pregame" | "live" | "final">();
  const gameTimeByTeam = new Map<string, string>();
  const teamRecords = kickoffResult.status === "fulfilled" ? nflTeamRecordsFromScoreboard(kickoffResult.value) : [];
  if (kickoffResult.status === "fulfilled") {
    for (const event of kickoffResult.value.events ?? []) {
      if (!event.date || Number.isNaN(new Date(event.date).getTime())) continue;
      const competitors = event.competitions?.flatMap((competition) => competition.competitors ?? []) ?? [];
      for (const competitor of competitors) {
        const abbreviation = competitor.team?.abbreviation;
        if (abbreviation) gameTimeByTeam.set(canonicalTeam(abbreviation), event.date);
      }
    }
  }
  if (gameTimeByTeam.size === 0) sourceErrors.push("NFL kickoff times are temporarily unavailable.");
  if (scheduleResult.status === "fulfilled") {
    for (const game of schedule) {
      if (game.week !== week) continue;
      const phase = normalizeGamePhase(game.status);
      if (phase) {
        if (game.home) gamePhaseByTeam.set(canonicalTeam(game.home), phase);
        if (game.away) gamePhaseByTeam.set(canonicalTeam(game.away), phase);
      }
      if (game.date) {
        if (game.home && !gameTimeByTeam.has(canonicalTeam(game.home))) gameTimeByTeam.set(canonicalTeam(game.home), game.date);
        if (game.away && !gameTimeByTeam.has(canonicalTeam(game.away))) gameTimeByTeam.set(canonicalTeam(game.away), game.date);
      }
    }
  } else sourceErrors.push("NFL game status is unavailable; player rows are showing projections.");

  const vegasProjectionCount = vegasProjectionSnapshot?.projections.length ?? 0;
  const isFirstDownSnapshot = vegasProjectionSnapshot?.source === "first_down";
  const minProjectionCoverage = isFirstDownSnapshot ? MIN_FIRST_DOWN_PLAYER_COVERAGE : MIN_VEGAS_PLAYER_COVERAGE;
  const useVegasPrimary = vegasProjectionCount >= minProjectionCoverage;
  let defenses: z.infer<typeof defenseSchema>[] = [];
  let analytics: z.infer<typeof analyticsSchema> = {
    asOf: null,
    throughWeek: null,
    sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL,
    entities: [],
    teamUsage: [],
    teamRecords,
  };
  if (season !== 2026) {
    sourceErrors.push("Advanced stats are awaiting the nflverse file for the current season.");
  } else if (currentStatsResult.status === "fulfilled" && previousStatsResult.status === "fulfilled") {
    try {
      const built = buildAnalytics(previousStatsResult.value, currentStatsResult.value, season);
      analytics = { asOf: new Date().toISOString(), throughWeek: built.throughWeek, sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL, entities: built.entities, teamUsage: built.teamUsage, teamRecords };
      if (built.entities.length === 0) sourceErrors.push("nflverse advanced stats did not include any current-season games.");
    } catch {
      sourceErrors.push("nflverse advanced stats could not be read.");
    }
  } else {
    sourceErrors.push("nflverse advanced stats are temporarily unavailable.");
  }
  const vegasLines = await marketLinesPromise;
  for (const [team, total] of buildVegasTeamTotals(vegasLines, schedule, week)) vegasTeamTotals.set(team, total);
  const opponentByTeam = new Map<string, string>();
  const isAwayByTeam = new Map<string, boolean>();
  for (const game of schedule) {
    if (game.week !== week || !game.home || !game.away) continue;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    opponentByTeam.set(home, away);
    opponentByTeam.set(away, home);
    isAwayByTeam.set(home, false);
    isAwayByTeam.set(away, true);
  }
  const scheduleWeekAvailable = opponentByTeam.size >= 24;
  const vegasBaseRows: Ranking[] = Object.entries(playersResult.value).flatMap(([playerId, player]) => {
    const position = normalizePosition(player.position);
    const team = player.team ? canonicalTeam(player.team) : "";
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name || !team || !["QB", "RB", "WR", "TE", "K"].includes(position)) return [];
    return [{
      leagueId: "",
      playerId,
      name,
      team,
      opponent: opponentByTeam.get(team) ?? null,
      isAway: isAwayByTeam.get(team) ?? null,
      isBye: scheduleWeekAvailable && !opponentByTeam.has(team),
      position: position as Ranking["position"],
      pprRank: 999,
      halfPprRank: 999,
      leagueRank: 999,
      ppr: null,
      halfPpr: null,
      standard: null,
      leagueProjection: null,
      vegasProjection: null,
      sleeperProjection: null,
      projectionSource: "fallback",
      projectionComponents: null,
      injuryStatus: weeklyAvailabilityStatus(player),
      gameTime: gameTimeByTeam.get(team) ?? null,
    }];
  });
  const rankingsByLeagueId = new Map<string, Ranking[]>();
  // Weekly charts use the same source rows as the rest of the artifact so the
  // retired opportunity-weight projection model cannot reappear in tools.
  const weeklyChartRankingsByLeagueId = new Map<string, Ranking[]>();
  const defensesByLeagueId = new Map<string, z.infer<typeof defenseSchema>[]>();
  for (const league of sleeperLeagues) {
    const rankingField: "ppr" | "halfPpr" = isDynasticalPpfdLeague(league) || (league.scoring_settings?.rec ?? 0) >= 1 ? "ppr" : "halfPpr";
    const leagueDefenses = buildDefenses(
      league.league_id,
      league.scoring_settings,
      schedule,
      week,
      vegasTeamTotals,
      gamePhaseByTeam,
      gameTimeByTeam,
      sleeperDefenseProjections,
    );
    const defenseRankByTeam = new Map(leagueDefenses.flatMap((row) => row.rank === null ? [] : [[row.team, row.rank] as const]));
    const mergedRankings = mergeVegasPlayerProjections(
      league.league_id,
      rankingField,
      vegasBaseRows,
      vegasProjectionSnapshot,
      useVegasPrimary,
      sleeperProjectionsByPlayerId,
      league.scoring_settings,
      defenseRankByTeam,
    );
    weeklyChartRankingsByLeagueId.set(league.league_id, mergedRankings);
    rankingsByLeagueId.set(league.league_id, mergedRankings);
    defensesByLeagueId.set(league.league_id, leagueDefenses);
  }
  const rankings = [...rankingsByLeagueId.values()].flat();
  const weeklyChartRankings = [...weeklyChartRankingsByLeagueId.values()].flat();
  defenses = [...defensesByLeagueId.values()].flat();
  if (!useVegasPrimary) {
    sourceErrors.push(`${isFirstDownSnapshot ? "First Down" : "Vegas"} player coverage is ${vegasProjectionCount}/${minProjectionCoverage} required; weekly skill-position projections are unavailable in this snapshot.`);
  }
  const missingDefenseProjections = defenses.filter((row) => row.pregameProjection === null).length;
  if (missingDefenseProjections > 0) {
    sourceErrors.push(`${missingDefenseProjections} defense projection${missingDefenseProjections === 1 ? " is" : "s are"} unavailable from Sleeper.`);
  }
  const players = playersResult.value;
  const fantasyCalcResult = await fantasyCalcPromise;
  const seasonLongRankings = fantasyCalcResult.rows;
  if (fantasyCalcResult.failedPresets > 0) sourceErrors.push("FantasyCalc season-long rankings are unavailable for one or more league formats.");
  const fantasyCalcAsOf = seasonLongRankings.length > 0 ? new Date().toISOString() : null;
  const defenseActuals = new Map<string, number>();

  // Fetch the required roster before optional league enrichments and bound
  // concurrency. The previous 24-request fan-out could throttle every roster
  // request, yielding a schema-valid dashboard with zero usable leagues.
  const leagues = await mapWithConcurrency(sleeperLeagues, 2, async (league) => {
    let rosters: SleeperRoster[];
    try {
      rosters = await fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`);
    } catch {
      sourceErrors.push(`${league.name}: roster unavailable.`);
      return null;
    }
    const [matchupsResult, usersResult, tradedPicksResult] = await Promise.allSettled([
      fetchJson<SleeperMatchup[]>(`${SLEEPER_BASE}/league/${league.league_id}/matchups/${week}`),
      fetchJson<SleeperUser[]>(`${SLEEPER_BASE}/league/${league.league_id}/users`),
      fetchJson<SleeperTradedPick[]>(`${SLEEPER_BASE}/league/${league.league_id}/traded_picks`),
    ]);
    const ownRoster = rosters.find((roster) => roster.owner_id === sleeperUserId);
    if (!ownRoster) {
      sourceErrors.push(`${league.name}: your roster was not found.`);
      return null;
    }
    const matchups = matchupsResult.status === "fulfilled" ? matchupsResult.value : [];
    const matchup = matchups.find((item) => item.roster_id === ownRoster.roster_id);
    const opponentMatchup = matchup?.matchup_id == null
      ? undefined
      : matchups.find((item) => item.matchup_id === matchup.matchup_id && item.roster_id !== ownRoster.roster_id);
    const opponentRoster = opponentMatchup
      ? rosters.find((roster) => roster.roster_id === opponentMatchup.roster_id)
      : undefined;
    if (matchupsResult.status === "rejected") sourceErrors.push(`${league.name}: live scores unavailable.`);

    const isDynastical = isDynasticalPpfdLeague(league);
    const receptionPoints = league.scoring_settings?.rec ?? 0;
    const rankingField: "ppr" | "halfPpr" = isDynastical || receptionPoints >= 1 ? "ppr" : "halfPpr";
    const scoringLabel = isDynastical ? "PPR proxy · PPFD league" : rankingField === "ppr" ? "PPR" : "Half PPR";
    const rosterPositions = league.roster_positions ?? [];
    const starterSlots = rosterPositions.filter((slot) => !["BN", "IR", "TAXI"].includes(slot));
    const rankingPositions: Array<"QB" | "RB" | "WR" | "TE" | "K" | "DEF"> = ["QB", "RB", "WR", "TE"];
    if (rosterPositions.includes("K")) rankingPositions.push("K");
    if (rosterPositions.includes("DEF")) rankingPositions.push("DEF");
    const seasonLongFormat = seasonLongFormatForLeague(league);
    const tradeValuation = deriveTradeValuation(
      league,
      useVegasPrimary ? (vegasProjectionSnapshot?.built_at ?? null) : null,
    );
    if (seasonLongFormat.isDynasty) tradeValuation.unsupportedSettings.push("Future pick slots are unknown; owned picks use FantasyCalc's neutral mid-pick market row.");
    const normalizedLeagueName = league.name.toLowerCase();
    const showSuperFilter = normalizedLeagueName.includes("cucks") || normalizedLeagueName.includes("taint");
    const leagueRankings = rankingsByLeagueId.get(league.league_id) ?? [];
    const leagueDefenses = defensesByLeagueId.get(league.league_id) ?? [];
    const rankingById = new Map(leagueRankings.map((row) => [row.playerId, row]));
    const defenseByTeam = new Map(leagueDefenses.map((row) => [row.team, row]));

    const makePlayer = (playerId: string, isStarter: boolean, activeMatchup: SleeperMatchup | undefined, starterIndex?: number): RosterPlayer => {
      const meta = players[playerId];
      const position = normalizePosition(meta?.position ?? (playerId.length <= 3 ? "DEF" : null));
      const rankRow = rankingById.get(playerId);
      const defenseTeam = canonicalTeam(playerId);
      const defense = position === "DEF" ? defenseByTeam.get(defenseTeam) : undefined;
      const teamKey = position === "DEF" ? defenseTeam : canonicalTeam(meta?.team ?? "");
      const gamePhase = gamePhaseByTeam.get(teamKey) ?? null;
      const injuryStatus = rankRow?.injuryStatus ?? weeklyAvailabilityStatus(meta);
      const isUnavailable = position !== "DEF" && isUnavailableForCurrentWeek(injuryStatus);
      const pregameProjection = position === "DEF"
        ? (defense?.pregameProjection ?? null)
        : (rankRow?.leagueProjection ?? null);
      const sleeperProjection = sleeperProjectionsByPlayerId.get(playerId)?.stats;
      const customLiveProjection = ["QB", "RB", "WR", "TE", "K"].includes(position)
        ? scoreSleeperPlayerProjection(position as Ranking["position"], sleeperProjection, league.scoring_settings)
        : null;
      const fallbackLiveProjection = rankingField === "ppr"
        ? (sleeperProjection?.pts_ppr ?? sleeperProjection?.pts_half_ppr ?? sleeperProjection?.pts_std ?? null)
        : (sleeperProjection?.pts_half_ppr ?? sleeperProjection?.pts_ppr ?? sleeperProjection?.pts_std ?? null);
      const liveLeg = gamePhase === "live" && !isUnavailable ? (customLiveProjection ?? fallbackLiveProjection) : null;
      const resolvedIsBye = rankRow?.isBye ?? (teamKey !== "" && scheduleWeekAvailable && !opponentByTeam.has(teamKey));
      const pregameOrNull = resolvedIsBye ? null : isUnavailable ? 0 : pregameProjection;
      const projection = gamePhase === "live" ? (liveLeg ?? pregameOrNull) : pregameOrNull;
      const projectionSource = gamePhase === "final"
        ? null
        : position === "DEF"
          ? (defense?.projectionSource ?? null)
          : isUnavailable
            ? "fallback" as const
            : gamePhase === "live"
              ? (liveLeg !== null ? "sleeper" as const : (rankRow?.projectionSource ?? "fallback"))
              : (rankRow?.projectionSource ?? "fallback");
      const projectionComponents = gamePhase === "final" || position === "DEF" || projection === null || isUnavailable
        ? null
        : gamePhase === "live" && liveLeg !== null
          ? (sleeperProjection ?? null)
          : (rankRow?.projectionComponents ?? null);
      const actual = typeof activeMatchup?.players_points?.[playerId] === "number" ? activeMatchup.players_points[playerId] ?? null : null;
      if (position === "DEF" && actual !== null) defenseActuals.set(defenseTeam, actual);
      return {
        playerId,
        name: position === "DEF" ? `${defenseTeam} Defense` : (meta?.full_name ?? ([meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || "Unknown player")),
        team: position === "DEF" ? defenseTeam : (meta?.team ?? null),
        position,
        lineupSlot: isStarter && starterIndex !== undefined ? (starterSlots[starterIndex] ?? position) : null,
        isStarter,
        rank: rankRow ? (rankRow.leagueProjection === null ? null : rankRow.leagueRank) : (defense?.rank ?? null),
        projection,
        projectionSource,
        actual,
        gamePhase,
        gameTime: rankRow?.gameTime ?? defense?.gameTime ?? gameTimeByTeam.get(teamKey) ?? null,
        opponent: rankRow?.opponent ?? defense?.opponent ?? opponentByTeam.get(teamKey) ?? null,
        isAway: rankRow?.isAway ?? defense?.isAway ?? isAwayByTeam.get(teamKey) ?? null,
        isBye: resolvedIsBye,
        injuryStatus,
        defenseComponents: defense?.components ?? null,
        projectionComponents,
      };
    };

    const starterIds = ownRoster.starters ?? [];
    const starters = starterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, matchup, index));
    const starterSet = new Set(starterIds);
    const bench = (ownRoster.players ?? []).filter((id) => !starterSet.has(id)).map((id) => makePlayer(id, false, matchup));
    const opponentStarterIds = opponentRoster?.starters ?? [];
    const opponentStarters = opponentStarterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, opponentMatchup, index));
    const opponentStarterSet = new Set(opponentStarterIds);
    const opponentBench = (opponentRoster?.players ?? []).filter((id) => !opponentStarterSet.has(id)).map((id) => makePlayer(id, false, opponentMatchup));
    const opponentOwner = usersResult.status === "fulfilled"
      ? usersResult.value.find((user) => user.user_id === opponentRoster?.owner_id)
      : undefined;
    const opponentName = opponentRoster?.metadata?.team_name
      ?? opponentOwner?.metadata?.team_name
      ?? opponentOwner?.display_name
      ?? "Opponent";
    const settings = ownRoster.settings ?? {};
    const usersById = new Map((usersResult.status === "fulfilled" ? usersResult.value : []).map((user) => [user.user_id, user]));
    const powerTeamName = (roster: SleeperRoster): string => {
      const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
      return roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`;
    };
    const powerTeamRecord = (roster: SleeperRoster): { wins: number; losses: number; ties: number } => ({
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      ties: roster.settings?.ties ?? 0,
    });
    const normalizeRosterPlayerId = (id: string): string => /^[A-Z]{2,3}$/.test(id) ? canonicalTeam(id) : id;
    const rosterAssignments: z.infer<typeof rosterAssignmentSchema>[] = rosters.flatMap((roster) => {
      const teamName = powerTeamName(roster);
      return (roster.players ?? []).map((id) => ({
        playerId: normalizeRosterPlayerId(id),
        teamName,
        isUser: roster.roster_id === ownRoster.roster_id,
      }));
    });
    const rosteredPlayerIds = [...new Set(rosterAssignments.map((assignment) => assignment.playerId))];
    const matchupByRosterId = new Map(matchups.map((row) => [row.roster_id, row]));

    const pickTemplates = seasonLongRankings.filter((row) => row.formatKey === seasonLongFormat.key && row.position === "PICK");
    type PickTier = "early" | "mid" | "late";
    const pickTemplatesByTier = new Map<string, SeasonLongRanking>();
    const pickCoordinates = new Map<string, { season: string; round: number }>();
    for (const template of pickTemplates) {
      const seasonMatch = template.name.match(/\b(20\d{2})\b/);
      const roundMatch = template.name.match(/\b([1-9])(?:st|nd|rd|th)\b/i);
      const pickSeason = seasonMatch?.[1];
      const pickRound = Number(roundMatch?.[1]);
      if (!pickSeason || !Number.isInteger(pickRound)) continue;
      const tier: PickTier = /\bearly\b/i.test(template.name) ? "early" : /\blate\b/i.test(template.name) ? "late" : "mid";
      const coordinateKey = `${pickSeason}:${pickRound}`;
      pickTemplatesByTier.set(`${coordinateKey}:${tier}`, template);
      pickCoordinates.set(coordinateKey, { season: pickSeason, round: pickRound });
    }
    const tradedPicks = tradedPicksResult.status === "fulfilled" ? tradedPicksResult.value : [];
    const ordinal = (value: number): string => value === 1 ? "1st" : value === 2 ? "2nd" : value === 3 ? "3rd" : `${value}th`;
    // Season-long power rankings (roster-only values) drive pick-tier estimation:
    // a cellar team's future 1st is worth an "early" 1st, a contender's a "late" 1st.
    // Built here so both ownedPicks (trade calculator) and futurePickValue (power
    // rankings display) share the same rank source.
    const makePowerRankings = (formatKey: string): z.infer<typeof powerRankingSchema>[] => {
      const values = seasonLongRankings.filter((row) => row.formatKey === formatKey && row.position !== "PICK");
      if (values.length === 0) return [];
      const valuesByPlayerId = new Map(values.map((row) => [row.playerId, row]));
      return rosters
        .map((roster) => {
          const positionValues = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
          for (const playerId of roster.players ?? []) {
            const valueRow = valuesByPlayerId.get(playerId);
            if (!valueRow || valueRow.position === "PICK") continue;
            positionValues[valueRow.position] += valueRow.value;
          }
          const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
          return {
            rosterId: roster.roster_id,
            teamName: roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`,
            record: powerTeamRecord(roster),
            rank: 0,
            totalValue: positionValues.QB + positionValues.RB + positionValues.WR + positionValues.TE,
            futurePickValue: 0,
            positionValues,
            isUser: roster.roster_id === ownRoster.roster_id,
          };
        })
        .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
        .map((row, index) => ({ ...row, rank: index + 1 }));
    };
    const seasonLongPowerFormatKey = `redraft-${seasonLongFormat.numQbs}qb-${seasonLongFormat.numTeams}t-${seasonLongFormat.ppr}ppr`;
    const powerRankingsSeasonLong = makePowerRankings(seasonLongPowerFormatKey);
    const rankByRosterId = new Map(powerRankingsSeasonLong.map((row) => [row.rosterId, row.rank]));
    const teamCount = rosters.length;
    const ownedPicksByRosterId = new Map<number, SeasonLongRanking[]>();
    if (seasonLongFormat.isDynasty) {
      for (const [coordinateKey, { season: pickSeason, round: pickRound }] of pickCoordinates) {
        for (const originalRoster of rosters) {
          const originalRank = rankByRosterId.get(originalRoster.roster_id);
          const tier: PickTier = originalRank === undefined ? "mid"
            : originalRank <= teamCount / 3 ? "late"
            : originalRank <= (2 * teamCount) / 3 ? "mid" : "early";
          const template = pickTemplatesByTier.get(`${coordinateKey}:${tier}`)
            ?? pickTemplatesByTier.get(`${coordinateKey}:mid`);
          if (!template) continue;
          const trade = tradedPicks.find((row) => row.season === pickSeason && row.round === pickRound && row.roster_id === originalRoster.roster_id);
          const ownerRosterId = trade?.owner_id ?? originalRoster.roster_id;
          const owner = rosters.find((roster) => roster.roster_id === ownerRosterId);
          if (!owner) continue;
          const originalTeamName = powerTeamName(originalRoster);
          const owned = ownedPicksByRosterId.get(ownerRosterId) ?? [];
          owned.push({
            ...template,
            playerId: `pick:${league.league_id}:${pickSeason}:${pickRound}:${originalRoster.roster_id}`,
            name: `${pickSeason} ${ordinal(pickRound)} · ${originalTeamName}`,
          });
          ownedPicksByRosterId.set(ownerRosterId, owned);
        }
      }
    }
    const tradeTeams: z.infer<typeof tradeTeamSchema>[] = rosters.map((roster) => {
      const rosterMatchup = matchupByRosterId.get(roster.roster_id);
      const submittedStarterIds = roster.starters ?? [];
      const submittedStarterSet = new Set(submittedStarterIds);
      const rosterPlayers = [
        ...submittedStarterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, rosterMatchup, index)),
        ...(roster.players ?? []).filter((id) => !submittedStarterSet.has(id)).map((id) => makePlayer(id, false, rosterMatchup)),
      ];
      return {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id ?? null,
        teamName: powerTeamName(roster),
        isUser: roster.roster_id === ownRoster.roster_id,
        players: rosterPlayers,
        ownedPicks: ownedPicksByRosterId.get(roster.roster_id) ?? [],
        record: powerTeamRecord(roster),
      };
    });
    const rosteredSet = new Set(rosteredPlayerIds);
    const tradeWaiverPool: RosterPlayer[] = leagueRankings
      .filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position) && !rosteredSet.has(row.playerId))
      .map((row) => ({
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        lineupSlot: null,
        isStarter: false,
        rank: row.leagueRank,
        projection: row.leagueProjection,
        projectionSource: row.projectionSource,
        actual: null,
        gamePhase: "pregame" as const,
        gameTime: row.gameTime,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        injuryStatus: row.injuryStatus,
        defenseComponents: null,
        projectionComponents: row.projectionComponents,
      }))
      .sort((a, b) => (b.projection ?? -1000) - (a.projection ?? -1000) || a.name.localeCompare(b.name));
    const powerRankingsWeek: z.infer<typeof powerRankingSchema>[] = leagueRankings.length === 0 ? [] : rosters
      .map((roster) => {
        const positionValues = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
        const rosterMatchup = matchupByRosterId.get(roster.roster_id);
        const rosterStarterIds = roster.starters ?? [];
        const powerStarters = rosterStarterIds
          .map((id, index) => ({ id, index }))
          .filter(({ id }) => id && id !== "0")
          .map(({ id, index }) => makePlayer(id, true, rosterMatchup, index));
        const powerStarterSet = new Set(rosterStarterIds);
        const powerBench = (roster.players ?? [])
          .filter((id) => !powerStarterSet.has(id))
          .map((id) => makePlayer(id, false, rosterMatchup));
        const optimizedLineup = optimizeWeeklyPowerLineup(powerStarters, powerBench);
        for (const player of optimizedLineup) {
          const position = ["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"].includes(player.lineupSlot ?? "")
            ? "FLEX"
            : player.position;
          if (!(position in positionValues)) continue;
          const value = player.gamePhase === "final" ? player.actual : player.projection;
          if (value !== null) positionValues[position as keyof typeof positionValues] += value;
        }
        for (const position of Object.keys(positionValues) as Array<keyof typeof positionValues>) {
          positionValues[position] = Number(positionValues[position].toFixed(2));
        }
        return {
          rosterId: roster.roster_id,
          teamName: powerTeamName(roster),
          record: powerTeamRecord(roster),
          rank: 0,
          totalValue: Number(Object.values(positionValues).reduce((total, value) => total + value, 0).toFixed(2)),
          futurePickValue: 0,
          positionValues,
          isUser: roster.roster_id === ownRoster.roster_id,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
      .map((row, index) => ({ ...row, rank: index + 1 }));
    // seasonLongPowerFormatKey / powerRankingsSeasonLong / rankByRosterId / teamCount
    // are defined above (before ownedPicks) so both the trade calculator and the
    // power-rankings display share the same rank source.
    const futurePickValueByRosterId = new Map<number, number>();
    if (seasonLongFormat.isDynasty && teamCount > 0) {
      for (const [coordinateKey, { season: pickSeason, round: pickRound }] of pickCoordinates) {
        if (Number(pickSeason) <= season) continue;
        for (const originalRoster of rosters) {
          const originalRank = rankByRosterId.get(originalRoster.roster_id);
          if (originalRank === undefined) continue;
          const tier: PickTier = originalRank <= teamCount / 3
            ? "late"
            : originalRank <= (2 * teamCount) / 3 ? "mid" : "early";
          const template = pickTemplatesByTier.get(`${coordinateKey}:${tier}`)
            ?? pickTemplatesByTier.get(`${coordinateKey}:mid`);
          if (!template) continue;
          const trade = tradedPicks.find((row) => row.season === pickSeason && row.round === pickRound && row.roster_id === originalRoster.roster_id);
          const ownerRosterId = trade?.owner_id ?? originalRoster.roster_id;
          if (!rosters.some((roster) => roster.roster_id === ownerRosterId)) continue;
          const currentValue = futurePickValueByRosterId.get(ownerRosterId) ?? 0;
          futurePickValueByRosterId.set(ownerRosterId, currentValue + template.value);
        }
      }
    }
    const powerRankingsDynasty = seasonLongFormat.isDynasty
      ? makePowerRankings(seasonLongFormat.key)
        .map((row) => {
          const futurePickValue = Number((futurePickValueByRosterId.get(row.rosterId) ?? 0).toFixed(2));
          return {
            ...row,
            futurePickValue,
            totalValue: Number((row.totalValue + futurePickValue).toFixed(2)),
          };
        })
        .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
        .map((row, index) => ({ ...row, rank: index + 1 }))
      : [];
    return {
      id: league.league_id,
      name: league.name,
      scoringLabel,
      rankingField,
      record: { wins: settings.wins ?? 0, losses: settings.losses ?? 0, ties: settings.ties ?? 0 },
      teamActual: typeof matchup?.points === "number" ? matchup.points : null,
      teamProjection: sumActualsAndRemainingProjections(starters),
      starters,
      bench,
      opponentTeam: opponentRoster ? {
        name: opponentName,
        teamActual: typeof opponentMatchup?.points === "number" ? opponentMatchup.points : null,
        teamProjection: sumActualsAndRemainingProjections(opponentStarters),
        starters: opponentStarters,
        bench: opponentBench,
      } : null,
      suggestion: makeSuggestion(starters, bench),
      rosteredPlayerIds,
      rosterAssignments,
      rankingPositions,
      showSuperFilter,
      seasonLongFormat,
      tradeValuation,
      tradeTeams,
      tradeWaiverPool,
      tradeStarterSlots: starterSlots,
      powerRankingsWeek,
      powerRankingsSeasonLong,
      powerRankingsDynasty,
    };
  });

  for (const defense of defenses) {
    if (defense.gamePhase !== "final") continue;
    defense.actualScore = defenseActuals.get(defense.team) ?? null;
    defense.displayProjection = defense.actualScore;
  }

  const leagueIds = leagues.flatMap((league) => league ? [league.id] : []);
  const strengthOfSchedule = await loadStrengthOfSchedule(leagueIds);

  const dashboard = dashboardResponse.parse({
    status: sourceErrors.length > 0 ? "partial" : "ok",
    season,
    week,
    asOf: new Date().toISOString(),
    rankingsAsOf: useVegasPrimary ? (vegasProjectionSnapshot?.built_at ?? null) : null,
    fantasyCalcAsOf,
    leagues: leagues.filter((league): league is NonNullable<typeof league> => league !== null),
    rankings,
    weeklyChartRankings,
    seasonLongRankings,
    defenses,
    analytics,
    strengthOfSchedule,
    sourceErrors: [...new Set(sourceErrors)],
  });
  // Projection-accuracy telemetry is best-effort: a failed write must not
  // fail the user-facing build (the original action let it throw).
  try {
    await saveProjectionAccuracy(dashboard);
  } catch (error) {
    console.error("[dashboard-build] saveProjectionAccuracy failed", error);
  }
  return dashboard;
}

// ---------------------------------------------------------------------------
// Per-user cache
// ---------------------------------------------------------------------------

export function userDashboardCacheKey(sleeperUserId: string): string {
  return `dashboard:user:${sleeperUserId}`;
}

/**
 * Serve the per-user cached dashboard when fresh (USER_DASHBOARD_CACHE_MS),
 * otherwise build, cache, and return it. `force` bypasses the freshness
 * check. A failed/slow build falls back to the stale per-user cache when
 * one exists. The scheduled owner, and only that owner, can then fall
 * back to the stored snapshot. Any other miss propagates (→ 500 at the route).
 */
export async function loadOrBuildUserDashboard(sleeperUserId: string, force = false): Promise<Dashboard> {
  const cacheKey = userDashboardCacheKey(sleeperUserId);
  const cached = await readUserDashboardCache(sleeperUserId);
  const cachedDashboard = cached?.dashboard ?? null;
  if (!force && cachedDashboard && cached?.fresh) {
    return cachedDashboard;
  }

  try {
    const buildPromise = buildUserDashboard(sleeperUserId, force);
    // If the deadline wins the race, the build keeps running detached; guard
    // against an unhandled rejection when it eventually settles.
    buildPromise.catch(() => undefined);
    const dashboard = await withDeadline(buildPromise, BUILD_DEADLINE_MS);
    await writeUserDashboardCache(cacheKey, dashboard);
    return dashboard;
  } catch (error) {
    if (cachedDashboard) return cachedDashboard; // stale beats an error
    if (readOwnerSleeperUserId() === sleeperUserId) {
      const snapshot = await readGlobalDashboardSnapshot();
      if (snapshot) return snapshot;
    }
    throw error;
  }
}

async function writeUserDashboardCache(cacheKey: string, dashboard: Dashboard): Promise<void> {
  await db
    .insert(schema.sourceCache)
    .values({ cacheKey, payload: JSON.stringify(dashboard), fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: JSON.stringify(dashboard), fetchedAt: new Date() },
    });
}

/**
 * Write the scheduled owner's dashboard into the shared snapshot key.
 * Client routes do not serve this to signed-out visitors. The signed-in
 * owner can fall back to it, and the cron snapshot read can return it.
 */
export async function writeGlobalDashboardSnapshot(dashboard: Dashboard): Promise<void> {
  await writeUserDashboardCache(CACHE_KEY, dashboard);
}

/** Stored owner snapshot, including the previous cache-key version when needed. */
export async function readGlobalDashboardSnapshot(): Promise<Dashboard | null> {
  const currentRows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, CACHE_KEY))
    .limit(1);
  const current = currentRows[0];
  if (current) {
    const dashboard = parseUsableDashboard(current.payload);
    if (dashboard) return dashboard;
  }

  const legacyRows = await db
    .select()
    .from(schema.sourceCache)
    .where(like(schema.sourceCache.cacheKey, "dashboard-live-projections-v%"))
    .orderBy(desc(schema.sourceCache.fetchedAt))
    .limit(6);
  for (const row of legacyRows) {
    if (row.cacheKey === CACHE_KEY) continue;
    const dashboard = parseUsableDashboard(row.payload);
    if (dashboard) return dashboard;
  }
  return null;
}

/**
 * Read the per-user cache without building. `fresh` is true when the cached
 * dashboard is inside USER_DASHBOARD_CACHE_MS. Returns null when no usable
 * cache exists (first-ever load for this user).
 */
export async function readUserDashboardCache(
  sleeperUserId: string,
): Promise<{ dashboard: Dashboard; fresh: boolean } | null> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, userDashboardCacheKey(sleeperUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const dashboard = parseUsableDashboard(row.payload);
  if (!dashboard) return null;
  return {
    dashboard,
    fresh: Date.now() - row.fetchedAt.getTime() < USER_DASHBOARD_CACHE_MS,
  };
}

// Single-flight guard so concurrent section reads (and dashboard reads) for
// the same user share one background build per function instance.
const inFlightBuilds = new Map<string, Promise<void>>();

/**
 * Start (or join) a background build for this user that caches its result
 * when done. Never rejects — pair with `waitUntil` at the route so Vercel
 * keeps the function alive until the cache write lands. Section reads use
 * this so a cold cache answers immediately with "no data yet" while the
 * first build (~30s) runs behind the response.
 */
export function kickUserDashboardBuild(sleeperUserId: string): Promise<void> {
  const existing = inFlightBuilds.get(sleeperUserId);
  if (existing) return existing;
  const build = (async () => {
    try {
      const dashboard = await buildUserDashboard(sleeperUserId);
      await writeUserDashboardCache(userDashboardCacheKey(sleeperUserId), dashboard);
    } catch {
      // Background build failed; the next read retries. The client keeps
      // polling and eventually surfaces its error state.
    } finally {
      inFlightBuilds.delete(sleeperUserId);
    }
  })();
  inFlightBuilds.set(sleeperUserId, build);
  return build;
}
