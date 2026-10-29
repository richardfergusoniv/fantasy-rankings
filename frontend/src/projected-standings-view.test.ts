import { describe, expect, it } from "vitest";
import { recordLabel } from "./projected-standings-view";

describe("recordLabel", () => {
  it("shows ties only when there are some", () => {
    expect(recordLabel({ wins: 9, losses: 5, ties: 0 })).toBe("9-5");
    expect(recordLabel({ wins: 8, losses: 5, ties: 1 })).toBe("8-5-1");
  });
});
