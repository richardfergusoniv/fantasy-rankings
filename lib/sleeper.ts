import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Shared Sleeper API helpers and fantasy-stat scoring functions.
 *
 * Extracted verbatim from `app/server/src/actions.ts` (read-only copies;
 * `app/` sources are not modified). Used by the draft-center, boom/bust,
 * box-score, and player-news cron routes.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLEEPER_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_PROJECTIONS_BASE = "https://api.sleeper.com";
export const SOURCE_TIMEOUT_MS = 15_000;
export const REFRESH_TIMEOUT_MS = 110_000;

export const DRAFT_MARKET_CACHE_KEY = "draft-market-signals-v1";
export const DRAFT_MARKET_CACHE_MS = 24 * 60 * 60 * 1000;
export const FFC_BASE_URL = "https://fantasyfootballcalculator.com/api/v1/adp";
export const MFL_ADP_URL = "https://api.myfantasyleague.com/2026/export?TYPE=adp&JSON=1";
export const MFL_PLAYERS_URL = "https://api.myfantasyleague.com/2026/export?TYPE=players&JSON=1";

export const FANTASY_CALC_VALUES_URL = "https://api.fantasycalc.com/values/current";
export const FANTASY_CALC_HISTORY_URL = "https://api.fantasycalc.com/trades/implied";

export const DYNASTICAL_CUCKS_LEAGUE_ID = "1306489414548979712";

export const PLAYER_NEWS_SNAPSHOT_KEY = "player-news-injury-snapshot-v1";
export const PLAYER_NEWS_LEAGUES = [
  { id: "1389344450517430272", name: "NY Sack Exchange II" },
  { id: "1355920300633513984", name: "Tits Out for The Ladz XII" },
  { id: "1317270144682070016", name: "C2C superconference" },
  { id: "1312127020972404736", name: "Hoe Ass Dynasty" },
  { id: "1311470531635052544", name: "Tainticklers" },
  { id: "1306489414548979712", name: "Dynastical Cucks" },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SleeperLeague = {
  league_id: string;
  name: string;
  season?: string;
  previous_league_id?: string | null;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: { type?: number; reserve_slots?: number; taxi_slots?: number; draft_rounds?: number };
  total_rosters?: number;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id?: string;
  players?: string[];
  starters?: string[];
  settings?: { wins?: number; losses?: number; ties?: number };
  metadata?: { team_name?: string };
};

export type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  injury_status?: string | null;
  injury_notes?: string | null;
  status?: string | null;
  years_exp?: number | null;
};

export type SleeperDraft = {
  draft_id?: string;
  league_id?: string | null;
  season?: string;
  status?: string;
  type?: string;
  start_time?: number | null;
  last_picked?: number | null;
  settings?: { rounds?: number; teams?: number };
  draft_order?: Record<string, number>;
  slot_to_roster_id?: Record<string, number | null>;
  metadata?: { name?: string };
};

export type SleeperDraftPick = {
  pick_no?: number;
  round?: number;
  draft_slot?: number;
  roster_id?: number | null;
  picked_by?: string | number | null;
  player_id?: string;
  metadata?: { first_name?: string; last_name?: string; team?: string; position?: string; player_id?: string };
};

export type SleeperTrend = { player_id?: string; count?: number };

export type FfcPlayer = {
  name?: string;
  team?: string;
  position?: string;
  adp?: number;
  high?: number;
  low?: number;
  times_drafted?: number;
};
export type FfcResponse = { players?: FfcPlayer[] };
export type MflAdpResponse = { adp?: { player?: Array<{ id?: string; averagePick?: string | number }> } };
export type MflPlayersResponse = { players?: { player?: Array<{ id?: string; name?: string; position?: string; team?: string }> } };

export type FantasyCalcRow = {
  player?: {
    id?: number;
    sleeperId?: string | null;
    name?: string;
    position?: string;
    maybeTeam?: string | null;
  };
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number | null;
};

export type FantasyCalcHistoryResponse = {
  historicalValues?: Array<{ date?: string; value?: number }>;
};

