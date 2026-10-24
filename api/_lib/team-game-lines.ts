/**
 * Per-team betting lines for one NFL week, from the same nflverse games.csv
 * the Tools "Game lines" panel reads. Lets roster rows, the matchup view and
 * chat show each player's game environment: spread, total, implied points.
 */
import {
  GAME_LINES_STALE_MS,
  NFLVERSE_GAMES_CSV_URL,
  gamesForSeasonWeek,
  impliedTeamTotals,
  parseGamesCsv,
  type NflverseGameRow,
} from "./nflverse-game-lines.js";
import { splitCsvLine } from "./chart-metric-transforms.js";
import { canonicalTeam, fetchText } from "./sleeper.js";

export type TeamGameLine = {
  team: string;
  opponent: string;
  isHome: boolean;
  /** From this team's side: negative = favored (e.g. -3.5), positive = underdog. */
  spread: number | null;
  /** Game over/under. */
  total: number | null;
  /** Points the line implies this team scores. */
  impliedPoints: number | null;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Two rows per game (one per team) for the given season/week. */
export function teamGameLinesForWeek(rows: readonly NflverseGameRow[], season: number, week: number): TeamGameLine[] {
  const lines: TeamGameLine[] = [];
  for (const game of gamesForSeasonWeek(rows, season, week)) {
    const away = canonicalTeam(game.awayTeam);
    const home = canonicalTeam(game.homeTeam);
    const implied = impliedTeamTotals(game.totalLine, game.spreadLine);
    // nflverse spread_line is positive when the home team is favored.
    const homeSpread = game.spreadLine === null ? null : -game.spreadLine;
    lines.push(
      {
        team: away,
        opponent: home,
        isHome: false,
        spread: homeSpread === null ? null : round1(-homeSpread),
        total: game.totalLine,
        impliedPoints: implied ? round1(implied[0]) : null,
      },
      {
        team: home,
        opponent: away,
        isHome: true,
        spread: homeSpread === null ? null : round1(homeSpread),
        total: game.totalLine,
        impliedPoints: implied ? round1(implied[1]) : null,
      },
    );
  }
  return lines;
}

let cachedRows: { fetchedAtMs: number; rows: NflverseGameRow[] } | null = null;

/** Test helper: forget the cached games file. */
export function resetTeamGameLinesCache(): void {
  cachedRows = null;
}

/** Lines for the week; the games file is cached per instance for GAME_LINES_STALE_MS. */
export async function loadTeamGameLines(season: number, week: number, fetchCsv: (url: string) => Promise<string> = fetchText): Promise<TeamGameLine[]> {
  if (!cachedRows || Date.now() - cachedRows.fetchedAtMs > GAME_LINES_STALE_MS) {
    const csv = await fetchCsv(NFLVERSE_GAMES_CSV_URL);
    const headers = new Set(splitCsvLine(csv.split(/\r?\n/, 1)[0] ?? ""));
    const required = ["game_id", "season", "game_type", "week", "away_team", "home_team", "spread_line", "total_line"];
    if (required.some((header) => !headers.has(header))) throw new Error("Invalid nflverse games CSV: missing required headers");
    cachedRows = { fetchedAtMs: Date.now(), rows: parseGamesCsv(csv) };
  }
  return teamGameLinesForWeek(cachedRows.rows, season, week);
}
