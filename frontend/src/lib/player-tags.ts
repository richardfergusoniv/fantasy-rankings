export type ProfileTag = "High floor" | "High ceiling" | "Boom/Bust";

/** Fewest games before a player gets a tag; fewer would label everyone by luck. */
export const PROFILE_TAG_MIN_GAMES = 8;

// Quartiles against the median, so the cutoffs hold for any scoring system.
// Boom/Bust: the bottom quarter of games is under 40% of the median and the top quarter over 150%.
// High ceiling: the top quarter of games is over 160% of the median.
// High floor: the bottom quarter of games still holds 70% of the median, with no big top-end weeks.
const BOOM_BUST_LOW = 0.4;
const BOOM_BUST_HIGH = 1.5;
const HIGH_FLOOR_LOW = 0.7;
const HIGH_CEILING_HIGH = 1.6;

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * The floor/ceiling word experts add to a tier ("High Ceiling WR2", "High Floor WR3"),
 * from a player's weekly fantasy scores. Null when the sample is small or nothing stands out.
 */
export function profileTag(weeklyScores: readonly number[]): ProfileTag | null {
  if (weeklyScores.length < PROFILE_TAG_MIN_GAMES) return null;
  const sorted = [...weeklyScores].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  if (!(median > 0)) return null;
  const low = quantile(sorted, 0.25) / median;
  const high = quantile(sorted, 0.75) / median;
  if (low <= BOOM_BUST_LOW && high >= BOOM_BUST_HIGH) return "Boom/Bust";
  if (high >= HIGH_CEILING_HIGH) return "High ceiling";
  if (low >= HIGH_FLOOR_LOW) return "High floor";
  return null;
}
