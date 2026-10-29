/**
 * League-aware chat tools: rules, every team, player search/compare, and
 * playoff odds. Read-only; built from the user's cached dashboard plus the
 * Sleeper matchup schedule for playoff odds.
 */
import { z } from "zod";
import type { Dashboard } from "./dashboard-schemas.js";
import {
  findLeague,
  leagueAssets,
  loadDashboard,
  normalizeName,
  type ChatToolContext,
} from "./chat-tools.js";
import { summarizeLeagueRules } from "./league-rules.js";
import { simulatePlayoffOdds, type OddsGame } from "./playoff-odds.js";
import { fetchJson, SLEEPER_BASE } from "./sleeper.js";

type League = Dashboard["leagues"][number];
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const leagueOnly = z.object({ leagueId: z.string().min(1).max(80) }).strict();
const teamsSchema = z
  .object({ leagueId: z.string().min(1).max(80), teamName: z.string().min(1).max(80).optional() })
  .strict();
const searchSchema = z
  .object({
    leagueId: z.string().min(1).max(80).optional(),
    position: z.enum(["QB", "RB", "WR", "TE", "K"]).optional(),
    availability: z.enum(["any", "free_agent", "rostered", "mine"]).optional(),
    sortBy: z.enum(["week_projection", "value", "trending_adds"]).optional(),
    names: z.array(z.string().min(1).max(120)).max(6).optional(),
    limit: z.number().int().positive().max(25).optional(),
  })
  .strict();

