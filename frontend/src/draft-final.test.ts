import { describe, expect, it } from "vitest";
import { leagueDraftIsFinal } from "./draft-final";

type Drafts = NonNullable<Parameters<typeof leagueDraftIsFinal>[0]>;
const draft = (leagueId: string | null, status: string, ownRosterId: number | null = 3) => ({ leagueId, status, ownRosterId }) as Drafts[number];

describe("leagueDraftIsFinal", () => {
  it("is true once the league's draft is complete and the team took part", () => {
    expect(leagueDraftIsFinal([draft("a", "complete")], "a")).toBe(true);
  });

  it("is false before a draft, during one, or when the team is not in it", () => {
    expect(leagueDraftIsFinal(undefined, "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("a", "pre_draft")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("a", "complete"), draft("a", "drafting")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("a", "complete", null)], "a")).toBe(false);
  });

  it("only looks at the selected league's drafts", () => {
    expect(leagueDraftIsFinal([draft("b", "complete")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("b", "drafting"), draft("a", "complete")], "a")).toBe(true);
  });
});
