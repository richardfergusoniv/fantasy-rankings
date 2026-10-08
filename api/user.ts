/**
 * /api/user
 * GET: Returns user profile and Sleeper connection status
 * POST: Connect Sleeper account by username { username: string }
 */
import { createClient } from "@supabase/supabase-js";
import { readSupabasePublicEnv } from "./_lib/api-utils.js";
import { getDb } from "./_lib/db.js";
import { sql } from "drizzle-orm";

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const supabaseEnv = readSupabasePublicEnv();
  if (!supabaseEnv) return null;

  const supabase = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();
    const result = await db.execute(sql`
      SELECT sleeper_user_id, sleeper_username FROM sleeper_connections WHERE user_id = ${user.id}
    `);

    const connection = result.length > 0 ? {
      sleeperUserId: result[0].sleeper_user_id,
      sleeperUsername: result[0].sleeper_username,
    } : null;

    return Response.json({
      user: { id: user.id, email: user.email },
      connection,
    });
  } catch (err) {
    console.error("[user GET] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const username = body?.username?.trim();
    if (!username) {
      return Response.json({ error: "Username required" }, { status: 400 });
    }

    // Resolve Sleeper username → user ID
    const sleeperRes = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
    if (!sleeperRes.ok) {
      if (sleeperRes.status === 404) {
        return Response.json({ error: "Sleeper username not found" }, { status: 404 });
      }
      return Response.json({ error: "Failed to look up Sleeper user" }, { status: 502 });
    }

    const sleeperUser = await sleeperRes.json();

    const db = getDb();
    await db.execute(sql`
      INSERT INTO sleeper_connections (user_id, sleeper_user_id, sleeper_username, updated_at)
      VALUES (${user.id}, ${sleeperUser.user_id}, ${sleeperUser.username}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        sleeper_user_id = EXCLUDED.sleeper_user_id,
        sleeper_username = EXCLUDED.sleeper_username,
        updated_at = now()
    `);

    return Response.json({
      ok: true,
      sleeperUserId: sleeperUser.user_id,
      sleeperUsername: sleeperUser.username,
    });
  } catch (err) {
    console.error("[user POST] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
