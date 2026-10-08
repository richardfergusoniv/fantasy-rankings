# API Routes (Vercel Serverless Functions)

Live handlers export named `GET`, `POST`, and `DELETE` functions. Several Hatch actions share one file so the project stays inside Vercel's function limit.

## Routes

| File | Methods | Path |
|------|---------|------|
| `dashboard.ts` | GET | `/api/dashboard`. `/api/dashboard/section` is rewritten here with `?__section=1` (`vercel.json`). |
| `draft-center.ts` | GET | `/api/draft-center` |
| `boom-bust/[type].ts` | GET | `/api/boom-bust/ranges`, `/api/boom-bust/history` |
| `value-history.ts` | GET | `/api/value-history` |
| `trades/history.ts` | GET | `/api/trades/history` |
| `chart-views.ts` | GET, POST, DELETE | `/api/chart-views`. Delete takes `?id=`. |
| `pfn-tables.ts` | GET | `/api/pfn-tables` |
| `box-score.ts` | GET | `/api/box-score` |
| `player-news.ts` | GET, POST | `/api/player-news`. A `CRON_SECRET` bearer on GET runs the refresh; other GETs read stored news. |
| `ingest/[target].ts` | POST | `/api/ingest/projections`, `/api/ingest/matchup-grades`, `/api/ingest/pfn-tables` |
| `cron/jobs.ts` | GET | `/api/cron/jobs?job=rebuild-dashboard` or `?job=refresh-fantasycalc` |
| `user.ts` | GET, POST | `/api/user` |

## Conventions

- Validate input with zod `safeParse`; return 400 on failure.
- Route handlers import the database from `api/_lib/db.js`. `drizzle.config.ts` points drizzle-kit at `api/_lib/schema.ts`.
- Auth-required routes verify the Supabase JWT (`getRequestUser` / `resolveSleeperUserId` in `api/_lib`).
- Webhook and cron routes check `Authorization: Bearer ${CRON_SECRET}`.
- Long routes set `maxDuration: 60` in `vercel.json` (Vercel Hobby cap).

## DO NOT MIGRATE

- `setVegasProjections` / `setVegasProjectionsChunk` (banned legacy paths)
- `savePlayerNewsRoundup` as a standalone route (fold into cron handler)
