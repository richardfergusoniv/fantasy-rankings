import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "../dashboard-types";
import { shortLeagueName } from "../shared";
import { formatPercent } from "../lib/format-number";
import { sortMonitorSummaries, summarizeLeagueForMonitor, type MonitorLeagueSummary } from "./monitor-summary";

const TICK_MS = 30_000;

function marginLabel(margin: number | null): string {
  if (margin === null) return "—";
  return `${margin > 0 ? "+" : margin < 0 ? "−" : ""}${Math.abs(margin).toFixed(1)}`;
}

function LeagueRow({ name, summary, record, onOpen }: {
  name: string;
  summary: MonitorLeagueSummary;
  record: string;
  onOpen: () => void;
}) {
  const needsAttention = summary.issues.length > 0;
  const win = summary.winPercent;
  return (
    <button
      type="button"
      className={`league-monitor-row${needsAttention ? " needs-attention" : ""}`}
      onClick={onOpen}
      aria-label={`Open ${name}${needsAttention ? `, ${summary.issues.length} to fix: ${summary.issues.map((issue) => issue.label).join(", ")}` : ", lineup set"}`}
    >
      <span className="league-monitor-title">
        <strong>{name}</strong>
        <small>{summary.opponentName ? `vs ${summary.opponentName}` : "No matchup this week"} · {record}</small>
      </span>
      <span className="league-monitor-score">
        <strong>{marginLabel(summary.margin)}</strong>
        <small>{win === null ? "—" : `${formatPercent(win)} win`}</small>
      </span>
      {win !== null ? (
        <span className="league-monitor-bar matchup-win-bar" aria-hidden="true">
          <span className="is-mine" style={{ width: `${win}%` }} />
        </span>
      ) : null}
      {needsAttention ? (
        <span className="league-monitor-issues">
          {summary.issues.map((issue) => (
            <Badge key={`${issue.kind}-${issue.label}`} variant="warning" size="compact" className="status-badge">{issue.label}</Badge>
          ))}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The page the app opens on: one row per league with your win chance, the
 * projected margin and any lineup problem. Tapping a league opens the usual
 * Matchup screen for it.
 */
export function MonitorHome({ dashboard, onOpenLeague }: { dashboard: Dashboard; onOpenLeague: (leagueId: string) => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const rows = useMemo(() => sortMonitorSummaries(
    dashboard.leagues.map((league) => ({
      league,
      summary: summarizeLeagueForMonitor(league, nowMs),
    })).map((row) => ({ ...row, issues: row.summary.issues })),
  ), [dashboard.leagues, nowMs]);
  const attention = rows.filter((row) => row.issues.length > 0).length;
  return (
    <section className="league-monitor" aria-labelledby="league-monitor-title">
      <Card className="league-monitor-intro gap-0 py-0 shadow-sm">
        <h2 id="league-monitor-title">Monitor</h2>
        <span>{attention === 0 ? "Every lineup is set" : `${attention} of ${rows.length} ${attention === 1 ? "league needs" : "leagues need"} attention`}</span>
      </Card>
      <div className="league-monitor-list">
        {rows.map(({ league, summary }) => (
          <LeagueRow
            key={league.id}
            name={shortLeagueName(league.name)}
            summary={summary}
            record={`${league.record.wins}-${league.record.losses}${league.record.ties ? `-${league.record.ties}` : ""}`}
            onOpen={() => onOpenLeague(league.id)}
          />
        ))}
      </div>
    </section>
  );
}
