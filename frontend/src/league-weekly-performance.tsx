import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { LoadingBlock } from "./components/state-blocks";
import { SectionError } from "./section-error";
import { personalQueryKey, useViewerIdentity } from "./viewer-scope";
import { formatDecimal } from "./lib/format-number";

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
  if (query.isPending) return <LoadingBlock label="Loading weekly performance…" />;
  if (query.isError || !query.data) return <SectionError compact title="Weekly performance didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  const missing = query.data.weeks.some((week) => !week.teams?.some((team) => team.rosterId === rosterId));
  return (
    <div className="team-weekly-performance">
      <p className="team-weekly-caption">Regular season · Compared with every other team</p>
      <table className="team-weekly-table">
        <caption className="sr-only">Weekly points, all-play record and rank out of {query.data.teamCount} teams</caption>
        <thead><tr><th scope="col">Week</th><th scope="col">Points</th><th scope="col">All-play</th><th scope="col">Rank</th></tr></thead>
        <tbody>{query.data.weeks.map((week) => {
          const team = week.teams?.find((item) => item.rosterId === rosterId);
          return <tr key={week.week} className={week.kind === "projected" ? "is-projected" : undefined}>
            <th scope="row"><span>Week {week.week}</span><small>{week.kind === "actual" ? "Actual" : "Projected"}</small></th>
            {team ? <>
              <td>{formatDecimal(team.points, 2)}</td>
              <td>{team.wins}–{team.losses}{team.ties > 0 ? `–${team.ties}` : ""}</td>
              <td><span className="sr-only">Rank </span>{team.rank}<span className="team-weekly-denominator"> / {query.data.teamCount}</span></td>
            </> : <td colSpan={3} className="team-weekly-unavailable">Unavailable</td>}
          </tr>;
        })}</tbody>
      </table>
      <details className="team-weekly-method">
        <summary>How this is scored</summary>
        <p>All-play is wins–losses–ties against every other team’s score that week. Tied scores share a rank. Completed weeks use Sleeper’s recorded scores.</p>
        <p>The current week follows current lineups and live forecasts. Later weeks use Sleeper’s weekly projections and the best lineup from each team’s current roster.</p>
      </details>
      {missing ? <SectionError compact title="Some weeks are unavailable." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} /> : null}
    </div>
  );
}
