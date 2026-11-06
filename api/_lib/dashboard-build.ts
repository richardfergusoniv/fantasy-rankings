import { waitUntil } from "@vercel/functions";
import { upcomingSchedule } from "./upcoming-schedule.js";
import { waiverCacheFor } from "./waiver-suggestions.js";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";
import { loadSleeperTrending, type PlayerTrendingMap } from "./sleeper-trending.js";
import {
  analyticsSchema,
  dashboardMetaSchema,
  dashboardPlayersSchema,
  dashboardResponse,
  defenseSchema,
  nflTeamRecordSchema,
  parseUsableDashboard,
  powerRankingSchema,
  rankingSchema,
  rosterAssignmentSchema,
  rosterPlayerSchema,
  seasonLongRankingSchema,
  serializeDashboardForCache,
  strengthOfScheduleEntrySchema,
  suggestionSchema,
  tradeTeamSchema,
  tradeValuationSchema,
  type Dashboard,
  CACHE_KEY,
  emptyPlayerInsights,
} from "./dashboard-schemas.js";
import {
  buildDashboardCacheWrites,
  DASHBOARD_CACHE_SECTIONS,
  dashboardFromSectionRows,
  dashboardSnapshotIsLive,
  dashboardAnalyticsCacheSchema,
  dashboardLeagueCacheSchema,
  dashboardTeamCacheSchema,
  dashboardTradeCacheSchema,
  dashboardTradeWaiverCacheSchema,
  parseSectionEnvelope,
  resolveSectionHitFromRows,
  userDashboardSectionCacheKey,
  type DashboardCacheSection,
  type DashboardSectionCacheData,
  type DashboardTeamApiData,
} from "./dashboard-section-cache.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";
import { countCacheMetric, sampleCacheBytes } from "./cache-metrics.js";
import {
  responseCacheFetchedAtMs,
} from "./dashboard-response-cache.js";
import { readOwnerUserId } from "./auth.js";
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
  fetchJsonWithRetry,
  isDynasticalPpfdLeague,
  isUnavailableForCurrentWeek,
  loadSleeperPlayerWeeklySeason,
  normalizePosition,
  seasonLongFormatForLeague,
  settingValue,
  sleeperActualStats,
  weeklyAvailabilityStatus,
  type FantasyCalcRow,
  type SeasonLongFormat,
  type SleeperLeague,
  type SleeperPlayer,
  type SleeperRoster,
} from "./sleeper.js";
import { activeBenchIds, eligibleForSlot, espnStatusToPhase, isLineupLocked, isVacantLineupSlot, lineupCountingPoints, mapSubmittedStarters, normalizeGamePhase, optimizeLineup, sumLiveForecast } from "./lineup-optimizer.js";
import { scoreActualPlayerStats } from "./fantasy-scoring.js";
import { createPriorityBatchLoaders } from "./shared-batch-loader.js";
import { rankingsForLeagueFormats, redraftTwinFormat } from "./season-long-format.js";
import { usesRegularSeasonWeek } from "./season-week.js";
import { blendedContenderRanks, pickTierForRank, type PickTier } from "./pick-tier.js";
import {
  FREE_AGENT_ACTUALS_BUDGET_MS,
  awaitWithBudget,
  remainingMsUntil,
  remainingOptionalActualsBudgetMs,
  resolveRosterPlayerActual,
  selectActualStatsCandidates,
} from "./actual-stats-candidates.js";
import {
  applyActualRanks,
  applyDefenseActualRanks,
  finalizeDefenseActualDisplay,
  mergePlayerProjections,
  projectionBoardIsUsable,
  type SleeperProjection,
} from "./player-projection-merge.js";
import { appendDailyValueSnapshots } from "./player-value-history.js";
import {
  isActiveNflRosterPlayer,
  loadNflPlayersMap,
  resolvePlayerTeam,
} from "./nfl-players-cache.js";
import { scoreProjectedDefenseStats } from "./defense-scoring.js";
import { readPlayerInsightsSnapshot } from "./player-insights.js";
import { analyticsSectionFromPrecompute, NFLVERSE_PLAYER_STATS_2026_URL } from "./analytics-build.js";
import { opportunityBySleeperId, usageProjectionFor } from "./usage-projection.js";
import { buildStandings, rosterLimits, waiverStatus } from "./league-standings.js";
import { loadTeamGameLines, type TeamGameLine } from "./team-game-lines.js";
import {
  BuildDeadlineError,
  dashboardBuildLeaseResource,
  drizzleBuildLeaseStore,
  publishUnderBuildLease,
  type BuildPublicationTransaction,
  runWithBuildLease,
} from "./build-lease.js";
import { createDashboardBuildTracker, type DashboardBuildState } from "./dashboard-build-status.js";
import { assertDashboardBuildPublishable, buildRetryBudgetMs } from "./dashboard-build-guard.js";
import type { RosContext } from "./ros.js";
import { captureServerError } from "./posthog.js";

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
/** Shorter cache while any rostered game is live so lineup totals can refresh. */
export const LIVE_DASHBOARD_CACHE_MS = 150 * 1000;
export const BUILD_DEADLINE_MS = 55_000; // stay inside the 60s function budget
/** Remaining budget below which optional ROS loading is skipped entirely, and the margin kept in reserve when it runs. */
export const ROS_LOAD_MIN_REMAINING_MS = 10_000;
/** Lease TTL: longer than the deadline so a build always releases or expires. */
export const BUILD_LEASE_TTL_MS = 90_000;

const STRENGTH_OF_SCHEDULE_CACHE_PREFIX = "strength-of-schedule-v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Ranking = z.infer<typeof rankingSchema>;
type RosterPlayer = z.infer<typeof rosterPlayerSchema>;
type SeasonLongRanking = z.infer<typeof seasonLongRankingSchema>;
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
      status?: {
        clock?: number;
        period?: number;
        type?: {
          name?: string;
          state?: string;
          completed?: boolean;
          description?: string;
        };
      };
    }>;
  }>;
};

type GameClock = {
  period: number | null;
  clockSeconds: number | null;
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
  // Each stat's lowest and highest book line (pipeline 2026-11). Optional so older snapshots still parse.
  expected_stats_low: z.record(z.string(), z.number()).optional(),
  expected_stats_high: z.record(z.string(), z.number()).optional(),
  td_probability_low: z.union([z.number(), z.record(z.string(), z.number())]).nullable().optional(),
  td_probability_high: z.union([z.number(), z.record(z.string(), z.number())]).nullable().optional(),
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

function optimizeWeeklyPowerLineup(startersInput: RosterPlayer[], benchInput: RosterPlayer[]): RosterPlayer[] {
  // Same lock rules as the Matchup optimized lineup: started or finished
  // games stay in their submitted slot, and only pregame players move.
  return optimizeLineup(startersInput, benchInput).starters;
}

function makeSuggestion(starters: RosterPlayer[], bench: RosterPlayer[]): z.infer<typeof suggestionSchema> {
  let best: z.infer<typeof suggestionSchema> = null;
  for (const reserve of bench) {
    if (isLineupLocked(reserve) || reserve.projection === null) continue;
    for (const starter of starters) {
      if (
        isLineupLocked(starter)
        || !starter.lineupSlot
        || starter.projection === null
        || !eligibleForSlot(reserve.position, starter.lineupSlot)
      ) continue;
      const delta = reserve.projection - starter.projection;
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
/** Keep the parsed ~2.5 MB presets row in process memory between builds. */
export const FANTASYCALC_MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour

type FantasyCalcPresetsHit = {
  presets: Record<string, FantasyCalcRow[]>;
  /** `source_cache.fetchedAt` — drives the 24h data freshness check. */
  sourceFetchedAt: Date;
  /** When this process last loaded/parsed the row — drives memory TTL. */
  fetchedAt: Date;
};

let fantasyCalcPresetsMemory: FantasyCalcPresetsHit | null = null;

/** True when the in-process FantasyCalc parse is still within the memory TTL. */
export function isFantasyCalcMemoryFresh<T extends { fetchedAt: Date }>(
  memory: T | null,
  nowMs: number,
  ttlMs: number = FANTASYCALC_MEMORY_TTL_MS,
): memory is T {
  return memory != null && nowMs - memory.fetchedAt.getTime() < ttlMs;
}

function rememberFantasyCalcPresets(
  presets: Record<string, FantasyCalcRow[]>,
  sourceFetchedAt: Date,
  nowMs: number = Date.now(),
): FantasyCalcPresetsHit {
  fantasyCalcPresetsMemory = {
    presets,
    sourceFetchedAt,
    fetchedAt: new Date(nowMs),
  };
  return fantasyCalcPresetsMemory;
}

async function readFantasyCalcCache(): Promise<{
  presets: Record<string, FantasyCalcRow[]>;
  fetchedAt: Date;
} | null> {
  const nowMs = Date.now();
  const memoryHit = fantasyCalcPresetsMemory;
  if (isFantasyCalcMemoryFresh(memoryHit, nowMs)) {
    return {
      presets: memoryHit.presets,
      fetchedAt: memoryHit.sourceFetchedAt,
    };
  }
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, FANTASYCALC_CACHE_KEY))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    const payload = decodeSourceCachePayload(row.payload) as {
      presets?: Record<string, FantasyCalcRow[]>;
    };
    if (!payload.presets || typeof payload.presets !== "object") return null;
    const remembered = rememberFantasyCalcPresets(payload.presets, row.fetchedAt, nowMs);
    return { presets: remembered.presets, fetchedAt: remembered.sourceFetchedAt };
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
      // FantasyCalc maybeTeam lags trades/cuts; Sleeper is authoritative (null = FA).
      team: resolvePlayerTeam(sleeperPlayers[playerId], row.player.maybeTeam),
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
  valueSnapshots: number;
  skipped: number;
  unchangedSkipped: number;
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
  const payload = encodeSourceCachePayload({ presets });
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: FANTASYCALC_CACHE_KEY,
      payload,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload, fetchedAt },
    });
  rememberFantasyCalcPresets(presets, fetchedAt, fetchedAt.getTime());
  // Append today's market values for every fetched preset so value history
  // covers the full ranked universe, not only players opened in the UI.
  const snapshots = await appendDailyValueSnapshots(presets, fetchedAt);
  return {
    presets: Object.keys(presets).length,
    rows: rowCount,
    failed,
    asOf: fetchedAt.toISOString(),
    valueSnapshots: snapshots.rows,
    skipped: snapshots.skipped,
    unchangedSkipped: snapshots.unchangedSkipped,
  };
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

