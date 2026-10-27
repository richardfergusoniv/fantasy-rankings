/**
 * Weekly projection chart default axes / preset picks.
 * Kickers prefer Vegas team implied totals when present; otherwise ranks vs projection.
 */

export type WeeklyAxesPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "FLEX";

export type WeeklyAxesEntity = {
  position: string;
  values: Record<string, number>;
};

export type WeeklyAxesPreset = { label: string; x: string; y: string };

const defaultWeeklyAxes: Record<Exclude<WeeklyAxesPosition, "FLEX">, [string, string]> = {
  QB: ["leaguePositionRank", "league"],
  RB: ["leaguePositionRank", "league"],
  WR: ["leaguePositionRank", "league"],
  TE: ["leaguePositionRank", "league"],
  K: ["leaguePositionRank", "league"],
  DEF: ["opponentTotal", "projection"],
};

function finiteMetric(values: Record<string, number>, key: string): boolean {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value);
}

/** Kickers that would plot on projection-versus-rank axes. */
export function eligibleKickersForRankAxes(entities: readonly WeeklyAxesEntity[]): WeeklyAxesEntity[] {
  return entities.filter((entity) => (
    entity.position === "K"
    && finiteMetric(entity.values, "league")
    && finiteMetric(entity.values, "leaguePositionRank")
  ));
}

/** True only when every rank-eligible kicker also has a team implied total. */
export function kickersHaveCompleteTeamTotals(entities: readonly WeeklyAxesEntity[]): boolean {
  const eligible = eligibleKickersForRankAxes(entities);
  return eligible.length > 0 && eligible.every((entity) => finiteMetric(entity.values, "teamTotal"));
}

/**
 * Default axes for a position.
 * Kickers use Vegas team totals only when coverage is complete; partial coverage
 * keeps rank axes so kickers with projection/rank stay visible. The Vegas preset
 * remains available for manual selection.
 */
export function chartWeeklyAxes(
  position: WeeklyAxesPosition,
  entities: readonly WeeklyAxesEntity[] = [],
): [string, string] {
  if (position === "FLEX") return ["league", "fantasyCalcValue"];
  if (position === "K" && kickersHaveCompleteTeamTotals(entities)) return ["teamTotal", "league"];
  return defaultWeeklyAxes[position];
}

export function preferredWeeklyPreset(
  position: WeeklyAxesPosition,
  presets: readonly WeeklyAxesPreset[],
  entities: readonly WeeklyAxesEntity[],
): WeeklyAxesPreset | undefined {
  if (position === "K") {
    const [x, y] = chartWeeklyAxes(position, entities);
    return presets.find((preset) => preset.x === x && preset.y === y)
      ?? presets.find((preset) => preset.x === x)
      ?? presets[0];
  }
  return presets[0];
}
