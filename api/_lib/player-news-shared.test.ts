import { describe, expect, it } from "vitest";
import {
  isSleeperTimestampOnlyNews,
  SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
} from "./player-news-filters.js";
import {
  buildInjuryNotesDraft,
  buildInjuryStatusDraft,
  buildNewsUpdatedDraft,
  buildPlayerNewsNameIndex,
  buildXNewsDraft,
  dedupeKey,
  filterDuplicateDrafts,
  isLastNameOnlyKey,
  normalizeNewsUpdated,
  normalizePlayerNameKey,
  parseNotesSnapshot,
  resolvePlayerIdFromName,
  resolveXNewsPlayer,
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

  it("accepts optional team with player_name", () => {
    const { player_id: _id, ...rest } = validItem;
    expect(xNewsItemSchema.safeParse({
      ...rest,
      player_name: "Jefferson",
      team: "MIN",
    }).success).toBe(true);
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

  it("rejects javascript/data/file source_url values", () => {
    expect(xNewsItemSchema.safeParse({ ...validItem, source_url: "javascript:alert(1)" }).success).toBe(false);
    expect(xNewsItemSchema.safeParse({ ...validItem, source_url: "data:text/html,hi" }).success).toBe(false);
    expect(xNewsItemSchema.safeParse({ ...validItem, source_url: "file:///tmp/x" }).success).toBe(false);
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

  it("never emits timestamp-only news_updated drafts", () => {
    expect(buildNewsUpdatedDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousUpdated: "1",
      nextUpdated: "2",
      injuryNotes: "still hurt",
      checkedAt,
    })).toBeNull();
    expect(buildNewsUpdatedDraft({
      playerId: "1",
      player: "A",
      team: "MIN",
      previousUpdated: "1",
      nextUpdated: "2",
      injuryNotes: null,
      checkedAt,
    })).toBeNull();
  });
});

describe("isSleeperTimestampOnlyNews", () => {
  it("matches the legacy roleContext marker and ignores real Sleeper rows", () => {
    expect(isSleeperTimestampOnlyNews({
      roleContext: SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
    })).toBe(true);
    expect(isSleeperTimestampOnlyNews({
      roleContext: "Sleeper injury-status change detected by the scheduled check.",
    })).toBe(false);
    expect(isSleeperTimestampOnlyNews({
      roleContext: "New Sleeper injury notes.",
    })).toBe(false);
    expect(isSleeperTimestampOnlyNews({
      roleContext: "Posted by @AdamSchefter on X.",
    })).toBe(false);
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

describe("normalizePlayerNameKey hardening", () => {
  it("strips generational suffixes", () => {
    expect(normalizePlayerNameKey("Travis Etienne Jr.")).toBe("travis etienne");
    expect(normalizePlayerNameKey("Marvin Harrison Jr")).toBe("marvin harrison");
    expect(normalizePlayerNameKey("Kenneth Walker III")).toBe("kenneth walker");
    expect(normalizePlayerNameKey("Odell Beckham Jr.")).toBe(
      normalizePlayerNameKey("Odell Beckham"),
    );
  });

  it("collapses dotted / spaced initials (A.J. ↔ AJ)", () => {
    expect(normalizePlayerNameKey("A.J. Brown")).toBe("aj brown");
    expect(normalizePlayerNameKey("AJ Brown")).toBe("aj brown");
    expect(normalizePlayerNameKey("A J Dillon")).toBe("aj dillon");
    expect(normalizePlayerNameKey("D.K. Metcalf")).toBe(
      normalizePlayerNameKey("DK Metcalf"),
    );
  });

  it("maps Wan'Dale / Wandale via alias", () => {
    expect(normalizePlayerNameKey("Wan'Dale Robinson")).toBe("wan dale robinson");
    expect(normalizePlayerNameKey("Wandale Robinson")).toBe("wan dale robinson");
  });

  it("detects last-name-only keys", () => {
    expect(isLastNameOnlyKey(normalizePlayerNameKey("Jefferson"))).toBe(true);
    expect(isLastNameOnlyKey(normalizePlayerNameKey("Justin Jefferson"))).toBe(false);
  });
});

describe("resolveXNewsPlayer matching", () => {
  const index = buildPlayerNewsNameIndex([
    { playerId: "4046", player: "Justin Jefferson", team: "MIN" },
    { playerId: "8112", player: "Wan'Dale Robinson", team: "NYG" },
    { playerId: "4866", player: "A.J. Brown", team: "PHI" },
    { playerId: "8155", player: "Travis Etienne Jr.", team: "JAC" },
    { playerId: "1001", player: "Diontae Johnson", team: "HOU" },
    { playerId: "1002", player: "Juwan Johnson", team: "NO" },
    { playerId: "2001", player: "Collision Same", team: "KC" },
    { playerId: "2002", player: "Collision Same", team: "BUF" },
  ]);

  it("prefers player_id when present and known", () => {
    expect(resolveXNewsPlayer(
      { player_id: "4046", player_name: "Wrong Name" },
      index,
    )).toEqual({ playerId: "4046", player: "Justin Jefferson", team: "MIN" });
  });

  it("resolves full names with Jr. stripped and A.J./Wan'Dale aliases", () => {
    expect(resolveXNewsPlayer({ player_name: "Travis Etienne" }, index)?.playerId)
      .toBe("8155");
    expect(resolveXNewsPlayer({ player_name: "AJ Brown" }, index)?.playerId)
      .toBe("4866");
    expect(resolveXNewsPlayer({ player_name: "Wandale Robinson" }, index)?.playerId)
      .toBe("8112");
  });

  it("drops last-name-only without team (no silent wrong attach)", () => {
    expect(resolveXNewsPlayer({ player_name: "Johnson" }, index)).toBeNull();
    expect(resolveXNewsPlayer({ player_name: "Jefferson" }, index)).toBeNull();
  });

  it("resolves last-name-only when team disambiguates", () => {
    expect(resolveXNewsPlayer(
      { player_name: "Johnson", team: "HOU" },
      index,
    )?.playerId).toBe("1001");
    expect(resolveXNewsPlayer(
      { player_name: "Johnson", team: "NO" },
      index,
    )?.playerId).toBe("1002");
    expect(resolveXNewsPlayer(
      { player_name: "Jefferson", team: "jac" },
      index,
    )).toBeNull();
    expect(resolveXNewsPlayer(
      { player_name: "Etienne", team: "JAC" },
      index,
    )?.playerId).toBe("8155");
  });

  it("requires team (or player_id) when full name collides across teams", () => {
    expect(resolveXNewsPlayer({ player_name: "Collision Same" }, index)).toBeNull();
    expect(resolveXNewsPlayer(
      { player_name: "Collision Same", team: "BUF" },
      index,
    )?.playerId).toBe("2002");
  });

  it("omits ambiguous byNameTeam keys instead of last-write-wins", () => {
    const ambiguous = buildPlayerNewsNameIndex([
      { playerId: "a1", player: "Same Name", team: "DAL" },
      { playerId: "a2", player: "Same Name", team: "DAL" },
    ]);
    expect(ambiguous.byNameTeam.has("same name|DAL")).toBe(false);
    expect(resolveXNewsPlayer(
      { player_name: "Same Name", team: "DAL" },
      ambiguous,
    )).toBeNull();
  });

  it("routes last-name-only through byLastNameTeam, not byNameTeam", () => {
    // Mononym "Johnson" would occupy byNameTeam "johnson|HOU" if consulted
    // first, masking the ambiguous surname collision with Diontae Johnson.
    const crowded = buildPlayerNewsNameIndex([
      { playerId: "mono", player: "Johnson", team: "HOU" },
      { playerId: "full", player: "Diontae Johnson", team: "HOU" },
    ]);
    expect(crowded.byNameTeam.get("johnson|HOU")).toBe("mono");
    expect(crowded.byLastNameTeam.has("johnson|HOU")).toBe(false);
    expect(resolveXNewsPlayer(
      { player_name: "Johnson", team: "HOU" },
      crowded,
    )).toBeNull();
  });
});
