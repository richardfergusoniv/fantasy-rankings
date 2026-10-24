import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { isBoomBustPosition } from "../dashboard-shared";
import { profileTag, type ProfileTag } from "./player-tags";

/** The floor/ceiling tag from the player's season scores; shares its cache with the player card's Boom / Bust panel. */
export function useProfileTag(leagueId: string, playerId: string | null | undefined, position: string): ProfileTag | null {
  const supported = Boolean(playerId) && isBoomBustPosition(position);
  const history = useQuery({
    queryKey: ["boom-bust-history", leagueId, playerId, "season"],
    queryFn: () => {
      if (!playerId || !isBoomBustPosition(position)) throw new Error("Unsupported position");
      return api.getBoomBustHistory({ leagueId, playerId, position, view: "season" });
    },
    enabled: supported,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  if (!history.data || history.data.status !== "ok") return null;
  return profileTag(history.data.weeklyScores.map((score) => score.points));
}
