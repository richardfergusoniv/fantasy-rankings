import { describe, expect, it } from "vitest";
import {
  COMMAND_RESULT_LIMIT,
  PRIMARY_COMMAND_PAGES,
  filterCommandItems,
  type CommandLeagueItem,
  type CommandPlayerItem,
} from "./command-palette";

const leagues: CommandLeagueItem[] = [
  { kind: "league", id: "l1", label: "Ladz XII" },
  { kind: "league", id: "l2", label: "C2C Superconference" },
];

const players: CommandPlayerItem[] = [
  { kind: "player", id: "p1", label: "Christian McCaffrey", position: "RB" },
  { kind: "player", id: "p2", label: "Justin Jefferson", position: "WR" },
  { kind: "player", id: "p3", label: "Josh Allen", position: "QB" },
  { kind: "player", id: "p4", label: "Travis Kelce", position: "TE" },
  { kind: "player", id: "p5", label: "Tyreek Hill", position: "WR" },
  { kind: "player", id: "p6", label: "Saquon Barkley", position: "RB" },
  { kind: "player", id: "p7", label: "CeeDee Lamb", position: "WR" },
  { kind: "player", id: "p8", label: "Patrick Mahomes", position: "QB" },
  { kind: "player", id: "p9", label: "Ja'Marr Chase", position: "WR" },
];

describe("filterCommandItems", () => {
  it("returns primary pages when the query is empty", () => {
    const results = filterCommandItems("", { pages: PRIMARY_COMMAND_PAGES, leagues, players });
    expect(results).toHaveLength(PRIMARY_COMMAND_PAGES.length);
    expect(results.every((item) => item.kind === "page")).toBe(true);
    expect(results.map((item) => item.label)).toEqual([
      "Monitor",
      "Matchup",
      "Players",
      "League",
      "Draft",
      "Tools",
    ]);
  });

  it("matches pages by label", () => {
    const results = filterCommandItems("match", { pages: PRIMARY_COMMAND_PAGES, leagues, players });
    expect(results).toEqual([
      expect.objectContaining({ kind: "page", label: "Matchup", tab: "team" }),
    ]);
  });

  it("matches players by name and caps at 8", () => {
    const results = filterCommandItems("a", { pages: PRIMARY_COMMAND_PAGES, leagues, players });
    expect(results.length).toBeLessThanOrEqual(COMMAND_RESULT_LIMIT);
    expect(results.length).toBe(COMMAND_RESULT_LIMIT);
    const playerHits = results.filter((item) => item.kind === "player");
    expect(playerHits.length).toBeGreaterThan(0);
    expect(playerHits.every((item) => item.kind === "player" && item.label.toLowerCase().includes("a"))).toBe(true);
  });

  it("matches a specific player name", () => {
    const results = filterCommandItems("jefferson", { pages: PRIMARY_COMMAND_PAGES, leagues, players });
    expect(results).toEqual([
      expect.objectContaining({ kind: "player", id: "p2", label: "Justin Jefferson" }),
    ]);
  });

  it("includes Monitor among the six primary page defaults", () => {
    const monitor = PRIMARY_COMMAND_PAGES.find((page) => page.id === "monitor");
    expect(monitor).toEqual({ kind: "page", id: "monitor", label: "Monitor", tab: "monitor" });
  });
});
