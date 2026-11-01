import type { PlayerSelection } from "../AnalyticsViews";

const COMPARISON_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

type SeedSources = {
  rankings: ReadonlyArray<{ playerId: string; name: string; team: string | null; position: string }>;
  seasonLongRankings: ReadonlyArray<{ playerId: string; name: string; team: string | null; position: string; formatKey: string }>;
  defenses: ReadonlyArray<{ team: string }>;
};

/**
 * The Comparison slot a URL player id (`c1`/`c2`) asks for. Skill players come from
 * the weekly or season-long rankings; a defense's Sleeper id is its team code, so it
 * resolves against the league's defenses and is matched by team.
 */
export function comparisonSeed(sources: SeedSources, formatKey: string, playerId: string | null): PlayerSelection | null {
  if (!playerId) return null;
  const row = sources.rankings.find((item) => item.playerId === playerId)
    ?? sources.seasonLongRankings.find((item) => item.playerId === playerId && item.formatKey === formatKey);
  if (row) {
    const position = COMPARISON_POSITIONS.find((item) => item === row.position);
    return position ? { playerId: row.playerId, name: row.name, team: row.team ?? "", position } : null;
  }
  const defense = sources.defenses.find((item) => item.team.toUpperCase() === playerId.toUpperCase());
  return defense ? { name: `${defense.team} Defense`, team: defense.team, position: "DEF" } : null;
}
