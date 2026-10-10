export const UNDO_DURATION_MS = 5_000;
export const TRADE_REMOVE_TOAST_ID = "trade-player-remove-undo";

export type TradeSelection = {
  giveIds: string[];
  getIds: string[];
};

export type RemovedTradePlayer = {
  id: string;
  index: number;
};

export type TradePlayerRemoval = {
  side: "give" | "get";
  removed: RemovedTradePlayer;
};

export function tradeRemovalsToastMessage(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 player removed";
  return `${count} players removed`;
}

export function pushTradeRemoval(
  stack: readonly TradePlayerRemoval[],
  entry: TradePlayerRemoval,
): TradePlayerRemoval[] {
  return [...stack, entry];
}

export function popTradeRemoval(
  stack: readonly TradePlayerRemoval[],
): { next: TradePlayerRemoval[]; popped: TradePlayerRemoval | null } {
  if (stack.length === 0) return { next: [], popped: null };
  const next = stack.slice(0, -1);
  return { next, popped: stack[stack.length - 1] ?? null };
}

export type DraftTakenState = {
  manualDraftedIds: string[];
  myTeamIds: string[];
};

export function clearTradeSide(selection: TradeSelection, side: "give" | "get"): { next: TradeSelection; removedIds: string[] } {
  const removedIds = [...(side === "give" ? selection.giveIds : selection.getIds)];
  const next = side === "give"
    ? { giveIds: [], getIds: [...selection.getIds] }
    : { giveIds: [...selection.giveIds], getIds: [] };
  return { next, removedIds };
}

export function restoreClearedTradeSide(selection: TradeSelection, side: "give" | "get", removedIds: readonly string[]): TradeSelection {
  return side === "give"
    ? { giveIds: [...removedIds], getIds: [...selection.getIds] }
    : { giveIds: [...selection.giveIds], getIds: [...removedIds] };
}

export function removeTradePlayer(ids: readonly string[], id: string): { next: string[]; removed: RemovedTradePlayer | null } {
  const index = ids.indexOf(id);
  if (index < 0) return { next: [...ids], removed: null };
  return {
    next: ids.filter((item) => item !== id),
    removed: { id, index },
  };
}

export function restoreTradePlayer(ids: readonly string[], removed: RemovedTradePlayer): string[] {
  if (ids.includes(removed.id)) return [...ids];
  const next = [...ids];
  const index = Math.max(0, Math.min(removed.index, next.length));
  next.splice(index, 0, removed.id);
  return next;
}

export function markDraftPlayerTaken(state: DraftTakenState, playerId: string): { next: DraftTakenState; previous: DraftTakenState } {
  const previous = {
    manualDraftedIds: [...state.manualDraftedIds],
    myTeamIds: [...state.myTeamIds],
  };
  return {
    previous,
    next: {
      manualDraftedIds: previous.manualDraftedIds.includes(playerId)
        ? previous.manualDraftedIds
        : [...previous.manualDraftedIds, playerId],
      myTeamIds: previous.myTeamIds.filter((id) => id !== playerId),
    },
  };
}

export function undoDraftPlayerTaken(previous: DraftTakenState): DraftTakenState {
  return {
    manualDraftedIds: [...previous.manualDraftedIds],
    myTeamIds: [...previous.myTeamIds],
  };
}
