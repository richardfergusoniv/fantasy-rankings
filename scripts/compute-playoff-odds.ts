/**
 * Playoff odds precompute. Run by the "Playoff odds precompute" GitHub
 * Actions workflow, NOT by a Vercel function, so the 20,000-trial Monte Carlo
 * spends Actions minutes instead of Fluid Active CPU.
 *
 * For every linked Sleeper user and each league on their cached dashboard it
 * runs the same loadProjectedStandings + playoffOddsFromProjections the app
 * serves live, and stores the pair (api/_lib/playoff-odds-store.ts). Readers
 * serve the stored pair while it is fresh and fall back to computing live, so
 * this job only needs to be roughly timely, never exactly on time.
 *
 * Requires DATABASE_URL (the same connection string the app uses).
 */
import { readUserDashboardCache } from "../api/_lib/dashboard-build.js";
import { db, schema } from "../api/_lib/db.js";
import { PLAYOFF_ODDS_STORE_TTL_MS, storePlayoffOdds } from "../api/_lib/playoff-odds-store.js";
import { playoffOddsFromProjections } from "../api/_lib/projected-playoff-odds.js";
import { loadProjectedStandings } from "../api/_lib/projected-standings.js";

async function main(): Promise<number> {
  const connections = await db.select().from(schema.sleeperConnections);
  const userIds = [...new Set(connections.map((row) => row.sleeperUserId))];
  let computed = 0;
  let skipped = 0;
  let failed = 0;
  for (const sleeperUserId of userIds) {
    const cached = await readUserDashboardCache(sleeperUserId).catch(() => null);
    if (!cached) {
      skipped += 1;
      continue;
    }
    const { dashboard } = cached;
    // Never publish odds computed from a snapshot older than the freshness
    // the stored record claims: readers trust computedAt for the store TTL,
    // so an older source snapshot would be served as fresh long past its
    // real age. Skipped users fall back to the live compute on their next
    // visit, same as a store miss.
    if (Date.now() - cached.fetchedAtMs > PLAYOFF_ODDS_STORE_TTL_MS) {
      skipped += dashboard.leagues.length;
      console.log(`skip user ${sleeperUserId}: dashboard snapshot is stale`);
      continue;
    }
    for (const league of dashboard.leagues) {
      try {
        const projected = await loadProjectedStandings(league, dashboard.season, dashboard.week);
        if ("error" in projected) {
          skipped += 1;
          console.log(`skip league ${league.id} for user ${sleeperUserId}: ${projected.error}`);
          continue;
        }
        const odds = playoffOddsFromProjections(projected);
        await storePlayoffOdds(sleeperUserId, league.id, {
          season: dashboard.season,
          week: dashboard.week,
          computedAt: new Date().toISOString(),
          projected,
          odds,
        });
        computed += 1;
      } catch (error) {
        failed += 1;
        console.error(`failed league ${league.id} for user ${sleeperUserId}:`, error);
      }
    }
  }
  console.log(`playoff odds precompute: ${computed} computed, ${skipped} skipped, ${failed} failed, ${userIds.length} users`);
  // Fail the run only when nothing at all could be computed despite trying.
  return computed === 0 && failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
