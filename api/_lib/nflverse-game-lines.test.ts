import { describe, expect, it } from "vitest";
import {
  etWallTimeToUtc,
  formatKickoffPt,
  formatMatchup,
  formatMoneyline,
  formatMoneylines,
  formatSpreadFavorite,
  formatTotalLine,
  formatTotalsOrScore,
  gameLineCardsForWeek,
  gamesForSeasonWeek,
  impliedTeamTotals,
  parseGamesCsv,
  toGameLineCard,
} from "./nflverse-game-lines.js";

const HEADER =
  "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location,result,total,overtime,old_game_id,gsis,nfl_detail_id,pfr,pff,espn,ftn,away_rest,home_rest,away_moneyline,home_moneyline,spread_line,away_spread_odds,home_spread_odds,total_line,under_odds,over_odds,div_game,roof,surface,temp,wind,away_qb_id,home_qb_id,away_qb_name,home_qb_name,away_coach,home_coach,referee,stadium_id,stadium";

/** Build a 46-column games.csv row; later trailing fields may be omitted as empty. */
function gameRow(fields: {
  gameId: string;
  season: number;
  gameType?: string;
  week: number;
  gameday: string;
  weekday: string;
  gametime: string;
  away: string;
  home: string;
  location?: string;
  awayScore?: string;
  homeScore?: string;
  awayMl?: string;
  homeMl?: string;
  spread?: string;
  total?: string;
}): string {
  const cells = Array.from({ length: 46 }, () => "");
  cells[0] = fields.gameId;
  cells[1] = String(fields.season);
  cells[2] = fields.gameType ?? "REG";
  cells[3] = String(fields.week);
  cells[4] = fields.gameday;
  cells[5] = fields.weekday;
  cells[6] = fields.gametime;
  cells[7] = fields.away;
  cells[8] = fields.awayScore ?? "";
  cells[9] = fields.home;
  cells[10] = fields.homeScore ?? "";
  cells[11] = fields.location ?? "Home";
  cells[24] = fields.awayMl ?? "";
  cells[25] = fields.homeMl ?? "";
  cells[26] = fields.spread ?? "";
  cells[29] = fields.total ?? "";
  return cells.join(",");
}

const SAMPLE_CSV = [
  HEADER,
  gameRow({
    gameId: "2026_06_SEA_DEN", season: 2026, week: 6,
    gameday: "2026-10-15", weekday: "Thursday", gametime: "20:15",
    away: "SEA", home: "DEN", awayMl: "-148", homeMl: "124", spread: "-2.5", total: "40.5",
  }),
  gameRow({
    gameId: "2026_06_HOU_JAX", season: 2026, week: 6,
    gameday: "2026-10-18", weekday: "Sunday", gametime: "09:30",
    away: "HOU", home: "JAX", location: "Neutral",
    awayMl: "124", homeMl: "-148", spread: "3", total: "42.5",
  }),
  gameRow({
    gameId: "2026_06_TEN_IND", season: 2026, week: 6,
    gameday: "2026-10-18", weekday: "Sunday", gametime: "13:00",
    away: "TEN", home: "IND", awayMl: "260", homeMl: "-325", spread: "7", total: "44.5",
  }),
  gameRow({
    gameId: "2026_05_DAL_PHI", season: 2026, week: 5,
    gameday: "2026-10-05", weekday: "Sunday", gametime: "13:00",
    away: "DAL", home: "PHI", awayScore: "20", homeScore: "24",
    awayMl: "330", homeMl: "-425", spread: "8.5", total: "47.5",
  }),
  gameRow({
    gameId: "2026_06_PRE_X", season: 2026, gameType: "PRE", week: 6,
    gameday: "2026-10-15", weekday: "Thursday", gametime: "20:00",
    away: "AAA", home: "BBB", awayMl: "-110", homeMl: "-110", spread: "3", total: "40",
  }),
  gameRow({
    gameId: "2025_06_OLD", season: 2025, week: 6,
    gameday: "2025-10-12", weekday: "Sunday", gametime: "13:00",
    away: "KC", home: "LAC", awayMl: "-110", homeMl: "-110", spread: "3", total: "40",
  }),
  gameRow({
    gameId: "2026_06_NO_LINES", season: 2026, week: 6,
    gameday: "2026-10-19", weekday: "Monday", gametime: "20:15",
    away: "WAS", home: "SF",
  }),
].join("\n");

describe("parseGamesCsv", () => {
  it("parses season week rows and optional numeric fields", () => {
    const rows = parseGamesCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(7);
    const sea = rows.find((row) => row.gameId === "2026_06_SEA_DEN");
    expect(sea).toMatchObject({
      season: 2026,
      week: 6,
      awayTeam: "SEA",
      homeTeam: "DEN",
      location: "Home",
      awayMoneyline: -148,
      homeMoneyline: 124,
      spreadLine: -2.5,
      totalLine: 40.5,
      awayScore: null,
      homeScore: null,
    });
  });

  it("returns empty for missing required headers", () => {
    expect(parseGamesCsv("foo,bar\n1,2")).toEqual([]);
  });
});

