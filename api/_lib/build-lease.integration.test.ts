import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-Postgres lease tests. Set DATABASE_URL to a database where we may
 * create the build_leases table (CI's postgres service, or a local
 * `docker run -p 55432:5432 postgres:16`). Skipped without it.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const maybe = DATABASE_URL ? describe : describe.skip;

// Must be set before ./db.js's lazy singleton is first used.
if (DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
}

maybe("build_leases against real Postgres", () => {
  const resource = `it:${crypto.randomUUID()}`;

  beforeAll(async () => {
    const { db } = await import("./db.js");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS build_leases (
        resource text PRIMARY KEY,
        holder text NOT NULL,
        status text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
        last_error text,
        acquired_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  afterAll(async () => {
    const { getDb } = await import("./db.js");
    await getDb().$client?.end();
  });

  it("exactly one of many concurrent claims wins", async () => {
    const { drizzleBuildLeaseStore } = await import("./build-lease.js");
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        drizzleBuildLeaseStore.claim(resource, `holder-${i}`, 60_000),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    // Non-winners cannot take the lease while it is live.
    expect(await drizzleBuildLeaseStore.claim(resource, "late", 60_000)).toBe(false);
  });

  it("a second holder claims only after the first finishes or expires", async () => {
    const { drizzleBuildLeaseStore } = await import("./build-lease.js");
    const r2 = `${resource}-2`;
    expect(await drizzleBuildLeaseStore.claim(r2, "a", 60_000)).toBe(true);
    expect(await drizzleBuildLeaseStore.claim(r2, "b", 60_000)).toBe(false);
    await drizzleBuildLeaseStore.finish(r2, "a", null);
    expect(await drizzleBuildLeaseStore.claim(r2, "b", 60_000)).toBe(true);
    // Expired leases are reclaimable (short TTL, wait past it).
    const r3 = `${resource}-3`;
    expect(await drizzleBuildLeaseStore.claim(r3, "a", 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await drizzleBuildLeaseStore.claim(r3, "b", 60_000)).toBe(true);
  });

  it("finish only applies to the current holder (no cross-owner release)", async () => {
    const { drizzleBuildLeaseStore } = await import("./build-lease.js");
    const r4 = `${resource}-4`;
    expect(await drizzleBuildLeaseStore.claim(r4, "a", 60_000)).toBe(true);
    await drizzleBuildLeaseStore.finish(r4, "not-the-holder", "boom");
    const row = await drizzleBuildLeaseStore.read(r4);
    expect(row?.status).toBe("running");
    await drizzleBuildLeaseStore.finish(r4, "a", "boom");
    expect((await drizzleBuildLeaseStore.read(r4))?.status).toBe("failed");
    expect((await drizzleBuildLeaseStore.read(r4))?.lastError).toBe("boom");
  });
  it("holds off takeover through publication, even after TTL expiry", async () => {
    const { drizzleBuildLeaseStore, publishUnderBuildLease } = await import("./build-lease.js");
    const { sql } = await import("drizzle-orm");
    const key = `${resource}-publish`;
    await drizzleBuildLeaseStore.claim(key, "old", 60_000);
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { locked = resolve; });
    const publication = publishUnderBuildLease(key, "old", async (tx) => {
      // Expire while holding the row lock. Another holder must wait for commit.
      await tx.execute(sql`UPDATE build_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE resource = ${key}`);
      locked();
      await gate;
      return "published";
    });
    await entered;
    let claimed = false;
    const takeover = drizzleBuildLeaseStore.claim(key, "new", 60_000).then((value) => { claimed = value; return value; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(claimed).toBe(false);
    release();
    expect(await publication).toBe("published");
    expect(await takeover).toBe(true);
    let wrote = false;
    await expect(publishUnderBuildLease(key, "old", async () => { wrote = true; })).rejects.toThrow("build lease lost");
    expect(wrote).toBe(false);
  });

});
