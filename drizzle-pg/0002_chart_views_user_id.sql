-- Phase 2: replace Hatch-era owner columns with Supabase Auth user_id.
--
-- The Hatch migration (`owner_source`/`owner_key`) supported three viewer
-- kinds (owner/local/cloudflare). On Vercel + Supabase there is exactly one
-- identity: `auth.users.id`. Fresh beta, so no data migration is needed —
-- the Hatch app.db rows were never seeded into this database.

ALTER TABLE "saved_chart_views"
  DROP CONSTRAINT IF EXISTS "saved_chart_views_owner_source_check",
  DROP COLUMN IF EXISTS "owner_source",
  DROP COLUMN IF EXISTS "owner_key",
  ADD COLUMN IF NOT EXISTS "user_id" uuid NOT NULL REFERENCES auth.users("id") ON DELETE CASCADE;

DROP INDEX IF EXISTS "saved_chart_views_owner_idx";
CREATE INDEX IF NOT EXISTS "saved_chart_views_user_id_idx" ON "saved_chart_views" ("user_id");
