import type { DraftCenterData } from "./dashboard-types";

/** A draft that has not finished: still to start, live, or paused. */
const UNFINISHED_STATUSES = ["pre_draft", "drafting", "paused"];

/** A league's draft is final once one is complete, none is still to come or live, and the signed-in team took part. */
export function leagueDraftIsFinal(drafts: DraftCenterData["drafts"] | undefined, leagueId: string | undefined): boolean {
  const forLeague = (drafts ?? []).filter((draft) => draft.leagueId === leagueId);
  if (forLeague.some((draft) => UNFINISHED_STATUSES.includes(draft.status))) return false;
  return forLeague.some((draft) => draft.status === "complete" && draft.ownRosterId !== null);
}

type LeagueDraft = DraftCenterData["drafts"][number];

/**
 * The draft the grade covers: the completed non-auction draft with the most picks, the same rule the
 * draft-grade route uses (a dynasty league can hold a startup and a rookie draft). Falls back to any
 * completed draft when every one is an auction, which has no grade.
 */
export function gradedDraftFor(drafts: DraftCenterData["drafts"] | undefined, leagueId: string | undefined): LeagueDraft | null {
  const completed = (drafts ?? []).filter((draft) => draft.leagueId === leagueId && draft.status === "complete" && draft.ownRosterId !== null);
  const pool = completed.some((draft) => draft.type !== "auction") ? completed.filter((draft) => draft.type !== "auction") : completed;
  return [...pool].sort((a, b) => b.picks.length - a.picks.length)[0] ?? null;
}

/**
 * Players to leave off the Draft board. Sleeper's picks always leave it; selections the user saved
 * while preparing (marked taken, added to my team) only do so until the draft is final, because once
 * My team is read-only nothing could show or undo them.
 */
export function boardExcludedPlayerIds(args: {
  draftIsFinal: boolean;
  sleeperDraftedIds: ReadonlySet<string>;
  manualDraftedIds: readonly string[];
  myTeamIds: readonly string[];
}): Set<string> {
  return new Set(args.draftIsFinal ? args.sleeperDraftedIds : [...args.sleeperDraftedIds, ...args.manualDraftedIds, ...args.myTeamIds]);
}
