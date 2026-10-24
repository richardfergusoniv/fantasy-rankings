-- Sleeper connections become nonexclusive follows; writes go through the API.
-- Security audit: POST /api/user cannot verify Sleeper ownership, so a
-- first-claim reservation let any registrant squat on someone else's account.
-- Connecting is now "follow this public Sleeper account" — the linked Sleeper
-- id alone grants no rights. Connection mutations run only through the API
-- (service role), so anon/authenticated direct writes are revoked. Hand-apply
-- to production. Not a drizzle-kit journal entry. See MIGRATION-STATUS.md.

-- 1) A Sleeper id may be followed by more than one user (nonunique index stays).
DROP INDEX IF EXISTS "sleeper_connections_sleeper_user_id_uidx";

-- 2) No client-side mutations: drop the write policies and revoke the grants.
DROP POLICY IF EXISTS "Users can insert own connection" ON "sleeper_connections";
DROP POLICY IF EXISTS "Users can update own connection" ON "sleeper_connections";
DROP POLICY IF EXISTS "Users can delete own connection" ON "sleeper_connections";

REVOKE INSERT, UPDATE, DELETE ON "sleeper_connections" FROM anon, authenticated;
