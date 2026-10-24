const TIERED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Weekly rank as the usual fantasy shorthand: RB1 is a top-`leagueSize` back,
 * RB2 the next `leagueSize`, RB3 the next. Each band splits in thirds:
 * "High-end" (top 4 of a 12-team league), "Mid" and "Low-end".
 * Running backs and receivers in the third band read "RB3/Flex" and "WR3/Flex",
 * the way experts write the bottom of the starting range.
 * Returns null for kickers, defenses and anyone ranked past the RB3 band.
 */
export function positionTierLabel(position: string, rank: number | null | undefined, leagueSize = 12): string | null {
  if (!TIERED_POSITIONS.has(position) || rank == null || !Number.isFinite(rank) || rank < 1 || leagueSize < 2) return null;
  const band = Math.ceil(rank / leagueSize);
  if (band > 3) return null;
  const withinBand = rank - (band - 1) * leagueSize;
  const third = withinBand <= leagueSize / 3 ? "High-end" : withinBand <= (2 * leagueSize) / 3 ? "Mid" : "Low-end";
  const flex = band === 3 && (position === "RB" || position === "WR") ? "/Flex" : "";
  return `${third} ${position}${band}${flex}`;
}
