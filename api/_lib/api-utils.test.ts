import { afterEach, describe, expect, it } from "vitest";
import { hasCronSecret } from "./api-utils.js";

describe("hasCronSecret", () => {
  const previous = process.env.CRON_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  it("fails closed when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(hasCronSecret(new Request("https://example.com", {
      headers: { authorization: "Bearer anything" },
    }))).toBe(false);
  });

  it("accepts a matching bearer token via timing-safe compare", () => {
    process.env.CRON_SECRET = "super-secret-value";
    expect(hasCronSecret(new Request("https://example.com", {
      headers: { authorization: "Bearer super-secret-value" },
    }))).toBe(true);
  });

  it("rejects wrong tokens and missing bearer prefix", () => {
    process.env.CRON_SECRET = "super-secret-value";
    expect(hasCronSecret(new Request("https://example.com", {
      headers: { authorization: "Bearer wrong-secret-value" },
    }))).toBe(false);
    expect(hasCronSecret(new Request("https://example.com", {
      headers: { authorization: "super-secret-value" },
    }))).toBe(false);
    expect(hasCronSecret(new Request("https://example.com"))).toBe(false);
  });
});
