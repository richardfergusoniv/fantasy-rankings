import { describe, expect, it } from "vitest";
import {
  PRACTICE_NEWS_TAG,
  isInteractionBaitPost,
  isMaterialPracticeStatusNote,
} from "./player-news-filters.js";
import { withPracticeStatusTag } from "./player-news-shared.js";

describe("isInteractionBaitPost", () => {
  it("drops polls and 'would you rather' posts", () => {
    expect(isInteractionBaitPost("Poll: who wins NFC Offensive Player of the Month?")).toBe(true);
    expect(isInteractionBaitPost("Would you rather have Ja'Marr Chase or Justin Jefferson ROS?")).toBe(true);
    expect(isInteractionBaitPost("You can only keep one: Lamb or St. Brown?")).toBe(true);
    expect(isInteractionBaitPost("Who you got this week: Bijan or Gibbs?")).toBe(true);
    expect(isInteractionBaitPost("Which player are you starting at flex?")).toBe(true);
    expect(isInteractionBaitPost("RT if you have CMC on your roster")).toBe(true);
  });

  it("keeps stat lists, grades, projections, and analyst recommendations", () => {
    expect(
      isInteractionBaitPost("PFF grades through Week 9: 1) Puka Nacua 2) Jaxon Smith-Njigba 3) Drake London"),
    ).toBe(false);
    expect(isInteractionBaitPost("Week 10 projections: Gibbs 19.4, Jacobs 17.2, Hall 15.8")).toBe(false);
    expect(
      isInteractionBaitPost("Buy low on Drake London — his usage says the breakout is coming"),
    ).toBe(false);
    expect(isInteractionBaitPost("Snap counts: Mason played 78% while Aaron Jones sat")).toBe(false);
    expect(isInteractionBaitPost("Justin Jefferson is questionable for Sunday")).toBe(false);
  });
});

describe("material practice-status notes", () => {
  it("accepts Shakir-form missed practice / personal notes", () => {
    expect(isMaterialPracticeStatusNote("Khalil Shakir missed Friday practice, personal")).toBe(true);
    expect(isMaterialPracticeStatusNote("Shakir DNP Friday — personal matter")).toBe(true);
    expect(isMaterialPracticeStatusNote("Doubs limited in Friday practice")).toBe(true);
    expect(isMaterialPracticeStatusNote("Jefferson returns to practice")).toBe(true);
  });

  it("rejects trivial practice chatter without a status change", () => {
    expect(isMaterialPracticeStatusNote("Shakir was at practice today")).toBe(false);
    expect(isMaterialPracticeStatusNote("Bills practice notes and media availability")).toBe(false);
  });

  it("tags drafts with practice signal for material notes", () => {
    const tagged = withPracticeStatusTag({
      change: "Khalil Shakir missed Friday practice, personal",
      roleContext: "Beat report via team notes.",
      signal: null,
      tags: ["beat"],
    });
    expect(tagged.tags).toContain(PRACTICE_NEWS_TAG);
    expect(tagged.tags).toContain("beat");
    expect(tagged.signal).toBe(PRACTICE_NEWS_TAG);
  });
});
