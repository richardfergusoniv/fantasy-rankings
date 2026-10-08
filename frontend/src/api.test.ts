import { describe, expect, it } from "vitest";
import { buildQuery } from "./api";

describe("buildQuery", () => {
  it("returns an empty string when every value is omitted", () => {
    expect(buildQuery({ force: undefined, season: undefined })).toBe("");
  });

  it("joins the values that are present", () => {
    expect(buildQuery({
      leagueId: "abc",
      refresh: false,
      season: 2026,
      skipped: undefined,
    })).toBe("?leagueId=abc&refresh=false&season=2026");
  });

  it("encodes a comma-separated player id list", () => {
    expect(buildQuery({ playerIds: "11,22" })).toBe("?playerIds=11%2C22");
  });
});
