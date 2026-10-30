import type { DraftCenterData } from "./dashboard-types";

/** A league's draft is final once one is complete, none is still live, and the signed-in team took part. */
export function leagueDraftIsFinal(drafts: DraftCenterData["drafts"] | undefined, leagueId: string | undefined): boolean {
  const forLeague = (drafts ?? []).filter((draft) => draft.leagueId === leagueId);
  if (forLeague.some((draft) => draft.status === "drafting")) return false;
  return forLeague.some((draft) => draft.status === "complete" && draft.ownRosterId !== null);
}
