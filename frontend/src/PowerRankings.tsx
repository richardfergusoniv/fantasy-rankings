import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import type { api, ApiResponse } from "./api";
import { positionLabel } from "./league-team-card";
import { SegmentedControl, points, shortLeagueName } from "./shared";
import { formatPercent, formatWhole } from "./lib/format-number";
import { PowerStackList, type PowerStackTeam } from "./views/power-stack-list";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type League = Dashboard["leagues"][number];
type PowerPosition = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";

export function PowerRankings({
  league,
}: {
  league: League;
}) {
  const [scope, setScope] = useState<"week" | "restOfSeason">("week");
  const [mode, setMode] = useState<"seasonLong" | "dynasty">("seasonLong");
  const isDynastyLeague = league.seasonLongFormat.isDynasty;
  const activeMode = isDynastyLeague ? mode : "seasonLong";
  const isWeekly = scope !== "restOfSeason";
  const powerRankings = scope === "week"
    ? league.powerRankingsWeek
    : activeMode === "dynasty" ? league.powerRankingsDynasty : league.powerRankingsSeasonLong;
  const mine = powerRankings.find((team) => team.isUser);
  const positions: PowerPosition[] = isWeekly
    ? ["QB", "RB", "WR", "TE", "FLEX"]
    : ["QB", "RB", "WR", "TE"];
  if (isWeekly && league.rankingPositions.includes("K")) positions.push("K");
  if (isWeekly && league.rankingPositions.includes("DEF")) positions.push("DEF");

  const displayedTeams = useMemo(
    () => [...powerRankings].sort((a, b) => a.rank - b.rank),
    [powerRankings],
  );
  const isDynastyView = scope === "restOfSeason" && activeMode === "dynasty";
  const leagueAveragePicks = isDynastyView && powerRankings.length > 0
    ? powerRankings.reduce((total, team) => total + team.futurePickValue, 0) / powerRankings.length
    : null;

  const radarData = positions.map((position) => {
    const values = powerRankings.map((team) => team.positionValues[position]);
    const value = mine?.positionValues[position] ?? 0;
    const average = values.length ? values.reduce((total, item) => total + item, 0) / values.length : 0;
    const leader = Math.max(1, ...values);
    return {
      position,
      value,
      average,
      strength: Math.round((value / leader) * 100),
      averageStrength: Math.round((average / leader) * 100),
    };
  });

  const stackTeams: PowerStackTeam[] = displayedTeams.map((team) => ({
    rosterId: team.rosterId,
    rank: team.rank,
    teamName: team.teamName,
    isUser: team.isUser,
    segments: [
      ...positions.map((position) => ({ key: position, label: positionLabel(position), value: team.positionValues[position] })),
      ...(isDynastyView ? [{ key: "PICKS", label: "PICKS", value: team.futurePickValue }] : []),
    ],
  }));

  const radarPoint = (index: number, percent: number, radius = 90): string => {
    const angle = (-90 + index * (360 / positions.length)) * Math.PI / 180;
    const distance = radius * Math.max(0, Math.min(100, percent)) / 100;
    return `${150 + Math.cos(angle) * distance},${130 + Math.sin(angle) * distance}`;
  };
  const teamPolygon = radarData.map((row, index) => radarPoint(index, row.strength)).join(" ");
  const averagePolygon = radarData.map((row, index) => radarPoint(index, row.averageStrength)).join(" ");
  const totalAverage = radarData.reduce((total, row) => total + row.average, 0);
  const leagueAverageDisplayTotal = leagueAveragePicks !== null
    ? totalAverage + leagueAveragePicks
    : totalAverage;
  const scopeToggle = (
    <SegmentedControl
      className="lineup-mode-toggle power-scope-toggle page-tab-control compact-control"
      value={scope === "week" ? "week" : activeMode === "dynasty" ? "dynasty" : "ros"}
      onChange={(value) => {
        if (value === "week") {
          setScope("week");
        } else if (value === "ros") {
          setScope("restOfSeason");
          setMode("seasonLong");
        } else {
          setScope("restOfSeason");
          setMode("dynasty");
        }
      }}
      label="Power ranking horizon"
      options={isDynastyLeague
        ? [{ value: "week", label: "This week" }, { value: "ros", label: "Season long" }, { value: "dynasty", label: "Dynasty" }]
        : [{ value: "week", label: "This week" }, { value: "ros", label: "Season long" }]}
    />
  );

  if (!mine || powerRankings.length === 0) {
    return (
      <section className="power-view">
        {scopeToggle}
        <div className="analytics-empty">
          <strong>{scope === "week" ? "No weekly power rankings yet." : activeMode === "dynasty" ? "No dynasty power rankings for this league." : "No rest-of-season power rankings for this league."}</strong>
          <span>{scope === "week" ? "Refresh to check the latest Vegas lines and nflverse usage data." : "Refresh after FantasyCalc publishes values for this league format."}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="power-view">
      {scopeToggle}
      <Card className="power-hero gap-0 py-0 shadow-sm">
        <div>
          <span>Your power rank</span>
          <strong>#{mine.rank}</strong>
        </div>
      </Card>

      <section className="power-chart-section" aria-labelledby="position-strength-heading">
        <div className="section-heading power-section-heading">
          <h2 id="position-strength-heading">Position strength</h2>
        </div>
        <div className="power-radar" role="img" aria-label={`Spider chart of your ${isWeekly ? "optimized lineup" : "roster"} strength by position in ${shortLeagueName(league.name)}`}>
          <svg viewBox="0 0 300 260" aria-hidden="true">
            {[25, 50, 75, 100].map((level) => <polygon key={level} points={positions.map((_position, index) => radarPoint(index, level)).join(" ")} className="radar-grid" />)}
            {positions.map((_position, index) => <line key={index} x1="150" y1="130" x2={radarPoint(index, 100).split(",")[0]} y2={radarPoint(index, 100).split(",")[1]} className="radar-axis" />)}
            <polygon points={averagePolygon} className="radar-average" />
            <polygon points={teamPolygon} className="radar-team" />
            {radarData.map((row, index) => {
              const [x = "150", y = "130"] = radarPoint(index, row.strength).split(",");
              return <circle key={row.position} cx={x} cy={y} r="3.5" className="radar-dot"><title>{`${positionLabel(row.position)}: ${isWeekly ? points(row.value) : formatWhole(row.value)} (${formatPercent(row.strength)} of league leader)`}</title></circle>;
            })}
            {positions.map((position, index) => {
              const [xText = "150", yText = "130"] = radarPoint(index, 100, 112).split(",");
              const x = Number(xText);
              return <text key={position} x={xText} y={Number(yText) + 4} textAnchor={x > 165 ? "start" : x < 135 ? "end" : "middle"}>{positionLabel(position)}</text>;
            })}
          </svg>
        </div>
        <p className="power-position-table-label">League average</p>
        <div className="power-position-values">
          {radarData.map((row) => (
            <span key={row.position}><span>{positionLabel(row.position)}</span><strong>{isWeekly ? points(row.average) : formatWhole(row.average)}</strong></span>
          ))}
          {leagueAveragePicks !== null ? (
            <span><span>PICKS</span><strong>{formatWhole(leagueAveragePicks)}</strong></span>
          ) : null}
          {isWeekly ? <span className="power-position-total-highlight"><span>Total</span><strong>{points(totalAverage)}</strong></span> : <span className={leagueAveragePicks !== null ? "power-position-total-highlight" : "power-position-total power-position-total-highlight"}><span>Total</span><strong>{formatWhole(leagueAverageDisplayTotal)}</strong></span>}
        </div>
      </section>

      <section className="power-table-section" aria-labelledby="power-stack-heading">
        <div className="section-heading power-section-heading">
          <h2 id="power-stack-heading">Every team by position</h2>
        </div>
        <PowerStackList teams={stackTeams} weekly={isWeekly} />
      </section>
    </section>
  );
}
