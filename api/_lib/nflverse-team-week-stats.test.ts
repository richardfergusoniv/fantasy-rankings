import { describe, expect, it } from "vitest";
import {
  TEAM_STATS_GROUP_POSITIONS,
  buildTeamStatsTable,
  buildTeamStatsWeekStacks,
  canonicalNflTeam,
  defaultTeamStatsGroup,
  defaultTeamStatsTeam,
  formatTeamStatsPercent,
  formatTeamStatsValue,
  parsePlayerWeekStatsCsv,
  parseTeamWeekSnapCountsCsv,
  type TeamWeekSnapRow,
  type TeamWeekStatRow,
} from "./nflverse-team-week-stats.js";

const STATS_HEADER = [
  "player_id",
  "player_name",
  "player_display_name",
  "position",
  "position_group",
  "headshot_url",
  "season",
  "week",
  "season_type",
  "game_id",
  "team",
  "opponent_team",
  "completions",
  "attempts",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "carries",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "targets",
  "receiving_yards",
  "receiving_tds",
  "target_share",
  "fantasy_points_ppr",
].join(",");

function statsRow(fields: {
  id: string;
  name: string;
  position: string;
  week: number;
  team: string;
  opponent?: string;
  seasonType?: string;
  targets?: number;
  receptions?: number;
  receivingYards?: number;
  carries?: number;
  rushingYards?: number;
  receivingTds?: number;
  rushingTds?: number;
  passingTds?: number;
  targetShare?: number;
  fantasyPpr?: number;
}): string {
  const cells = Array.from({ length: 26 }, () => "");
  cells[0] = fields.id;
  cells[1] = fields.name;
  cells[2] = fields.name;
  cells[3] = fields.position;
  cells[4] = fields.position;
  cells[6] = "2026";
  cells[7] = String(fields.week);
  cells[8] = fields.seasonType ?? "REG";
  cells[9] = `2026_${String(fields.week).padStart(2, "0")}_${fields.team}_OPP`;
  cells[10] = fields.team;
  cells[11] = fields.opponent ?? "";
  cells[15] = String(fields.passingTds ?? 0);
  cells[17] = String(fields.carries ?? 0);
  cells[18] = String(fields.rushingYards ?? 0);
  cells[19] = String(fields.rushingTds ?? 0);
  cells[20] = String(fields.receptions ?? 0);
  cells[21] = String(fields.targets ?? 0);
  cells[22] = String(fields.receivingYards ?? 0);
  cells[23] = String(fields.receivingTds ?? 0);
  cells[24] = fields.targetShare === undefined ? "" : String(fields.targetShare);
  cells[25] = String(fields.fantasyPpr ?? 0);
  return cells.join(",");
}

const SNAPS_HEADER =
  "game_id,pfr_game_id,season,game_type,week,player,pfr_player_id,position,team,opponent,offense_snaps,offense_pct,defense_snaps,defense_pct,st_snaps,st_pct";

function snapRow(fields: {
  week: number;
  player: string;
  position: string;
  team: string;
  snaps: number;
  pct: number;
  gameType?: string;
}): string {
  return [
    `2026_${String(fields.week).padStart(2, "0")}_${fields.team}_OPP`,
    "",
    "2026",
    fields.gameType ?? "REG",
    String(fields.week),
    fields.player,
    "",
    fields.position,
    fields.team,
    "OPP",
    String(fields.snaps),
    String(fields.pct),
    "0",
    "0",
    "0",
    "0",
  ].join(",");
}

