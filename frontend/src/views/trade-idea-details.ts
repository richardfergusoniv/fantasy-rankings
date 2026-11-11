import type { TradeIdea } from "../../../api/_lib/trade-ideas";
import type { FactorEdge } from "./start-sit-verdict";

const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
const whole = (value: number) => Math.round(value).toLocaleString("en-US");
const names = (assets: ReadonlyArray<{ name: string }>) => assets.map((asset) => asset.name).join(", ");

export type TradeIdeaDetails = {
  /** You give / You get, side by side. */
  compare: Array<{ label: string; values: [string, string]; edge?: FactorEdge }>;
  /** What the trade does to your team. */
  yours: Array<{ label: string; value: string }>;
  /** What it does to theirs. */
  theirs: Array<{ label: string; value: string }>;
};

/** Everything behind one trade idea, formatted for the sheet. */
export function tradeIdeaDetails(idea: TradeIdea): TradeIdeaDetails {
  const compare: TradeIdeaDetails["compare"] = [
    { label: "Players", values: [names(idea.give), names(idea.get)] },
    { label: "Positions", values: [idea.give.map((a) => a.position).join(", "), idea.get.map((a) => a.position).join(", ")] },
    { label: "Market value", values: [whole(idea.giveTotal), whole(idea.getTotal)], edge: idea.getTotal === idea.giveTotal ? null : idea.getTotal > idea.giveTotal ? 1 : 0 },
  ];
  const yours: TradeIdeaDetails["yours"] = [
    { label: "Verdict", value: `${idea.verdict} (${idea.verdictScore.toFixed(0)})` },
    { label: "Lineup this week", value: `${idea.week.lineupBefore.toFixed(1)} → ${idea.week.lineupAfter.toFixed(1)} (${signed(idea.week.lineupAfter - idea.week.lineupBefore)})` },
    { label: "Starter value", value: `${whole(idea.seasonLong.starterValueBefore)} → ${whole(idea.seasonLong.starterValueAfter)}` },
    { label: "Power rank", value: `#${idea.seasonLong.powerRankBefore} → #${idea.seasonLong.powerRankAfter}` },
    { label: "Fills your weakest spot", value: idea.seasonLong.fillsHole ? "Yes" : "No" },
  ];
  if (idea.restOfSeason) {
    const weeks = idea.restOfSeason.coveredWeeks;
    yours.push({ label: "Rest-of-season points", value: `${signed(idea.restOfSeason.pointsDelta)}${weeks.length > 0 ? ` over weeks ${weeks[0]}–${weeks[weeks.length - 1]}` : ""}${idea.restOfSeason.partial ? " (some weeks missing)" : ""}` });
  }
  if (idea.injuryExposure && idea.injuryExposure.designatedPlayers.length > 0) yours.push({ label: "Injury designations", value: idea.injuryExposure.designatedPlayers.join(", ") });
  if (idea.injuryExposure && idea.injuryExposure.absentPlayers.length > 0) yours.push({ label: "Out in those weeks", value: idea.injuryExposure.absentPlayers.join(", ") });
  const theirs: TradeIdeaDetails["theirs"] = [{ label: "Lineup this week", value: signed(idea.partnerWeekDelta) }];
  if (idea.partnerRestOfSeason) theirs.push({ label: "Rest-of-season points", value: signed(idea.partnerRestOfSeason.pointsDelta) });
  return { compare, yours, theirs };
}
