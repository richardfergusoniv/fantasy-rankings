import { describe, expect, it } from "vitest";
import { points, shortLeagueName } from "./shared";

describe("points", () => {
  it("shows one decimal, and an em dash when the score is missing", () => {
    expect(points(12)).toBe("12.0");
    expect(points(9.25)).toBe("9.3");
    expect(points(null)).toBe("—");
  });
});

describe("shortLeagueName", () => {
  it("shortens the known long league titles and leaves other names as written", () => {
    expect(shortLeagueName("Tits Out for The Ladz XII (TWELVE😤)")).toBe("Ladz XII");
    expect(shortLeagueName("C2C. The real superconference")).toBe("C2C Superconference");
    expect(shortLeagueName("Dynastical Cucks")).toBe("Dynastical Cucks");
  });
});
