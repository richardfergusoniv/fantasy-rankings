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

- [ ] Apply `drizzle-pg/0001_baseline.sql` to Supabase (via SQL editor or `db:push`)
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

See `PHASE2-STATUS.md` for full details. Typecheck clean; `app/` unmodified.

### 🔲 Remaining

**Cron routes (Phase 3):**
- [ ] `GET /api/cron/refresh-dashboard` — `getDashboard(force:true)` rebuild
- [ ] `GET /api/cron/fantasycalc-refresh` — FantasyCalc daily refresh
- [ ] `GET /api/cron/player-news` — news pipeline (replaces `refreshPlayerNews` + `savePlayerNewsRoundup`)

**Other actions (future):**
- [ ] `GET /api/draft-center`, `POST /api/boom-bust/ranges`, `GET /api/boom-bust/history`
- [ ] `POST /api/value-history`, `GET/POST/DELETE /api/chart-views` (needs Supabase Auth)
- [ ] `GET /api/matchup/box-score` (ESPN API, admin-only)
- [ ] Replace `frontend/src/api.ts` stub with full typed client
- [ ] Wire pipeline webhooks (`pipeline/run_twice_daily.sh` → POST to Vercel)

**Explicitly NOT migrating:**
- `setVegasProjections` / `setVegasProjectionsChunk` (banned legacy paths)
- `savePlayerNewsRoundup` as standalone route (folds into cron handler)

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
| Cron times | UTC in `vercel.json` | Vercel Cron is UTC-only; PDT = UTC-7 (adjust for PST seasonally) |
| Timestamps | `timestamptz` | Drizzle returns `Date` either way; `.getTime()` call sites unaffected |

---

## Risk Watch

- `getDashboard(force:true)` needs up to 110s → set `maxDuration: 300` (requires Vercel Pro)
- Dashboard JSON is 2MB+ → under Vercel's 4.5MB limit, but prefer sectioned reads
- `refreshPlayerNews` agent has no Vercel equivalent → cron + Brave Search API
- `app.db` (127MB) is NOT in git (see `.gitignore`); seed from it only if history needed
