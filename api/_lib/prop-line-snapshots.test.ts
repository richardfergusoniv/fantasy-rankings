import { describe, expect, it } from "vitest";
import {
  propLineSnapshotPayloadSchema,
  toPropLineSnapshotRows,
} from "./prop-line-snapshots.js";

const basePayload = {
  season: 2026,
  week: 6,
  pulled_at: "2026-10-12T10:17:00.000Z",
  consensus: [
    {
      player: "Patrick Mahomes",
      stat: "pass_yards",
      consensus_line: 275.5,
      median_over_odds: -110,
      median_under_odds: -108,
      book_count: 8,
    },
    {
      player: "Travis Kelce",
      stat: "receptions",
      consensus_line: 5.5,
      median_over_odds: -115,
      median_under_odds: -105,
      book_count: 6,
    },
  ],
};

describe("propLineSnapshotPayloadSchema", () => {
  it("accepts a consensus snapshot with pulled_at", () => {
    expect(propLineSnapshotPayloadSchema.safeParse(basePayload).success).toBe(true);
  });

  it("accepts built_at as the pull timestamp alias", () => {
    const { pulled_at: _pulled, ...rest } = basePayload;
    expect(
      propLineSnapshotPayloadSchema.safeParse({
        ...rest,
        built_at: "2026-10-12T11:17:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects payloads missing both pulled_at and built_at", () => {
    const { pulled_at: _pulled, ...rest } = basePayload;
    expect(propLineSnapshotPayloadSchema.safeParse(rest).success).toBe(false);
  });
});

describe("toPropLineSnapshotRows", () => {
  it("maps consensus rows onto compact dated snapshot rows", () => {
    const nameIndex = new Map([
      ["patrick mahomes", "4046"],
      ["travis kelce", "4606"],
    ]);
    const parsed = propLineSnapshotPayloadSchema.parse(basePayload);
    const result = toPropLineSnapshotRows(parsed, nameIndex);

    expect(result.unresolved).toEqual([]);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.rows).toEqual([
      {
        pulledAt: new Date("2026-10-12T10:17:00.000Z"),
        playerId: "4046",
        stat: "pass_yards",
        line: 275.5,
        medianOverOdds: -110,
        medianUnderOdds: -108,
        bookCount: 8,
        week: 6,
        season: 2026,
      },
      {
        pulledAt: new Date("2026-10-12T10:17:00.000Z"),
        playerId: "4606",
        stat: "receptions",
        line: 5.5,
        medianOverOdds: -115,
        medianUnderOdds: -105,
        bookCount: 6,
        week: 6,
        season: 2026,
      },
    ]);
  });

  it("prefers embedded player_id over name resolution", () => {
    const parsed = propLineSnapshotPayloadSchema.parse({
      ...basePayload,
      consensus: [
        {
          player: "Unknown Spelling",
          player_id: "9999",
          stat: "rush_yards",
          consensus_line: 62.5,
          median_over_odds: null,
          book_count: 3,
        },
      ],
    });
    const result = toPropLineSnapshotRows(parsed, new Map());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.playerId).toBe("9999");
    expect(result.rows[0]?.medianOverOdds).toBeNull();
    expect(result.rows[0]?.medianUnderOdds).toBeNull();
  });

  it("skips unresolved names and duplicate player/stat pairs", () => {
    const parsed = propLineSnapshotPayloadSchema.parse({
      season: 2026,
      week: 6,
      built_at: "2026-10-12T10:17:00.000Z",
      consensus: [
        {
          player: "Patrick Mahomes",
          stat: "pass_yards",
          consensus_line: 275.5,
          book_count: 8,
        },
        {
          player: "Patrick Mahomes",
          stat: "pass_yards",
          consensus_line: 274.5,
          book_count: 4,
        },
        {
          player: "Ghost Player",
          stat: "rec_yards",
          consensus_line: 40.5,
          book_count: 2,
        },
      ],
    });
    const result = toPropLineSnapshotRows(
      parsed,
      new Map([["patrick mahomes", "4046"]]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.line).toBe(275.5);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.unresolved).toEqual(["Ghost Player"]);
  });

  it("falls back to built_at when pulled_at is absent", () => {
    const parsed = propLineSnapshotPayloadSchema.parse({
      season: 2026,
      week: 6,
      built_at: "2026-10-12T11:17:00.000Z",
      consensus: [basePayload.consensus[0]!],
    });
    const result = toPropLineSnapshotRows(
      parsed,
      new Map([["patrick mahomes", "4046"]]),
    );
    expect(result.rows[0]?.pulledAt.toISOString()).toBe("2026-10-12T11:17:00.000Z");
  });
});
