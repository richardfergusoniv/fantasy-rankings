-- Team / league-scoped X news rows (no player attachment).
-- Adds scope, allows null player_id / team for non-player rows, and unique
-- indexes so re-sending the same team or league post does not duplicate.
-- Existing player rows keep scope='player' and are unchanged.
-- Apply to production (Supabase SQL editor) before deploying matching code.
-- Do not run db:migrate against production; see MIGRATION-STATUS.md.

ALTER TABLE "shared_player_news"
  ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'player' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_player_news"
  ALTER COLUMN "player_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared_player_news"
  ALTER COLUMN "team" DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shared_player_news_scope_check'
  ) THEN
    ALTER TABLE "shared_player_news"
      ADD CONSTRAINT "shared_player_news_scope_check"
      CHECK ("scope" IN ('player', 'team', 'league'));
  END IF;
END $$;
--> statement-breakpoint
-- One team-scoped row per (source, external_id, team).
-- Dedupe by external_id (X post_id) only — a source_url unique would drop a
-- distinct post that reused a non-status URL (blog, box score, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_external_team_uidx"
  ON "shared_player_news" ("source", "external_id", "team")
  WHERE "scope" = 'team' AND "external_id" IS NOT NULL;
--> statement-breakpoint
-- One league-scoped row per (source, external_id).
CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_external_league_uidx"
  ON "shared_player_news" ("source", "external_id")
  WHERE "scope" = 'league' AND "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_player_news_scope_idx"
  ON "shared_player_news" ("scope");
