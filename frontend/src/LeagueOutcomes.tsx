import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { api } from "./api";
import { CardHero } from "./components/card-hero";
import { SectionError } from "./section-error";
import { formatDecimal, formatWhole } from "./lib/format-number";
import { nextGamesForTeam, ordinal, placesMoved, recordLabel } from "./projected-standings-view";
import { NextGameCard } from "./views/next-game-card";

/** "34%"; the ends read "<1%" and ">99%" so a long shot never shows as impossible. */
function oddsLabel(odds: number): string {
  const pct = odds * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 100 && pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

function MoveMark({ moved }: { moved: number }) {
  if (moved === 0) return null;
  return <span className={`proj-move ${moved > 0 ? "is-up" : "is-down"}`}><i aria-hidden="true" />{Math.abs(moved)}<span className="sr-only">{moved > 0 ? " places up from today" : " places down from today"}</span></span>;
}

export function LeagueOutcomes({ leagueId, queryKey }: { leagueId: string; queryKey: readonly unknown[] }) {
  const [previewWeek, setPreviewWeek] = useState<number | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: () => api.getProjectedStandings({ leagueId }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (query.isPending) {
    return (
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading playoff picture…">
        <span>Loading playoff picture…</span>
        <div className="loading-shimmer loading-line wide" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
        <div className="loading-shimmer loading-line" aria-hidden="true" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return <SectionError title="Playoff picture didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  }

  const { teams, games, userGames = [] } = query.data;
  const me = teams.find((team) => team.isUser) ?? null;
  // Bars span the league's range (lowest to highest), not 0 to max: 1,400 vs 1,700
  // drawn from zero look identical. The lowest team keeps a short stub.
  const pointsFor = teams.map((team) => team.projectedPointsFor);
  const lowPoints = Math.min(...pointsFor);
  const pointsRange = Math.max(...pointsFor) - lowPoints;
  const barWidth = (points: number) => (pointsRange > 0 ? 12 + 88 * ((points - lowPoints) / pointsRange) : 100);
  const teamName = (rosterId: number) => teams.find((team) => team.rosterId === rosterId)?.teamName ?? "Opponent";
  const nextGames = me ? nextGamesForTeam(games, me.rosterId) : [];
  const moved = me ? placesMoved(me.currentRank, me.rank) : 0;
  const showPlayoffs = !query.data.divisionsIgnored && query.data.playoffTeams > 0;
  // Two tables with the playoff line between them; one table when there is no line.
  const cutAfter = teams.findIndex((team, index) => team.inPlayoffs && !teams[index + 1]?.inPlayoffs && index < teams.length - 1);
  const groups = cutAfter >= 0 ? [teams.slice(0, cutAfter + 1), teams.slice(cutAfter + 1)] : [teams];

  return (
    <section className="power-view proj-view" aria-label="Playoff picture">
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
              ...(me.playoffOdds != null ? [{ label: "Playoff odds", value: oddsLabel(me.playoffOdds) }] : []),
            ]}
          />
        </Card>
      ) : null}

      <section className="power-table-section" aria-labelledby="proj-standings-heading">
        <div className="section-heading power-section-heading">
          <h2 id="proj-standings-heading">Playoff picture</h2>
        </div>
        {groups.map((group, groupIndex) => (
          <Fragment key={group[0]?.rosterId ?? groupIndex}>
            {groupIndex > 0 ? <div className="proj-cut" role="separator" aria-label="Playoff cut">Playoff cut</div> : null}
            <div className="power-table" role="table" aria-label={groups.length > 1 ? (groupIndex === 0 ? "Projected playoff teams" : "Projected teams outside the cut") : "Playoff picture"}>
              {group.map((team) => (
                <div className="power-list-item" key={team.rosterId}>
                  <div className={`power-row proj-row${team.isUser ? " is-user" : ""}${team.playoffOdds != null ? " has-odds" : ""}`} role="row">
                    <strong className="power-rank" role="cell">{team.rank}</strong>
                    <div className="power-team proj-team" role="cell">
                      <strong>{team.teamName}</strong>
                      <MoveMark moved={placesMoved(team.currentRank, team.rank)} />
                    </div>
                    <div className="power-total" role="cell"><strong>{recordLabel(team.projectedRecord)}</strong></div>
                    {team.playoffOdds != null ? (
                      <div className="power-total proj-odds" role="cell" aria-label={`Playoff odds ${oddsLabel(team.playoffOdds)}`}>
                        <strong>{oddsLabel(team.playoffOdds)}</strong>
                        <div className="proj-bar" aria-hidden="true"><i style={{ width: `${Math.round(team.playoffOdds * 100)}%` }} /></div>
                      </div>
                    ) : null}
                    <div className="power-total proj-pf" role="cell">
                      <strong>{formatDecimal(team.projectedPointsFor, 0)}</strong>
                      <div className="proj-bar" aria-hidden="true"><i style={{ width: `${Math.round(barWidth(team.projectedPointsFor))}%` }} /></div>
                    </div>
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
          {nextGames.map((game) => {
            const preview = userGames.find((item) => item.week === game.week) ?? null;
            const name = teamName(game.opponentRosterId);
            return (
              <div className="power-row proj-game" key={game.week}>
                <strong className="power-rank">Wk {game.week}</strong>
                <div className="power-team">
                  {preview ? (
                    <button type="button" className="proj-game-open" aria-haspopup="dialog" onClick={() => setPreviewWeek(game.week)}>{name}</button>
                  ) : <strong>{name}</strong>}
                </div>
                <div className={`power-total proj-win ${game.result === "W" ? "is-up" : game.result === "L" ? "is-down" : ""}`}><strong>{game.result} {formatDecimal(game.margin, 1, { sign: "always" })}</strong></div>
              </div>
            );
          })}
        </section>
      ) : null}
      {(() => {
        const preview = previewWeek === null ? null : userGames.find((item) => item.week === previewWeek) ?? null;
        return preview && me ? (
          <NextGameCard game={preview} myName={me.teamName} opponentName={teamName(preview.opponentRosterId)} onClose={() => setPreviewWeek(null)} />
        ) : null;
      })()}
    </section>
  );
}
