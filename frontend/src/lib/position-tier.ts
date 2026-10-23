const TIERED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Weekly rank as the usual fantasy shorthand: RB1 is a top-`leagueSize` back,
 * RB2 the next `leagueSize`, RB3 the next. Within a band the first half is
 * "High-end" (top 6 of a 12-team league) and the second half "Low-end".
 * Returns null for kickers, defenses and anyone ranked past the RB3 band.
 */
export function positionTierLabel(position: string, rank: number | null | undefined, leagueSize = 12): string | null {
  if (!TIERED_POSITIONS.has(position) || rank == null || !Number.isFinite(rank) || rank < 1 || leagueSize < 2) return null;
  const band = Math.ceil(rank / leagueSize);
  if (band > 3) return null;
  const withinBand = rank - (band - 1) * leagueSize;
  const half = withinBand <= leagueSize / 2 ? "High-end" : "Low-end";
  return `${half} ${position}${band}`;
}
