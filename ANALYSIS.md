# Server Migration Analysis: Hatch space-sdk → Vercel API Routes + Supabase Postgres

**Source:** `~/workspace/fantasy-rankings-migration/app/server/src/actions.ts` (5,582 lines, ~254KB)
**Schema:** `~/workspace/fantasy-rankings-migration/app/server/src/schema.ts`
**Privileged:** `~/workspace/fantasy-rankings-migration/app/server/src/privileged.ts`
**Date:** 2026-09-30

---

## 1. Complete Action Inventory (20 actions)

| # | Action | Input | DB | External APIs | Hatch-specific |
|---|--------|-------|----|---------------|----------------|
| 1 | `getHistoricalTrades` | `{ leagueId, refresh?, season? }` | R/W `historical_trades` | Sleeper (league, previous_league chain, transactions, drafts) | — |
| 2 | `listSavedChartViews` | `{}` | R `saved_chart_views` | — | `ctx.viewer` (owner scope) |
| 3 | `saveChartView` | `savedChartViewInputSchema` | W `saved_chart_views` | — | `ctx.viewer` (auth required), `ctx.invalidateQueries()` |
| 4 | `deleteChartView` | `{ id }` | W `saved_chart_views` | — | `ctx.viewer`, `ctx.invalidateQueries()` |
| 5 | `ingeststagedprojections` | `{}` | R/W `vegas_projection_snapshots`, W `source_cache` | — (reads staged file) | `ctx.executePrivileged(readStagedProjections)`, `ctx.invalidateQueries()` |
| 6 | `ingeststagedmatchupgrades` | `{}` | R/W `source_cache` | — (reads staged file) | `ctx.executePrivileged(readStagedMatchupGrades)`, `ctx.invalidateQueries()` |
| 7 | `ingeststagedpfntables` | `{}` | W `source_cache` | — (reads staged file) | `ctx.executePrivileged(readStagedPfnTables)`, `ctx.invalidateQueries()` |
| 8 | `getpfntables` | `{}` | R `source_cache` (`pfn:*` keys) | — | — |
| 9 | `getMatchupBoxScore` | `{ team, opponent, season, week }` | — | — | `ctx.viewer.isOwner` gate, `ctx.tool.sports_data()` |
| 10 | `setVegasProjections` | `vegasProjectionPayloadSchema` (~240KB payload) | W `vegas_projection_snapshots`, W `source_cache` | — | `ctx.invalidateQueries()` — **LEGACY/BANNED** (payload too large for tool channel; superseded by ingeststagedprojections) |
| 11 | `setVegasProjectionsChunk` | `vegasProjectionChunkPayloadSchema` | R/W `vegas_projection_snapshots`, W `vegas_projection_upload_chunks` | — | `ctx.invalidateQueries()` — **LEGACY/BANNED** (same reason) |
| 12 | `getCachedDashboard` | `{}` | R `source_cache` (CACHE_KEY) | — | — |
| 13 | `getDashboardSection` | `{ section: meta|team|players|league|analytics }` | R `source_cache` (CACHE_KEY) | — | — |
| 14 | `getDashboard` | `{ force: boolean }` | R/W `source_cache` (CACHE_KEY) | Sleeper, nflverse CSVs, FantasyCalc, FFC, MFL, sportskeeda | `ctx.tool.web_search()` (kickoff times fallback) |
| 15 | `getDraftCenter` | `{ force: boolean }` | R/W `source_cache` (draft market) | Sleeper (leagues, players, drafts), FFC, MFL, Polymarket, Kalshi, Action Network | — |
| 16 | `getBoomBustRanges` | `{ leagueId, position, playerIds[1..24] }` | R/W `source_cache` (league settings) | Sleeper (league settings, player weekly stats) | — |
| 17 | `getBoomBustHistory` | `{ leagueId, playerId, position, view: season|last3 }` | R/W `source_cache`, R/W `projection_accuracy` | Sleeper (player weekly stats) | — |
| 18 | `getValueHistory` | `{ formatKey, playerIds[..24] }` | R/W `player_value_snapshots` | FantasyCalc (values/current, trades/implied history) | — |
| 19 | `getPlayerNews` | `{}` | R `player_news_runs`, `player_news_items`, `source_cache` | — | — |
| 20 | `refreshPlayerNews` | `{}` | R `source_cache` (injury snapshot) | Sleeper (rosters) | `ctx.viewer.isOwner` gate, `ctx.agent.spawnTask()` |
| 21 | `savePlayerNewsRoundup` | `{ runKey, checkedAt, injurySnapshot, items[..30] }` | W `player_news_runs`, `player_news_items`, `source_cache` | Sleeper (player ID resolution) | `ctx.invalidateQueries()` — called by the spawned agent task |

