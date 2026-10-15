# Handoff: fantasy-rankings (week of Oct 19, 2026)

Live app: https://fantasy-rankings-ten.vercel.app · Supabase project `vjmyvpbshjwrrsbsocms` · Stack: TS / Vite / React / Recharts.

## Ground rules
- Owner is non-technical. Small UI-only fixes can merge once checks pass; behavior or data changes need his approval. Send screenshots before merging UI changes.
- Before merging: CI, CodeQL and CodeRabbit must all pass. CodeRabbit skips draft PRs, so mark PRs ready for review.
- Don't add UI text he didn't ask for. Green and red mean good and bad only.
- Vercel functions are at 12/12. Don't add new files under `api/` except in `api/_lib`.
- Keep Supabase egress low (free tier, 5 GB/month; database is about 377 MB of a 500 MB limit). Pace heavy verification or backfill runs.
- Check existing code and data before proposing new data sources. Don't add paid APIs (no paid historical line-movement data).
- Cron jobs run as `GET /api/cron/jobs?job=<name>` with `Authorization: Bearer $CRON_SECRET`.

## Recently shipped
- #120 Monitor team stats table (week by week).
- #121 Value-history x-axis starts at the first real data point (`frontend/src/value-history-domain.ts`).
- #122 During the offseason (Sleeper `season_type === "off"`), redraft value snapshots are skipped when the value is unchanged. Flat pre-July redraft rows were deleted.
- #123 Dynasty draft-pick value history (`FP_*` ids, position `PICK`). It's backfilled from 2026-01-01 (34,440 rows; 24 picks across 5 dynasty formats).

## Open work
### PR #124: props inside the Monitor game lines panel (branch `cursor/monitor-props-panel-224b`)
- Picking a game shows its spread and total, then that game's player props. An "All games" option lists every prop sorted by edge.
- Game lines get a projection from 2026 results, an edge, and each team's record against the spread and over/under.
- Each prop row shows a cell per past game: green if the player went over the current line, red if under, neutral for a push. The hit rate uses the same colors. Edge numbers stay uncolored.
- Line movement comes only from our own stored pulls in `prop_line_snapshots` (written by `POST /api/ingest/prop-line-snapshots`, helper `api/_lib/prop-line-snapshots.ts`). Stored history starts at 2026 week 6, so movement charts fill in week by week.
- Status: confirm checks are green, take screenshots (use a local build with mocked data if the preview login blocks you), and get the owner's approval before merging. It's a feature and data change.

### Follow-ups
- Check that Supabase egress stays under the roughly 86–92 MB/day baseline now that dashboard caching is in.
- Confirm the trade dialog and value charts show dynasty pick trends.
- Free data sources if needed: nflverse `games.csv` (closing lines and scores), nflverse `stats_player_week_2026.csv`, and the ESPN scoreboard for current lines.
