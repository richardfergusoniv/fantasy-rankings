# Fantasy Rankings

Fantasy football rankings app with Vegas projections, Sleeper integration, and a props aggregator pipeline.

## Structure

- `frontend/` — Vite + React app
- `api/` — Vercel serverless routes (see `api/README.md`)
- `drizzle-pg/` — Postgres SQL for Supabase. All migrations (`0001`–`0010`) are drizzle-kit journal entries; `npm run db:migrate` reproduces the full schema on a fresh database (see `MIGRATION-STATUS.md`)
- `docs/` — notes from the original Hatch app (its source was removed after the migration)
- `pipeline/` — Props aggregator: pulls from 6 providers, builds consensus projections

## Status

Running on Vercel + Supabase. Database migrations are tracked in `drizzle-pg/` and verified from scratch in CI (see `MIGRATION-STATUS.md`).

## License

TBD

<!-- deploy-trigger: 7f77b6b6 -->

<!-- deploy-trigger-2: seed endpoint -->

<!-- deploy trigger: history scrub -->

<!-- deploy trigger: cron secret rotation -->
