/**
 * Runtime Cache for SHARED, user-invariant datasets ("shared boards") — the
 * only data allowed back into Vercel Runtime Cache after the personalized
 * dashboard views moved to Postgres.
 *
 * Contract, per the cache-overhaul brief:
 * - Explicit allowlist: only datasets registered in SHARED_BOARD_DATASETS may
 *   publish. A dataset carries a key prefix, a TTL, a max encoded size, and a
 *   payload validator — dashboard-derived objects are not eligible just
 *   because they contain shared fields.
 * - Scopes are slug-like (`2026:9`, `current`), never user identifiers; keys
 *   are `shared:<dataset>:<scope>`.
 * - Writes are serialized per key and monotonic in source age: an older
 *   pipeline run cannot overwrite a newer publication.
 * - Runtime Cache is ephemeral and byte-billed, so every operation is
 *   nonfatal: the Postgres `source_cache` row written by the ingest handler
 *   remains the durable source, and reads fall back to it (counted as
 *   `shared_board.fallback_read`).
 * - Preview deployments never publish (Runtime Cache publication is
 *   disabled there by default); ingest still commits the durable row.
 * - Values carry a source-age envelope (`sourceAgeMs`) so readers can judge
 *   freshness independent of cache TTL.
 */

import { getCache } from "@vercel/functions";
import { countCacheMetric, sampleCacheBytes } from "./cache-metrics.js";
import { parseStoredSleeperPicks } from "./sleeper-picks.js";

const SHARED_CACHE_NAMESPACE = "shared-boards";
/** Hard ceiling before a value is even offered to the SDK (item cap is 2 MB). */
const RUNTIME_ITEM_HARD_CAP_BYTES = 1_000_000;
const SCOPE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,120}$/;

type SharedBoardEnvelope = {
  dataset: string;
  scope: string;
  /** Epoch ms of the source data (e.g. the provider's pulledAt), not publish time. */
  sourceAgeMs: number;
  publishedAtMs: number;
  payload: unknown;
};

export type SharedBoardDataset = {
  id: string;
  /** Seconds the runtime entry may live; the envelope carries the real freshness. */
  ttlSeconds: number;
  /** Reject before SDK submission when the encoded envelope exceeds this. */
  maxEncodedBytes: number;
  /** Cheap structural check that the payload is the declared dataset. */
  validate: (payload: unknown) => boolean;
};

const sharedBoardDatasets = new Map<string, SharedBoardDataset>();

export function registerSharedBoardDataset(dataset: SharedBoardDataset): void {
  sharedBoardDatasets.set(dataset.id, dataset);
}

registerSharedBoardDataset({
  id: "sleeper-picks",
  ttlSeconds: 6 * 60 * 60,
  maxEncodedBytes: 512_000,
  validate: (payload) => parseStoredSleeperPicks(payload) != null,
});

export function sharedBoardDatasetIds(): string[] {
  return [...sharedBoardDatasets.keys()];
}

type RuntimeSharedCache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ttl: number; name: string }): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
};

function defaultRuntimeSharedCache(): RuntimeSharedCache {
  return {
    async get(key) {
      return getCache({ namespace: SHARED_CACHE_NAMESPACE }).get(key);
    },
    async set(key, value, options) {
      await getCache({ namespace: SHARED_CACHE_NAMESPACE }).set(key, value, options);
    },
    async delete(key) {
      await getCache({ namespace: SHARED_CACHE_NAMESPACE }).delete(key);
    },
  };
}

const runtimePreviewDisabled = () => process.env.VERCEL_ENV === "preview";

// --- bounded L1 (same isolate) -----------------------------------------------

type L1Entry = { envelope: SharedBoardEnvelope; expiresAtMs: number; bytes: number };
const L1_MAX_ENTRIES = 64;
const L1_TTL_MS = 60_000;
const l1 = new Map<string, L1Entry>();

function l1Get(key: string): SharedBoardEnvelope | null {
  const entry = l1.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    l1.delete(key);
    return null;
  }
  l1.delete(key);
  l1.set(key, entry); // refresh recency
  return entry.envelope;
}

function l1Set(key: string, envelope: SharedBoardEnvelope, bytes: number): void {
  l1.delete(key);
  l1.set(key, { envelope, expiresAtMs: Date.now() + L1_TTL_MS, bytes });
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next().value;
    if (oldest === undefined) break;
    l1.delete(oldest);
  }
}

// --- serialized writes --------------------------------------------------------
// A per-key promise chain serializes publications so two pipeline runs for the
// same board cannot interleave their read-check-write sequence.
const writeChains = new Map<string, Promise<unknown>>();

export function sharedBoardCacheKey(dataset: string, scope: string): string {
  return `shared:${dataset}:${scope}`;
}

export type SharedBoardPublishResult =
  | { published: true; key: string; encodedBytes: number }
  | { published: false; key: string; reason: "unknown_dataset" | "invalid_scope" | "invalid_payload" | "oversized" | "stale_source" | "preview" | "runtime_error" };

/**
 * Publish a shared board into Runtime Cache after its durable write committed.
 * Never throws: publication failure leaves the durable row authoritative.
 */
