export type OptimizablePlayer = {
  playerId: string;
  position: string;
  lineupSlot: string | null;
  isStarter: boolean;
  projection: number | null;
  actual: number | null;
  gamePhase?: "pregame" | "live" | "final" | null;
  gameTime?: string | null;
  /** ESPN quarter / overtime period (1–4 regulation, 5+ OT). */
  gamePeriod?: number | null;
  /** ESPN seconds remaining in the current period. */
  gameClockSeconds?: number | null;
  injuryStatus?: string | null;
  isBye?: boolean;
};

const skillPositions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

const unavailableStatuses = new Set([
  "out",
  "inactive",
  "ir",
  "injured reserve",
  "pup",
  "physically unable to perform",
  "nfi",
  "non football injury",
  "non football illness",
  "suspended",
  "suspension",
  "reserve suspended",
]);

const flexLineupSlots = new Set(["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"]);

/** Weight of live pace vs pregame time-remaining at kickoff (mostly pregame). */
export const LIVE_PACE_BLEND_START = 0.15;
/** Weight of live pace near the end of regulation (still blended, not pure pace). */
export const LIVE_PACE_BLEND_END = 0.65;
/**
 * Cap on remaining projection vs pure time-based remaining.
 * Stops one early TD from implying an absurd full-game total.
 */
export const LIVE_PACE_REMAINING_CAP = 1.25;

const REGULATION_QUARTERS = 4;
const QUARTER_SECONDS = 15 * 60;
const REGULATION_SECONDS = REGULATION_QUARTERS * QUARTER_SECONDS;
const DATE_ONLY_KICKOFF = /^\d{4}-\d{2}-\d{2}$/;

export function eligibleForSlot(position: string, slot: string): boolean {
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  return false;
}

function kickoffHasPassed(gameTime: string | null | undefined, now: number): boolean {
  if (!gameTime || DATE_ONLY_KICKOFF.test(gameTime.trim())) return false;
  const kickoff = Date.parse(gameTime);
  return Number.isFinite(kickoff) && kickoff <= now;
}

/** Map Sleeper/ESPN status strings to a lineup phase. Postponed/canceled stay non-live. */
export function normalizeGamePhase(status: string | undefined): "pregame" | "live" | "final" | null {
  if (!status) return null;
  const normalized = status.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["complete", "final", "post_game", "status_final", "status_full_time"].includes(normalized)) return "final";
  if ([
    "pre_game",
    "pregame",
    "scheduled",
    "status_scheduled",
    "status_pregame",
    "postponed",
    "status_postponed",
    "canceled",
    "cancelled",
    "status_canceled",
    "status_cancelled",
    "delayed",
    "status_delayed",
    "time_tbd",
    "status_time_tbd",
  ].includes(normalized)) return "pregame";
  if ([
    "in_game",
    "in_progress",
    "live",
    "status_in_progress",
    "status_halftime",
    "halftime",
    "status_end_period",
    "status_end_of_period",
    "end_period",
  ].includes(normalized)) return "live";
  // Unknown statuses stay non-live so postponed/canceled variants never look in-progress.
  return "pregame";
}

/** A player is locked once their game has started or finished. Posted actuals alone do not lock a pregame player. */
export function isLineupLocked(player: Pick<OptimizablePlayer, "gamePhase" | "gameTime">, now = Date.now()): boolean {
  if (player.gamePhase === "live" || player.gamePhase === "final") return true;
  return kickoffHasPassed(player.gameTime, now);
}

/** Locked players count their actual points. Players who have not kicked off still count their projection. */
export function lineupCountingPoints(player: Pick<OptimizablePlayer, "gamePhase" | "gameTime" | "actual" | "projection">, now = Date.now()): number | null {
  if (isLineupLocked(player, now)) return player.actual;
  return player.projection;
}

/**
 * Fraction of regulation elapsed from ESPN period + clock.
 * Halftime (end of Q2 / start of Q3) is 0.5. Overtime is treated as fully elapsed.
 * Returns null when clock data is missing or unusable.
 */
