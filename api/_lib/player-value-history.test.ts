import { describe, expect, it, vi } from "vitest";
import {
  chunkPlayerValueSnapshots,
  coerceFiniteNumber,
  compactPlayerValueSnapshot,
  CorruptFantasyCalcHistoryError,
  dailySnapshotRowsFromPreset,
  dedupePlayerValueSnapshotsById,
  fantasyCalcHistoryUrl,
  fetchValidatedFantasyCalcHistory,
  formatDbError,
  historySnapshotRowsFromPoints,
  isAcceptableSnapshotDateKey,
  isAcceptableValueHistoryInstant,
  isRetryableHistoryFetchError,
  isValidFantasyCalcHistorySequence,
  parseFantasyCalcHistoryDate,
  playerValueSnapshotId,
  rankedPlayersFromFantasyCalcRows,
  resolveFantasyCalcSnapshotFormatKey,
  utcDateKey,
  DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY,
  VALUE_HISTORY_BACKFILL_CONCURRENCY,
  VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT,
  VALUE_HISTORY_BACKFILL_MAX_LIMIT,
  VALUE_HISTORY_BACKFILL_REQUEST_DELAY_MS,
  VALUE_HISTORY_FETCH_BACKOFF_MS,
  VALUE_HISTORY_FETCH_MAX_ATTEMPTS,
  VALUE_HISTORY_MIN_SNAPSHOT_DATE,
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

describe("utcDateKey", () => {
  it("formats UTC calendar dates without Date#toISOString", () => {
    expect(utcDateKey(new Date(Date.UTC(2026, 9, 12)))).toBe("2026-10-12");
    expect(utcDateKey(new Date(Date.UTC(2015, 0, 1)))).toBe("2015-01-01");
  });
});

describe("isAcceptableValueHistoryInstant / isAcceptableSnapshotDateKey", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("accepts dates on/after 2015-01-01 and within one day ahead", () => {
    expect(isAcceptableValueHistoryInstant(new Date("2015-01-01T00:00:00.000Z"), now)).toBe(true);
    expect(isAcceptableValueHistoryInstant(new Date("2026-10-13T12:00:00.000Z"), now)).toBe(true);
    expect(isAcceptableValueHistoryInstant(new Date("2026-10-14T11:59:59.000Z"), now)).toBe(true);
    expect(isAcceptableSnapshotDateKey("2026-10-13", now)).toBe(true);
    expect(isAcceptableSnapshotDateKey(VALUE_HISTORY_MIN_SNAPSHOT_DATE, now)).toBe(true);
  });

  it("rejects invalid, pre-2015, and >1 day future instants", () => {
    expect(isAcceptableValueHistoryInstant(new Date(Number.NaN), now)).toBe(false);
    expect(isAcceptableValueHistoryInstant(new Date("2014-12-31T00:00:00.000Z"), now)).toBe(false);
    expect(isAcceptableValueHistoryInstant(new Date("2026-10-14T12:00:01.000Z"), now)).toBe(false);
    expect(isAcceptableValueHistoryInstant(new Date(Date.UTC(12600, 0, 7)), now)).toBe(false);
    expect(isAcceptableSnapshotDateKey("2014-12-31", now)).toBe(false);
    expect(isAcceptableSnapshotDateKey("2026-10-15", now)).toBe(false);
    expect(isAcceptableSnapshotDateKey("not-a-date", now)).toBe(false);
    expect(isAcceptableSnapshotDateKey("2026-02-31", now)).toBe(false);
  });
});