function sumActualsAndRemainingProjections(players: RosterPlayer[]): number | null {
  return sumLiveForecast(players);
}

function dashboardCacheTtlMs(dashboard: Dashboard): number {
  return dashboardSnapshotIsLive(dashboard) ? LIVE_DASHBOARD_CACHE_MS : USER_DASHBOARD_CACHE_MS;
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

/**
 * Load the week's staged projection snapshots: the primary board (the
 * latest Vegas snapshot, or First Down's when no Vegas board exists) and,
 * alongside a Vegas primary, the latest First Down snapshot for per-player
 * gap-filling. Snapshots are stored one row per source; legacy rows keyed
 * without a source suffix classify by their payload's `source` field.
 */
async function loadProjectionSnapshots(
  season: number,
  week: number,
): Promise<{ primary: VegasProjectionPayload | null; firstDownFallback: VegasProjectionPayload | null }> {
  const rows = await db
    .select()
    .from(schema.vegasProjectionSnapshots)
    .where(and(eq(schema.vegasProjectionSnapshots.season, season), eq(schema.vegasProjectionSnapshots.week, week)))
    .orderBy(desc(schema.vegasProjectionSnapshots.builtAt));
  let vegas: VegasProjectionPayload | null = null;
  let firstDown: VegasProjectionPayload | null = null;
  for (const row of rows) {
    let payload: VegasProjectionPayload;
    try {
      payload = vegasProjectionPayloadSchema.parse(JSON.parse(row.payload));
    } catch {
      continue;
    }
    if (payload.source === "first_down") firstDown ??= payload;
    else vegas ??= payload;
    if (vegas && firstDown) break;
  }
  const primary = vegas ?? firstDown;
  return { primary, firstDownFallback: primary === vegas && vegas ? firstDown : null };
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
      entries.push(strengthOfScheduleEntrySchema.parse(decodeSourceCachePayload(row.payload)));
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
    const payload = decodeSourceCachePayload(cached.payload) as { vegasLines?: unknown };
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
      const gamePhase = player.gamePhase;
      const locked = gamePhase === "live" || gamePhase === "final";
      // Actuals only when the game is final. Mid-game writes ran 2–3.5 pts low.
      // PPFD league actuals are filled from box-score components in PPR by the
      // Tuesday finalize-accuracy job (Sleeper players_points are PPFD).
      const actualScore =
        !isPpfdLeague && gamePhase === "final" && player.actual !== null
          ? Math.round(player.actual * 100)
          : null;
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
        actualScore,
        capturedAt: new Date(dashboard.asOf),
        // Used only for conflict-update branching below (not a DB column).
        _locked: locked,
      }];
    });
    for (let index = 0; index < values.length; index += 100) {
      const chunk = values.slice(index, index + 100);
      if (!chunk.length) continue;
      for (const row of chunk) {
        const { _locked: locked, ...dbRow } = row;
        const insert = db.insert(schema.projectionAccuracy).values(dbRow);
        if (dbRow.actualScore !== null && (dashboard.week === 3 || locked)) {
          // Freeze Vegas projection after lock (and keep week-3 baseline frozen).
          // Only write the outcome leg when the game is final.
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              actualScore: dbRow.actualScore,
            },
          });
        } else if (!locked && dashboard.week !== 3) {
          // Never clear a stored final actual with null when schedule/phase
          // lookup briefly treats a finished game as unlocked.
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              scoring: dbRow.scoring,
              vegasProjection: dbRow.vegasProjection,
              capturedAt: dbRow.capturedAt,
            },
          });
        } else {
          // Locked (or week-3) with no final actual yet: insert once, never
          // overwrite vegas_projection or clear a later actual with null.
          await insert.onConflictDoNothing();
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/** Weekly stat lines for free-agent actuals, memoized per warm instance so
 * repeated builds inside the TTL skip the per-player source-cache reads.
 * Stats are league-independent; each league scores them at stamp time. */
const FREE_AGENT_STATS_MEMO_TTL_MS = 10 * 60 * 1000;
const freeAgentStatsMemo = new Map<string, { fetchedAtMs: number; stats: Record<string, number> | null }>();

async function loadFreeAgentWeeklyStats(
  playerIds: string[],
  season: number,
  week: number,
  onPlayerStats?: (playerId: string, stats: Record<string, number>) => void,
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  const missing: string[] = [];
  const publish = (playerId: string, stats: Record<string, number>) => {
    result.set(playerId, stats);
    onPlayerStats?.(playerId, stats);
  };
  for (const playerId of playerIds) {
    const memo = freeAgentStatsMemo.get(`${playerId}:${season}:${week}`);
    if (memo && Date.now() - memo.fetchedAtMs < FREE_AGENT_STATS_MEMO_TTL_MS) {
      if (memo.stats) publish(playerId, memo.stats);
    } else {
      missing.push(playerId);
    }
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const playerId = missing[cursor];
      cursor += 1;
      let stats: Record<string, number> | null = null;
      try {
        const weekly = await loadSleeperPlayerWeeklySeason(playerId, season);
        const weekRow = weekly.find((row) => row.week === week);
        if (weekRow) stats = sleeperActualStats(weekRow);
      } catch {
        stats = null;
      }
      freeAgentStatsMemo.set(`${playerId}:${season}:${week}`, { fetchedAtMs: Date.now(), stats });
      if (stats) publish(playerId, stats);
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, missing.length) }, () => worker()));
  return result;
}

/**
 * Build a dashboard from scratch for one Sleeper user. Ported from the
 * original `buildDashboard(ctx)` with the Sleeper account parameterized.
 *
 * `deadlineAtMs` aligns soft actuals waits with the outer `runWithBuildLease`
 * budget so uncapped rostered stats loads cannot hold the build open forever.
 */