export function gameElapsedFraction(
  period: number | null | undefined,
  clockSeconds: number | null | undefined,
): number | null {
  if (period == null || !Number.isFinite(period) || period < 1) return null;
  if (clockSeconds == null || !Number.isFinite(clockSeconds)) return null;
  if (period >= 5) return 1;
  const clock = Math.max(0, Math.min(QUARTER_SECONDS, clockSeconds));
  const completedQuarters = Math.min(REGULATION_QUARTERS, Math.max(0, Math.floor(period) - 1));
  const secondsElapsed = completedQuarters * QUARTER_SECONDS + (QUARTER_SECONDS - clock);
  return Math.max(0, Math.min(1, secondsElapsed / REGULATION_SECONDS));
}

export function livePaceBlendWeight(elapsedFraction: number): number {
  const elapsed = Math.max(0, Math.min(1, elapsedFraction));
  return LIVE_PACE_BLEND_START + (LIVE_PACE_BLEND_END - LIVE_PACE_BLEND_START) * elapsed;
}

function isKickerOrDefense(position: string): boolean {
  return position === "K" || position === "DEF" || position === "DST";
}

/**
 * Remaining fantasy points for a live player.
 * Skill positions blend pregame time-remaining with live pace and apply LIVE_PACE_REMAINING_CAP.
 * K/DST use simple time-based remaining only.
 */
export function liveRemainingProjection(options: {
  pregameProjection: number;
  actual: number;
  elapsedFraction: number;
  position: string;
}): number {
  const remainingFraction = Math.max(0, 1 - options.elapsedFraction);
  const timeBasedRemaining = options.pregameProjection * remainingFraction;
  if (remainingFraction <= 0) return 0;
  if (isKickerOrDefense(options.position) || options.elapsedFraction <= 0) {
    return Math.max(0, timeBasedRemaining);
  }
  const expectedSoFar = options.pregameProjection * options.elapsedFraction;
  const paceRatio = expectedSoFar > 0 ? options.actual / expectedSoFar : 1;
  const paceBasedRemaining = timeBasedRemaining * paceRatio;
  const weight = livePaceBlendWeight(options.elapsedFraction);
  const blended = (1 - weight) * timeBasedRemaining + weight * paceBasedRemaining;
  const capped = Math.min(blended, timeBasedRemaining * LIVE_PACE_REMAINING_CAP);
  return Math.max(0, capped);
}

export type LiveForecastPlayer = Pick<
  OptimizablePlayer,
  | "playerId"
  | "position"
  | "projection"
  | "actual"
  | "gamePhase"
  | "gameTime"
  | "gamePeriod"
  | "gameClockSeconds"
  | "injuryStatus"
  | "isBye"
>;

/**
 * Shared projected final for lineup/team totals.
 * Final → actual. Pregame (including stale lock-by-clock) → pregame projection.
 * Live → actual + remaining (blend/cap for skill; time-only for K/DST).
 * Missing clock → max(actual, pregame). Out/injured in a live game → actual only.
 */
export function liveForecastPoints(player: LiveForecastPlayer, _now = Date.now()): number | null {
  if (isVacantLineupSlot(player)) return null;
  if (player.isBye) return 0;
  if (player.gamePhase === "final") return player.actual;

  const pregame = player.projection;
  const actual = player.actual;

  if (player.gamePhase === "live") {
    if (isUnavailableStatus(player.injuryStatus)) {
      return actual ?? 0;
    }
    const elapsed = gameElapsedFraction(player.gamePeriod, player.gameClockSeconds);
    if (elapsed === null) {
      if (actual === null && pregame === null) return null;
      return Math.max(actual ?? 0, pregame ?? 0);
    }
    if (pregame === null && actual === null) return null;
    const scored = actual ?? 0;
    const projectionBase = pregame ?? 0;
    const remaining = liveRemainingProjection({
      pregameProjection: projectionBase,
      actual: scored,
      elapsedFraction: elapsed,
      position: player.position,
    });
    return Number((scored + remaining).toFixed(4));
  }

  // Pregame / postponed / unknown: always use projection, even if the browser
  // clock has crossed kickoff on a stale payload (actual often 0/null).
  return pregame;
}

