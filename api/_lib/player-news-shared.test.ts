import { describe, expect, it } from "vitest";
import {
  buildInjuryNotesDraft,
  buildInjuryStatusDraft,
  buildNewsUpdatedDraft,
  buildXNewsDraft,
  dedupeKey,
  filterDuplicateDrafts,
  normalizeNewsUpdated,
  normalizePlayerNameKey,
  parseNotesSnapshot,
  resolvePlayerIdFromName,
  retentionCutoff,
  signalToNewsType,
  xNewsBatchSchema,
  xNewsItemSchema,
} from "./player-news-shared.js";

describe("xNewsItemSchema / xNewsBatchSchema", () => {
  const validItem = {
    player_id: "4046",
    text: "Justin Jefferson is questionable for Sunday.",
    author_handle: "@AdamSchefter",
    source_url: "https://x.com/AdamSchefter/status/123",
    post_id: "123",
    published_at: "2026-10-10T18:00:00.000Z",
    signal: "injury",
    score: 90,
  };

  it("accepts a well-formed X item", () => {
    expect(xNewsItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("accepts player_name instead of player_id", () => {
    const { player_id: _id, ...rest } = validItem;
    expect(xNewsItemSchema.safeParse({ ...rest, player_name: "Justin Jefferson" }).success).toBe(true);
  });

  it("rejects items missing both player_id and player_name", () => {
    const { player_id: _id, ...rest } = validItem;
    expect(xNewsItemSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid batch payloads", () => {
    expect(xNewsBatchSchema.safeParse({ items: [] }).success).toBe(false);
    expect(xNewsBatchSchema.safeParse({ items: [{ ...validItem, post_id: "" }] }).success).toBe(false);
    expect(xNewsBatchSchema.safeParse({ items: [{ ...validItem, source_url: "not-a-url" }] }).success).toBe(false);
  });
});

describe("dedupe + filterDuplicateDrafts", () => {
  it("prefers source+externalId over URL", () => {
    expect(dedupeKey("x", "123", "https://x.com/a")).toBe("x:123");
    expect(dedupeKey("sleeper", null, "https://sleeper.app/a")).toBe("url:https://sleeper.app/a");
  });

  it("drops duplicate post ids in a batch", () => {
    const base = buildXNewsDraft(
      {
        player_id: "1",
        text: "One",
        author_handle: "reporter",
        source_url: "https://x.com/r/status/1",
        post_id: "1",
        published_at: "2026-10-10T18:00:00.000Z",
      },
      { playerId: "1", player: "A", team: "MIN" },
    );
    const dup = buildXNewsDraft(
      {
        player_id: "1",
        text: "Two",
        author_handle: "reporter",
        source_url: "https://x.com/r/status/1b",
        post_id: "1",
        published_at: "2026-10-10T18:01:00.000Z",
      },
      { playerId: "1", player: "A", team: "MIN" },
    );
    expect(filterDuplicateDrafts([base, dup])).toHaveLength(1);
  });
});

describe("signalToNewsType", () => {
  it("maps known signals", () => {
    expect(signalToNewsType("waiver")).toBe("waiver");
    expect(signalToNewsType("breaking")).toBe("headline");
    expect(signalToNewsType("injury")).toBe("roster");
    expect(signalToNewsType(undefined)).toBe("roster");
  });
});

describe("Sleeper draft builders", () => {
  const checkedAt = new Date("2026-10-10T18:00:00.000Z");

  it("builds a stable injury-status draft", () => {
    const draft = buildInjuryStatusDraft({
      playerId: "4046",
      player: "Justin Jefferson",
      team: "MIN",
      previousStatus: "Questionable",
      nextStatus: "Out",
      checkedAt,
    });
    expect(draft.source).toBe("sleeper");
    expect(draft.externalId).toContain("injury-status:4046:Out");
    expect(draft.change).toContain("Questionable");
    expect(draft.change).toContain("Out");
  });

  it("builds injury-notes drafts only when notes change to a non-empty value", () => {
    expect(buildInjuryNotesDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousNotes: "Ankle",
      nextNotes: "Ankle",
      newsUpdated: "1",
      checkedAt,
    })).toBeNull();
    expect(buildInjuryNotesDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousNotes: "Ankle",
      nextNotes: null,
      newsUpdated: "1",
      checkedAt,
    })).toBeNull();
    const draft = buildInjuryNotesDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousNotes: null,
      nextNotes: "Ankle sprain, day-to-day",
      newsUpdated: "1728576000",
      checkedAt,
    });
    expect(draft?.change).toBe("Ankle sprain, day-to-day");
    expect(draft?.publishedAt?.toISOString()).toBe("2024-10-10T16:00:00.000Z");
  });

  it("emits news_updated only when notes are empty", () => {
    expect(buildNewsUpdatedDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousUpdated: "1",
      nextUpdated: "2",
      injuryNotes: "still hurt",
      checkedAt,
    })).toBeNull();
    const draft = buildNewsUpdatedDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousUpdated: "1",
      nextUpdated: "2",
      injuryNotes: null,
      checkedAt,
    });
    expect(draft?.signal).toBe("news_updated");
  });
});

describe("notes snapshot + name helpers", () => {
  it("parses notes snapshots and normalizes news_updated", () => {
    expect(normalizeNewsUpdated(1728576000)).toBe("1728576000");
    expect(normalizeNewsUpdated("  ")).toBeNull();
    const snap = parseNotesSnapshot(JSON.stringify({
      "1": { injuryNotes: "Knee", newsUpdated: 12 },
      "bad": "nope",
    }));
    expect(snap["1"]).toEqual({ injuryNotes: "Knee", newsUpdated: "12" });
    expect(snap.bad).toBeUndefined();
  });

  it("resolves player names case-insensitively", () => {
    const index = new Map([[normalizePlayerNameKey("Justin Jefferson"), "4046"]]);
    expect(resolvePlayerIdFromName("justin jefferson", index)).toBe("4046");
    expect(resolvePlayerIdFromName("Nobody", index)).toBeNull();
  });

  it("computes a 30-day retention cutoff", () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});