export async function toolGetLeagueRules(ctx: ChatToolContext, args: { leagueId: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };
  return {
    ok: true as const,
    leagueId: league.id,
    name: league.name,
    season: dashboard.season,
    week: dashboard.week,
    rules: summarizeLeagueRules(league),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

type PositionProfile = { strengths: string[]; needs: string[] };

function positionProfiles(league: League): Map<number, PositionProfile & { values: Record<string, number> }> {
  const rows = league.powerRankingsSeasonLong.length > 0 ? league.powerRankingsSeasonLong : league.powerRankingsWeek;
  const medians = Object.fromEntries(POSITIONS.map((pos) => [pos, median(rows.map((row) => row.positionValues[pos]))]));
  const out = new Map<number, PositionProfile & { values: Record<string, number> }>();
  for (const row of rows) {
    const ratios = POSITIONS.map((pos) => ({
      pos,
      ratio: medians[pos]! > 0 ? row.positionValues[pos] / medians[pos]! : 1,
    })).sort((a, b) => b.ratio - a.ratio);
    out.set(row.rosterId, {
      strengths: ratios.filter((r) => r.ratio >= 1.1).slice(0, 2).map((r) => r.pos),
      needs: ratios.filter((r) => r.ratio <= 0.9).slice(-2).map((r) => r.pos).reverse(),
      values: Object.fromEntries(POSITIONS.map((pos) => [pos, row.positionValues[pos]])),
    });
  }
  return out;
}

export async function toolGetLeagueTeams(ctx: ChatToolContext, args: { leagueId: string; teamName?: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };
  const valueById = new Map(leagueAssets(dashboard, league.id).map((row) => [row.playerId, row.value]));
  const profiles = positionProfiles(league);
  const mine = league.tradeTeams.find((team) => team.isUser);
  const myProfile = mine ? profiles.get(mine.rosterId) : undefined;
  const needle = args.teamName ? normalizeName(args.teamName) : "";

  const teams = league.tradeTeams
    .filter((team) => !needle || normalizeName(team.teamName).includes(needle))
    .map((team) => {
      const profile = profiles.get(team.rosterId);
      const standing = (league.standings ?? []).find((row) => row.rosterId === team.rosterId) ?? null;
      const power = [...league.powerRankingsSeasonLong, ...league.powerRankingsWeek].find((row) => row.rosterId === team.rosterId);
      const assets = team.players
        .map((player) => ({
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          team: player.team,
          projection: player.projection,
          value: valueById.get(player.playerId) ?? null,
          injuryStatus: player.injuryStatus,
        }))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const fit = !team.isUser && profile && myProfile
        ? {
          theyCanOffer: profile.strengths.filter((pos) => myProfile.needs.includes(pos)),
          theyNeedWhatYouHave: profile.needs.filter((pos) => myProfile.strengths.includes(pos)),
        }
        : null;
      return {
        teamName: team.teamName,
        isUser: team.isUser,
        record: team.record ?? null,
        standing: standing
          ? { rank: standing.rank, pointsFor: standing.pointsFor, pointsAgainst: standing.pointsAgainst, playoffSeed: standing.playoffSeed }
          : null,
        totalValue: power?.totalValue ?? null,
        futurePickValue: power?.futurePickValue ?? null,
        positionValues: profile?.values ?? null,
        strengths: profile?.strengths ?? [],
        needs: profile?.needs ?? [],
        tradeFit: fit,
        pickCount: team.ownedPicks.length,
        ...(needle
          ? { roster: assets, picks: team.ownedPicks.map((pick) => ({ name: pick.name, value: pick.value })) }
          : { topAssets: assets.slice(0, 6) }),
      };
    });
  if (teams.length === 0) return { ok: false as const, error: "No team matched that name." };
  return {
    ok: true as const,
    leagueId: league.id,
    isDynasty: league.seasonLongFormat.isDynasty,
    note: "Strengths/needs compare a team's roster value at a position with the league median (>=10% above / below). Values are FantasyCalc trade value for this league's format.",
    teams,
  };
}

export async function toolSearchPlayers(ctx: ChatToolContext, args: z.infer<typeof searchSchema>) {
  const dashboard = await loadDashboard(ctx);
  const league = (args.leagueId ? findLeague(dashboard, args.leagueId) : null)
    ?? (ctx.defaultLeagueId ? findLeague(dashboard, ctx.defaultLeagueId) : null)
    ?? dashboard.leagues[0]
    ?? null;
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const weekly = new Map(dashboard.rankings.filter((row) => row.leagueId === league.id).map((row) => [row.playerId, row]));
  const season = new Map(leagueAssets(dashboard, league.id).filter((row) => row.position !== "PICK").map((row) => [row.playerId, row]));
  const owner = new Map(league.rosterAssignments.map((row) => [row.playerId, row]));
  const rostered = new Set(league.rosteredPlayerIds);
  const mineIds = new Set([...league.starters, ...league.bench].map((player) => player.playerId));

  const rows = [...new Set([...weekly.keys(), ...season.keys()])].map((playerId) => {
    const w = weekly.get(playerId);
    const s = season.get(playerId);
    const trend = dashboard.playerTrending[playerId] ?? null;
    const assignment = owner.get(playerId);
    return {
      playerId,
      name: w?.name ?? s?.name ?? playerId,
      team: w?.team ?? s?.team ?? null,
      position: w?.position ?? s?.position ?? "",
      weekProjection: w?.leagueProjection ?? null,
      weekRank: w?.leagueRank ?? null,
      opponent: w?.opponent ?? null,
      isBye: w?.isBye ?? false,
      injuryStatus: w?.injuryStatus ?? null,
      value: s?.value ?? null,
      overallRank: s?.overallRank ?? null,
      positionRank: s?.positionRank ?? null,
      valueTrend30Day: s?.trend30Day ?? null,
      sleeperAdds: trend?.adds ?? null,
      sleeperDrops: trend?.drops ?? null,
      owner: mineIds.has(playerId) ? "you" : assignment ? assignment.teamName : rostered.has(playerId) ? "rostered" : "free agent",
    };
  });

  const names = (args.names ?? []).map(normalizeName).filter(Boolean);
  let picked: typeof rows;
  if (names.length > 0) {
    picked = names
      .map((needle) => rows.filter((row) => normalizeName(row.name).includes(needle))
        .sort((a, b) => (a.overallRank ?? 1e9) - (b.overallRank ?? 1e9))[0])
      .filter((row): row is (typeof rows)[number] => Boolean(row));
  } else {
    const key = args.sortBy ?? "week_projection";
    const sortValue = (row: (typeof rows)[number]) =>
      (key === "value" ? row.value : key === "trending_adds" ? row.sleeperAdds : row.weekProjection) ?? -1;
    picked = rows
      .filter((row) => !args.position || row.position === args.position)
      .filter((row) => {
        switch (args.availability ?? "any") {
          case "free_agent": return row.owner === "free agent";
          case "rostered": return row.owner !== "free agent";
          case "mine": return row.owner === "you";
          default: return true;
        }
      })
      .sort((a, b) => sortValue(b) - sortValue(a))
      .slice(0, args.limit ?? 10);
  }
  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    scoringLabel: league.scoringLabel,
    note: "weekProjection is league-scored for this week; value is FantasyCalc trade value in this league's format; sleeperAdds/Drops are recent Sleeper-wide trends.",
    players: picked,
    ...(names.length > 0 && picked.length < names.length ? { unmatched: names.length - picked.length } : {}),
  };
}

type SleeperMatchupRow = { roster_id: number; matchup_id?: number | null };

export async function toolGetPlayoffOdds(ctx: ChatToolContext, args: { leagueId: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };
  const standings = league.standings ?? [];
  const playoffTeams = league.playoffs?.teams ?? null;
  if (standings.length < 2 || !playoffTeams) {
    return { ok: false as const, error: "Standings or playoff settings are not available for this league." };
  }
  const lastRegularWeek = league.playoffs.weekStart ? league.playoffs.weekStart - 1 : 14;
  const gamesPlayed = Math.max(...standings.map((row) => row.wins + row.losses + row.ties));
  const firstWeek = gamesPlayed + 1;
  const weeks = Array.from({ length: Math.max(0, lastRegularWeek - firstWeek + 1) }, (_, i) => firstWeek + i);

  const results = await Promise.allSettled(
    weeks.map((week) => fetchJson<SleeperMatchupRow[]>(`${SLEEPER_BASE}/league/${league.id}/matchups/${week}`)),
  );
  const games: OddsGame[] = [];
  const missingWeeks: number[] = [];
  results.forEach((result, i) => {
    const week = weeks[i]!;
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
      missingWeeks.push(week);
      return;
    }
    const byMatchup = new Map<number, number[]>();
    for (const row of result.value) {
      if (row.matchup_id == null) continue;
      byMatchup.set(row.matchup_id, [...(byMatchup.get(row.matchup_id) ?? []), row.roster_id]);
    }
    for (const pair of byMatchup.values()) {
      if (pair.length === 2) games.push({ week, a: pair[0]!, b: pair[1]! });
    }
  });
  if (weeks.length > 0 && games.length === 0) {
    return { ok: false as const, error: "The remaining schedule could not be loaded from Sleeper." };
  }

  const odds = simulatePlayoffOdds({
    teams: standings.map((row) => ({
      rosterId: row.rosterId,
      teamName: row.teamName,
      isUser: row.isUser,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
    })),
    games,
    playoffTeams,
  });

  const me = standings.find((row) => row.isUser) ?? null;
  const name = new Map(standings.map((row) => [row.rosterId, row]));
  const ppg = (row: (typeof standings)[number] | undefined) => {
    const played = row ? row.wins + row.losses + row.ties : 0;
    return row && played > 0 ? Math.round((row.pointsFor / played) * 10) / 10 : null;
  };
  const myGames = me ? games.filter((game) => game.a === me.rosterId || game.b === me.rosterId).sort((a, b) => a.week - b.week) : [];
  const mine = odds.teams.find((team) => team.isUser) ?? null;

  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    playoffTeams,
    regularSeasonEndsWeek: lastRegularWeek,
    method: `Simulated ${odds.trials} seasons. Each team scores at its points-per-game so far (blended toward the league average early); games are decided by that gap with typical weekly variance. Seeding is wins, then points for. This is an estimate, not an app score.`,
    caveats: [
      ...(league.playoffs.positionKnown === false ? ["League has divisions; division winners are not modeled, so odds are approximate."] : []),
      ...(missingWeeks.length > 0 ? [`Schedule unavailable for week(s) ${missingWeeks.join(", ")}; those games are left out.`] : []),
      "Assumes every team plays each remaining week and no bye weeks.",
    ],
    you: mine
      ? {
        record: mine.record,
        playoffPct: mine.playoffPct,
        topSeedPct: mine.topSeedPct,
        projectedWins: mine.projectedWins,
        status: mine.playoffPct >= 99.9 ? "all but clinched in the model" : mine.playoffPct <= 0.1 ? "all but eliminated in the model" : "in the race",
        remainingOpponents: myGames.map((game) => {
          const opp = name.get(game.a === me!.rosterId ? game.b : game.a);
          return { week: game.week, opponent: opp?.teamName ?? "Unknown", opponentRecord: opp ? `${opp.wins}-${opp.losses}${opp.ties ? `-${opp.ties}` : ""}` : null, opponentPointsPerGame: ppg(opp) };
        }),
        finalWinScenarios: odds.userScenarios,
      }
      : null,
    teams: odds.teams,
  };
}

export async function dispatchLeagueChatTool(
  name: string,
  rawArgs: unknown,
  ctx: ChatToolContext,
): Promise<unknown | null> {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const invalid = (issues: unknown) => ({ ok: false, error: "Invalid arguments.", issues });
  switch (name) {
    case "get_league_rules": {
      const parsed = leagueOnly.safeParse(args);
      return parsed.success ? toolGetLeagueRules(ctx, parsed.data) : invalid(parsed.error.issues);
    }
    case "get_league_teams": {
      const parsed = teamsSchema.safeParse(args);
      return parsed.success ? toolGetLeagueTeams(ctx, parsed.data) : invalid(parsed.error.issues);
    }
    case "search_players": {
      const parsed = searchSchema.safeParse(args);
      return parsed.success ? toolSearchPlayers(ctx, parsed.data) : invalid(parsed.error.issues);
    }
    case "get_playoff_odds": {
      const parsed = leagueOnly.safeParse(args);
      return parsed.success ? toolGetPlayoffOdds(ctx, parsed.data) : invalid(parsed.error.issues);
    }
    default:
      return null;
  }
}
