/**
 * nflverse games.csv helpers for the Monitor "Game lines" panel.
 * Pure parse/format only — callers fetch the CSV (client or server).
 *
 * Source: https://github.com/nflverse/nfldata/raw/master/data/games.csv (CC BY 4.0)
 * Kickoff `gametime` is Eastern; display converts to Pacific.
 * Positive `spread_line` means the home team is favored.
 */

import { splitCsvLine } from "./chart-metric-transforms.js";

export const NFLVERSE_GAMES_CSV_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

/** Browser / react-query cache window — the file updates a few times a day at most. */
export const GAME_LINES_STALE_MS = 6 * 60 * 60 * 1000;

export type NflverseGameRow = {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameday: string;
  weekday: string;
  gametime: string;
  awayTeam: string;
  homeTeam: string;
  location: string;
  awayScore: number | null;
  homeScore: number | null;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  spreadLine: number | null;
  totalLine: number | null;
};

export type GameLineCard = {
  gameId: string;
  matchup: string;
  kickoffPt: string;
  spread: string;
  total: string;
  moneylines: string;
  /** Implied team totals (away / home), or final score once played. */
  totalsOrScore: string;
  awayTeam: string;
  homeTeam: string;
  /** UTC epoch ms; null when kickoff cannot be parsed. */
  kickoffAtMs: number | null;
  isFinal: boolean;
};

const MISSING = "—";

function parseOptionalNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function cell(cells: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return cells[index] ?? "";
}

/** Parse nflverse games.csv into typed rows (all seasons). */
export function parseGamesCsv(csv: string): NflverseGameRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0] ?? "");
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const required = [
    "game_id",
    "season",
    "game_type",
    "week",
    "away_team",
    "home_team",
  ] as const;
  for (const key of required) {
    if (index[key] === undefined) return [];
  }

  const output: NflverseGameRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const season = Number(cell(cells, index.season));
    const week = Number(cell(cells, index.week));
    const awayTeam = cell(cells, index.away_team).trim();
    const homeTeam = cell(cells, index.home_team).trim();
    const gameId = cell(cells, index.game_id).trim();
    if (!gameId || !awayTeam || !homeTeam || !Number.isFinite(season) || !Number.isFinite(week)) {
      continue;
    }
    output.push({
      gameId,
      season,
      gameType: cell(cells, index.game_type).trim(),
      week,
      gameday: cell(cells, index.gameday).trim(),
      weekday: cell(cells, index.weekday).trim(),
      gametime: cell(cells, index.gametime).trim(),
      awayTeam,
      homeTeam,
      location: cell(cells, index.location).trim(),
      awayScore: parseOptionalNumber(cell(cells, index.away_score)),
      homeScore: parseOptionalNumber(cell(cells, index.home_score)),
      awayMoneyline: parseOptionalNumber(cell(cells, index.away_moneyline)),
      homeMoneyline: parseOptionalNumber(cell(cells, index.home_moneyline)),
      spreadLine: parseOptionalNumber(cell(cells, index.spread_line)),
      totalLine: parseOptionalNumber(cell(cells, index.total_line)),
    });
  }
  return output;
}

/** Regular-season (and playoff) rows for one Sleeper season/week. */
export function gamesForSeasonWeek(
  rows: readonly NflverseGameRow[],
  season: number,
  week: number,
): NflverseGameRow[] {
  return rows
    .filter((row) => row.season === season && row.week === week && row.gameType !== "PRE")
    .sort((a, b) => {
      const day = a.gameday.localeCompare(b.gameday);
      if (day !== 0) return day;
      return a.gametime.localeCompare(b.gametime);
    });
}

/**
 * Build a UTC Date for an Eastern wall clock (`gameday` + `gametime`).
 * Returns null when either part is missing or malformed.
 */
export function etWallTimeToUtc(gameday: string, gametime: string): Date | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(gametime.trim());
  if (!dayMatch || !timeMatch) return null;
  const year = Number(dayMatch[1]);
  const month = Number(dayMatch[2]);
  const day = Number(dayMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;
  // Date.UTC rolls invalid days (e.g. Feb 31) into the next month — reject those.
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;

  // Seed near EST (UTC−5), then converge using America/New_York offsets.
  let utcMs = Date.UTC(year, month - 1, day, hour + 5, minute, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find((part) => part.type === type)?.value;
      return value ? Number(value) : Number.NaN;
    };
    const asEt = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
    const target = Date.UTC(year, month - 1, day, hour, minute);
    if (![asEt, target].every(Number.isFinite)) return null;
    const delta = target - asEt;
    utcMs += delta;
    if (delta === 0) break;
  }
  return new Date(utcMs);
}