> Note: 21 entries listed because `savePlayerNewsRoundup` is the agent-task callback. 20 `defineAction` calls + this callback = the full surface.

---

## 2. Per-Action Detail

### Read-only dashboard actions (no writes, safe to cache)

**`getCachedDashboard`** — Returns the last saved dashboard snapshot from `source_cache` under `CACHE_KEY = "dashboard-live-projections-v25"`. Pure read. This is what the app loads on open.

**`getDashboardSection`** — Reads the same cached snapshot but returns only one section (`meta`, `team`, `players`, `league`, `analytics`). Designed so a slow live refresh never blocks section renders. Pure read.

**`getpfntables`** — Reads `pfn:*` keys from `source_cache` (offensive-line, defensive rankings etc.). Pure read.

**`getPlayerNews`** — Reads last 60 `player_news_runs` + all `player_news_items` + last-check timestamp. Returns max 20 populated runs. Pure read.

### The big one: `getDashboard`

- **Input:** `{ force: boolean }` (default false)
- **Non-force path:** Returns cached snapshot or an empty `partial` dashboard. **Never triggers source work.** This is the normal app-open path.
- **Force path:** Calls `buildDashboard(ctx, force)` (~600 lines, actions.ts:2505–3124) with a 110s deadline (`REFRESH_TIMEOUT_MS`). On success, writes the full dashboard JSON to `source_cache` under CACHE_KEY and calls `saveFantasyCalcSnapshot`. On failure/timeout, falls back to the cached snapshot with `status: "partial"`.
- **External calls in buildDashboard:**
  - Sleeper: `/state/nfl`, `/user/{SLEEPER_USER_ID}/leagues/nfl/{season}`, `/players/nfl`, `/schedule/nfl/regular/{season}`, per-league `/rosters`, `/matchups/{week}`, `/users`, `/traded_picks`
  - Sleeper projections: `api.sleeper.com` (weekly projections)
  - nflverse CSVs: 2026 + 2025 `stats_player_week_*.csv` from GitHub releases
  - FantasyCalc: 11 preset URLs (`/values/current` with format params)
  - `ctx.tool.web_search()` for kickoff times (fallback when Sleeper schedule missing)
- **DB writes:** `source_cache` (dashboard snapshot), `player_value_snapshots` (via saveFantasyCalcSnapshot), `projection_accuracy` (via saveProjectionAccuracy)
- **Vercel concern:** This is a **long-running function** (up to 110s). Vercel Hobby/Pro have 10s/60s limits on serverless functions (Pro max 300s on some plans, Fluid compute). Options: (a) Vercel Pro with maxDuration, (b) split into a background job (Vercel Cron + separate ingest endpoint), (c) keep the force-refresh as an on-demand long-poll. **Recommendation:** Move forced refresh to a Vercel Cron Job that hits a secured `/api/cron/refresh-dashboard` endpoint; the client only ever reads the cache.

### Ingest actions (pipeline → DB)

All three follow the same pattern: read a staged JSON file → validate with zod → upsert into DB → invalidate dashboard cache (`fetchedAt = epoch` on CACHE_KEY forces rebuild on next read).

**`ingeststagedprojections`** — Reads `staged_for_push.json` via privileged handler. Upserts `vegas_projection_snapshots` (id = `{season}:{week}`, skips if existing `builtAt` is newer). Source enum: `vegas | first_down | fallback | sleeper`.

