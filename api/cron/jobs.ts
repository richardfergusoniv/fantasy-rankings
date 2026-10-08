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
  refreshFantasyCalcCache,
  writeGlobalDashboardSnapshot,
} from "../_lib/dashboard-build.js";
import { withDeadline } from "../_lib/sleeper.js";

/**
 * GET /api/cron/jobs?job=rebuild-dashboard | refresh-fantasycalc
 *
 * One function for the two scheduled jobs (Vercel's 12-function budget).
 * Vercel Cron invokes with GET; auth is `Authorization: Bearer <CRON_SECRET>`
 * (same secret the pipeline webhooks use).
 *
 * - rebuild-dashboard: rebuilds the owner's dashboard and writes it as the
 *   global snapshot served to unauthenticated /api/dashboard reads.
 *   Schedule this AFTER the daily props pull and the fantasycalc refresh so
 *   the snapshot lands on the freshest inputs.
 * - refresh-fantasycalc: refreshes the daily FantasyCalc preset cache that
 *   dashboard builds read instead of hitting the FantasyCalc API 12x each.
 */

const OWNER_SLEEPER_USER_ID = "739931264659927040";

async function handleRebuildDashboard(): Promise<Response> {
  const buildPromise = buildUserDashboard(OWNER_SLEEPER_USER_ID);
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

export async function GET(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) return forbidden("Invalid or missing cron secret.");
  const url = new URL(req.url, "https://localhost");
  const job = url.searchParams.get("job");
  try {
    if (job === "rebuild-dashboard") return await handleRebuildDashboard();
    if (job === "refresh-fantasycalc") return await handleRefreshFantasyCalc();
    return badRequest("Unknown or missing `job` param. Expected rebuild-dashboard or refresh-fantasycalc.");
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["GET"]);
}
