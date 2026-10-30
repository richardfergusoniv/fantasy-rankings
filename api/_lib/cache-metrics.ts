/**
 * Structured cache/build accounting for the dashboard stack.
 *
 * Counters aggregate in process memory and flush as one JSON log line on an
 * interval so Vercel logs (and any log drain) can chart them without a
 * metrics dependency. Events record counts and sampled byte sizes only —
 * never payload contents, auth tokens, or cache keys (a key can identify a
 * user). `processInstanceId` distinguishes cold-instance copies in logs; it
 * is not a user identifier.
 *
 * Counter names deliberately separate the things billing charts conflate:
 * pointer probes vs body reads vs memory hits vs Postgres snapshot reads vs
 * metadata reads vs builds. Runtime Cache is billed in 8 KB units, so byte
 * samplers estimate `units = ceil(bytes / 8000)` per operation; Vercel's
 * exact rounding is undocumented, so these are internal estimates.
 */

export type CacheMetricName =
  // Instance-local (L1) dashboard view cache.
  | "dashboard.l1.hit"
  | "dashboard.l1.miss"
  | "dashboard.l1.write"
  | "dashboard.l1.evicted"
  | "dashboard.l1.bypassed"
  // Scope-level single-flight dedupe inside one isolate.
  | "dashboard.singleflight.joined"
  // Runtime Cache operations — personalized dashboard views must NEVER emit
  // these again (the lane/pointer layer was removed); they exist only so a
  // regression is visible in the flush, and for shared-board writes.
  | "dashboard.runtime.get"
  | "dashboard.runtime.set"
  | "dashboard.runtime.delete"
  | "dashboard.runtime.pointer.probe"
  | "dashboard.runtime.pointer.publish"
  | "dashboard.runtime.error"
  // Postgres snapshot traffic.
  | "dashboard.snapshot.payload_read"
  | "dashboard.snapshot.metadata_read"
  | "dashboard.snapshot.bytes"
  // Builds and leases.
  | "dashboard.build.start"
  | "dashboard.build.done"
  | "dashboard.build.failed"
  | "build_lease.claimed"
  | "build_lease.joined"
  | "build_lease.claim_error"
  | "build_lease.lost_before_publish"
  // Shared-board path (pipeline-published public datasets).
  | "shared_board.cache.hit"
  | "shared_board.cache.miss"
  | "shared_board.cache.error"
  | "shared_board.fallback_read"
  | "shared_board.publish"
  | "shared_board.publish_rejected";

export const RUNTIME_CACHE_UNIT_BYTES = 8_000;

/** Rough estimate of billed Runtime Cache units for one encoded value. */
export function estimateRuntimeUnits(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / RUNTIME_CACHE_UNIT_BYTES));
}

/** Unique id for this function instance's lifetime (cold-start discriminator). */
export const processInstanceId: string = crypto.randomUUID();

const counters = new Map<CacheMetricName, number>();
const byteSamples = new Map<string, { count: number; totalBytes: number; maxBytes: number; totalUnits: number }>();

/** Increment a counter. Fields must be counts/status only — no identifiers. */
export function countCacheMetric(name: CacheMetricName, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

/** Record an encoded payload size in bytes (also estimates 8 KB units). */
export function sampleCacheBytes(name: string, bytes: number): void {
  const units = estimateRuntimeUnits(bytes);
  const sample = byteSamples.get(name) ?? { count: 0, totalBytes: 0, maxBytes: 0, totalUnits: 0 };
  sample.count += 1;
  sample.totalBytes += bytes;
  sample.totalUnits += units;
  if (bytes > sample.maxBytes) sample.maxBytes = bytes;
  byteSamples.set(name, sample);
}

export type CacheMetricsSnapshot = {
  processInstanceId: string;
  counters: Record<string, number>;
  bytes: Record<string, { count: number; totalBytes: number; maxBytes: number; totalUnits: number }>;
};

/** Current aggregated metrics (test/debug reads; not a flush). */
export function getCacheMetricsSnapshot(): CacheMetricsSnapshot {
  return {
    processInstanceId,
    counters: Object.fromEntries(counters),
    bytes: Object.fromEntries([...byteSamples].map(([key, value]) => [key, { ...value }])),
  };
}

/** Emit one structured log line with everything aggregated since the last flush. */
export function flushCacheMetrics(): void {
  if (counters.size === 0 && byteSamples.size === 0) return;
  const snapshot = getCacheMetricsSnapshot();
  console.log("[cache-metrics]", JSON.stringify(snapshot));
  counters.clear();
  byteSamples.clear();
}

const FLUSH_INTERVAL_MS = 60_000;

// Serverless instances are frozen between invocations, so the interval only
// approximates per-invocation flushing; routes may also flush at the end of
// a request. unref keeps a local/test process from hanging on the timer.
const flushTimer = setInterval(flushCacheMetrics, FLUSH_INTERVAL_MS);
flushTimer.unref?.();

/** Reset all state (tests only). */
export function resetCacheMetricsForTests(): void {
  counters.clear();
  byteSamples.clear();
}