**`ingeststagedmatchupgrades`** — Reads `staged_matchup_grades.json`. Writes one `source_cache` row per league (`sos:{league_id}` prefix). Skips if existing `computedAt` >= incoming.

**`ingeststagedpfntables`** — Reads `staged_pfn_tables.json` (from `~/workspace/pfn-pipeline/data/`). Writes `pfn:{tableKey}` rows to `source_cache`.

**Migration note:** The privileged file-read mechanism exists because the Hatch sandbox couldn't otherwise reach the host filesystem. On Vercel, the pipeline (props-aggregator) runs elsewhere — these become **webhook endpoints** that accept the JSON payload directly in the POST body, or read from blob storage. The `setVegasProjections`/`setVegasProjectionsChunk` actions are the banned legacy versions of this; do NOT migrate them (payload too large for the old tool channel, but a direct HTTP POST to Vercel can handle it — still, prefer the staged-file → webhook pattern).

### Chart views (user-scoped)

**`listSavedChartViews` / `saveChartView` / `deleteChartView`** — CRUD on `saved_chart_views`. Owner scoping via `savedViewOwnerScope(ctx)`:
- `ctx.viewer.isOwner` → `{ source: "owner", key: "owner:{slug}" }`
- `viewer.source === "local"` → `{ source: "local", key: viewer.userId }`
- else → `{ source: "cloudflare", key: viewer.viewerFbid }`

**Migration:** Replace with Supabase Auth. `owner_key` becomes `auth.users.id`. The `owner_source` enum (`owner|local|cloudflare`) collapses to a single `user_id` UUID column. Legacy "canClaimLegacy" migration path can be dropped for a fresh beta.

### Draft center

**`getDraftCenter`** — Fetches Sleeper leagues/players, loads draft-market snapshot (FFC ADP, MFL ADP, Polymarket/Kalshi betting signals — note: betting ticker was removed from UI per user request, but the fetch code remains), fetches live Sleeper drafts. Returns draft board data. No owner gate. Reads/writes `source_cache` for the market snapshot.

### Boom/Bust

**`getBoomBustRanges`** — For up to 24 players: loads Sleeper weekly season stats, scores them through the league's scoring settings (cached 24h in `source_cache`), returns `{ playerId, floor, ceiling, range, games }`. Pure compute + cache.

**`getBoomBustHistory`** — Same inputs plus `view: season|last3`. Reads/writes `projection_accuracy` ledger. Returns per-week series + game log.

### Value history

**`getValueHistory`** — Checks `player_value_snapshots` for fresh (< 1 day) FantasyCalc snapshots per `formatKey`. If stale, fetches `/values/current` + per-player `/trades/implied/{id}` history (last 30 days), writes new snapshot rows. Returns time series.

### Player news (agent-driven)

**`refreshPlayerNews`** — Owner-only. Builds roster context from Sleeper, diffs injury statuses against the saved snapshot, then calls `ctx.agent.spawnTask()` with a detailed research prompt. The agent is instructed to call `savePlayerNewsRoundup` when done. Returns `{ started, taskId, message }`.

**`savePlayerNewsRoundup`** — The agent's callback. Validates up to 30 items, resolves Sleeper player IDs by name+team, filters to known leagues, checks waiver availability, writes `player_news_runs` + `player_news_items` + advances the injury snapshot in `source_cache`.

**Migration:** `ctx.agent.spawnTask` has no Vercel equivalent. Options: (a) Vercel Cron + a server-side news-fetch function using a web-search API (Brave Search skill exists), (b) keep the Hatch cron calling a Vercel webhook. **Recommendation:** Replace with a Vercel Cron Job that runs the news pipeline directly (fetch Sleeper rosters → Brave Search API → write to Supabase). The two-action split (refresh → save) can become one cron handler.

### `getMatchupBoxScore`

