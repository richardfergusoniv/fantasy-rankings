import { canonicalNflTeam, normalizeTeamStatsPlayerName } from "../../api/_lib/nflverse-team-week-stats";

/** A player as a tool names them. Tool data sources do not always share the dashboard's player ids. */
export type PlayerRef = {
  playerId: string | null;
  name: string;
  team: string | null;
  position: string | null;
};

export type DashboardPlayerRow = {
  playerId: string;
  name: string;
  team?: string | null;
  position: string;
};

/** Where a tool row's player name links: a real href, plus in-app navigation. */
export type ToolPlayerLink = { href: string; onOpen: () => void };

export type PlayerLinkResolver = (ref: PlayerRef) => ToolPlayerLink | null;

function nameKey(name: string): string {
  return normalizeTeamStatsPlayerName(name);
}

/**
 * Resolves a tool's player reference to a dashboard player id, or null.
 * An id the dashboard knows wins; otherwise the name must match exactly one
 * dashboard player (and agree on team and position when both sides give them).
 * An ambiguous name resolves to nothing, so a link never opens the wrong card.
 */
export function createPlayerResolver(rows: readonly DashboardPlayerRow[]): (ref: PlayerRef) => string | null {
  const ids = new Set<string>();
  const byName = new Map<string, DashboardPlayerRow[]>();
  for (const row of rows) {
    ids.add(row.playerId);
    const key = nameKey(row.name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(row);
    else byName.set(key, [row]);
  }
  return (ref) => {
    if (ref.playerId && ids.has(ref.playerId)) return ref.playerId;
    const key = nameKey(ref.name);
    if (!key) return null;
    const team = ref.team ? canonicalNflTeam(ref.team) : null;
    const matches = new Map<string, DashboardPlayerRow>();
    for (const row of byName.get(key) ?? []) {
      if (team && row.team && canonicalNflTeam(row.team) !== team) continue;
      if (ref.position && row.position !== ref.position) continue;
      matches.set(row.playerId, row);
    }
    return matches.size === 1 ? [...matches.keys()][0]! : null;
  };
}