export type SeasonLongFormat = {
  key: string;
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
  label: string;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Source request timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  return await withDeadline((async () => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return (await response.json()) as T;
  })(), SOURCE_TIMEOUT_MS, () => controller.abort());
}

// ---------------------------------------------------------------------------
// String / number helpers
// ---------------------------------------------------------------------------

export function parseNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePosition(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "DST") return "DEF";
  return value;
}

export function normalizedPlayerName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/jr$|sr$|ii$|iii$|iv$/g, "");
  const aliases: Record<string, string> = {
    joshpalmer: "joshuapalmer",
    joshuapalmer: "joshuapalmer",
  };
  return aliases[normalized] ?? normalized;
}

export function canonicalTeam(team: string): string {
  if (team === "JAC") return "JAX";
  if (team === "LA") return "LAR";
  if (team === "LVR") return "LV";
  if (team === "OAK") return "LV";
  if (team === "WSH") return "WAS";
  return team;
}

export function settingValue(settings: Record<string, number> | undefined, key: string): number {
  const value = settings?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// Fantasy scoring
// ---------------------------------------------------------------------------

export function scoreProjectedPlayerStats(
  position: string,
  stats: Record<string, number>,
  settings: Record<string, number> | undefined,
): number {
  const directKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td",
  ];
  let total = directKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0);
  if (position === "TE") total += (stats.rec ?? 0) * settingValue(settings, "bonus_rec_te");

  const bonuses: Array<[string, string, number]> = [
    ["bonus_pass_yd_300", "pass_yd", 300], ["bonus_pass_yd_400", "pass_yd", 400],
    ["bonus_pass_td_5", "pass_td", 5], ["bonus_pass_cmp_25", "pass_cmp", 25],
    ["bonus_rush_yd_100", "rush_yd", 100], ["bonus_rush_yd_200", "rush_yd", 200],
    ["bonus_rush_att_20", "rush_att", 20],
    ["bonus_rec_yd_100", "rec_yd", 100], ["bonus_rec_yd_200", "rec_yd", 200],
    ["bonus_rec_10", "rec", 10],
  ];
  for (const [settingKey, statKey, threshold] of bonuses) {
    if ((stats[statKey] ?? 0) >= threshold) total += settingValue(settings, settingKey);
  }

  if (position === "K") {
    const distanceKeys = ["fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p"];
    const missKeys = ["fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p"];
    const hasDistanceScoring = distanceKeys.some((key) => settingValue(settings, key) !== 0);
    const hasDistanceMissScoring = missKeys.some((key) => settingValue(settings, key) !== 0);
    total += hasDistanceScoring
      ? distanceKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgm ?? 0) * settingValue(settings, "fgm");
    total += hasDistanceMissScoring
      ? missKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgmiss ?? 0) * settingValue(settings, "fgmiss");
    total += (stats.fgm_50p ?? 0) * settingValue(settings, "fgm_50p");
    total += (stats.xpm ?? 0) * settingValue(settings, "xpm");
    total += (stats.xpmiss ?? 0) * settingValue(settings, "xpmiss");
    const estimatedMadeYards = (stats.fgm_0_19 ?? 0) * 19 + (stats.fgm_20_29 ?? 0) * 25 + (stats.fgm_30_39 ?? 0) * 35
      + (stats.fgm_40_49 ?? 0) * 45 + (stats.fgm_50_59 ?? 0) * 55 + (stats.fgm_60p ?? 0) * 62;
    total += estimatedMadeYards * settingValue(settings, "fgm_yds");
  }
  return Number(total.toFixed(2));
}

// ---------------------------------------------------------------------------
// Sleeper weekly stats (boom/bust)
// ---------------------------------------------------------------------------

export const BOOM_BUST_SEASONS = [2024, 2025, 2026] as const;
const SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS = 30 * 60 * 1000;
const SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

export type SleeperWeeklyStatRow = Record<string, unknown>;

