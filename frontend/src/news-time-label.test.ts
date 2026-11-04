import { describe, expect, it } from "vitest";
import { newsAbsoluteTimeLabel, newsItemTimeLabel, newsRelativeTimeLabel } from "./news-time";

const NOW = Date.parse("2026-10-30T22:00:00Z");

describe("newsRelativeTimeLabel", () => {
  it("formats recent stamps relatively", () => {
    expect(newsRelativeTimeLabel("2026-10-30T21:59:30Z", NOW)).toBe("just now");
    expect(newsRelativeTimeLabel("2026-10-30T21:55:00Z", NOW)).toBe("5m ago");
    expect(newsRelativeTimeLabel("2026-10-30T19:00:00Z", NOW)).toBe("3h ago");
    expect(newsRelativeTimeLabel("2026-10-28T22:00:00Z", NOW)).toBe("2d ago");
  });
});

describe("newsItemTimeLabel", () => {
  it("uses the same relative treatment for every news source", () => {
    expect(
      newsItemTimeLabel(
        { source: "article", sourcePublishedAt: "2026-10-30T21:55:00Z" },
        NOW,
      ),
    ).toBe("5m ago");
    expect(
      newsItemTimeLabel(
        { source: "x", sourcePublishedAt: "2026-10-30T21:55:00Z" },
        NOW,
      ),
    ).toBe("5m ago");
    expect(newsItemTimeLabel({ source: "article", sourcePublishedAt: null })).toBe("Recent");
  });

  it("falls back to a Pacific absolute stamp after a week", () => {
    const label = newsItemTimeLabel(
      { source: "x", sourcePublishedAt: "2026-10-01T18:00:00Z" },
      NOW,
    );
    expect(label).toBe(newsAbsoluteTimeLabel("2026-10-01T18:00:00Z"));
    expect(label).toMatch(/Oct/);
  });
});