/** Sum of liveForecastPoints for a lineup. Vacant/null rows are omitted. */
export function sumLiveForecast(players: readonly LiveForecastPlayer[], now = Date.now()): number | null {
  const values = players.flatMap((player) => {
    const value = liveForecastPoints(player, now);
    return value === null ? [] : [value];
  });
  if (values.length === 0) return null;
  return Number(values.reduce((total, value) => total + value, 0).toFixed(4));
}

/** Ranking value for the optimizer: same forecast numbers as lineup totals. */
export function lineupRankingPoints(player: LiveForecastPlayer, now = Date.now()): number {
  return liveForecastPoints(player, now) ?? -1000;
}

export function isVacantLineupSlot(player: Pick<OptimizablePlayer, "playerId">): boolean {
  return player.playerId === "0";
}

function normalizedStatus(status: string): string {
  return status.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
}

/** Same week-availability set as Sleeper injury status. Kept local so the matchup UI can import this module. */
export function isUnavailableStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return unavailableStatuses.has(normalizedStatus(status));
}

/** Live and final rows show points already scored. A live row with no actual yet stays on its projection. */
export function displayedMatchupPoints(player: Pick<OptimizablePlayer, "gamePhase" | "actual" | "projection">): { value: number | null; label: "PROJ" | "PTS" } {
  if (player.gamePhase === "final" || (player.gamePhase === "live" && typeof player.actual === "number")) {
    return { value: player.actual, label: "PTS" };
  }
  return { value: player.projection, label: "PROJ" };
}

/** Weekly power totals count live actuals. Empty starter slots add nothing. */
export function powerRankingPoints(player: Pick<OptimizablePlayer, "playerId" | "gamePhase" | "gameTime" | "actual" | "projection">, now = Date.now()): number | null {
  if (isVacantLineupSlot(player)) return null;
  return lineupCountingPoints(player, now);
}

export function mapSubmittedStarters<T>(
  starterIds: readonly string[],
  buildPlayer: (id: string, index: number) => T,
  buildVacant: (index: number) => T,
): T[] {
  return starterIds.map((id, index) => (id && id !== "0" ? buildPlayer(id, index) : buildVacant(index)));
}

/** Starters, reserve, and taxi stay out of the matchup bench pool. */
export function activeBenchIds(
  playerIds: readonly string[],
  starterIds: readonly string[],
  reserveIds: readonly string[] = [],
  taxiIds: readonly string[] = [],
): string[] {
  const excluded = new Set([...starterIds, ...reserveIds, ...taxiIds, "0"]);
  return playerIds.filter((id) => id !== "" && !excluded.has(id));
}

function canFillOpenSlot(player: OptimizablePlayer, now: number): boolean {
  if (isVacantLineupSlot(player) || player.isBye || isUnavailableStatus(player.injuryStatus)) return false;
  return !isLineupLocked(player, now);
}

function relabelOpenSlots<T extends OptimizablePlayer>(players: T[], slots: string[], now: number): T[] {
  if (players.length !== slots.length || players.length === 0) return players;
  type LabelState = { flexTotal: number; flexValues: number[]; exactCount: number; assignments: number[] };
  const compareFlexValues = (left: number[], right: number[]) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return left.length - right.length;
  };
  let states = new Map<number, LabelState>([[0, { flexTotal: 0, flexValues: [], exactCount: 0, assignments: [] }]]);

  slots.forEach((slot) => {
    const next = new Map<number, LabelState>();
    for (const [mask, state] of states) {
      players.forEach((player, playerIndex) => {
        const bit = 2 ** playerIndex;
        if ((mask & bit) !== 0 || !eligibleForSlot(player.position, slot)) return;
        const flexValue = lineupRankingPoints(player, now);
        const isFlexSlot = flexLineupSlots.has(slot);
        const candidate: LabelState = {
          flexTotal: state.flexTotal + (isFlexSlot ? flexValue : 0),
          flexValues: isFlexSlot ? [...state.flexValues, flexValue] : state.flexValues,
          exactCount: state.exactCount + (slot === player.position ? 1 : 0),
          assignments: [...state.assignments, playerIndex],
        };
        const nextMask = mask | bit;
        const existing = next.get(nextMask);
        const flexOrder = existing ? compareFlexValues(candidate.flexValues, existing.flexValues) : -1;
        if (
          !existing
          || candidate.flexTotal < existing.flexTotal
          || (candidate.flexTotal === existing.flexTotal && flexOrder < 0)
          || (candidate.flexTotal === existing.flexTotal && flexOrder === 0 && candidate.exactCount > existing.exactCount)
        ) {
          next.set(nextMask, candidate);
        }
      });
    }
    states = next;
  });

  const fullMask = 2 ** players.length - 1;
  const best = states.get(fullMask);
  if (!best) return players;
  const assignments = best.assignments.map((playerIndex) => players[playerIndex]).filter((player): player is T => Boolean(player));
  return assignments.map((player, index) => ({ ...player, isStarter: true, lineupSlot: slots[index] ?? player.position }));
}

