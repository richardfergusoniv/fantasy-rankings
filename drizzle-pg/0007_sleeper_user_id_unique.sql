-- Originally hand-applied; now journal entry 0007, applied by `npm run db:migrate`.
-- See MIGRATION-STATUS.md.
-- Whole-file rerun-safe: unique index uses IF NOT EXISTS; preflight is read-only.
-- Data preservation: if duplicate sleeper_user_id rows exist, this script aborts
-- without deleting or rewriting links. Resolve duplicates manually (decide which
-- Supabase user keeps each Sleeper id), then re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sleeper_connections"
    GROUP BY "sleeper_user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'sleeper_connections has duplicate sleeper_user_id values; resolve manually before creating sleeper_connections_sleeper_user_id_uidx';
  END IF;
END $$;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sleeper_connections_sleeper_user_id_uidx"
  ON "sleeper_connections" ("sleeper_user_id");
