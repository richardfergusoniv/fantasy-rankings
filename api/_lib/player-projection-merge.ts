/**
 * Weekly skill-player projection merge: Vegas primary, First Down gap-fill,
 * Sleeper last-resort. Kept free of DB imports so unit tests can drive it.
 */

import { z } from "zod";
import { rankingSchema } from "./dashboard-schemas.js";
import { selectProjectionFeed } from "./projection-fallback.js";
import {
  canonicalTeam,
  isUnavailableForCurrentWeek,
  normalizePosition,
  normalizedPlayerName,
  scoreProjectedPlayerStats,
} from "./sleeper.js";

export const MIN_VEGAS_PLAYER_COVERAGE = 200;
export const MIN_FIRST_DOWN_PLAYER_COVERAGE = 150;

type Ranking = z.infer<typeof rankingSchema>;

export type SleeperProjection = {
  player_id?: string;
  team?: string;
  player?: { position?: string };
  stats?: Record<string, number> & { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number };
};

const vegasPlayerProjectionSchema = z.object({
  player: z.string(),
  team: z.string(),
  position: z.string(),
  opponent: z.string().nullable(),
  expected_stats: z.record(z.string(), z.number()),
  td_probability: z.union([z.number(), z.record(z.string(), z.number())]).nullable(),
  coverage: z.object({
    stats: z.union([z.number(), z.array(z.string()), z.record(z.string(), z.number())]),
    provider_count: z.number(),
    book_count: z.number(),
  }),
  leagues: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.record(z.string(), z.number())),
});

export const projectionSnapshotSchema = z.object({
  season: z.number(),
  week: z.number(),
  built_at: z.string(),
  source: z.string(),
  leagues: z.array(z.object({ league_id: z.string(), name: z.string() })),
  projections: z.array(vegasPlayerProjectionSchema),
});

export type ProjectionSnapshot = z.infer<typeof projectionSnapshotSchema>;
type FeedRow = ProjectionSnapshot["projections"][number];

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

export function scoreSleeperPlayerProjection(
  position: Ranking["position"],
  stats: Record<string, number> | undefined,
  settings: Record<string, number> | undefined,
): number | null {
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

type ProjectionFeedMaps = {
  feedByPlayer: Map<string, FeedRow>;
  feedByNamePosition: Map<string, FeedRow[]>;
};

function buildProjectionFeedMaps(snapshot: ProjectionSnapshot | null): ProjectionFeedMaps {
  const feedByPlayer = new Map<string, FeedRow>();
  const feedByNamePosition = new Map<string, FeedRow[]>();
  for (const projection of snapshot?.projections ?? []) {
    const position = normalizePosition(projection.position);
    const exactKey = `${normalizedPlayerName(projection.player)}:${canonicalTeam(projection.team)}:${position}`;
    feedByPlayer.set(exactKey, projection);
    const namePositionKey = `${normalizedPlayerName(projection.player)}:${position}`;
    const nameMatches = feedByNamePosition.get(namePositionKey) ?? [];
    nameMatches.push(projection);
    feedByNamePosition.set(namePositionKey, nameMatches);
  }
  return { feedByPlayer, feedByNamePosition };
}

/**
 * Whether a stored projection board is usable as the primary weekly source.
 *
 * - First Down: keep the existing 150-player floor (never a kickers-only board).
 * - Vegas (including thin early-week boards): usable when at least one non-K
 *   player is present. Empty / kickers-only files stay rejected so they never
 *   overwrite a healthy primary.
 */
export function projectionBoardIsUsable(snapshot: ProjectionSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.source === "first_down") {
    return snapshot.projections.length >= MIN_FIRST_DOWN_PLAYER_COVERAGE;
  }
  return snapshot.projections.some((row) => row.position !== "K");
}

/** Non-K player count — used by the props workflow's partial-Vegas guard. */
export function nonKickerProjectionCount(snapshot: { projections: Array<{ position: string }> }): number {
  return snapshot.projections.filter((row) => row.position !== "K").length;
}

