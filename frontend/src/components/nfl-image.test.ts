import { describe, expect, it } from "vitest";
import { playerHeadshotUrl, teamLogoUrl } from "./nfl-image";

describe("teamLogoUrl", () => {
  it("maps team codes to Sleeper logos, normalizing aliases", () => {
    expect(teamLogoUrl("BUF")).toBe("https://sleepercdn.com/images/team_logos/nfl/buf.png");
    expect(teamLogoUrl("WSH")).toContain("/was.png");
    expect(teamLogoUrl("JAC")).toContain("/jax.png");
    expect(teamLogoUrl("LA")).toContain("/lar.png");
  });

  it("returns null for missing or non-code teams", () => {
    expect(teamLogoUrl(null)).toBeNull();
    expect(teamLogoUrl("Buffalo Bills")).toBeNull();
  });
});

describe("playerHeadshotUrl", () => {
  it("only builds a URL for numeric Sleeper ids", () => {
    expect(playerHeadshotUrl("4881")).toBe("https://sleepercdn.com/content/nfl/players/thumb/4881.jpg");
    expect(playerHeadshotUrl("BUF")).toBeNull();
  });
});
