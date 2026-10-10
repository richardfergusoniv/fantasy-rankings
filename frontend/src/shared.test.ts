import { describe, expect, it } from "vitest";
import {
  fantasySosRanksForTeam,
  points,
  positionalSosRank,
  leagueRank,
  rankAmong,
  shortLeagueName,
  rankToneClassName,
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

describe("rankToneClassName", () => {
  it("reuses the soft and tough matchup cutoffs", () => {
    expect(rankToneClassName(7)).toBe("rank-tone sos-soft");
    expect(rankToneClassName(28)).toBe("rank-tone sos-tough");
    expect(rankToneClassName(14)).toBe("rank-tone");
    expect(rankToneClassName(null)).toBe("rank-tone");
  });
});

describe("rankAmong", () => {
  it("ranks higher-is-better with ties sharing the best rank", () => {
    expect(rankAmong([10, 30, 20], 30)).toBe(1);
    expect(rankAmong([10, 30, 20], 10)).toBe(3);
    expect(rankAmong([10, 10, 4], 10)).toBe(1);
  });

  it("ranks lower-is-better so the smallest value is rank 1", () => {
    expect(rankAmong([8, 1, 4], 1, false)).toBe(1);
    expect(rankAmong([8, 1, 4], 8, false)).toBe(3);
  });

  it("returns null when the value is missing or not in the set", () => {
    expect(rankAmong([1, 2], null)).toBeNull();
    expect(rankAmong([], 4)).toBeNull();
    expect(rankAmong([1, 2], 9)).toBeNull();
  });
});

describe("leagueRank", () => {
  it("ranks fewer penalties per game as better", () => {
    const penalties = [6.2, 4.1, 8.0, 5.5];
    expect(leagueRank(penalties, 4.1, false)).toBe(1);
    expect(leagueRank(penalties, 5.5, false)).toBe(2);
    expect(leagueRank(penalties, 8.0, false)).toBe(4);
  });

  it("shares the best rank when penalty rates tie", () => {
    expect(leagueRank([4.1, 4.1, 7.0], 4.1, false)).toBe(1);
  });

  it("stays unranked when fewer than two teams have a value", () => {
    expect(leagueRank([6.2], 6.2, false)).toBeNull();
    expect(leagueRank([], 6.2, false)).toBeNull();
    expect(leagueRank([Number.NaN, 6.2], 6.2, false)).toBeNull();
    expect(leagueRank([4.1, 6.2], null, false)).toBeNull();
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
