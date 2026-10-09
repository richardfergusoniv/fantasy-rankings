import { describe, expect, it } from "vitest";
import { selectProjectionFeed } from "./projection-fallback.js";

type Feed = { id: string; team: string };

const teamOf = (row: Feed) => row.team;

describe("selectProjectionFeed", () => {
  const joshBuf = { id: "josh-buf", team: "BUF" };
  const joshKc = { id: "josh-kc", team: "KC" };
  const joshBlank = { id: "josh-blank", team: "" };

  it("keeps an exact team match ahead of a same-name row", () => {
    expect(selectProjectionFeed(joshBuf, [joshKc], "BUF", teamOf)).toBe(joshBuf);
  });

  it("uses one same-name row when the team matches or is blank", () => {
    expect(selectProjectionFeed(undefined, [joshBuf], "BUF", teamOf)).toBe(joshBuf);
    expect(selectProjectionFeed(undefined, [joshBlank], "BUF", teamOf)).toBe(joshBlank);
  });

  it("does not borrow a projection when the only same-name row is on another team", () => {
    expect(selectProjectionFeed(undefined, [joshKc], "BUF", teamOf)).toBeUndefined();
  });

  it("uses the one team match when several players share a name, and skips an ambiguous set", () => {
    expect(selectProjectionFeed(undefined, [joshKc, joshBuf], "BUF", teamOf)).toBe(joshBuf);
    expect(selectProjectionFeed(undefined, [joshKc, { id: "josh-dal", team: "DAL" }], "BUF", teamOf)).toBeUndefined();
    expect(selectProjectionFeed(undefined, [joshBlank, { id: "josh-blank-2", team: "" }], "BUF", teamOf)).toBeUndefined();
  });
});