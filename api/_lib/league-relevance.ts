/**
 * Pure per-user league matching. No network or database access, so the
 * news filter and cache-key rules can be tested without Sleeper.
 *
 * A viewer's feed includes three groups inside their own leagues:
 * their roster, other teams in those leagues, and free agents (players
 * not rostered in that league). League-wide headlines pass through once
 * the viewer has at least one league.
 */

export type AvailabilityStatus = "available" | "your_roster" | "other_roster" | "unknown";

export type RosterSlot = {
  ownerId: string | null;
  playerIds: string[];
};

export type LeagueRosters = {
  id: string;
  name: string;
  /** Null when that league's roster request failed. */
  rosters: RosterSlot[] | null;
};

export type PlayerLeagueAvailability = {
  leagueId: string;
  league: string;
  status: AvailabilityStatus;
};

export type NewsKind = "roster" | "waiver" | "headline";

export type NewsCandidate = {
  playerId: string;
  newsType: NewsKind;
};

export type AnnotatedNews<T> = T & {
  leagueIds: string[];
  leagues: string[];
  availability: PlayerLeagueAvailability[];
};

const LEAGUE_DATA_TTL_MS = 10 * 60 * 1000;

export function leagueDataTtlMs(): number {
  return LEAGUE_DATA_TTL_MS;
}

export function userLeaguesCacheKey(sleeperUserId: string, season: number): string {
  return `sleeper-user-leagues-v1:${sleeperUserId}:${season}`;
}

export function leagueRostersCacheKey(leagueId: string): string {
  return `sleeper-league-rosters-v1:${leagueId}`;
}

export function nflStateCacheKey(): string {
  return "sleeper-nfl-state-v1";
}

export function classifyPlayer(
  playerId: string,
  sleeperUserId: string,
  league: LeagueRosters,
): PlayerLeagueAvailability {
  if (league.rosters === null) {
    return { leagueId: league.id, league: league.name, status: "unknown" };
  }
  const owning = league.rosters.find((roster) => roster.playerIds.includes(playerId));
  if (!owning) {
    return { leagueId: league.id, league: league.name, status: "available" };
  }
  if (owning.ownerId === sleeperUserId) {
    return { leagueId: league.id, league: league.name, status: "your_roster" };
  }
  return { leagueId: league.id, league: league.name, status: "other_roster" };
}

function isLeagueHeadline(newsType: NewsKind, playerId: string): boolean {
  switch (newsType) {
    case "headline":
      return playerId.toLowerCase() === "league";
    case "roster":
    case "waiver":
      return false;
    default: {
      const exhaustive: never = newsType;
      return exhaustive;
    }
  }
}

/**
 * Empty league list → empty feed (the caller shows the no-leagues state).
 * Player items are included when the viewer rosters them, an opponent does,
 * or they are a free agent in a league whose rosters loaded. Items stay out
 * when every roster lookup failed, so a Sleeper outage does not fall back
 * to an unfiltered global feed.
 */
export function relevantNewsForUser<T extends NewsCandidate>(
  items: T[],
  sleeperUserId: string,
  leagues: LeagueRosters[],
): Array<AnnotatedNews<T>> {
  if (leagues.length === 0) return [];
  return items.flatMap((item) => {
    if (isLeagueHeadline(item.newsType, item.playerId)) {
      return [{
        ...item,
        leagueIds: [],
        leagues: [],
        availability: [],
      }];
    }
    const availability = leagues.map((league) => classifyPlayer(item.playerId, sleeperUserId, league));
    const rostered = availability.filter((entry) => entry.status === "your_roster" || entry.status === "other_roster");
    const freeAgentSomewhere = availability.some((entry) => entry.status === "available");
    if (rostered.length === 0 && !freeAgentSomewhere) return [];
    return [{
      ...item,
      leagueIds: rostered.map((entry) => entry.leagueId),
      leagues: rostered.map((entry) => entry.league),
      availability,
    }];
  });
}

export function asNewsKind(value: string): NewsKind {
  switch (value) {
    case "roster":
      return "roster";
    case "waiver":
      return "waiver";
    case "headline":
      return "headline";
    default:
      return "roster";
  }
}
