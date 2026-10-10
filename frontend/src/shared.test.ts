import { describe, expect, it } from "vitest";
import {
  fantasySosRanksForTeam,
  points,
  positionalSosRank,
  shortLeagueName,
  sosToneFromRank,
  type StrengthOfScheduleEntryLike,
} from "./shared";

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

const sosFixture: StrengthOfScheduleEntryLike = {
  table: {
    NO: {
      QB: { rank: 12 },
      RB: { rank: 7 },
      WR: { rank: 18 },
      TE: { rank: 9 },
    },
    DAL: {
      QB: { rank: 28 },
      RB: { rank: 15 },
      WR: { rank: 22 },
      TE: { rank: 25 },
    },
  },
};

describe("positionalSosRank", () => {
  it("returns the opponent positional fantasy SOS rank for skill positions", () => {
    expect(positionalSosRank(sosFixture, "NO", "RB")).toBe(7);
    expect(positionalSosRank(sosFixture, "DAL", "QB")).toBe(28);
    expect(positionalSosRank(sosFixture, "NO", "K")).toBeNull();
    expect(positionalSosRank(undefined, "NO", "RB")).toBeNull();
  });
});

describe("sosToneFromRank", () => {
  it("marks soft 1–10 and tough 23–32", () => {
    expect(sosToneFromRank(7)).toBe(" sos-soft");
    expect(sosToneFromRank(28)).toBe(" sos-tough");
    expect(sosToneFromRank(14)).toBe("");
    expect(sosToneFromRank(null)).toBe("");
  });
});

describe("fantasySosRanksForTeam", () => {
  it("returns all four positional ranks for a team defense row", () => {
    expect(fantasySosRanksForTeam(sosFixture, "NO")).toEqual({
      QB: 12,
      RB: 7,
      WR: 18,
      TE: 9,
    });
    expect(fantasySosRanksForTeam(sosFixture, "SEA")).toEqual({
      QB: null,
      RB: null,
      WR: null,
      TE: null,
    });
  });
});
