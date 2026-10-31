import { describe, expect, it } from "vitest";
import { gradedDraftFor, leagueDraftIsFinal } from "./draft-final";

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
    // A finished startup draft with a rookie draft still to come keeps the editable view for that draft.
    expect(leagueDraftIsFinal([draft("a", "complete"), draft("a", "pre_draft")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("a", "complete"), draft("a", "paused")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("a", "complete", null)], "a")).toBe(false);
  });

  it("only looks at the selected league's drafts", () => {
    expect(leagueDraftIsFinal([draft("b", "complete")], "a")).toBe(false);
    expect(leagueDraftIsFinal([draft("b", "drafting"), draft("a", "complete")], "a")).toBe(true);
  });
});

describe("gradedDraftFor", () => {
  const withPicks = (leagueId: string, status: string, picks: number, type = "snake") =>
    ({ draftId: `${leagueId}-${picks}-${type}`, leagueId, status, type, ownRosterId: 3, picks: Array.from({ length: picks }, (_, i) => ({ pickNo: i + 1 })) }) as unknown as Drafts[number];

  it("picks the completed draft with the most picks, like the draft-grade route", () => {
    const drafts = [withPicks("a", "complete", 30), withPicks("a", "complete", 150), withPicks("b", "complete", 400)];
    expect(gradedDraftFor(drafts, "a")?.draftId).toBe("a-150-snake");
  });

  it("skips auctions, which have no grade, unless every draft is one", () => {
    expect(gradedDraftFor([withPicks("a", "complete", 200, "auction"), withPicks("a", "complete", 40)], "a")?.draftId).toBe("a-40-snake");
    expect(gradedDraftFor([withPicks("a", "complete", 200, "auction")], "a")?.draftId).toBe("a-200-auction");
  });

  it("ignores drafts that are not complete and returns null when there is none", () => {
    expect(gradedDraftFor([withPicks("a", "drafting", 50)], "a")).toBeNull();
    expect(gradedDraftFor(undefined, "a")).toBeNull();
  });
});
