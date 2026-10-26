/** Missing periods invalidate the table; zero is a real observed score. */
export function parsePeriodScores(periods: Array<{ value?: number; displayValue?: string }> = []): number[] | null {
  const scores: number[] = [];
  for (const period of periods) {
    const value = Number.isFinite(period.value) ? period.value! : Number(period.displayValue?.trim() || NaN);
    if (!Number.isFinite(value)) return null;
    scores.push(value);
  }
  return scores;
}