describe("parseFantasyCalcHistoryDate", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");

  it("parses US M/D/YYYY as UTC midnight", () => {
    const date = parseFantasyCalcHistoryDate("01/15/2026", now);
    expect(date?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("rejects impossible calendar dates and non-4-digit years", () => {
    expect(parseFantasyCalcHistoryDate("02/31/2026", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("not-a-date", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("1/7/12600", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("01/07/26", now)).toBeNull();
    // Scrambled FantasyCalc concurrency artifacts
    expect(parseFantasyCalcHistoryDate("10/05/2194", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("12/02/1969", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("02/11/20262026", now)).toBeNull();
  });

  it("rejects dates before 2015-01-01 and more than one day ahead", () => {
    expect(parseFantasyCalcHistoryDate("12/31/2014", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("01/01/2015", now)?.toISOString()).toBe("2015-01-01T00:00:00.000Z");
    expect(parseFantasyCalcHistoryDate("10/15/2026", now)).toBeNull();
    expect(parseFantasyCalcHistoryDate("01/07/2361", now)).toBeNull();
  });
});

describe("isValidFantasyCalcHistorySequence", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("accepts empty arrays and consecutive daily sequences", () => {
    expect(isValidFantasyCalcHistorySequence([], now)).toBe(true);
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/01/2026", value: 9000 },
          { date: "01/02/2026", value: 9050 },
          { date: "01/03/2026", value: 9100 },
        ],
        now,
      ),
    ).toBe(true);
  });

  it("rejects gaps, repeats, out-of-order, and out-of-window dates", () => {
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/01/2026", value: 1 },
          { date: "01/03/2026", value: 2 },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/01/2026", value: 1 },
          { date: "01/01/2026", value: 2 },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/02/2026", value: 1 },
          { date: "01/01/2026", value: 2 },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/01/2026", value: 1 },
          { date: "10/05/2194", value: 2 },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      isValidFantasyCalcHistorySequence([{ date: "bad", value: 1 }], now),
    ).toBe(false);
    expect(
      isValidFantasyCalcHistorySequence([{ date: undefined, value: 1 }], now),
    ).toBe(false);
  });

  it("rejects the whole response when any single date is corrupt", () => {
    expect(
      isValidFantasyCalcHistorySequence(
        [
          { date: "01/01/2026", value: 9000 },
          { date: "01/02/2026", value: 9100 },
          { date: "12/02/1969", value: 9200 },
          { date: "01/04/2026", value: 9300 },
        ],
        now,
      ),
    ).toBe(false);
  });
});

describe("isRetryableHistoryFetchError", () => {
  it("retries 5xx and network errors but not 4xx", () => {
    expect(isRetryableHistoryFetchError(new Error("Source returned 500"))).toBe(true);
    expect(isRetryableHistoryFetchError(new Error("Source returned 503"))).toBe(true);
    expect(isRetryableHistoryFetchError(new Error("Source returned 404"))).toBe(false);
    expect(isRetryableHistoryFetchError(new Error("Source returned 400"))).toBe(false);
    expect(isRetryableHistoryFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableHistoryFetchError(new Error("aborted"))).toBe(true);
    expect(isRetryableHistoryFetchError("boom")).toBe(true);
  });
});

describe("fetchValidatedFantasyCalcHistory", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");
  const good = {
    historicalValues: [
      { date: "01/01/2026", value: 100 },
      { date: "01/02/2026", value: 110 },
    ],
  };
  const corrupt = {
    historicalValues: [
      { date: "01/01/2026", value: 100 },
      { date: "10/05/2194", value: 110 },
    ],
  };

  it("returns a validated response on the first success", async () => {
    const fetchFn = vi.fn().mockResolvedValue(good);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchValidatedFantasyCalcHistory("https://example.test/history", {
        now,
        fetchFn,
        sleepFn,
      }),
    ).resolves.toEqual(good);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("retries 5xx then succeeds, using backoff delays", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Source returned 500"))
      .mockRejectedValueOnce(new Error("Source returned 500"))
      .mockResolvedValueOnce(good);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchValidatedFantasyCalcHistory("https://example.test/history", {
        now,
        fetchFn,
        sleepFn,
      }),
    ).resolves.toEqual(good);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn.mock.calls.map((call) => call[0])).toEqual([
      VALUE_HISTORY_FETCH_BACKOFF_MS[0],
      VALUE_HISTORY_FETCH_BACKOFF_MS[1],
    ]);
  });

  it("retries corrupt whole responses then succeeds", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(corrupt).mockResolvedValueOnce(good);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchValidatedFantasyCalcHistory("https://example.test/history", {
        now,
        fetchFn,
        sleepFn,
      }),
    ).resolves.toEqual(good);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(VALUE_HISTORY_FETCH_BACKOFF_MS[0]);
  });

  it("throws CorruptFantasyCalcHistoryError after exhausting corrupt retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue(corrupt);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchValidatedFantasyCalcHistory("https://example.test/history", {
        now,
        fetchFn,
        sleepFn,
        maxAttempts: VALUE_HISTORY_FETCH_MAX_ATTEMPTS,
      }),
    ).rejects.toBeInstanceOf(CorruptFantasyCalcHistoryError);
    expect(fetchFn).toHaveBeenCalledTimes(VALUE_HISTORY_FETCH_MAX_ATTEMPTS);
    expect(sleepFn).toHaveBeenCalledTimes(VALUE_HISTORY_FETCH_MAX_ATTEMPTS - 1);
  });

  it("does not retry HTTP 4xx", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Source returned 404"));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await expect(
      fetchValidatedFantasyCalcHistory("https://example.test/history", {
        now,
        fetchFn,
        sleepFn,
      }),
    ).rejects.toThrow("Source returned 404");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
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
    const capturedAt = new Date("2026-10-12T15:00:00.000Z");
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "Jahmyr Gibbs",
        position: "RB",
        value: 10511.6,
        capturedAt,
        now,
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

  it("fills nullish name/position with empty strings and skips non-finite values", () => {
    const capturedAt = new Date("2026-10-12T00:00:00.000Z");
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: null,
        position: undefined,
        value: "100.4",
        capturedAt,
        now,
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
        now,
      }),
    ).toBeNull();
  });

  it("skips picks, missing player ids, and out-of-range snapshot/captured dates", () => {
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "dynasty-2qb-12t-1ppr",
        playerId: "pick-1",
        playerName: "2027 Mid",
        position: "PICK",
        value: 4000,
        capturedAt: new Date(),
        now,
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
        now,
      }),
    ).toBeNull();
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2014-12-31",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "X",
        position: "RB",
        value: 100,
        capturedAt: new Date("2014-12-31T00:00:00.000Z"),
        now,
      }),
    ).toBeNull();
    expect(
      compactPlayerValueSnapshot({
        snapshotDate: "2026-10-12",
        formatKey: "redraft-1qb-12t-0.5ppr",
        playerId: "9221",
        playerName: "X",
        position: "RB",
        value: 100,
        capturedAt: new Date("2026-10-15T00:00:00.000Z"),
        now,
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
    expect(dailySnapshotRowsFromPreset("redraft-1qb-12t-0.5ppr", rows, asOf)).toEqual({
      rows: [
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
      ],
      skipped: 0,
    });
    expect(utcDateKey(asOf)).toBe("2026-10-12");
  });

  it("skips the whole preset when asOf is outside the accepted window", () => {
    const asOf = new Date("2026-10-20T00:00:00.000Z");
    const now = new Date("2026-10-13T00:00:00.000Z");
    const rows: FantasyCalcRow[] = [
      { player: { id: 1, sleeperId: "9221", name: "A", position: "RB" }, value: 100 },
      { player: { id: 2, sleeperId: "4046", name: "B", position: "WR" }, value: 200 },
    ];
    expect(dailySnapshotRowsFromPreset("redraft-1qb-12t-0.5ppr", rows, asOf, now)).toEqual({
      rows: [],
      skipped: 2,
    });
  });
});

