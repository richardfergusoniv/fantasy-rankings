import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

const { parseAnalyticsRows, buildAnalytics, analyticsSectionFromPrecompute } = await import("./analytics-build");

// A deliberately scrambled subset of the real stats-file header, plus one
// column the analytics math never reads: the parse must project by header
// name, not by position.
const COLUMNS = [
  "week", "player_display_name", "position", "def_sacks", "season", "game_id",
  "team", "season_type", "player_id", "passing_yards", "rushing_yards",
  "carries", "targets", "receptions", "receiving_yards", "completions",
  "attempts", "extra_unused",
];

type FixtureRow = Record<string, string>;

function serialize(rows: FixtureRow[], columns: string[]): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column] ?? "")).join(",")),
  ].join("\n");
}

const GAME_ROWS: FixtureRow[] = [
  { week: "1", player_display_name: "Allen, Josh", position: "QB", def_sacks: "0", season: "2026", game_id: "2026_01_MIA_BUF", team: "BUF", season_type: "REG", player_id: "00-0034796", passing_yards: "300", rushing_yards: "40", carries: "8", completions: "20", attempts: "30" },
  { week: "1", player_display_name: "James Cook", position: "RB", def_sacks: "1", season: "2026", game_id: "2026_01_MIA_BUF", team: "BUF", season_type: "REG", player_id: "00-0037237", rushing_yards: "80", carries: "15", targets: "5", receptions: "4", receiving_yards: "30" },
  { week: "1", player_display_name: "Tua Tagovailoa", position: "QB", def_sacks: "2", season: "2026", game_id: "2026_01_MIA_BUF", team: "MIA", season_type: "REG", player_id: "00-0036212", passing_yards: "250", rushing_yards: "10", carries: "2", completions: "18", attempts: "25" },
  { week: "1", player_display_name: "De'Von Achane", position: "RB", def_sacks: "0", season: "2026", game_id: "2026_01_MIA_BUF", team: "MIA", season_type: "REG", player_id: "00-0038140", rushing_yards: "60", carries: "12", targets: "6", receptions: "5", receiving_yards: "45" },
  { week: "1", player_display_name: "Allen, Josh", position: "QB", def_sacks: "9", season: "2026", game_id: "2026_19_BUF_KC", team: "BUF", season_type: "POST", player_id: "00-0034796", passing_yards: "999" },
  { week: "1", player_display_name: "Ghost Player", position: "RB", season: "2026", game_id: "", team: "BUF", season_type: "REG", player_id: "00-0000000", rushing_yards: "500" },
];

describe("parseAnalyticsRows", () => {
  it("slims one game into player rows plus per-team defenses with cross-filled yards allowed", () => {
    const rows = parseAnalyticsRows(serialize(GAME_ROWS, COLUMNS));
    expect(rows).toHaveLength(6);

    const allen = rows[0];
    expect(allen).toMatchObject({ id: "00-0034796", name: "Allen, Josh", team: "BUF", position: "QB", season: 2026, week: 1 });
    expect(allen?.values.passing_yards).toBe(300);
    expect(allen?.values.completion_pct).toBeCloseTo((20 / 30) * 100);

    const bufDefense = rows.find((row) => row.position === "DEF" && row.team === "BUF");
    expect(bufDefense?.values.sacks).toBe(1);
    // Miami's offense: 250 + 10 passing/rushing from its QB, 60 rushing from its RB.
    expect(bufDefense?.values.yards_allowed).toBe(320);

    const miaDefense = rows.find((row) => row.position === "DEF" && row.team === "MIA");
    expect(miaDefense?.values.sacks).toBe(2);
    // Buffalo's offense: 300 + 40 from its QB, 80 rushing from its RB.
    expect(miaDefense?.values.yards_allowed).toBe(420);
  });

  it("drops postseason rows and rows without a game id entirely", () => {
    const rows = parseAnalyticsRows(serialize(GAME_ROWS, COLUMNS));
    expect(rows.some((row) => row.gameId === "2026_19_BUF_KC")).toBe(false);
    expect(rows.some((row) => row.id === "00-0000000")).toBe(false);
    // The POST row's 9 sacks and the ghost row's 500 rushing yards reach nothing.
    const bufDefense = rows.find((row) => row.position === "DEF" && row.team === "BUF");
    expect(bufDefense?.values.sacks).toBe(1);
    const miaDefense = rows.find((row) => row.position === "DEF" && row.team === "MIA");
    expect(miaDefense?.values.yards_allowed).toBe(420);
  });

  it("produces identical rows when the header order changes", () => {
    const forward = parseAnalyticsRows(serialize(GAME_ROWS, COLUMNS));
    const reversed = parseAnalyticsRows(serialize(GAME_ROWS, [...COLUMNS].reverse()));
    expect(reversed).toEqual(forward);
  });
});

