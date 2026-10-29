/**
 * FAAB bid guidance for a waiver suggestion. A heuristic layered on the
 * move-scoring label, not an app score: the label sets the share of the
 * remaining budget, then season timing and add-trend nudge it.
 */
import type { WaiverLabel } from "./scoring/labels.js";
import type { Dashboard } from "./dashboard-schemas.js";

type WaiverStatus = NonNullable<Dashboard["leagues"][number]["waivers"]>;

/** Share of the remaining budget a typical bid takes, by label. */
const LABEL_SHARE: Record<WaiverLabel, number> = {
  "Must add": 0.3,
  Add: 0.1,
  Watch: 0.03,
  Pass: 0,
};

/** Daily adds across Sleeper at which other managers are likely to bid up. */
const CONTESTED_ADDS = 10_000;

export type FaabBid =
  | { kind: "faab"; low: number; high: number; remaining: number; note: string }
  | { kind: "priority"; note: string }
  | null;

export function suggestFaabBid(args: {
  label: WaiverLabel;
  waivers: WaiverStatus | null;
  weeksLeft: number | null;
  trendingAdds: number | null;
}): FaabBid {
  const { waivers } = args;
  if (!waivers?.type) return null;

  if (waivers.type !== "faab") {
    if (args.label === "Pass") return null;
    const position = waivers.position != null ? `waiver priority ${waivers.position} of ${waivers.teams}` : "waiver priority";
    return {
      kind: "priority",
      note: waivers.type === "rolling"
        ? `No bid. You have ${position}; a successful claim sends you to the back of the line, so spend it only on ${args.label === "Must add" ? "this kind of player" : "a clear upgrade"}.`
        : `No bid. Claims run in reverse standings order and you have ${position}.`,
    };
  }

  const remaining = waivers.remaining ?? waivers.budget;
  if (remaining == null || remaining <= 0 || args.label === "Pass") return null;

  let share = LABEL_SHARE[args.label];
  const reasons: string[] = [`${args.label} usually costs about ${Math.round(share * 100)}% of the remaining budget`];
  if (args.weeksLeft != null) {
    if (args.weeksLeft <= 2) {
      share *= 1.5;
      reasons.push("few regular-season weeks left, so unused budget is wasted");
    } else if (args.weeksLeft >= 10) {
      share *= 0.8;
      reasons.push("plenty of season left, so keep some budget back");
    }
  }
  if ((args.trendingAdds ?? 0) >= CONTESTED_ADDS) {
    share *= 1.2;
    reasons.push("heavily added across Sleeper, so expect competing bids");
  }

  const clamp = (value: number) => Math.min(remaining, Math.max(1, Math.round(value)));
  const low = clamp(remaining * share * 0.6);
  const high = Math.max(low, clamp(remaining * share * 1.4));
  return { kind: "faab", low, high, remaining, note: `${reasons.join("; ")}.` };
}
