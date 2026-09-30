# Phase 2 Status: Server Action Adaptation

**Started:** 2026-09-30  
**Scope:** Adapt Hatch server actions → Vercel API routes (per ANALYSIS.md §5, §10)

---

## ✅ Completed: Read-only routes (5)

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `GET /api/dashboard` | `api/dashboard.ts` | `getDashboard` (non-force) + `getCachedDashboard` | `force=true` returns 400 (moves to cron in Phase 3) |
| `GET /api/dashboard/section` | `api/dashboard/section.ts` | `getDashboardSection` | All 5 sections (meta/team/players/league/analytics) |
| `GET /api/pfn-tables` | `api/pfn-tables.ts` | `getpfntables` | Includes team-situational snapshot |
| `GET /api/player-news` | `api/player-news.ts` | `getPlayerNews` | Max 20 populated runs |
| `GET /api/trades/history` | `api/trades/history.ts` | `getHistoricalTrades` | Full Sleeper chain logic; `maxDuration: 120` |
| `GET /api/draft-center` | `api/draft-center.ts` | `getDraftCenter` | FFC/MFL ADP, Sleeper trending, live drafts; betting fetches (Polymarket/Kalshi/Action Network) removed per UI removal |
| `GET /api/boom-bust/ranges` | `api/boom-bust/ranges.ts` | `getBoomBustRanges` | Query: leagueId, position, playerIds (CSV, 1–24) |
| `GET /api/boom-bust/history` | `api/boom-bust/history.ts` | `getBoomBustHistory` | Query: leagueId, playerId, position, view (season\|last3) |
| `GET /api/value-history` | `api/value-history.ts` | `getValueHistory` | Query: formatKey, playerIds (CSV, max 24); FantasyCalc backfill |
| `GET /api/box-score` | `api/box-score.ts` | `getMatchupBoxScore` | Admin-only; ESPN public scoreboard API; query: team, opponent, season, week |

## ✅ Completed: Ingest webhooks (3)

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `POST /api/ingest/projections` | `api/ingest/projections.ts` | `ingeststagedprojections` | Accepts staged JSON in POST body; `CRON_SECRET` auth |
| `POST /api/ingest/matchup-grades` | `api/ingest/matchup-grades.ts` | `ingeststagedmatchupgrades` | Per-league SoS upsert; skips stale |
| `POST /api/ingest/pfn-tables` | `api/ingest/pfn-tables.ts` | `ingeststagedpfntables` | Writes 4 `pfn:*` cache rows |

## ✅ Completed: Cron routes

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `POST /api/cron/refresh-player-news` | `api/cron/refresh-player-news.ts` | `refreshPlayerNews` (simplified) | `CRON_SECRET` auth; Sleeper injury-status diff → `player_news_runs`/`player_news_items`; deep-research half stubbed `{ queued: true }` |

## ✅ Completed: Chart views (auth-required)

| Route | File | Replaces | Notes |
|-------|------|----------|-------|
| `GET /api/chart-views` | `api/chart-views.ts` | `listSavedChartViews` | Supabase JWT auth; scoped to `user_id` |
| `POST /api/chart-views` | `api/chart-views.ts` | `saveChartView` | Supabase JWT auth; upsert by dataset+name |
| `DELETE /api/chart-views/[id]` | `api/chart-views/[id].ts` | `deleteChartView` | Supabase JWT auth; id from URL path |
| migration | `drizzle-pg/0002_chart_views_user_id.sql` | — | Drops `owner_source`/`owner_key`, adds `user_id uuid REFERENCES auth.users(id)` |

## ✅ Completed: Shared libraries

| File | Purpose |
|------|---------|
| `lib/api-utils.ts` | Response helpers, `CRON_SECRET` check, `ADMIN_USER_IDS` check, Supabase JWT helper, query param parsers |
| `lib/dashboard-schemas.ts` | Full dashboard zod schemas (verbatim from actions.ts, plain zod) |
| `lib/trades.ts` | Historical trades logic (~700 lines: Sleeper fetching, draft pick resolution, kicker-chain logic) |
| `lib/sleeper.ts` | Shared Sleeper helpers: fetch/deadline utils, stat scoring, weekly-stats cache, league formats, availability, injury snapshots |

---

## 🔲 Remaining (per task scope)

These were **not** in the Phase 2 task list but are tracked for completeness:

### Cron routes (Phase 3)
- `GET /api/cron/refresh-dashboard` — `getDashboard(force:true)` rebuild
- `GET /api/cron/fantasycalc-refresh` — FantasyCalc daily refresh
- Deep-research half of `/api/cron/refresh-player-news` — Brave Search league-wide roundup (currently stubbed)

### Explicitly NOT migrating
- `setVegasProjections` / `setVegasProjectionsChunk` — banned legacy paths
- `savePlayerNewsRoundup` as standalone route — folds into cron handler

---

## Key transformations applied

| Hatch | Vercel |
|-------|--------|
| `ctx.db<typeof schema>()` | `import { db } from "../lib/db"` |
| `z` from `@hatch/space-sdk` | `z` from `"zod"` |
| `ctx.viewer.isOwner` | `isAdminUserId()` vs `ADMIN_USER_IDS` |
| `ctx.executePrivileged` file reads | Webhook POST body |
| `ctx.agent.spawnTask` | Stub (Phase 3: Vercel Cron) |
| `ctx.tool.web_search` | Stub (Phase 3: Brave Search API) |
| `ctx.tool.sports_data` | ESPN scoreboard API (public) |
| `defineAction` | Default-exported handler `(req: Request) => Promise<Response>` |
| `ctx.invalidateQueries()` | Client-side React Query invalidation (no server equivalent needed) |

---

## Verification

- `npx tsc --noEmit -p tsconfig.json`: **0 errors** in `lib/` and `api/` ✅
- Frontend errors are pre-existing from Phase 1 (api.ts stub), unrelated to Phase 2
- `app/` source files: **unmodified** ✅
