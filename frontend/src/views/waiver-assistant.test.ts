import { describe, expect, it } from "vitest";
import { bestWaiverGrade, waiverAssistantAnswer } from "./waiver-assistant";
import type { League } from "../dashboard-types";

type Grade = NonNullable<League["waiverGrades"]>[number];
const grade = (over: Partial<Grade>): Grade => ({
  playerId: "add", name: "T. Vance", position: "RB", team: "KC", projection: 9.4, label: "Add", score: 60,
  dropCandidate: { playerId: "drop", name: "C. Dunn", value: 850 },
  bid: { kind: "faab", low: 5, high: 13, note: "Contested add." }, ros: null, ...over,
});
const league = (grades: Grade[]) => ({
  waiverGrades: grades,
  starters: [],
  bench: [{ playerId: "drop", name: "C. Dunn", team: "DEN", position: "RB", projection: 3.2, injuryStatus: "Questionable" }],
}) as unknown as Pick<League, "waiverGrades" | "starters" | "bench">;

describe("bestWaiverGrade", () => {
  it("prefers Must add over Add, then the higher score, and ignores Watch", () => {
    const best = bestWaiverGrade([grade({ playerId: "a", label: "Add", score: 90 }), grade({ playerId: "b", label: "Must add", score: 50 }), grade({ playerId: "c", label: "Must add", score: 70 }), grade({ playerId: "w", label: "Watch", score: 99 })]);
    expect(best?.playerId).toBe("c");
    expect(bestWaiverGrade([grade({ label: "Watch" })])).toBeNull();
    expect(bestWaiverGrade(undefined)).toBeNull();
  });
});

describe("waiverAssistantAnswer", () => {
  it("returns null with no featured add", () => {
    expect(waiverAssistantAnswer(league([]), {})).toBeNull();
  });

  it("pairs the add with the drop and formats the FAAB bid", () => {
    const answer = waiverAssistantAnswer(league([grade({})]), { add: { adds: 1240 } })!;
    expect(answer.add.name).toBe("T. Vance");
    expect(answer.drop?.name).toBe("C. Dunn");
    expect(answer.bid).toBe("$5–13");
    expect(answer.compare.find((row) => row.label === "Projection this week")?.values).toEqual(["9.4", "3.2"]);
    expect(answer.compare.find((row) => row.label === "Injury")?.values).toEqual(["None", "Questionable"]);
    expect(answer.facts.find((fact) => fact.label === "Sleeper adds, 24 hours")?.value).toBe("1,240");
  });

  it("describes rest-of-season evidence and a priority league's note", () => {
    const answer = waiverAssistantAnswer(league([grade({
      bid: { kind: "priority", note: "You're 3rd in line." },
      ros: { pointsGained: 8.4, coveredWeeks: [12, 13, 14], missingWeeks: [], asOf: null, partial: false, startsInWeeks: [{ week: 12, note: "Starter bye" }], designatedPlayers: [], designatedProjectedShare: null, absentPlayers: ["Okafor"] },
    })]), {})!;
    expect(answer.bid).toBe("Priority");
    expect(answer.facts.find((fact) => fact.label === "Rest-of-season gain")?.value).toBe("+8.4 pts over weeks 12–14");
    expect(answer.facts.find((fact) => fact.label === "Starts in week 12")?.value).toBe("Starter bye");
    expect(answer.facts.find((fact) => fact.label === "Out in those weeks")?.value).toBe("Okafor");
    expect(answer.facts.find((fact) => fact.label === "Waiver priority")?.value).toBe("You're 3rd in line.");
  });

  it("works when there is no drop to suggest", () => {
    const answer = waiverAssistantAnswer(league([grade({ dropCandidate: null })]), {})!;
    expect(answer.drop).toBeNull();
    expect(answer.compare.find((row) => row.label === "Projection this week")?.values).toEqual(["9.4", "—"]);
  });
});
