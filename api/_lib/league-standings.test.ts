import { describe, expect, it } from "vitest";
import { buildStandings, waiverStatus, type SleeperStandingsRoster } from "./league-standings.js";

const roster = (id: number, wins: number, losses: number, fpts: number, extra: Partial<NonNullable<SleeperStandingsRoster["settings"]>> = {}): SleeperStandingsRoster => ({
  roster_id: id,
  settings: { wins, losses, ties: 0, fpts, fpts_decimal: 50, fpts_against: 700, fpts_against_decimal: 25, ...extra },
});
const name = (r: SleeperStandingsRoster) => `Team ${r.roster_id}`;

describe("buildStandings", () => {
  it("ranks by record, breaks ties on points for, and seeds the playoff spots", () => {
    const { standings, playoffs } = buildStandings(
      [roster(1, 4, 3, 800), roster(2, 6, 1, 750), roster(3, 4, 3, 820), roster(4, 2, 5, 690)],
      1,
      name,
      { playoff_teams: 2, playoff_week_start: 15 },
    );
    expect(standings.map((row) => row.rosterId)).toEqual([2, 3, 1, 4]);
    expect(standings[0]).toMatchObject({ rank: 1, playoffSeed: 1, gamesOutOfPlayoffs: null, pointsFor: 750.5, pointsAgainst: 700.25 });
    expect(standings[1]).toMatchObject({ rosterId: 3, playoffSeed: 2 });
    // Same record as the 2-seed, lost the points tiebreak.
    expect(standings[2]).toMatchObject({ rosterId: 1, isUser: true, playoffSeed: null, gamesOutOfPlayoffs: 0 });
    expect(standings[3]).toMatchObject({ gamesOutOfPlayoffs: 2 });
    expect(playoffs).toEqual({ teams: 2, weekStart: 15, positionKnown: true });
  });

  it.each([true, false])("leaves division qualification unknown (league setting: %s)", (leagueSetting) => {
    const { standings, playoffs } = buildStandings([
      roster(1, 8, 2, 1000, { division: 1 }),
      roster(2, 7, 3, 900, { division: 1 }),
      roster(3, 6, 4, 800, { division: 2 }),
      roster(4, 2, 8, 700, { division: 2 }),
    ], 1, name, { playoff_teams: 2, ...(leagueSetting ? { divisions: 2 } : {}) });
    expect(standings.map((row) => row.rosterId)).toEqual([1, 2, 3, 4]);
    expect(standings.every((row) => row.playoffSeed === null && row.gamesOutOfPlayoffs === null)).toBe(true);
    expect(playoffs.positionKnown).toBe(false);
  });

  it("suppresses seeds when division assignments are missing but divisions are configured", () => {
    const result = buildStandings([roster(1, 1, 0, 100)], 1, name, { playoff_teams: 1, divisions: 2 });
    expect(result.standings[0]?.playoffSeed).toBeNull();
    expect(result.playoffs.positionKnown).toBe(false);
  });

  it("doesn't invent seeds when the league has no playoff settings", () => {
    const { standings, playoffs } = buildStandings([roster(1, 1, 0, 100), roster(2, 0, 1, 90)], 1, name, undefined);
    expect(standings.every((row) => row.playoffSeed === null && row.gamesOutOfPlayoffs === null)).toBe(true);
    expect(playoffs).toEqual({ teams: null, weekStart: null, positionKnown: true });
  });
});

describe("waiverStatus", () => {
  it("reports FAAB remaining and waiver position", () => {
    expect(waiverStatus({ waiver_type: 2, waiver_budget: 100 }, roster(1, 0, 0, 0, { waiver_budget_used: 37, waiver_position: 4 }), 12))
      .toEqual({ type: "faab", budget: 100, remaining: 63, position: 4, teams: 12 });
  });

  it("has no budget for non-FAAB leagues", () => {
    expect(waiverStatus({ waiver_type: 0, waiver_budget: 100 }, roster(1, 0, 0, 0, { waiver_position: 2 }), 10))
      .toEqual({ type: "rolling", budget: null, remaining: null, position: 2, teams: 10 });
    expect(waiverStatus(undefined, undefined, 10)).toMatchObject({ type: null, position: null });
  });
});
