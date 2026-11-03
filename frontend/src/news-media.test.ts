import { describe, expect, it } from "vitest";
import { safeNewsMediaItems } from "./news-media";

describe("safeNewsMediaItems", () => {
  it("keeps http(s) media and drops non-http urls before bind", () => {
    expect(
      safeNewsMediaItems([
        { type: "image", url: "https://pbs.twimg.com/media/chart.png", alt: "chart" },
        { type: "image", url: "javascript:alert(1)" },
        { type: "video", url: "https://video.twimg.com/clip.mp4", previewUrl: "javascript:x" },
        { type: "image", url: "" },
      ]),
    ).toEqual([
      { type: "image", url: "https://pbs.twimg.com/media/chart.png", alt: "chart" },
      { type: "video", url: "https://video.twimg.com/clip.mp4" },
    ]);
  });

  it("returns an empty list for missing or empty media", () => {
    expect(safeNewsMediaItems(null)).toEqual([]);
    expect(safeNewsMediaItems(undefined)).toEqual([]);
    expect(safeNewsMediaItems([])).toEqual([]);
  });
});
