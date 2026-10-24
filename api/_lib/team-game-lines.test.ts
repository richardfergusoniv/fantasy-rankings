import { describe, expect, it, vi } from "vitest";
import type { NflverseGameRow } from "./nflverse-game-lines.js";
import { loadTeamGameLines, resetTeamGameLinesCache, teamGameLinesForWeek } from "./team-game-lines.js";

function game(overrides: Partial<NflverseGameRow>): NflverseGameRow {
  return {
    gameId: "2026_08_KC_TEN",
    season: 2026,
    gameType: "REG",
    week: 8,
    gameday: "2026-10-25",
    weekday: "Sunday",
    gametime: "13:00",
    awayTeam: "KC",
    homeTeam: "TEN",
    location: "Home",
    awayScore: null,
    homeScore: null,
    awayMoneyline: null,
    homeMoneyline: null,
    spreadLine: -7,
    totalLine: 44.5,
    ...overrides,
  };
}

describe("teamGameLinesForWeek", () => {
  it("gives each team its own spread and implied points", () => {
    // spread_line -7: the away team (KC) is a 7-point favorite.
    const [kc, ten] = teamGameLinesForWeek([game({})], 2026, 8);
    expect(kc).toEqual({ team: "KC", opponent: "TEN", isHome: false, spread: -7, total: 44.5, impliedPoints: 25.8 });
    expect(ten).toEqual({ team: "TEN", opponent: "KC", isHome: true, spread: 7, total: 44.5, impliedPoints: 18.8 });
  });

  it("maps nflverse team codes to the app's and skips other weeks", () => {
    const lines = teamGameLinesForWeek([
      game({ awayTeam: "LA", homeTeam: "SEA", spreadLine: 2.5, totalLine: 47 }),
      game({ week: 9 }),
    ], 2026, 8);
    expect(lines.map((line) => line.team)).toEqual(["LAR", "SEA"]);
    expect(lines[1]).toMatchObject({ spread: -2.5, impliedPoints: 24.8 });
  });

  it("leaves lines empty when the book hasn't posted them", () => {
    const [away] = teamGameLinesForWeek([game({ spreadLine: null, totalLine: null })], 2026, 8);
    expect(away).toMatchObject({ spread: null, total: null, impliedPoints: null });
  });
});

describe("loadTeamGameLines", () => {
  it("rejects malformed responses without poisoning the cache", async () => {
    resetTeamGameLinesCache();
    const fetchCsv = vi.fn()
      .mockResolvedValueOnce("<html>upstream unavailable</html>")
      .mockResolvedValueOnce("game_id,season,game_type,week,away_team,home_team,spread_line,total_line\n");
    await expect(loadTeamGameLines(2026, 8, fetchCsv)).rejects.toThrow("missing required headers");
    await expect(loadTeamGameLines(2026, 8, fetchCsv)).resolves.toEqual([]);
    await expect(loadTeamGameLines(2026, 8, fetchCsv)).resolves.toEqual([]);
    expect(fetchCsv).toHaveBeenCalledTimes(2);
  });

  it("rejects CSVs missing betting line columns", async () => {
    resetTeamGameLinesCache();
    await expect(loadTeamGameLines(2026, 8, async () => "game_id,season,game_type,week,away_team,home_team\n"))
      .rejects.toThrow("missing required headers");
  });

  it("fetches the games file once per cache window", async () => {
    resetTeamGameLinesCache();
    const fetchCsv = vi.fn(async () => "game_id,season,game_type,week,away_team,home_team,spread_line,total_line\n");
    await loadTeamGameLines(2026, 8, fetchCsv);
    await loadTeamGameLines(2026, 8, fetchCsv);
    expect(fetchCsv).toHaveBeenCalledTimes(1);
  });
});
