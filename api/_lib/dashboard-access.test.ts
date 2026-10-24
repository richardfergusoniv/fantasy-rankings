import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  dashboardForViewer,
  isScheduledOwner,
  sectionDashboardForViewer,
} from "./dashboard-access.js";

type Dash = { owner: string; leagues: string[] };

const ownerSnapshot: Dash = { owner: "richard", leagues: ["league-a"] };
const friendDashboard: Dash = { owner: "friend", leagues: ["league-b"] };

function failIfCalled(name: string): () => Promise<Dash> {
  return () => Promise.reject(new Error(`${name} should not be called`));
}

describe("isScheduledOwner", () => {
  it("prefers OWNER_USER_ID over a matching Sleeper id", () => {
    assert.equal(
      isScheduledOwner({
        sleeperUserId: "owner-sleeper",
        viewerUserId: "attacker-supabase",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: "owner-supabase",
      }),
      false,
    );
    assert.equal(
      isScheduledOwner({
        sleeperUserId: "other-sleeper",
        viewerUserId: "owner-supabase",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: "owner-supabase",
      }),
      true,
    );
  });

  it("never grants owner rights on a Sleeper id match alone", () => {
    // The linked Sleeper id is caller-chosen and unverified, so nobody is
    // the owner when OWNER_USER_ID is unset — even on a matching id.
    assert.equal(
      isScheduledOwner({
        sleeperUserId: "owner-sleeper",
        viewerUserId: "anyone",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: null,
      }),
      false,
    );
    assert.equal(
      isScheduledOwner({
        sleeperUserId: "friend-sleeper",
        viewerUserId: "anyone",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: null,
      }),
      false,
    );
  });
});

describe("dashboardForViewer", () => {
  it("returns 401 for a signed-out read and does not touch the owner snapshot", async () => {
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: null,
      ownerSleeperUserId: "owner",
      force: false,
      loadFreshOwn: failIfCalled("loadFreshOwn"),
      loadOwnerSnapshot: failIfCalled("loadOwnerSnapshot"),
      buildOwn: failIfCalled("buildOwn"),
    });
    assert.deepEqual(result, { ok: false, status: 401, error: "Sign in required." });
    assert.equal("dashboard" in result, false);
  });

  it("returns 401 for a signed-out force refresh as well", async () => {
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: null,
      ownerSleeperUserId: "owner",
      force: true,
      loadFreshOwn: failIfCalled("loadFreshOwn"),
      loadOwnerSnapshot: failIfCalled("loadOwnerSnapshot"),
      buildOwn: failIfCalled("buildOwn"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("returns the signed-in user's own dashboard and not the owner snapshot", async () => {
    let snapshotReads = 0;
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "friend",
      ownerSleeperUserId: "owner",
      force: false,
      loadFreshOwn: async (id) => {
        assert.equal(id, "friend");
        return friendDashboard;
      },
      loadOwnerSnapshot: async () => {
        snapshotReads += 1;
        return ownerSnapshot;
      },
      buildOwn: failIfCalled("buildOwn"),
    });
    assert.equal(snapshotReads, 0);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "own");
      assert.deepEqual(result.dashboard, friendDashboard);
      assert.notDeepEqual(result.dashboard, ownerSnapshot);
    }
  });

  it("builds for a signed-in user with no cache instead of reading the owner snapshot", async () => {
    let snapshotReads = 0;
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "friend",
      ownerSleeperUserId: "owner",
      force: false,
      loadFreshOwn: async () => null,
      loadOwnerSnapshot: async () => {
        snapshotReads += 1;
        return ownerSnapshot;
      },
      buildOwn: async (id) => ({ owner: id, leagues: ["league-b"] }),
    });
    assert.equal(snapshotReads, 0);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.dashboard.leagues, ["league-b"]);
  });

  it("lets the signed-in owner fall back to the stored snapshot", async () => {
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "owner",
      viewerUserId: "real-owner",
      ownerSleeperUserId: "owner",
      ownerUserId: "real-owner",
      force: false,
      loadFreshOwn: async () => null,
      loadOwnerSnapshot: async () => ownerSnapshot,
      buildOwn: failIfCalled("buildOwn"),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "owner-snapshot");
      assert.deepEqual(result.dashboard, ownerSnapshot);
    }
  });

  it("does not grant owner snapshot when Sleeper ids match but OWNER_USER_ID does not", async () => {
    let snapshotReads = 0;
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "owner-sleeper",
      viewerUserId: "attacker",
      ownerSleeperUserId: "owner-sleeper",
      ownerUserId: "real-owner",
      force: false,
      loadFreshOwn: async () => null,
      loadOwnerSnapshot: async () => {
        snapshotReads += 1;
        return ownerSnapshot;
      },
      buildOwn: async (id) => ({ owner: id, leagues: ["league-stolen"] }),
    });
    assert.equal(snapshotReads, 0);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "built");
      assert.deepEqual(result.dashboard.leagues, ["league-stolen"]);
    }
  });

  it("does not grant the owner snapshot on a Sleeper id match alone", async () => {
    let snapshotReads = 0;
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "owner-sleeper",
      viewerUserId: "attacker",
      ownerSleeperUserId: "owner-sleeper",
      ownerUserId: null,
      force: false,
      loadFreshOwn: async () => null,
      loadOwnerSnapshot: async () => {
        snapshotReads += 1;
        return ownerSnapshot;
      },
      buildOwn: async (id) => ({ owner: id, leagues: ["league-stolen"] }),
    });
    assert.equal(snapshotReads, 0);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "built");
      assert.deepEqual(result.dashboard.leagues, ["league-stolen"]);
    }
  });

  it("grants owner snapshot when viewer matches OWNER_USER_ID", async () => {
    const result = await dashboardForViewer<Dash>({
      sleeperUserId: "owner-sleeper",
      viewerUserId: "real-owner",
      ownerSleeperUserId: "owner-sleeper",
      ownerUserId: "real-owner",
      force: false,
      loadFreshOwn: async () => null,
      loadOwnerSnapshot: async () => ownerSnapshot,
      buildOwn: failIfCalled("buildOwn"),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "owner-snapshot");
      assert.deepEqual(result.dashboard, ownerSnapshot);
    }
  });
});

describe("sectionDashboardForViewer", () => {
  it("returns 401 for a signed-out section read", async () => {
    const result = await sectionDashboardForViewer<Dash>({
      sleeperUserId: null,
      ownerSleeperUserId: "owner",
      loadOwn: failIfCalled("loadOwn"),
      loadOwnerSnapshot: failIfCalled("loadOwnerSnapshot"),
    });
    assert.deepEqual(result, { ok: false, status: 401, error: "Sign in required." });
  });

  it("returns the signed-in user's section data", async () => {
    const result = await sectionDashboardForViewer<Dash>({
      sleeperUserId: "friend",
      ownerSleeperUserId: "owner",
      loadOwn: async () => friendDashboard,
      loadOwnerSnapshot: failIfCalled("loadOwnerSnapshot"),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.dashboard, friendDashboard);
  });

  it("does not fill a friend's empty section from the owner snapshot", async () => {
    const result = await sectionDashboardForViewer<Dash>({
      sleeperUserId: "friend",
      ownerSleeperUserId: "owner",
      loadOwn: async () => null,
      loadOwnerSnapshot: failIfCalled("loadOwnerSnapshot"),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.dashboard, null);
  });
});
