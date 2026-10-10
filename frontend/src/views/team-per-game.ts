import { rankAmong } from "../shared";

/** Season total divided by games played, rounded to the tenth shown on the card. */
export function perGame(total: number, games: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(games) || games <= 0) return null;
  return Number((total / games).toFixed(1));
}

/**
 * League rank of a per-game rate. Teams with no games played are left out.
 * Fewer than two comparable rates stays unranked. Turnovers pass `higherIsBetter: false`.
 */
export function perGameRank(
  samples: readonly { total: number; games: number }[],
  total: number,
  games: number,
  higherIsBetter = true,
): number | null {
  const value = perGame(total, games);
  if (value === null) return null;
  const rates = samples.flatMap((sample) => {
    const rate = perGame(sample.total, sample.games);
    return rate === null ? [] : [rate];
  });
  if (rates.length < 2) return null;
  return rankAmong(rates, value, higherIsBetter);
}
