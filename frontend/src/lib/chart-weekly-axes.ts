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

export function weeklyPositionHasMetric(
  entities: readonly WeeklyAxesEntity[],
  position: Exclude<WeeklyAxesPosition, "FLEX">,
  key: string,
): boolean {
  return entities.some((entity) => (
    entity.position === position
    && typeof entity.values[key] === "number"
    && Number.isFinite(entity.values[key])
  ));
}

/** Default axes for a position; kickers use Vegas totals when present, else projection vs rank. */
export function chartWeeklyAxes(
  position: WeeklyAxesPosition,
  entities: readonly WeeklyAxesEntity[] = [],
): [string, string] {
  if (position === "FLEX") return ["league", "fantasyCalcValue"];
  if (position === "K" && weeklyPositionHasMetric(entities, "K", "teamTotal")) return ["teamTotal", "league"];
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
