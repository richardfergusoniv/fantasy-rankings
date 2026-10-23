import { describe, expect, it } from "vitest";
import type { TeamStatsPlayerRow } from "../../../api/_lib/nflverse-team-week-stats";
import type { League } from "../dashboard-types";
import { buildTeamStatsChartSeries } from "./team-stats-chart";

function player(
  name: string,
  weeks: TeamStatsPlayerRow["weeks"],
  position: TeamStatsPlayerRow["position"] = "WR",
): TeamStatsPlayerRow {
  return {
    key: name,
    playerId: name,
    name,
    team: "SEA",
    position,
    weeks,
    total: weeks.reduce((sum, cell) => sum + cell.value, 0),
  };
}

function cell(week: number, value: number, percent: number | null = null, hasSourceRow = true): TeamStatsPlayerRow["weeks"][number] {
  return { week, value, percent, hasSourceRow };
}

describe("buildTeamStatsChartSeries", () => {
  const league = {
    starters: [{ name: "DK Metcalf", team: "SEA", position: "WR" }],
    bench: [],
  } as unknown as League;

  it("charts snap percent for snaps and highlights rostered players", () => {
    const rows = [
      player("DK Metcalf", [cell(1, 40, 80), cell(2, 35, 70)]),
      player("Other WR", [cell(1, 20, 40), cell(2, 25, 50)]),
    ];
    const series = buildTeamStatsChartSeries(rows, [1, 2], true, league);
    expect(series[0]?.name).toBe("DK Metcalf");
    expect(series[0]?.rostered).toBe(true);
    expect(series[0]?.color).toBe("var(--chart-team)");
    expect(series[0]?.points).toEqual([
      { week: 1, value: 80 },
      { week: 2, value: 70 },
    ]);
    expect(series[1]?.rostered).toBe(false);
    expect(series[1]?.points).toEqual([
      { week: 1, value: 40 },
      { week: 2, value: 50 },
    ]);
  });

  it("charts raw weekly values for non-snap stats and nulls missing weeks", () => {
    const rows = [
      player("Other WR", [cell(1, 8), cell(2, 0, null, false)]),
    ];
    const series = buildTeamStatsChartSeries(rows, [1, 2], false, league);
    expect(series[0]?.points).toEqual([
      { week: 1, value: 8 },
      { week: 2, value: null },
    ]);
  });
});
