import { describe, expect, it } from "vitest";
import { kindFromPath } from "./data-kind.js";

describe("api/data kindFromPath", () => {
  it("resolves direct dynamic paths", () => {
    expect(kindFromPath("/api/data/box-score")).toBe("box-score");
    expect(kindFromPath("/api/data/pfn-tables")).toBe("pfn-tables");
    expect(kindFromPath("/api/data/value-history")).toBe("value-history");
    expect(kindFromPath("/api/data/trades-history")).toBe("trades-history");
    expect(kindFromPath("/api/data/projected-standings")).toBe("projected-standings");
    expect(kindFromPath("/api/data/draft-grade")).toBe("draft-grade");
  });

  it("resolves rewritten old URLs (Vercel keeps the original pathname)", () => {
    expect(kindFromPath("/api/box-score")).toBe("box-score");
    expect(kindFromPath("/api/pfn-tables")).toBe("pfn-tables");
    expect(kindFromPath("/api/value-history")).toBe("value-history");
    expect(kindFromPath("/api/trades/history")).toBe("trades-history");
  });

  it("rejects unknown paths", () => {
    expect(kindFromPath("/api/data/nope")).toBeNull();
    expect(kindFromPath("/api/history")).toBeNull();
  });
});
