import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { sleeperIdLinkedToOtherUser } from "./auth.js";

describe("sleeperIdLinkedToOtherUser", () => {
  it("allows a first-time link when no existing owner", () => {
    assert.equal(sleeperIdLinkedToOtherUser(null, "user-a"), false);
    assert.equal(sleeperIdLinkedToOtherUser(undefined, "user-a"), false);
  });

  it("allows the same Supabase user to refresh their own link", () => {
    assert.equal(sleeperIdLinkedToOtherUser("user-a", "user-a"), false);
  });

  it("refuses a Sleeper id already linked to a different Supabase user", () => {
    assert.equal(sleeperIdLinkedToOtherUser("user-owner", "user-attacker"), true);
  });
});
