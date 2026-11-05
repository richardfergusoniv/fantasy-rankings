import { useState } from "react";
import { formatWhole } from "../lib/format-number";
import { points } from "../shared";

export type PowerStackSegment = { key: string; label: string; value: number };
export type PowerStackTeam = { rosterId: number; rank: number; teamName: string; isUser: boolean; segments: PowerStackSegment[] };

const SHADE: Record<string, string> = {
  QB: "var(--position-shade-qb)",
  RB: "var(--position-shade-rb)",
  WR: "var(--position-shade-wr)",
  TE: "var(--position-shade-te)",
  FLEX: "var(--position-shade-flex)",
  K: "var(--position-shade-k)",
  DEF: "var(--position-shade-def)",
  PICKS: "var(--position-shade-flex)",
};

const segmentTotal = (team: PowerStackTeam) => team.segments.reduce((total, segment) => total + Math.max(0, segment.value), 0);

/**
 * Every team's value split by position, one stacked bar each on a shared scale.
 * No color key: tapping a team shows its numbers under its bar.
 */
export function PowerStackList({ teams, weekly, id }: { teams: PowerStackTeam[]; weekly: boolean; id?: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const top = Math.max(1, ...teams.map(segmentTotal));
  const format = (value: number) => (weekly ? points(value) : formatWhole(value));
  return (
    <div className="power-stack-list" id={id} role="list" aria-label="Position value by team">
      {teams.map((team) => {
        const isOpen = openId === team.rosterId;
        const total = segmentTotal(team);
        return (
          <div role="listitem" key={team.rosterId}>
            <button
              type="button"
              className={`power-stack-row${team.isUser ? " is-user" : ""}`}
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : team.rosterId)}
            >
              <span className="power-stack-rank">{team.rank}</span>
              <span className="power-stack-name">{team.teamName}</span>
              <span className="power-stack-bar" aria-hidden="true">
                {team.segments.map((segment) => (
                  <i key={segment.key} style={{ width: `${(Math.max(0, segment.value) / top) * 100}%`, background: SHADE[segment.key] ?? SHADE.FLEX }} />
                ))}
              </span>
              <span className="power-stack-total">{format(total)}</span>
              {isOpen ? (
                <span className="power-stack-detail">
                  {team.segments.map((segment) => (
                    <span key={segment.key}>{segment.label} <b>{format(segment.value)}</b></span>
                  ))}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