export function mergePlayerProjections(
  leagueId: string,
  rankingField: "ppr" | "halfPpr",
  baseRows: Ranking[],
  snapshot: ProjectionSnapshot | null,
  fallbackSnapshot: ProjectionSnapshot | null,
  usePrimaryBoard: boolean,
  sleeperProjectionsByPlayerId: Map<string, SleeperProjection>,
  scoringSettings: Record<string, number> | undefined,
): Ranking[] {
  const { feedByPlayer, feedByNamePosition } = buildProjectionFeedMaps(snapshot);
  const fallbackMaps = fallbackSnapshot ? buildProjectionFeedMaps(fallbackSnapshot) : null;

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
    const feed = selectProjectionFeed(
      feedByPlayer.get(exactKey),
      feedByNamePosition.get(`${normalizedPlayerName(base.name)}:${base.position}`) ?? [],
      canonicalTeam(base.team ?? ""),
      (row) => row.team ? canonicalTeam(row.team) : "",
    );
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
    if (usePrimaryBoard && feed && isFirstDownSnapshot) {
      const stagedPoints = feed.leagues[leagueId] ?? feed.expected_stats.projected_points;
      leaguePoints = typeof stagedPoints === "number" && Number.isFinite(stagedPoints) ? stagedPoints : null;
    } else if (usePrimaryBoard && feed) {
      const scorerStats = adaptVegasStatsForScorer(base.position, feed.expected_stats, feed.td_probability);
      // An empty stat line is not a projection: scoring it yields 0 and
      // would block the First Down gap-fill below. Leave leaguePoints
      // unset so the fallback can run.
      if (Object.keys(scorerStats).length > 0) {
        leaguePoints = scoreProjectedPlayerStats(base.position, scorerStats, scoringSettings, { recFdProxy: true });
      }
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

    // First Down gap-fill (Richard's policy: the backup is used for
    // whatever the primary board does not cover). The Vegas feed has no
    // usable row for this player, but the week's First Down snapshot
    // does: use its staged per-league total verbatim — points-only by
    // contract — and tag the row with its real source.
    if (usePrimaryBoard && fallbackMaps) {
      const fdFeed = selectProjectionFeed(
        fallbackMaps.feedByPlayer.get(exactKey),
        fallbackMaps.feedByNamePosition.get(`${normalizedPlayerName(base.name)}:${base.position}`) ?? [],
        canonicalTeam(base.team ?? ""),
        (row) => row.team ? canonicalTeam(row.team) : "",
      );
      if (fdFeed) {
        const stagedPoints = fdFeed.leagues[leagueId] ?? fdFeed.expected_stats.projected_points;
        if (typeof stagedPoints === "number" && Number.isFinite(stagedPoints)) {
          const fdTeam = fdFeed.team ? canonicalTeam(fdFeed.team) : null;
          const fdTeamCompatible = fdTeam !== null && fdTeam === baseTeam;
          return [{
            ...base,
            leagueId,
            team: fdTeamCompatible ? fdTeam : base.team,
            opponent: fdTeamCompatible && fdFeed.opponent ? canonicalTeam(fdFeed.opponent) : base.opponent,
            ppr: rankingField === "ppr" ? stagedPoints : base.ppr,
            halfPpr: rankingField === "halfPpr" ? stagedPoints : base.halfPpr,
            leagueProjection: stagedPoints,
            vegasProjection: null,
            sleeperProjection: validSleeperPoints,
            projectionSource: "first_down",
            projectionComponents: null,
          }];
        }
      }
    }

    // Sleeper last-resort: missing from Vegas and First Down, but still has a
    // league-scored Sleeper projection (same path kickers use). Unavailable
    // players already returned 0 above.
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

    // Keep the player visible with schedule context when no source has a
    // projection. Never revive a prior-week row.
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
      .sort((a, b) => (b.leagueProjection ?? -Infinity) - (a.leagueProjection ?? -Infinity) || a.name.localeCompare(b.name));
    group.forEach((row, index) => {
      row.leagueRank = index + 1;
      if (rankingField === "ppr") row.pprRank = index + 1;
      else row.halfPprRank = index + 1;
    });
  }
  return merged;
}

/**
 * Re-rank one league's rows after actuals are stamped. A player whose game
 * is final is ranked on his actual points; everyone else keeps his league
 * projection — one shared scale, so a final player who outscored the
 * remaining projections tops his position group and one who underscored
 * drops below them. Live games keep the projection rank so the order does
 * not churn mid-game. Mirrors the merge's ordering (value desc, name asc)
 * and writes the same fields (leagueRank + the league's lens rank).
 */
export function applyActualRanks(rows: Ranking[], rankingField: "ppr" | "halfPpr"): void {
  const effectiveValue = (row: Ranking): number => (row.gamePhase === "final" && typeof row.actual === "number" && Number.isFinite(row.actual)
    ? row.actual
    : row.leagueProjection ?? Number.NEGATIVE_INFINITY);
  for (const position of ["QB", "RB", "WR", "TE", "K"] as const) {
    const group = rows
      .filter((row) => row.position === position)
      .sort((a, b) => effectiveValue(b) - effectiveValue(a) || a.name.localeCompare(b.name));
    group.forEach((row, index) => {
      row.leagueRank = index + 1;
      if (rankingField === "ppr") row.pprRank = index + 1;
      else row.halfPprRank = index + 1;
    });
  }
}
