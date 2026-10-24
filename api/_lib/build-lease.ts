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
  // `released` settles once the lease is given up. After a deadline that is
  // later than the outcome: the build keeps running and holds the lease
  // until it settles. Pass it to `waitUntil` to keep the instance alive.
  | { status: "failed"; error: unknown; released: Promise<void> };

export class BuildDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`build exceeded its ${deadlineMs}ms deadline`);
    this.name = "BuildDeadlineError";
  }
}

async function finishQuietly(store: BuildLeaseStore, resource: string, holder: string, error: string | null) {
  try {
    await store.finish(resource, holder, error);
  } catch (finishError) {
    console.error("[build-lease] failed to record build outcome", finishError);
  }
}

/**
 * Run `build` under the lease. When another instance already holds a live
 * lease this returns `{ status: "joined" }` without running the build, so
 * concurrent invocations produce exactly one build per resource.
 *
 * `deadlineMs` bounds how long the caller waits, not the build: a build
 * can't be cancelled, so on timeout the caller gets `failed` while the lease
 * stays `running` until the build actually settles (or `ttlMs` expires on a
 * frozen instance). Releasing at the deadline would let a second build start
 * next to the one still running.
 *
 * Lease bookkeeping is best-effort: if the store can't be reached to claim,
 * the build runs unleased (as before leases existed) rather than failing, and
 * a failed release never turns a finished build into a failure.
 */
export async function runWithBuildLease<T>(
  store: BuildLeaseStore,
  resource: string,
  holder: string,
  ttlMs: number,
  build: () => Promise<T>,
  options?: { deadlineMs?: number },
): Promise<BuildLeaseOutcome<T>> {
  let leased = true;
  try {
    if (!(await store.claim(resource, holder, ttlMs))) return { status: "joined" };
  } catch (claimError) {
    console.error("[build-lease] claim failed; building without a lease", claimError);
    leased = false;
  }
  const release = (error: string | null) => (leased ? finishQuietly(store, resource, holder, error) : Promise.resolve());
  const work = Promise.resolve().then(build);
  const settled = work.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = options?.deadlineMs === undefined
    ? null
    : new Promise<"deadline">((resolve) => { timer = setTimeout(() => resolve("deadline"), options.deadlineMs); });
  const first = await (deadline ? Promise.race([settled, deadline]) : settled);
  clearTimeout(timer);
  if (first === "deadline") {
    const error = new BuildDeadlineError(options!.deadlineMs!);
    // Hold the lease while the build is still running; a late success was
    // not delivered to anyone, so it still records as a timeout.
    const released = settled.then((late) => release(late ?? error.message));
    return { status: "failed", error, released };
  }
  if (first === null) {
    await release(null);
    return { status: "built", result: await work };
  }
  const error = await work.then(() => undefined, (e: unknown) => e);
  await release(first);
  return { status: "failed", error, released: Promise.resolve() };
}
