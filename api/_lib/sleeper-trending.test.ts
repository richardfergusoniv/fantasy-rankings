import { describe, expect, it } from "vitest";
import { mergeTrendingLists } from "./sleeper-trending";

describe("mergeTrendingLists", () => {
  it("merges both lists by player id, null for a side the player is not on", () => {
    const merged = mergeTrendingLists(
      [{ player_id: "3271", count: 234135 }, { player_id: "11439", count: 136605 }],
      [{ player_id: "3271", count: 173466 }, { player_id: "13150", count: 196756 }],
    );
    expect(merged).toEqual({
      "3271": { adds: 234135, drops: 173466 },
      "11439": { adds: 136605, drops: null },
      "13150": { adds: null, drops: 196756 },
    });
  });

  it("skips malformed rows and non-array payloads", () => {
    expect(mergeTrendingLists(null, undefined)).toEqual({});
    expect(mergeTrendingLists(
      [{ player_id: "", count: 5 }, { player_id: "1", count: -2 }, { player_id: "2", count: "many" }, { count: 9 }],
      "nope",
    )).toEqual({});
  });

  it("rounds fractional counts", () => {
    expect(mergeTrendingLists([{ player_id: "7", count: 10.6 }], [])).toEqual({ "7": { adds: 11, drops: null } });
  });
});
