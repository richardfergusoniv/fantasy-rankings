/**
 * Sleeper week numbers match the regular-season schedule only while
 * `season_type` is `regular`. Preseason week 1, the offseason, and playoff
 * week 1 are not regular-season week 1, so week-scoped locks, byes, and
 * projections must not be attached.
 *
 * Player news still refreshes injuries during the playoffs. This guard is
 * stricter because a playoff week number would point at the wrong regular-season slate.
 */
export function usesRegularSeasonWeek(seasonType: string): boolean {
  return seasonType === "regular";
}

/**
 * True when FantasyCalc redraft value-history capture should keep a dense
 * daily series. Sleeper `season_type` values `pre`, `regular`, and `post`
 * cover preseason through the Super Bowl (roughly early August through
 * mid-February). `off` is the NFL offseason, when redraft markets are mostly
 * static and unchanged player rows can be skipped.
 */
export function isNflValueHistoryInSeason(seasonType: string): boolean {
  return seasonType === "pre" || seasonType === "regular" || seasonType === "post";
}
