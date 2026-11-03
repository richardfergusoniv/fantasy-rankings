import { describe, expect, it } from "vitest";
import { buildVacatedUsage } from "./vacated-usage.js";
import type { TeamWeekStatRow } from "./nflverse-team-week-stats.js";

const row = (
  name: string,
  team: string,
  position: TeamWeekStatRow["position"],
  week: number,
  overrides: Partial<TeamWeekStatRow> = {},
): TeamWeekStatRow => ({
  playerId: `gsis-${name}`,
  name,
  team,
  opponent: "OPP",
  position,
  week,
  targets: 0,
  receptions: 0,
  receivingYards: 0,
  carries: 0,
  rushingYards: 0,
  receivingTds: 0,
  rushingTds: 0,
  passingTds: 0,
  fantasyPpr: 0,
  targetShare: null,
  completions: 0,
  passAttempts: 0,
  passingYards: 0,
  interceptions: 0,
  passingFirstDowns: 0,
  rushingFirstDowns: 0,
  receivingFirstDowns: 0,
  sacksTaken: 0,
  fumblesLost: 0,
  passing2pt: 0,
  rushing2pt: 0,
  receiving2pt: 0,
  ...overrides,
});

const player = (
  playerId: string,
  name: string,
  position: string,
  injuryStatus: string | null,
) => ({ playerId, name, team: "BUF", position, injuryStatus });

describe("buildVacatedUsage", () => {
  it("sums an out teammate's season share and carries onto healthy teammates", () => {
    const stats = [
      row("Hurt Wideout", "BUF", "WR", 1, { targetShare: 28, carries: 0 }),
      row("Hurt Wideout", "BUF", "WR", 2, { targetShare: 22, carries: 0 }),
      row("Hurt Wideout", "BUF", "WR", 3, { targetShare: 26, carries: 2 }),
      row("Healthy Wideout", "BUF", "WR", 1, { targetShare: 15 }),
      row("Healthy Wideout", "BUF", "WR", 2, { targetShare: 15 }),
      row("Back", "BUF", "RB", 1, { carries: 12 }),
      row("Back", "BUF", "RB", 2, { carries: 14 }),
    ];
    const vacated = buildVacatedUsage(
      [
        player("sleeper-hurt", "Hurt Wideout", "WR", "Out"),
        player("sleeper-healthy", "Healthy Wideout", "WR", null),
        player("sleeper-rb", "Back", "RB", "Questionable"),
      ],
      stats,
    );
    // Every healthy teammate gets the team's total: avg share 25.33, avg carries 0.67.
    expect(vacated.get("sleeper-healthy")).toEqual({
      vacatedTargetSharePts: 25.33,
      vacatedCarriesPerGame: 0.67,
    });
    expect(vacated.get("sleeper-rb")).toEqual({
      vacatedTargetSharePts: 25.33,
      vacatedCarriesPerGame: 0.67,
    });
    // The out player himself gets nothing.
    expect(vacated.has("sleeper-hurt")).toBe(false);
  });

  it("counts Doubtful but not Questionable, and ignores players under the games floor", () => {
    const stats = [
      row("Doubtful Back", "BUF", "RB", 1, { targetShare: 10, carries: 15 }),
      row("Doubtful Back", "BUF", "RB", 2, { targetShare: 10, carries: 15 }),
      row("Thin Receiver", "BUF", "WR", 1, { targetShare: 30 }),
    ];
    const vacated = buildVacatedUsage(
      [
        player("sleeper-doubt", "Doubtful Back", "RB", "Doubtful"),
        player("sleeper-thin", "Thin Receiver", "WR", "Questionable"),
        player("sleeper-ok", "Healthy Wideout", "WR", null),
      ],
      stats,
    );
    // Doubtful vacates: share 10, carries 15. Thin Receiver is Questionable
    // and under the games floor anyway — he vacates nothing.
    expect(vacated.get("sleeper-ok")).toEqual({
      vacatedTargetSharePts: 10,
      vacatedCarriesPerGame: 15,
    });
  });

  it("returns nothing when no teammate is out", () => {
    const stats = [
      row("Wideout", "BUF", "WR", 1, { targetShare: 25 }),
      row("Wideout", "BUF", "WR", 2, { targetShare: 25 }),
    ];
    const vacated = buildVacatedUsage(
      [player("sleeper-wr", "Wideout", "WR", null)],
      stats,
    );
    expect(vacated.size).toBe(0);
  });

  it("counts a duplicated Out player (roster ∩ rankings) only once", () => {
    const stats = [
      row("Hurt Wideout", "BUF", "WR", 1, { targetShare: 28, carries: 0 }),
      row("Hurt Wideout", "BUF", "WR", 2, { targetShare: 22, carries: 0 }),
      row("Healthy Wideout", "BUF", "WR", 1, { targetShare: 15 }),
      row("Healthy Wideout", "BUF", "WR", 2, { targetShare: 15 }),
    ];
    const outPlayer = player("sleeper-hurt", "Hurt Wideout", "WR", "Out");
    const vacated = buildVacatedUsage(
      [
        outPlayer,
        outPlayer, // same Out player from roster and rankings
        player("sleeper-healthy", "Healthy Wideout", "WR", null),
      ],
      stats,
    );
    expect(vacated.get("sleeper-healthy")).toEqual({
      vacatedTargetSharePts: 25,
      vacatedCarriesPerGame: 0,
    });
  });
});
