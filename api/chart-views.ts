import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  badRequest,
  getRequestUser,
  internalError,
  json,
  methodNotAllowed,
  unauthorized,
} from "./_lib/api-utils.js";

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

export type SavedChartView = z.infer<typeof savedChartViewSchema>;

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

export type SavedChartViewInput = z.infer<typeof savedChartViewInputSchema>;

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
  const now = new Date();
  await db.insert(schema.savedChartViews).values({
    id: crypto.randomUUID(),
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
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [
      schema.savedChartViews.userId,
      schema.savedChartViews.dataset,
      schema.savedChartViews.name,
    ],
    set: {
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

  const [saved] = await db.select().from(schema.savedChartViews).where(and(
    eq(schema.savedChartViews.userId, user.id),
    eq(schema.savedChartViews.dataset, args.dataset),
    eq(schema.savedChartViews.name, name),
  )).limit(1);
  if (!saved) return internalError(new Error("Failed to persist chart view."));
  return json({ view: serializeSavedChartView(saved) });
}

export async function GET(req: Request): Promise<Response> {
  try {
    return await handleGet(req);
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    return internalError(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    return await handleDelete(req);
  } catch (err) {
    return internalError(err);
  }
}

/**
 * DELETE /api/chart-views?id=xxx — delete the caller's saved chart view by id.
 * (Merged from /api/chart-views/[id] to stay within Vercel Hobby function limits.)
 */
async function handleDelete(req: Request): Promise<Response> {
  const user = await getRequestUser(req);
  if (!user) return unauthorized("Saved chart views require sign-in.");

  const url = new URL(req.url, "https://localhost");
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
