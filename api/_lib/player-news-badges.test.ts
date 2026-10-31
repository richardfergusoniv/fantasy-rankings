import { describe, expect, it } from "vitest";
import {
  articleOutletBadgeLabel,
  selectNewsBadges,
} from "./player-news-badges.js";

describe("selectNewsBadges", () => {
  it("prefers rumor over every other signal and marks it unconfirmed", () => {
    expect(
      selectNewsBadges({
        source: "x",
        tags: ["rumor", "insider", "dynasty"],
        scope: "player",
        sourceLabel: "@beat",
      }),
    ).toEqual({
      primary: { key: "rumor", label: "Rumor", tone: "rumor" },
      secondary: [{ key: "dynasty", label: "Dynasty", tone: "neutral" }],
    });
  });

  it("maps X source-role tags the scanner sends to primary labels", () => {
    // Live X producer currently emits insider | beat | analyst | rumor |
    // team-account (+ optional dynasty). `player` is allowlisted for later.
    const cases: Array<{ tag: string; label: string }> = [
      { tag: "insider", label: "Insider" },
      { tag: "beat", label: "Beat writer" },
      { tag: "analyst", label: "Analyst" },
      { tag: "team-account", label: "Team account" },
      { tag: "player", label: "Player" },
    ];
    for (const { tag, label } of cases) {
      expect(selectNewsBadges({ source: "x", tags: [tag] }).primary).toEqual({
        key: tag,
        label,
        tone: "neutral",
      });
      expect(
        selectNewsBadges({ source: "x", tags: [tag, "dynasty"] }).secondary.map((b) => b.label),
      ).toEqual(["Dynasty"]);
    }
  });

  it("falls back to X when source is x with no role tag", () => {
    expect(selectNewsBadges({ source: "x", tags: ["dynasty"] })).toEqual({
      primary: { key: "x", label: "X", tone: "neutral" },
      secondary: [{ key: "dynasty", label: "Dynasty", tone: "neutral" }],
    });
  });

  it("uses article outlet name, with short forms and host fallback", () => {
    expect(
      selectNewsBadges({
        source: "article",
        sourceLabel: "ProFootballTalk",
        sourceUrl: "https://www.nbcsports.com/profootballtalk/x",
      }).primary.label,
    ).toBe("PFT");
    expect(
      selectNewsBadges({
        source: "article",
        sourceLabel: "FantasyPros",
        sourceUrl: "https://www.fantasypros.com/nfl/news/x",
      }).primary.label,
    ).toBe("FantasyPros");
    expect(
      selectNewsBadges({
        source: "article",
        sourceLabel: null,
        sourceUrl: "https://www.espn.com/nfl/story/_/id/1",
      }).primary.label,
    ).toBe("ESPN");
    expect(
      selectNewsBadges({
        source: "article",
        sourceLabel: "",
        sourceUrl: null,
      }).primary.label,
    ).toBe("Article");
  });

  it("labels sleeper and nflverse sources", () => {
    expect(selectNewsBadges({ source: "sleeper", tags: [] }).primary).toEqual({
      key: "sleeper",
      label: "Sleeper",
      tone: "neutral",
    });
    expect(
      selectNewsBadges({ source: "nflverse", sourceLabel: "nflverse snaps" }).primary.label,
    ).toBe("nflverse snaps");
    expect(selectNewsBadges({ source: "nflverse", sourceLabel: null }).primary.label).toBe("Data");
  });

  it("adds Team and League secondary badges for scoped rows", () => {
    expect(
      selectNewsBadges({
        source: "x",
        tags: ["beat"],
        scope: "team",
      }).secondary.map((badge) => badge.label),
    ).toEqual(["Team"]);
    expect(
      selectNewsBadges({
        source: "x",
        tags: ["analyst", "dynasty"],
        scope: "league",
      }).secondary.map((badge) => badge.label),
    ).toEqual(["Dynasty", "League"]);
  });
});

describe("articleOutletBadgeLabel", () => {
  it("shortens known outlets and derives from host when label is missing", () => {
    expect(articleOutletBadgeLabel("ProFootballTalk", null)).toBe("PFT");
    expect(articleOutletBadgeLabel("ESPN", null)).toBe("ESPN");
    expect(articleOutletBadgeLabel(null, "https://www.espn.com/nfl/story")).toBe("ESPN");
    expect(articleOutletBadgeLabel(null, null)).toBe("Article");
  });
});
