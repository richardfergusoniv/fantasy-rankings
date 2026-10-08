# Phase 2 Status: Server Action Adaptation

**Started:** 2026-09-30  
**Scope:** Adapt Hatch server actions → Vercel API routes (per ANALYSIS.md §5, §10)

---

## ✅ Completed: Read-only routes

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `GET /api/dashboard` | `api/dashboard.ts` | `getDashboard` + `getCachedDashboard` | Signed-in Sleeper users get their own dashboard. `force=true` with no resolved Sleeper user returns 401. Other unsigned reads return the global snapshot. |
| `GET /api/dashboard/section` | `api/dashboard.ts` | `getDashboardSection` | `vercel.json` rewrites this path to `?__section=1`. Sections: meta, team, players, league, analytics. |
| `GET /api/pfn-tables` | `api/pfn-tables.ts` | `getpfntables` | Includes team-situational snapshot |
| `GET /api/player-news` | `api/player-news.ts` | `getPlayerNews` | GET reads stored news. GET or POST with `CRON_SECRET` runs the refresh. |
| `GET /api/trades/history` | `api/trades/history.ts` | `getHistoricalTrades` | Full Sleeper chain logic; `maxDuration: 60` |
| `GET /api/draft-center` | `api/draft-center.ts` | `getDraftCenter` | FFC/MFL ADP, Sleeper trending, live drafts; betting fetches (Polymarket/Kalshi/Action Network) removed per UI removal |
| `GET /api/boom-bust/ranges` | `api/boom-bust/[type].ts` | `getBoomBustRanges` | Query: leagueId, position, playerIds (CSV, 1–24) |
| `GET /api/boom-bust/history` | `api/boom-bust/[type].ts` | `getBoomBustHistory` | Same file. Query: leagueId, playerId, position, view (season\|last3) |
| `GET /api/value-history` | `api/value-history.ts` | `getValueHistory` | Query: formatKey, playerIds (CSV, max 24); FantasyCalc backfill |
| `GET /api/box-score` | `api/box-score.ts` | `getMatchupBoxScore` | Admin-only; ESPN public scoreboard API; query: team, opponent, season, week |

## ✅ Completed: Ingest webhooks (3)

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `POST /api/ingest/projections` | `api/ingest/[target].ts` | `ingeststagedprojections` | Accepts staged JSON in POST body; `CRON_SECRET` auth |
| `POST /api/ingest/matchup-grades` | `api/ingest/[target].ts` | `ingeststagedmatchupgrades` | Per-league SoS upsert; skips stale |
| `POST /api/ingest/pfn-tables` | `api/ingest/[target].ts` | `ingeststagedpfntables` | Writes 4 `pfn:*` cache rows |

## ✅ Completed: Cron routes

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `GET /api/cron/jobs?job=rebuild-dashboard` | `api/cron/jobs.ts` | `getDashboard(force:true)` for the owner snapshot | `CRON_SECRET` auth. GitHub Actions call this; there is no `cron/refresh-dashboard.ts`. |
| `GET /api/cron/jobs?job=refresh-fantasycalc` | `api/cron/jobs.ts` | FantasyCalc daily refresh | Same file. Unknown `job` values return 400. |
| GET or POST `/api/player-news` | `api/player-news.ts` | `refreshPlayerNews` (simplified) | `CRON_SECRET` auth; Sleeper injury-status diff → `player_news_runs`/`player_news_items`; deep-research half stubbed `{ queued: true }` |

## ✅ Completed: Chart views (auth-required)

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `GET /api/chart-views` | `api/chart-views.ts` | `listSavedChartViews` | Supabase JWT auth; scoped to `user_id` |
| `POST /api/chart-views` | `api/chart-views.ts` | `saveChartView` | Supabase JWT auth; upsert by dataset+name |
| `DELETE /api/chart-views?id=` | `api/chart-views.ts` | `deleteChartView` | Supabase JWT auth. There is no `chart-views/[id].ts`. |
| migration | `drizzle-pg/0002_chart_views_user_id.sql` | — | Hand-written SQL, not in the drizzle-kit journal. Drops `owner_source`/`owner_key`, adds `user_id`. See `MIGRATION-STATUS.md`. |
| migration | `drizzle-pg/0003_phase2_users.sql` | — | Hand-written SQL, not in the journal. Creates `sleeper_connections` and its RLS policies. |

## ✅ Completed: Shared libraries

| File | Purpose |
|------|---------|
| `lib/api-utils.ts` | Response helpers, `CRON_SECRET` check, `ADMIN_USER_IDS` check, Supabase JWT helper, query param parsers |
| `lib/dashboard-schemas.ts` | Full dashboard zod schemas (verbatim from actions.ts, plain zod) |
| `lib/trades.ts` | Historical trades logic (~700 lines: Sleeper fetching, draft pick resolution, kicker-chain logic) |
| `lib/sleeper.ts` | Shared Sleeper helpers: fetch/deadline utils, stat scoring, weekly-stats cache, league formats, availability, injury snapshots |

Route handlers import the copies under `api/_lib/`. `drizzle.config.ts` reads `lib/schema.ts`.

---

## 🔲 Remaining (per task scope)

These were **not** in the Phase 2 task list but are tracked for completeness:

### Still stubbed
- Deep-research half of the player-news refresh — Brave Search league-wide roundup (currently `{ queued: true }`)

### Explicitly NOT migrating
- `setVegasProjections` / `setVegasProjectionsChunk` — banned legacy paths
- `savePlayerNewsRoundup` as standalone route — folds into cron handler

---

## Key transformations applied

| Hatch | Vercel |
|-------|--------|
| `ctx.db<typeof schema>()` | `import { db } from "./_lib/db.js"` (handlers under `api/`) |
| `z` from `@hatch/space-sdk` | `z` from `"zod"` |
| `ctx.viewer.isOwner` | `isAdminUserId()` vs `ADMIN_USER_IDS` |
| `ctx.executePrivileged` file reads | Webhook POST body |
| `ctx.agent.spawnTask` | Stub (Phase 3: Vercel Cron) |
| `ctx.tool.web_search` | Stub (Phase 3: Brave Search API) |
| `ctx.tool.sports_data` | ESPN scoreboard API (public) |
| `defineAction` | Named `GET` / `POST` / `DELETE` exports |
| `ctx.invalidateQueries()` | Client-side React Query invalidation (no server equivalent needed) |

---

## Verification

- `npx tsc --noEmit -p tsconfig.json`: **0 errors** in `lib/` and `api/` ✅
- Frontend errors are pre-existing from Phase 1 (api.ts stub), unrelated to Phase 2
- `app/` source files: **unmodified** ✅
