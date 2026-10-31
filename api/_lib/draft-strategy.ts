/**
 * Draft strategies, for the Hindsight tab: how the user's draft would have gone had they
 * stuck to their own approach and taken the best realistic player each time, and how the best of the
 * common approaches (Zero RB, Hero RB, Robust RB, each with early or late QB and TE) would have gone.
 *
 * A strategy is a rule about when running backs are taken, from the usual definitions:
 *   Zero RB   - no running back in the first four rounds.
 *   Hero RB   - one running back in the first two rounds, none in rounds three and four.
 *   Robust RB - running backs early: two in the first three rounds.
 *   Balanced  - anything else; the fallback label for a draft that fits none of them.
 * Quarterbacks and tight ends are early when one is taken in the first four rounds, otherwise late.
 *
 * Each pick is replayed on today's values using the league's own draft order for realism: the choices
 * at a pick are the player actually taken plus whoever other teams took in the next round of picks.
 * Positions the roster is already set at (counting the user's later actual picks) are not suggested
 * again, so a quarterback taken later rules out recommending another one.
 */
import type { GradedPick, ValueBoard } from "./draft-grade.js";

export type Strategy = "zero-rb" | "hero-rb" | "robust-rb" | "balanced";

export type Timing = "early" | "late";

/** A full approach: how running backs went, and when a quarterback and a tight end were taken. */
export type Plan = { rb: Strategy; qb: Timing; te: Timing };

export const STRATEGY_LABELS: Record<Strategy, string> = {
  "zero-rb": "Zero RB",
  "hero-rb": "Hero RB",
  "robust-rb": "Robust RB",
  balanced: "Balanced",
};

const ARCHETYPES: readonly Strategy[] = ["zero-rb", "hero-rb", "robust-rb"];
const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

/** A plan that favors a position takes him unless a player at another position is worth this much more. */
const PREFER_TOLERANCE = 0.85;

const TIMING_ROUNDS = 4;

const roundOf = (pickNo: number, teams: number) => Math.floor((pickNo - 1) / Math.max(teams, 1)) + 1;

/** The strategy a team's skill picks followed, by when its running backs were taken. */
export function detectStrategy(picks: readonly GradedPick[], teams: number): Strategy {
  const rounds = picks.filter((pick) => pick.position === "RB").map((pick) => roundOf(pick.pickNo, teams));
  const through = (round: number) => rounds.filter((value) => value <= round).length;
  if (through(4) === 0) return "zero-rb";
  if (through(3) >= 2) return "robust-rb";
  if (through(2) === 1 && through(4) === 1) return "hero-rb";
  return "balanced";
}

function detectTiming(picks: readonly GradedPick[], teams: number, position: string): Timing {
  return picks.some((pick) => pick.position === position && roundOf(pick.pickNo, teams) <= TIMING_ROUNDS) ? "early" : "late";
}

/** The plan a team's picks followed. */
export function detectPlan(picks: readonly GradedPick[], teams: number): Plan {
  return { rb: detectStrategy(picks, teams), qb: detectTiming(picks, teams, "QB"), te: detectTiming(picks, teams, "TE") };
}

/** "Late QB · Late TE", for under the strategy name. */
export function timingLabel(plan: Plan): string {
  const word = (timing: Timing) => (timing === "early" ? "Early" : "Late");
  return `${word(plan.qb)} QB · ${word(plan.te)} TE`;
}