describe("gamesForSeasonWeek", () => {
  it("filters to the requested season/week and skips preseason", () => {
    const rows = gamesForSeasonWeek(parseGamesCsv(SAMPLE_CSV), 2026, 6);
    expect(rows.map((row) => row.gameId)).toEqual([
      "2026_06_SEA_DEN",
      "2026_06_HOU_JAX",
      "2026_06_TEN_IND",
      "2026_06_NO_LINES",
    ]);
  });
});

describe("ET → PT kickoff", () => {
  it("converts Thursday night ET to Thursday afternoon PT", () => {
    const utc = etWallTimeToUtc("2026-10-15", "20:15");
    expect(utc).not.toBeNull();
    // 20:15 ET in mid-October is EDT (UTC−4) → 00:15 UTC next day → 5:15 PM PT.
    expect(utc!.toISOString()).toBe("2026-10-16T00:15:00.000Z");
    expect(formatKickoffPt("2026-10-15", "20:15")).toBe("Thu 5:15 PM");
  });

  it("converts early London kickoff ET to morning PT", () => {
    expect(formatKickoffPt("2026-10-18", "09:30")).toBe("Sun 6:30 AM");
  });

  it("returns — when gameday or gametime is missing", () => {
    expect(formatKickoffPt("", "13:00")).toBe("—");
    expect(formatKickoffPt("2026-10-18", "")).toBe("—");
    expect(etWallTimeToUtc("2026-13-40", "99:99")).toBeNull();
  });
});

describe("spread favorite formatting", () => {
  it("uses home team when spread_line is positive", () => {
    expect(formatSpreadFavorite("TEN", "IND", 7)).toBe("IND -7");
    expect(formatSpreadFavorite("HOU", "JAX", 3)).toBe("JAX -3");
    expect(formatSpreadFavorite("DAL", "PHI", 8.5)).toBe("PHI -8.5");
  });

  it("uses away team when spread_line is negative", () => {
    expect(formatSpreadFavorite("SEA", "DEN", -2.5)).toBe("SEA -2.5");
  });

  it("handles pick'em and missing lines", () => {
    expect(formatSpreadFavorite("SEA", "DEN", 0)).toBe("PK");
    expect(formatSpreadFavorite("SEA", "DEN", null)).toBe("—");
  });
});

describe("implied team totals", () => {
  it("splits total/2 ± spread/2 with home on the plus side of positive spread", () => {
    expect(impliedTeamTotals(47.5, 8.5)).toEqual([19.5, 28]);
    expect(impliedTeamTotals(40.5, -2.5)).toEqual([21.5, 19]);
    expect(impliedTeamTotals(44.5, 7)).toEqual([18.75, 25.75]);
  });

  it("returns null when either input is missing", () => {
    expect(impliedTeamTotals(null, 3)).toBeNull();
    expect(impliedTeamTotals(40, null)).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats moneylines, totals, and matchups", () => {
    expect(formatMoneyline(-148)).toBe("-148");
    expect(formatMoneyline(124)).toBe("+124");
    expect(formatMoneyline(null)).toBe("—");
    expect(formatMoneylines(-148, 124)).toBe("-148 / +124");
    expect(formatMoneylines(null, null)).toBe("—");
    expect(formatTotalLine(40.5)).toBe("O/U 40.5");
    expect(formatTotalLine(null)).toBe("—");
    expect(formatMatchup("SEA", "DEN", "Home")).toBe("SEA @ DEN");
    expect(formatMatchup("HOU", "JAX", "Neutral")).toBe("HOU vs JAX");
  });

  it("shows final score in place of implied totals once played", () => {
    expect(formatTotalsOrScore({
      awayScore: 20,
      homeScore: 24,
      totalLine: 47.5,
      spreadLine: 8.5,
    })).toBe("20 / 24");
    expect(formatTotalsOrScore({
      awayScore: null,
      homeScore: null,
      totalLine: 40.5,
      spreadLine: -2.5,
    })).toBe("21.5 / 19");
    expect(formatTotalsOrScore({
      awayScore: null,
      homeScore: null,
      totalLine: null,
      spreadLine: null,
    })).toBe("—");
  });
});

describe("gameLineCardsForWeek", () => {
  it("builds compact cards for the current week", () => {
    const cards = gameLineCardsForWeek(SAMPLE_CSV, 2026, 6);
    expect(cards[0]).toEqual({
      gameId: "2026_06_SEA_DEN",
      matchup: "SEA @ DEN",
      kickoffPt: "Thu 5:15 PM",
      spread: "SEA -2.5",
      total: "O/U 40.5",
      moneylines: "-148 / +124",
      totalsOrScore: "21.5 / 19",
    });
    expect(cards.find((card) => card.gameId === "2026_06_HOU_JAX")?.matchup).toBe("HOU vs JAX");
    expect(cards.find((card) => card.gameId === "2026_06_NO_LINES")).toMatchObject({
      spread: "—",
      total: "—",
      moneylines: "—",
      totalsOrScore: "—",
    });
    const played = toGameLineCard(parseGamesCsv(SAMPLE_CSV).find((row) => row.gameId === "2026_05_DAL_PHI")!);
    expect(played.totalsOrScore).toBe("20 / 24");
    expect(played.spread).toBe("PHI -8.5");
  });
});
