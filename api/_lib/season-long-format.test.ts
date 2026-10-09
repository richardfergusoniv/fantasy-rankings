import { describe, expect, it } from "vitest";
import { rankingsForLeagueFormats, type SeasonFormatRanking, type SeasonFormatTarget } from "./season-long-format.js";

function row(formatKey: string, playerId: string, value: number, position: SeasonFormatRanking["position"] = "WR"): SeasonFormatRanking {
  return {
    formatKey,
    playerId,
    name: playerId,
    team: "BUF",
    position,
    overallRank: 1,
    positionRank: 1,
    value,
    trend30Day: 0,
    isRookie: false,
  };
}

function format(key: string, overrides: Partial<SeasonFormatTarget> = {}): SeasonFormatTarget {
  return {
    key,
    isDynasty: key.startsWith("dynasty"),
    numQbs: key.includes("-2qb-") ? 2 : 1,
    numTeams: Number(key.match(/-(\d+)t-/)?.[1]),
    ppr: Number(key.match(/-([\d.]+)ppr$/)?.[1]),
    ...overrides,
  };
}

const presets = [
  row("redraft-1qb-10t-0.5ppr", "alpha", 100),
  row("redraft-1qb-10t-0.5ppr", "only-ten", 40),
  row("redraft-1qb-12t-0.5ppr", "alpha", 160),
  row("redraft-1qb-12t-1ppr", "alpha", 200),
  row("redraft-2qb-12t-1ppr", "alpha", 180),
  row("redraft-2qb-14t-1ppr", "alpha", 140),
  row("dynasty-1qb-12t-1ppr", "alpha", 900, "QB"),
  row("dynasty-1qb-12t-1ppr", "rookie-pick", 500, "PICK"),
];

describe("rankingsForLeagueFormats", () => {
  it("uses the half-PPR table for standard scoring", () => {
    const rows = rankingsForLeagueFormats(presets, [format("redraft-1qb-12t-0ppr")]);
    const standard = rows.filter((entry) => entry.formatKey === "redraft-1qb-12t-0ppr");
    expect(standard).toEqual([expect.objectContaining({ playerId: "alpha", value: 160 })]);
    expect(rows.filter((entry) => entry.formatKey === "redraft-1qb-12t-0.5ppr")).toHaveLength(1);
  });

  it("uses the nearest published team count for 10-team PPR and for 8- and 16-team leagues", () => {
    const rows = rankingsForLeagueFormats(presets, [
      format("redraft-1qb-10t-1ppr"),
      format("redraft-1qb-8t-0.5ppr"),
      format("redraft-2qb-16t-1ppr"),
    ]);
    expect(rows.find((entry) => entry.formatKey === "redraft-1qb-10t-1ppr")).toMatchObject({ playerId: "alpha", value: 200 });
    expect(rows.find((entry) => entry.formatKey === "redraft-1qb-8t-0.5ppr")).toMatchObject({ playerId: "alpha", value: 100 });
    expect(rows.find((entry) => entry.formatKey === "redraft-2qb-16t-1ppr")).toMatchObject({ playerId: "alpha", value: 140 });
  });

  it("interpolates a team count between two published tables and keeps a player that exists on only one side", () => {
    const rows = rankingsForLeagueFormats(presets, [format("redraft-1qb-11t-0.5ppr")]);
    const eleven = rows.filter((entry) => entry.formatKey === "redraft-1qb-11t-0.5ppr");
    expect(eleven.find((entry) => entry.playerId === "alpha")).toMatchObject({ value: 130, overallRank: 1 });
    expect(eleven.find((entry) => entry.playerId === "only-ten")).toMatchObject({ value: 40, overallRank: 2 });
  });

  it("leaves an exact preset in place and still carries dynasty pick rows onto a synthesized format", () => {
    const rows = rankingsForLeagueFormats(presets, [
      format("redraft-1qb-12t-0.5ppr"),
      format("dynasty-1qb-10t-1ppr"),
    ]);
    expect(rows.filter((entry) => entry.formatKey === "redraft-1qb-12t-0.5ppr")).toHaveLength(1);
    const dynasty = rows.filter((entry) => entry.formatKey === "dynasty-1qb-10t-1ppr");
    expect(dynasty.map((entry) => entry.playerId)).toEqual(["alpha", "rookie-pick"]);
  });
});
