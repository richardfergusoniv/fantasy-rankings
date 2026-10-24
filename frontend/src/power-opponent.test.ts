import { describe, expect, it } from "vitest";
import { weeklyOpponentRosterId } from "./power-opponent";

const teams = [
  { rosterId: 1, teamName: "My Team", isUser: true },
  { rosterId: 2, teamName: "Rival", isUser: false },
  { rosterId: 3, teamName: "Other", isUser: false },
];

describe("weeklyOpponentRosterId", () => {
  it("returns the one non-user team that matches this week's opponent", () => {
    expect(weeklyOpponentRosterId("Rival", teams)).toBe(2);
  });

  it("returns nothing on a bye, a missing name, or an unmatched opponent", () => {
    expect(weeklyOpponentRosterId(null, teams)).toBeNull();
    expect(weeklyOpponentRosterId(undefined, teams)).toBeNull();
    expect(weeklyOpponentRosterId("", teams)).toBeNull();
    expect(weeklyOpponentRosterId("Ghost", teams)).toBeNull();
  });

  it("uses the roster ID despite duplicate or mismatched display names", () => {
    const duplicateNames = [...teams, { rosterId: 4, teamName: "Rival", isUser: false }];
    expect(weeklyOpponentRosterId("Rival", duplicateNames, 4)).toBe(4);
    expect(weeklyOpponentRosterId("Opponent", teams, 2)).toBe(2);
    expect(weeklyOpponentRosterId("Rival", teams, 99)).toBeNull();
    expect(weeklyOpponentRosterId("Rival", teams, 1)).toBeNull();
  });

  it("does not highlight the user or an ambiguous name", () => {
    expect(weeklyOpponentRosterId("My Team", teams)).toBeNull();
    expect(weeklyOpponentRosterId("Rival", [...teams, { rosterId: 4, teamName: "Rival", isUser: false }])).toBeNull();
  });
});
