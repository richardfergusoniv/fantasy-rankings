import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { SectionError } from "./section-error";
import { formatDecimal } from "./lib/format-number";
import { recordLabel } from "./projected-standings-view";

export function LeagueOutcomes({ leagueId, queryKey }: { leagueId: string; queryKey: readonly unknown[] }) {
  const query = useQuery({
    queryKey,
    queryFn: () => api.getProjectedStandings({ leagueId }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (query.isPending) {
    return (
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading projected standings…">
        <span>Loading projected standings…</span>
        <div className="loading-shimmer loading-line wide" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return <SectionError title="Projected standings didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  }

  const { teams } = query.data;
  return (
    <section className="outcomes-view" aria-label="Projected standings">
      <div className="outcomes-chart" role="table" aria-label="Projected standings">
        <div className="outcomes-row outcomes-head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Team</span>
          <span role="columnheader">Now</span>
          <span role="columnheader">Proj.</span>
          <span role="columnheader">Proj. PF</span>
        </div>
        {teams.map((team, index) => (
          <div
            key={team.rosterId}
            className={`outcomes-row${team.isUser ? " is-user" : ""}${team.inPlayoffs && !teams[index + 1]?.inPlayoffs && index < teams.length - 1 ? " is-cut" : ""}`}
            role="row"
          >
            <span className="outcomes-rank" role="cell">{team.rank}</span>
            <strong className="outcomes-team" role="cell">{team.teamName}</strong>
            <span className="outcomes-now" role="cell">{recordLabel(team.record)}</span>
            <b className="outcomes-proj" role="cell">{recordLabel(team.projectedRecord)}</b>
            <span className="outcomes-pf" role="cell">{formatDecimal(team.projectedPointsFor, 1)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
