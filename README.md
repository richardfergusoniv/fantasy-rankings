# Fantasy Rankings

Fantasy football rankings app with Vegas projections, Sleeper integration, and a props aggregator pipeline.

## Structure

- `frontend/` — Vite + React app
- `api/` — Vercel serverless routes (see `api/README.md`)
- `drizzle-pg/` — Postgres SQL for Supabase. The drizzle-kit journal is `0001_baseline` only; `0002`–`0004` were applied by hand (see `MIGRATION-STATUS.md`)
- `docs/` — notes from the original Hatch app (its source was removed after the migration)
- `pipeline/` — Props aggregator: pulls from 6 providers, builds consensus projections

## Status

🚧 **Migration in progress** — Moving from Hatch artifact runtime to Vercel + Supabase.

## License

TBD

<!-- deploy-trigger: 7f77b6b6 -->

<!-- deploy-trigger-2: seed endpoint -->

<!-- deploy trigger: history scrub -->

<!-- deploy trigger: cron secret rotation -->
