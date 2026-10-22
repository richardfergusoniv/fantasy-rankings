import type { Dashboard } from "./dashboard-types";

type PlayerInsights = Dashboard["playerInsights"];

/** Expert ranks older than this, relative to the dashboard, are last week's and are hidden. */
export const EXPERT_RANKS_MAX_AGE_DAYS = 7;

/**
 * This week's FantasyPros ranks, or null when there are none or the scrape is
 * stale (a failed refresh across a weekly rollover keeps the old snapshot).
 */
export function currentExpertRanks(
  insights: PlayerInsights | undefined,
  dashboardAsOf: string,
): PlayerInsights["experts"] | null {
  const experts = insights?.experts;
  if (!experts || Object.keys(experts).length === 0 || !insights?.expertsAsOf) return null;
  const scraped = Date.parse(insights.expertsAsOf);
  const asOf = Date.parse(dashboardAsOf);
  if (!Number.isFinite(scraped) || !Number.isFinite(asOf)) return null;
  return asOf - scraped <= EXPERT_RANKS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 ? experts : null;
}
