# Fantasy Rankings Migration Status

**Target:** Vercel (hosting) + Supabase (Postgres) — public beta  
**Source:** Hatch TypeScript artifact (`fantasy-rankings`)  
**Started:** 2026-09-30

---

## Phase 1: Scaffolding + Database (IN PROGRESS)

### ✅ Done

- [x] Staged app source → `app/` (client/src, server/src, drizzle/ — 45 files, unmodified)
- [x] Staged pipeline → `pipeline/` (props-aggregator, scripts — 79 files, unmodified)
- [x] Converted Drizzle schema SQLite → Postgres → `lib/schema.ts` (9 tables)
  - `sqliteTable` → `pgTable`
  - `integer({mode:"timestamp_ms"})` → `timestamptz`
  - `integer({mode:"boolean"})` → `boolean`
  - `text({enum})` → `text` + CHECK constraints
  - `saved_chart_views` keeps Hatch-era `owner_source`/`owner_key` (Phase 2 replaces with `user_id`)
- [x] Fresh Postgres baseline migration → `drizzle-pg/0001_baseline.sql` + `meta/_journal.json`
- [x] Database client → `lib/db.ts` (postgres-js, `prepare: false`, lazy singleton, `DATABASE_URL`)
- [x] Frontend scaffold → `frontend/` (Vite + React 19)
  - `index.html` (Vite-style, `#root` mount)
  - `vite.config.ts` (build → `frontend/dist`, `/api` proxy for local dev)
  - `src/main.tsx` (standard React Query client, Hatch SDK removed)
  - `src/api.ts` (typed fetch client stub — Phase 2 fills implementations)
  - `src/` copied from `app/client/src` (App, AnalyticsViews, PowerRankings, theme, assets)
- [x] API route map → `api/README.md` (21 actions → routes, conventions, do-not-migrate list)
- [x] Root `package.json` (Vercel deps: `postgres`, `@supabase/ssr`, `drizzle-orm`; removed `@hatch/space-sdk`)
- [x] `vercel.json` (SPA rewrites, `frontend/dist` output, cron schedules in UTC, `maxDuration` for long routes)
- [x] `drizzle.config.ts` (drizzle-kit → `drizzle-pg/`, Postgres dialect)
- [x] `tsconfig.json` (covers `frontend/src`, `lib`, `api`)
- [x] `.env.example` (documents `DATABASE_URL`, Supabase keys, `CRON_SECRET`, `ADMIN_USER_IDS`)

### ⏳ Blocked (needs Richard)

- [ ] **GitHub repo** — Richard creating `fantasy-rankings` (public) at github.com/new
- [ ] **Supabase project** — Richard creating free project at supabase.com → need `DATABASE_URL`

### 🔲 Todo (after unblocked)

