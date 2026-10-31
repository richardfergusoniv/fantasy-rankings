import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithRetry, isRetryableSourceFetchError } from "./sleeper.js";

const noSleep = async () => undefined;

function stubFetchSequence(steps: Array<{ status: number; body?: unknown } | { error: Error }>) {
  const fetchMock = vi.fn(async () => {
    const step = steps.shift();
    if (!step) throw new Error("unexpected extra fetch");
    if ("error" in step) throw step.error;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isRetryableSourceFetchError", () => {
  it("retries rate limits and server errors", () => {
    expect(isRetryableSourceFetchError(new Error("Source returned 429"))).toBe(true);
    expect(isRetryableSourceFetchError(new Error("Source returned 500"))).toBe(true);
    expect(isRetryableSourceFetchError(new Error("Source returned 503"))).toBe(true);
  });

  it("does not retry other 4xx responses", () => {
    expect(isRetryableSourceFetchError(new Error("Source returned 400"))).toBe(false);
    expect(isRetryableSourceFetchError(new Error("Source returned 404"))).toBe(false);
  });

  it("retries failures without an HTTP status (network, timeout)", () => {
    expect(isRetryableSourceFetchError(new Error("Source request timed out"))).toBe(true);
    expect(isRetryableSourceFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableSourceFetchError("not an error")).toBe(true);
  });
});

describe("fetchJsonWithRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const fetchMock = stubFetchSequence([{ status: 200, body: { ok: true } }]);
    await expect(fetchJsonWithRetry("https://example.test/x", { sleepFn: noSleep })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and then succeeds", async () => {
    const fetchMock = stubFetchSequence([{ status: 503 }, { status: 200, body: [1, 2] }]);
    await expect(fetchJsonWithRetry("https://example.test/x", { sleepFn: noSleep })).resolves.toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 and a network error before succeeding", async () => {
    const fetchMock = stubFetchSequence([
      { status: 429 },
      { error: new TypeError("fetch failed") },
      { status: 200, body: "done" },
    ]);
    await expect(fetchJsonWithRetry("https://example.test/x", { sleepFn: noSleep })).resolves.toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    const fetchMock = stubFetchSequence([{ status: 404 }]);
    await expect(fetchJsonWithRetry("https://example.test/x", { sleepFn: noSleep })).rejects.toThrow("Source returned 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded attempts and throws the last error", async () => {
    const fetchMock = stubFetchSequence([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(fetchJsonWithRetry("https://example.test/x", { sleepFn: noSleep })).rejects.toThrow("Source returned 500");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not start another attempt once the caller's deadline has passed", async () => {
    const fetchMock = stubFetchSequence([{ status: 503 }, { status: 200, body: "late" }]);
    await expect(fetchJsonWithRetry("https://example.test/x", {
      sleepFn: noSleep,
      deadlineAtMs: Date.now() - 1,
    })).rejects.toThrow("Source returned 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries normally while the caller's deadline is still ahead", async () => {
    const fetchMock = stubFetchSequence([{ status: 503 }, { status: 200, body: "on time" }]);
    await expect(fetchJsonWithRetry("https://example.test/x", {
      sleepFn: noSleep,
      deadlineAtMs: Date.now() + 60_000,
    })).resolves.toBe("on time");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rechecks the deadline after the backoff, before starting the next attempt", async () => {
    const fetchMock = stubFetchSequence([{ status: 503 }, { status: 200, body: "late" }]);
    await expect(fetchJsonWithRetry("https://example.test/x", {
      sleepFn: () => new Promise<void>((resolve) => setTimeout(resolve, 120)),
      deadlineAtMs: Date.now() + 30,
    })).rejects.toThrow("Source returned 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
