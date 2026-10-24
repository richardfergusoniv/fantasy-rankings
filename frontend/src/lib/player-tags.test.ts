import { describe, expect, it } from "vitest";
import { profileTag } from "./player-tags";

describe("profileTag", () => {
  it("tags a steady scorer as high floor", () => {
    expect(profileTag([12, 13, 14, 12, 15, 13, 14, 12, 13, 14])).toBe("High floor");
  });

  it("tags wild swings on both sides as boom/bust", () => {
    expect(profileTag([2, 3, 24, 2, 26, 3, 25, 2, 12, 11])).toBe("Boom/Bust");
  });

  it("tags a player with big top-end weeks but a normal bottom as high ceiling", () => {
    expect(profileTag([8, 9, 10, 9, 10, 20, 22, 10, 9, 21])).toBe("High ceiling");
  });

  it("gives no tag to an ordinary spread", () => {
    expect(profileTag([3, 5, 8, 10, 12, 14, 9, 16, 6, 11])).toBeNull();
  });

  it("gives no tag before eight games or when the median is zero", () => {
    expect(profileTag([12, 13, 14, 12, 15, 13, 14])).toBeNull();
    expect(profileTag([0, 0, 0, 0, 0, 0, 0, 0, 10, 12])).toBeNull();
  });
});