- [ ] Schema changes follow [Database migrations](#database-migrations). `npm run db:migrate` applies `0001_baseline` only. Do not run it against production.
- [ ] `npm install` + `npm run typecheck` (validate the scaffold compiles)
- [ ] `npm run build` (validate Vite build works)
- [ ] Push to GitHub
- [ ] Connect Vercel to repo, set env vars, deploy

---

## Phase 2: Server Action Adaptation (IN PROGRESS — 2026-09-30)

### ✅ Done (8 routes)

**Read-only routes:**
- [x] `GET /api/dashboard` — `getDashboard` (non-force) + `getCachedDashboard`
- [x] `GET /api/dashboard/section` — `getDashboardSection` (all 5 sections)
- [x] `GET /api/pfn-tables` — `getpfntables`
- [x] `GET /api/player-news` — `getPlayerNews`
- [x] `GET /api/trades/history` — `getHistoricalTrades` (full Sleeper chain logic)

**Ingest webhooks** (`CRON_SECRET` auth, JSON in POST body):
- [x] `POST /api/ingest/projections` — `ingeststagedprojections`
- [x] `POST /api/ingest/matchup-grades` — `ingeststagedmatchupgrades`
- [x] `POST /api/ingest/pfn-tables` — `ingeststagedpfntables`

**Shared libs:**
- [x] `lib/api-utils.ts` — response helpers, auth, query parsers
- [x] `lib/dashboard-schemas.ts` — dashboard zod schemas (plain zod)
- [x] `lib/trades.ts` — historical trades Sleeper logic (~700 lines)

The `lib/` copies listed above were removed. Live code is `api/_lib/`, including `api/_lib/schema.ts`.

See `PHASE2-STATUS.md` for full details. `app/` is unmodified. `npm run typecheck` covers `frontend/` only.

### ✅ Shipped since the list above

Early plans named separate files (`dashboard/section.ts`, `boom-bust/ranges.ts`, `cron/refresh-dashboard.ts`, `ingest/projections.ts`, `matchup/box-score.ts`, `chart-views/[id].ts`). Those files are not what deploys. The live map is [`api/README.md`](api/README.md).

- [x] `GET /api/dashboard` and `GET /api/dashboard/section` — `api/dashboard.ts`
- [x] `GET /api/draft-center` — `api/draft-center.ts`
- [x] `GET /api/boom-bust/ranges` and `GET /api/boom-bust/history` — `api/boom-bust/[type].ts`
- [x] `GET /api/value-history` — `api/value-history.ts`
- [x] `GET` / `POST` / `DELETE /api/chart-views` — `api/chart-views.ts` (`DELETE` uses `?id=`)
- [x] `GET /api/box-score` — `api/box-score.ts`
- [x] `GET /api/cron/jobs?job=rebuild-dashboard` and `?job=refresh-fantasycalc` — `api/cron/jobs.ts`
- [x] `GET` / `POST /api/player-news` — `api/player-news.ts` (refresh when the caller sends `CRON_SECRET`)
- [x] `POST /api/ingest/projections`, `/api/ingest/matchup-grades`, `/api/ingest/pfn-tables`, `/api/ingest/player-news-x` — `api/ingest/[target].ts`
- [x] `shared_player_news` table — `drizzle-pg/0005_shared_player_news.sql` (hand-apply)
- [x] `GET` / `POST /api/user` — `api/user.ts`
- [x] GitHub Actions in `.github/workflows/` call those routes on a schedule

**Explicitly NOT migrating:**
- `setVegasProjections` / `setVegasProjectionsChunk` (banned legacy paths)
- `savePlayerNewsRoundup` as standalone route (folds into cron handler)

The sequence below is the original plan. The handlers that shipped are the combined files in [`api/README.md`](api/README.md), not the separate paths in steps 1–4.

Per ANALYSIS.md §5, §10:

1. Migrate pure-read routes first: `GET /api/dashboard`, `/api/dashboard/section`, `/api/pfn-tables`, `/api/player-news`
2. Migrate ingest webhooks (3): `/api/ingest/projections`, `/api/ingest/matchup-grades`, `/api/ingest/pfn-tables`
3. Migrate `getDashboard` force path → `/api/cron/refresh-dashboard`
4. Remaining: boom/bust (2), value history, draft center, trades, chart views (auth), box score, news refresh
5. Replace `frontend/src/api.ts` stub with full typed client
6. Wire pipeline webhooks (`pipeline/run_twice_daily.sh` → POST to Vercel)
7. Delete banned paths (`setVegasProjections`, `setVegasProjectionsChunk`) — do not migrate
8. Multi-user: Supabase Auth + `saved_chart_views.user_id` + RLS + per-user Sleeper username

---

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Database | Supabase (Postgres) | Multi-user/auth needs; Richard may sell it |
| DB driver | postgres-js (`prepare: false`) | Supabase pooler requires it |
| Frontend | Vite SPA (not Next.js) | Minimal change from current React app; API routes handle backend |
| Migrations | Fresh baseline, not 1:1 conversion | 17 SQLite migrations → 1 Postgres baseline is cleaner |
| Schedules | GitHub Actions | `.github/workflows/` calls the app routes. `vercel.json` has no cron entries. |
| Timestamps | `timestamptz` | Drizzle returns `Date` either way; `.getTime()` call sites unaffected |

---

## Database migrations

Postgres migrations live in `drizzle-pg/`. `app/drizzle/` is the Hatch SQLite history and is not applied to Supabase.

`drizzle.config.ts` reads `api/_lib/schema.ts`, writes SQL to `drizzle-pg/`, and connects with `DATABASE_URL`. Route handlers use that same schema through `api/_lib/db.ts`.

Scripts in `package.json`:

| Script | Command |
|--------|---------|
| `npm run db:generate` | `drizzle-kit generate --config=drizzle.config.ts` |
| `npm run db:migrate` | `drizzle-kit migrate --config=drizzle.config.ts` |
| `npm run db:push` | `drizzle-kit push --config=drizzle.config.ts` |

`db:migrate` applies only entries in `drizzle-pg/meta/_journal.json`. That journal lists `0001_baseline` and nothing else.

`drizzle-pg/0002_chart_views_user_id.sql`, `drizzle-pg/0003_phase2_users.sql`, and `drizzle-pg/0004_db_hardening.sql` are hand-written. They are not journal entries, so `db:migrate` does not run them. Production already has `0001` through `0004` applied by hand (Supabase SQL editor). `0004_db_hardening.sql` was applied on 2026-10-07. Drizzle has never run `db:migrate` on production: there is no `drizzle.__drizzle_migrations` table.

Do not run `npm run db:migrate` against production. `0001_baseline` creates `saved_chart_views_owner_idx` on `owner_source` and `owner_key`. `0002` dropped those columns and that index. Running `0001` again fails on that `CREATE INDEX`, and Drizzle rolls the migration back.

`0002` is safe to re-run (`IF EXISTS` / `IF NOT EXISTS`). `0003` is not. Its `CREATE POLICY` statements have no `IF NOT EXISTS`, so a second run fails because those policies already exist. `0004` was applied by hand on 2026-10-07; it adds the hot-path indexes (including `player_value_snapshots` on `snapshot_date DESC`), the `saved_chart_views` unique `(user_id, dataset, name)` index, owner RLS, the `auth.uid()` initplan fix, and `REVOKE TRUNCATE`.

`sleeper_connections` is declared in `api/_lib/schema.ts`. `db:push` diffs that file against the database. Production already has this table plus the `0004` indexes and policies. Do not run `db:push` or `db:migrate` against production.

`npm run typecheck` runs `tsc --noEmit -p frontend/tsconfig.json`. It typechecks `frontend/` only.

---

## Risk Watch

- Dashboard rebuilds use `maxDuration: 60` in `vercel.json` (Vercel Hobby). In-code deadlines stop before that cap. GitHub Actions start the heavy jobs; the work still runs inside the Vercel function.
- Dashboard JSON is 2MB+ → under Vercel's 4.5MB limit, but prefer sectioned reads
- `refreshPlayerNews` agent has no Vercel equivalent → cron + Brave Search API
- `app.db` (127MB) is NOT in git (see `.gitignore`); seed from it only if history needed
