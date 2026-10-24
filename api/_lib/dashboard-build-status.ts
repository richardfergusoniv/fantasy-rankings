/**
 * In-memory status for per-user background dashboard builds.
 *
 * `kickUserDashboardBuild` runs the first build behind a section response.
 * Its failure used to be swallowed silently — the client polled `data: null`
 * forever, unable to tell "still building" apart from "build failed". This
 * tracker records each build's outcome per Sleeper user so section responses
 * can report a structured `{ status, jobId }` next to `data: null`.
 *
 * The map lives inside one function instance; a status never survives a cold
 * start, which is fine — it only needs to bridge the seconds a client spends
 * polling one deployment instance.
 *
 * A failure stays visible for FAILED_BUILD_STATUS_TTL_MS so the client can
 * surface it, then expires so later reads kick a fresh build cleanly.
 */

export type DashboardBuildState =
  | { status: "building"; jobId: string }
  | { status: "failed"; jobId: string; failedAtMs: number; error: string };

export const FAILED_BUILD_STATUS_TTL_MS = 10 * 60_000;

type BuildRecord =
  | { status: "building"; jobId: string; promise: Promise<void> }
  | { status: "failed"; jobId: string; failedAtMs: number; error: string };

export function createDashboardBuildTracker(options?: { failedTtlMs?: number; newJobId?: () => string }) {
  const failedTtlMs = options?.failedTtlMs ?? FAILED_BUILD_STATUS_TTL_MS;
  const newJobId = options?.newJobId ?? (() => crypto.randomUUID());
  const records = new Map<string, BuildRecord>();

  /** Current build state for a user, or null when nothing recent ran. */
  function status(sleeperUserId: string, nowMs = Date.now()): DashboardBuildState | null {
    const record = records.get(sleeperUserId);
    if (!record) return null;
    if (record.status === "building") {
      return { status: "building", jobId: record.jobId };
    }
    if (nowMs - record.failedAtMs > failedTtlMs) {
      records.delete(sleeperUserId);
      return null;
    }
    return {
      status: "failed",
      jobId: record.jobId,
      failedAtMs: record.failedAtMs,
      error: record.error,
    };
  }

  /**
   * Join the in-flight build for this user, or start one. The returned
   * promise never rejects — failures are recorded on the tracker instead.
   */
  function kick(
    sleeperUserId: string,
    run: () => Promise<void>,
    onFailure?: (error: unknown, jobId: string) => void,
  ): Promise<void> {
    const existing = records.get(sleeperUserId);
    if (existing?.status === "building") return existing.promise;
    const jobId = newJobId();
    const promise = (async () => {
      try {
        await run();
        // Clear only if no newer build took the slot.
        if (records.get(sleeperUserId)?.status === "building") records.delete(sleeperUserId);
      } catch (error) {
        records.set(sleeperUserId, {
          status: "failed",
          jobId,
          failedAtMs: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
        onFailure?.(error, jobId);
      }
    })();
    records.set(sleeperUserId, { status: "building", jobId, promise });
    return promise;
  }

  return { kick, status };
}
