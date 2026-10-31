/**
 * Draft strategies, for the Hindsight tab: how the user's draft would have gone had they
 * stuck to their own approach and made the best realistic picks, and how the best of the
 * common approaches (Zero RB, Hero RB, Robust RB, each with early or late QB and TE) would have gone.
 *
 * A strategy is a rule about when running backs are taken, from the usual definitions:
 *   Zero RB   - no running back in the first four rounds.
 *   Hero RB   - one running back in the first two rounds, none in rounds three and four.
 *   Robust RB - running backs early: two in the first three rounds.
 *   Balanced  - anything else; the fallback label for a draft that fits none of them.
 * Quarterbacks and tight ends are early when one is taken in the first four rounds, otherwise late.
 *
 * A plan's rules are hard. The replay finds the set of picks that follows them and builds the most
 * valuable starting lineup on today's values, trying every realistic combination (with branch and
 * bound), not choosing pick by pick. The choices at a pick are the player actually taken, whoever other
 * teams took in the next round of picks, and a player the user took at the pick just before when nobody
 * else picked in between. Positions the roster is already set at (counting the user's later actual picks)
 * are not suggested again, so a quarterback taken later rules out recommending another one. Among
 * combinations worth the same, the one that changes the fewest of the user's picks wins.
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

const TIMING_ROUNDS = 4;

/** Most search steps per pass and plan; past it the best combination found so far is used (about 0.4 s for a full draft). */
const NODE_BUDGET = 3000;

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

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const positionIndex = (position: string) => (POSITIONS as readonly string[]).indexOf(position);

