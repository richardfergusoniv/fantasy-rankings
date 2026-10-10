import { describe, expect, it } from "vitest";
import { positionFilterTabAriaLabel, positionFilterTabLabel } from "./position-filter-labels";

describe("positionFilterTabLabel", () => {
  it("keeps position codes uppercase and shortens rookies to ROOK", () => {
    expect(positionFilterTabLabel("QB")).toBe("QB");
    expect(positionFilterTabLabel("RB")).toBe("RB");
    expect(positionFilterTabLabel("WR")).toBe("WR");
    expect(positionFilterTabLabel("TE")).toBe("TE");
    expect(positionFilterTabLabel("ALL")).toBe("ALL");
    expect(positionFilterTabLabel("FLEX")).toBe("FLEX");
    expect(positionFilterTabLabel("DEF")).toBe("DST");
    expect(positionFilterTabLabel("ROOKIES")).toBe("ROOK");
  });
});

describe("positionFilterTabAriaLabel", () => {
  it("keeps the full Rookies name for assistive tech", () => {
    expect(positionFilterTabAriaLabel("ROOKIES")).toBe("Rookies");
    expect(positionFilterTabAriaLabel("QB")).toBeUndefined();
    expect(positionFilterTabAriaLabel("DEF")).toBeUndefined();
  });
});
