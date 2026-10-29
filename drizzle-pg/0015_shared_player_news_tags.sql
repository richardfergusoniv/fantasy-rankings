-- Optional tags on shared_player_news (e.g. "dynasty" for dynasty-only X posts).
-- Redraft reads exclude rows tagged "dynasty"; dynasty leagues see all tags.
-- Apply to production (Supabase SQL editor) before deploying matching code.
-- Do not run db:migrate against production; see MIGRATION-STATUS.md.

ALTER TABLE "shared_player_news"
  ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;
