import { describe, expect, it } from "vitest";
import {
  htmlCellText,
  parseSituationalPercentage,
  parseTeamSituationalStats,
  sportsTeamCodes,
} from "./team-situational.js";

function row(cells: string[]): string {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function padCells(team: string, games: number, thirdDown: string, redZone: string): string[] {
  const cells = Array.from({ length: 15 }, () => "0");
  cells[0] = team;
  cells[1] = String(games);
  cells[8] = thirdDown;
  cells[14] = redZone;
  return cells;
}

describe("parseTeamSituationalStats", () => {
  it("reads third-down % from cells[8] and red-zone TD % from cells[14]", () => {
    const html = `<table>${row(padCells("Kansas City Chiefs", 8, "48.2%", "61.5%"))}${row(padCells("Buffalo Bills", 8, "44.0", "55"))}</table>`;
    const rows = parseTeamSituationalStats(html);
    expect(rows).toEqual([
      { team: "BUF", games: 8, thirdDownPct: 44, redZoneTdPct: 55 },
      { team: "KC", games: 8, thirdDownPct: 48.2, redZoneTdPct: 61.5 },
    ]);
  });

  it("skips header rows and incomplete tables", () => {
    const html = `
      <table>
        ${row(["Team", "G", "a", "b", "c", "d", "e", "f", "3rd%", "g", "h", "i", "j", "k", "RZ%"])}
        ${row(padCells("Seattle Seahawks", 7, "41.1%", "50.0%").slice(0, 10))}
        ${row(padCells("Unknown Franchise", 7, "40%", "40%"))}
        ${row(padCells("SEA", 7, "101%", "50%"))}
        ${row(padCells("Seattle Seahawks", 7, "41.1%", "50.0%"))}
      </table>
    `;
    expect(parseTeamSituationalStats(html)).toEqual([
      { team: "SEA", games: 7, thirdDownPct: 41.1, redZoneTdPct: 50 },
    ]);
  });

  it("dedupes by team code keeping the last parsed row", () => {
    const html = `<table>${row(padCells("Detroit Lions", 6, "40%", "40%"))}${row(padCells("DET", 7, "42%", "45%"))}</table>`;
    expect(parseTeamSituationalStats(html)).toEqual([
      { team: "DET", games: 7, thirdDownPct: 42, redZoneTdPct: 45 },
    ]);
  });
});

describe("sportsTeamCodes", () => {
  it("maps nicknames and abbreviations", () => {
    expect(sportsTeamCodes("Green Bay Packers")).toEqual(["GB"]);
    expect(sportsTeamCodes("JAC")).toEqual(["JAX"]);
    expect(sportsTeamCodes("WSH")).toEqual(["WAS"]);
  });
});

describe("html helpers", () => {
  it("strips markup and entities", () => {
    expect(htmlCellText("<b>48.2&nbsp;%</b>")).toBe("48.2 %");
  });

  it("rejects out-of-range percentages", () => {
    expect(parseSituationalPercentage("-1")).toBeNull();
    expect(parseSituationalPercentage("100.1")).toBeNull();
    expect(parseSituationalPercentage("50%")).toBe(50);
  });
});
