import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { LoadingBlock } from "./components/state-blocks";
import { SectionError } from "./section-error";
import { personalQueryKey, useViewerIdentity } from "./viewer-scope";
import { formatDecimal } from "./lib/format-number";
import type { LeagueWeeklyPerformance as LeagueWeeklyPerformanceData } from "../../api/_lib/league-weekly-performance";

type Totals = { points: number; wins: number; losses: number; ties: number; rank: number };

function allPlayTotals(data: LeagueWeeklyPerformanceData, rosterId: number): Totals | null {
  const completeWeeks = data.weeks.filter((week) => week.teams !== null && week.teams.length === data.teamCount);
  if (completeWeeks.length === 0) return null;

  const byRoster = new Map<number, { points: number; wins: number; losses: number; ties: number }>();
  for (const week of completeWeeks) {
    for (const team of week.teams!) {
      const prior = byRoster.get(team.rosterId) ?? { points: 0, wins: 0, losses: 0, ties: 0 };
      byRoster.set(team.rosterId, {
        points: prior.points + team.points,
        wins: prior.wins + team.wins,
        losses: prior.losses + team.losses,
        ties: prior.ties + team.ties,
      });
    }
  }

  const mine = byRoster.get(rosterId);
  if (!mine) return null;

  const ranked = [...byRoster.entries()]
    .map(([id, totals]) => ({ rosterId: id, ...totals }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.points - a.points || a.rosterId - b.rosterId);
  const rank = ranked.findIndex((row) => row.rosterId === rosterId) + 1;
  return { ...mine, rank };
}

function formatRecord(wins: number, losses: number, ties: number): string {
  return `${wins}–${losses}${ties > 0 ? `–${ties}` : ""}`;
}

export function LeagueWeeklyPerformance({ leagueId, rosterId, season, snapshotAsOf }: {
  leagueId: string; rosterId: number; season: number; snapshotAsOf: string | null;
}) {
  const viewer = useViewerIdentity();
  const query = useQuery({
    queryKey: personalQueryKey(viewer, "league-weekly-performance", leagueId, season, snapshotAsOf),
    queryFn: () => api.getLeagueWeeklyPerformance({ leagueId }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const totals = useMemo(
    () => (query.data ? allPlayTotals(query.data, rosterId) : null),
    [query.data, rosterId],
  );
  if (query.isPending) return <LoadingBlock label="Loading all-play…" />;
  if (query.isError || !query.data) return <SectionError compact title="All-play didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  const missing = query.data.weeks.some((week) => !week.teams?.some((team) => team.rosterId === rosterId));
  return (
    <div className="team-weekly-performance">
      <table className="team-weekly-table">
        <caption className="sr-only">All-play points, record and rank out of {query.data.teamCount} teams</caption>
        <thead><tr><th scope="col">Week</th><th scope="col">Points</th><th scope="col">All-play</th><th scope="col">Rank</th></tr></thead>
        <tbody>
          {totals ? (
            <tr className="is-total">
              <th scope="row"><span>Total</span></th>
              <td>{formatDecimal(totals.points, 2)}</td>
              <td>{formatRecord(totals.wins, totals.losses, totals.ties)}</td>
              <td><span className="sr-only">Rank </span>{totals.rank}<span className="team-weekly-denominator"> / {query.data.teamCount}</span></td>
            </tr>
          ) : null}
          {query.data.weeks.map((week) => {
            const team = week.teams?.find((item) => item.rosterId === rosterId);
            return <tr key={week.week} className={week.kind === "projected" ? "is-projected" : undefined}>
              <th scope="row"><span>Week {week.week}</span><small>{week.kind === "actual" ? "Actual" : "Projected"}</small></th>
              {team ? <>
                <td>{formatDecimal(team.points, 2)}</td>
                <td>{formatRecord(team.wins, team.losses, team.ties)}</td>
                <td><span className="sr-only">Rank </span>{team.rank}<span className="team-weekly-denominator"> / {query.data.teamCount}</span></td>
              </> : <td colSpan={3} className="team-weekly-unavailable">Unavailable</td>}
            </tr>;
          })}
        </tbody>
      </table>
      {missing ? <SectionError compact title="Some weeks are unavailable." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} /> : null}
    </div>
  );
}
