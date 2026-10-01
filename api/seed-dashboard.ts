/**
 * TEMPORARY: Seed the dashboard snapshot from the migration.
 * DELETE THIS FILE AFTER USE.
 */
import { getDb } from "./_lib/db.js";
import { sourceCache } from "./_lib/schema.js";
import { readFileSync } from "fs";
import { join } from "path";

export async function POST(req: Request): Promise<Response> {
  try {
    // Read the dashboard JSON from the migration workspace
    // In production, we'll fetch it from a URL instead
    const dashboardUrl = new URL(req.url, "https://localhost").searchParams.get("url");
    if (!dashboardUrl) {
      return Response.json({ error: "Missing ?url= parameter pointing to dashboard JSON" }, { status: 400 });
    }

    console.log("[seed] Fetching dashboard from:", dashboardUrl);
    const res = await fetch(dashboardUrl);
    if (!res.ok) {
      return Response.json({ error: `Failed to fetch: ${res.status}` }, { status: 500 });
    }
    
    const dashboard = await res.json();
    console.log("[seed] Dashboard fetched, size:", JSON.stringify(dashboard).length);

    const db = getDb();
    const now = new Date();
    
    await db.insert(sourceCache).values({
      cacheKey: "dashboard-live-projections-v25",
      payload: dashboard,
      fetchedAt: now,
    }).onConflictDoUpdate({
      target: sourceCache.cacheKey,
      set: { payload: dashboard, fetchedAt: now },
    });

    console.log("[seed] Dashboard seeded successfully");
    return Response.json({ ok: true, seededAt: now.toISOString() });
  } catch (err) {
    console.error("[seed] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
