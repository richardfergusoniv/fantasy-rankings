import { describe, expect, it } from "vitest";
import { newsOutletLabel } from "./news-outlet";

describe("newsOutletLabel", () => {
  it("does not duplicate the X handle stored in both sourceLabel and author", () => {
    expect(
      newsOutletLabel({ source: "x", sourceLabel: "@RapSheet", author: "@RapSheet" }),
    ).toBe("@RapSheet");
  });

  it("joins outlet and author when they differ", () => {
    expect(
      newsOutletLabel({ source: "x", sourceLabel: "ESPN", author: "@adamschefter" }),
    ).toBe("ESPN · @adamschefter");
  });

  it("ignores author for article rows", () => {
    expect(
      newsOutletLabel({ source: "article", sourceLabel: "PFF", author: "Someone" }),
    ).toBe("PFF");
  });

  it("falls back to whichever field is set", () => {
    expect(newsOutletLabel({ source: "x", sourceLabel: "@beat", author: null })).toBe("@beat");
    expect(newsOutletLabel({ source: "x", sourceLabel: null, author: "@beat" })).toBe("@beat");
  });
});
