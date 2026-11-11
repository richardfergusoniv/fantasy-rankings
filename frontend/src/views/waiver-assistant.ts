import { faabBidLabel } from "../lib/format-number";
import type { League } from "../dashboard-types";

type Grade = NonNullable<League["waiverGrades"]>[number];

export type WaiverAssistantAnswer = {
  add: { playerId: string; name: string; position: string; team: string | null };
  drop: { playerId: string; name: string } | null;
  /** FAAB range ("$5–13"), "Priority", or null when there's no bid to show. */
  bid: string | null;
  label: Grade["label"];
  /** Add and drop side by side. */
  compare: Array<{ label: string; values: [string, string] }>;
  /** Facts about the add alone. */
  facts: Array<{ label: string; value: string }>;
};

const LABEL_ORDER: Record<Grade["label"], number> = { "Must add": 0, Add: 1, Watch: 2 };

/** The graded add to feature: best label, then highest score. Watch-only lists have no answer. */
export function bestWaiverGrade(grades: readonly Grade[] | undefined): Grade | null {
  const ranked = [...(grades ?? [])]
    .filter((grade) => grade.label !== "Watch")
    .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label] || b.score - a.score);
  return ranked[0] ?? null;
}

const points = (value: number | null | undefined) => (typeof value === "number" ? value.toFixed(1) : "—");
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
const weeksPhrase = (weeks: readonly number[]) => (weeks.length === 0 ? "none" : weeks.length === 1 ? `week ${weeks[0]}` : `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`);

/**
 * The Waivers Assistant's answer from the grades the refresh already saved on
 * the league (the same grading the chat uses), plus the details behind it.
 */
export function waiverAssistantAnswer(
  league: Pick<League, "waiverGrades" | "starters" | "bench">,
  trending: Record<string, { adds: number | null } | undefined> | undefined,
  /** Injury status by player id (null = healthy); a player missing from it has an unknown status. */
  injuryById?: ReadonlyMap<string, string | null>,
): WaiverAssistantAnswer | null {
  const grade = bestWaiverGrade(league.waiverGrades);
  if (!grade) return null;
  const roster = [...league.starters, ...league.bench];
  const dropRow = grade.dropCandidate ? roster.find((player) => player.playerId === grade.dropCandidate!.playerId) ?? null : null;
  const bid = grade.bid?.kind === "faab" && typeof grade.bid.low === "number" && typeof grade.bid.high === "number"
    ? faabBidLabel({ low: grade.bid.low, high: grade.bid.high })
    : grade.bid?.kind === "priority" ? "Priority" : null;

  const compare: WaiverAssistantAnswer["compare"] = [
    { label: "Position", values: [grade.position, dropRow?.position ?? "—"] },
    { label: "Team", values: [grade.team ?? "—", dropRow?.team ?? "—"] },
    { label: "Projection this week", values: [points(grade.projection), points(dropRow?.projection)] },
  ];
  const addInjury = injuryById?.has(grade.playerId) ? injuryById.get(grade.playerId) ?? "None" : "—";
  if (dropRow?.injuryStatus || (addInjury !== "None" && addInjury !== "—")) compare.push({ label: "Injury", values: [addInjury, dropRow?.injuryStatus ?? "None"] });
  if (grade.dropCandidate) compare.push({ label: "Season value", values: ["—", grade.dropCandidate.value.toLocaleString("en-US")] });

  const facts: WaiverAssistantAnswer["facts"] = [{ label: "Grade", value: `${grade.label} (${grade.score.toFixed(0)})` }];
  if (grade.ros) {
    facts.push({ label: "Rest-of-season gain", value: `${signed(grade.ros.pointsGained)} pts over ${weeksPhrase(grade.ros.coveredWeeks)}` });
    for (const start of grade.ros.startsInWeeks.slice(0, 4)) facts.push({ label: `Starts in week ${start.week}`, value: start.note });
    if (grade.ros.designatedPlayers.length > 0) facts.push({ label: "Designated to return", value: grade.ros.designatedPlayers.join(", ") });
    if (grade.ros.absentPlayers.length > 0) facts.push({ label: "Out in those weeks", value: grade.ros.absentPlayers.join(", ") });
    if (grade.ros.partial) facts.push({ label: "Note", value: `Some weeks weren't projected yet (${weeksPhrase(grade.ros.missingWeeks)}).` });
  }
  const adds = trending?.[grade.playerId]?.adds;
  if (typeof adds === "number" && adds > 0) facts.push({ label: "Sleeper adds, 24 hours", value: adds.toLocaleString("en-US") });
  if (grade.bid) facts.push({ label: grade.bid.kind === "faab" ? "Suggested bid" : "Waiver priority", value: bid && grade.bid.kind === "faab" ? `${bid}. ${grade.bid.note}` : grade.bid.note });

  return {
    add: { playerId: grade.playerId, name: grade.name, position: grade.position, team: grade.team },
    drop: grade.dropCandidate ? { playerId: grade.dropCandidate.playerId, name: grade.dropCandidate.name } : null,
    bid,
    label: grade.label,
    compare,
    facts,
  };
}
