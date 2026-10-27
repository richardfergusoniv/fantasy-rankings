import { describe, expect, it, vi } from "vitest";
import { createSharedBatchLoader, createPriorityBatchLoaders } from "./shared-batch-loader.js";

describe("shared batch loading", () => {
  it("makes overlapping league requests wait until their stats are published", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const stats = new Map<string, number>();
    const load = vi.fn(async (keys: string[]) => {
      if (keys.includes("shared")) await gate;
      for (const key of keys) stats.set(key, 10);
    });
    const ensure = createSharedBatchLoader(load);
    const leagueA = ensure(["shared", "a", "shared"]);
    let leagueBFinished = false;
    const leagueB = ensure(["shared", "b"]).then(() => {
      expect(stats.get("shared")).toBe(10);
      expect(stats.get("b")).toBe(10);
      leagueBFinished = true;
    });
    await ensure(["b"]);
    expect(leagueBFinished).toBe(false);
    finish();
    await Promise.all([leagueA, leagueB]);
    await ensure(["shared", "a", "b"]);
    expect(load.mock.calls).toEqual([[["shared", "a"]], [["b"]]]);
  });

  it("propagates failures to all waiters and permits a retry", async () => {
    const load = vi.fn<(keys: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const ensure = createSharedBatchLoader(load);
    const outcomes = await Promise.allSettled([ensure(["a"]), ensure(["a"])]);
    expect(outcomes.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await ensure(["a"]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

it("does not let one league's optional batch block another league's rostered player", async () => {
  let finishOptional!: () => void;
  const gate = new Promise<void>((resolve) => { finishOptional = resolve; });
  const published = new Set<string>();
  const loaders = createPriorityBatchLoaders(async (keys) => {
    if (keys.includes("slow-free-agent")) await gate;
    for (const key of keys) published.add(key);
  });
  let optionalDone = false;
  const optional = loaders.optional(["rostered-elsewhere", "slow-free-agent"])
    .then(() => { optionalDone = true; });
  await loaders.priority(["rostered-elsewhere"]);
  expect(published.has("rostered-elsewhere")).toBe(true);
  expect(optionalDone).toBe(false);
  finishOptional();
  await optional;
});