export async function loadSleeperPlayerWeeklySeason(
  playerId: string,
  season: number,
): Promise<SleeperWeeklyStatRow[]> {
  const cacheKey = `sleeper-player-weekly-stats-v1:${playerId}:${season}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  const maxAge = season === 2026 ? SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS : SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS;
  if (cached && Date.now() - cached.fetchedAt.getTime() < maxAge) {
    const parsed: unknown = JSON.parse(cached.payload);
    return normalizeSleeperWeeklyRows(parsed);
  }
  try {
    const payload = await fetchJson<unknown>(
      `${SLEEPER_PROJECTIONS_BASE}/stats/nfl/player/${encodeURIComponent(playerId)}?season_type=regular&season=${season}&grouping=week`,
    );
    const rows = normalizeSleeperWeeklyRows(payload);
    await db.insert(schema.sourceCache).values({ cacheKey, payload: JSON.stringify(payload), fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(payload), fetchedAt: new Date() } });
    return rows;
  } catch (error) {
    if (cached) {
      const parsed: unknown = JSON.parse(cached.payload);
      return normalizeSleeperWeeklyRows(parsed);
    }
    throw error;
  }
}

function flattenSleeperWeeklyRow(row: SleeperWeeklyStatRow, week?: number): SleeperWeeklyStatRow {
  const nestedStats = typeof row.stats === "object" && row.stats !== null && !Array.isArray(row.stats)
    ? (row.stats as SleeperWeeklyStatRow)
    : {};
  return { ...row, ...nestedStats, week: row.week ?? week };
}

export function normalizeSleeperWeeklyRows(payload: unknown): SleeperWeeklyStatRow[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow)];
    });
  }
  if (typeof payload !== "object" || payload === null) return [];
  return Object.entries(payload).flatMap(([weekKey, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow, Number(weekKey))];
  });
}

export function sleeperActualStats(row: SleeperWeeklyStatRow): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
  }
  return stats;
}

export function sleeperGameLogStats(
  position: "QB" | "RB" | "WR" | "TE",
  row: SleeperWeeklyStatRow,
): Record<string, number> {
  const fields: Record<"QB" | "RB" | "WR" | "TE", Array<[string, string[]]>> = {
    QB: [
      ["passCmp", ["pass_cmp"]], ["passAtt", ["pass_att"]], ["passYds", ["pass_yd"]],
      ["passTd", ["pass_td"]], ["interceptions", ["pass_int"]], ["rushAtt", ["rush_att"]],
      ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
    ],
    RB: [
      ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]],
    ],
    WR: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
    TE: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
  };
  const stats: Record<string, number> = {};
  for (const [outputKey, sourceKeys] of fields[position]) {
    const value = sourceKeys.map((key) => row[key]).find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
    if (typeof value === "number") stats[outputKey] = value;
  }
  return stats;
}

export function hasSleeperGameParticipation(row: SleeperWeeklyStatRow): boolean {
  if (typeof row.game_id !== "string" || row.game_id.length === 0) return false;
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (status === "inactive" || status === "out" || status === "dnp") return false;
  const participationFields = [
    "pass_att", "rush_att", "targets", "rec", "off_snp", "snp", "snap_count", "snap_pct",
    "pass_yd", "rush_yd", "rec_yd", "pass_td", "rush_td", "rec_td", "fum", "fum_lost",
    "pr_yd", "kr_yd", "pr_td", "kr_td", "two_pt_conv", "pass_2pt", "rush_2pt", "rec_2pt",
  ];
  return participationFields.some((key) => typeof row[key] === "number" && Number(row[key]) > 0);
}

const boomBustSeriesSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  weeklyScores: z.array(z.object({ season: z.number().int(), week: z.number().int(), points: z.number() })),
  floor: z.number().nullable(),
  firstQuartile: z.number().nullable(),
  median: z.number().nullable(),
  mean: z.number().nullable(),
  thirdQuartile: z.number().nullable(),
  ceiling: z.number().nullable(),
});

export function buildBoomBustSeries(
  games: Array<{ season: number; week: number; points: number }>,
  status: "ok" | "unavailable",
): z.infer<typeof boomBustSeriesSchema> {
  const weeklyScores = games.slice().sort((a, b) => a.season - b.season || a.week - b.week);
  const values = weeklyScores.map((score) => score.points);
  return {
    status,
    weeklyScores,
    floor: values.length >= 5 ? percentile(values, 0.1) : values.length ? Math.min(...values) : null,
    firstQuartile: values.length >= 8 ? percentile(values, 0.25) : null,
    median: median(values),
    mean: mean(values),
    thirdQuartile: values.length >= 8 ? percentile(values, 0.75) : null,
    ceiling: values.length ? Math.max(...values) : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) return null;
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  return lower === undefined ? upper : Number(((lower + upper) / 2).toFixed(2));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const rank = (ordered.length - 1) * quantile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = ordered[lowerIndex];
  const upper = ordered[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return Number((lower + (upper - lower) * (rank - lowerIndex)).toFixed(2));
}

// ---------------------------------------------------------------------------
// League format + availability
// ---------------------------------------------------------------------------

export function isDynasticalPpfdLeague(league: Pick<SleeperLeague, "league_id" | "name">): boolean {
  return league.league_id === DYNASTICAL_CUCKS_LEAGUE_ID || league.name.toLowerCase().includes("dynastical cucks");
}

export function seasonLongFormatForLeague(league: SleeperLeague): SeasonLongFormat {
  const rosterPositions = league.roster_positions ?? [];
  const numQbs = rosterPositions.includes("SUPER_FLEX") || rosterPositions.filter((slot) => slot === "QB").length > 1 ? 2 : 1;
  const isPpfdLeague = isDynasticalPpfdLeague(league);
  const ppr = isPpfdLeague ? 1 : league.scoring_settings?.rec === 1 ? 1 : league.scoring_settings?.rec === 0 ? 0 : 0.5;
  const isDynasty = league.settings?.type === 2 || league.name.toLowerCase().includes("dynasty");
  const numTeams = Math.max(2, Math.min(32, league.total_rosters ?? 12));
  const key = `${isDynasty ? "dynasty" : "redraft"}-${numQbs}qb-${numTeams}t-${ppr}ppr`;
  const scoring = isPpfdLeague ? "PPR proxy · PPFD league" : ppr === 1 ? "PPR" : ppr === 0.5 ? "Half PPR" : "Standard";
  return {
    key,
    isDynasty,
    numQbs,
    numTeams,
    ppr,
    label: `${isDynasty ? "Dynasty" : "Redraft"} · ${numTeams}-team · ${numQbs === 2 ? "Superflex / 2QB" : "1QB"} · ${scoring}`,
  };
}

export function normalizedAvailabilityStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
}

export function isUnavailableForCurrentWeek(status: string | null | undefined): boolean {
  if (!status) return false;
  return new Set([
    "out",
    "inactive",
    "ir",
    "injured reserve",
    "pup",
    "physically unable to perform",
    "nfi",
    "non football injury",
    "non football illness",
    "suspended",
    "suspension",
    "reserve suspended",
  ]).has(normalizedAvailabilityStatus(status));
}

export function weeklyAvailabilityStatus(player: SleeperPlayer | undefined): string | null {
  if (!player) return null;
  const injuryStatus = player.injury_status?.trim() || null;
  if (isUnavailableForCurrentWeek(injuryStatus)) return injuryStatus;
  const rosterStatus = player.status?.trim() || null;
  if (isUnavailableForCurrentWeek(rosterStatus)) return rosterStatus;
  const injuryNotes = player.injury_notes?.trim() || null;
  if (injuryNotes && /\b(out for (?:the )?(?:week|season|year)|ruled out|season[ -]ending|miss (?:the )?rest of (?:the )?(?:season|year)|placed on injured reserve)\b/i.test(injuryNotes)) {
    return injuryStatus ?? "Out";
  }
  return injuryStatus;
}

export function parseInjurySnapshot(payload: string | undefined): Record<string, string | null> {
  if (!payload) return {};
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(
      (entry): entry is [string, string | null] => typeof entry[1] === "string" || entry[1] === null,
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
