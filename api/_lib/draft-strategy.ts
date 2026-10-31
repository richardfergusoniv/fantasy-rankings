/**
 * Draft strategies, for the Alt picks hindsight view: how the user's draft would have gone had they
 * stuck to their own approach and taken the best realistic player each time, and how the best of the
 * common approaches (Zero RB, Hero RB, Robust RB) would have gone.
 *
 * A strategy is a rule about when running backs are taken, from the usual definitions:
 *   Zero RB   - no running back in the first four rounds.
 *   Hero RB   - one running back in the first two rounds, none in rounds three and four.
 *   Robust RB - running backs early: two in the first three rounds.
 *   Balanced  - anything else; the fallback label for a draft that fits none of them.
 *
 * Each pick is replayed on today's values using the league's own draft order for realism: the choices
 * at a pick are the player actually taken plus whoever other teams took in the next round of picks.
 * Positions the roster is already set at (counting the user's later actual picks) are not suggested
 * again, so a quarterback taken later rules out recommending another one.
 */
import type { GradedPick, ValueBoard } from "./draft-grade.js";

export type Strategy = "zero-rb" | "hero-rb" | "robust-rb" | "balanced";

export const STRATEGY_LABELS: Record<Strategy, string> = {
  "zero-rb": "Zero RB",
  "hero-rb": "Hero RB",
  "robust-rb": "Robust RB",
  balanced: "Balanced",
};

const ARCHETYPES: readonly Strategy[] = ["zero-rb", "hero-rb", "robust-rb"];
const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

/** A robust drafter takes the running back unless a player at another position is worth this much more. */
const ROBUST_TOLERANCE = 0.85;

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