describe("buildAnalytics", () => {
  const previousCsv = serialize([
    { week: "17", player_display_name: "Allen, Josh", position: "QB", season: "2025", game_id: "2025_17_BUF_NE", team: "BUF", season_type: "REG", player_id: "00-0034796", passing_yards: "200", completions: "15", attempts: "20" },
  ], COLUMNS);
  const currentCsv = serialize([
    { week: "1", player_display_name: "Allen, Josh", position: "QB", season: "2026", game_id: "2026_01_MIA_BUF", team: "BUF", season_type: "REG", player_id: "00-0034796", passing_yards: "300", completions: "20", attempts: "30" },
    { week: "2", player_display_name: "Allen, Josh", position: "QB", season: "2026", game_id: "2026_02_BUF_NYJ", team: "BUF", season_type: "REG", player_id: "00-0034796", passing_yards: "100", completions: "5", attempts: "10" },
  ], COLUMNS);

  it("averages the current season separately from the rolling window that reaches into last season", () => {
    const built = buildAnalytics(previousCsv, currentCsv, 2026, null, null);
    expect(built.throughWeek).toBe(2);

    const qb = built.entities.find((entity) => entity.id === "QB:00-0034796");
    expect(qb?.seasonGames).toBe(2);
    expect(qb?.season.passing_yards).toBe(200);
    expect(qb?.rollingGames).toBe(3);
    expect(qb?.rolling17.passing_yards).toBe(200);
    // No insights snapshot: skill players get no Sleeper id...
    expect(qb?.playerId).toBeNull();
    // ...while defenses key on the team itself.
    const defense = built.entities.find((entity) => entity.position === "DEF" && entity.team === "BUF");
    expect(defense?.playerId).toBe("BUF");

    expect(built.teamUsage.some((usage) => usage.team === "BUF")).toBe(true);
  });
});

describe("analyticsSectionFromPrecompute", () => {
  const built = buildAnalytics("", serialize([
    { week: "3", player_display_name: "Allen, Josh", position: "QB", season: "2026", game_id: "2026_03_BUF_MIA", team: "BUF", season_type: "REG", player_id: "00-0034796", passing_yards: "280" },
  ], COLUMNS), 2026, null, null);
  const precompute = {
    computedAt: "2026-11-04T12:00:00.000Z",
    throughWeek: built.throughWeek,
    entities: built.entities,
    teamUsage: built.teamUsage,
  };

  it("carries the stored entities through, stamped with the precompute time", () => {
    const section = analyticsSectionFromPrecompute(precompute, [{ team: "BUF", wins: 7, losses: 2, ties: 0 }]);
    expect(section?.asOf).toBe("2026-11-04T12:00:00.000Z");
    expect(section?.throughWeek).toBe(3);
    expect(section?.sourceUrl).toContain("stats_player_week_2026.csv");
    expect(section?.entities).toBe(built.entities);
    expect(section?.teamUsage).toBe(built.teamUsage);
    expect(section?.teamRecords).toEqual([{ team: "BUF", wins: 7, losses: 2, ties: 0 }]);
  });

  it("returns null when the snapshot carries no precompute yet", () => {
    expect(analyticsSectionFromPrecompute(undefined, [])).toBeNull();
    expect(analyticsSectionFromPrecompute(null, [])).toBeNull();
  });
});
