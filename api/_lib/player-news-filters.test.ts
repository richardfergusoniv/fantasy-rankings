import { describe, expect, it } from "vitest";
import { isInteractionBaitPost } from "./player-news-filters.js";

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
