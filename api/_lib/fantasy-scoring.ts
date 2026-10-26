/**
 * Pure fantasy scoring under Sleeper scoring settings. Kept free of
 * server-only imports so browser code (the Team Stats panel) can score
 * stat lines with the exact function the projections pipeline uses.
 */

export function settingValue(settings: Record<string, number> | undefined, key: string): number {
  const value = settings?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function scoreProjectedPlayerStats(
  position: string,
  stats: Record<string, number>,
  settings: Record<string, number> | undefined,
  opts?: { recFdProxy?: boolean },
): number {
  const directKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td",
  ];
  let total = directKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0);
  // Position reception bonuses: Sleeper can award extra points per
  // reception to one position group (bonus_rec_te / bonus_rec_rb /
  // bonus_rec_wr). All three count toward the league's official points,
  // so a from-stats rescoring must apply whichever the league sets.
  const recBonusKey = position === "TE"
    ? "bonus_rec_te"
    : position === "RB"
      ? "bonus_rec_rb"
      : position === "WR"
        ? "bonus_rec_wr"
        : null;
  if (recBonusKey) total += (stats.rec ?? 0) * settingValue(settings, recBonusKey);

  const bonuses: Array<[string, string, number]> = [
    ["bonus_pass_yd_300", "pass_yd", 300], ["bonus_pass_yd_400", "pass_yd", 400],
    ["bonus_pass_td_5", "pass_td", 5], ["bonus_pass_cmp_25", "pass_cmp", 25],
    ["bonus_rush_yd_100", "rush_yd", 100], ["bonus_rush_yd_200", "rush_yd", 200],
    ["bonus_rush_att_20", "rush_att", 20],
    ["bonus_rec_yd_100", "rec_yd", 100], ["bonus_rec_yd_200", "rec_yd", 200],
    ["bonus_rec_10", "rec", 10],
  ];
  for (const [settingKey, statKey, threshold] of bonuses) {
    if ((stats[statKey] ?? 0) >= threshold) total += settingValue(settings, settingKey);
  }

  if (opts?.recFdProxy) {
    // PPR proxy for point-per-first-down leagues (approved by Richard 2026-09-23):
    // prop markets don't price first downs, so each projected reception proxies
    // one receiving first down and earns rec_fd on top of rec. rush_fd stays
    // omitted: no rushing-attempts market exists. Only the Vegas weekly path
    // passes this flag — Sleeper projections and historical actuals carry real
    // first-down stats and must not double-count.
    const recFd = settingValue(settings, "rec_fd");
    if (recFd) total += (stats.rec ?? 0) * recFd;
  }

  if (position === "K") {
    const distanceKeys = ["fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p"];
    const missKeys = ["fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p"];
    const hasDistanceScoring = distanceKeys.some((key) => settingValue(settings, key) !== 0);
    const hasDistanceMissScoring = missKeys.some((key) => settingValue(settings, key) !== 0);
    total += hasDistanceScoring
      ? distanceKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgm ?? 0) * settingValue(settings, "fgm");
    total += hasDistanceMissScoring
      ? missKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgmiss ?? 0) * settingValue(settings, "fgmiss");
    total += (stats.fgm_50p ?? 0) * settingValue(settings, "fgm_50p");
    total += (stats.xpm ?? 0) * settingValue(settings, "xpm");
    total += (stats.xpmiss ?? 0) * settingValue(settings, "xpmiss");
    const estimatedMadeYards = (stats.fgm_0_19 ?? 0) * 19 + (stats.fgm_20_29 ?? 0) * 25 + (stats.fgm_30_39 ?? 0) * 35
      + (stats.fgm_40_49 ?? 0) * 45 + (stats.fgm_50_59 ?? 0) * 55 + (stats.fgm_60p ?? 0) * 62;
    total += estimatedMadeYards * settingValue(settings, "fgm_yds");
  }
  return Number(total.toFixed(2));
}
