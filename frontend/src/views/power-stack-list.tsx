import type { ReactNode } from "react";
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

function RowContents({ team, totalLabel, top }: { team: PowerStackTeam; totalLabel: string; top: number }) {
  return (
    <>
      <span className="power-stack-rank">{team.rank}</span>
      <span className="power-stack-name">{team.teamName}</span>
      <span className="power-stack-bar" aria-hidden="true">
        {team.segments.map((segment) => (
          <i key={segment.key} style={{ width: `${(Math.max(0, segment.value) / top) * 100}%`, background: SHADE[segment.key] ?? SHADE.FLEX }} />
        ))}
      </span>
      <span className="power-stack-total">{totalLabel}</span>
    </>
  );
}

/**
 * Every team's value split by position, one stacked bar each on a shared scale.
 * No color key: tapping a team opens its league team card.
 */
export function PowerStackList({
  teams,
  weekly,
  id,
  onOpenTeam,
}: {
  teams: PowerStackTeam[];
  weekly: boolean;
  id?: string;
  onOpenTeam?: (rosterId: number) => void;
}) {
  const top = Math.max(1, ...teams.map(segmentTotal));
  const format = (value: number) => (weekly ? points(value) : formatWhole(value));
  return (
    <div className="power-stack-list" id={id} role="list" aria-label="Position value by team">
      {teams.map((team) => {
        const total = segmentTotal(team);
        const totalLabel = format(total);
        const className = `power-stack-row${team.isUser ? " is-user" : ""}`;
        const contents: ReactNode = <RowContents team={team} totalLabel={totalLabel} top={top} />;
        return (
          <div role="listitem" key={team.rosterId}>
            {onOpenTeam ? (
              <button
                type="button"
                className={className}
                aria-haspopup="dialog"
                aria-label={`${team.rank}. ${team.teamName}, ${totalLabel}. Open team card`}
                onClick={() => onOpenTeam(team.rosterId)}
              >
                {contents}
              </button>
            ) : (
              <div className={className}>{contents}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
