import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FREE_AGENT_ACTUALS_CAP,
  awaitWithBudget,
  remainingMsUntil,
  remainingOptionalActualsBudgetMs,
  resolveRosterPlayerActual,
  selectActualStatsCandidates,
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

describe("selectActualStatsCandidates", () => {
  it("includes every rostered live/final player uncapped when none have matchup points", () => {
    const rosteredIds = new Set(Array.from({ length: 180 }, (_, index) => `r${index}`));
    const rows = [
      ...[...rosteredIds].map((playerId, index) => row(playerId, { leagueProjection: 1 + index * 0.01 })),
      row("fa-top", { leagueProjection: 99 }),
    ];
    const selected = selectActualStatsCandidates({
      rows,
      rosteredIds,
      matchupPointsByPlayerId: new Map(),
      freeAgentCap: 1,
    });
    expect(selected.priorityPlayerIds).toHaveLength(180);
    expect(selected.freeAgentPlayerIds).toEqual(["fa-top"]);
  });

  it("includes rostered players missing their own points even when others already scored", () => {
    const selected = selectActualStatsCandidates({
      rows: [
        row("rostered-missing", { leagueProjection: 14 }),
        row("rostered-scored", { leagueProjection: 18 }),
        row("fa", { leagueProjection: 20 }),
      ],
      rosteredIds: new Set(["rostered-missing", "rostered-scored"]),
      matchupPointsByPlayerId: new Map([["rostered-scored", 12.4], ["other", 5]]),
    });
    expect(selected.priorityPlayerIds).toEqual(["rostered-missing"]);
    expect(selected.freeAgentPlayerIds).toEqual(["fa"]);
  });

  it("does not pull rostered players into the stats path when matchup points already exist", () => {
    const selected = selectActualStatsCandidates({
      rows: [row("rostered"), row("fa", { leagueProjection: 20 })],
      rosteredIds: new Set(["rostered"]),
      matchupPointsByPlayerId: new Map([["rostered", 12.4]]),
    });
    expect(selected.priorityPlayerIds).toEqual([]);
    expect(selected.freeAgentPlayerIds).toEqual(["fa"]);
  });

  it("caps free agents independently of rostered priority volume", () => {
    const freeAgents = Array.from({ length: FREE_AGENT_ACTUALS_CAP + 25 }, (_, index) => (
      row(`fa${index}`, { leagueProjection: FREE_AGENT_ACTUALS_CAP + 25 - index })
    ));
    const selected = selectActualStatsCandidates({
      rows: [row("rostered", { leagueProjection: 50 }), ...freeAgents],
      rosteredIds: new Set(["rostered"]),
      matchupPointsByPlayerId: new Map(),
    });
    expect(selected.priorityPlayerIds).toEqual(["rostered"]);
    expect(selected.freeAgentPlayerIds).toHaveLength(FREE_AGENT_ACTUALS_CAP);
    expect(selected.freeAgentPlayerIds[0]).toBe("fa0");
    expect(selected.freeAgentPlayerIds.at(-1)).toBe(`fa${FREE_AGENT_ACTUALS_CAP - 1}`);
  });

  it("ignores pregame rows and players who already have matchup points", () => {
    const selected = selectActualStatsCandidates({
      rows: [
        row("pregame", { gamePhase: "pregame", leagueProjection: 40 }),
        row("live-fa", { gamePhase: "live", leagueProjection: 15 }),
        row("final-fa", { gamePhase: "final", leagueProjection: 12 }),
        row("scored-fa", { gamePhase: "final", leagueProjection: 30 }),
      ],
      rosteredIds: new Set(),
      matchupPointsByPlayerId: new Map([["scored-fa", 8]]),
    });
    expect(selected.priorityPlayerIds).toEqual([]);
    expect(selected.freeAgentPlayerIds).toEqual(["live-fa", "final-fa"]);
  });

  it("honors an explicit free-agent cap below the default", () => {
    const selected = selectActualStatsCandidates({
      rows: [
        row("a", { leagueProjection: 3 }),
        row("b", { leagueProjection: 2 }),
        row("c", { leagueProjection: 1 }),
      ],
      rosteredIds: new Set(),
      matchupPointsByPlayerId: new Map(),
      freeAgentCap: 2,
    });
    expect(selected.freeAgentPlayerIds).toEqual(["a", "b"]);
  });
});

describe("remainingMsUntil / remainingOptionalActualsBudgetMs", () => {
  it("never returns a negative remaining budget", () => {
    expect(remainingMsUntil(1_000, 1_500)).toBe(0);
    expect(remainingMsUntil(2_000, 1_500)).toBe(500);
  });

  it("caps the optional FA budget by the harder build-lease deadline", () => {
    expect(remainingOptionalActualsBudgetMs(5_000, 3_000, 1_000)).toBe(2_000);
    expect(remainingOptionalActualsBudgetMs(2_500, 10_000, 1_000)).toBe(1_500);
    expect(remainingOptionalActualsBudgetMs(2_000, 3_000, 4_000)).toBe(0);
  });
});

describe("awaitWithBudget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns done when work finishes inside the budget", async () => {
    const onTimeout = vi.fn();
    await expect(awaitWithBudget(Promise.resolve(), 1_000, onTimeout)).resolves.toBe("done");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("returns timeout and hands off the pending work without rejecting", async () => {
    vi.useFakeTimers();
    let resolveWork!: () => void;
    const work = new Promise<void>((resolve) => { resolveWork = resolve; });
    const onTimeout = vi.fn();
    const pending = awaitWithBudget(work, 50, onTimeout);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBe("timeout");
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0]?.[0]).toBe(work);
    resolveWork();
    await work;
  });
});
