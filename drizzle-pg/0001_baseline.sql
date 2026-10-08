-- Fantasy Rankings — Postgres baseline migration
-- Generated from lib/schema.ts (converted from SQLite schema).
-- This is a FRESH baseline; the 17 SQLite migrations were not converted 1:1.
-- Apply with: psql $DATABASE_URL -f drizzle-pg/0001_baseline.sql
-- Or via Supabase SQL editor / drizzle-kit migrate on a fresh database.
-- Do not re-apply this file to production. It creates saved_chart_views_owner_idx
-- on owner_source/owner_key, which 0002 dropped. See MIGRATION-STATUS.md.

CREATE TABLE IF NOT EXISTS "source_cache" (
  "cache_key" text PRIMARY KEY NOT NULL,
  "payload" text NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "historical_trades" (
  "id" text PRIMARY KEY NOT NULL,
  "root_league_id" text NOT NULL,
  "sleeper_league_id" text NOT NULL,
  "season" integer NOT NULL,
  "payload" text NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "historical_trades_root_league_idx" ON "historical_trades" ("root_league_id");
CREATE INDEX IF NOT EXISTS "historical_trades_season_idx" ON "historical_trades" ("season");

CREATE TABLE IF NOT EXISTS "vegas_projection_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "built_at" timestamp with time zone NOT NULL,
  "source" text NOT NULL,
  "payload" text NOT NULL,
  "stored_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "vegas_projection_upload_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "upload_key" text NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "built_at" timestamp with time zone NOT NULL,
  "source" text NOT NULL,
  "leagues_payload" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "chunk_count" integer NOT NULL,
  "projections_payload" text NOT NULL,
  "stored_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "player_value_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "snapshot_date" text NOT NULL,
  "format_key" text NOT NULL,
  "player_id" text NOT NULL,
  "player_name" text NOT NULL,
  "position" text NOT NULL,
  "value" integer NOT NULL,
  "captured_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "projection_accuracy" (
  "id" text PRIMARY KEY NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "league_id" text NOT NULL,
  "scoring" text NOT NULL,
  "player_id" text NOT NULL,
  "player_name" text NOT NULL,
  "position" text NOT NULL,
  "vegas_projection" integer NOT NULL,
  "first_down_projection" integer,
  "actual_score" integer,
  "captured_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "saved_chart_views" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_source" text,
  "owner_key" text,
  "name" text NOT NULL,
  "dataset" text NOT NULL,
  "position" text NOT NULL,
  "x_metric" text NOT NULL,
  "y_metric" text NOT NULL,
  "window" text NOT NULL,
  "show_quadrants" boolean DEFAULT true NOT NULL,
  "x_percentile" integer DEFAULT 50 NOT NULL,
  "y_percentile" integer DEFAULT 50 NOT NULL,
  "plot_limit" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "saved_chart_views_owner_source_check" CHECK ("owner_source" IN ('owner','local','cloudflare')),
  CONSTRAINT "saved_chart_views_dataset_check" CHECK ("dataset" IN ('advanced','projections')),
  CONSTRAINT "saved_chart_views_position_check" CHECK ("position" IN ('QB','RB','WR','TE','K','DEF')),
  CONSTRAINT "saved_chart_views_window_check" CHECK ("window" IN ('season','rolling17')),
  CONSTRAINT "saved_chart_views_plot_limit_check" CHECK ("plot_limit" IN ('24','40','all'))
);
CREATE INDEX IF NOT EXISTS "saved_chart_views_dataset_idx" ON "saved_chart_views" ("dataset");
CREATE INDEX IF NOT EXISTS "saved_chart_views_owner_idx" ON "saved_chart_views" ("owner_source","owner_key");

CREATE TABLE IF NOT EXISTS "player_news_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "checked_at" timestamp with time zone NOT NULL,
  "item_count" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "player_news_items" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "player_news_runs"("id") ON DELETE CASCADE,
  "player_id" text NOT NULL,
  "player" text NOT NULL,
  "team" text NOT NULL,
  "change" text NOT NULL,
  "leagues_json" text NOT NULL,
  "news_type" text DEFAULT 'roster' NOT NULL,
  "availability_json" text,
  "role_context" text NOT NULL,
  "source_label" text NOT NULL,
  "source_url" text NOT NULL,
  "source_published_at" timestamp with time zone,
  CONSTRAINT "player_news_items_news_type_check" CHECK ("news_type" IN ('roster','waiver','headline'))
);
