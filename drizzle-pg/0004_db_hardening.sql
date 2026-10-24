-- Database hardening from Supabase advisor + query-path review.
-- Indexes for hot paths, owner RLS, auth.uid() initplan fix, revoke TRUNCATE.
-- Originally hand-applied to production on 2026-10-07; now journal entry 0004
-- (applied by db:migrate on fresh databases). Do not run db:migrate against
-- production: it lacks drizzle.__drizzle_migrations and 0001 is not idempotent.
-- See MIGRATION-STATUS.md.

-- 1) Unindexed FK used by news reads and ON DELETE CASCADE
CREATE INDEX IF NOT EXISTS "player_news_items_run_id_idx"
  ON "player_news_items" ("run_id");

-- 2) Value-history hot path: format + players + date order
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_value_snapshots_format_player_date_idx"
  ON "player_value_snapshots" ("format_key", "player_id", "snapshot_date" DESC);

-- 3) Dashboard vegas lookup by season/week (not only PK id)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vegas_projection_snapshots_season_week_idx"
  ON "vegas_projection_snapshots" ("season", "week");

-- 4) Chart-view upsert natural key (closes select-then-write races)
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_chart_views_user_dataset_name_uidx"
  ON "saved_chart_views" ("user_id", "dataset", "name");

-- 5) Owner RLS for saved chart views (defense in depth; API still scopes by user_id)
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'saved_chart_views'
      AND policyname = 'Users manage own chart views'
  ) THEN
    CREATE POLICY "Users manage own chart views" ON "saved_chart_views"
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- 6) Fix sleeper_connections RLS initplan (auth.uid() → (select auth.uid()))
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can view own connection" ON "sleeper_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can insert own connection" ON "sleeper_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own connection" ON "sleeper_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can delete own connection" ON "sleeper_connections";

--> statement-breakpoint
CREATE POLICY "Users can view own connection" ON "sleeper_connections"
  FOR SELECT USING ((select auth.uid()) = user_id);

--> statement-breakpoint
CREATE POLICY "Users can insert own connection" ON "sleeper_connections"
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

--> statement-breakpoint
CREATE POLICY "Users can update own connection" ON "sleeper_connections"
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

--> statement-breakpoint
CREATE POLICY "Users can delete own connection" ON "sleeper_connections"
  FOR DELETE USING ((select auth.uid()) = user_id);

-- 7) TRUNCATE bypasses RLS — do not leave it granted to API roles
--> statement-breakpoint
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
