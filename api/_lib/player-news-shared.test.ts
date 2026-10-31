import { describe, expect, it } from "vitest";
import {
  DYNASTY_NEWS_TAG,
  isSleeperTimestampOnlyNews,
  newsPostDedupeKey,
  newsVisibleInContext,
  SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
  takeNewsRowsForPostLimit,
} from "./player-news-filters.js";
import {
  buildInjuryNotesDraft,
  buildInjuryStatusDraft,
  buildNewsUpdatedDraft,
  buildPlayerNewsNameIndex,
  buildXNewsDraft,
  buildXNewsLeagueDraft,
  buildXNewsTeamDraft,
  collectXNewsDrafts,
  dedupeKey,
  filterDuplicateDrafts,
  isLastNameOnlyKey,
  normalizeNewsTags,
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

  const baseFields = {
    text: "Lions pace note.",
    author_handle: "@reporter",
    source_url: "https://x.com/reporter/status/456",
    post_id: "456",
    published_at: "2026-10-10T18:00:00.000Z",
  };

  it("accepts a well-formed X item", () => {
    expect(xNewsItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("defaults omitted scope to player behavior (requires player_id or player_name)", () => {
    expect(xNewsItemSchema.safeParse(validItem).success).toBe(true);
    expect(xNewsItemSchema.safeParse({ ...validItem, scope: "player" }).success).toBe(true);
    const { player_id: _id, ...rest } = validItem;
    expect(xNewsItemSchema.safeParse(rest).success).toBe(false);
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

  it("accepts scope team with a valid NFL team code and aliases", () => {
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team", team: "DET" }).success).toBe(true);
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team", team: "jac" }).success).toBe(true);
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team", team: "LA" }).success).toBe(true);
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team", team: "WSH" }).success).toBe(true);
  });

  it("rejects scope team without a valid team", () => {
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team" }).success).toBe(false);
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "team", team: "XYZ" }).success).toBe(false);
  });

  it("accepts scope league without player or team", () => {
    expect(xNewsItemSchema.safeParse({ ...baseFields, scope: "league" }).success).toBe(true);
  });

  it("rejects scope league when player or team fields are set", () => {
    expect(xNewsItemSchema.safeParse({
      ...baseFields,
      scope: "league",
      team: "DET",
    }).success).toBe(false);
    expect(xNewsItemSchema.safeParse({
      ...baseFields,
      scope: "league",
      player_id: "4046",
    }).success).toBe(false);
    expect(xNewsItemSchema.safeParse({
      ...baseFields,
      scope: "league",
      player_name: "Anyone",
    }).success).toBe(false);
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

  it("accepts allowlisted tags and drops unknown tags instead of rejecting", () => {
    expect(xNewsItemSchema.safeParse({ ...validItem, tags: ["dynasty"] }).success).toBe(true);
    expect(xNewsItemSchema.safeParse({
      ...validItem,
      tags: ["insider", "beat", "analyst", "rumor", "team-account"],
    }).success).toBe(true);
    const mixed = xNewsItemSchema.parse({
      ...validItem,
      tags: ["Insider", "unknown-foo", "dynasty", "!!!", "player"],
    });
    expect(mixed.tags).toEqual(["insider", "dynasty", "player"]);
    const onlyUnknown = xNewsItemSchema.parse({
      ...validItem,
      tags: ["a", "b", "c", "d", "e", "f"],
    });
    expect(onlyUnknown.tags).toEqual([]);
  });
});

describe("collectXNewsDrafts scope branching", () => {
  const playerItem = {
    scope: "player" as const,
    player_id: "1",
    text: "Jefferson limited.",
    author_handle: "reporter",
    source_url: "https://x.com/r/status/1",
    post_id: "1",
    published_at: "2026-10-10T18:00:00.000Z",
  };
  const teamItem = {
    scope: "team" as const,
    team: "JAC",
    text: "Jaguars play at a top-5 pace.",
    author_handle: "reporter",
    source_url: "https://x.com/r/status/2",
    post_id: "2",
    published_at: "2026-10-10T18:00:00.000Z",
  };
  const leagueItem = {
    scope: "league" as const,
    text: "League-wide target share note.",
    author_handle: "reporter",
    source_url: "https://x.com/r/status/3",
    post_id: "3",
    published_at: "2026-10-10T18:00:00.000Z",
  };

  it("fans out player scope via resolvePlayerIds and skips team/league resolve", () => {
    const resolveCalls: string[] = [];
    const { drafts, unresolved } = collectXNewsDrafts(
      [playerItem, teamItem, leagueItem],
      (item) => {
        resolveCalls.push(item.post_id);
        return item.player_id ? [item.player_id] : [];
      },
      (playerId) => (playerId === "1" ? { player: "A", team: "MIN" } : null),
    );
    expect(resolveCalls).toEqual(["1"]);
    expect(unresolved).toEqual([]);
    expect(drafts.map((d) => d.scope)).toEqual(["player", "team", "league"]);
    expect(drafts[0]).toMatchObject({ playerId: "1", team: "MIN", scope: "player" });
    expect(drafts[1]).toMatchObject({ playerId: null, team: "JAX", player: "JAX", scope: "team" });
    expect(drafts[2]).toMatchObject({ playerId: null, team: null, player: "NFL", scope: "league" });
  });

  it("treats omitted scope as player and builds a player draft", () => {
    const { scope: _scope, ...omittedScope } = playerItem;
    const { drafts, unresolved } = collectXNewsDrafts(
      [omittedScope],
      (item) => (item.player_id ? [item.player_id] : []),
      (playerId) => (playerId === "1" ? { player: "A", team: "MIN" } : null),
    );
    expect(unresolved).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ playerId: "1", scope: "player" });
  });

  it("records unresolved player items and still builds team/league drafts", () => {
    const { drafts, unresolved } = collectXNewsDrafts(
      [playerItem, teamItem],
      () => [],
      () => null,
    );
    expect(unresolved).toEqual(["1"]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.scope).toBe("team");
  });

  it("dedupes team by post+team and league by post", () => {
    const teamDup = { ...teamItem, source_url: "https://x.com/r/status/2b", text: "dup" };
    const leagueDup = { ...leagueItem, source_url: "https://x.com/r/status/3b", text: "dup" };
    const { drafts } = collectXNewsDrafts(
      [teamItem, teamDup, leagueItem, leagueDup],
      () => [],
      () => null,
    );
    const unique = filterDuplicateDrafts(drafts);
    expect(unique).toHaveLength(2);
    expect(unique.map((d) => d.scope).sort()).toEqual(["league", "team"]);
  });

  it("build helpers leave player_id null for team and league", () => {
    const parsedTeam = xNewsItemSchema.parse(teamItem);
    const parsedLeague = xNewsItemSchema.parse(leagueItem);
    expect(buildXNewsTeamDraft(parsedTeam, "JAX").playerId).toBeNull();
    expect(buildXNewsLeagueDraft(parsedLeague)).toMatchObject({
      playerId: null,
      team: null,
      scope: "league",
    });
  });
});

describe("normalizeNewsTags + dynasty visibility", () => {
  it("stores normalized tags on X drafts and defaults missing tags to []", () => {
    const draft = buildXNewsDraft(
      {
        player_id: "1",
        text: "Dynasty note",
        author_handle: "dynastyacct",
        source_url: "https://x.com/d/status/9",
        post_id: "9",
        published_at: "2026-10-10T18:00:00.000Z",
        tags: ["dynasty", "dynasty", "  ", "insider", "nope"],
      },
      { playerId: "1", player: "A", team: "MIN" },
    );
    expect(draft.tags).toEqual(["dynasty", "insider"]);
    expect(normalizeNewsTags(["Dynasty", "FOO", "foo", "beat"])).toEqual(["dynasty", "beat"]);
    const untagged = buildXNewsDraft(
      {
        player_id: "1",
        text: "National note",
        author_handle: "reporter",
        source_url: "https://x.com/r/status/10",
        post_id: "10",
        published_at: "2026-10-10T18:00:00.000Z",
      },
      { playerId: "1", player: "A", team: "MIN" },
    );
    expect(untagged.tags).toEqual([]);
  });

  it("hides dynasty-tagged rows in redraft and shows them in dynasty", () => {
    const dynastyRow = { tags: [DYNASTY_NEWS_TAG] };
    const plainRow = { tags: [] as string[] };
    expect(newsVisibleInContext(dynastyRow, false)).toBe(false);
    expect(newsVisibleInContext(dynastyRow, true)).toBe(true);
    expect(newsVisibleInContext(plainRow, false)).toBe(true);
    expect(newsVisibleInContext(plainRow, true)).toBe(true);
    expect(newsVisibleInContext({}, false)).toBe(true);
  });
});

describe("dedupe + filterDuplicateDrafts", () => {
  it("prefers source+externalId+playerId over URL+playerId", () => {
    expect(dedupeKey("x", "123", "https://x.com/a", "4046")).toBe("x:123:4046");
    expect(dedupeKey("sleeper", null, "https://sleeper.app/a", "1")).toBe(
      "url:https://sleeper.app/a:1",
    );
    expect(dedupeKey("x", "123", "https://x.com/a", null, "team", "DET")).toBe("x:123:team:DET");
    expect(dedupeKey("x", "123", "https://x.com/a", null, "league")).toBe("x:123:league");
  });

  it("drops the same post+player twice in a batch", () => {
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

  it("keeps the same post attached to two different players", () => {
    const forA = buildXNewsDraft(
      {
        player_id: "1",
        text: "Wednesday practice: Amon-Ra DNP, Gibbs limited.",
        author_handle: "reporter",
        source_url: "https://x.com/r/status/2115569505300811921",
        post_id: "2115569505300811921",
        published_at: "2026-10-10T18:00:00.000Z",
      },
      { playerId: "1", player: "Amon-Ra St. Brown", team: "DET" },
    );
    const forB = buildXNewsDraft(
      {
        player_id: "2",
        text: "Wednesday practice: Amon-Ra DNP, Gibbs limited.",
        author_handle: "reporter",
        source_url: "https://x.com/r/status/2115569505300811921",
        post_id: "2115569505300811921",
        published_at: "2026-10-10T18:00:00.000Z",
      },
      { playerId: "2", player: "Jahmyr Gibbs", team: "DET" },
    );
    const unique = filterDuplicateDrafts([forA, forB]);
    expect(unique).toHaveLength(2);
    expect(unique.map((d) => d.playerId).sort()).toEqual(["1", "2"]);
    expect(unique[0]!.id).not.toBe(unique[1]!.id);
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

describe("newsPostDedupeKey", () => {
  it("groups by source+externalId when present, else by sourceUrl", () => {
    expect(newsPostDedupeKey({
      source: "x",
      externalId: "2115569505300811921",
      sourceUrl: "https://x.com/r/status/2115569505300811921",
    })).toBe("x:2115569505300811921");
    expect(newsPostDedupeKey({
      source: "sleeper",
      externalId: null,
      sourceUrl: "https://sleeper.app/players/nfl/1?news=a",
    })).toBe("url:https://sleeper.app/players/nfl/1?news=a");
  });
});

describe("takeNewsRowsForPostLimit", () => {
  it("keeps every player row for the newest N distinct posts", () => {
    const rows = [
      { id: "a1", source: "x", externalId: "post-a", sourceUrl: "https://x.com/a", playerId: "1" },
      { id: "a2", source: "x", externalId: "post-a", sourceUrl: "https://x.com/a", playerId: "2" },
      { id: "b1", source: "x", externalId: "post-b", sourceUrl: "https://x.com/b", playerId: "3" },
      { id: "c1", source: "x", externalId: "post-c", sourceUrl: "https://x.com/c", playerId: "4" },
      { id: "a3", source: "x", externalId: "post-a", sourceUrl: "https://x.com/a", playerId: "5" },
    ];
    const kept = takeNewsRowsForPostLimit(rows, 2);
    expect(kept.map((row) => row.id)).toEqual(["a1", "a2", "b1", "a3"]);
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

  it("maps short Amon-Ra extracts to full Sleeper key", () => {
    expect(normalizePlayerNameKey("Amon-Ra")).toBe("amon ra st brown");
    expect(normalizePlayerNameKey("Amon Ra")).toBe("amon ra st brown");
    expect(normalizePlayerNameKey("Amon-Ra St. Brown")).toBe("amon ra st brown");
    expect(normalizePlayerNameKey("Amon Ra St. Brown")).toBe("amon ra st brown");
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

  it("resolves Amon-Ra short names and St. Brown+team via first/last index", () => {
    const lions = buildPlayerNewsNameIndex([
      {
        playerId: "7547",
        player: "Amon-Ra St. Brown",
        team: "DET",
        firstName: "Amon-Ra",
        lastName: "St. Brown",
      },
      {
        playerId: "5323",
        player: "Equanimeous St. Brown",
        team: "FA",
        firstName: "Equanimeous",
        lastName: "St. Brown",
      },
      { playerId: "9221", player: "Jahmyr Gibbs", team: "DET" },
    ]);
    expect(resolveXNewsPlayer({ player_name: "Amon-Ra" }, lions)?.playerId).toBe("7547");
    expect(resolveXNewsPlayer({ player_name: "Amon Ra St. Brown" }, lions)?.playerId)
      .toBe("7547");
    expect(resolveXNewsPlayer({ player_name: "St. Brown", team: "DET" }, lions)?.playerId)
      .toBe("7547");
    expect(resolveXNewsPlayer({ player_name: "St. Brown" }, lions)).toBeNull();
    expect(resolveXNewsPlayer({ player_name: "Brown", team: "DET" }, lions)?.playerId)
      .toBe("7547");
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
