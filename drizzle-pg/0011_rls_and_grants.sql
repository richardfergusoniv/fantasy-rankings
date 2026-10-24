-- Explicit grants + RLS for every public table.
-- Hand-apply like 0002–0010. Rerun-safe: REVOKE, GRANT, and
-- ENABLE ROW LEVEL SECURITY are all idempotent.
--
-- Browser-facing Supabase roles (anon, authenticated) get no table
-- privileges on server-only tables, and RLS is enabled everywhere as
-- defense in depth. The API connects through DATABASE_URL with a server
-- role that owns the tables / bypasses RLS, so route handlers keep working.
-- User-owned tables keep authenticated grants scoped by owner RLS policies
-- (auth.uid() = user_id); anon gets nothing.
--
-- Verified by drizzle-pg/verify_rls.sh (CI job `db-rls`).

-- 1) RLS on every public table. Deny-by-default for roles without a
--    matching policy; already-enabled tables are unaffected.
ALTER TABLE "source_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "historical_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vegas_projection_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vegas_projection_upload_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_value_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projection_accuracy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_chart_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_news_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_news_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sleeper_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_player_news" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prop_line_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scoring_weights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scoring_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_preferences" ENABLE ROW LEVEL SECURITY;

-- 2) anon (pre-login browser role) gets no direct table access at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 3) authenticated gets nothing on server-only tables. These are written
--    and read only through the API's server role (cron ingest, caches,
--    calibration data, snapshots).
REVOKE ALL ON
  "source_cache",
  "historical_trades",
  "vegas_projection_snapshots",
  "vegas_projection_upload_chunks",
  "player_value_snapshots",
  "projection_accuracy",
  "player_news_runs",
  "player_news_items",
  "shared_player_news",
  "prop_line_snapshots",
  "scoring_weights",
  "scoring_snapshots"
FROM authenticated;

-- 4) authenticated keeps row-level access only to user-owned tables.
--    Owner policies (0003/0004/0009/0010) restrict rows to auth.uid().
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "sleeper_connections",
  "saved_chart_views",
  "chat_conversations",
  "chat_messages",
  "chat_preferences"
TO authenticated;

-- 5) Future tables must not silently inherit API-role privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
