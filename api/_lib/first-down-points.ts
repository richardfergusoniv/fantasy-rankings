/**
 * First Down's projected points for a player, read from a stored First Down
 * snapshot in a league's scoring. Used to save First Down beside the props
 * projection in projection_accuracy so the two can be compared with what happened.
 * Free of DB imports so unit tests can drive it.
 */
import { canonicalTeam, normalizePosition, normalizedPlayerName } from "./sleeper.js";

type SnapshotRow = {
  player: string;
  team: string;
  position: string;
  leagues: Record<string, number>;
  expected_stats: Record<string, number>;
};

export type FirstDownLookup = (args: { leagueId: string; name: string; position: string; team?: string | null }) => number | null;

/**
 * Looks a player up by name and position, using team to settle a tie. A name
 * that matches several players with no team to choose between them has no answer,
 * so a wrong player's projection is never saved.
 */
export function firstDownLookup(snapshot: { projections: readonly SnapshotRow[] } | null | undefined): FirstDownLookup {
  const byNamePosition = new Map<string, SnapshotRow[]>();
  for (const row of snapshot?.projections ?? []) {
    const key = `${normalizedPlayerName(row.player)}:${normalizePosition(row.position)}`;
    const list = byNamePosition.get(key) ?? [];
    list.push(row);
    byNamePosition.set(key, list);
  }
  return ({ leagueId, name, position, team }) => {
    const matches = byNamePosition.get(`${normalizedPlayerName(name)}:${normalizePosition(position)}`) ?? [];
    let row: SnapshotRow | undefined;
    if (matches.length === 1) {
      const only = matches[0]!;
      // A known team that disagrees means a different player with the same name.
      row = team && canonicalTeam(only.team) !== canonicalTeam(team) ? undefined : only;
    } else if (matches.length > 1 && team) {
      const sameTeam = matches.filter((candidate) => canonicalTeam(candidate.team) === canonicalTeam(team));
      row = sameTeam.length === 1 ? sameTeam[0] : undefined;
    }
    if (!row) return null;
    // The league's own staged total when there is one, else the snapshot's generic total.
    const points = row.leagues[leagueId] ?? row.expected_stats.projected_points;
    return typeof points === "number" && Number.isFinite(points) ? points : null;
  };
}
