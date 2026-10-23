import { depthChange } from "../shared";

export const DEPTH_CHART_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type DepthChartPosition = (typeof DEPTH_CHART_POSITIONS)[number];

type DepthRank = { position: string; rank: number };

type DepthChartPlayer = {
  playerId: string;
  name: string;
  team: string;
  position: string;
  leagueProjection: number | null;
  injuryStatus: string | null;
};

export type DepthChartCell = {
  playerId: string;
  name: string;
  projection: number | null;
  injuryStatus: string | null;
  change: ReturnType<typeof depthChange>;
};

export type DepthChartRow = {
  position: DepthChartPosition;
  /** The 1st, 2nd and 3rd on the chart; null where nobody is listed. */
  cells: [DepthChartCell | null, DepthChartCell | null, DepthChartCell | null];
};

type SeasonLongPlayer = { playerId: string; name: string; team: string | null; position: string };

/**
 * The players to place on a depth chart: this week's rankings, which carry
 * projections and injury status, or, when there are none, the season-long rows
 * (names and teams only) so the chart still shows who is where.
 */
export function depthChartPlayers(weekly: readonly DepthChartPlayer[], seasonLong: readonly SeasonLongPlayer[]): DepthChartPlayer[] {
  if (weekly.length > 0) return [...weekly];
  return seasonLong.flatMap((row) => row.team && row.position !== "PICK"
    ? [{ playerId: row.playerId, name: row.name, team: row.team, position: row.position, leagueProjection: null, injuryStatus: null }]
    : []);
}

/** "M. Hale" for "Marcus Hale", keeping a suffix: "O. Beckham Jr.". */
export function abbreviatedName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const [first, ...rest] = parts;
  if (!first || rest.length === 0) return name.trim();
  return `${first.charAt(0)}. ${rest.join(" ")}`;
}

/**
 * One team's QB, RB, WR and TE depth chart, three deep, from each player's
 * rank on the latest chart. Positions nobody is listed at are left out.
 */
export function buildTeamDepthChart({ team, players, depth, depthPrevious, canonical }: {
  team: string;
  players: readonly DepthChartPlayer[];
  depth: Readonly<Record<string, DepthRank>>;
  depthPrevious: Readonly<Record<string, DepthRank>>;
  canonical: (team: string | null) => string | null;
}): DepthChartRow[] {
  const teamCode = canonical(team);
  const seen = new Set<string>();
  const rows = new Map<DepthChartPosition, DepthChartRow>();
  for (const player of players) {
    if (seen.has(player.playerId) || canonical(player.team) !== teamCode) continue;
    const current = depth[player.playerId];
    if (!current || current.rank < 1 || current.rank > 3) continue;
    const position = DEPTH_CHART_POSITIONS.find((candidate) => candidate === current.position);
    if (!position) continue;
    seen.add(player.playerId);
    const row = rows.get(position) ?? { position, cells: [null, null, null] };
    const slot = current.rank - 1;
    if (row.cells[slot]) continue;
    row.cells[slot] = {
      playerId: player.playerId,
      name: player.name,
      projection: player.leagueProjection,
      injuryStatus: player.injuryStatus,
      change: depthChange(current, depthPrevious[player.playerId]),
    };
    rows.set(position, row);
  }
  return DEPTH_CHART_POSITIONS.flatMap((position) => rows.get(position) ?? []);
}
