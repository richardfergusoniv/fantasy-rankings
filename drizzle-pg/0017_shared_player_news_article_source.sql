-- Allow source='article' for RSS/Atom feed rows in shared_player_news.
-- Apply to production (Supabase SQL editor) before deploying matching code.
-- Do not run db:migrate against production; see MIGRATION-STATUS.md.

ALTER TABLE "shared_player_news" DROP CONSTRAINT IF EXISTS "shared_player_news_source_check";
--> statement-breakpoint
ALTER TABLE "shared_player_news"
  ADD CONSTRAINT "shared_player_news_source_check"
  CHECK ("source" IN ('sleeper', 'x', 'nflverse', 'article'));
