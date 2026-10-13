import { describe, expect, it } from "vitest";
import {
  chunkPlayerValueSnapshots,
  coerceFiniteNumber,
  compactPlayerValueSnapshot,
  dailySnapshotRowsFromPreset,
  dedupePlayerValueSnapshotsById,
  fantasyCalcHistoryUrl,
  formatDbError,
  historySnapshotRowsFromPoints,
  isValidSnapshotDateKey,
  parseFantasyCalcHistoryDate,
  playerValueSnapshotId,
  rankedPlayersFromFantasyCalcRows,
  utcDateKey,
  VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT,
  VALUE_HISTORY_BACKFILL_MAX_LIMIT,
  VALUE_HISTORY_MIN_YEAR,
  VALUE_HISTORY_UPSERT_CHUNK,
  type PlayerValueSnapshotRow,
} from "./player-value-history.js";
import type { FantasyCalcRow } from "./sleeper.js";

function snapshotRow(id: string, value: number): PlayerValueSnapshotRow {
  return {
    id,
    snapshotDate: "2026-10-12",
    formatKey: "redraft-1qb-12t-0.5ppr",
    playerId: "9221",
    playerName: "Jahmyr Gibbs",
    position: "RB",
    value,
    capturedAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

describe("parseFantasyCalcHistoryDate", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");

  it("parses US M/D/YYYY as UTC midnight", () => {
    const date = parseFantasyCalcHistoryDate("01/15/2026", now);
    expect(date?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("rejects impossible calendar dates and non 4-digit years", () => {
    expect(parseFantasyCalcHistoryDate("02/31/2026", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("not-a-date", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("1/7/26", now)).toBeNull();
  });

  it("rejects absurd years that would serialize as +0NNNNN ISO timestamps", () => {
    expect(parseFantasyCalcHistoryDate("01/07/12600", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("06/22/2361", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("1/24/202026", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("01/01/2024", now)).toBeNull();
    expect(VALUE_HISTORY_MIN_YEAR).toBe(2025);
  });
});

describe("isValidSnapshotDateKey", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");

  it("accepts YYYY-MM-DD inside the history window", () => {
    expect(isValidSnapshotDateKey("2026-01-07", now)).toBe(true);
    expect(isValidSnapshotDateKey("2361-06-22", now)).toBe(false);
    expect(isValidSnapshotDateKey("2026-13-01", now)).toBe(false);
    expect(isValidSnapshotDateKey("01/07/2026", now)).toBe(false);
  });
});

describe("coerceFiniteNumber", () => {
  it("accepts finite numbers and numeric strings", () => {
    expect(coerceFiniteNumber(10511.6)).toBe(10511.6);
    expect(coerceFiniteNumber("9500.4")).toBe(9500.4);
    expect(coerceFiniteNumber(Number.NaN)).toBeNull();
    expect(coerceFiniteNumber("")).toBeNull();
    expect(coerceFiniteNumber(null)).toBeNull();
  });
});

describe("compactPlayerValueSnapshot", () => {
  it("builds a compact PK row and rounds decimal values to integers", () => {
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "Jahmyr Gibbs",
        position: "RB",
        value: 10511.6,
        capturedAt: new Date("2026-10-12T15:00:00.000Z"),
      }),
    ).toEqual({
      id: "2026-10-12:redraft-1qb-12t-0.5ppr:9221",
      snapshotDate: "2026-10-12",
      formatKey: "redraft-1qb-12t-0.5ppr",
      playerId: "9221",
      playerName: "Jahmyr Gibbs",
      position: "RB",
      value: 10512,
      capturedAt: new Date("2026-10-12T00:00:00.000Z"),
    });
  });

  it("fills nullish name/position with empty strings and skips non-finite values", () => {
    const capturedAt = new Date("2026-10-12T00:00:00.000Z");
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: null,
        position: undefined,
        value: "100.4",
        capturedAt,
      }),
    ).toEqual({
      id: "2026-10-12:redraft-1qb-12t-0.5ppr:9221",
      snapshotDate: "2026-10-12",
      formatKey: "redraft-1qb-12t-0.5ppr",
      playerId: "9221",
      playerName: "",
      position: "",
      value: 100,
      capturedAt,
    });
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "X",
        position: "WR",
        value: Number.NaN,
        capturedAt,
      }),
    ).toBeNull();
  });

  it("skips picks and missing player ids", () => {
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "dynasty-2qb-12t-1ppr",
        playerId: "pick-1",
        playerName: "2027 Mid",
        position: "PICK",
        value: 4000,
        capturedAt: new Date(),
      }),
    ).toBeNull();
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "",
        playerName: "Nobody",
        position: "WR",
        value: 100,
        capturedAt: new Date(),
      }),
    ).toBeNull();
  });
});

describe("dailySnapshotRowsFromPreset", () => {
  it("maps ranked FantasyCalc rows for one UTC day", () => {
    const asOf = new Date("2026-10-12T18:30:00.000Z");
    const rows: FantasyCalcRow[] = [
      {
        player: { id: 1, sleeperId: "9221", name: "Jahmyr Gibbs", position: "RB" },
        value: 10511,
      },
      {
        player: { id: 2, sleeperId: "pick", name: "2027 Mid", position: "PICK" },
        value: 3000,
      },
      {
        player: { id: 3, sleeperId: null, name: "No Sleeper", position: "WR" },
        value: 1000,
      },
    ];
    expect(dailySnapshotRowsFromPreset("redraft-1qb-12t-0.5ppr", rows, asOf)).toEqual([
      {
        id: playerValueSnapshotId("2026-10-12", "redraft-1qb-12t-0.5ppr", "9221"),
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "Jahmyr Gibbs",
        position: "RB",
        value: 10511,
        capturedAt: new Date("2026-10-12T00:00:00.000Z"),
      },
    ]);
    expect(utcDateKey(asOf)).toBe("2026-10-12");
  });
});

