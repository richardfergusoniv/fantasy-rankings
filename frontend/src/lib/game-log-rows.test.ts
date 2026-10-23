import { describe, expect, it } from "vitest";
import { buildGameLogRows } from "./game-log-rows";

const game = (season: number, week: number, points: number) => ({ season, week, points });

describe("buildGameLogRows", () => {
  it("lists games newest first, scaled to the best game", () => {
    const rows = buildGameLogRows([game(2026, 1, 5), game(2026, 2, 20)]);
    expect(rows.map((row) => (row.kind === "game" ? row.game.week : -1))).toEqual([2, 1]);
    expect(rows.map((row) => (row.kind === "game" ? row.share : -1))).toEqual([1, 0.25]);
  });

  it("adds a gap row for each week missing inside a season", () => {
    const rows = buildGameLogRows([game(2026, 1, 10), game(2026, 4, 10)]);
    expect(rows.map((row) => (row.kind === "game" ? `G${row.game.week}` : `gap${row.week}`))).toEqual(["G4", "gap3", "gap2", "G1"]);
  });

  it("does not bridge seasons or invent leading weeks, and floors negative points", () => {
    const rows = buildGameLogRows([game(2025, 17, 8), game(2026, 3, -2)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "game", share: 0 });
  });

  it("scales a season whose best game is under a point to that game", () => {
    const rows = buildGameLogRows([game(2026, 1, 0.2), game(2026, 2, 0.5)]);
    expect(rows.map((row) => (row.kind === "game" ? row.share : -1))).toEqual([1, 0.4]);
  });

  it("gives no bar when no game scored", () => {
    const rows = buildGameLogRows([game(2026, 1, 0), game(2026, 2, -1)]);
    expect(rows.map((row) => (row.kind === "game" ? row.share : -1))).toEqual([0, 0]);
  });
});
