import type { MatchupSelection } from "../dashboard-types";

/** Build a MatchupSelection for a Game lines card, focused on one side. */
export function matchupSelectionForGameLine(args: {
  awayTeam: string;
  homeTeam: string;
  isFinal: boolean;
  /** Team whose perspective opens the matchup card; defaults to away. */
  focusTeam?: string;
}): MatchupSelection {
  const focus = (args.focusTeam ?? args.awayTeam).trim().toUpperCase();
  const away = args.awayTeam.trim().toUpperCase();
  const isAway = focus === away;
  return {
    team: isAway ? args.awayTeam : args.homeTeam,
    opponent: isAway ? args.homeTeam : args.awayTeam,
    isAway,
    gamePhase: args.isFinal ? "final" : null,
  };
}

/** Display an implied team total (or em dash when missing). */
export function formatImpliedTotal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
