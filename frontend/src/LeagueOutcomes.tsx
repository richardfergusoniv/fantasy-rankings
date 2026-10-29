import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { SectionError } from "./section-error";
import { SegmentedControl } from "./shared";
import { formatDecimal, formatPercent } from "./lib/format-number";
import { axisMax, changeLabel, changeTone, outcomeMeasure, pctLabel, type OutcomesView as View } from "./outcomes-view";

export function LeagueOutcomes({ leagueId, queryKey }: { leagueId: string; queryKey: readonly unknown[] }) {
  const [view, setView] = useState<View>("playoffs");
  const query = useQuery({
    queryKey,
    queryFn: () => api.getLeagueOutcomes({ leagueId }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (query.isPending) {
    return (
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading outcomes…">
        <span>Loading outcomes…</span>
        <div className="loading-shimmer loading-line wide" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return <SectionError title="Outcomes didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  }

  const data = query.data;
  const { now, before, higherIsBetter } = outcomeMeasure(view);
  const teams = [...data.teams].sort((a, b) => now(b) - now(a));
  const max = axisMax(view, teams);
  const ticks = [0, max / 2, max];
  const position = (value: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
  const prevLabel = data.previousWeek ? `After week ${data.previousWeek}` : null;

  return (
    <section className="outcomes-view" aria-label="League outcomes">
      <SegmentedControl<View>
        label="Outcome"
        value={view}
        onChange={setView}
        options={[{ value: "playoffs", label: "Playoffs" }, { value: "last", label: "Last place" }]}
      />
      <div className="outcomes-chart" role="table" aria-label={view === "playoffs" ? "Playoff odds" : "Last place odds"}>
        <div className="outcomes-row outcomes-head" role="row">
          <span role="columnheader">Team</span>
          <span className="outcomes-axis" aria-hidden="true">{ticks.map((tick) => <i key={tick} style={{ left: position(tick) }}>{tick}%</i>)}</span>
          <span role="columnheader">Now</span>
          <span role="columnheader">Change</span>
        </div>
        {teams.map((team) => {
          const current = now(team);
          const previous = before(team);
          const change = previous == null ? null : current - previous;
          const tone = changeTone(change, higherIsBetter);
          return (
            <div key={team.rosterId} className={`outcomes-row${team.isUser ? " is-user" : ""}`} role="row">
              <span className="outcomes-team" role="cell"><strong>{team.teamName}</strong> <small>{team.record}</small></span>
              <span className="outcomes-track" role="cell" aria-label={previous == null ? undefined : `${prevLabel}: ${formatPercent(previous)}`}>
                {previous != null ? (
                  <>
                    <i className={`outcomes-link ${tone}`} style={{ left: position(Math.min(previous, current)), width: `${(Math.abs(current - previous) / max) * 100}%` }} />
                    <i className="outcomes-dot before" style={{ left: position(previous) }} />
                  </>
                ) : null}
                <i className={`outcomes-dot now ${tone}`} style={{ left: position(current) }} />
              </span>
              <b className="outcomes-pct" role="cell">{pctLabel(current)}</b>
              <b className={`outcomes-change ${tone}`} role="cell">
                {changeLabel(change)}
              </b>
            </div>
          );
        })}
      </div>
      <div className="outcomes-legend">
        {prevLabel ? <span><i className="outcomes-dot before" />{prevLabel}</span> : null}
        <span><i className="outcomes-dot now" />After week {data.throughWeek}</span>
      </div>
      <p className="outcomes-note">
        {formatDecimal(data.trials, 0)} simulations · {data.method.label.toLowerCase()} · weeks 1–{data.throughWeek} fixed · {view === "last" ? "last place" : `top ${data.playoffTeams}`} after week {data.regularSeasonEndsWeek} · model estimates{data.divisionsIgnored ? " · divisions not modeled" : ""}
      </p>
    </section>
  );
}
