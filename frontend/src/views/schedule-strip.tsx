import type { UpcomingGame } from "../../../api/_lib/upcoming-schedule";
import { positionalSosRank, sosToneFromRank, type StrengthOfScheduleEntryLike } from "../shared";

/**
 * The player's next four games on the card, tinted soft or tough for his position
 * with the same tints as the matchup tag. A bye shows as BYE.
 */
export function ScheduleStrip({ games, position, sosEntry }: {
  games: readonly UpcomingGame[];
  position: string;
  sosEntry?: StrengthOfScheduleEntryLike;
}) {
  if (games.length === 0 || games.every((game) => !game.opponent)) return null;
  return (
    <ol className="schedule-strip" aria-label="Next games">
      {games.map((game) => {
        const tone = game.opponent ? sosToneFromRank(positionalSosRank(sosEntry, game.opponent, position)) : "";
        const quality = tone === " sos-soft" ? ", easy matchup" : tone === " sos-tough" ? ", tough matchup" : "";
        const label = game.opponent ? `${game.isAway ? "@" : ""}${game.opponent}` : "BYE";
        return (
          <li key={game.week} className={`schedule-strip-cell${tone}${game.opponent ? "" : " is-bye"}`} aria-label={`Week ${game.week}: ${game.opponent ? `${game.isAway ? "at" : "vs"} ${game.opponent}` : "bye"}${quality}`}>
            <span aria-hidden="true">Wk {game.week}</span>
            <strong aria-hidden="true">{label}</strong>
          </li>
        );
      })}
    </ol>
  );
}
