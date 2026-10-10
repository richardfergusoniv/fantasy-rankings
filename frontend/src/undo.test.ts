import { describe, expect, it } from "vitest";
import {
  clearTradeSide,
  markDraftPlayerTaken,
  popTradeRemoval,
  pushTradeRemoval,
  removeTradePlayer,
  restoreClearedTradeSide,
  restoreTradePlayer,
  tradeRemovalsToastMessage,
  undoDraftPlayerTaken,
} from "./undo";

describe("trade undo", () => {
  it("clears one side and restores those players", () => {
    const selection = { giveIds: ["a", "b"], getIds: ["c"] };
    const cleared = clearTradeSide(selection, "give");
    expect(cleared.next).toEqual({ giveIds: [], getIds: ["c"] });
    expect(cleared.removedIds).toEqual(["a", "b"]);
    expect(restoreClearedTradeSide(cleared.next, "give", cleared.removedIds)).toEqual(selection);
  });

  it("leaves the other side in place when that side is cleared", () => {
    const selection = { giveIds: ["a"], getIds: ["c", "d"] };
    const cleared = clearTradeSide(selection, "get");
    expect(cleared.next.giveIds).toEqual(["a"]);
    expect(restoreClearedTradeSide({ giveIds: ["a", "e"], getIds: [] }, "get", cleared.removedIds).getIds).toEqual(["c", "d"]);
  });

  it("removes a player and puts them back at the same spot", () => {
    const removed = removeTradePlayer(["a", "b", "c"], "b");
    expect(removed.next).toEqual(["a", "c"]);
    expect(removed.removed).toEqual({ id: "b", index: 1 });
    expect(restoreTradePlayer(removed.next, removed.removed!)).toEqual(["a", "b", "c"]);
    expect(restoreTradePlayer(["a", "b", "c"], removed.removed!)).toEqual(["a", "b", "c"]);
  });

  it("does nothing when the player is not on that side", () => {
    expect(removeTradePlayer(["a"], "z").removed).toBeNull();
  });

  it("stacks removals newest-last and pops most recent first", () => {
    const first = { side: "give" as const, removed: { id: "a", index: 0 } };
    const second = { side: "get" as const, removed: { id: "b", index: 1 } };
    const stacked = pushTradeRemoval(pushTradeRemoval([], first), second);
    expect(tradeRemovalsToastMessage(stacked.length)).toBe("2 players removed");
    const popped = popTradeRemoval(stacked);
    expect(popped.popped).toEqual(second);
    expect(popped.next).toEqual([first]);
    expect(tradeRemovalsToastMessage(1)).toBe("1 player removed");
    expect(popTradeRemoval([]).popped).toBeNull();
  });
});

describe("draft taken undo", () => {
  it("marks a player taken and restores the earlier lists", () => {
    const state = { manualDraftedIds: ["x"], myTeamIds: ["p", "q"] };
    const taken = markDraftPlayerTaken(state, "p");
    expect(taken.next).toEqual({ manualDraftedIds: ["x", "p"], myTeamIds: ["q"] });
    expect(undoDraftPlayerTaken(taken.previous)).toEqual(state);
  });

  it("does not duplicate a player who was already marked taken", () => {
    const state = { manualDraftedIds: ["p"], myTeamIds: [] };
    expect(markDraftPlayerTaken(state, "p").next.manualDraftedIds).toEqual(["p"]);
  });
});
