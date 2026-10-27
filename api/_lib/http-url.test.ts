import { describe, expect, it } from "vitest";
import { isHttpOrHttpsUrl } from "./http-url.js";

describe("isHttpOrHttpsUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpOrHttpsUrl("https://x.com/a/status/1")).toBe(true);
    expect(isHttpOrHttpsUrl("http://example.com/path")).toBe(true);
  });

  it("rejects javascript, data, file, and malformed values", () => {
    expect(isHttpOrHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpOrHttpsUrl("data:text/html,hi")).toBe(false);
    expect(isHttpOrHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpOrHttpsUrl("not-a-url")).toBe(false);
    expect(isHttpOrHttpsUrl("")).toBe(false);
  });
});