describe("historySnapshotRowsFromPoints", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");

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
      now,
    });
    expect(all.rows.map((row) => row.snapshotDate)).toEqual(["2026-01-01", "2026-03-15", "2026-10-12"]);
    expect(all.rows[1]?.value).toBe(9500);
    // "bad" + undefined-value point with valid date that fails compact
    expect(all.skipped).toBe(1);

    const recent = historySnapshotRowsFromPoints({
      formatKey: "dynasty-2qb-12t-1ppr",
      playerId: "4046",
      playerName: "Justin Jefferson",
      position: "WR",
      points,
      minSnapshotDate: "2026-03-01",
      now,
    });
    expect(recent.rows.map((row) => row.snapshotDate)).toEqual(["2026-03-15", "2026-10-12"]);
  });

  it("skips absurd / pre-2015 / far-future dates and still keeps valid points", () => {
    const built = historySnapshotRowsFromPoints({
      formatKey: "dynasty-2qb-12t-1ppr",
      playerId: "4046",
      playerName: "Justin Jefferson",
      position: "WR",
      points: [
        { date: "01/07/12600", value: 1 },
        { date: "01/07/2361", value: 2 },
        { date: "12/31/2014", value: 3 },
        { date: "10/15/2026", value: 4 },
        { date: "01/01/2015", value: 5000 },
        { date: "10/12/2026", value: 10511 },
        { date: "not-a-date", value: 9 },
      ],
      minSnapshotDate: null,
      now,
    });
    expect(built.rows.map((row) => ({ date: row.snapshotDate, value: row.value }))).toEqual([
      { date: "2015-01-01", value: 5000 },
      { date: "2026-10-12", value: 10511 },
    ]);
    expect(built.skipped).toBe(5);
  });
});

describe("resolveFantasyCalcSnapshotFormatKey", () => {
  it("passes exact preset keys through", () => {
    expect(resolveFantasyCalcSnapshotFormatKey("dynasty-2qb-12t-1ppr")).toBe("dynasty-2qb-12t-1ppr");
  });

  it("maps nearby non-preset keys to the nearest snapshot preset", () => {
    expect(resolveFantasyCalcSnapshotFormatKey("redraft-1qb-12t-0ppr")).toBe("redraft-1qb-12t-0.5ppr");
    expect(resolveFantasyCalcSnapshotFormatKey("redraft-1qb-11t-1ppr")).toBe("redraft-1qb-12t-1ppr");
  });

  it("falls back to the default preset for unparseable keys", () => {
    expect(resolveFantasyCalcSnapshotFormatKey("not-a-format")).toBe(DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY);
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

  it("runs FantasyCalc history fetches sequentially with a short delay", () => {
    expect(VALUE_HISTORY_BACKFILL_CONCURRENCY).toBe(1);
    expect(VALUE_HISTORY_BACKFILL_REQUEST_DELAY_MS).toBe(150);
    expect(VALUE_HISTORY_FETCH_MAX_ATTEMPTS).toBe(3);
    expect([...VALUE_HISTORY_FETCH_BACKOFF_MS]).toEqual([500, 1000, 2000]);
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
