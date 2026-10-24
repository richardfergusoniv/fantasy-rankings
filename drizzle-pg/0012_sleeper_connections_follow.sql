-- Sleeper connections become nonexclusive follows; writes go through the API.
-- Security audit: POST /api/user cannot verify Sleeper ownership, so a
-- first-claim reservation let any registrant squat on someone else's account.
-- Connecting is now "follow this public Sleeper account" — the linked Sleeper
-- id alone grants no rights. Connection mutations run only through the API
-- (service role), so anon/authenticated direct writes are revoked. Journal
-- entry 0012 (after 0011_build_leases_rate_limits); production is still
-- hand-applied. See MIGRATION-STATUS.md.

-- 1) A Sleeper id may be followed by more than one user (nonunique index stays).
DROP INDEX IF EXISTS "sleeper_connections_sleeper_user_id_uidx";

--> statement-breakpoint
-- 2) No client-side mutations: drop the write policies and revoke the grants.
DROP POLICY IF EXISTS "Users can insert own connection" ON "sleeper_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can update own connection" ON "sleeper_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS "Users can delete own connection" ON "sleeper_connections";

--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "sleeper_connections" FROM anon, authenticated;