function optimizeOpenSlots<T extends OptimizablePlayer>(players: T[], slots: string[], currentStarterIds: ReadonlySet<string>, now: number): Array<T | undefined> {
  type State = { score: number; currentCount: number; assignments: Array<T | undefined> };
  let states = new Map<number, State>([[0, { score: 0, currentCount: 0, assignments: Array.from({ length: slots.length }) }]]);

  for (const player of players) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      slots.forEach((slot, slotIndex) => {
        const bit = 2 ** slotIndex;
        if ((mask & bit) !== 0 || !eligibleForSlot(player.position, slot)) return;
        const nextMask = mask | bit;
        const candidate: State = {
          score: state.score + lineupRankingPoints(player, now),
          currentCount: state.currentCount + (currentStarterIds.has(player.playerId) ? 1 : 0),
          assignments: state.assignments.map((assigned, index) => index === slotIndex ? player : assigned),
        };
        const existing = next.get(nextMask);
        if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.currentCount > existing.currentCount)) {
          next.set(nextMask, candidate);
        }
      });
    }
    states = next;
  }

  const countBits = (value: number): number => value.toString(2).replaceAll("0", "").length;
  let bestMask = 0;
  let bestState = states.get(0) ?? { score: 0, currentCount: 0, assignments: [] };
  for (const [mask, state] of states) {
    const filled = countBits(mask);
    const bestFilled = countBits(bestMask);
    if (filled > bestFilled || (filled === bestFilled && (state.score > bestState.score || (state.score === bestState.score && state.currentCount > bestState.currentCount)))) {
      bestMask = mask;
      bestState = state;
    }
  }

  const filled = bestState.assignments.flatMap((player, index) => player ? [{ player, slot: slots[index] ?? player.position }] : []);
  const relabeled = relabelOpenSlots(filled.map((entry) => entry.player), filled.map((entry) => entry.slot), now);
  const placed: Array<T | undefined> = Array.from({ length: slots.length });
  let relabelIndex = 0;
  bestState.assignments.forEach((player, index) => {
    if (!player) return;
    placed[index] = relabeled[relabelIndex] ?? player;
    relabelIndex += 1;
  });
  return placed;
}

function vacantSlot<T extends OptimizablePlayer>(template: T, slot: string): T {
  return {
    ...template,
    playerId: "0",
    isStarter: true,
    lineupSlot: slot,
    projection: null,
    actual: null,
    isBye: false,
    injuryStatus: null,
  };
}

