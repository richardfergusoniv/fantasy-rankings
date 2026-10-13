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
import { captureServerError } from "../_lib/posthog.js";
import {
  backfillValueHistoryBatch,
  VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT,
} from "../_lib/player-value-history.js";
import { withDeadline } from "../_lib/sleeper.js";
import { refreshTeamSituationalSnapshot } from "../_lib/team-situational.js";
import { refreshChartExtrasSnapshot } from "../_lib/nflverse-chart-extras.js";

/**
 * GET /api/cron/jobs?job=rebuild-dashboard | refresh-fantasycalc | read-dashboard-snapshot | refresh-team-situational | refresh-chart-extras | backfill-value-history
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
 *   dashboard builds read instead of hitting the FantasyCalc API 12x each,
 *   and appends today's values into `player_value_snapshots` for every
 *   ranked player in each fetched preset.
 * - read-dashboard-snapshot: returns the stored snapshot for the props
 *   verifier. It is not a public read; the cron secret is required, and the
 *   body is the same dashboard the rebuild just wrote.
 * - refresh-team-situational: scrapes Sportskeeda third-down / red-zone TD
 *   rates into `team-situational-stats-2026`. Requires ≥30 teams before
 *   replacing cache; keeps the last valid snapshot on failure.
 * - refresh-chart-extras: rebuilds compact nflverse snap / red-zone / PROE
 *   metrics for Charts presets into `nflverse-chart-extras-2026-v1`.
 * - backfill-value-history: one-time / resumable FantasyCalc history pull
 *   into `player_value_snapshots`. Fetches are sequential with retries and
 *   whole-response date validation; failed player×format ids are listed in
 *   `failedItems`. Query params: `offset` (default 0), `limit` (default 20,
 *   max 40). Repeat with `nextOffset` until `done`.
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
  // An empty rebuild (e.g. every per-league roster fetch failed) must not
  // overwrite a good owner snapshot — snapshot readers reject empty boards.
  if (dashboard.leagues.length > 0) {
    await writeGlobalDashboardSnapshot(dashboard);
  }
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
  return json({ job: "refresh-team-situational", ...result });
}

async function handleRefreshChartExtras(): Promise<Response> {
  const result = await refreshChartExtrasSnapshot();
  return json({ job: "refresh-chart-extras", ...result });
}

function parseNonNegativeInt(raw: string | null, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

async function handleBackfillValueHistory(url: URL): Promise<Response> {
  const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);
  const limit = parseNonNegativeInt(
    url.searchParams.get("limit"),
    VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT,
  );
  const result = await backfillValueHistoryBatch({ offset, limit });
  return json({ ok: true, ...result });
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
    if (job === "refresh-chart-extras") return await handleRefreshChartExtras();
    if (job === "backfill-value-history") return await handleBackfillValueHistory(url);
    return badRequest(
      "Unknown or missing `job` param. Expected rebuild-dashboard, refresh-fantasycalc, read-dashboard-snapshot, refresh-team-situational, refresh-chart-extras, or backfill-value-history.",
    );
  } catch (err) {
    await captureServerError(err, { route: "cron/jobs", job: job ?? "unknown" });
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["GET"]);
}
