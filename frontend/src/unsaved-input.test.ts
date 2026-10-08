import { describe, expect, it } from "vitest";
import { shouldWarnBeforeLeave } from "./unsaved-input";

describe("shouldWarnBeforeLeave", () => {
  it("warns only while a trade has assets or a saved-view name is partly typed", () => {
    expect(shouldWarnBeforeLeave({ tradeAssetCount: 0, savedViewNaming: false, savedViewName: "" })).toBe(false);
    expect(shouldWarnBeforeLeave({ tradeAssetCount: 0, savedViewNaming: true, savedViewName: "   " })).toBe(false);
    expect(shouldWarnBeforeLeave({ tradeAssetCount: 0, savedViewNaming: false, savedViewName: "Upside" })).toBe(false);
    expect(shouldWarnBeforeLeave({ tradeAssetCount: 2, savedViewNaming: false, savedViewName: "" })).toBe(true);
    expect(shouldWarnBeforeLeave({ tradeAssetCount: 0, savedViewNaming: true, savedViewName: "Up" })).toBe(true);
  });
});
