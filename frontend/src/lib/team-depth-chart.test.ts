import { describe, expect, it } from "vitest";
import { abbreviatedName, buildTeamDepthChart } from "./team-depth-chart";

const canonical = (team: string | null) => (team === "JAC" ? "JAX" : team);
const player = (playerId: string, name: string, team: string, position: string, projection: number | null = null, injuryStatus: string | null = null) => ({
  playerId,
  name,
  team,
  position,
  leagueProjection: projection,
  injuryStatus,
});

describe("abbreviatedName", () => {
  it("shortens the first name and keeps the rest", () => {
    expect(abbreviatedName("Marcus Hale")).toBe("M. Hale");
    expect(abbreviatedName("Odell Beckham Jr.")).toBe("O. Beckham Jr.");
    expect(abbreviatedName("Kyler")).toBe("Kyler");
  });
});

describe("buildTeamDepthChart", () => {
  const depth = {
    wr1: { position: "WR", rank: 1 },
    wr2: { position: "WR", rank: 2 },
    wr3: { position: "WR", rank: 3 },
    wr4: { position: "WR", rank: 4 },
    qb1: { position: "QB", rank: 1 },
    other: { position: "WR", rank: 1 },
  };
  const players = [
    player("wr2", "Dev Park", "CIN", "WR", 11.8),
    player("wr1", "Marcus Hale", "CIN", "WR", 17.4),
    player("wr3", "Eli Navarro", "CIN", "WR", 8.2, "Questionable"),
    player("wr4", "Fourth Guy", "CIN", "WR"),
    player("qb1", "Colt Rivera", "CIN", "QB", 21.2),
    player("other", "Other Team", "BAL", "WR", 10),
    player("nochart", "Not Listed", "CIN", "RB"),
  ];

  it("places each player by depth rank, QB first, skipping other teams, unlisted players and rank 4+", () => {
    const rows = buildTeamDepthChart({ team: "CIN", players, depth, depthPrevious: {}, canonical });
    expect(rows.map((row) => row.position)).toEqual(["QB", "WR"]);
    const wr = rows[1];
    expect(wr?.cells.map((cell) => cell?.name)).toEqual(["Marcus Hale", "Dev Park", "Eli Navarro"]);
    expect(wr?.cells[2]?.injuryStatus).toBe("Questionable");
    expect(rows[0]?.cells.map((cell) => cell?.name ?? null)).toEqual(["Colt Rivera", null, null]);
  });

  it("flags a move from the previous chart", () => {
    const rows = buildTeamDepthChart({
      team: "CIN",
      players,
      depth,
      depthPrevious: { wr1: { position: "WR", rank: 2 }, wr2: { position: "WR", rank: 1 } },
      canonical,
    });
    const wr = rows.find((row) => row.position === "WR");
    expect(wr?.cells[0]?.change).toEqual({ direction: "up", position: "WR", from: 2 });
    expect(wr?.cells[1]?.change).toEqual({ direction: "down", position: "WR", from: 1 });
    expect(wr?.cells[2]?.change).toBeNull();
  });

  it("is empty when the team has nobody on the chart", () => {
    expect(buildTeamDepthChart({ team: "DAL", players, depth, depthPrevious: {}, canonical })).toEqual([]);
  });

  it("counts a player once", () => {
    const rows = buildTeamDepthChart({
      team: "CIN",
      players: [player("qb1", "Colt Rivera", "CIN", "QB"), player("qb1", "Colt Rivera", "CIN", "QB")],
      depth,
      depthPrevious: {},
      canonical,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells.filter(Boolean)).toHaveLength(1);
  });
});