describe("nflverse-team-week-stats", () => {
  it("canonicalizes NFL team codes", () => {
    expect(canonicalNflTeam("jac")).toBe("JAX");
    expect(canonicalNflTeam("LA")).toBe("LAR");
    expect(canonicalNflTeam("WSH")).toBe("WAS");
  });

  it("parses player week stats and snap counts (REG only)", () => {
    const statsCsv = [
      STATS_HEADER,
      statsRow({
        id: "wr1", name: "DK Metcalf", position: "WR", week: 1, team: "PIT", opponent: "jac",
        targets: 8, receptions: 5, receivingYards: 90, receivingTds: 1,
        targetShare: 0.25, fantasyPpr: 20.0,
      }),
      statsRow({
        id: "wr1", name: "DK Metcalf", position: "WR", week: 2, team: "PIT",
        targets: 6, receptions: 4, receivingYards: 55, targetShare: 0.2, fantasyPpr: 9.5,
      }),
      statsRow({
        id: "wr2", name: "Postseason Guy", position: "WR", week: 1, team: "PIT",
        seasonType: "POST", targets: 99, fantasyPpr: 40,
      }),
    ].join("\n");

    const snapsCsv = [
      SNAPS_HEADER,
      snapRow({ week: 1, player: "DK Metcalf", position: "WR", team: "PIT", snaps: 64, pct: 0.96 }),
      snapRow({ week: 2, player: "DK Metcalf", position: "WR", team: "PIT", snaps: 50, pct: 0.8 }),
      snapRow({ week: 1, player: "Practice Squad", position: "WR", team: "PIT", snaps: 0, pct: 0, gameType: "PRE" }),
    ].join("\n");

    const stats = parsePlayerWeekStatsCsv(statsCsv);
    const snaps = parseTeamWeekSnapCountsCsv(snapsCsv);
    expect(stats).toHaveLength(2);
    expect(stats[0]?.opponent).toBe("JAX");
    expect(stats[1]?.opponent).toBe("");
    expect(stats[0]?.targetShare).toBeCloseTo(25);
    expect(snaps).toHaveLength(2);
    expect(snaps[0]?.offensePct).toBeCloseTo(96);
  });

  it("builds stacked snap rows sorted by season total", () => {
    const stats: TeamWeekStatRow[] = [];
    const snaps: TeamWeekSnapRow[] = [
      { name: "A Star", team: "SEA", position: "WR", week: 1, offenseSnaps: 60, offensePct: 90 },
      { name: "A Star", team: "SEA", position: "WR", week: 2, offenseSnaps: 55, offensePct: 85 },
      { name: "B Depth", team: "SEA", position: "WR", week: 1, offenseSnaps: 20, offensePct: 30 },
      { name: "B Depth", team: "SEA", position: "WR", week: 2, offenseSnaps: 10, offensePct: 15 },
    ];
    const rows = buildTeamStatsTable({
      stats,
      snaps,
      team: "SEA",
      positions: ["WR"],
      statId: "snaps",
      throughWeek: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("A Star");
    expect(rows[0]?.total).toBe(115);
    expect(rows[0]?.weeks[0]).toEqual({ week: 1, value: 60, percent: 90 });
    expect(rows[1]?.weeks[1]).toEqual({ week: 2, value: 10, percent: 15 });
  });

  it("defaults team and group from the user roster", () => {
    expect(defaultTeamStatsTeam(["SEA", "SEA", "SF", null])).toBe("SEA");
    expect(defaultTeamStatsGroup(
      [
        { team: "SEA", position: "WR" },
        { team: "SEA", position: "WR" },
        { team: "SEA", position: "RB" },
        { team: "SF", position: "QB" },
      ],
      "SEA",
    )).toBe("WRTE");
    // A lone TE on another team does not change the fallback group.
    expect(defaultTeamStatsGroup([{ team: "DAL", position: "TE" }], "SEA")).toBe("WRTE");
  });

  it("merges WRs and TEs into one receiving group", () => {
    const stats: TeamWeekStatRow[] = [
      {
        playerId: "wr1", name: "Wide Out", team: "KC", opponent: "BUF", position: "WR", week: 1,
        targets: 8, receptions: 6, receivingYards: 90, carries: 0, rushingYards: 0,
        receivingTds: 1, rushingTds: 0, passingTds: 0, fantasyPpr: 21, targetShare: 25,
        completions: 0, passAttempts: 0, passingYards: 0, interceptions: 0,
      },
      {
        playerId: "te1", name: "Tight End", team: "KC", opponent: "BUF", position: "TE", week: 1,
        targets: 4, receptions: 3, receivingYards: 40, carries: 0, rushingYards: 0,
        receivingTds: 0, rushingTds: 0, passingTds: 0, fantasyPpr: 7, targetShare: 12,
        completions: 0, passAttempts: 0, passingYards: 0, interceptions: 0,
      },
    ];
    const rows = buildTeamStatsTable({
      stats,
      snaps: [],
      team: "KC",
      positions: TEAM_STATS_GROUP_POSITIONS.WRTE,
      statId: "targets",
      throughWeek: 1,
    });
    expect(rows.map((row) => row.name)).toEqual(["Wide Out", "Tight End"]);
    const stacks = buildTeamStatsWeekStacks(rows);
    expect(stacks[0]?.total).toBe(12);
    expect(stacks[0]?.segments[0]?.share).toBeCloseTo(2 / 3);
    expect(stacks[0]?.segments[1]?.share).toBeCloseTo(1 / 3);
  });

  it("formats values and percents", () => {
    expect(formatTeamStatsValue("snaps", 64.2)).toBe("64");
    expect(formatTeamStatsValue("fantasy_ppr", 9.5)).toBe("9.5");
    expect(formatTeamStatsValue("fantasy_ppr", 10)).toBe("10");
    expect(formatTeamStatsPercent(96.4)).toBe("96%");
  });

  it("builds 100% week stacks with shares and an Other bucket", () => {
    const row = (name: string, weeks: Array<{ week: number; value: number }>, total: number) => ({
      key: `WR|KC|${name}`,
      playerId: null,
      name,
      team: "KC",
      position: "WR" as const,
      weeks: weeks.map((cell) => ({ ...cell, percent: null })),
      total,
    });
    const stacks = buildTeamStatsWeekStacks([
      row("Alpha", [{ week: 1, value: 60 }, { week: 2, value: 30 }], 90),
      row("Beta", [{ week: 1, value: 30 }, { week: 2, value: 60 }], 90),
      row("Gamma", [{ week: 1, value: 1 }, { week: 2, value: 0 }], 1),
    ]);
    expect(stacks).toHaveLength(2);
    expect(stacks[0]?.total).toBe(91);
    expect(stacks[0]?.segments.map((s) => s.name)).toEqual(["Alpha", "Beta", "Other"]);
    expect(stacks[0]?.segments[0]?.share).toBeCloseTo(60 / 91);
    expect(stacks[0]?.segments[2]?.value).toBe(1);
    // Week 2: Gamma has no value and drops out entirely (no Other).
    expect(stacks[1]?.segments.map((s) => s.name)).toEqual(["Beta", "Alpha"]);
    const shareSum = stacks[1]?.segments.reduce((sum, s) => sum + s.share, 0);
    expect(shareSum).toBeCloseTo(1);
    expect(stacks[0]?.hasActivity).toBe(true);
  });

  it("marks weeks with only negative values as active but keeps them out of the bar", () => {
    const qbRow = {
      key: "QB|KC|Solo",
      playerId: null,
      name: "Solo",
      team: "KC",
      position: "QB" as const,
      weeks: [
        { week: 1, value: 20, percent: null },
        { week: 2, value: -3, percent: null },
        { week: 3, value: 0, percent: null },
      ],
      total: 17,
    };
    const stacks = buildTeamStatsWeekStacks([qbRow]);
    expect(stacks[0]).toMatchObject({ total: 20, hasActivity: true });
    // A negative-only week: active (it belongs in an average's denominator)
    // but the bar stays empty and the total stays 0.
    expect(stacks[1]).toMatchObject({ total: 0, hasActivity: true, segments: [] });
    expect(stacks[2]).toMatchObject({ total: 0, hasActivity: false, segments: [] });
  });
});
