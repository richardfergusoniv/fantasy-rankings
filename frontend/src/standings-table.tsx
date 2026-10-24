import type { api, ApiResponse } from "./api";
import { weeklyOpponentRosterId } from "./power-opponent";
import { formatRecord } from "./league-team-card";
import { playoffsCaption, playoffStatusLabel, pointsLine } from "./standings";

type League = ApiResponse<typeof api, "getDashboard">["leagues"][number];

/** The real league table: record, points for/against, playoff position. */
export function StandingsTable({ league, opponentName }: { league: League; opponentName?: string | null }) {
  const rows = league.standings ?? [];
  if (rows.length === 0) return null;
  const caption = playoffsCaption(league.playoffs);
  const cutoff = league.playoffs?.positionKnown === false ? null : league.playoffs?.teams ?? null;
  const opponentId = weeklyOpponentRosterId(opponentName, rows, league.opponentTeam?.rosterId);
  return (
    <section className="power-table-section standings-section" aria-labelledby="league-standings-heading">
      <div className="section-heading power-section-heading">
        <h2 id="league-standings-heading">Standings</h2>
        {caption ? <span className="standings-caption">{caption}</span> : null}
      </div>
      <div className="power-table" role="list">
        {rows.map((row) => {
          const isOpponent = row.rosterId === opponentId;
          return (
            <div className="power-list-item" role="listitem" key={row.rosterId}>
              <div
                className={`power-row${row.isUser ? " is-user" : ""}${isOpponent ? " is-opponent" : ""}${cutoff !== null && row.rank === cutoff ? " standings-cut" : ""}`}
                aria-label={`${row.rank}. ${row.teamName}, ${formatRecord(row)}, ${pointsLine(row)}, ${playoffStatusLabel(row)}${isOpponent ? ", this week's opponent" : ""}`}
              >
                <strong className="power-rank">{row.rank}</strong>
                <span className="power-team">
                  <strong>{row.teamName}<span className="power-team-record"> · {formatRecord(row)}</span></strong>
                  <small className="standings-points">{pointsLine(row)}</small>
                </span>
                <span className="power-total standings-status"><strong>{playoffStatusLabel(row)}</strong></span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