const FLEX_ELIGIBLE: Record<string, readonly string[]> = {
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

/**
 * For each set of positions (as a bit mask), how many lineup slots accept one of them. A group of players
 * fits the lineup exactly when no set of positions has more players than slots that accept them.
 */
function slotCapacities(slots: readonly string[]): number[] {
  const accepts = slots.flatMap((slot) => {
    const eligible = FLEX_ELIGIBLE[slot] ?? ((POSITIONS as readonly string[]).includes(slot) ? [slot] : []);
    return eligible.length === 0 ? [] : [eligible.reduce((mask, position) => mask | (1 << positionIndex(position)), 0)];
  });
  return Array.from({ length: 16 }, (_, mask) => accepts.filter((accepted) => (accepted & mask) !== 0).length);
}

const capacityCache = new Map<string, number[]>();
function capacitiesFor(slots: readonly string[]): number[] {
  const key = slots.join(",");
  let capacities = capacityCache.get(key);
  if (!capacities) { capacities = slotCapacities(slots); capacityCache.set(key, capacities); }
  return capacities;
}

function fitsLineup(counts: readonly number[], capacities: readonly number[]): boolean {
  for (let mask = 1; mask < 16; mask += 1) {
    let used = 0;
    for (let at = 0; at < 4; at += 1) if (mask & (1 << at)) used += counts[at]!;
    if (used > capacities[mask]!) return false;
  }
  return true;
}

/**
 * Total value of the best starting lineup the players can fill. Lineups form a matroid, so taking the
 * most valuable players first and keeping each one that still fits gives the best total.
 */
export function lineupValue(players: ReadonlyArray<{ position: string; value: number }>, slots: readonly string[]): number {
  const capacities = capacitiesFor(slots);
  const counts = [0, 0, 0, 0];
  let total = 0;
  for (const player of [...players].sort((a, b) => b.value - a.value)) {
    const at = positionIndex(player.position);
    if (at < 0) continue;
    counts[at]! += 1;
    if (fitsLineup(counts, capacities)) total += player.value;
    else counts[at]! -= 1;
  }
  return total;
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

/** A plan needs at least `min` players at `position` taken in rounds up to `throughRound`. */
type Requirement = { position: string; throughRound: number; min: number };

function requirementsFor(plan: Plan): Requirement[] {
  const needs: Requirement[] = [];
  if (plan.rb === "hero-rb") needs.push({ position: "RB", throughRound: 2, min: 1 });
  if (plan.rb === "robust-rb") needs.push({ position: "RB", throughRound: 3, min: 2 });
  if (plan.qb === "early") needs.push({ position: "QB", throughRound: TIMING_ROUNDS, min: 1 });
  if (plan.te === "early") needs.push({ position: "TE", throughRound: TIMING_ROUNDS, min: 1 });
  return needs;
}

/** Whether a plan rules out `position` at a pick in `round`, given the rounds it already took one. */
function banned(plan: Plan, position: string, round: number, taken: readonly number[]): boolean {
  if (position === "QB") return plan.qb === "late" && round <= TIMING_ROUNDS;
  if (position === "TE") return plan.te === "late" && round <= TIMING_ROUNDS;
  if (position !== "RB") return false;
  if (plan.rb === "zero-rb") return round <= 4;
  if (plan.rb === "hero-rb") return round <= 2 ? taken.filter((value) => value <= 2).length >= 1 : round <= 4;
  return false;
}

/**
 * Replays the user's own picks under a plan on `values`: the combination of picks that follows the plan and
 * builds the most valuable lineup, using the league's draft order for the choices. Null when no combination
 * follows the plan.
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
  const isSkill = (position: string) => positionIndex(position) >= 0;
  const valueOf = (player: GradedPick) => args.values.get(player.playerId) ?? floor;
  const asValue = (player: GradedPick) => ({ position: player.position, value: valueOf(player) });
  const priced = (other: GradedPick) => isSkill(other.position) && !!other.name && args.values.has(other.playerId);

  // Kickers and defenses stay as drafted. A skill player off today's board is valued at its floor, as in the grades.
  const decisions = own.flatMap((pick, index) => (isSkill(pick.position) ? [index] : []));
  const rounds = own.map((pick) => roundOf(pick.pickNo, args.teams));
  const stillThere = (earlier: GradedPick, pick: GradedPick) => ordered.every((other) => (
    other.rosterId === args.rosterId || other.pickNo < earlier.pickNo || other.pickNo > pick.pickNo
  ));
  // The players that could realistically be taken at each of the user's skill picks.
  const pools = decisions.map((index) => {
    const pick = own[index]!;
    const nearby = ordered.filter((other) => (
      other.pickNo > pick.pickNo && other.pickNo <= pick.pickNo + args.teams && other.rosterId !== args.rosterId && priced(other)
    ));
    const earlierOwn = own.slice(0, index).filter((earlier) => priced(earlier) && stillThere(earlier, pick));
    return [pick, ...nearby, ...earlierOwn].sort((a, b) => valueOf(b) - valueOf(a) || (b === pick ? 1 : 0) - (a === pick ? 1 : 0));
  });

  const needs = requirementsFor(args.plan);
  // Best case for the slots after each decision, to cut off combinations that cannot beat the best found.
  const slotCount = decisions.length;
  const suffixTop = Array.from({ length: slotCount + 1 }, (_, from) => {
    const remaining = slotCount - from;
    const seen = new Set<string>();
    const byPosition: Array<Array<{ position: string; value: number }>> = POSITIONS.map(() => []);
    for (let at = from; at < slotCount; at += 1) {
      for (const player of pools[at]!) {
        if (seen.has(player.playerId)) continue;
        seen.add(player.playerId);
        byPosition[positionIndex(player.position)]!.push(asValue(player));
      }
    }
    // At most one player per remaining pick, and no more of a position than picks that could take one.
    const slotsFor = POSITIONS.map((position) => {
      let count = 0;
      for (let at = from; at < slotCount; at += 1) if (pools[at]!.some((player) => player.position === position)) count += 1;
      return Math.min(count, remaining);
    });
    return byPosition.flatMap((list, at) => list.sort((a, b) => b.value - a.value).slice(0, slotsFor[at]));
  });
  // For each requirement, how many of the decisions from each point on could still supply it.
  const supply = needs.map((need) => {
    const counts = Array.from({ length: slotCount + 1 }, () => 0);
    for (let at = slotCount - 1; at >= 0; at -= 1) {
      const can = rounds[decisions[at]!]! <= need.throughRound && pools[at]!.some((player) => player.position === need.position);
      counts[at] = counts[at + 1]! + (can ? 1 : 0);
    }
    return counts;
  });

  type Found = { value: number; changes: number; picks: GradedPick[] };
  // The picks that keep each actual player first, for the second pass that minimizes changes.
  const keepFirst = pools.map((pool, at) => {
    const pick = own[decisions[at]!]!;
    return [pick, ...pool.filter((player) => player !== pick)];
  });

  /**
   * One pass of the search. `value` mode finds the most valuable lineup the plan allows. `changes` mode, given that
   * value as `target`, finds the combination reaching it that changes the fewest of the user's picks.
   */
  const explore = (mode: "value" | "changes", target: number, start: Found | null): Found | null => {
    let incumbent = start;
    let budget = NODE_BUDGET;
    const used = new Set<string>(own.filter((pick) => !isSkill(pick.position)).map((pick) => pick.playerId));
    const chosen: GradedPick[] = [];
    const takenRounds: Record<string, number[]> = { QB: [], RB: [], WR: [], TE: [] };
    const options = mode === "value" ? pools : keepFirst;

    const search = (at: number, changes: number): void => {
      if (budget <= 0) return;
      if (at >= slotCount) {
        const value = lineupValue(chosen.map(asValue), args.slots);
        if (mode === "value" ? !incumbent || value > incumbent.value : value >= target && (!incumbent || changes < incumbent.changes)) {
          incumbent = { value, changes, picks: [...chosen] };
        }
        return;
      }
      const index = decisions[at]!;
      const pick = own[index]!;
      const round = rounds[index]!;
      const later = own.slice(index + 1);
      const heldAt = (position: string) => (
        chosen.filter((player) => player.position === position).length + later.filter((player) => player.position === position).length
      );
      let candidates = options[at]!;
      if (mode === "value") {
        // Most promising first, so a good combination is found early and cuts off the rest.
        const rest = later.filter((player) => isSkill(player.position));
        const gain = new Map(candidates.map((option) => [option, lineupValue([...chosen, option, ...rest].map(asValue), args.slots)] as const));
        candidates = [...candidates].sort((a, b) => gain.get(b)! - gain.get(a)! || (b === pick ? 1 : 0) - (a === pick ? 1 : 0));
      }
      for (const option of candidates) {
        if (budget <= 0) return;
        if (used.has(option.playerId)) continue;
        if (banned(args.plan, option.position, round, takenRounds[option.position] ?? [])) continue;
        // Upgrading the player taken at the same position is never a duplicate, even with a backup drafted later.
        if (option !== pick && option.position !== pick.position && heldAt(option.position) >= positionCap(option.position, args.slots)) continue;
        budget -= 1;
        used.add(option.playerId);
        chosen.push(option);
        takenRounds[option.position]?.push(round);
        const changed = changes + (option === pick ? 0 : 1);
        // The plan's needs must still be reachable, and the best case from here must be able to beat the best found.
        let viable = needs.every((need, n) => {
          const have = (takenRounds[need.position] ?? []).filter((value) => value <= need.throughRound).length;
          return have + supply[n]![at + 1]! >= need.min;
        });
        if (viable && mode === "changes" && incumbent && changed >= incumbent.changes) viable = false;
        if (viable && (mode === "changes" || incumbent)) {
          const ceiling = lineupValue([...chosen.map(asValue), ...suffixTop[at + 1]!], args.slots);
          viable = mode === "changes" ? ceiling >= target : ceiling > incumbent!.value;
        }
        if (viable) search(at + 1, changed);
        takenRounds[option.position]?.pop();
        chosen.pop();
        used.delete(option.playerId);
      }
    };

    search(0, 0);
    return incumbent;
  };

  const mostValuable = explore("value", 0, null);
  if (!mostValuable) return null;
  const result = explore("changes", mostValuable.value, mostValuable) ?? mostValuable;
  const byDecision = new Map(decisions.map((index, at) => [index, result.picks[at]!] as const));
  return own.map((pick, index) => ({ actual: pick, chosen: byDecision.get(index) ?? pick }));
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
    // A replay that is worse than the roster the user has is scored as that roster, so it cannot make another plan look best.
    return { plan, value: Math.max(value, actualValue), picks };
  };

  const none = new Map<string, GradedPick | null>(own.map((pick) => [pick.playerId, null]));
  const mine = run(yours) ?? { plan: yours, value: actualValue, picks: none };
  // Plans the draft could not follow are left out of the ranking.
  const top = ALL_PLANS.flatMap((plan) => run(plan) ?? []).sort((a, b) => b.value - a.value)[0];
  // The user's own approach wins ties, so a draft that was already the best way to go says so.
  const best = !top || (ARCHETYPES.includes(yours.rb) && mine.value >= top.value) ? mine : top;
  return { yours, best: best.plan, yoursPicks: mine.picks, bestPicks: best.picks };
}
