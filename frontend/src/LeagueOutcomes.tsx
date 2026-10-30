import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { api } from "./api";
import { CardHero } from "./components/card-hero";
import { SectionError } from "./section-error";
import { formatDecimal, formatWhole } from "./lib/format-number";
import { nextGamesForTeam, ordinal, placesMoved, recordLabel, winChanceLabel } from "./projected-standings-view";

function MoveMark({ moved }: { moved: number }) {
  if (moved === 0) return null;
  return <span className={`proj-move ${moved > 0 ? "is-up" : "is-down"}`}><i aria-hidden="true" />{Math.abs(moved)}<span className="sr-only">{moved > 0 ? " places up from today" : " places down from today"}</span></span>;
}

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

  const { teams, games } = query.data;
  const me = teams.find((team) => team.isUser) ?? null;
  const topPoints = Math.max(...teams.map((team) => team.projectedPointsFor), 1);
  const pointsRank = (team: (typeof teams)[number]) => teams.filter((other) => other.projectedPointsFor > team.projectedPointsFor).length + 1;
  const teamName = (rosterId: number) => teams.find((team) => team.rosterId === rosterId)?.teamName ?? "Opponent";
  const nextGames = me ? nextGamesForTeam(games, me.rosterId) : [];
  const asOf = query.data.projectionsAsOf
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(query.data.projectionsAsOf))
    : null;
  const moved = me ? placesMoved(me.currentRank, me.rank) : 0;

  return (
    <section className="proj-view" aria-label="Projected standings">
      {me ? (
        <>
          <p className="card-eyebrow" style={{ marginTop: 0 }}>Your projected finish</p>
          <div className="proj-finish">
            <h2>{ordinal(me.rank)} of {teams.length}</h2>
            {query.data.divisionsIgnored || query.data.playoffTeams <= 0 ? null : <Badge variant={me.inPlayoffs ? "positive" : "secondary"} size="compact" className="injury">{me.inPlayoffs ? "In playoffs" : "Outside the cut"}</Badge>}
          </div>
          <CardHero
            ariaLabel="Your projection"
            items={[
              { label: "Proj. record", value: recordLabel(me.projectedRecord), sub: `${recordLabel(me.record)} now` },
              { label: "Moves", value: moved === 0 ? "—" : <MoveMark moved={moved} />, sub: `from ${ordinal(me.currentRank)} today` },
              { label: "Proj. points", value: formatWhole(me.projectedPointsFor), sub: `${ordinal(pointsRank(me))} in league` },
            ]}
          />
        </>
      ) : null}
      <p className="proj-caption">
        Through week {query.data.throughWeek} of {query.data.regularSeasonEndsWeek}
        {query.data.playoffTeams > 0 && !query.data.divisionsIgnored ? ` · top ${query.data.playoffTeams} make the playoffs` : ""}
        {query.data.divisionsIgnored ? " · no playoff line, divisions are not modeled" : ""}
        {asOf ? ` · projections as of ${asOf}` : ""}
        {query.data.missingWeeks.length > 0 ? ` · weeks ${query.data.missingWeeks.join(", ")} used each team's average` : ""}
      </p>

      <div className="proj-table" role="table" aria-label="Projected standings">
        <div className="proj-row proj-head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Team</span>
          <span role="columnheader">Proj. PF</span>
          <span role="columnheader">Proj.</span>
        </div>
        {teams.map((team, index) => (
          <div key={team.rosterId}>
            <div className={`proj-row${team.isUser ? " is-user" : ""}`} role="row">
              <span className="proj-rank" role="cell">{team.rank}</span>
              <div className="proj-team" role="cell">
                <div className="proj-team-name"><strong>{team.teamName}</strong>{team.isUser ? <Badge variant="secondary" size="compact" className="injury is-you">Yours</Badge> : null}</div>
                <div className="proj-team-sub">{recordLabel(team.record)} now <MoveMark moved={placesMoved(team.currentRank, team.rank)} /></div>
              </div>
              <div className="proj-pf" role="cell">
                <span>{formatDecimal(team.projectedPointsFor, 0)}</span>
                <div className="proj-bar" aria-hidden="true"><i style={{ width: `${Math.round((team.projectedPointsFor / topPoints) * 100)}%` }} /></div>
              </div>
              <b className="proj-record" role="cell">{recordLabel(team.projectedRecord)}</b>
            </div>
            {team.inPlayoffs && !teams[index + 1]?.inPlayoffs && index < teams.length - 1 ? <div className="proj-cut" role="separator" aria-label="Playoff cut">Playoff cut</div> : null}
          </div>
        ))}
      </div>

      {nextGames.length > 0 ? (
        <section aria-label="Your next games">
          <div className="proj-games-head"><h3>Your next games</h3><span>Win chance</span></div>
          {nextGames.map((game) => (
            <div className="proj-game" key={game.week}>
              <span className="proj-game-week">Wk {game.week}</span>
              <div>
                <strong>vs {teamName(game.opponentRosterId)}</strong>
                <div className="proj-team-sub">{formatDecimal(game.mine, 1)} – {formatDecimal(game.theirs, 1)} proj.</div>
              </div>
              <div className={`proj-win ${game.winPercent >= 55 ? "is-up" : game.winPercent <= 45 ? "is-down" : ""}`}>{game.winPercent}%<small>{winChanceLabel(game.winPercent)}</small></div>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
