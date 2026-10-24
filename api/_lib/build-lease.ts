import { sql } from "drizzle-orm";
import { db } from "./db.js";

/**
 * Deployment-wide build lease (audit finding #9).
 *
 * In-process `Map` dedupe only covers one serverless instance; concurrent
 * cold starts could each kick off the same expensive build. The lease row in
 * `build_leases` makes the single-flight guarantee deployment-wide: claiming
 * is an atomic conditional upsert, so exactly one instance wins per resource.
 *
 * A finished row is kept (not deleted) with `status`/`last_error`, giving
 * callers structured failure state instead of a silently swallowed error.
 * `expires_at` bounds how long a crashed holder can block the resource.
 */

export type BuildLeaseRow = {
  resource: string;
  holder: string;
  status: "running" | "done" | "failed";
  lastError: string | null;
  acquiredAt: Date;
  expiresAt: Date;
  updatedAt: Date;
};

/** Minimal store surface so the orchestration is testable without Postgres. */
export type BuildLeaseStore = {
  claim(resource: string, holder: string, ttlMs: number): Promise<boolean>;
  finish(resource: string, holder: string, error: string | null): Promise<void>;
  read(resource: string): Promise<BuildLeaseRow | null>;
};

export function dashboardBuildLeaseResource(sleeperUserId: string): string {
  return `dashboard-build:${sleeperUserId}`;
}

/** Postgres-backed store. Claim wins only when no live lease exists. */
export const drizzleBuildLeaseStore: BuildLeaseStore = {
  async claim(resource, holder, ttlMs) {
    const rows = (await db.execute(sql`
      INSERT INTO build_leases (resource, holder, status, expires_at)
      VALUES (${resource}, ${holder}, 'running', now() + (${ttlMs} || ' milliseconds')::interval)
      ON CONFLICT (resource) DO UPDATE
        SET holder = EXCLUDED.holder,
            status = 'running',
            last_error = NULL,
            acquired_at = now(),
            expires_at = EXCLUDED.expires_at,
            updated_at = now()
        WHERE build_leases.status <> 'running'
           OR build_leases.expires_at <= now()
      RETURNING resource
    `)) as unknown as Array<{ resource: string }>;
    return rows.length > 0;
  },
  async finish(resource, holder, error) {
    await db.execute(sql`
      UPDATE build_leases
      SET status = ${error == null ? "done" : "failed"},
          last_error = ${error},
          expires_at = now(),
          updated_at = now()
      WHERE resource = ${resource} AND holder = ${holder}
    `);
  },
  async read(resource) {
    const rows = (await db.execute(sql`
      SELECT resource, holder, status, last_error, acquired_at, expires_at, updated_at
      FROM build_leases
      WHERE resource = ${resource}
      LIMIT 1
    `)) as unknown as Array<{
      resource: string;
      holder: string;
      status: "running" | "done" | "failed";
      last_error: string | null;
      acquired_at: Date;
      expires_at: Date;
      updated_at: Date;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      resource: row.resource,
      holder: row.holder,
      status: row.status,
      lastError: row.last_error,
      acquiredAt: new Date(row.acquired_at),
      expiresAt: new Date(row.expires_at),
      updatedAt: new Date(row.updated_at),
    };
  },
};

export type BuildLeaseOutcome<T> =
  | { status: "built"; result: T }
  | { status: "joined" }
  | { status: "failed"; error: unknown };

/**
 * Run `build` under the lease. When another instance already holds a live
 * lease this returns `{ status: "joined" }` without running the build, so
 * concurrent invocations produce exactly one build per resource.
 */
export async function runWithBuildLease<T>(
  store: BuildLeaseStore,
  resource: string,
  holder: string,
  ttlMs: number,
  build: () => Promise<T>,
): Promise<BuildLeaseOutcome<T>> {
  const claimed = await store.claim(resource, holder, ttlMs);
  if (!claimed) return { status: "joined" };
  try {
    const result = await build();
    await store.finish(resource, holder, null);
    return { status: "built", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await store.finish(resource, holder, message);
    } catch (finishError) {
      console.error("[build-lease] failed to record build failure", finishError);
    }
    return { status: "failed", error };
  }
}
