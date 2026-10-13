import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isReservedOwnerSleeperClaim,
  isUniqueViolation,
  sleeperIdLinkedToOtherUser,
} from "./auth.js";

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

describe("isReservedOwnerSleeperClaim", () => {
  it("is inactive until both owner env ids are set", () => {
    assert.equal(
      isReservedOwnerSleeperClaim({
        sleeperUserId: "owner-sleeper",
        requestingUserId: "attacker",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: null,
      }),
      false,
    );
  });

  it("blocks non-owners from claiming the configured owner Sleeper id", () => {
    assert.equal(
      isReservedOwnerSleeperClaim({
        sleeperUserId: "owner-sleeper",
        requestingUserId: "attacker",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: "owner-supabase",
      }),
      true,
    );
  });

  it("allows the configured owner to link their Sleeper id", () => {
    assert.equal(
      isReservedOwnerSleeperClaim({
        sleeperUserId: "owner-sleeper",
        requestingUserId: "owner-supabase",
        ownerSleeperUserId: "owner-sleeper",
        ownerUserId: "owner-supabase",
      }),
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects bare and drizzle-wrapped Postgres unique_violation codes", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation(Object.assign(new Error("wrap"), { cause: { code: "23505" } })), true);
    assert.equal(isUniqueViolation({ code: "23503" }), false);
    assert.equal(isUniqueViolation(new Error("nope")), false);
  });
});
