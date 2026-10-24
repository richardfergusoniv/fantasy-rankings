import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  clearPersonalQueries,
  personalQueryKey,
  snapshotViewer,
  type ViewerIdentity,
} from "./viewer-scope";

const viewerA: ViewerIdentity = { userId: "user-a", accountId: "sleeper-a" };
const viewerB: ViewerIdentity = { userId: "user-b", accountId: "sleeper-b" };

const PERSONAL_KEYS = [
  "fantasy-dashboard",
  "player-news",
  "draft-center",
  "saved-chart-views",
] as const;

const SECTIONS = ["meta", "team", "players", "league", "analytics", "trade", "trade-waiver"] as const;

describe("viewer-scoped personal query keys", () => {
  it("never serves viewer A's cached data to viewer B (seeded-A-queried-as-B)", () => {
    // Regression: personal query keys previously omitted identity, so a meta
    // response cached for viewer A answered the same key for viewer B.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const metaForA = { section: "meta", data: { leagues: [{ id: "a-league" }] } };
    client.setQueryData(personalQueryKey(viewerA, "dashboard-section", "meta"), metaForA);

    expect(client.getQueryData(personalQueryKey(viewerA, "dashboard-section", "meta"))).toEqual(metaForA);
    expect(client.getQueryData(personalQueryKey(viewerB, "dashboard-section", "meta"))).toBeUndefined();
  });

  it("scopes every personal key by user and by connected account", () => {
    const key = (viewer: ViewerIdentity, name: string) => JSON.stringify(personalQueryKey(viewer, name));
    for (const name of [...PERSONAL_KEYS, ...SECTIONS.map((s) => `dashboard-section:${s}`)]) {
      expect(key(viewerA, name)).not.toEqual(key(viewerB, name));
      expect(key(viewerA, name)).not.toEqual(key({ ...viewerA, accountId: "sleeper-c" }, name));
    }
  });

  it("clears all personal queries on identity change", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const name of PERSONAL_KEYS) client.setQueryData(personalQueryKey(viewerA, name), { from: "a" });
    for (const section of SECTIONS) client.setQueryData(personalQueryKey(viewerA, "dashboard-section", section), { from: "a" });
    client.setQueryData(personalQueryKey(viewerB, "player-news"), { from: "b" });
    client.setQueryData(["shared-static"], { from: "shared" });

    await clearPersonalQueries(client);

    expect(client.getQueryData(personalQueryKey(viewerB, "player-news"))).toBeUndefined();
    for (const name of PERSONAL_KEYS) expect(client.getQueryData(personalQueryKey(viewerA, name))).toBeUndefined();
    for (const section of SECTIONS) expect(client.getQueryData(personalQueryKey(viewerA, "dashboard-section", section))).toBeUndefined();
    // Non-personal data is untouched.
    expect(client.getQueryData(["shared-static"])).toEqual({ from: "shared" });
  });
});

describe("snapshotViewer", () => {
  it("reports a viewer switch mid-flight so A's late result isn't saved as B's", async () => {
    let signedIn: string | null = "user-a";
    const owner = await snapshotViewer(async () => signedIn);
    expect(owner.startedBy).toBe("user-a");
    expect(await owner.stillCurrent()).toBe(true);
    signedIn = "user-b"; // B signs in while A's refresh is still running
    expect(await owner.stillCurrent()).toBe(false);
    signedIn = null;
    expect(await owner.stillCurrent()).toBe(false);
  });
});