export function optimizeLineup<T extends OptimizablePlayer>(startersInput: T[], benchInput: T[], now = Date.now()): { starters: T[]; bench: T[] } {
  const slots = startersInput.map((player) => player.lineupSlot ?? player.position);
  const lockedSlotIndexes = startersInput.flatMap((player, index) => (
    !isVacantLineupSlot(player) && isLineupLocked(player, now) ? [index] : []
  ));
  const openSlotIndexes = startersInput.flatMap((player, index) => (
    isVacantLineupSlot(player) || !isLineupLocked(player, now) ? [index] : []
  ));
  const unlocked = [...startersInput, ...benchInput].filter((player) => canFillOpenSlot(player, now));
  const currentStarterIds = new Set(startersInput.flatMap((player) => (
    canFillOpenSlot(player, now) ? [player.playerId] : []
  )));
  const openPlacements = optimizeOpenSlots(unlocked, openSlotIndexes.map((index) => slots[index] ?? ""), currentStarterIds, now);

  const startersByIndex: Array<T | undefined> = Array.from({ length: slots.length });
  for (const index of lockedSlotIndexes) {
    const player = startersInput[index];
    if (!player) continue;
    startersByIndex[index] = { ...player, isStarter: true, lineupSlot: slots[index] ?? player.position };
  }
  openSlotIndexes.forEach((slotIndex, openIndex) => {
    const placed = openPlacements[openIndex];
    const original = startersInput[slotIndex];
    const slot = slots[slotIndex] ?? original?.position ?? "";
    if (placed) {
      startersByIndex[slotIndex] = placed;
      return;
    }
    if (!original) return;
    const alreadyPlaced = startersByIndex.some((player) => (
      player !== undefined && !isVacantLineupSlot(player) && !isVacantLineupSlot(original) && player.playerId === original.playerId
    ));
    startersByIndex[slotIndex] = alreadyPlaced
      ? vacantSlot(original, slot)
      : { ...original, isStarter: true, lineupSlot: slot };
  });

  const starters = startersByIndex.filter((player): player is T => Boolean(player));
  const starterIds = new Set(starters.flatMap((player) => isVacantLineupSlot(player) ? [] : [player.playerId]));
  const bench = [...startersInput, ...benchInput]
    .filter((player) => !isVacantLineupSlot(player) && !starterIds.has(player.playerId))
    .map((player) => ({ ...player, isStarter: false, lineupSlot: null }));
  return { starters, bench };
}

export type OptimizedTradeRoster<T extends OptimizablePlayer> = {
  starters: T[];
  bench: T[];
  score: number;
};

function tradePoints(player: OptimizablePlayer, now: number): number {
  if (isLineupLocked(player, now)) return lineupCountingPoints(player, now) ?? 0;
  return player.projection ?? 0;
}

/** Best weekly lineup for a trade grade. Locked starters stay in their slot and count actual points. */
export function optimizeTradeRoster<T extends OptimizablePlayer>(players: T[], slots: string[], now = Date.now()): OptimizedTradeRoster<T> {
  const eligiblePlayers = players.filter((player) => skillPositions.has(player.position) && !isVacantLineupSlot(player));
  const lockedStarters = eligiblePlayers.filter((player) => player.isStarter && isLineupLocked(player, now));
  const movable = eligiblePlayers.filter((player) => !isLineupLocked(player, now));
  const assignments: Array<T | undefined> = Array.from({ length: slots.length });
  const used = new Set<string>();

  const pin = (player: T, index: number) => {
    assignments[index] = { ...player, isStarter: true, lineupSlot: slots[index] ?? player.position };
    used.add(player.playerId);
  };
  for (const player of lockedStarters) {
    if (!player.lineupSlot) continue;
    const index = slots.findIndex((slot, slotIndex) => (
      !assignments[slotIndex] && slot === player.lineupSlot && eligibleForSlot(player.position, slot)
    ));
    if (index >= 0) pin(player, index);
  }
  for (const player of lockedStarters) {
    if (used.has(player.playerId)) continue;
    const index = slots.findIndex((slot, slotIndex) => !assignments[slotIndex] && eligibleForSlot(player.position, slot));
    if (index >= 0) pin(player, index);
  }

  const openIndexes = slots.flatMap((_, index) => assignments[index] ? [] : [index]);
  const currentStarterIds = new Set(movable.flatMap((player) => player.isStarter ? [player.playerId] : []));
  const openPlacements = optimizeOpenSlots(movable, openIndexes.map((index) => slots[index] ?? ""), currentStarterIds, now);
  openIndexes.forEach((slotIndex, openIndex) => {
    const player = openPlacements[openIndex];
    if (!player || used.has(player.playerId)) return;
    assignments[slotIndex] = { ...player, isStarter: true, lineupSlot: slots[slotIndex] ?? player.position };
    used.add(player.playerId);
  });

  const starters = assignments.filter((player): player is T => Boolean(player));
  const score = starters.reduce((total, player) => total + tradePoints(player, now), 0);
  const bench = players
    .filter((player) => !isVacantLineupSlot(player) && !used.has(player.playerId))
    .map((player) => ({ ...player, isStarter: false, lineupSlot: null }));
  return { starters, bench, score: Number(score.toFixed(2)) };
}