export async function buildUserDashboard(
  sleeperUserId: string,
  fresh = false,
  options?: { deadlineAtMs?: number; requireComplete?: boolean; protectedLeagueIds?: readonly string[] },
): Promise<Dashboard> {
  const buildDeadlineAt = options?.deadlineAtMs ?? Date.now() + BUILD_DEADLINE_MS;
  const sourceErrors: string[] = [];
  const rosterFetchFailedLeagueIds: string[] = [];
  let season: number;
  let week: number;
  let seasonType = "";
  try {
    const state = await readNflState(fresh, { retryDeadlineAtMs: buildDeadlineAt });
    season = state.season;
    week = state.week;
    seasonType = state.seasonType;
  } catch (err) {
    console.error("[dashboard] NFL state lookup failed", err instanceof Error ? err.stack : err);
    throw new Error("Sleeper leagues are unavailable");
  }
  const attachWeekContext = usesRegularSeasonWeek(seasonType);
  const projectionSnapshots = attachWeekContext
    ? await loadProjectionSnapshots(season, week)
    : { primary: null, firstDownFallback: null };
  const vegasProjectionSnapshot = projectionSnapshots.primary;
  const firstDownProjectionSnapshot = projectionSnapshots.firstDownFallback;

  // Started alongside the other sources; a missing games file only drops the lines.
  const gameLinesPromise: Promise<TeamGameLine[]> = attachWeekContext
    ? loadTeamGameLines(season, week).catch((err: unknown) => {
      console.error("[dashboard] game lines unavailable", err instanceof Error ? err.message : err);
      sourceErrors.push("Game lines (spreads and totals) are temporarily unavailable.");
      return [];
    })
    : Promise.resolve([]);
  const [leagueResult, playersResult, sleeperProjectionResult, scheduleResult, kickoffResult, trendingResult] = await Promise.allSettled([
    readUserLeagues(sleeperUserId, fresh, { retryDeadlineAtMs: buildDeadlineAt }),
    // Compact daily cache (cron refresh-nfl-players) — not the full Sleeper dump in Supabase.
    loadNflPlayersMap(fresh),
    attachWeekContext
      ? fetchJsonWithRetry<SleeperProjection[]>(`${SLEEPER_PROJECTIONS_BASE}/projections/nfl/${season}/${week}?season_type=regular&order_by=pts_ppr`, { deadlineAtMs: buildDeadlineAt })
      : Promise.resolve([] as SleeperProjection[]),
    attachWeekContext
      ? fetchJsonWithRetry<SleeperGame[]>(`${SLEEPER_BASE.replace("/v1", "")}/schedule/nfl/regular/${season}`, { deadlineAtMs: buildDeadlineAt })
      : Promise.resolve([] as SleeperGame[]),
    attachWeekContext
      ? fetchJson<EspnScoreboard>(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`)
      : Promise.resolve({ events: [] } as EspnScoreboard),
    loadSleeperTrending().catch((err: unknown) => {
      console.error("[dashboard] trending lookup failed", err instanceof Error ? err.stack : err);
      return {} as PlayerTrendingMap;
    }),
  ]);

  const playerTrending: PlayerTrendingMap = trendingResult.status === "fulfilled" ? trendingResult.value : {};

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
  if (attachWeekContext && sleeperProjectionResult.status === "fulfilled") {
    for (const row of sleeperProjectionResult.value) {
      if (row.player_id) sleeperProjectionsByPlayerId.set(row.player_id, row);
      const defenseTeam = row.team ?? row.player_id;
      if (row.player?.position === "DEF" && defenseTeam && row.stats) {
        sleeperDefenseProjections.set(canonicalTeam(defenseTeam), row);
      }
    }
  } else if (attachWeekContext) sourceErrors.push("Sleeper projections are unavailable; kicker and DST rankings cannot update, and in-progress players may show their pregame projection.");

  // FantasyCalc and the per-league Sleeper requests are independent once the
  // shared player dictionary is available. Start this now so a slow source
  // does not create another serial network phase in the refresh action.
  const fantasyCalcPromise = fetchFantasyCalcRankings(playersResult.value);
  const marketLinesPromise = loadDashboardVegasLines();

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
  const gamePhaseByTeam = new Map<string, "pregame" | "live" | "final">();
  const gameTimeByTeam = new Map<string, string>();
  const gameClockByTeam = new Map<string, GameClock>();
  const teamRecords = kickoffResult.status === "fulfilled" ? nflTeamRecordsFromScoreboard(kickoffResult.value) : [];
  if (kickoffResult.status === "fulfilled") {
    for (const event of kickoffResult.value.events ?? []) {
      if (!event.date || Number.isNaN(new Date(event.date).getTime())) continue;
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors ?? [];
      const espnPhase = espnStatusToPhase(competition?.status);
      const period = typeof competition?.status?.period === "number" ? competition.status.period : null;
      const clockSeconds = typeof competition?.status?.clock === "number" ? competition.status.clock : null;
      for (const competitor of competitors) {
        const abbreviation = competitor.team?.abbreviation;
        if (!abbreviation) continue;
        const team = canonicalTeam(abbreviation);
        gameTimeByTeam.set(team, event.date);
        if (espnPhase) gamePhaseByTeam.set(team, espnPhase);
        if (espnPhase === "live") {
          gameClockByTeam.set(team, { period, clockSeconds });
        }
      }
    }
  }
  if (attachWeekContext && gameTimeByTeam.size === 0) sourceErrors.push("NFL kickoff times are temporarily unavailable.");
  if (scheduleResult.status === "fulfilled") {
    for (const game of schedule) {
      if (game.week !== week) continue;
      const kickoffMs = game.date && !/^\d{4}-\d{2}-\d{2}$/.test(game.date.trim())
        ? Date.parse(game.date)
        : Number.NaN;
      const scheduleHasStarted = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
      const phase = normalizeGamePhase(game.status, { hasStarted: scheduleHasStarted });
      if (phase) {
        // ESPN kickoff feed wins when present; Sleeper fills gaps.
        if (game.home && !gamePhaseByTeam.has(canonicalTeam(game.home))) gamePhaseByTeam.set(canonicalTeam(game.home), phase);
        if (game.away && !gamePhaseByTeam.has(canonicalTeam(game.away))) gamePhaseByTeam.set(canonicalTeam(game.away), phase);
      }
      if (game.date) {
        if (game.home && !gameTimeByTeam.has(canonicalTeam(game.home))) gameTimeByTeam.set(canonicalTeam(game.home), game.date);
        if (game.away && !gameTimeByTeam.has(canonicalTeam(game.away))) gameTimeByTeam.set(canonicalTeam(game.away), game.date);
      }
    }
  } else if (attachWeekContext) sourceErrors.push("NFL game status is unavailable; player rows are showing projections.");

  const vegasProjectionCount = vegasProjectionSnapshot?.projections.length ?? 0;
  const isFirstDownSnapshot = vegasProjectionSnapshot?.source === "first_down";
  // Partial Vegas boards (early week) stay usable so First Down gap-fill and
  // Sleeper last-resort can run. Empty / kickers-only Vegas and thin First
  // Down boards are still rejected by projectionBoardIsUsable.
  const useVegasPrimary = projectionBoardIsUsable(vegasProjectionSnapshot);
  let defenses: z.infer<typeof defenseSchema>[] = [];
  // Read only: the refresh-player-insights cron job owns refetching the sources.
  // The snapshot is one season's; another season gets none rather than stale ranks.
  const storedInsights = await readPlayerInsightsSnapshot().catch(() => null);
  const insightsSnapshot = storedInsights?.season === season ? storedInsights : null;
  const opportunityByPlayerId = opportunityBySleeperId(insightsSnapshot?.opportunity, insightsSnapshot?.sleeperByGsis);
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
  } else {
    // Precomputed by the refresh-player-insights cron job into the same
    // snapshot read above; builds no longer download the raw stats files.
    const precomputed = analyticsSectionFromPrecompute(insightsSnapshot?.analytics, teamRecords);
    if (precomputed) {
      analytics = precomputed;
      if (precomputed.entities.length === 0) sourceErrors.push("nflverse advanced stats did not include any current-season games.");
    } else {
      sourceErrors.push("nflverse advanced stats are temporarily unavailable.");
    }
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
    if (!isActiveNflRosterPlayer(player)) return [];
    const position = normalizePosition(player.position);
    const team = canonicalTeam(player.team ?? "");
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
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
      actual: null,
      gamePhase: null,
    }];
  });
  const rankingsByLeagueId = new Map<string, Ranking[]>();
  // Weekly charts reuse the same ranking rows (stored once in cache; see
  // serializeDashboardForCache / hydrateDashboardFromCache).
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
    const mergedRankings = mergePlayerProjections(
      league.league_id,
      rankingField,
      vegasBaseRows,
      vegasProjectionSnapshot,
      firstDownProjectionSnapshot,
      useVegasPrimary,
      sleeperProjectionsByPlayerId,
      league.scoring_settings,
    );
    rankingsByLeagueId.set(league.league_id, mergedRankings);
    defensesByLeagueId.set(league.league_id, leagueDefenses);
  }
  const rankings = [...rankingsByLeagueId.values()].flat();
  const weeklyChartRankings = rankings;
  // Free-agent actuals: the matchup points stamped per league below only
  // cover rostered players, and rosters are only known inside the league
  // loop, so each league lazily loads weekly stat lines for its own
  // strongest unrostered live/final players. Loads are shared across
  // leagues and backed by the per-player source cache; each league scores
  // the lines through its own settings at stamp time.
  const freeAgentStatsByPlayerId = new Map<string, Record<string, number>>();
  // Publish each player as it lands so a budget timeout can stamp partial
  // scores instead of waiting for the whole batch.
  const statsLoaders = createPriorityBatchLoaders(async (playerIds: string[]) => {
    await loadFreeAgentWeeklyStats(playerIds, season, week, (playerId, stats) => {
      freeAgentStatsByPlayerId.set(playerId, stats);
    });
  });
  defenses = [...defensesByLeagueId.values()].flat();
  if (attachWeekContext && !useVegasPrimary) {
    const coverageLabel = isFirstDownSnapshot
      ? "First Down board is below its minimum"
      : "Vegas board is empty or kickers-only";
    sourceErrors.push(`${coverageLabel} (${vegasProjectionCount} players); weekly skill-position projections fall back to Sleeper when available.`);
  }
  const missingDefenseProjections = defenses.filter((row) => row.pregameProjection === null).length;
  if (missingDefenseProjections > 0) {
    sourceErrors.push(`${missingDefenseProjections} defense projection${missingDefenseProjections === 1 ? " is" : "s are"} unavailable from Sleeper.`);
  }
  const players = playersResult.value;
  const fantasyCalcResult = await fantasyCalcPromise;
  const seasonLongFormats = sleeperLeagues.flatMap((league) => {
    const leagueFormat = seasonLongFormatForLeague(league);
    return [leagueFormat, redraftTwinFormat(leagueFormat)];
  });
  const seasonLongRankings = rankingsForLeagueFormats(fantasyCalcResult.rows, seasonLongFormats);
  if (fantasyCalcResult.failedPresets > 0) sourceErrors.push("FantasyCalc season-long rankings are unavailable for one or more league formats.");
  const fantasyCalcAsOf = seasonLongRankings.length > 0 ? new Date().toISOString() : null;

  // One shared soft deadline for optional FA/defense actual loads across all
  // leagues — each wave spends remaining time, not a fresh 4s restart.
  const optionalActualsDeadlineAt = Date.now() + FREE_AGENT_ACTUALS_BUDGET_MS;

  // Fetch the required roster before optional league enrichments and bound
  // concurrency. The previous 24-request fan-out could throttle every roster
  // request, yielding a schema-valid dashboard with zero usable leagues.
  const leagues = await mapWithConcurrency(sleeperLeagues, 2, async (league) => {
    let rosters: SleeperRoster[];
    try {
      rosters = await fetchJsonWithRetry<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`, { deadlineAtMs: buildDeadlineAt });
    } catch {
      sourceErrors.push(`${league.name}: roster unavailable.`);
      rosterFetchFailedLeagueIds.push(league.league_id);
      return null;
    }
    const [matchupsResult, usersResult, tradedPicksResult] = await Promise.allSettled([
      fetchJsonWithRetry<SleeperMatchup[]>(`${SLEEPER_BASE}/league/${league.league_id}/matchups/${week}`, { deadlineAtMs: buildDeadlineAt }),
      fetchJsonWithRetry<SleeperUser[]>(`${SLEEPER_BASE}/league/${league.league_id}/users`, { deadlineAtMs: buildDeadlineAt }),
      fetchJsonWithRetry<SleeperTradedPick[]>(`${SLEEPER_BASE}/league/${league.league_id}/traded_picks`, { deadlineAtMs: buildDeadlineAt }),
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
    // Rankings and Waivers swap projections for actuals as games are
    // played, the way the totals already do. Rostered players take the
    // league's own matchup points (already scored in this league); free
    // agents are scored from their weekly stat lines through this
    // league's settings.
    const matchupPointsByPlayerId = new Map<string, number>();
    for (const item of matchups) {
      for (const [playerId, points] of Object.entries(item.players_points ?? {})) {
        if (typeof points === "number" && Number.isFinite(points)) matchupPointsByPlayerId.set(playerId, points);
      }
    }
    for (const row of leagueRankings) {
      row.gamePhase = gamePhaseByTeam.get(canonicalTeam(row.team)) ?? null;
    }
    // Rostered live/final players missing *their own* matchup points always
    // need scored weekly-stat lines (uncapped). Free agents stay capped and
    // time-bounded so a cold 400-id fan-out cannot eat the build deadline.
    const rosteredIds = new Set(rosters.flatMap((roster) => roster.players ?? []));
    const { priorityPlayerIds, freeAgentPlayerIds } = selectActualStatsCandidates({
      rows: leagueRankings,
      rosteredIds,
      matchupPointsByPlayerId,
    });
    // DST ids are team codes; load the same weekly-stat path for defenses
    // without matchup points. Rostered DSTs stay on the critical path.
    const defenseStatsCandidateIds = leagueDefenses
      .filter((defense) => (
        (defense.gamePhase === "live" || defense.gamePhase === "final")
        && !matchupPointsByPlayerId.has(defense.team)
      ))
      .map((defense) => defense.team);
    const priorityDefenseIds = defenseStatsCandidateIds.filter((team) => rosteredIds.has(team));
    const optionalDefenseIds = defenseStatsCandidateIds.filter((team) => !rosteredIds.has(team));
    const priorityStatsIds = [...new Set([...priorityPlayerIds, ...priorityDefenseIds])];
    const priorityStatsIdSet = new Set(priorityStatsIds);
    const optionalStatsIds = [...new Set([...freeAgentPlayerIds, ...optionalDefenseIds])]
      .filter((id) => !priorityStatsIdSet.has(id));
    if (priorityStatsIds.length > 0) {
      // Uncapped rostered candidates, but only wait within the remaining
      // build-lease budget; stamp whatever has already published on timeout.
      await awaitWithBudget(
        statsLoaders.priority(priorityStatsIds),
        remainingMsUntil(buildDeadlineAt),
        (pending) => { waitUntil(pending.catch(() => undefined)); },
      );
    }
    if (optionalStatsIds.length > 0) {
      // Best-effort: stamp whatever arrives inside the shared FA budget
      // (also capped by the build deadline); continue the rest in background.
      await awaitWithBudget(
        statsLoaders.optional(optionalStatsIds),
        remainingOptionalActualsBudgetMs(optionalActualsDeadlineAt, buildDeadlineAt),
        (pending) => { waitUntil(pending.catch(() => undefined)); },
      );
    }
    for (const row of leagueRankings) {
      const matchupPoints = matchupPointsByPlayerId.get(row.playerId);
      if (matchupPoints !== undefined) {
        row.actual = matchupPoints;
      } else if (row.gamePhase === "live" || row.gamePhase === "final") {
        const stats = freeAgentStatsByPlayerId.get(row.playerId);
        if (stats) {
          row.actual = scoreActualPlayerStats(row.position, stats, league.scoring_settings);
        }
      }
    }

    // Stamp DST actuals from this league's matchup points (or scored weekly
    // stats). Keys stay on the per-league defense rows so scoring cannot bleed
    // across leagues that share a team abbreviation.
    for (const defense of leagueDefenses) {
      const matchupPoints = matchupPointsByPlayerId.get(defense.team);
      if (typeof matchupPoints === "number" && Number.isFinite(matchupPoints)) {
        defense.actualScore = matchupPoints;
      } else if (defense.gamePhase === "live" || defense.gamePhase === "final") {
        const stats = freeAgentStatsByPlayerId.get(defense.team);
        if (stats) {
          defense.actualScore = scoreProjectedDefenseStats(stats, league.scoring_settings);
        }
      }
    }
    applyDefenseActualRanks(leagueDefenses);
    finalizeDefenseActualDisplay(leagueDefenses);

    // With actuals stamped, final players re-rank on what they scored
    // (above or below the remaining projections); live and pregame players
    // keep their projection ranks.
    applyActualRanks(leagueRankings, rankingField);

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
      const resolvedIsBye = rankRow?.isBye ?? (teamKey !== "" && scheduleWeekAvailable && !opponentByTeam.has(teamKey));
      // Keep the pregame projection on the row; liveForecastPoints reprojects from
      // actual + ESPN clock. Sleeper's projections feed does not shrink in-game.
      const projection = resolvedIsBye ? null : isUnavailable && gamePhase !== "live" ? 0 : pregameProjection;
      const projectionSource = gamePhase === "final"
        ? null
        : position === "DEF"
          ? (defense?.projectionSource ?? null)
          : isUnavailable
            ? "fallback" as const
            : (rankRow?.projectionSource ?? "fallback");
      const projectionComponents = gamePhase === "final" || position === "DEF" || projection === null || isUnavailable
        ? null
        : (rankRow?.projectionComponents ?? null);
      // Usage-blend inputs, scored under this league's settings from the
      // player's expected-points components (no history for DEF or uncovered players).
      const usage = position === "DEF"
        ? null
        : usageProjectionFor(opportunityByPlayerId.get(playerId), position ?? "", league.scoring_settings);
      // The book range only describes the pregame projection, so it goes once the game starts.
      const projectionRange = gamePhase === "pregame" || gamePhase === null
        ? (projection !== null && projection === pregameProjection && !isUnavailable ? (rankRow?.projectionRange ?? null) : null)
        : null;
      // Prefer matchup points; when the feed is missing/empty, reuse the
      // weekly-stat actual already stamped on the ranking or defense row so
      // lineup totals and power rankings stay consistent with the board.
      const actual = resolveRosterPlayerActual({
        matchupPoints: activeMatchup?.players_points?.[playerId],
        rankingActual: rankRow?.actual,
        defenseActualScore: defense?.actualScore,
      });
      const clock = gamePhase === "live" ? gameClockByTeam.get(teamKey) : undefined;
      return {
        playerId,
        name: position === "DEF" ? `${defenseTeam} Defense` : (meta?.full_name ?? ([meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || "Unknown player")),
        team: position === "DEF" ? defenseTeam : (meta?.team ?? null),
        position,
        lineupSlot: isStarter && starterIndex !== undefined ? (starterSlots[starterIndex] ?? position) : null,
        isStarter,
        rank: rankRow ? (rankRow.leagueProjection === null && !(rankRow.gamePhase === "final" && typeof rankRow.actual === "number") ? null : rankRow.leagueRank) : (defense?.rank ?? null),
        projection,
        projectionSource,
        actual,
        gamePhase,
        gameTime: rankRow?.gameTime ?? defense?.gameTime ?? gameTimeByTeam.get(teamKey) ?? null,
        gamePeriod: clock?.period ?? null,
        gameClockSeconds: clock?.clockSeconds ?? null,
        opponent: rankRow?.opponent ?? defense?.opponent ?? opponentByTeam.get(teamKey) ?? null,
        isAway: rankRow?.isAway ?? defense?.isAway ?? isAwayByTeam.get(teamKey) ?? null,
        isBye: resolvedIsBye,
        injuryStatus,
        defenseComponents: defense?.components ?? null,
        projectionComponents,
        projectionRange,
        usageProjection: usage?.usageProjection ?? null,
        usageGames: usage?.usageGames ?? 0,
      };
    };

    const vacantRosterPlayer = (slot: string): RosterPlayer => ({
      playerId: "0",
      name: "",
      team: null,
      position: slot,
      lineupSlot: slot,
      isStarter: true,
      rank: null,
      projection: null,
      projectionSource: null,
      actual: null,
      gamePhase: null,
      gameTime: null,
      gamePeriod: null,
      gameClockSeconds: null,
      opponent: null,
      isAway: null,
      isBye: false,
      injuryStatus: null,
      defenseComponents: null,
      projectionComponents: null,
    });
    const submittedStarters = (
      starterIds: string[],
      activeMatchup: SleeperMatchup | undefined,
    ): RosterPlayer[] => mapSubmittedStarters(
      starterIds,
      (id, index) => makePlayer(id, true, activeMatchup, index),
      (index) => vacantRosterPlayer(starterSlots[index] ?? "BN"),
    );
    const activeBench = (roster: SleeperRoster, activeMatchup: SleeperMatchup | undefined): RosterPlayer[] => (
      activeBenchIds(roster.players ?? [], roster.starters ?? [], roster.reserve ?? [], roster.taxi ?? [])
        .map((id) => makePlayer(id, false, activeMatchup))
    );
    const starterIds = ownRoster.starters ?? [];
    const starters = submittedStarters(starterIds, matchup);
    const bench = activeBench(ownRoster, matchup);
    const opponentStarterIds = opponentRoster?.starters ?? [];
    const opponentStarters = submittedStarters(opponentStarterIds, opponentMatchup);
    const opponentBench = opponentRoster ? activeBench(opponentRoster, opponentMatchup) : [];
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
    // Pick tiers blend current record with redraft roster value. A cellar team's
    // future 1st is an "early" 1st and a contender's is a "late" 1st. Built here
    // so owned picks and the power-rankings pick total share one order.
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
    const rankByRosterId = blendedContenderRanks(powerRankingsSeasonLong.map((row) => ({
      rosterId: row.rosterId,
      wins: row.record.wins,
      losses: row.record.losses,
      ties: row.record.ties,
      valueRank: row.rank,
    })));
    const teamCount = rosters.length;
    const ownedPicksByRosterId = new Map<number, SeasonLongRanking[]>();
    if (seasonLongFormat.isDynasty) {
      for (const [coordinateKey, { season: pickSeason, round: pickRound }] of pickCoordinates) {
        for (const originalRoster of rosters) {
          const originalRank = rankByRosterId.get(originalRoster.roster_id);
          const tier: PickTier = pickTierForRank(originalRank, teamCount);
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
      .map((row) => {
        // Same usage-blend inputs the roster rows carry, so waiver-pool
        // snapshot rows blend too instead of always running Vegas-only.
        const usage = usageProjectionFor(opportunityByPlayerId.get(row.playerId), row.position, league.scoring_settings);
        return {
          playerId: row.playerId,
          name: row.name,
          team: row.team,
          position: row.position,
          lineupSlot: null,
          isStarter: false,
          rank: row.leagueRank,
          projection: row.leagueProjection,
          projectionSource: row.projectionSource,
          actual: row.actual,
          gamePhase: row.gamePhase ?? "pregame",
          gameTime: row.gameTime,
          gamePeriod: null,
          gameClockSeconds: null,
          opponent: row.opponent,
          isAway: row.isAway,
          isBye: row.isBye,
          injuryStatus: row.injuryStatus,
          defenseComponents: null,
          projectionComponents: row.projectionComponents,
          usageProjection: usage?.usageProjection ?? null,
          usageGames: usage?.usageGames ?? 0,
        };
      })
      .sort((a, b) => (b.projection ?? -1000) - (a.projection ?? -1000) || a.name.localeCompare(b.name));
    const powerRankingsWeek: z.infer<typeof powerRankingSchema>[] = leagueRankings.length === 0 ? [] : rosters
      .map((roster) => {
        const positionValues = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
        const rosterMatchup = matchupByRosterId.get(roster.roster_id);
        const powerStarters = submittedStarters(roster.starters ?? [], rosterMatchup);
        const powerBench = activeBench(roster, rosterMatchup);
        const optimizedLineup = optimizeWeeklyPowerLineup(powerStarters, powerBench);
        for (const player of optimizedLineup) {
          if (isVacantLineupSlot(player)) continue;
          const position = ["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"].includes(player.lineupSlot ?? "")
            ? "FLEX"
            : player.position;
          if (!(position in positionValues)) continue;
          const value = lineupCountingPoints(player);
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
          const tier: PickTier = pickTierForRank(originalRank, teamCount);
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
      scoringSettings: league.scoring_settings,
      rankingField,
      record: { wins: settings.wins ?? 0, losses: settings.losses ?? 0, ties: settings.ties ?? 0 },
      teamActual: typeof matchup?.points === "number" ? matchup.points : null,
      teamProjection: sumActualsAndRemainingProjections(starters),
      starters,
      bench,
      opponentTeam: opponentRoster ? {
        rosterId: opponentRoster.roster_id,
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
      ...buildStandings(rosters, ownRoster.roster_id, powerTeamName, league.settings),
      waivers: waiverStatus(league.settings, ownRoster, rosters.length),
      rosterLimits: rosterLimits(league.roster_positions, league.settings),
    };
  });

  const leagueIds = leagues.flatMap((league) => league ? [league.id] : []);
  const strengthOfSchedule = await loadStrengthOfSchedule(leagueIds);

  // Before `status` below reads sourceErrors: a failed fetch adds one.
  const gameLines = await gameLinesPromise;
  // ros.ts pulls in projected-standings (which imports this module), so the
  // import stays dynamic — same reason as the scoring-jobs import below.
  const { loadRosContext, regularSeasonEndWeek, byeWeeksByTeam } = await import("./ros.js");
  const byeWeekMap = scheduleResult.status === "fulfilled" ? byeWeeksByTeam(schedule, canonicalTeam) : undefined;
  const dashboard = dashboardResponse.parse({
    status: sourceErrors.length > 0 ? "partial" : "ok",
    season,
    week,
    asOf: new Date().toISOString(),
    rankingsAsOf: useVegasPrimary ? (vegasProjectionSnapshot?.built_at ?? null) : null,
    fantasyCalcAsOf,
    playerTrending,
    playerInsights: insightsSnapshot
      ? { depth: insightsSnapshot.depth, depthAsOf: insightsSnapshot.depthAsOf, depthPrevious: insightsSnapshot.depthPrevious }
      : emptyPlayerInsights,
    leagues: leagues.filter((league): league is NonNullable<typeof league> => league !== null),
    rankings,
    weeklyChartRankings,
    seasonLongRankings,
    defenses,
    analytics,
    strengthOfSchedule,
    upcomingGames: upcomingSchedule(schedule, week, 4, canonicalTeam),
    // The one source of bye truth: team → bye week from the season schedule.
    byeWeeks: byeWeekMap ? Object.fromEntries(byeWeekMap) : undefined,
    gameLines,
    sourceErrors: [...new Set(sourceErrors)],
  });
  // Graded waiver adds for the top free agents (FAAB bids and priority grades),
  // graded exactly as the chat assistant grades them. Best-effort: a failure
  // leaves the leagues without cached waiver output.
  try {
    // Dynamic import: scoring-jobs imports this module, so a static import would be circular.
    const { loadActiveScoringWeights } = await import("./scoring-jobs.js");
    const weights = await loadActiveScoringWeights();
    const byeWeeks = byeWeekMap;
    // One ROS context per league end week — covered weeks differ when leagues
    // start the playoffs on different weeks. Optional evidence lives inside
    // the build deadline: a slow projection pull must not turn an otherwise
    // successful build into a deadline failure, so loading stops once the
    // remaining budget cannot cover it and the build publishes without ROS.
    const rosByEndWeek = new Map<number, RosContext | null>();
    for (const league of dashboard.leagues) {
      const endWeek = regularSeasonEndWeek(league);
      let context = rosByEndWeek.get(endWeek) ?? null;
      if (!context && !rosByEndWeek.has(endWeek)) {
        const remainingMs = remainingMsUntil(buildDeadlineAt);
        if (remainingMs >= ROS_LOAD_MIN_REMAINING_MS) {
          // Bounded wait: the pull continues in the background (its cache
          // write still lands), but the build stops waiting before the
          // deadline and publishes this league without ROS evidence.
          context = await Promise.race([
            loadRosContext(dashboard.season, dashboard.week + 1, endWeek),
            new Promise<null>((resolve) => {
              setTimeout(resolve, Math.max(1, remainingMs - ROS_LOAD_MIN_REMAINING_MS));
            }),
          ]);
        }
        rosByEndWeek.set(endWeek, context);
      }
      const cache = waiverCacheFor(dashboard, league, weights, 15, context && context.coveredWeeks.length > 0 ? { context, byeWeeks } : undefined);
      league.waiverBids = cache.bids;
      league.waiverGrades = cache.grades;
    }
  } catch (error) {
    console.error("[dashboard-build] waiver bids failed", error);
  }
  // Publish guard: an incomplete build must not replace a complete cached
  // snapshot (see assertDashboardBuildPublishable). Throws before any
  // telemetry write or cache publish; callers fall back to the snapshot.
  assertDashboardBuildPublishable({
    requireComplete: options?.requireComplete === true,
    rosterFetchFailedLeagueIds,
    protectedLeagueIds: options?.protectedLeagueIds,
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
 * back to the stored snapshot — decided by the viewer's Supabase user id
 * (`OWNER_USER_ID`), never by the caller-chosen linked Sleeper id. Any other
 * miss propagates (→ 500 at the route).
 *
 * `fetchedAtMs` is 0 for those fallbacks so the response cache does not
 * store them as a fresh build. Only a finished build is timestamped now.
 */
export async function loadOrBuildUserDashboard(
  sleeperUserId: string,
  force = false,
  viewerUserId: string | null = null,
): Promise<{ dashboard: Dashboard; fetchedAtMs: number; fellBack: boolean }> {
  const cached = await readUserDashboardCache(sleeperUserId);
  const cachedDashboard = cached?.dashboard ?? null;
  if (!force && cachedDashboard && cached?.fresh) {
    return {
      dashboard: cachedDashboard,
      fetchedAtMs: responseCacheFetchedAtMs("fresh", Date.now(), cached.fetchedAtMs),
      fellBack: false,
    };
  }

  // A user-pressed refresh (force) gets one build retry before falling
  // back: Sleeper is effectively always reachable, so a resync should not
  // fail on a single bad build. Background loads keep one attempt — the
  // next section poll kicks another build anyway. Both attempts share
  // ONE request deadline (the build budget inside the function's
  // maxDuration): two stacked 55s windows could exceed the 60s platform
  // cap and the client's deadline, and the request would die before
  // reaching the fallback below. A retry with too little budget left
  // does not start (see buildRetryBudgetMs).
  const maxBuildAttempts = force ? 2 : 1;
  const requestDeadlineAtMs = Date.now() + BUILD_DEADLINE_MS;
  let buildError: unknown;
  for (let attempt = 0; attempt < maxBuildAttempts; attempt += 1) {
    const budgetMs = buildRetryBudgetMs({ requestDeadlineAtMs, nowMs: Date.now(), attempt });
    if (budgetMs === null) break;
    try {
      const built = await buildUserDashboardUnderLease(sleeperUserId, force, cached?.fetchedAtMs ?? 0, budgetMs);
      return {
        dashboard: built.dashboard,
        // A fresh row found at lease recheck keeps its real fetchedAt: stamping
        // it "now" would restart the absolute freshness deadline.
        fetchedAtMs: built.recheck
          ? responseCacheFetchedAtMs("fresh", Date.now(), built.fetchedAtMs)
          : responseCacheFetchedAtMs("built", Date.now()),
        fellBack: false,
      };
    } catch (error) {
      buildError = error;
      // A build that hit its deadline still holds the lease while it
      // settles, so a retry could only join it and burn what is left of
      // the request budget. Go straight to the fallback instead.
      if (error instanceof BuildDeadlineError) break;
    }
  }

  // The build failed (or the publish guard refused an incomplete build).
  // Serve the fallback, but report it as one: the route surfaces
  // `fellBack` so a forced refresh can tell the user the resync failed
  // instead of silently presenting the stale snapshot as fresh.
  if (cachedDashboard) {
    return { dashboard: cachedDashboard, fetchedAtMs: responseCacheFetchedAtMs("fallback", Date.now()), fellBack: true };
  }
  const ownerUserId = readOwnerUserId();
  if (ownerUserId && viewerUserId === ownerUserId) {
    const snapshot = await readGlobalDashboardSnapshot();
    if (snapshot) {
      return { dashboard: snapshot, fetchedAtMs: responseCacheFetchedAtMs("fallback", Date.now()), fellBack: true };
    }
  }
  throw buildError;
}

async function upsertSourceCacheRow(
  cacheKey: string,
  payload: string,
  fetchedAt: Date,
  writer: Pick<BuildPublicationTransaction, "insert"> = db,
): Promise<void> {
  sampleCacheBytes("dashboard.snapshot.write.bytes", Buffer.byteLength(payload, "utf8"));
  await writer
    .insert(schema.sourceCache)
    .values({ cacheKey, payload, fetchedAt })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload, fetchedAt },
    });
}

function sectionTtlMs(live: boolean): number {
  return live ? LIVE_DASHBOARD_CACHE_MS : USER_DASHBOARD_CACHE_MS;
}

export function parseStoredSectionData<S extends DashboardCacheSection>(
  section: S,
  data: unknown,
): DashboardSectionCacheData[S] | null {
  switch (section) {
    case "meta": {
      const parsed = dashboardMetaSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "team": {
      const parsed = dashboardTeamCacheSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "players": {
      // Accept slim cache rows that omit weeklyChartRankings.
      const withWeekly = data && typeof data === "object" && !Array.isArray(data)
        ? {
            ...(data as Record<string, unknown>),
            weeklyChartRankings:
              (data as { weeklyChartRankings?: unknown }).weeklyChartRankings
              ?? (data as { rankings?: unknown }).rankings
              ?? [],
          }
        : data;
      const parsed = dashboardPlayersSchema.safeParse(withWeekly);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "league": {
      const parsed = dashboardLeagueCacheSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "analytics": {
      const parsed = dashboardAnalyticsCacheSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "trade": {
      const parsed = dashboardTradeCacheSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    case "trade-waiver": {
      const parsed = dashboardTradeWaiverCacheSchema.safeParse(data);
      return (parsed.success ? parsed.data : null) as DashboardSectionCacheData[S] | null;
    }
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export function sectionCacheTtlMs(live: boolean): number {
  return sectionTtlMs(live);
}

async function writeUserDashboardCache(
  cacheKey: string, dashboard: Dashboard, lease?: { resource: string; holder: string },
): Promise<void> {
  const fetchedAt = new Date();
  const live = dashboardSnapshotIsLive(dashboard);
  const writes = buildDashboardCacheWrites({
    cacheKey,
    dashboard,
    fetchedAt,
    live,
    encode: encodeSourceCachePayload,
    serializeFull: serializeDashboardForCache,
  });
  const persist = async (tx: BuildPublicationTransaction) => {
    for (const row of writes) await upsertSourceCacheRow(row.cacheKey, row.payload, row.fetchedAt, tx);
  };
  if (lease) await publishUnderBuildLease(lease.resource, lease.holder, persist);
  else await db.transaction(persist);
  // Postgres is canonical; personalized bodies are never published to Runtime Cache.

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

async function readFullUserDashboardRow(
  sleeperUserId: string,
): Promise<{ dashboard: Dashboard; fresh: boolean; fetchedAt: Date } | null> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, userDashboardCacheKey(sleeperUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  countCacheMetric("dashboard.snapshot.payload_read");
  sampleCacheBytes("dashboard.snapshot.read.bytes", Buffer.byteLength(row.payload, "utf8"));
  const dashboard = parseUsableDashboard(row.payload);
  if (!dashboard) return null;
  return {
    dashboard,
    fetchedAt: row.fetchedAt,
    fresh: Date.now() - row.fetchedAt.getTime() < dashboardCacheTtlMs(dashboard),
  };
}

export async function readAllUserDashboardSections(
  sleeperUserId: string,
): Promise<{ dashboard: Dashboard; fresh: boolean; fetchedAtMs: number; live: boolean } | null> {
  const keys = DASHBOARD_CACHE_SECTIONS.map((section) =>
    userDashboardSectionCacheKey(sleeperUserId, section),
  );
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(inArray(schema.sourceCache.cacheKey, keys));
  countCacheMetric("dashboard.snapshot.payload_read");
  for (const row of rows) {
    sampleCacheBytes("dashboard.snapshot.read.bytes", Buffer.byteLength(row.payload, "utf8"));
  }
  return dashboardFromSectionRows({
    sleeperUserId,
    rows,
    decode: decodeSourceCachePayload,
    parseSectionData: parseStoredSectionData,
    ttlMs: sectionTtlMs,
  });
}

/**
 * Read the per-user cache without building. Prefers per-section rows; falls
 * back to the legacy full `dashboard:user:<id>` row. `fresh` follows the
 * 10 min / 150s-live TTL. Returns null when no usable cache exists.
 */
export async function readUserDashboardCache(
  sleeperUserId: string,
): Promise<{ dashboard: Dashboard; fresh: boolean; fetchedAtMs: number; live: boolean } | null> {
  const fromSections = await readAllUserDashboardSections(sleeperUserId);
  if (fromSections) return fromSections;
  const full = await readFullUserDashboardRow(sleeperUserId);
  if (!full) return null;
  return {
    dashboard: full.dashboard,
    fresh: full.fresh,
    fetchedAtMs: full.fetchedAt.getTime(),
    live: dashboardSnapshotIsLive(full.dashboard),
  };
}

export type UserDashboardFreshness = {
  fresh: boolean;
  live: boolean;
  fetchedAtMs: number;
  version: string | null;
};

/**
 * Cheap freshness probe: reads the tiny `meta` section row only — no
 * section payloads — and answers version/live/fetchedAt, which is all a
 * caller needs to decide between serving and rebuilding. Falls back to a
 * `fetched_at`-only read of the legacy full key (metadata, no payload);
 * without an envelope its live flag is unknowable, so it reports
 * `fresh: false` and lets the caller do the single payload read that then
 * follows.
 */
export async function readUserDashboardFreshness(
  sleeperUserId: string,
): Promise<UserDashboardFreshness | null> {
  const metaRows = await db
    .select({ payload: schema.sourceCache.payload, fetchedAt: schema.sourceCache.fetchedAt })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, userDashboardSectionCacheKey(sleeperUserId, "meta")))
    .limit(1);
  const meta = metaRows[0];
  if (meta) {
    countCacheMetric("dashboard.snapshot.payload_read");
    sampleCacheBytes("dashboard.snapshot.read.bytes", Buffer.byteLength(meta.payload, "utf8"));
    try {
      const envelope = parseSectionEnvelope(decodeSourceCachePayload(meta.payload));
      if (envelope) {
        const fetchedAtMs = meta.fetchedAt.getTime();
        return {
          fresh: Date.now() - fetchedAtMs < sectionTtlMs(envelope.live),
          live: envelope.live,
          fetchedAtMs,
          version: envelope.version,
        };
      }
    } catch {
      // Corrupt meta row: fall through to the legacy probe.
    }
  }
  countCacheMetric("dashboard.snapshot.metadata_read");
  const fullRows = await db
    .select({ fetchedAt: schema.sourceCache.fetchedAt })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, userDashboardCacheKey(sleeperUserId)))
    .limit(1);
  const full = fullRows[0];
  if (!full) return null;
  return { fresh: false, live: false, fetchedAtMs: full.fetchedAt.getTime(), version: null };
}

export type UserDashboardSectionHit<S extends DashboardCacheSection> = {
  data: S extends "team" ? DashboardTeamApiData : DashboardSectionCacheData[S];
  fresh: boolean;
  source: "section" | "full-row";
  version: string;
  live: boolean;
  fetchedAtMs: number;
};

/**
 * Read a single dashboard section row. Falls back to projecting from the
 * legacy full-row cache when the section key is missing. Does not merge the
 * trade row into team (callers that need trade fields load `trade` separately
 * or use the full-row fallback which still includes them).
 */
export async function readUserDashboardSection<S extends DashboardCacheSection>(
  sleeperUserId: string,
  section: S,
): Promise<UserDashboardSectionHit<S> | null> {
  const sectionKey = userDashboardSectionCacheKey(sleeperUserId, section);
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, sectionKey))
    .limit(1);
  countCacheMetric("dashboard.snapshot.payload_read");
  for (const row of rows) {
    sampleCacheBytes("dashboard.snapshot.read.bytes", Buffer.byteLength(row.payload, "utf8"));
  }
  const fromSection = resolveSectionHitFromRows({
    section,
    sectionRow: rows[0] ?? null,
    fullDashboard: null,
    fullFresh: false,
    decode: decodeSourceCachePayload,
    parseSectionData: parseStoredSectionData,
    ttlMs: sectionTtlMs,
  });
  if (fromSection) return fromSection;

  const full = await readFullUserDashboardRow(sleeperUserId);
  return resolveSectionHitFromRows({
    section,
    sectionRow: null,
    fullDashboard: full?.dashboard ?? null,
    fullFresh: full?.fresh ?? false,
    fullFetchedAt: full?.fetchedAt ?? null,
    decode: decodeSourceCachePayload,
    parseSectionData: parseStoredSectionData,
    ttlMs: sectionTtlMs,
  });
}

// Single-flight guards. The tracker dedupes within one function instance and
// records each build's outcome so section responses can report a structured
// status instead of silently dropping background failures; the DB lease
// (`build_leases`) dedupes across instances so a burst of cold starts still
// produces one build per user.
const buildTracker = createDashboardBuildTracker();

/** Structured status of the user's latest background build, if any ran here. */
export function userDashboardBuildStatus(sleeperUserId: string): DashboardBuildState | null {
  return buildTracker.status(sleeperUserId);
}

/**
 * Build the dashboard under the deployment-wide lease. When another instance
 * already holds the lease this waits for that build's cache write instead of
 * starting a second build; a lease that expires without a fresh cache row
 * surfaces as an error so the caller falls back to its stale data.
 */
async function buildUserDashboardUnderLease(
  sleeperUserId: string,
  force: boolean,
  cachedFetchedAtMs: number,
  // The caller's remaining request budget. A retrying caller passes what
  // is left of the ONE shared deadline so two attempts can never stack
  // into two full build windows (see buildRetryBudgetMs).
  budgetMs: number = BUILD_DEADLINE_MS,
): Promise<{ dashboard: Dashboard; fetchedAtMs: number; recheck: boolean }> {
  const resource = dashboardBuildLeaseResource(sleeperUserId);
  const holder = crypto.randomUUID();
  countCacheMetric("dashboard.build.start");
  const outcome = await runWithBuildLease(
    drizzleBuildLeaseStore,
    resource,
    holder,
    BUILD_LEASE_TTL_MS,
    async () => {
      // Recheck after winning the lease: another instance may have written a
      // fresh row between our first read and the claim. The probe reads the
      // tiny meta row only — no section payloads — and the full read runs
      // solely when there is actually a fresh snapshot to return.
      if (!force && (await readUserDashboardFreshness(sleeperUserId))?.fresh) {
        const recheck = await readUserDashboardCache(sleeperUserId);
        if (recheck?.fresh) {
          return { dashboard: recheck.dashboard, fetchedAtMs: recheck.fetchedAtMs, recheck: true };
        }
      }
      // Align soft actuals waits with this lease wait (same budget window).
      const deadlineAtMs = Date.now() + budgetMs;
      // The publish guard protects the leagues the existing snapshot
      // actually holds; a league joined since is not in it.
      const existing = cachedFetchedAtMs > 0 ? await readUserDashboardCache(sleeperUserId) : null;
      const dashboard = await buildUserDashboard(sleeperUserId, force, {
        deadlineAtMs,
        // A cached snapshot exists (the caller read one before leasing):
        // never let an incomplete build overwrite it.
        requireComplete: cachedFetchedAtMs > 0,
        protectedLeagueIds: existing?.dashboard.leagues.map((league) => league.id),
      });
      // Ownership is locked and all section writes commit atomically.
      await writeUserDashboardCache(userDashboardCacheKey(sleeperUserId), dashboard, { resource, holder });
      return { dashboard, fetchedAtMs: Date.now(), recheck: false };
    },
    // On timeout the build keeps the lease until it settles, so a retry
    // can't start a second build alongside it.
    { deadlineMs: budgetMs },
  );
  if (outcome.status === "built") {
    countCacheMetric("dashboard.build.done");
    return outcome.result;
  }
  if (outcome.status === "failed") {
    countCacheMetric("dashboard.build.failed");
    waitUntil(outcome.released);
    throw outcome.error;
  }
  // "joined": another instance is building. Wait for its cache write (it
  // already lands in the cache, so this caller must not rewrite it).
  const joined = await waitForFreshDashboardCache(
    sleeperUserId,
    cachedFetchedAtMs,
    budgetMs,
    resource,
  );
  if (!joined) {
    throw new Error("dashboard build in progress elsewhere");
  }
  return { dashboard: joined.dashboard, fetchedAtMs: joined.fetchedAtMs, recheck: true };
}

/**
 * Poll for a cache row newer than `sinceMs` until the deadline elapses.
 * Returns early when the lease holder finishes without producing a fresh
 * row (a failed build should not stall the caller for the whole deadline).
 */
async function waitForFreshDashboardCache(
  sleeperUserId: string,
  sinceMs: number,
  deadlineMs: number,
  resource: string,
): Promise<{ dashboard: Dashboard; fetchedAtMs: number } | null> {
  const deadlineAt = Date.now() + deadlineMs;
  while (Date.now() < deadlineAt) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      // Poll the tiny meta row, not the section payloads: the loop runs up
      // to once a second for the whole deadline.
      const probe = await readUserDashboardFreshness(sleeperUserId);
      if (probe?.fresh && probe.fetchedAtMs > sinceMs) {
        const cached = await readUserDashboardCache(sleeperUserId);
        if (cached?.fresh && cached.fetchedAtMs > sinceMs) {
          return { dashboard: cached.dashboard, fetchedAtMs: cached.fetchedAtMs };
        }
      }
      countCacheMetric("dashboard.snapshot.metadata_read");
      const lease = await drizzleBuildLeaseStore.read(resource);
      if (!lease || lease.status !== "running") {
        // The holder writes the cache, then releases: re-read once so a
        // build that landed between the two reads above isn't missed.
        const final = await readUserDashboardCache(sleeperUserId);
        return final?.fresh && final.fetchedAtMs > sinceMs
          ? { dashboard: final.dashboard, fetchedAtMs: final.fetchedAtMs }
          : null;
      }
    } catch {
      // Transient read failure; keep polling until the deadline.
    }
  }
  return null;
}

/**
 * Start (or join) a background build for this user that caches its result
 * when done. Never rejects — pair with `waitUntil` at the route so Vercel
 * keeps the function alive until the cache write lands. Section reads use
 * this so a cold cache answers immediately with "no data yet" while the
 * first build (~30s) runs behind the response. A failure is recorded on the
 * tracker (read it back via `userDashboardBuildStatus`) and reported to
 * server telemetry instead of being discarded; it is not rebuilt until it
 * expires or the caller passes `retryFailed` (the client's explicit retry).
 *
 * The DB lease means a request landing on a different instance does not
 * start a duplicate build; another instance's build in progress counts as
 * no failure here.
 */
export function kickUserDashboardBuild(
  sleeperUserId: string,
  options?: { retryFailed?: boolean },
): Promise<void> {
  return buildTracker.kick(
    sleeperUserId,
    async () => {
      const resource = dashboardBuildLeaseResource(sleeperUserId);
      const holder = crypto.randomUUID();
      const outcome = await runWithBuildLease(
        drizzleBuildLeaseStore,
        resource,
        holder,
        BUILD_LEASE_TTL_MS,
        async () => {
          // Recheck after winning the lease (see buildUserDashboardUnderLease).
          const freshness = await readUserDashboardFreshness(sleeperUserId);
          if (freshness?.fresh) {
            const recheck = await readUserDashboardCache(sleeperUserId);
            if (recheck?.fresh) {
              return recheck.dashboard;
            }
          }
          const deadlineAtMs = Date.now() + BUILD_DEADLINE_MS;
          const existing = freshness !== null ? await readUserDashboardCache(sleeperUserId) : null;
          const dashboard = await buildUserDashboard(sleeperUserId, false, {
            deadlineAtMs,
            // Any existing snapshot (fresh or stale) is worth protecting
            // from an incomplete build; a cold build publishes partial.
            requireComplete: freshness !== null,
            protectedLeagueIds: existing?.dashboard.leagues.map((league) => league.id),
          });
          await writeUserDashboardCache(userDashboardCacheKey(sleeperUserId), dashboard, { resource, holder });
          return dashboard;
        },
        { deadlineMs: BUILD_DEADLINE_MS },
      );
      if (outcome.status === "failed") {
        // Stay in flight (and inside the route's waitUntil) until a timed-out
        // build really stops, so this instance doesn't start another one.
        await outcome.released;
        throw outcome.error;
      }
    },
    (error, jobId) => {
      console.error("[dashboard-build] background build failed", { jobId, sleeperUserId, error });
      void captureServerError(error, { route: "dashboard-build", job: "user-dashboard", jobId });
    },
    { retryFailed: options?.retryFailed },
  );
    }
