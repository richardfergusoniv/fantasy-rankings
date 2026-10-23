type GameLogEntry = { season: number; week: number; points: number };

export type GameLogRow<T extends GameLogEntry> =
  | { kind: "game"; game: T; share: number }
  | { kind: "gap"; season: number; week: number };

/**
 * Game log rows, newest first. Each game carries its points as a 0-1 share of
 * the best game shown, and a week missing between two games of one season
 * becomes a "gap" row. Weeks before the first game are not invented.
 */
export function buildGameLogRows<T extends GameLogEntry>(oldestFirst: readonly T[]): GameLogRow<T>[] {
  const maxPoints = Math.max(1, ...oldestFirst.map((game) => game.points));
  return [...oldestFirst].reverse().flatMap((game, index, newestFirst): GameLogRow<T>[] => {
    const earlier = newestFirst[index + 1];
    const gaps = earlier && earlier.season === game.season
      ? Array.from({ length: Math.max(0, game.week - earlier.week - 1) }, (_unused, offset): GameLogRow<T> => ({ kind: "gap", season: game.season, week: game.week - 1 - offset }))
      : [];
    return [{ kind: "game", game, share: Math.min(1, Math.max(0, game.points / maxPoints)) }, ...gaps];
  });
}
