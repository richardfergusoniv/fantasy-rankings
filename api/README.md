# API Routes (Vercel Serverless Functions)

Live handlers export named `GET`, `POST`, and `DELETE` functions. Several Hatch actions share one file so the project stays inside Vercel's function limit.

## Routes

| File | Methods | Path |
|------|---------|------|
| `dashboard.ts` | GET | `/api/dashboard`. Requires a signed-in Sleeper user; signed-out reads return 401. `/api/dashboard/section` is rewritten here with `?__section=1` (`vercel.json`). |
| `draft-center.ts` | GET | `/api/draft-center` |
| `boom-bust/[type].ts` | GET | `/api/boom-bust/ranges`, `/api/boom-bust/history` |
| `data/[kind].ts` | GET | `/api/data/box-score`, `/api/data/pfn-tables`, `/api/data/value-history`, `/api/data/trades-history`. Old paths `/api/box-score`, `/api/pfn-tables`, `/api/value-history`, `/api/trades/history` rewrite here (`vercel.json`). `pfn-tables` accepts optional `season`/`week` and includes cached current-week `propLines`. |
| `chart-views.ts` | GET, POST, DELETE | `/api/chart-views`. Delete takes `?id=`. |
| `player-news.ts` | GET, POST | `/api/player-news`. A `CRON_SECRET` bearer on GET/POST runs the Sleeper refresh into `shared_player_news`; signed-in GETs read the shared 30-day feed. |
| `ingest/[target].ts` | POST | `/api/ingest/projections`, `/api/ingest/matchup-grades`, `/api/ingest/pfn-tables`, `/api/ingest/player-news-x` |
| `cron/jobs.ts` | GET | `/api/cron/jobs?job=rebuild-dashboard`, `?job=refresh-fantasycalc`, `?job=read-dashboard-snapshot`, `?job=backfill-value-history`, `?job=backfill-pick-value-history`, or `?job=x-producer-priority` |
| `user.ts` | GET, POST | `/api/user` |
| `chat.ts` | GET, POST | `/api/chat`. Requires a signed-in Sleeper user. GET returns `{ available }` (OpenRouter key present). POST runs a tool-calling agent on OpenRouter free models (`OPENROUTER_API_KEY`; optional `OPENROUTER_MODEL` override, must end in `:free`). Default `thinkingmachines/inkling:free`; fallback on 403/404/429/5xx `nvidia/nemotron-3-ultra-550b-a55b:free`. Upstream failures: 429/5xx/timeouts return 503 `chat_upstream_unavailable` (retryable); 401/402/403/404 return 502 `chat_upstream_denied` (needs a key, credit or model fix), with an `error` message naming which. Up to 8 tool steps / 55s deadline / `maxDuration: 60`. Tools cover leagues, cards, rankings, trades, matchups, news, advanced stats, projections, value history, lineup/waiver/trade suggestions, and draft info (read-only; dashboard + `source_cache` preferred). |

**Function count:** 10 under `api/` (excluding `_lib`). Hobby cap is 12.

## Conventions

- Validate input with zod `safeParse`; return 400 on failure.
- Route handlers import the database from `api/_lib/db.js`. `drizzle.config.ts` points drizzle-kit at `api/_lib/schema.ts`.
- Auth-required routes verify the Supabase JWT (`getRequestUser` / `resolveSleeperUserId` in `api/_lib`).
- Webhook and cron routes check `Authorization: Bearer ${CRON_SECRET}`.
- Long routes set `maxDuration: 60` in `vercel.json` (Vercel Hobby cap).

## X producer (external push → player-news-x)

Richard’s X push routine is **out of repo**. This app only accepts batches and
exposes a priority list the producer can refresh.

1. **Priority set** — `GET /api/cron/jobs?job=x-producer-priority` with
   `Authorization: Bearer $CRON_SECRET`. Optional `?fresh=1` refreshes league
   / roster caches. Returns `playerIds` = union of every player rostered in
   `OWNER_SLEEPER_USER_ID` leagues + active skill+K with Sleeper
   `search_rank` ≤ 300 (from `nfl-players-roster-v1`; run
   `refresh-nfl-players` so ranks are present). Helper:
   `api/_lib/x-producer-priority.ts`.
2. **Always send `player_id`** on `POST /api/ingest/player-news-x`. Name
   matching is exact-key fallback only; prefer Sleeper ids from the priority
   list. Response includes `unresolved` + `unresolvedSamples` (≤10); unresolved
   samples are also `console.warn`’d.
3. **Beat + national accounts** stay in the producer (Schefter, Rapoport,
   team beats for under-covered clubs). No scraper lives here.
4. **Alert** if weekday X volume collapses (e.g. &lt; ~20 rows on a weekday).

## DO NOT MIGRATE

- `setVegasProjections` / `setVegasProjectionsChunk` (banned legacy paths)
- `savePlayerNewsRoundup` as a standalone route (fold into cron handler)
