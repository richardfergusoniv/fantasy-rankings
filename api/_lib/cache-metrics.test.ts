import { describe, expect, it } from "vitest";
import {
  estimateRuntimeUnits,
  countCacheMetric,
  getCacheMetricsSnapshot,
  processInstanceId,
  resetCacheMetricsForTests,
  sampleCacheBytes,
} from "./cache-metrics.js";

describe("cache-metrics", () => {
  it("aggregates counters and byte samples with estimated 8 KB units", () => {
    resetCacheMetricsForTests();
    countCacheMetric("dashboard.l1.miss", 16);
    countCacheMetric("dashboard.snapshot.payload_read");
    sampleCacheBytes("dashboard.runtime.set.bytes", 8_000);
    sampleCacheBytes("dashboard.runtime.set.bytes", 8_001);

    const snapshot = getCacheMetricsSnapshot();
    expect(snapshot.counters["dashboard.l1.miss"]).toBe(16);
    expect(snapshot.counters["dashboard.snapshot.payload_read"]).toBe(1);
    expect(snapshot.bytes["dashboard.runtime.set.bytes"]).toEqual({
      count: 2,
      totalBytes: 16_001,
      maxBytes: 8_001,
      totalUnits: 3,
    });
    expect(snapshot.processInstanceId).toBe(processInstanceId);
  });

  it("estimates units with an upward round and a one-unit floor", () => {
    expect(estimateRuntimeUnits(1)).toBe(1);
    expect(estimateRuntimeUnits(8_000)).toBe(1);
    expect(estimateRuntimeUnits(8_001)).toBe(2);
    expect(estimateRuntimeUnits(1_800_000)).toBe(225);
  });
});
