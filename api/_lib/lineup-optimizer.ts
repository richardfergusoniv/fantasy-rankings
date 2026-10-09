export type OptimizablePlayer = {
  playerId: string;
  position: string;
  lineupSlot: string | null;
  isStarter: boolean;
  projection: number | null;
  actual: number | null;
  gamePhase?: "pregame" | "live" | "final" | null;
  gameTime?: string | null;
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

export function eligibleForSlot(position: string, slot: string): boolean {
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  return false;
}

function kickoffHasPassed(gameTime: string | null | undefined, now: number): boolean {
  if (!gameTime) return false;
  const kickoff = Date.parse(gameTime);
  return Number.isFinite(kickoff) && kickoff <= now;
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

function relabelOpenSlots<T extends OptimizablePlayer>(players: T[], slots: string[]): T[] {
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
        const flexValue = player.projection ?? -1000;
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

function optimizeOpenSlots<T extends OptimizablePlayer>(players: T[], slots: string[], currentStarterIds: ReadonlySet<string>): Array<T | undefined> {
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
          score: state.score + (player.projection ?? -1000),
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
  const relabeled = relabelOpenSlots(filled.map((entry) => entry.player), filled.map((entry) => entry.slot));
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
  const openPlacements = optimizeOpenSlots(unlocked, openSlotIndexes.map((index) => slots[index] ?? ""), currentStarterIds);

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
  const openPlacements = optimizeOpenSlots(movable, openIndexes.map((index) => slots[index] ?? ""), currentStarterIds);
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
