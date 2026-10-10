import {
  badRequest,
  forbidden,
  hasCronSecret,
  internalError,
  json,
  methodNotAllowed,
} from "../_lib/api-utils.js";
import {
  BUILD_DEADLINE_MS,
  buildUserDashboard,
  readGlobalDashboardSnapshot,
  refreshFantasyCalcCache,
  writeGlobalDashboardSnapshot,
} from "../_lib/dashboard-build.js";
import { readOwnerSleeperUserId } from "../_lib/auth.js";
import { withDeadline } from "../_lib/sleeper.js";
import { refreshTeamSituationalSnapshot } from "../_lib/team-situational.js";

/**
 * GET /api/cron/jobs?job=rebuild-dashboard | refresh-fantasycalc | read-dashboard-snapshot | refresh-team-situational
 *
 * One function for the scheduled jobs (Vercel's 12-function budget).
 * Vercel Cron invokes with GET; auth is `Authorization: Bearer <CRON_SECRET>`
 * (same secret the pipeline webhooks use).
 *
 * - rebuild-dashboard: rebuilds the owner's dashboard and writes the stored
 *   snapshot. Client routes do not serve that snapshot to signed-out
 *   visitors. Schedule this AFTER the daily props pull and the fantasycalc
 *   refresh so the snapshot lands on the freshest inputs.
 * - refresh-fantasycalc: refreshes the daily FantasyCalc preset cache that
 *   dashboard builds read instead of hitting the FantasyCalc API 12x each.
 * - read-dashboard-snapshot: returns the stored snapshot for the props
 *   verifier. It is not a public read; the cron secret is required, and the
 *   body is the same dashboard the rebuild just wrote.
 * - refresh-team-situational: scrapes Sportskeeda third-down / red-zone TD
 *   rates into `team-situational-stats-2026`. Requires ≥30 teams before
 *   replacing cache; keeps the last valid snapshot on failure.
 */

async function handleRebuildDashboard(): Promise<Response> {
  const ownerId = readOwnerSleeperUserId();
  if (!ownerId) {
    console.error("[cron] OWNER_SLEEPER_USER_ID is not set");
    return json({ ok: false, error: "Owner Sleeper user is not configured." }, 500);
  }
  const buildPromise = buildUserDashboard(ownerId, true);
  buildPromise.catch(() => undefined);
  const dashboard = await withDeadline(buildPromise, BUILD_DEADLINE_MS);
  await writeGlobalDashboardSnapshot(dashboard);
  return json({
    ok: true,
    job: "rebuild-dashboard",
    status: dashboard.status,
    season: dashboard.season,
    week: dashboard.week,
    leagues: dashboard.leagues.length,
    asOf: dashboard.asOf,
  });
}

async function handleRefreshFantasyCalc(): Promise<Response> {
  const result = await refreshFantasyCalcCache();
  return json({ ok: true, job: "refresh-fantasycalc", ...result });
}

async function handleReadDashboardSnapshot(): Promise<Response> {
  const dashboard = await readGlobalDashboardSnapshot();
  if (!dashboard) return json({ ok: false, error: "No stored dashboard snapshot." }, 404);
  return json({ ok: true, dashboard });
}

async function handleRefreshTeamSituational(): Promise<Response> {
  const result = await refreshTeamSituationalSnapshot();
  return json({ ok: true, job: "refresh-team-situational", ...result });
}

export async function GET(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) return forbidden("Invalid or missing cron secret.");
  const url = new URL(req.url, "https://localhost");
  const job = url.searchParams.get("job");
  try {
    if (job === "rebuild-dashboard") return await handleRebuildDashboard();
    if (job === "refresh-fantasycalc") return await handleRefreshFantasyCalc();
    if (job === "read-dashboard-snapshot") return await handleReadDashboardSnapshot();
    if (job === "refresh-team-situational") return await handleRefreshTeamSituational();
    return badRequest(
      "Unknown or missing `job` param. Expected rebuild-dashboard, refresh-fantasycalc, read-dashboard-snapshot, or refresh-team-situational.",
    );
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["GET"]);
}
