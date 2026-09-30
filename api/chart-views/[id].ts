import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../lib/db";
import {
  badRequest,
  getRequestUser,
  internalError,
  json,
  methodNotAllowed,
  unauthorized,
} from "../../lib/api-utils";

/**
 * DELETE /api/chart-views/[id]
 *
 * Replaces `deleteChartView`. Deletes the caller's saved chart view by id.
 * Auth: Supabase JWT in the Authorization header (Bearer token).
 * The row must belong to the authenticated user (`user_id` match).
 */

const deleteChartViewResponse = z.object({ ok: z.literal(true), deleted: z.boolean() });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "DELETE") return methodNotAllowed(["DELETE"]);

  try {
    const user = await getRequestUser(req);
    if (!user) return unauthorized("Saved chart views require sign-in.");

    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = segments[segments.length - 1] ?? "";
    if (!id) return badRequest("Missing chart view id.");

    const rowFilter = and(eq(schema.savedChartViews.id, id), eq(schema.savedChartViews.userId, user.id));
    const rows = await db.select({ id: schema.savedChartViews.id }).from(schema.savedChartViews).where(rowFilter).limit(1);
    const deleted = Boolean(rows[0]);
    if (deleted) {
      await db.delete(schema.savedChartViews).where(rowFilter);
    }
    return json(deleteChartViewResponse.parse({ ok: true, deleted }));
  } catch (err) {
    return internalError(err);
  }
}
