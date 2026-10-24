import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();

vi.mock("./db.js", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
  schema: {},
}));

import { checkChatRateLimit, resetChatRateLimits } from "./chat-rate-limit.js";

beforeEach(() => {
  resetChatRateLimits();
  executeMock.mockReset();
});

describe("checkChatRateLimit (shared bucket)", () => {
  it("counts requests against the shared window and limits at max", async () => {
    let count = 0;
    executeMock.mockImplementation(async () => [{ count: ++count }]);

    const now = Date.now();
    expect(await checkChatRateLimit("u1", now, 2, 60_000)).toEqual({ ok: true, remaining: 1 });
    expect(await checkChatRateLimit("u1", now, 2, 60_000)).toEqual({ ok: true, remaining: 0 });
    const limited = await checkChatRateLimit("u1", now, 2, 60_000);
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.retryAfterMs).toBeGreaterThan(0);
    expect(executeMock).toHaveBeenCalledTimes(3);
  });

  it("shares the quota across simulated instances (no per-process reset)", async () => {
    let count = 0;
    executeMock.mockImplementation(async () => [{ count: ++count }]);

    const now = Date.now();
    // Two "instances" hitting the same subject: the second instance's first
    // request already counts against the shared window.
    await checkChatRateLimit("u1", now, 2, 60_000);
    const fromOtherInstance = await checkChatRateLimit("u1", now, 2, 60_000);
    expect(fromOtherInstance).toEqual({ ok: true, remaining: 0 });
    const limited = await checkChatRateLimit("u1", now, 2, 60_000);
    expect(limited.ok).toBe(false);
  });

  it("falls back to the in-memory bucket when the database is unavailable", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const now = Date.now();
    expect(await checkChatRateLimit("u1", now, 1, 60_000)).toEqual({ ok: true, remaining: 0 });
    const limited = await checkChatRateLimit("u1", now, 1, 60_000);
    expect(limited.ok).toBe(false);

    errorSpy.mockRestore();
  });
});