export async function publishSharedBoard(
  datasetId: string,
  scope: string,
  payload: unknown,
  sourceAgeMs: number,
  runtime: RuntimeSharedCache = defaultRuntimeSharedCache(),
): Promise<SharedBoardPublishResult> {
  const key = sharedBoardCacheKey(datasetId, scope);
  const dataset = sharedBoardDatasets.get(datasetId);
  if (!dataset) return { published: false, key, reason: "unknown_dataset" };
  if (!SCOPE_PATTERN.test(scope) || scope.toLowerCase().includes("user")) {
    return { published: false, key, reason: "invalid_scope" };
  }
  if (!dataset.validate(payload)) {
    countCacheMetric("shared_board.publish_rejected");
    return { published: false, key, reason: "invalid_payload" };
  }
  if (runtimePreviewDisabled()) return { published: false, key, reason: "preview" };

  const envelope: SharedBoardEnvelope = {
    dataset: datasetId,
    scope,
    sourceAgeMs,
    publishedAtMs: Date.now(),
    payload,
  };
  const encodedBytes = JSON.stringify(envelope).length;
  if (encodedBytes > dataset.maxEncodedBytes || encodedBytes > RUNTIME_ITEM_HARD_CAP_BYTES) {
    countCacheMetric("shared_board.publish_rejected");
    return { published: false, key, reason: "oversized" };
  }

  const previous = writeChains.get(key) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async (): Promise<SharedBoardPublishResult> => {
    try {
      // Monotonic in source age: an older job must not replace newer state.
      const existing = await runtime.get(key).catch(() => null);
      if (existing && typeof existing === "object") {
        const age = (existing as Partial<SharedBoardEnvelope>).sourceAgeMs;
        if (typeof age === "number" && age >= envelope.sourceAgeMs) {
          return { published: false, key, reason: "stale_source" };
        }
      }
      await runtime.set(key, envelope, { ttl: dataset.ttlSeconds, name: `shared-board-${datasetId}` });
      countCacheMetric("shared_board.publish");
      sampleCacheBytes("shared_board.publish_bytes", encodedBytes);
      l1Set(key, envelope, encodedBytes);
      return { published: true, key, encodedBytes };
    } catch {
      countCacheMetric("shared_board.cache.error");
      // The durable row is already newer than whatever the cache holds. Drop
      // the cached copy so readers fall back to that row instead of serving
      // the previous board until its TTL runs out.
      l1.delete(key);
      await runtime.delete?.(key).catch(() => undefined);
      return { published: false, key, reason: "runtime_error" };
    }
  });
  writeChains.set(key, work);
  void work.finally(() => {
    if (writeChains.get(key) === work) writeChains.delete(key);
  });
  return work;
}

export type SharedBoardReadResult = {
  envelope: SharedBoardEnvelope | null;
  source: "l1" | "runtime" | "durable" | "miss";
};

/**
 * Read a shared board: L1 → Runtime Cache → the caller's durable fallback
 * (typically the `source_cache` row the ingest handler wrote). The durable
 * fallback is the intended eviction path — it is bounded (one row lookup) and
 * its result repopulates L1 only, so a cold instance never amplifies runtime
 * writes on the read path.
 */
export async function readSharedBoard(
  datasetId: string,
  scope: string,
  durableLoad: () => Promise<{ payload: unknown; sourceAgeMs: number } | null>,
  runtime: RuntimeSharedCache = defaultRuntimeSharedCache(),
): Promise<SharedBoardReadResult> {
  const dataset = sharedBoardDatasets.get(datasetId);
  if (!dataset) return { envelope: null, source: "miss" };
  const key = sharedBoardCacheKey(datasetId, scope);

  const local = l1Get(key);
  if (local) {
    countCacheMetric("shared_board.cache.hit");
    return { envelope: local, source: "l1" };
  }

  try {
    const remote = await runtime.get(key);
    if (remote && typeof remote === "object" && dataset.validate((remote as SharedBoardEnvelope).payload)) {
      const envelope = remote as SharedBoardEnvelope;
      countCacheMetric("shared_board.cache.hit");
      l1Set(key, envelope, JSON.stringify(envelope).length);
      return { envelope, source: "runtime" };
    }
    countCacheMetric("shared_board.cache.miss");
  } catch {
    countCacheMetric("shared_board.cache.error");
  }

  countCacheMetric("shared_board.fallback_read");
  try {
    const durable = await durableLoad();
    if (!durable || !dataset.validate(durable.payload)) {
      return { envelope: null, source: durable ? "durable" : "miss" };
    }
    const envelope: SharedBoardEnvelope = {
      dataset: datasetId,
      scope,
      sourceAgeMs: durable.sourceAgeMs,
      publishedAtMs: Date.now(),
      payload: durable.payload,
    };
    l1Set(key, envelope, JSON.stringify(envelope).length);
    return { envelope, source: "durable" };
  } catch {
    return { envelope: null, source: "miss" };
  }
}

export function resetSharedBoardCachesForTests(): void {
  l1.clear();
  writeChains.clear();
}
