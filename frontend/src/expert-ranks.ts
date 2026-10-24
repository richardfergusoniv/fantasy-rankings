import type { Dashboard, League } from "./dashboard-types";

type PlayerInsights = Dashboard["playerInsights"];

/** Slates whose last kickoffs are this close are the same NFL week (weeks are 7 days apart). */
const SAME_WEEK_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * This week's FantasyPros ranks, or null when there are none or they cover
 * another week (a failed refresh across a weekly rollover keeps the old snapshot).
 * The week is matched by the slate's last kickoff against the dashboard's last game.
 */
export function currentExpertRanks(
  dashboard: { playerInsights?: PlayerInsights; rankings: ReadonlyArray<{ gameTime: string | null }> },
): PlayerInsights["experts"] | null {
  const insights = dashboard.playerInsights;
  const experts = insights?.experts;
  if (!experts || Object.keys(experts).length === 0 || !insights?.expertsLastKickoff) return null;
  let lastGame: string | null = null;
  for (const { gameTime } of dashboard.rankings) {
    if (gameTime && (!lastGame || gameTime > lastGame)) lastGame = gameTime;
  }
  if (!lastGame) return null;
  const expertsLast = Date.parse(insights.expertsLastKickoff);
  const dashboardLast = Date.parse(lastGame);
  if (!Number.isFinite(expertsLast) || !Number.isFinite(dashboardLast)) return null;
  return Math.abs(expertsLast - dashboardLast) <= SAME_WEEK_TOLERANCE_MS ? experts : null;
}

type ScoringRow = {
  playerId: string;
  position: string;
  /** The Vegas stat line scored in canonical PPR, independent of the league's scoring. */
  vegasProjection: number | null;
  projectionComponents: Record<string, number> | null;
};

/**
 * Half-PPR points as a share of PPR points: PPR minus half a point per projected
 * reception, over PPR. The league's own points are not used because they mix in
 * its other settings (bonuses, a first-down proxy) and so are not a PPR base.
 */
function halfPprShare(row: ScoringRow): number | null {
  const receptions = row.projectionComponents?.rec;
  if (row.vegasProjection === null || row.vegasProjection <= 0 || typeof receptions !== "number" || !Number.isFinite(receptions)) return null;
  return Math.min(1, Math.max(0.5, 1 - (0.5 * receptions) / row.vegasProjection));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 1) + (sorted[mid] ?? 1)) / 2 : sorted[mid] ?? 1;
}

/**
 * FantasyPros' weekly projections come from the PPR list. For a half-PPR league
 * each projection loses half a point per projected reception (see halfPprShare);
 * a player without a Vegas stat line gets the median share for the position.
 * Players missing from `rows`, such as defenses, keep their projection, and
 * ranks stay the PPR ones.
 */
export function scaleExpertsToScoring(
  experts: PlayerInsights["experts"],
  rows: readonly ScoringRow[],
  rankingField: League["rankingField"],
): PlayerInsights["experts"] {
  if (rankingField === "ppr") return experts;
  const sharesByPosition = new Map<string, number[]>();
  const shareById = new Map<string, number | null>();
  for (const row of rows) {
    const share = halfPprShare(row);
    shareById.set(row.playerId, share);
    if (share !== null) sharesByPosition.set(row.position, [...(sharesByPosition.get(row.position) ?? []), share]);
  }
  const fallback = new Map([...sharesByPosition].map(([position, shares]) => [position, median(shares)]));
  const positionById = new Map(rows.map((row) => [row.playerId, row.position]));
  return Object.fromEntries(Object.entries(experts).map(([playerId, expert]) => {
    if (expert.projection === null || !shareById.has(playerId)) return [playerId, expert];
    const share = shareById.get(playerId) ?? fallback.get(positionById.get(playerId) ?? "") ?? 1;
    return [playerId, { ...expert, projection: Number((expert.projection * share).toFixed(2)) }];
  }));
}

/** This week's expert ranks with projections in the league's scoring. */
export function leagueExpertRanks(
  dashboard: { playerInsights?: PlayerInsights; rankings: ReadonlyArray<ScoringRow & { leagueId: string; gameTime: string | null }> },
  league: Pick<League, "id" | "rankingField">,
): PlayerInsights["experts"] | null {
  const experts = currentExpertRanks(dashboard);
  if (!experts) return null;
  return scaleExpertsToScoring(experts, dashboard.rankings.filter((row) => row.leagueId === league.id), league.rankingField);
}
