import { describe, expect, it } from "vitest";
import {
  chunkPlayerValueSnapshots,
  compactPlayerValueSnapshot,
  dailySnapshotRowsFromPreset,
  dedupePlayerValueSnapshotsById,
  fantasyCalcHistoryUrl,
  formatDbError,
  historySnapshotRowsFromPoints,
  parseFantasyCalcHistoryDate,
  playerValueSnapshotId,
  rankedPlayersFromFantasyCalcRows,
  utcDateKey,
  VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT,
  VALUE_HISTORY_BACKFILL_MAX_LIMIT,
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
  it("parses US M/D/YYYY as UTC midnight", () => {
    const date = parseFantasyCalcHistoryDate("01/15/2026");
    expect(date?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseFantasyCalcHistoryDate("02/31/2026")).toBeNull();
    expect(parseFantasyCalcHistoryDate("not-a-date")).toBeNull();
    expect(parseFantasyCalcHistoryDate("")).toBeNull();
  });
});

describe("compactPlayerValueSnapshot", () => {
  it("builds a compact PK row and rounds value", () => {
    const capturedAt = new Date("2026-10-12T15:00:00.000Z");
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "Jahmyr Gibbs",
        position: "RB",
        value: 10511.6,
        capturedAt,
      }),
    ).toEqual({
      id: "2026-10-12:redraft-1qb-12t-0.5ppr:9221",
      snapshotDate: "2026-10-12",
      formatKey: "redraft-1qb-12t-0.5ppr",
      playerId: "9221",
      playerName: "Jahmyr Gibbs",
      position: "RB",
      value: 10512,
      capturedAt,
    });
  });

  it("skips picks and incomplete players", () => {
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
        capturedAt: asOf,
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
    ]);
    expect(ranked).toEqual([
      { fantasyCalcId: 1, playerId: "a", playerName: "A", position: "QB" },
      { fantasyCalcId: 4, playerId: "c", playerName: "C", position: "WR" },
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
  it("surfaces nested Postgres cause details from a Failed query wrapper", () => {
    const cause = Object.assign(new Error("cannot affect row a second time"), {
      code: "21000",
      detail: "Row with id=x appears twice",
    });
    const wrapped = Object.assign(new Error("Failed query: insert into \"player_value_snapshots\""), { cause });
    expect(formatDbError(wrapped)).toContain("cannot affect row a second time");
    expect(formatDbError(wrapped)).toContain("21000");
  });
});
