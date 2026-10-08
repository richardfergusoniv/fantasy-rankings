# Fantasy Rankings

Fantasy football rankings app with Vegas projections, Sleeper integration, and a props aggregator pipeline.

## Structure

- `frontend/` — Vite + React app
- `api/` — Vercel serverless routes (see `api/README.md`)
- `drizzle-pg/` — Postgres migrations applied with the `db:*` scripts (see `MIGRATION-STATUS.md`)
- `app/` — unmodified Hatch source. `app/drizzle/` is old SQLite history and is not the Supabase migration path
- `pipeline/` — Props aggregator: pulls from 6 providers, builds consensus projections

## Status

🚧 **Migration in progress** — Moving from Hatch artifact runtime to Vercel + Supabase.

## License

TBD

<!-- deploy-trigger: 7f77b6b6 -->

<!-- deploy-trigger-2: seed endpoint -->

<!-- deploy trigger: history scrub -->

<!-- deploy trigger: cron secret rotation -->