describe("historySnapshotRowsFromPoints", () => {
  it("keeps full history when minSnapshotDate is null and filters when set", () => {
    const points = [
      { date: "01/01/2026", value: 9000 },
      { date: "03/15/2026", value: 9500.4 },
      { date: "10/12/2026", value: 10511 },
      { date: "bad", value: 1 },
      { date: "10/13/2026", value: undefined },
      { date: "01/07/12600", value: 50 },
      { date: "6/22/2361", value: 0 },
    ];
    const all = historySnapshotRowsFromPoints({
      formatKey: "dynasty-2qb-12t-1ppr",
      playerId: "4046",
      playerName: "Justin Jefferson",
      position: "WR",
      points,
      minSnapshotDate: null,
    });
    expect(all.map((row) => row.snapshotDate)).toEqual(["2026-01-01", "2026-03-15", "2026-10-12"]);
    expect(all[1]?.value).toBe(9500);
    expect(all.every((row) => row.capturedAt.toISOString().startsWith(row.snapshotDate))).toBe(true);

    const recent = historySnapshotRowsFromPoints({
      formatKey: "dynasty-2qb-12t-1ppr",
      playerId: "4046",
      playerName: "Justin Jefferson",
      position: "WR",
      points,
      minSnapshotDate: "2026-03-01",
    });
    expect(recent.map((row) => row.snapshotDate)).toEqual(["2026-03-15", "2026-10-12"]);
  });
});

describe("rankedPlayersFromFantasyCalcRows", () => {
  it("dedupes sleeper ids and drops picks", () => {
    const ranked = rankedPlayersFromFantasyCalcRows([
      { player: { id: 1, sleeperId: "a", name: "A", position: "QB" } },
      { player: { id: 2, sleeperId: "a", name: "A again", position: "QB" } },
      { player: { id: 3, sleeperId: "b", name: "Pick", position: "PICK" } },
      { player: { id: 4, sleeperId: "c", name: "C", position: "WR" } },
      { player: { id: 5, sleeperId: "d", name: undefined, position: "" } },
    ]);
    expect(ranked).toEqual([
      { fantasyCalcId: 1, playerId: "a", playerName: "A", position: "QB" },
      { fantasyCalcId: 4, playerId: "c", playerName: "C", position: "WR" },
      { fantasyCalcId: 5, playerId: "d", playerName: "", position: "" },
    ]);
  });
});

describe("fantasyCalcHistoryUrl", () => {
  it("encodes format query params", () => {
    expect(
      fantasyCalcHistoryUrl(
        {
          key: "dynasty-2qb-12t-0.5ppr",
          isDynasty: true,
          numQbs: 2,
          numTeams: 12,
          ppr: 0.5,
          label: "test",
        },
        9821,
      ),
    ).toBe("https://api.fantasycalc.com/trades/implied/9821?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5");
  });
});

describe("backfill batch sizing constants", () => {
  it("keeps default under the max Vercel-friendly cap", () => {
    expect(VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT).toBeLessThanOrEqual(VALUE_HISTORY_BACKFILL_MAX_LIMIT);
    expect(VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT).toBeGreaterThan(0);
  });

  it("keeps upsert chunks under the Postgres bind-parameter budget", () => {
    const columnsPerRow = 8;
    expect(VALUE_HISTORY_UPSERT_CHUNK * columnsPerRow).toBeLessThan(65_535);
    expect(VALUE_HISTORY_UPSERT_CHUNK).toBe(1000);
  });
});

describe("dedupePlayerValueSnapshotsById", () => {
  it("keeps the last row for duplicate ids", () => {
    const deduped = dedupePlayerValueSnapshotsById([
      snapshotRow("2026-10-12:redraft-1qb-12t-0.5ppr:9221", 100),
      snapshotRow("2026-10-11:redraft-1qb-12t-0.5ppr:9221", 90),
      snapshotRow("2026-10-12:redraft-1qb-12t-0.5ppr:9221", 105),
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((row) => row.id.startsWith("2026-10-12"))?.value).toBe(105);
    expect(deduped.find((row) => row.id.startsWith("2026-10-11"))?.value).toBe(90);
  });
});

describe("chunkPlayerValueSnapshots", () => {
  it("splits deduped rows into fixed-size insert batches", () => {
    const rows = Array.from({ length: 2505 }, (_, index) =>
      snapshotRow(`2026-01-${String((index % 28) + 1).padStart(2, "0")}:fmt:p${index}`, index),
    );
    const chunks = chunkPlayerValueSnapshots(rows, 1000);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 505]);
    expect(chunks.flat()).toHaveLength(rows.length);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkPlayerValueSnapshots([])).toEqual([]);
  });
});

describe("formatDbError", () => {
  it("logs only cause code/message and never the Failed query SQL wrapper", () => {
    const cause = Object.assign(new Error("invalid input syntax for type integer: \"10511.6\""), {
      code: "22P02",
    });
    const wrapped = Object.assign(
      new Error('Failed query: insert into "player_value_snapshots" (id, snapshot_date, format_key, player_id, player_name, position, value, captured_at) values ...'),
      { cause },
    );
    expect(formatDbError(wrapped)).toBe('code=22P02 | invalid input syntax for type integer: "10511.6"');
    expect(formatDbError(wrapped)).not.toContain("Failed query");
    expect(formatDbError(wrapped)).not.toContain("player_value_snapshots");
    expect(formatDbError(new Error("Failed query: insert into x"))).toBe("unknown database error");
  });
});