const FLEX_ELIGIBLE: Record<string, readonly string[]> = {
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
const FLEX_ORDER = ["REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"];

/** Total value of the best starting lineup the players can fill, most restrictive slots first. */
export function lineupValue(players: ReadonlyArray<{ position: string; value: number }>, slots: readonly string[]): number {
  const pool = [...players].sort((a, b) => b.value - a.value);
  const taken = new Set<number>();
  let total = 0;
  const fill = (eligible: readonly string[]) => {
    const index = pool.findIndex((player, i) => !taken.has(i) && eligible.includes(player.position));
    if (index < 0) return;
    taken.add(index);
    total += pool[index]!.value;
  };
  for (const slot of slots) if (["QB", "RB", "WR", "TE"].includes(slot)) fill([slot]);
  for (const flex of FLEX_ORDER) for (const slot of slots) if (slot === flex) fill(FLEX_ELIGIBLE[flex]!);
  return total;
}

/** How many players of a position the lineup can use before more would only sit on the bench. */
function positionCap(position: string, slots: readonly string[]): number {
  const count = (slot: string) => slots.filter((value) => value === slot).length;
  const flexUsers = (position: string) => slots.filter((slot) => FLEX_ELIGIBLE[slot]?.includes(position)).length;
  if (position === "QB") return Math.max(count("QB") + count("SUPER_FLEX"), 1);
  if (position === "TE") return Math.max(count("TE"), 1) + Math.min(flexUsers("TE"), 1);
  return Number.POSITIVE_INFINITY;
}

export type SimulatedPick = { actual: GradedPick; chosen: GradedPick };

/** Whether a strategy allows a running back at this pick, given the running backs it has already taken. */
function rbRule(strategy: Strategy, round: number, rbs: readonly number[]): "ban" | "prefer" | "free" {
  const through = (limit: number) => rbs.filter((value) => value <= limit).length;
  switch (strategy) {
    case "zero-rb": return round <= 4 ? "ban" : "free";
    case "hero-rb":
      if (round <= 2) return through(2) >= 1 ? "ban" : "free";
      return round <= 4 ? "ban" : "free";
    case "robust-rb": return round <= 3 && through(3) < 2 ? "prefer" : "free";
    default: return "free";
  }
}

/** Replays the user's own picks under a strategy on `values`, using the league's draft order for the choices. */
export function simulateStrategy(args: {
  strategy: Strategy;
  picks: readonly GradedPick[];
  rosterId: number;
  values: ValueBoard;
  teams: number;
  slots: readonly string[];
}): SimulatedPick[] {
  const ordered = [...args.picks].sort((a, b) => a.pickNo - b.pickNo);
  const own = ordered.filter((pick) => pick.rosterId === args.rosterId);
  const used = new Set<string>();
  const chosen: GradedPick[] = [];
  const rbRounds: number[] = [];
  const out: SimulatedPick[] = [];
  const isSkill = (position: string) => ["QB", "RB", "WR", "TE"].includes(position);
  own.forEach((pick, index) => {
    // Kickers, defenses and anything unpriced stay as drafted.
    if (!isSkill(pick.position) || !args.values.has(pick.playerId)) {
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
    const usable = pool.filter((player) => {
      if (player === pick) return true;
      if (player.position === "RB" && rbRule(args.strategy, round, rbRounds) === "ban") return false;
      return heldAt(player.position) < positionCap(player.position, args.slots);
    });
    const valueOf = (player: GradedPick) => args.values.get(player.playerId) ?? 0;
    // The actual pick breaks a tie, so the view only differs where a real alternative is worth more.
    let best = usable.sort((a, b) => valueOf(b) - valueOf(a) || (b === pick ? 1 : 0) - (a === pick ? 1 : 0))[0] ?? pick;
    if (rbRule(args.strategy, round, rbRounds) === "prefer") {
      const backs = usable.filter((player) => player.position === "RB").sort((a, b) => valueOf(b) - valueOf(a));
      if (backs[0] && valueOf(backs[0]) >= valueOf(best) * ROBUST_TOLERANCE) best = backs[0];
    }
    // A strategy that bans running backs must not keep the actual back as its pick either.
    if (best.position === "RB" && rbRule(args.strategy, round, rbRounds) === "ban") {
      best = usable.find((player) => player.position !== "RB") ?? best;
    }
    used.add(best.playerId);
    chosen.push(best);
    if (best.position === "RB") rbRounds.push(round);
    out.push({ actual: pick, chosen: best });
  });
  return out;
}

export type StrategyView = {
  yours: Strategy;
  best: Strategy;
  /** Per own pick (by the actual player's id): the player the strategy would have taken; null when it is the same player. */
  yoursPicks: Map<string, GradedPick | null>;
  bestPicks: Map<string, GradedPick | null>;
};

/** Value of the lineup a set of picks builds on `values`. */
function rosterValue(picks: readonly GradedPick[], values: ValueBoard, slots: readonly string[], floor: number): number {
  return lineupValue(picks.map((pick) => ({ position: pick.position, value: values.get(pick.playerId) ?? floor })), slots);
}

/** The user's strategy done best and the best of the common strategies, replayed on today's values. */
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
  const yours = detectStrategy(own, args.teams);

  const run = (strategy: Strategy) => {
    const simulated = simulateStrategy({ strategy, picks: args.picks, rosterId: args.rosterId, values: args.values, teams: args.teams, slots });
    const value = rosterValue(simulated.map((item) => item.chosen), args.values, slots, floor);
    // A strategy that would not have beaten the roster the user has leaves every pick alone.
    const better = value > actualValue;
    const picks = new Map(simulated.map((item) => [item.actual.playerId, better && item.chosen.playerId !== item.actual.playerId ? item.chosen : null] as const));
    return { strategy, value, picks };
  };

  const mine = run(yours);
  const candidates = ARCHETYPES.map(run).sort((a, b) => b.value - a.value);
  const top = candidates[0]!;
  // The user's own approach wins ties, so a draft that was already the best way to go says so.
  const best = ARCHETYPES.includes(yours) && mine.value >= top.value ? mine : top;
  return { yours, best: best.strategy, yoursPicks: mine.picks, bestPicks: best.picks };
}
