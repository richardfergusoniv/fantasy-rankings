import type { BetterPick } from "../../../api/_lib/draft-grade";
import { useDraftGrade } from "./draft-grade-card";

export type BetterPicksPlayer = { playerId: string; name: string; secondary: string | null };

function BetterCell({ label, better, secondaryOf, onOpenPlayer }: {
  label: string;
  better: BetterPick | null;
  secondaryOf: (position: string, team: string | null) => string | null;
  onOpenPlayer: (playerId: string) => void;
}) {
  if (!better) return <div className="draft-better-cell"><span className="sr-only">{label}: no better pick</span><span aria-hidden="true">—</span></div>;
  const secondary = secondaryOf(better.position, better.team);
  return (
    <div className="draft-better-cell">
      <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(better.playerId)} aria-label={`${label}: view ${better.name} details and news`}>
        <strong>{better.name}</strong>
        {secondary ? <small>{secondary}</small> : null}
      </button>
    </div>
  );
}

/** Once the draft is final: at each of the team's picks, the best player still available, by draft-day value and by today's. */
export function DraftBetterPicks({ leagueId, players, secondaryOf, onOpenPlayer }: {
  leagueId: string;
  players: readonly BetterPicksPlayer[];
  secondaryOf: (position: string, team: string | null) => string | null;
  onOpenPlayer: (playerId: string) => void;
}) {
  const query = useDraftGrade(leagueId);
  const byId = new Map(players.map((player) => [player.playerId, player]));
  // Kickers and defenses have no value to compare, so they carry no grade and are left out.
  const entries = (query.data?.grade?.picks ?? []).filter((entry) => byId.has(entry.playerId) && (entry.draftDay !== null || entry.today !== null));

  return (
    <section className="draft-my-team">
      <div className="section-heading"><h2>Alternative draft</h2></div>
      {entries.length > 0 ? (
        <div className="draft-board data-table-frame" role="list" aria-label="Best available player at each pick">
          <div className="draft-row draft-table-head draft-better-row" aria-hidden="true">
            <span>Your pick</span>
            <span>Draft day</span>
            <span>Today</span>
          </div>
          {entries.map((entry) => {
            const player = byId.get(entry.playerId);
            return (
              <div className="draft-row draft-better-row" role="listitem" key={entry.playerId}>
                <div className="draft-better-cell">
                  <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(entry.playerId)} aria-label={`Pick ${entry.pickNo}: view ${player?.name ?? "player"} details and news`}>
                    <strong>{player?.name}</strong>
                    <small>{[`Pick ${entry.pickNo}`, player?.secondary].filter(Boolean).join(" · ")}</small>
                  </button>
                </div>
                <BetterCell label="Draft day" better={entry.better.draftDay} secondaryOf={secondaryOf} onOpenPlayer={onOpenPlayer} />
                <BetterCell label="Today" better={entry.better.today} secondaryOf={secondaryOf} onOpenPlayer={onOpenPlayer} />
              </div>
            );
          })}
        </div>
      ) : <div className="empty-inline compact">{query.isPending ? "Loading…" : "An alternative draft isn’t available for this draft."}</div>}
    </section>
  );
}
