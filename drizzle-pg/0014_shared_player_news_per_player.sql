-- Allow one shared_player_news row per (post, player) so a roundup X post
-- can attach to several players. Drops the old post/URL-only unique indexes
-- and replaces them with composites that include player_id.
--
-- Apply to production (Supabase SQL editor) before deploying the matching
-- ingest/ticker code. Do not run db:migrate against production; see
-- MIGRATION-STATUS.md.

DROP INDEX IF EXISTS "shared_player_news_source_url_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "shared_player_news_source_external_uidx";
--> statement-breakpoint
-- URL-only and source_url rows: unique per player.
CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_url_player_uidx"
  ON "shared_player_news" ("source_url", "player_id");
--> statement-breakpoint
-- X post_id (and other external ids): unique per player. Multiple NULLs
-- for external_id are still allowed (Postgres UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_external_player_uidx"
  ON "shared_player_news" ("source", "external_id", "player_id");
