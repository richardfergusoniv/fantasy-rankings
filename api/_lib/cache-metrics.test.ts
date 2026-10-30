import { describe, expect, it, vi } from "vitest";
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

describe("personalized-runtime-traffic alert", () => {
  it("emits a distinct alert line when a personalized runtime counter is nonzero", async () => {
    const { flushCacheMetrics } = await import("./cache-metrics.js");
    resetCacheMetricsForTests();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    countCacheMetric("dashboard.runtime.get");
    flushCacheMetrics();
    expect(errSpy).toHaveBeenCalledWith(
      "[cache-alert] personalized-runtime-traffic",
      expect.stringContaining('"ops":1'),
    );

    // Shared-board traffic alone must not trip it.
    errSpy.mockClear();
    countCacheMetric("shared_board.cache.hit");
    flushCacheMetrics();
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});
