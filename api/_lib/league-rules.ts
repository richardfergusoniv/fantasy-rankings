/**
 * Plain-language summary of one league's rules (scoring, lineup slots,
 * playoffs, waivers), built from the dashboard league. Shared by the
 * `get_league_rules` chat tool and the chat system prompt so the model sees
 * the same facts in both places.
 */
import type { Dashboard } from "./dashboard-schemas.js";

type League = Dashboard["leagues"][number];

export type LeagueRulesSummary = {
  scoringLabel: string;
  isDynasty: boolean;
  numTeams: number;
  numQbs: number;
  pointsPerReception: number;
  /** Sleeper scoring keys with a non-zero value, e.g. { rec: 1, pass_td: 4 }. */
  scoringSettings: Record<string, number>;
  /** The scoring rules that most change player value, in words. */
  scoringHighlights: string[];
  starterSlots: Record<string, number>;
  hasFlex: boolean;
  hasSuperflex: boolean;
  positionsRanked: string[];
  playoffs: { teams: number | null; weekStart: number | null; regularSeasonEndsWeek: number | null };
  waivers: League["waivers"];
  unsupportedSettings: string[];
};

const FLEX_SLOTS = new Set(["FLEX", "WRRBTE", "REC_FLEX", "W/R/T", "WR/RB/TE"]);
const SUPERFLEX_SLOTS = new Set(["SUPER_FLEX", "SUPERFLEX", "QB/WR/RB/TE"]);

function countSlots(slots: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) counts[slot] = (counts[slot] ?? 0) + 1;
  return counts;
}

function nonZero(settings: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, value]) => Number.isFinite(value) && value !== 0),
  );
}

function highlights(settings: Record<string, number>, numQbs: number): string[] {
  const out: string[] = [];
  const get = (key: string) => settings[key] ?? 0;
  out.push(`${get("rec")} point(s) per reception`);
  if (get("bonus_rec_te")) out.push(`TE premium: +${get("bonus_rec_te")} per TE reception`);
  if (get("bonus_rec_rb")) out.push(`RB reception bonus: +${get("bonus_rec_rb")}`);
  if (get("bonus_rec_wr")) out.push(`WR reception bonus: +${get("bonus_rec_wr")}`);
  if (get("pass_td")) out.push(`${get("pass_td")} points per passing TD`);
  if (get("pass_yd")) out.push(`${get("pass_yd")} points per passing yard`);
  if (get("pass_int")) out.push(`${get("pass_int")} points per interception`);
  if (get("rush_yd") && get("rush_yd") !== 0.1) out.push(`${get("rush_yd")} points per rushing yard`);
  if (get("rec_yd") && get("rec_yd") !== 0.1) out.push(`${get("rec_yd")} points per receiving yard`);
  if (get("rush_fd") || get("rec_fd")) out.push("first-down bonuses are scored");
  const yardBonuses = Object.keys(settings).filter((key) => key.startsWith("bonus_") && key.includes("_yd"));
  if (yardBonuses.length > 0) out.push("yardage milestone bonuses are scored");
  if (numQbs >= 2) out.push("Superflex/2QB: QBs carry extra value");
  return out;
}

export function summarizeLeagueRules(league: League): LeagueRulesSummary {
  const scoringSettings = nonZero(league.scoringSettings);
  const slots = league.tradeStarterSlots.length > 0
    ? league.tradeStarterSlots
    : league.starters.map((player) => player.lineupSlot ?? player.position);
  const starterSlots = countSlots(slots);
  const weekStart = league.playoffs?.weekStart ?? null;
  return {
    scoringLabel: league.scoringLabel,
    isDynasty: league.seasonLongFormat.isDynasty,
    numTeams: league.seasonLongFormat.numTeams,
    numQbs: league.seasonLongFormat.numQbs,
    pointsPerReception: scoringSettings.rec ?? 0,
    scoringSettings,
    scoringHighlights: highlights(scoringSettings, league.seasonLongFormat.numQbs),
    starterSlots,
    hasFlex: Object.keys(starterSlots).some((slot) => FLEX_SLOTS.has(slot)),
    hasSuperflex: Object.keys(starterSlots).some((slot) => SUPERFLEX_SLOTS.has(slot)),
    positionsRanked: league.rankingPositions,
    playoffs: {
      teams: league.playoffs?.teams ?? null,
      weekStart,
      regularSeasonEndsWeek: weekStart ? weekStart - 1 : null,
    },
    waivers: league.waivers ?? null,
    unsupportedSettings: league.tradeValuation.unsupportedSettings,
  };
}

function slotText(slots: Record<string, number>): string {
  return Object.entries(slots).map(([slot, count]) => (count > 1 ? `${count}x${slot}` : slot)).join(", ");
}

/** One bounded line for the system prompt. */
export function leagueRulesPromptLine(rules: LeagueRulesSummary): string {
  const parts = [
    `Rules: ${rules.numTeams} teams`,
    `starters ${slotText(rules.starterSlots) || "unknown"}`,
    rules.scoringHighlights.slice(0, 4).join("; "),
    rules.playoffs.teams
      ? `${rules.playoffs.teams} playoff teams${rules.playoffs.weekStart ? ` starting week ${rules.playoffs.weekStart}` : ""}`
      : "",
    rules.waivers?.type ? `waivers: ${rules.waivers.type === "faab" ? "FAAB" : rules.waivers.type.replace("_", " ")}` : "",
  ].filter(Boolean);
  return `${parts.join(" · ")}.`.slice(0, 600);
}
