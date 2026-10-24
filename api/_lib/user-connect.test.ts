import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth + db layers so the route handler runs without Supabase/Postgres.
const getAuthUser = vi.fn();
const onConflictDoUpdate = vi.fn(async () => undefined);
const values = vi.fn(() => ({ onConflictDoUpdate }));
const insert = vi.fn(() => ({ values }));

vi.mock("./auth.js", () => ({
  getAuthUser: (req: Request) => getAuthUser(req),
}));
vi.mock("./db.js", () => ({
  getDb: () => ({ insert }),
  schema: {
    sleeperConnections: {
      userId: "user_id",
      sleeperUserId: "sleeper_user_id",
      sleeperUsername: "sleeper_username",
    },
  },
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async () => Response.json({ user_id: "sleeper-1", username: "alice" })),
);

const { POST } = await import("../user.js");

function connectRequest(): Request {
  return new Request("https://localhost/api/user", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ username: "alice" }),
  });
}

describe("POST /api/user connect", () => {
  beforeEach(() => {
    getAuthUser.mockReset();
    onConflictDoUpdate.mockClear();
    values.mockClear();
    insert.mockClear();
  });

  it("does not reserve a public Sleeper id — a second user may follow it too", async () => {
    // First-claim abuse: an unrelated registrant used to hold the Sleeper id
    // exclusively and block its legitimate user. Connecting is now a
    // nonexclusive follow, so both claims succeed and privileges stay keyed
    // to the Supabase user id, never the linked Sleeper id.
    getAuthUser.mockResolvedValueOnce({ id: "user-a", email: "a@x" });
    const first = await POST(connectRequest());
    assert.equal(first.status, 200);

    getAuthUser.mockResolvedValueOnce({ id: "user-b", email: "b@x" });
    const second = await POST(connectRequest());
    assert.equal(second.status, 200);
    const body = (await second.json()) as { ok: boolean; sleeperUserId: string };
    assert.equal(body.ok, true);
    assert.equal(body.sleeperUserId, "sleeper-1");

    // Both writes are plain per-user upserts — no pre-check for other claimants.
    assert.equal(insert.mock.calls.length, 2);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects unauthenticated connects", async () => {
    getAuthUser.mockResolvedValueOnce(null);
    const res = await POST(connectRequest());
    assert.equal(res.status, 401);
    assert.equal(insert.mock.calls.length, 0);
  });
});

describe("sleeper_connections migration 0011", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "drizzle-pg", "0011_sleeper_connections_follow.sql"),
    "utf8",
  );

  it("drops the unique index so a Sleeper id cannot be squatted", () => {
    assert.match(sql, /DROP INDEX IF EXISTS "sleeper_connections_sleeper_user_id_uidx"/);
  });

  it("denies direct database writes so mutations go through the API only", () => {
    for (const policy of [
      "Users can insert own connection",
      "Users can update own connection",
      "Users can delete own connection",
    ]) {
      assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${policy}"`));
    }
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON "sleeper_connections" FROM anon, authenticated/);
  });
});
