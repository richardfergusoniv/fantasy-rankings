/**
 * Defense/special-teams scoring from projected or actual team stats under a
 * league's scoring settings. Pure; shared by the dashboard build and the
 * projected standings.
 */
import { settingValue } from "./fantasy-scoring.js";

function tierScore(value: number, settings: Record<string, number> | undefined, tiers: Array<[number, string]>): number {
  const tier = tiers.find(([upperBound]) => value <= upperBound) ?? tiers[tiers.length - 1];
  return tier ? settingValue(settings, tier[1]) : 0;
}

export function scoreProjectedDefenseStats(stats: Record<string, number>, settings: Record<string, number> | undefined): number | null {
  const directKeys = ["sack", "int", "fum_rec", "def_td", "safe", "blk_kick", "def_2pt", "st_td", "st_fum_rec", "pr_yd", "kr_yd", "pr_td", "kr_td"];
  let matched = false;
  let total = 0;
  for (const key of directKeys) {
    if (typeof stats[key] !== "number") continue;
    matched = true;
    total += (stats[key] ?? 0) * settingValue(settings, key);
  }
  const pointsAllowed = stats.pts_allow;
  if (typeof pointsAllowed === "number") {
    matched = true;
    total += tierScore(pointsAllowed, settings, [
      [0, "pts_allow_0"], [6, "pts_allow_1_6"], [13, "pts_allow_7_13"], [20, "pts_allow_14_20"],
      [27, "pts_allow_21_27"], [34, "pts_allow_28_34"], [Infinity, "pts_allow_35p"],
    ]) + pointsAllowed * settingValue(settings, "pts_allow");
  }
  const yardsAllowed = stats.yds_allow;
  if (typeof yardsAllowed === "number") {
    matched = true;
    total += tierScore(yardsAllowed, settings, [
      [100, "yds_allow_0_100"], [199, "yds_allow_100_199"], [299, "yds_allow_200_299"], [349, "yds_allow_300_349"],
      [399, "yds_allow_350_399"], [449, "yds_allow_400_449"], [499, "yds_allow_450_499"], [Infinity, "yds_allow_500p"],
    ]) + yardsAllowed * settingValue(settings, "yds_allow");
  }
  return matched ? Number(total.toFixed(2)) : null;
}
