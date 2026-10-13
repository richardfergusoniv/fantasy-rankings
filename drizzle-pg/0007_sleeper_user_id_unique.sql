-- Enforce one Supabase user per Sleeper account at the database layer.
-- Application code already rejects link attempts that would collide.
CREATE UNIQUE INDEX IF NOT EXISTS "sleeper_connections_sleeper_user_id_uidx"
  ON "sleeper_connections" ("sleeper_user_id");
