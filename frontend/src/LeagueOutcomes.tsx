import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { api } from "./api";
import { MoveTriangle } from "./components/glyphs";
import { CardHero } from "./components/card-hero";
import { SectionError } from "./section-error";
import { formatDecimal, formatWhole } from "./lib/format-number";
import { nextGamesForTeam, ordinal, placesMoved, recordLabel } from "./projected-standings-view";

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
  const teamName = (rosterId: number) => teams.find((team) => team.rosterId === rosterId)?.teamName ?? "Opponent";
  const nextGames = me ? nextGamesForTeam(games, me.rosterId) : [];
  const moved = me ? placesMoved(me.currentRank, me.rank) : 0;
  const showPlayoffs = !query.data.divisionsIgnored && query.data.playoffTeams > 0;
  // Two tables with the playoff line between them; one table when there is no line.
  const cutAfter = teams.findIndex((team, index) => team.inPlayoffs && !teams[index + 1]?.inPlayoffs && index < teams.length - 1);
  const groups = cutAfter >= 0 ? [teams.slice(0, cutAfter + 1), teams.slice(cutAfter + 1)] : [teams];

  return (
    <section className="power-view proj-view" aria-label="Projected standings">
      {me ? (
        <Card className="proj-hero gap-0 py-0 shadow-sm">
          <div className="proj-finish">
            <h2>{ordinal(me.rank)} of {teams.length}</h2>
            {showPlayoffs ? <Badge variant={me.inPlayoffs ? "positive" : "secondary"} size="compact" className="status-badge">{me.inPlayoffs ? "In playoffs" : "Outside the cut"}</Badge> : null}
          </div>
          <CardHero
            ariaLabel="Your projection"
            items={[
              { label: "Proj. record", value: recordLabel(me.projectedRecord) },
              { label: "Moves", value: moved === 0 ? "—" : <MoveMark moved={moved} /> },
              { label: "Proj. points", value: formatWhole(me.projectedPointsFor) },
            ]}
          />
        </Card>
      ) : null}

      <section className="power-table-section" aria-labelledby="proj-standings-heading">
        <div className="section-heading power-section-heading">
          <h2 id="proj-standings-heading">Projected standings</h2>
        </div>
        {groups.map((group, groupIndex) => (
          <Fragment key={group[0]?.rosterId ?? groupIndex}>
            {groupIndex > 0 ? <div className="proj-cut" role="separator" aria-label="Playoff cut">Playoff cut</div> : null}
            <div className="power-table" role="table" aria-label={groups.length > 1 ? (groupIndex === 0 ? "Projected playoff teams" : "Projected teams outside the cut") : "Projected standings"}>
              {group.map((team) => (
                <div className="power-list-item" key={team.rosterId}>
                  <div className={`power-row proj-row${team.isUser ? " is-user" : ""}`} role="row">
                    <strong className="power-rank" role="cell">{team.rank}</strong>
                    <div className="power-team proj-team" role="cell">
                      <strong>{team.teamName}</strong>
                      {team.isUser ? <span className="roster-owner-tag is-user">You</span> : null}
                      <MoveMark moved={placesMoved(team.currentRank, team.rank)} />
                    </div>
                    <div className="power-total proj-pf" role="cell">
                      <strong>{formatDecimal(team.projectedPointsFor, 0)}</strong>
                      <div className="proj-bar" aria-hidden="true"><i style={{ width: `${Math.round((team.projectedPointsFor / topPoints) * 100)}%` }} /></div>
                    </div>
                    <div className="power-total" role="cell"><strong>{recordLabel(team.projectedRecord)}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          </Fragment>
        ))}
      </section>

      {nextGames.length > 0 ? (
        <section className="power-table-section" aria-labelledby="proj-games-heading">
          <div className="section-heading power-section-heading proj-games-head">
            <h2 id="proj-games-heading">Your next games</h2>
            <span>Proj. result</span>
          </div>
          {nextGames.map((game) => (
            <div className="power-row proj-game" key={game.week}>
              <strong className="power-rank">Wk {game.week}</strong>
              <div className="power-team">
                <strong>vs {teamName(game.opponentRosterId)}</strong>
                <span>{formatDecimal(game.mine, 1)} – {formatDecimal(game.theirs, 1)}</span>
              </div>
              <div className={`power-total proj-win ${game.result === "W" ? "is-up" : game.result === "L" ? "is-down" : ""}`}><strong>{game.result}</strong><span>{formatDecimal(game.margin, 2, { sign: "always" })} pts</span></div>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