const FLEX_ELIGIBLE: Record<string, readonly string[]> = {
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** Total value of the best starting lineup the players can fill, trying every way to assign them to slots. */
export function lineupValue(players: ReadonlyArray<{ position: string; value: number }>, slots: readonly string[]): number {
  const lineupSlots = slots.filter((slot) => slot in FLEX_ELIGIBLE || (POSITIONS as readonly string[]).includes(slot));
  const byPosition = POSITIONS.map((position) => players.filter((player) => player.position === position).map((player) => player.value).sort((a, b) => b - a));
  const memo = new Map<string, number>();
  // Within a position the best players fill slots first, so a slot only chooses which position to take next.
  const best = (index: number, used: readonly number[]): number => {
    if (index >= lineupSlots.length) return 0;
    const key = `${index}:${used.join(",")}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let top = best(index + 1, used);
    for (const position of FLEX_ELIGIBLE[lineupSlots[index]!] ?? [lineupSlots[index]!]) {
      const at = POSITIONS.indexOf(position as (typeof POSITIONS)[number]);
      const value = byPosition[at]?.[used[at] ?? 0];
      if (value === undefined) continue;
      top = Math.max(top, value + best(index + 1, used.map((count, i) => (i === at ? count + 1 : count))));
    }
    memo.set(key, top);
    return top;
  };
  return best(0, [0, 0, 0, 0]);
}

/** How many players of a position the lineup can use before more would only sit on the bench. */
function positionCap(position: string, slots: readonly string[]): number {
  const count = (slot: string) => slots.filter((value) => value === slot).length;
  const flexUsers = (position: string) => slots.filter((slot) => FLEX_ELIGIBLE[slot]?.includes(position)).length;
  if (position === "QB") return Math.max(count("QB") + count("SUPER_FLEX"), 1);
  if (position === "TE") return Math.max(count("TE"), 1) + flexUsers("TE");
  return Number.POSITIVE_INFINITY;
}

export type SimulatedPick = { actual: GradedPick; chosen: GradedPick };

type Rule = "ban" | "prefer" | "free";

/** What a plan says about taking `position` in `round`, given the rounds it has already taken one. */
function ruleFor(plan: Plan, position: string, round: number, taken: readonly number[]): Rule {
  const through = (limit: number) => taken.filter((value) => value <= limit).length;
  if (position === "QB" || position === "TE") {
    const timing = position === "QB" ? plan.qb : plan.te;
    if (round > TIMING_ROUNDS) return "free";
    if (timing === "late") return "ban";
    return taken.length === 0 ? "prefer" : "free";
  }
  if (position !== "RB") return "free";
  switch (plan.rb) {
    case "zero-rb": return round <= 4 ? "ban" : "free";
    case "hero-rb":
      if (round <= 2) return through(2) >= 1 ? "ban" : "prefer";
      return round <= 4 ? "ban" : "free";
    case "robust-rb": return round <= 3 && through(3) < 2 ? "prefer" : "free";
    default: return "free";
  }
}

/**
 * Replays the user's own picks under a strategy on `values`, using the league's draft order for the choices.
 * Null when the plan leaves a pick with nobody it allows, so the replay cannot follow it.
 */
export function simulateStrategy(args: {
  plan: Plan;
  picks: readonly GradedPick[];
  rosterId: number;
  values: ValueBoard;
  teams: number;
  slots: readonly string[];
}): SimulatedPick[] | null {
  const ordered = [...args.picks].sort((a, b) => a.pickNo - b.pickNo);
  const own = ordered.filter((pick) => pick.rosterId === args.rosterId);
  const floor = args.values.size === 0 ? 0 : Math.min(...args.values.values());
  const used = new Set<string>();
  const chosen: GradedPick[] = [];
  const takenRounds: Record<string, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const out: SimulatedPick[] = [];
  let feasible = true;
  const isSkill = (position: string) => ["QB", "RB", "WR", "TE"].includes(position);
  own.forEach((pick, index) => {
    // Kickers and defenses stay as drafted. A skill player off today's board is valued at its floor, as in the grades.
    if (!isSkill(pick.position)) {
      out.push({ actual: pick, chosen: pick });
      used.add(pick.playerId);
      return;
    }
    const round = roundOf(pick.pickNo, args.teams);
    const later = own.slice(index + 1);
    const heldAt = (position: string) => (
      chosen.filter((player) => player.position === position).length + later.filter((player) => player.position === position).length
    );
    const pool = [pick, ...ordered.filter((other) => (
      other.pickNo > pick.pickNo && other.pickNo <= pick.pickNo + args.teams
      && other.rosterId !== args.rosterId && isSkill(other.position) && !!other.name && args.values.has(other.playerId)
    ))].filter((player) => !used.has(player.playerId));
    const ruleOf = (player: GradedPick) => ruleFor(args.plan, player.position, round, takenRounds[player.position] ?? []);
    const usable = pool.filter((player) => {
      if (player === pick) return true;
      if (ruleOf(player) === "ban") return false;
      // Upgrading the player taken at the same position is never a duplicate, even with a backup drafted later.
      if (player.position === pick.position) return true;
      return heldAt(player.position) < positionCap(player.position, args.slots);
    });
    const valueOf = (player: GradedPick) => args.values.get(player.playerId) ?? floor;
    const asValue = (player: GradedPick) => ({ position: player.position, value: valueOf(player) });
    // A pick is worth what it adds to the starting lineup alongside the players already chosen and the later actual picks,
    // so a replacement is not taken at the cost of a starter the roster still needs.
    const rest = later.filter((player) => isSkill(player.position));
    const lineupWith = (player: GradedPick) => lineupValue([...chosen, player, ...rest].map(asValue), args.slots);
    const gain = new Map(usable.map((player) => [player, lineupWith(player)] as const));
    // The actual pick breaks a tie, so the view only differs where a real alternative is worth more.
    const byGain = (a: GradedPick, b: GradedPick) => (
      gain.get(b)! - gain.get(a)! || valueOf(b) - valueOf(a) || (b === pick ? 1 : 0) - (a === pick ? 1 : 0)
    );
    const allowed = usable.filter((player) => ruleOf(player) !== "ban").sort(byGain);
    // A plan that bans a position cannot keep the actual player there either.
    if (allowed.length === 0) { feasible = false; out.push({ actual: pick, chosen: pick }); return; }
    let best = allowed[0]!;
    const preferred = allowed.find((player) => ruleOf(player) === "prefer");
    // The tolerance applies to what each adds, so starters already on the roster do not swamp the comparison.
    const base = lineupValue([...chosen, ...rest].map(asValue), args.slots);
    if (preferred && gain.get(preferred)! - base >= (gain.get(best)! - base) * PREFER_TOLERANCE) best = preferred;
    used.add(best.playerId);
    chosen.push(best);
    takenRounds[best.position]?.push(round);
    out.push({ actual: pick, chosen: best });
  });
  return feasible ? out : null;
}

export type StrategyView = {
  yours: Plan;
  best: Plan;
  /** Per own pick (by the actual player's id): the player the plan would have taken; null when it is the same player. */
  yoursPicks: Map<string, GradedPick | null>;
  bestPicks: Map<string, GradedPick | null>;
};

/** Value of the lineup a set of picks builds on `values`. */
function rosterValue(picks: readonly GradedPick[], values: ValueBoard, slots: readonly string[], floor: number): number {
  return lineupValue(picks.map((pick) => ({ position: pick.position, value: values.get(pick.playerId) ?? floor })), slots);
}

const TIMINGS: readonly Timing[] = ["early", "late"];
const ALL_PLANS: readonly Plan[] = ARCHETYPES.flatMap((rb) => TIMINGS.flatMap((qb) => TIMINGS.map((te) => ({ rb, qb, te }))));

/** The user's plan done best and the best of the common plans, replayed on today's values. */
export function strategyView(args: {
  picks: readonly GradedPick[];
  rosterId: number;
  values: ValueBoard;
  teams: number;
  slots?: readonly string[];
}): StrategyView | null {
  const slots = args.slots && args.slots.length > 0 ? args.slots : DEFAULT_SLOTS;
  const own = args.picks.filter((pick) => pick.rosterId === args.rosterId);
  if (own.length === 0 || args.values.size === 0) return null;
  const floor = Math.min(...args.values.values());
  const actualValue = rosterValue(own, args.values, slots, floor);
  const yours = detectPlan(own, args.teams);

  const run = (plan: Plan) => {
    const simulated = simulateStrategy({ plan, picks: args.picks, rosterId: args.rosterId, values: args.values, teams: args.teams, slots });
    if (!simulated) return null;
    const value = rosterValue(simulated.map((item) => item.chosen), args.values, slots, floor);
    // A plan that would not have beaten the roster the user has leaves every pick alone.
    const better = value > actualValue;
    const picks = new Map(simulated.map((item) => [item.actual.playerId, better && item.chosen.playerId !== item.actual.playerId ? item.chosen : null] as const));
    return { plan, value, picks };
  };

  const none = new Map<string, GradedPick | null>(own.map((pick) => [pick.playerId, null]));
  const mine = run(yours) ?? { plan: yours, value: actualValue, picks: none };
  // Plans the draft could not follow are left out of the ranking.
  const top = ALL_PLANS.flatMap((plan) => run(plan) ?? []).sort((a, b) => b.value - a.value)[0];
  // The user's own approach wins ties, so a draft that was already the best way to go says so.
  const best = !top || (ARCHETYPES.includes(yours.rb) && mine.value >= top.value) ? mine : top;
  return { yours, best: best.plan, yoursPicks: mine.picks, bestPicks: best.picks };
}
