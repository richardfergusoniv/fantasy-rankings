/**
 * Shared Supabase auth + Sleeper-connection lookup for API routes.
 *
 * Verify the caller's Supabase JWT with the anon-key client, then read their
 * row from `sleeper_connections` with the service database connection.
 */
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { readSupabasePublicEnv } from "./api-utils.js";
import { getDb, schema } from "./db.js";

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
  const [row] = await db
    .select({
      sleeperUserId: schema.sleeperConnections.sleeperUserId,
      sleeperUsername: schema.sleeperConnections.sleeperUsername,
    })
    .from(schema.sleeperConnections)
    .where(eq(schema.sleeperConnections.userId, userId))
    .limit(1);
  return row ?? null;
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

/**
 * Sleeper user id for scheduled jobs that have no signed-in user.
 * Set `OWNER_SLEEPER_USER_ID` in the Vercel project and, for the props
 * pipeline, as a GitHub Actions repository variable. Never hardcode it.
 */
export function readOwnerSleeperUserId(): string | null {
  const id = process.env.OWNER_SLEEPER_USER_ID?.trim();
  return id ? id : null;
}
