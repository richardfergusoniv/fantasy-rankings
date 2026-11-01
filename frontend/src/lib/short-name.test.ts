import { describe, expect, it } from "vitest";
import { comparisonShortName, surname } from "./short-name";

describe("comparisonShortName", () => {
  it("skips Jr., Sr. and numeral suffixes", () => {
    expect(surname("Omar Cooper Jr.")).toBe("Cooper");
    expect(surname("Ted Hurst III")).toBe("Hurst");
    expect(surname("David Sills V")).toBe("Sills");
    expect(comparisonShortName("Omar Cooper Jr.", "CeeDee Lamb")).toBe("Cooper");
  });

  it("keeps the full name when both players share a surname", () => {
    expect(comparisonShortName("Jameson Williams", "Kyren Williams")).toBe("Jameson Williams");
  });
});
