/**
 * Each NFL team's next few games from the Sleeper season schedule, for the
 * player card's schedule strip. A week with no game for a team is a bye.
 */
export type UpcomingGame = { week: number; opponent: string | null; isAway: boolean };

type ScheduleGame = { week?: number; home?: string; away?: string };

export function upcomingSchedule(
  games: readonly ScheduleGame[],
  fromWeek: number,
  count: number,
  normalize: (team: string) => string,
  lastWeek = 18,
): Record<string, UpcomingGame[]> {
  const weeks = Array.from({ length: count }, (_, index) => fromWeek + index).filter((week) => week >= 1 && week <= lastWeek);
  const byTeamWeek = new Map<string, Map<number, UpcomingGame>>();
  const teams = new Set<string>();
  for (const game of games) {
    if (!game.home || !game.away) continue;
    const home = normalize(game.home);
    const away = normalize(game.away);
    teams.add(home);
    teams.add(away);
    if (typeof game.week !== "number" || !weeks.includes(game.week)) continue;
    const set = (team: string, entry: UpcomingGame) => {
      const map = byTeamWeek.get(team) ?? new Map<number, UpcomingGame>();
      map.set(entry.week, entry);
      byTeamWeek.set(team, map);
    };
    set(home, { week: game.week, opponent: away, isAway: false });
    set(away, { week: game.week, opponent: home, isAway: true });
  }
  const out: Record<string, UpcomingGame[]> = {};
  for (const team of [...teams].sort()) {
    out[team] = weeks.map((week) => byTeamWeek.get(team)?.get(week) ?? { week, opponent: null, isAway: false });
  }
  return out;
}