/** Compact Pacific kickoff label, e.g. `Thu 5:15 PM`. */
export function formatKickoffPt(gameday: string, gametime: string): string {
  const instant = etWallTimeToUtc(gameday, gametime);
  if (!instant) return MISSING;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/**
 * Favorite abbreviation + line. Positive `spreadLine` ⇒ home favored
 * (e.g. home SEA, spread 2.5 → `SEA -2.5`).
 */
export function formatSpreadFavorite(
  awayTeam: string,
  homeTeam: string,
  spreadLine: number | null,
): string {
  if (spreadLine === null || !Number.isFinite(spreadLine)) return MISSING;
  if (spreadLine === 0) return "PK";
  const favorite = spreadLine > 0 ? homeTeam : awayTeam;
  const magnitude = Math.abs(spreadLine);
  const line = Number.isInteger(magnitude) ? String(magnitude) : String(magnitude);
  return `${favorite} -${line}`;
}

export function formatMoneyline(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return MISSING;
  if (value > 0) return `+${Math.round(value)}`;
  return String(Math.round(value));
}

export function formatMoneylines(away: number | null, home: number | null): string {
  if (away === null && home === null) return MISSING;
  return `${formatMoneyline(away)} / ${formatMoneyline(home)}`;
}

export function formatTotalLine(totalLine: number | null): string {
  if (totalLine === null || !Number.isFinite(totalLine)) return MISSING;
  return `O/U ${totalLine}`;
}

/**
 * Implied team totals: `total/2 ± spread/2` with positive spread favoring home.
 * Returns `[away, home]` or null when inputs are missing.
 */
export function impliedTeamTotals(
  totalLine: number | null,
  spreadLine: number | null,
): [number, number] | null {
  if (totalLine === null || spreadLine === null) return null;
  if (!Number.isFinite(totalLine) || !Number.isFinite(spreadLine)) return null;
  const halfTotal = totalLine / 2;
  const halfSpread = spreadLine / 2;
  return [halfTotal - halfSpread, halfTotal + halfSpread];
}

function formatTeamTotalPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Away / home implied totals, or final score once both scores exist. */
export function formatTotalsOrScore(row: Pick<
  NflverseGameRow,
  "awayScore" | "homeScore" | "totalLine" | "spreadLine"
>): string {
  if (row.awayScore !== null && row.homeScore !== null) {
    return `${row.awayScore} / ${row.homeScore}`;
  }
  const implied = impliedTeamTotals(row.totalLine, row.spreadLine);
  if (!implied) return MISSING;
  return `${formatTeamTotalPoints(implied[0])} / ${formatTeamTotalPoints(implied[1])}`;
}

export function formatMatchup(awayTeam: string, homeTeam: string, location: string): string {
  const separator = location.trim().toLowerCase() === "neutral" ? "vs" : "@";
  return `${awayTeam} ${separator} ${homeTeam}`;
}

export function toGameLineCard(row: NflverseGameRow): GameLineCard {
  const kickoff = etWallTimeToUtc(row.gameday, row.gametime);
  return {
    gameId: row.gameId,
    matchup: formatMatchup(row.awayTeam, row.homeTeam, row.location),
    kickoffPt: formatKickoffPt(row.gameday, row.gametime),
    spread: formatSpreadFavorite(row.awayTeam, row.homeTeam, row.spreadLine),
    total: formatTotalLine(row.totalLine),
    moneylines: formatMoneylines(row.awayMoneyline, row.homeMoneyline),
    totalsOrScore: formatTotalsOrScore(row),
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    kickoffAtMs: kickoff?.getTime() ?? null,
    isFinal: row.awayScore !== null && row.homeScore !== null,
  };
}

export function gameLineCardsForWeek(
  csv: string,
  season: number,
  week: number,
): GameLineCard[] {
  return gamesForSeasonWeek(parseGamesCsv(csv), season, week).map(toGameLineCard);
}

/** Align Sleeper / sportsbook abbreviations with nflverse team codes. */
export function normalizeGameLineTeam(team: string): string {
  const normalized = team.trim().toUpperCase();
  if (normalized === "JAC") return "JAX";
  if (normalized === "LA") return "LAR";
  if (normalized === "LVR" || normalized === "OAK") return "LV";
  if (normalized === "WSH") return "WAS";
  return normalized;
}

function gameInvolvesTeams(card: GameLineCard, teams: ReadonlySet<string>): boolean {
  return teams.has(normalizeGameLineTeam(card.awayTeam))
    || teams.has(normalizeGameLineTeam(card.homeTeam));
}

function byKickoffAscending(left: GameLineCard, right: GameLineCard): number {
  return (left.kickoffAtMs ?? Number.POSITIVE_INFINITY) - (right.kickoffAtMs ?? Number.POSITIVE_INFINITY);
}

/**
 * Default Monitor game: live roster matchup, else next/soonest roster game,
 * else first upcoming week game, else the first card.
 */
/** Picker sentinel for listing every current-week prop. */
export const ALL_GAMES_PICKER_ID = "__all_games__";

export type CoverRecord = {
  wins: number;
  losses: number;
  pushes: number;
};

export type TeamSeasonRecords = {
  team: string;
  games: number;
  ats: CoverRecord;
  ou: CoverRecord;
};

function emptyCover(): CoverRecord {
  return { wins: 0, losses: 0, pushes: 0 };
}

function addCover(record: CoverRecord, result: "win" | "loss" | "push"): void {
  if (result === "win") record.wins += 1;
  else if (result === "loss") record.losses += 1;
  else record.pushes += 1;
}

export function formatCoverRecord(record: CoverRecord): string {
  if (record.wins + record.losses + record.pushes <= 0) return MISSING;
  if (record.pushes > 0) return `${record.wins}-${record.losses}-${record.pushes}`;
  return `${record.wins}-${record.losses}`;
}

/** Completed regular-season games for `season` with both scores present. */
export function completedSeasonGames(
  rows: readonly NflverseGameRow[],
  season: number,
  throughWeekExclusive?: number,
): NflverseGameRow[] {
  return rows.filter((row) => {
    if (row.season !== season || row.gameType !== "REG") return false;
    if (row.awayScore === null || row.homeScore === null) return false;
    if (throughWeekExclusive !== undefined && row.week >= throughWeekExclusive) return false;
    return true;
  });
}

/**
 * Home covers when (homeScore - awayScore) > spreadLine.
 * nflverse / this codebase: positive `spreadLine` means the home team is
 * favored (e.g. home -8.5 ⇒ spreadLine = +8.5). Do not invert the sign.
 */
export function homeSpreadResult(
  homeScore: number,
  awayScore: number,
  spreadLine: number,
): "win" | "loss" | "push" {
  const margin = homeScore - awayScore;
  if (margin > spreadLine) return "win";
  if (margin < spreadLine) return "loss";
  return "push";
}

export function totalResult(
  homeScore: number,
  awayScore: number,
  totalLine: number,
): "win" | "loss" | "push" {
  const points = homeScore + awayScore;
  if (points > totalLine) return "win";
  if (points < totalLine) return "loss";
  return "push";
}

/** ATS / O-U records from completed games. For team O/U records, "win" = game went over. */
export function buildTeamSeasonRecords(
  rows: readonly NflverseGameRow[],
  season: number,
  throughWeekExclusive?: number,
): Map<string, TeamSeasonRecords> {
  const games = completedSeasonGames(rows, season, throughWeekExclusive);
  const ats = new Map<string, CoverRecord>();
  const ou = new Map<string, CoverRecord>();
  const played = new Map<string, number>();

  for (const game of games) {
    if (game.awayScore === null || game.homeScore === null) continue;
    const away = normalizeGameLineTeam(game.awayTeam);
    const home = normalizeGameLineTeam(game.homeTeam);
    played.set(away, (played.get(away) ?? 0) + 1);
    played.set(home, (played.get(home) ?? 0) + 1);
    if (!ats.has(away)) ats.set(away, emptyCover());
    if (!ats.has(home)) ats.set(home, emptyCover());
    if (!ou.has(away)) ou.set(away, emptyCover());
    if (!ou.has(home)) ou.set(home, emptyCover());

    if (game.spreadLine !== null && Number.isFinite(game.spreadLine)) {
      const homeAts = homeSpreadResult(game.homeScore, game.awayScore, game.spreadLine);
      addCover(ats.get(home)!, homeAts);
      addCover(
        ats.get(away)!,
        homeAts === "win" ? "loss" : homeAts === "loss" ? "win" : "push",
      );
    }
    if (game.totalLine !== null && Number.isFinite(game.totalLine)) {
      const ouResult = totalResult(game.homeScore, game.awayScore, game.totalLine);
      addCover(ou.get(home)!, ouResult);
      addCover(ou.get(away)!, ouResult);
    }
  }

  const output = new Map<string, TeamSeasonRecords>();
  for (const team of played.keys()) {
    output.set(team, {
      team,
      games: played.get(team) ?? 0,
      ats: ats.get(team) ?? emptyCover(),
      ou: ou.get(team) ?? emptyCover(),
    });
  }
  return output;
}

export function defaultGameLineCardId(
  cards: readonly GameLineCard[],
  rosterTeams: readonly string[],
  liveTeams: readonly string[],
  nowMs: number,
): string | null {
  if (cards.length === 0) return null;
  const roster = new Set(
    rosterTeams.map(normalizeGameLineTeam).filter((team) => team.length > 0),
  );
  const live = new Set(
    liveTeams.map(normalizeGameLineTeam).filter((team) => team.length > 0),
  );

  const liveRoster = cards.find((card) => !card.isFinal && gameInvolvesTeams(card, live));
  if (liveRoster) return liveRoster.gameId;

  const nonFinalRoster = cards
    .filter((card) => !card.isFinal && gameInvolvesTeams(card, roster))
    .slice()
    .sort(byKickoffAscending);
  const upcomingRoster = nonFinalRoster.find(
    (card) => card.kickoffAtMs === null || card.kickoffAtMs >= nowMs,
  );
  if (upcomingRoster) return upcomingRoster.gameId;
  if (nonFinalRoster[0]) return nonFinalRoster[0].gameId;

  const nonFinal = cards.filter((card) => !card.isFinal).slice().sort(byKickoffAscending);
  const upcoming = nonFinal.find(
    (card) => card.kickoffAtMs === null || card.kickoffAtMs >= nowMs,
  );
  if (upcoming) return upcoming.gameId;
  if (nonFinal[0]) return nonFinal[0].gameId;

  return cards[0]?.gameId ?? null;
}
