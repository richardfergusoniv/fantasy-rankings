import { describe, expect, it } from "vitest";
import { newsItemTimeLabel, newsRelativeTimeLabel } from "./news-time";

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
  it("uses relative time for articles and absolute for other sources", () => {
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
    ).not.toBe("5m ago");
    expect(newsItemTimeLabel({ source: "article", sourcePublishedAt: null })).toBe("Recent");
  });
});
