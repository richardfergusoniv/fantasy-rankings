/**
 * /api/user
 * GET: Returns user profile and Sleeper connection status
 * POST: Connect Sleeper account by username { username: string }
 * DELETE: Unlink the Sleeper connection
 */
import { eq } from "drizzle-orm";
import {
  getAuthUser,
  isReservedOwnerSleeperClaim,
  isUniqueViolation,
  readOwnerSleeperUserId,
  readOwnerUserId,
  sleeperIdLinkedToOtherUser,
} from "./_lib/auth.js";
import { getDb, schema } from "./_lib/db.js";

const SLEEPER_LINK_CONFLICT = "This Sleeper account is already linked to another user";

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();
    const [row] = await db
      .select({
        sleeperUserId: schema.sleeperConnections.sleeperUserId,
        sleeperUsername: schema.sleeperConnections.sleeperUsername,
      })
      .from(schema.sleeperConnections)
      .where(eq(schema.sleeperConnections.userId, user.id))
      .limit(1);

    const connection = row
      ? {
          sleeperUserId: row.sleeperUserId,
          sleeperUsername: row.sleeperUsername,
        }
      : null;

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
    const username = typeof body?.username === "string" ? body.username.trim() : "";
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

    const sleeperUser = (await sleeperRes.json()) as { user_id?: string; username?: string } | null;
    // Sleeper returns HTTP 200 with a JSON null body for an unknown username.
    if (sleeperUser == null) {
      return Response.json({ error: "Sleeper user not found" }, { status: 404 });
    }
    if (typeof sleeperUser.user_id !== "string" || typeof sleeperUser.username !== "string") {
      return Response.json({ error: "Invalid Sleeper user response" }, { status: 502 });
    }

    // Configured owner Sleeper id is reserved for OWNER_USER_ID when both are set.
    if (
      isReservedOwnerSleeperClaim({
        sleeperUserId: sleeperUser.user_id,
        requestingUserId: user.id,
        ownerSleeperUserId: readOwnerSleeperUserId(),
        ownerUserId: readOwnerUserId(),
      })
    ) {
      return Response.json({ error: SLEEPER_LINK_CONFLICT }, { status: 409 });
    }

    const db = getDb();
    // One indexed lookup: refuse claiming a Sleeper id already linked elsewhere.
    const [existingLink] = await db
      .select({ userId: schema.sleeperConnections.userId })
      .from(schema.sleeperConnections)
      .where(eq(schema.sleeperConnections.sleeperUserId, sleeperUser.user_id))
      .limit(1);
    if (sleeperIdLinkedToOtherUser(existingLink?.userId, user.id)) {
      return Response.json({ error: SLEEPER_LINK_CONFLICT }, { status: 409 });
    }

    const now = new Date();
    try {
      await db
        .insert(schema.sleeperConnections)
        .values({
          userId: user.id,
          sleeperUserId: sleeperUser.user_id,
          sleeperUsername: sleeperUser.username,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.sleeperConnections.userId,
          set: {
            sleeperUserId: sleeperUser.user_id,
            sleeperUsername: sleeperUser.username,
            updatedAt: now,
          },
        });
    } catch (err) {
      // Race: two callers passed the pre-check; unique index on sleeper_user_id wins.
      if (isUniqueViolation(err)) {
        return Response.json({ error: SLEEPER_LINK_CONFLICT }, { status: 409 });
      }
      throw err;
    }

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

export async function DELETE(req: Request): Promise<Response> {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();
    await db
      .delete(schema.sleeperConnections)
      .where(eq(schema.sleeperConnections.userId, user.id));

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[user DELETE] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
