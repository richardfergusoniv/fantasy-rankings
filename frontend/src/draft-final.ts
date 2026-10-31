import type { DraftCenterData } from "./dashboard-types";

/** A league's draft is final once one is complete, none is still live, and the signed-in team took part. */
export function leagueDraftIsFinal(drafts: DraftCenterData["drafts"] | undefined, leagueId: string | undefined): boolean {
  const forLeague = (drafts ?? []).filter((draft) => draft.leagueId === leagueId);
  if (forLeague.some((draft) => draft.status === "drafting")) return false;
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
