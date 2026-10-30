import type { PickGrade } from "../../../api/_lib/draft-grade";
import { useDraftGrade } from "./draft-grade-card";

export type RecapPick = { playerId: string; name: string; secondary: string | null };

function GradeCell({ label, grade }: { label: string; grade: PickGrade | null | undefined }) {
  return (
    <span>
      {grade
        ? <><span className="sr-only">{label} grade </span><strong>{grade.letter}</strong></>
        : <><span className="sr-only">{label} not graded</span><span aria-hidden="true">—</span></>}
    </span>
  );
}

/** My team once the draft is final: the picks in draft order, each graded on draft day and today. The team is set, so nothing can be removed. */
export function DraftRecap({ leagueId, picks, selectedPlayerId, onOpenPlayer }: {
  leagueId: string;
  picks: readonly RecapPick[];
  selectedPlayerId: string | null;
  onOpenPlayer: (playerId: string) => void;
}) {
  const graded = new Map((useDraftGrade(leagueId).data?.grade?.picks ?? []).map((entry) => [entry.playerId, entry]));

  return (
    <section className="draft-my-team">
      <div className="section-heading"><h2>My team</h2><span>{picks.length} players</span></div>
      {picks.length > 0 ? (
        <div className="draft-board data-table-frame" role="list" aria-label="My team players">
          <div className="draft-row draft-table-head draft-recap-row" aria-hidden="true">
            <span>Player</span>
            <span>Draft day</span>
            <span>Today</span>
          </div>
          {picks.map((pick) => {
            const isSelected = pick.playerId === selectedPlayerId;
            const entry = graded.get(pick.playerId);
            return (
              <div className={`draft-row draft-recap-row${isSelected ? " is-player-selected" : ""}`} role="listitem" key={pick.playerId}>
                <button type="button" className={`draft-player-open${pick.secondary ? "" : " is-single-line"}`} onClick={() => onOpenPlayer(pick.playerId)} aria-label={`View ${pick.name} details and news${isSelected ? ", selected" : ""}`}>
                  <span className="draft-player-name-line">
                    <strong>{pick.name}</strong>
                    {isSelected ? <span className="player-selected-chip">Selected</span> : null}
                  </span>
                  {pick.secondary ? <small className="draft-player-meta">{pick.secondary}</small> : null}
                </button>
                <GradeCell label="Draft day" grade={entry?.draftDay} />
                <GradeCell label="Today" grade={entry?.today} />
              </div>
            );
          })}
        </div>
      ) : <div className="empty-inline compact">Your Sleeper picks will appear here automatically.</div>}
    </section>
  );
}
