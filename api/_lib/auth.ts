/**
 * Shared Supabase auth + Sleeper-connection lookup for API routes.
 *
 * Mirrors the pattern already used by `api/user.ts` (kept as-is): verify the
 * caller's Supabase JWT with the anon-key client, then read their row from
 * `sleeper_connections` with the service database connection.
 */
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { readSupabasePublicEnv } from "./api-utils.js";
import { getDb } from "./db.js";

export type AuthUser = { id: string; email?: string | null };

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const supabaseEnv = readSupabasePublicEnv();
  if (!supabaseEnv) return null;

  const supabase = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email };
}

export type SleeperConnection = { sleeperUserId: string; sleeperUsername: string };

export async function getSleeperConnection(userId: string): Promise<SleeperConnection | null> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT sleeper_user_id, sleeper_username FROM sleeper_connections WHERE user_id = ${userId}
  `);
  if (result.length === 0) return null;
  return {
    sleeperUserId: result[0].sleeper_user_id as string,
    sleeperUsername: result[0].sleeper_username as string,
  };
}

/**
 * Resolve the request to a Sleeper user id, or null when the request is
 * unauthenticated or the user has not connected a Sleeper account yet.
 */
export async function resolveSleeperUserId(req: Request): Promise<string | null> {
  const user = await getAuthUser(req);
  if (!user) return null;
  const connection = await getSleeperConnection(user.id);
  return connection?.sleeperUserId ?? null;
}