- Owner-only gate. Uses `ctx.tool.sports_data()` (Hatch's sports data tool) to look up a game's final score.
- **Migration:** Replace with a direct API call (e.g., Sleeper schedule already has scores, or ESPN's public scoreboard API `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`). No Hatch tool needed.

---

## 3. Database Connection

**Current:** There is **no explicit connection setup in actions.ts**. The Hatch SDK injects it:
```ts
const db = ctx.db<typeof schema>();
```
The SDK manages a SQLite database (`app.db`, 127MB) with Drizzle ORM. Migrations live in `drizzle/` (17 SQL files + `meta/_journal.json`).

**Migration target:**
```ts
// lib/db.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema"; // converted to pg-core

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle(client, { schema });
```
- Use `postgres` (postgres-js) with `prepare: false` for Supabase's PgBouncer in transaction mode, or Drizzle's `@supabase/supabase-js` adapter. **Recommend `postgres-js` + `prepare: false`** — standard for Supabase + Drizzle.
- `ctx.db<typeof schema>()` → import `{ db }` directly. The schema generic is only for typing; the converted `pgTable` schema provides it.

---

## 4. How `Ctx` Is Used

| Ctx member | Usage | Vercel/Supabase replacement |
|------------|-------|-----------------------------|
| `ctx.db<typeof schema>()` | DB access in ~15 actions + helpers | `import { db } from "@/lib/db"` |
| `ctx.viewer` | `{ isOwner }` gates on `getMatchupBoxScore`, `refreshPlayerNews`; owner scoping on chart views | Supabase Auth (`supabase.auth.getUser()`); `isOwner` → check `user.id` against `ADMIN_USER_IDS` env var |
| `ctx.slug` | Only in `savedViewOwnerScope` (`owner:{slug}` key) | Drop; use Supabase user UUID |
| `ctx.tool.web_search()` | Kickoff-times fallback in buildDashboard | Direct Brave Search API call (skill exists) or drop (Sleeper schedule is primary) |
| `ctx.tool.sports_data()` | `getMatchupBoxScore` only | ESPN scoreboard API or Sleeper schedule |
| `ctx.agent.spawnTask()` | `refreshPlayerNews` only | Vercel Cron Job (see §2) |
| `ctx.executePrivileged()` | 3 ingest actions reading staged JSON files | Webhook POST body or Vercel Blob / Supabase Storage |
| `ctx.invalidateQueries()` | After every write action | Client-side: the new API client should invalidate React Query keys after mutations. Server just returns; no equivalent needed. |

**`z` import:** `import { z } from "@hatch/space-sdk"` → `import { z } from "zod"`. All schemas transfer verbatim.

**`ActionsModule`:** `} satisfies ActionsModule;` → delete. Each action becomes a route handler.

---

## 5. Proposed API Route Mapping

Base: Next.js App Router (or Vercel Functions). All routes under `/api/`.

| Action | Method + Route | Notes |
|--------|---------------|-------|
| `getDashboard` | `GET /api/dashboard?force=true` | `force=true` → **admin-only**, triggers rebuild (long). Consider moving to cron. |
| `getCachedDashboard` | `GET /api/dashboard/cached` | Could merge into `GET /api/dashboard` (force defaults false). Recommend merging. |
| `getDashboardSection` | `GET /api/dashboard/section?section=players` | Pure cache read. Keep for the sectioned loading strategy. |
| `ingeststagedprojections` | `POST /api/ingest/projections` | Secured webhook (shared secret header). Body = staged JSON. Replaces privileged file read. |
| `ingeststagedmatchupgrades` | `POST /api/ingest/matchup-grades` | Same webhook pattern. |
| `ingeststagedpfntables` | `POST /api/ingest/pfn-tables` | Same webhook pattern. |
| `setVegasProjections` | — | **DO NOT MIGRATE** (banned legacy path). |
| `setVegasProjectionsChunk` | — | **DO NOT MIGRATE** (banned legacy path). |
| `getDraftCenter` | `GET /api/draft-center?force=true` | Cacheable; force triggers live fetch. |
| `getBoomBustRanges` | `POST /api/boom-bust/ranges` | POST because playerIds array can be long. |
| `getBoomBustHistory` | `GET /api/boom-bust/history?leagueId=&playerId=&position=&view=` | |
| `getValueHistory` | `POST /api/value-history` | POST for playerIds array. |
| `getHistoricalTrades` | `GET /api/trades/history?leagueId=&refresh=&season=` | May be slow (walks league chain); set `maxDuration`. |
| `listSavedChartViews` | `GET /api/chart-views` | **Auth required** (Supabase). |
| `saveChartView` | `POST /api/chart-views` | **Auth required.** |
| `deleteChartView` | `DELETE /api/chart-views?id=` | **Auth required.** |
| `getpfntables` | `GET /api/pfn-tables` | Pure cache read. |
| `getMatchupBoxScore` | `GET /api/matchup/box-score?team=&opponent=&season=&week=` | **Admin-only** (was owner-gated). |
| `getPlayerNews` | `GET /api/player-news` | Pure read. |
| `refreshPlayerNews` | `POST /api/player-news/refresh` | **Admin-only.** Triggers cron-style run; or remove and rely on Vercel Cron. |
| `savePlayerNewsRoundup` | — | **DO NOT MIGRATE as a route.** Fold into the cron handler. If kept as a callback, secure with a secret. |

**Cron jobs (Vercel Cron):**
| Schedule | Route | Replaces |
|----------|-------|----------|
| Daily 03:00 | `GET /api/cron/refresh-dashboard` | Hatch `getDashboard(force:true)` schedule + props pipeline trigger |
| Daily 06:22 | `GET /api/cron/fantasycalc-refresh` | `fantasycalc-daily-rankings-refresh` (currently in space.json managedCronJobs) |
| 2× daily | `GET /api/cron/player-news` | `fantasy-player-news-daily` + Sunday variants (merge into one cron with day-of-week logic) |

All cron routes secured via `CRON_SECRET` env var (Vercel sends `Authorization: Bearer ${CRON_SECRET}`).

**space.json `managedCronJobs`** (`fantasycalc-daily-rankings-refresh`, `fantasy-player-news-daily`, `fantasy-player-news-sun-9am`, `fantasy-player-news-sun-1205`, `fantasy-player-news-sun-420`) → all become `vercel.json` `crons` entries.

---

## 6. Hatch-Specific Utilities to Replace

| Hatch utility | Replacement |
|---------------|-------------|
| `defineAction({ request, response, handler })` | Next.js route handler + zod `safeParse` on input; response validated before return (keep the response schemas — they're good contracts) |
| `createActionClient` (`@hatch/space-sdk/client`) in `client/src/api.ts` | Typed `fetch` wrapper: `api.getDashboard({force})` → `fetch("/api/dashboard?force=true")`. Keep the `ApiResponse<T>` type pattern by typing against the zod response schemas. |
| `definePrivilegedContracts` / `definePrivilegedHandlers` (`privileged.ts`) | Delete. Ingest becomes webhooks (see §5). |
| `import { Privileged } from "@space/privileged"` | Delete. |
| `ctx.invalidateQueries()` | Client-side React Query invalidation in the new API client after mutations. |
| `ctx.tool.web_search` | Brave Search API (skill exists at `~/workspace/skills/brave-search/`) or remove fallback. |
| `ctx.tool.sports_data` | ESPN public scoreboard API. |
| `ctx.agent.spawnTask` | Vercel Cron + direct implementation. |
| `@hatch/space-sdk` package | Remove from `package.json`. Add: `zod`, `drizzle-orm`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr` (auth). |

---

## 7. Schema Conversion Notes (SQLite → Postgres)

`schema.ts` uses `drizzle-orm/sqlite-core` (`sqliteTable`, `integer({mode:"timestamp_ms"})`, `integer({mode:"boolean"})`). Convert to `drizzle-orm/pg-core`:

| SQLite | Postgres |
|--------|----------|
| `sqliteTable` | `pgTable` |
| `text("x").primaryKey()` | `text("x").primaryKey()` (same) |
| `integer("x", { mode: "timestamp_ms" })` | `timestamp("x", { withTimezone: true, mode: "date" })` |
| `integer("x", { mode: "boolean" })` | `boolean("x")` |
| `integer("x")` | `integer("x")` |
| `text("x", { enum: [...] })` | `text("x", { enum: [...] })` (pg-core supports enum via text+check, or use `pgEnum`) |

**Caution — timestamp semantics:** SQLite `timestamp_ms` stores epoch millis as integer. Postgres `timestamp` stores a real timestamp. The code does `.getTime()` comparisons and `.toISOString()` serializations on these fields throughout actions.ts. After conversion, Drizzle returns `Date` objects in both cases, so **most code is unaffected** — but audit every `fetchedAt: new Date(0)` epoch-reset (used as a cache-bust flag on CACHE_KEY) to ensure it still compares correctly.

**New columns for multi-user (Phase 2):** `saved_chart_views.owner_source`/`owner_key` → replace with `user_id uuid references auth.users(id)`. Add RLS policies: users can only read/write their own rows.

**The 17 existing migrations** (`drizzle/0001–0017`) are SQLite dialect. **Do not try to convert them 1:1.** Instead: generate a fresh Postgres baseline with `drizzle-kit generate` from the converted schema, and treat the Hatch `app.db` as a seed source (export → import) if historical data matters. The `source_cache` dashboard snapshot can be rebuilt by running the pipeline; `player_news_*` and `projection_accuracy` history are nice-to-have seeds.

---

## 8. Client Changes (`client/src/api.ts`)

Current:
```ts
import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";
export const api = createActionClient<typeof Actions>();
```

New: a thin typed fetch client. Since every action's request/response is a zod schema, generate types via `z.infer` and write one function per route. The client's call sites (`api.getDashboard({force:true})` etc.) can keep nearly identical signatures — only the transport changes from `./actions` POST to REST routes.

Also remove `import type { Actions } from "../../server/src/actions"` — the client must not import server code in the Vercel build (it currently works because of `verbatimModuleSyntax` type-only import, but the new client won't reference server files at all).

---

## 9. Risk Register

1. **`getDashboard(force:true)` duration** — 110s budget exceeds Vercel Hobby (10s) and Pro default (60s). Mitigate via cron + `maxDuration` on Pro, or split build steps.
2. **Response size** — dashboard JSON is 2MB+. Vercel response limit is 4.5MB (OK), but consider the sectioned reads (`getDashboardSection`) as the primary client path (already the pattern).
3. **`refreshPlayerNews` agent** — the Hatch agent did web research. Replacement needs a search API (Brave) + LLM call, or a simpler injury-status diff from Sleeper data alone (which covers the `changes` signal but not league-wide news).
4. **Hardcoded `SLEEPER_USER_ID`** — single-user assumption baked into `buildDashboard`/`getDraftCenter`. Phase 2 multi-user work touches these paths.
5. **Betting data fetches** (Polymarket/Kalshi/Action Network in `getDraftCenter`) — user removed betting UI; these fetches still run. Safe to delete in migration.
6. **`app.db` (127MB)** — do not commit to git. Seed Postgres from it only if history is needed.

---

## 10. Suggested Migration Order

1. Convert `schema.ts` → `pg-core`, generate fresh Postgres migration, provision Supabase.
2. Build `lib/db.ts` + `lib/auth.ts` (Supabase clients).
3. Migrate pure-read actions first: `getCachedDashboard`, `getDashboardSection`, `getpfntables`, `getPlayerNews` — validates DB + routing.
4. Migrate ingest webhooks (3) — unblocks the props pipeline.
5. Migrate `getDashboard` read path; defer `force:true` to a cron route.
6. Migrate remaining actions in dependency order: boom/bust → value history → draft center → trades → chart views (auth) → box score → news refresh.
7. Replace `client/src/api.ts` with the fetch client; update call sites.
8. `vercel.json` crons; `CRON_SECRET`; pipeline webhook secrets.
9. Delete `setVegasProjections`/`setVegasProjectionsChunk` (do not migrate).
