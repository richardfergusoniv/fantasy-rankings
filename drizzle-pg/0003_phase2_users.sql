-- Phase 2: User accounts and Sleeper connections
-- Links Supabase Auth users to their Sleeper accounts
-- Hand-applied to production. Not a drizzle-kit journal entry.
-- Not safe to re-run: CREATE POLICY below has no IF NOT EXISTS.
-- See MIGRATION-STATUS.md.

-- Table to store Sleeper account connections
CREATE TABLE IF NOT EXISTS "sleeper_connections" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "sleeper_user_id" text NOT NULL,
  "sleeper_username" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sleeper_connections_sleeper_user_id_idx" ON "sleeper_connections" ("sleeper_user_id");

-- Enable RLS
ALTER TABLE "sleeper_connections" ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own connection
CREATE POLICY "Users can view own connection" ON "sleeper_connections"
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connection" ON "sleeper_connections"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connection" ON "sleeper_connections"
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connection" ON "sleeper_connections"
  FOR DELETE USING (auth.uid() = user_id);
