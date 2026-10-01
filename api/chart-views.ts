import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./_lib/db";
import {
  badRequest,
  getRequestUser,
  internalError,
  json,
  methodNotAllowed,
  unauthorized,
} from "./_lib/api-utils";

/**
 * GET /api/chart-views — list the caller's saved chart views.
 * POST /api/chart-views — create or update (upsert by dataset + name).
 *
 * Replaces `listSavedChartViews` / `saveChartView`.
 * Auth: Supabase JWT in the Authorization header (Bearer token).
 * Views are scoped to the authenticated user's `user_id`.
 */

const chartDatasetSchema = z.enum(["advanced", "projections"]);
const chartPositionSchema = z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]);
const chartWindowSchema = z.enum(["season", "rolling17"]);
const chartPlotLimitSchema = z.enum(["24", "40", "all"]);

const savedChartViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataset: chartDatasetSchema,
  position: chartPositionSchema,
  xMetric: z.string(),
  yMetric: z.string(),
  window: chartWindowSchema,
  showQuadrants: z.boolean(),
  xPercentile: z.number().int().min(1).max(99),
  yPercentile: z.number().int().min(1).max(99),
  plotLimit: chartPlotLimitSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const savedChartViewInputSchema = savedChartViewSchema.pick({
  dataset: true,
  position: true,
  xMetric: true,
  yMetric: true,
  window: true,
  showQuadrants: true,
  xPercentile: true,
  yPercentile: true,
  plotLimit: true,
}).extend({ name: z.string().trim().min(1).max(80) });

function serializeSavedChartView(row: typeof schema.savedChartViews.$inferSelect): z.infer<typeof savedChartViewSchema> {
  return {
    id: row.id,
    name: row.name,
    dataset: row.dataset,
    position: row.position,
    xMetric: row.xMetric,
    yMetric: row.yMetric,
    window: row.window,
    showQuadrants: row.showQuadrants,
    xPercentile: row.xPercentile,
    yPercentile: row.yPercentile,
    plotLimit: row.plotLimit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function handleGet(req: Request): Promise<Response> {
  const user = await getRequestUser(req);
  if (!user) return unauthorized("Saved chart views require sign-in.");
  const rows = await db.select().from(schema.savedChartViews)
    .where(eq(schema.savedChartViews.userId, user.id))
    .orderBy(asc(schema.savedChartViews.createdAt));
  return json({ views: rows.map(serializeSavedChartView) });
}

async function handlePost(req: Request): Promise<Response> {
  const user = await getRequestUser(req);
  if (!user) return unauthorized("Saved chart views require sign-in.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }
  const parsed = savedChartViewInputSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid chart view", parsed.error.issues);
  const args = parsed.data;

  const name = args.name.trim();
  const matches = await db.select().from(schema.savedChartViews).where(and(
    eq(schema.savedChartViews.userId, user.id),
    eq(schema.savedChartViews.dataset, args.dataset),
    eq(schema.savedChartViews.name, name),
  )).limit(1);
  const existing = matches[0];
  const now = new Date();
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.createdAt ?? now;
  const values = {
    id,
    userId: user.id,
    name,
    dataset: args.dataset,
    position: args.position,
    xMetric: args.xMetric,
    yMetric: args.yMetric,
    window: args.window,
    showQuadrants: args.showQuadrants,
    xPercentile: args.xPercentile,
    yPercentile: args.yPercentile,
    plotLimit: args.plotLimit,
    createdAt,
    updatedAt: now,
  };
  await db.insert(schema.savedChartViews).values(values).onConflictDoUpdate({
    target: schema.savedChartViews.id,
    set: {
      userId: user.id,
      name,
      dataset: args.dataset,
      position: args.position,
      xMetric: args.xMetric,
      yMetric: args.yMetric,
      window: args.window,
      showQuadrants: args.showQuadrants,
      xPercentile: args.xPercentile,
      yPercentile: args.yPercentile,
      plotLimit: args.plotLimit,
      updatedAt: now,
    },
  });
  return json({ view: serializeSavedChartView(values) });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    try {
      return await handleGet(req);
    } catch (err) {
      return internalError(err);
    }
  }
  if (req.method === "POST") {
    try {
      return await handlePost(req);
    } catch (err) {
      return internalError(err);
    }
  }
  if (req.method === "DELETE") {
    try {
      return await handleDelete(req);
    } catch (err) {
      return internalError(err);
    }
  }
  return methodNotAllowed(["GET", "POST", "DELETE"]);
}

/**
 * DELETE /api/chart-views?id=xxx — delete the caller's saved chart view by id.
 * (Merged from /api/chart-views/[id] to stay within Vercel Hobby function limits.)
 */
async function handleDelete(req: Request): Promise<Response> {
  const user = await getRequestUser(req);
  if (!user) return unauthorized("Saved chart views require sign-in.");

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return badRequest("Missing chart view id.");

  const rowFilter = and(eq(schema.savedChartViews.id, id), eq(schema.savedChartViews.userId, user.id));
  const rows = await db.select({ id: schema.savedChartViews.id }).from(schema.savedChartViews).where(rowFilter).limit(1);
  const deleted = Boolean(rows[0]);
  if (deleted) {
    await db.delete(schema.savedChartViews).where(rowFilter);
  }
  return json({ ok: true, deleted });
}
