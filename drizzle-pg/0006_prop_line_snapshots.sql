-- Dated consensus prop-line snapshots for line-movement history.
-- One compact row per player/stat per pull (~2k rows/pull).
-- Hand-apply like 0002–0005. Not a drizzle-kit journal entry yet.
-- See MIGRATION-STATUS.md. Do not run db:migrate against production blindly.

CREATE TABLE IF NOT EXISTS "prop_line_snapshots" (
  "pulled_at" timestamp with time zone NOT NULL,
  "player_id" text NOT NULL,
  "stat" text NOT NULL,
  "line" real NOT NULL,
  "median_over_odds" real,
  "median_under_odds" real,
  "book_count" smallint NOT NULL,
  "week" smallint NOT NULL,
  "season" smallint NOT NULL,
  CONSTRAINT "prop_line_snapshots_pkey"
    PRIMARY KEY ("pulled_at", "player_id", "stat")
);

-- Hot path for per-player line movement charts.
CREATE INDEX IF NOT EXISTS "prop_line_snapshots_player_stat_pulled_idx"
  ON "prop_line_snapshots" ("player_id", "stat", "pulled_at" DESC);

CREATE INDEX IF NOT EXISTS "prop_line_snapshots_season_week_idx"
  ON "prop_line_snapshots" ("season", "week");

-- Server-only table (cron ingest via DATABASE_URL). RLS on with no
-- anon/authenticated policies blocks direct client access; the Postgres
-- role used by the API bypasses RLS.
ALTER TABLE "prop_line_snapshots" ENABLE ROW LEVEL SECURITY;
