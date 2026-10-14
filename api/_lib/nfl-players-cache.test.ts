import { describe, expect, it } from "vitest";
import {
  NFL_PLAYERS_MIN_COUNT,
  compactSleeperPlayers,
  isActiveNflRosterPlayer,
  resolvePlayerTeam,
  rosterEntryToSleeperPlayer,
  selectRosterRefreshOutcome,
} from "./nfl-players-cache.js";
import type { SleeperPlayer } from "./sleeper.js";

describe("compactSleeperPlayers", () => {
  it("keeps roster fields and drops bulky Sleeper metadata", () => {
    const raw: Record<string, SleeperPlayer & Record<string, unknown>> = {
      "11628": {
        full_name: "Marvin Harrison",
        first_name: "Marvin",
        last_name: "Harrison",
        team: "HOU",
        status: "Active",
        position: "WR",
        injury_status: null,
        years_exp: 2,
        hashtag: "#marvinharrison-NFL-HOU-18",
        metadata: { channel_id: "x", rookie_year: "2024" },
        sportradar_id: "e8da21a8-796d-48a2-b644-57d08983ae01",
      },
    };
    const compact = compactSleeperPlayers(raw);
    expect(compact["11628"]).toEqual({
      team: "HOU",
      status: "Active",
      position: "WR",
      full_name: "Marvin Harrison",
      first_name: "Marvin",
      last_name: "Harrison",
      injury_status: null,
      years_exp: 2,
    });
    expect(compact["11628"]).not.toHaveProperty("hashtag");
    expect(compact["11628"]).not.toHaveProperty("metadata");
    expect(compact["11628"]).not.toHaveProperty("sportradar_id");
  });
});

describe("resolvePlayerTeam", () => {
  it("prefers Sleeper HOU over a stale FantasyCalc ARI team for Marvin Harrison Jr.", () => {
    expect(resolvePlayerTeam({ team: "HOU" }, "ARI")).toBe("HOU");
  });

  it("keeps free-agent / cut players as no team even when FantasyCalc still has a club", () => {
    expect(resolvePlayerTeam({ team: null }, "ATL")).toBeNull();
    expect(resolvePlayerTeam({ team: "" }, "SF")).toBeNull();
  });

  it("falls back to FantasyCalc only when the player is missing from the Sleeper map", () => {
    expect(resolvePlayerTeam(undefined, "DET")).toBe("DET");
    expect(resolvePlayerTeam(undefined, null)).toBeNull();
  });
});

describe("isActiveNflRosterPlayer", () => {
  it("includes skill players and kickers currently on an NFL team", () => {
    expect(isActiveNflRosterPlayer({
      full_name: "Marvin Harrison",
      team: "HOU",
      position: "WR",
    })).toBe(true);
    expect(isActiveNflRosterPlayer({
      full_name: "Younghoe Koo",
      team: "ATL",
      position: "K",
    })).toBe(true);
  });

  it("excludes cut or free-agent kickers so they do not appear as rostered", () => {
    for (const name of [
      "Younghoe Koo",
      "Jake Moody",
      "Justin Tucker",
      "Brandon McManus",
      "Cade York",
      "Joshua Karty",
      "Austin Seibert",
      "Anders Carlson",
      "Harrison Mevis",
      "Matt Prater",
      "Greg Zuerlein",
      "Dustin Hopkins",
    ]) {
      expect(isActiveNflRosterPlayer({
        full_name: name,
        team: null,
        position: "K",
      })).toBe(false);
    }
  });
});

describe("rosterEntryToSleeperPlayer", () => {
  it("round-trips compact entries into the SleeperPlayer shape consumers expect", () => {
    const sleeper = rosterEntryToSleeperPlayer({
      team: null,
      status: "Active",
      position: "K",
      full_name: "Younghoe Koo",
      injury_status: null,
      years_exp: 8,
    });
    expect(sleeper.team).toBeNull();
    expect(sleeper.status).toBe("Active");
    expect(resolvePlayerTeam(sleeper, "ATL")).toBeNull();
    expect(isActiveNflRosterPlayer(sleeper)).toBe(false);
  });
});

describe("selectRosterRefreshOutcome", () => {
  const healthy = compactSleeperPlayers(
    Object.fromEntries(
      Array.from({ length: NFL_PLAYERS_MIN_COUNT }, (_, index) => [
        String(index + 1),
        {
          full_name: `Player ${index + 1}`,
          team: "KC",
          position: "WR",
          status: "Active",
        } satisfies SleeperPlayer,
      ]),
    ),
  );
  const thin = compactSleeperPlayers({
    "1": { full_name: "Only One", team: "KC", position: "QB", status: "Active" },
  });

  it("commits a complete Sleeper dump", () => {
    const outcome = selectRosterRefreshOutcome(healthy, null);
    expect(outcome.action).toBe("commit");
    expect(Object.keys(outcome.players)).toHaveLength(NFL_PLAYERS_MIN_COUNT);
  });

  it("keeps the previous snapshot when Sleeper returns a thin dump", () => {
    const outcome = selectRosterRefreshOutcome(thin, healthy);
    expect(outcome).toEqual({ action: "keep-previous", players: healthy });
    expect(Object.keys(outcome.players)).toHaveLength(NFL_PLAYERS_MIN_COUNT);
    expect(outcome.players).not.toBe(thin);
  });

  it("reports empty when there is no previous snapshot and the dump is thin", () => {
    expect(selectRosterRefreshOutcome(thin, null)).toEqual({
      action: "empty",
      players: thin,
    });
  });
});
