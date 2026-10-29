import { describe, expect, it } from "vitest";
import { isDynastyNewsContext } from "./player-news-context";

function league(id: string, isDynasty: boolean) {
  return { id, seasonLongFormat: { isDynasty } };
}

describe("isDynastyNewsContext", () => {
  it("treats missing leagues as redraft (no league context)", () => {
    expect(isDynastyNewsContext(undefined, "lg1")).toBe(false);
    expect(isDynastyNewsContext([], "lg1")).toBe(false);
  });

  it("uses streamed dynasty meta even without a browser-cached dashboard", () => {
    // First visit: only streamed meta leagues are available.
    const streamed = [league("dynasty-lg", true)];
    expect(isDynastyNewsContext(streamed, "dynasty-lg")).toBe(true);
    expect(isDynastyNewsContext(streamed, null)).toBe(true);
  });

  it("keeps redraft leagues on the redraft news path", () => {
    expect(isDynastyNewsContext([league("redraft-lg", false)], "redraft-lg")).toBe(false);
  });

  it("picks the selected league when multiple are streamed", () => {
    const leagues = [league("redraft-lg", false), league("dynasty-lg", true)];
    expect(isDynastyNewsContext(leagues, "dynasty-lg")).toBe(true);
    expect(isDynastyNewsContext(leagues, "redraft-lg")).toBe(false);
  });
});
