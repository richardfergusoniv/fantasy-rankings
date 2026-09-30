# API Routes (Vercel Serverless Functions)

Phase 2 will implement these routes. Each file exports a default handler.

## Planned routes

| File | Method | Replaces |
|------|--------|----------|
| `dashboard.ts` | GET | `getDashboard`, `getCachedDashboard` |
| `dashboard/section.ts` | GET | `getDashboardSection` |
| `draft-center.ts` | GET | `getDraftCenter` |
| `boom-bust/ranges.ts` | POST | `getBoomBustRanges` |
| `boom-bust/history.ts` | GET | `getBoomBustHistory` |
| `value-history.ts` | POST | `getValueHistory` |
| `trades/history.ts` | GET | `getHistoricalTrades` |
| `chart-views.ts` | GET/POST/DELETE | `listSavedChartViews`, `saveChartView`, `deleteChartView` |
| `pfn-tables.ts` | GET | `getpfntables` |
| `matchup/box-score.ts` | GET | `getMatchupBoxScore` |
| `player-news.ts` | GET | `getPlayerNews` |
| `ingest/projections.ts` | POST | `ingeststagedprojections` (webhook) |
| `ingest/matchup-grades.ts` | POST | `ingeststagedmatchupgrades` (webhook) |
| `ingest/pfn-tables.ts` | POST | `ingeststagedpfntables` (webhook) |
| `cron/refresh-dashboard.ts` | GET | `getDashboard(force:true)` schedule |
| `cron/fantasycalc-refresh.ts` | GET | `fantasycalc-daily-rankings-refresh` |
| `cron/player-news.ts` | GET | `fantasy-player-news-*` |

## Conventions

- Validate input with zod `safeParse`; return 400 on failure.
- Import DB via `import { db } from "../../lib/db"`.
- Auth-required routes: verify Supabase JWT via `@supabase/ssr`.
- Webhook/cron routes: check `Authorization: Bearer ${process.env.CRON_SECRET}`.
- Long-running routes: export `config = { maxDuration: 300 }` (Vercel Pro).

## DO NOT MIGRATE

- `setVegasProjections` / `setVegasProjectionsChunk` (banned legacy paths)
- `savePlayerNewsRoundup` as a standalone route (fold into cron handler)
