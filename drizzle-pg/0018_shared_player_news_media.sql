-- Media attachments on shared_player_news for X posts (charts, graphs,
-- film clips): [{type: 'image'|'video', url, previewUrl?, alt?}], max 4.
-- Optional — older rows and payloads without media store '[]'.
-- Apply to production (Supabase SQL editor) before deploying matching code.
-- Do not run db:migrate against production; see MIGRATION-STATUS.md.

ALTER TABLE "shared_player_news"
  ADD COLUMN IF NOT EXISTS "media" jsonb NOT NULL DEFAULT '[]'::jsonb;
