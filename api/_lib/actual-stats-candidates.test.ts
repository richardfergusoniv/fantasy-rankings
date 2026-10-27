import { describe, expect, it } from "vitest";
import {
  FREE_AGENT_ACTUALS_CAP,
  isMatchupFeedMissingForActuals,
  resolveRosterPlayerActual,
  selectActualStatsCandidateIds,
  type ActualStatsCandidateRow,
} from "./actual-stats-candidates.js";

function row(
  playerId: string,
  opts: Partial<ActualStatsCandidateRow> = {},
): ActualStatsCandidateRow {
  return {
    playerId,
    gamePhase: "final",
    leagueProjection: 10,
    ...opts,
  };
}

describe("resolveRosterPlayerActual", () => {
  it("prefers numeric matchup points over ranking/defense fallbacks", () => {
    expect(resolveRosterPlayerActual({
      matchupPoints: 12.4,
      rankingActual: 9,
      defenseActualScore: 8,
    })).toBe(12.4);
  });

  it("falls back to ranking actual when matchup points are unavailable", () => {
    expect(resolveRosterPlayerActual({
      matchupPoints: undefined,
      rankingActual: 11.2,
      defenseActualScore: 7,
    })).toBe(11.2);
  });

  it("falls back to defense actualScore for DST rows without matchup points", () => {
    expect(resolveRosterPlayerActual({
      matchupPoints: null,
      rankingActual: null,
      defenseActualScore: 6.5,
    })).toBe(6.5);
  });

  it("keeps a real zero from matchup points and returns null when nothing is usable", () => {
    expect(resolveRosterPlayerActual({ matchupPoints: 0, rankingActual: 4 })).toBe(0);
    expect(resolveRosterPlayerActual({
      matchupPoints: Number.NaN,
      rankingActual: undefined,
      defenseActualScore: null,
    })).toBeNull();
  });
});

describe("isMatchupFeedMissingForActuals", () => {
  it("is true when the matchup request was rejected", () => {
    expect(isMatchupFeedMissingForActuals(true, new Map([["p1", 10]]))).toBe(true);
  });

  it("is true when the feed fulfilled but carried no usable numeric points", () => {
    expect(isMatchupFeedMissingForActuals(false, new Map())).toBe(true);
  });

  it("is false when the feed has at least one usable points entry", () => {
    expect(isMatchupFeedMissingForActuals(false, new Map([["p1", 10]]))).toBe(false);
  });

  it("lets rostered finals into the stats path when the feed is fulfilled but empty", () => {
    const points = new Map<string, number>();
    const selected = selectActualStatsCandidateIds({
      rows: [row("rostered", { leagueProjection: 8 }), row("fa", { leagueProjection: 1 })],
      rosteredIds: new Set(["rostered"]),
      matchupPointsByPlayerId: points,
      matchupFeedMissing: isMatchupFeedMissingForActuals(false, points),
    });
    expect(selected).toContain("rostered");
  });
});

describe("selectActualStatsCandidateIds", () => {
  it("includes every rostered live/final player uncapped when the matchup feed is missing", () => {
    const rosteredIds = new Set(Array.from({ length: 180 }, (_, index) => `r${index}`));
    const rows = [
      ...[...rosteredIds].map((playerId, index) => row(playerId, { leagueProjection: 1 + index * 0.01 })),
      row("fa-top", { leagueProjection: 99 }),
    ];
    const selected = selectActualStatsCandidateIds({
      rows,
      rosteredIds,
      matchupPointsByPlayerId: new Map(),
      matchupFeedMissing: true,
      freeAgentCap: 1,
    });
    expect(selected.filter((id) => rosteredIds.has(id))).toHaveLength(180);
    expect(selected).toContain("fa-top");
  });

  it("does not pull rostered players into the stats path when matchup points already exist", () => {
    const selected = selectActualStatsCandidateIds({
      rows: [row("rostered"), row("fa", { leagueProjection: 20 })],
      rosteredIds: new Set(["rostered"]),
      matchupPointsByPlayerId: new Map([["rostered", 12.4]]),
      matchupFeedMissing: true,
    });
    expect(selected).toEqual(["fa"]);
  });

  it("skips rostered players when the matchup feed is healthy and only caps free agents", () => {
    const freeAgents = Array.from({ length: FREE_AGENT_ACTUALS_CAP + 25 }, (_, index) => (
      row(`fa${index}`, { leagueProjection: FREE_AGENT_ACTUALS_CAP + 25 - index })
    ));
    const selected = selectActualStatsCandidateIds({
      rows: [row("rostered", { leagueProjection: 50 }), ...freeAgents],
      rosteredIds: new Set(["rostered"]),
      matchupPointsByPlayerId: new Map(),
      matchupFeedMissing: false,
    });
    expect(selected).not.toContain("rostered");
    expect(selected).toHaveLength(FREE_AGENT_ACTUALS_CAP);
    expect(selected[0]).toBe("fa0");
    expect(selected.at(-1)).toBe(`fa${FREE_AGENT_ACTUALS_CAP - 1}`);
  });

  it("ignores pregame rows and players who already have matchup points", () => {
    const selected = selectActualStatsCandidateIds({
      rows: [
        row("pregame", { gamePhase: "pregame", leagueProjection: 40 }),
        row("live-fa", { gamePhase: "live", leagueProjection: 15 }),
        row("final-fa", { gamePhase: "final", leagueProjection: 12 }),
        row("scored-fa", { gamePhase: "final", leagueProjection: 30 }),
      ],
      rosteredIds: new Set(),
      matchupPointsByPlayerId: new Map([["scored-fa", 8]]),
      matchupFeedMissing: false,
    });
    expect(selected).toEqual(["live-fa", "final-fa"]);
  });

  it("honors an explicit free-agent cap below the default", () => {
    const selected = selectActualStatsCandidateIds({
      rows: [
        row("a", { leagueProjection: 3 }),
        row("b", { leagueProjection: 2 }),
        row("c", { leagueProjection: 1 }),
      ],
      rosteredIds: new Set(),
      matchupPointsByPlayerId: new Map(),
      matchupFeedMissing: false,
      freeAgentCap: 2,
    });
    expect(selected).toEqual(["a", "b"]);
  });
});
