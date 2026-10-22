import type { Dashboard } from "./dashboard-types";

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
