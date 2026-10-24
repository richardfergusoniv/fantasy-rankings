import { describe, expect, it } from "vitest";
import { createDashboardBuildTracker } from "./dashboard-build-status";

describe("createDashboardBuildTracker", () => {
  it("reports building while the run is in flight and clears after success", async () => {
    const tracker = createDashboardBuildTracker();
    let resolveRun!: () => void;
    const run = () => new Promise<void>((resolve) => { resolveRun = resolve; });
    const kicked = tracker.kick("user-1", run);
    expect(tracker.status("user-1")?.status).toBe("building");
    resolveRun();
    await kicked;
    expect(tracker.status("user-1")).toBeNull();
  });

  it("records a failure with a job id instead of swallowing it", async () => {
    const tracker = createDashboardBuildTracker({ newJobId: () => "job-42" });
    const captured: { error: unknown; jobId: string }[] = [];
    const kicked = tracker.kick(
      "user-1",
      () => Promise.reject(new Error("sleeper down")),
      (error, jobId) => { captured.push({ error, jobId }); },
    );
    await kicked; // never rejects
    const state = tracker.status("user-1");
    expect(state?.status).toBe("failed");
    expect(state).toMatchObject({ jobId: "job-42", error: "sleeper down" });
    expect(captured[0]?.jobId).toBe("job-42");
    expect((captured[0]?.error as Error).message).toBe("sleeper down");
  });

  it("expires the failed status after its TTL so later reads retry cleanly", async () => {
    const tracker = createDashboardBuildTracker({ failedTtlMs: 1_000 });
    await tracker.kick("user-1", () => Promise.reject(new Error("boom")));
    const failed = tracker.status("user-1");
    expect(failed?.status).toBe("failed");
    expect(tracker.status("user-1", Date.now() + 2_000)).toBeNull();
  });

  it("joins an in-flight build for the same user and starts a new one after failure", async () => {
    const tracker = createDashboardBuildTracker();
    let runs = 0;
    const first = tracker.kick("user-1", () => { runs += 1; return Promise.reject(new Error("x")); });
    const joined = tracker.kick("user-1", () => { runs += 1; return Promise.resolve(); });
    expect(joined).toBe(first);
    await first;
    await tracker.kick("user-1", () => { runs += 1; return Promise.resolve(); });
    expect(runs).toBe(2);
  });
});
