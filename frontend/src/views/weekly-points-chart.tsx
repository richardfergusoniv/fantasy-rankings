import type { CSSProperties } from "react";
import type { BoomBustHistory } from "../../../api/boom-bust/[type]";
import { formatDecimal } from "../lib/format-number";

type Game = BoomBustHistory["gameLog"][number];

/**
 * Weekly points against projection, top of the player card's Season tab: one bar
 * per game for the points scored, a tick at Sleeper's projection for that week,
 * green when he beat it and red when he missed (good and bad only). The coming
 * week is an outline at the card's projection. Labels are the week, opponent and
 * points, as in the approved mockup.
 */
export function WeeklyPointsChart({ games, nextWeek, nextProjection, nextOpponent }: {
  games: readonly Game[];
  nextWeek: number | null;
  nextProjection: number | null;
  nextOpponent: string | null;
}) {
  const played = [...games].sort((a, b) => a.week - b.week);
  if (played.length === 0) return null;
  const showNext = nextWeek !== null && nextProjection !== null && !played.some((game) => game.week === nextWeek);
  const top = Math.max(1, ...played.map((game) => Math.max(game.points, game.projected ?? 0)), showNext ? nextProjection ?? 0 : 0) * 1.08;
  const height = (value: number) => `${Math.max(0, Math.min(100, (value / top) * 100))}%`;
  const columns = played.length + (showNext ? 1 : 0);
  const beat = played.filter((game) => game.projected != null && game.points >= game.projected).length;
  const withProjection = played.filter((game) => game.projected != null).length;
  return (
    <section className="weekly-points" aria-label={`Weekly points against projection: beat his projection in ${beat} of ${withProjection} games`}>
      <div className="weekly-points-plot" style={{ "--columns": columns } as CSSProperties} aria-hidden="true">
        {played.map((game) => {
          const tone = game.projected == null ? "" : game.points >= game.projected ? " is-over" : " is-under";
          return (
            <div key={game.week} className="weekly-points-col">
              <i className={`weekly-points-bar${tone}`} style={{ height: height(game.points) }} />
              {game.projected != null ? <u className="weekly-points-tick" style={{ bottom: height(game.projected) }} /> : null}
            </div>
          );
        })}
        {showNext ? (
          <div className="weekly-points-col">
            <i className="weekly-points-bar is-next" style={{ height: height(nextProjection ?? 0) }} />
          </div>
        ) : null}
      </div>
      <div className="weekly-points-axis" style={{ "--columns": columns } as CSSProperties} aria-hidden="true">
        {played.map((game) => (
          <span key={game.week}><b>{formatDecimal(game.points, 1)}</b>W{game.week}<small>{game.opponent ?? ""}</small></span>
        ))}
        {showNext ? <span><b>{formatDecimal(nextProjection ?? 0, 1)}</b>W{nextWeek}<small>{nextOpponent ?? ""}</small></span> : null}
      </div>
      <ul className="sr-only">
        {played.map((game) => (
          <li key={game.week}>{`Week ${game.week}${game.opponent ? ` vs ${game.opponent}` : ""}: ${formatDecimal(game.points, 1)} points${game.projected != null ? `, projected ${formatDecimal(game.projected, 1)}` : ""}`}</li>
        ))}
      </ul>
    </section>
  );
}
