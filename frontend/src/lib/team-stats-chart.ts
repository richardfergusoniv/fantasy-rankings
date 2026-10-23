import {
  canonicalNflTeam,
  normalizeTeamStatsPlayerName,
  type TeamStatsPlayerRow,
} from "../../../api/_lib/nflverse-team-week-stats";
import type { League } from "../dashboard-types";

const MUTED_LINE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export type TeamStatsChartSeries = {
  id: string;
  name: string;
  label: string;
  color: string;
  rostered: boolean;
  points: Array<{ week: number; value: number | null }>;
};

function isRosteredPlayer(
  player: { name: string; team: string; position: string },
  league: League,
): boolean {
  const entityName = normalizeTeamStatsPlayerName(player.name);
  return [...league.starters, ...league.bench].some((rostered) => (
    rostered.position === player.position
    && rostered.team != null
    && canonicalNflTeam(rostered.team) === player.team
    && normalizeTeamStatsPlayerName(rostered.name) === entityName
  ));
}

/** Build one line per table row for the week-by-week chart (snaps → %). */
export function buildTeamStatsChartSeries(
  rows: readonly TeamStatsPlayerRow[],
  weeks: readonly number[],
  isSnaps: boolean,
  league: League,
): TeamStatsChartSeries[] {
  let mutedIndex = 0;
  return [...rows]
    .map((row) => {
      const rostered = isRosteredPlayer(row, league);
      const color = rostered
        ? "var(--chart-team)"
        : MUTED_LINE_COLORS[mutedIndex++ % MUTED_LINE_COLORS.length] ?? "var(--dim)";
      return {
        id: row.key,
        name: row.name,
        label: row.name,
        color,
        rostered,
        points: weeks.map((weekNumber) => {
          const cell = row.weeks.find((candidate) => candidate.week === weekNumber);
          if (!cell?.hasSourceRow) return { week: weekNumber, value: null };
          return {
            week: weekNumber,
            value: isSnaps ? (cell.percent ?? 0) : cell.value,
          };
        }),
      };
    })
    .sort((a, b) => Number(b.rostered) - Number(a.rostered) || a.name.localeCompare(b.name));
}
