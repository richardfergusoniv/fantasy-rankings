import { describe, expect, it } from "vitest";
import { lineupAssistantAnswer } from "./lineup-assistant";
import type { League, RosterPlayer } from "../dashboard-types";

const NOW = Date.parse("2026-11-15T15:00:00Z");
const p = (id: string, projection: number, over: Partial<RosterPlayer> = {}): RosterPlayer => ({
  playerId: id, name: id, team: "KC", position: "WR", lineupSlot: "WR", isStarter: true, rank: null, projection, projectionSource: null, actual: null,
  gamePhase: "pregame", gameTime: "2026-11-15T18:00:00Z", gamePeriod: null, gameClockSeconds: null, opponent: "LV", isAway: false, isBye: false, injuryStatus: null,
  defenseComponents: null, projectionComponents: null, ...over,
}) as RosterPlayer;
const league = (starters: RosterPlayer[], bench: RosterPlayer[], opp: RosterPlayer[] | null = [p("x", 20)]) =>
  ({ starters, bench, opponentTeam: opp ? { name: "Rivals", teamActual: null, teamProjection: null, starters: opp, bench: [] } : null }) as unknown as Pick<League, "starters" | "bench" | "opponentTeam">;

describe("lineupAssistantAnswer", () => {
  it("returns null when the lineup is already best", () => {
    expect(lineupAssistantAnswer(league([p("a", 15), p("b", 12)], [p("c", 5, { isStarter: false, lineupSlot: null })]), NOW)).toBeNull();
  });

  it("recommends swapping in a better bench player and reports the gain and win chance", () => {
    const answer = lineupAssistantAnswer(league([p("a", 15), p("b", 6)], [p("c", 13, { isStarter: false, lineupSlot: null })]), NOW)!;
    expect(answer.swaps).toHaveLength(1);
    expect(answer.swaps[0]).toMatchObject({ slot: "WR", gain: 7 });
    expect(answer.swaps[0]!.playerIn.playerId).toBe("c");
    expect(answer.swaps[0]!.playerOut.playerId).toBe("b");
    expect(answer.gain).toBe(7);
    expect(answer.winAfter!).toBeGreaterThan(answer.winBefore!);
  });

  it("swaps out a player on bye", () => {
    const answer = lineupAssistantAnswer(league([p("a", 15, { isBye: true }), p("b", 12)], [p("c", 8, { isStarter: false, lineupSlot: null })]), NOW)!;
    expect(answer.swaps[0]!.playerOut.playerId).toBe("a");
  });

  it("has no win chance without an opponent", () => {
    const answer = lineupAssistantAnswer(league([p("a", 4)], [p("c", 13, { isStarter: false, lineupSlot: null })], null), NOW)!;
    expect(answer.winBefore).toBeNull();
    expect(answer.winAfter).toBeNull();
  });

  it("reports the real substitution when the optimizer also moves a starter between slots", () => {
    // A is the WR starter (10), B sits at FLEX (20), bench C (15): the best lineup is B at WR, C at FLEX.
    const league = {
      starters: [p("A", 10, { lineupSlot: "WR" }), p("B", 20, { lineupSlot: "FLEX" })],
      bench: [p("C", 15, { isStarter: false, lineupSlot: null })],
      opponentTeam: null,
    } as unknown as Pick<League, "starters" | "bench" | "opponentTeam">;
    const answer = lineupAssistantAnswer(league, NOW)!;
    expect(answer.swaps).toHaveLength(1);
    expect(answer.swaps[0]!.playerIn.playerId).toBe("C");
    expect(answer.swaps[0]!.playerOut.playerId).toBe("A");
    expect(answer.swaps[0]!.gain).toBe(5);
    expect(answer.gain).toBe(5);
  });

  it("treats a filled empty slot as the incoming player replacing nobody", () => {
    const answer = lineupAssistantAnswer(league([p("0", 0, { name: "", lineupSlot: "WR", position: "WR" }), p("b", 12)], [p("c", 9, { isStarter: false, lineupSlot: null })]), NOW)!;
    expect(answer.swaps[0]!.playerIn.playerId).toBe("c");
    expect(answer.swaps[0]!.playerOut.playerId).toBe("0");
  });
});
