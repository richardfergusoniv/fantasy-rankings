import { useMemo } from "react";
import type {
  Dashboard,
  DraftCenterData,
  League,
  MatchupSelection,
  PlayerNews,
  Tab,
} from "../dashboard-types";
import { formatProjectionPoints } from "../dashboard-shared";
import { formatDecimal } from "../lib/format-number";
import { weeklyOpponentRosterId } from "../power-opponent";

type MonitorAlert = {
  key: string;
  label: string;
  detail: string;
  playerId?: string;
  matchup?: MatchupSelection;
};

const LEAGUE_PREVIEW_LIMIT = 8;
const MOVER_LIMIT = 3;
const ALERT_LIMIT = 5;

export function Monitor({
  league,
  dashboard,
  draftData,
  news,
  onOpenTab,
  onOpenPlayer,
  onOpenMatchup,
}: {
  league: League;
  dashboard: Dashboard;
  draftData: DraftCenterData | undefined;
  news: PlayerNews | undefined;
  onOpenTab: (tab: Tab) => void;
  onOpenPlayer: (playerId: string) => void;
  onOpenMatchup: (matchup: MatchupSelection) => void;
}) {
  const opponent = league.opponentTeam;
  const opponentRosterId = weeklyOpponentRosterId(opponent?.name, league.tradeTeams);
  const leagueRows = league.powerRankingsWeek.slice(0, LEAGUE_PREVIEW_LIMIT);
  const trendingUp = (draftData?.trending ?? []).slice(0, MOVER_LIMIT);
  const trendingDown = (draftData?.trendingDrops ?? []).slice(0, MOVER_LIMIT);
  const suggestion = league.suggestion;

  const alerts = useMemo(() => {
    const items: MonitorAlert[] = [];

    for (const item of (news?.runs ?? []).flatMap((run) => run.items)) {
      if (items.length >= ALERT_LIMIT) break;
      if (item.newsType === "roster") continue;
      items.push({
        key: `news:${item.id}`,
        label: item.playerId === "league" ? "League news" : item.player,
        detail: item.change,
        playerId: item.playerId && item.playerId !== "league" ? item.playerId : undefined,
      });
    }

    const rosterPool = [
      ...league.starters,
      ...league.bench,
      ...(opponent?.starters ?? []),
      ...(opponent?.bench ?? []),
    ];
    const seenPlayers = new Set<string>();
    for (const player of rosterPool) {
      if (items.length >= ALERT_LIMIT) break;
      if (!player.injuryStatus || seenPlayers.has(player.playerId)) continue;
      seenPlayers.add(player.playerId);
      items.push({
        key: `injury:${player.playerId}`,
        label: player.name,
        detail: player.injuryStatus,
        playerId: player.playerId,
      });
    }

    for (const player of rosterPool) {
      if (items.length >= ALERT_LIMIT) break;
      if (player.gamePhase !== "live" || seenPlayers.has(`live:${player.playerId}`)) continue;
      seenPlayers.add(`live:${player.playerId}`);
      const matchup = player.team && player.opponent
        ? { team: player.team, opponent: player.opponent, isAway: player.isAway, gamePhase: player.gamePhase }
        : undefined;
      items.push({
        key: `live:${player.playerId}`,
        label: player.name,
        detail: "Live game",
        playerId: player.playerId,
        matchup,
      });
    }

    return items.slice(0, ALERT_LIMIT);
  }, [league.bench, league.starters, news, opponent?.bench, opponent?.starters]);

  return (
    <section className="monitor-view" aria-label="Monitor">
      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>My matchup</h2>
          <button type="button" className="monitor-panel-link" onClick={() => onOpenTab("team")}>Open matchup</button>
        </header>
        <p className="monitor-matchup-names">
          <strong>{league.name}</strong>
          <span>vs</span>
          <strong>{opponent?.name ?? "No opponent"}</strong>
        </p>
        <p className="monitor-week-label">Week {dashboard.week}</p>
        <div className="monitor-matchup-scores" aria-label="Head-to-head score">
          <div>
            <strong>{formatProjectionPoints(league.teamActual)}</strong>
            <small>{formatProjectionPoints(league.teamProjection)} proj</small>
          </div>
          <div>
            <strong>{formatProjectionPoints(opponent?.teamActual ?? null)}</strong>
            <small>{formatProjectionPoints(opponent?.teamProjection ?? null)} proj</small>
          </div>
        </div>
      </article>

      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>League</h2>
          <button type="button" className="monitor-panel-link" onClick={() => onOpenTab("power")}>Open league</button>
        </header>
        {leagueRows.length === 0 ? (
          <p className="monitor-empty">Power rankings load with the league view.</p>
        ) : (
          <ol className="monitor-league-list">
            {leagueRows.map((team) => {
              const isOpponent = opponentRosterId !== null && team.rosterId === opponentRosterId;
              return (
                <li
                  key={team.rosterId}
                  className={`monitor-league-row${team.isUser ? " is-user" : ""}${isOpponent ? " is-opponent" : ""}`}
                >
                  <strong className="monitor-league-rank">{team.rank}</strong>
                  <span className="monitor-league-team">
                    <strong>{team.teamName}</strong>
                    {team.isUser ? <span className="roster-owner-tag is-user">Your roster</span> : null}
                    {isOpponent ? <span className="sr-only">This week&apos;s opponent</span> : null}
                  </span>
                  <span className="monitor-league-value">{formatDecimal(team.totalValue, 1)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </article>

      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>Movers</h2>
        </header>
        {trendingUp.length === 0 && trendingDown.length === 0 ? (
          <p className="monitor-empty">No trending adds or drops yet.</p>
        ) : (
          <ul className="monitor-movers-list">
            {trendingUp.map((row) => (
              <li key={`up:${row.playerId}`}>
                <button type="button" className="monitor-mover is-up" onClick={() => onOpenPlayer(row.playerId)}>
                  <span>{row.name}</span>
                  <strong>+{row.count.toLocaleString()}</strong>
                </button>
              </li>
            ))}
            {trendingDown.map((row) => (
              <li key={`down:${row.playerId}`}>
                <button type="button" className="monitor-mover is-down" onClick={() => onOpenPlayer(row.playerId)}>
                  <span>{row.name}</span>
                  <strong>−{row.count.toLocaleString()}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>Alerts</h2>
        </header>
        {alerts.length === 0 ? (
          <p className="monitor-empty">No alerts right now.</p>
        ) : (
          <ul className="monitor-alerts-list">
            {alerts.map((alert) => {
              const open = () => {
                if (alert.matchup) {
                  onOpenMatchup(alert.matchup);
                  return;
                }
                if (alert.playerId) onOpenPlayer(alert.playerId);
              };
              const interactive = Boolean(alert.matchup || alert.playerId);
              return (
                <li key={alert.key}>
                  {interactive ? (
                    <button type="button" className="monitor-alert" onClick={open}>
                      <strong>{alert.label}</strong>
                      <span>{alert.detail}</span>
                    </button>
                  ) : (
                    <div className="monitor-alert">
                      <strong>{alert.label}</strong>
                      <span>{alert.detail}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>Trade</h2>
          <button type="button" className="monitor-panel-link" onClick={() => onOpenTab("trade")}>Open Trade</button>
        </header>
        {suggestion ? (
          <p className="monitor-trade-teaser">
            Start <span className="monitor-trade-chip is-get">{suggestion.inPlayer}</span>
            {" "}over{" "}
            <span className="monitor-trade-chip is-give">{suggestion.outPlayer}</span>
            <strong className="monitor-trade-delta">+{formatDecimal(suggestion.delta, 1)}</strong>
          </p>
        ) : (
          <p className="monitor-empty">Open Trade</p>
        )}
      </article>
    </section>
  );
}
