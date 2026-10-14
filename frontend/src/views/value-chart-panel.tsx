import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import {
  calendarMovingAverage,
  dampenedTrendCone,
  type ValueChartPoint,
} from "../../../api/_lib/value-chart-math";
import { api } from "../api";
import type { Dashboard, League } from "../dashboard-types";

type PickerPlayer = {
  playerId: string;
  name: string;
  position: string;
};

type ChartRow = {
  date: string;
  value: number | null;
  ma7: number | null;
  ma30: number | null;
  compare: number | null;
  trendCenter: number | null;
  trendBand: [number, number] | null;
};

function formatDateTick(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** Whole-number FantasyCalc values with thousands separators for tooltips. */
function formatWholeValue(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Light gray (7D solid) vs darker gray (30D dotted) — both neutral. */
const MA7_STROKE = "#c5ccd8";
const MA30_STROKE = "#6b7588";

function rosterPlayers(league: League): PickerPlayer[] {
  const seen = new Set<string>();
  const out: PickerPlayer[] = [];
  for (const player of [...league.starters, ...league.bench]) {
    if (!player.playerId || seen.has(player.playerId)) continue;
    seen.add(player.playerId);
    out.push({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
    });
  }
  return out;
}

function rankingPlayers(dashboard: Dashboard, formatKey: string): PickerPlayer[] {
  return dashboard.seasonLongRankings
    .filter((row) => row.formatKey === formatKey && row.position !== "PICK" && row.playerId)
    .map((row) => ({
      playerId: row.playerId,
      name: row.name,
      position: row.position,
    }));
}

function mergePickerPlayers(roster: PickerPlayer[], rankings: PickerPlayer[]): PickerPlayer[] {
  const seen = new Set<string>();
  const out: PickerPlayer[] = [];
  for (const player of [...roster, ...rankings]) {
    if (seen.has(player.playerId)) continue;
    seen.add(player.playerId);
    out.push(player);
  }
  return out.sort((left, right) => left.name.localeCompare(right.name));
}

function buildChartRows(
  primary: ValueChartPoint[],
  compare: ValueChartPoint[] | null,
): ChartRow[] {
  const ma7 = calendarMovingAverage(primary, 7);
  const ma30 = calendarMovingAverage(primary, 30);
  const compareByDate = new Map((compare ?? []).map((point) => [point.date, point.value]));
  const cone = dampenedTrendCone(primary);
  const coneByDate = new Map(cone.map((point) => [point.date, point]));

  const dates = new Set<string>();
  for (const point of primary) dates.add(point.date);
  for (const point of compare ?? []) dates.add(point.date);
  for (const point of cone) dates.add(point.date);

  const primaryByDate = new Map(primary.map((point, index) => [point.date, index]));
  return [...dates].sort().map((date) => {
    const primaryIndex = primaryByDate.get(date);
    const conePoint = coneByDate.get(date);
    return {
      date,
      value: primaryIndex === undefined ? null : primary[primaryIndex]?.value ?? null,
      ma7: primaryIndex === undefined ? null : ma7[primaryIndex] ?? null,
      ma30: primaryIndex === undefined ? null : ma30[primaryIndex] ?? null,
      compare: compareByDate.get(date) ?? null,
      trendCenter: conePoint?.center ?? null,
      trendBand: conePoint ? [conePoint.low, conePoint.high] : null,
    };
  });
}

export function ValueChartPanel({
  league,
  dashboard,
}: {
  league: League;
  dashboard: Dashboard;
}) {
  // Server maps this league key onto the nearest FantasyCalc snapshot preset.
  const formatKey = league.seasonLongFormat.key;
  const roster = useMemo(() => rosterPlayers(league), [league]);
  const pickerPlayers = useMemo(
    () => mergePickerPlayers(roster, rankingPlayers(dashboard, formatKey)),
    [dashboard, formatKey, roster],
  );
  const defaultPlayerId = roster[0]?.playerId ?? pickerPlayers[0]?.playerId ?? "";
  const [playerId, setPlayerId] = useState(defaultPlayerId);
  const [comparePlayerId, setComparePlayerId] = useState("");
  const previousLeagueIdRef = useRef(league.id);

  useEffect(() => {
    const leagueChanged = previousLeagueIdRef.current !== league.id;
    previousLeagueIdRef.current = league.id;
    const ids = new Set(pickerPlayers.map((player) => player.playerId));
    const fallbackId = roster[0]?.playerId ?? pickerPlayers[0]?.playerId ?? "";

    if (leagueChanged) {
      setPlayerId(fallbackId);
      setComparePlayerId("");
      return;
    }

    // Dashboard refresh can reorder starters; keep selections when still valid.
    setPlayerId((current) => (current && ids.has(current) ? current : fallbackId));
    setComparePlayerId((current) => (current && ids.has(current) ? current : ""));
  }, [league.id, pickerPlayers, roster]);

  const requestIds = useMemo(() => {
    const ids = [playerId, comparePlayerId].filter(Boolean);
    return [...new Set(ids)];
  }, [comparePlayerId, playerId]);

  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", formatKey, requestIds],
    queryFn: () => api.getValueHistory({ formatKey, playerIds: requestIds }),
    enabled: requestIds.length > 0,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: 1,
  });

  const primarySeries = historyQuery.data?.series.find((series) => series.playerId === playerId);
  const compareSeries = comparePlayerId
    ? historyQuery.data?.series.find((series) => series.playerId === comparePlayerId)
    : undefined;
  const compareName = compareSeries?.name
    ?? pickerPlayers.find((player) => player.playerId === comparePlayerId)?.name
    ?? "Compare";

  const chartRows = useMemo(() => {
    if (!primarySeries?.points.length) return [];
    return buildChartRows(
      primarySeries.points,
      compareSeries?.points.length ? compareSeries.points : null,
    );
  }, [compareSeries?.points, primarySeries?.points]);

  const unavailable = historyQuery.isError
    || (!historyQuery.isPending && requestIds.length > 0 && !primarySeries?.points.length);
  const showChart = chartRows.length > 0 && !unavailable;

  return (
    <article className="monitor-panel monitor-value-chart-panel">
      <header className="monitor-panel-header">
        <h2>Value chart</h2>
      </header>
      {pickerPlayers.length === 0 ? (
        <p className="monitor-empty">Values unavailable</p>
      ) : (
        <>
          <div className="monitor-value-chart-controls">
            <label className="monitor-value-chart-field">
              <span>Player</span>
              <select
                aria-label="Value chart player"
                value={playerId}
                onChange={(event) => {
                  const next = event.target.value;
                  setPlayerId(next);
                  if (next && next === comparePlayerId) setComparePlayerId("");
                }}
              >
                {pickerPlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="monitor-value-chart-field">
              <span>Compare</span>
              <select
                aria-label="Value chart compare player"
                value={comparePlayerId}
                onChange={(event) => setComparePlayerId(event.target.value)}
              >
                <option value="">None</option>
                {pickerPlayers
                  .filter((player) => player.playerId !== playerId)
                  .map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {unavailable ? (
            <p className="monitor-empty">Values unavailable</p>
          ) : showChart ? (
            <div
              className="monitor-value-chart"
              role="img"
              aria-label={`${primarySeries?.name ?? "Player"} FantasyCalc value chart`}
            >
              <ChartContainer
                config={{
                  value: { label: "Value", color: "var(--chart-1)" },
                  ma7: { label: "7D avg", color: MA7_STROKE },
                  ma30: { label: "30D avg", color: MA30_STROKE },
                  trendBand: { label: "Trend projection", color: "var(--chart-2)" },
                  compare: { label: compareName, color: "var(--chart-5)" },
                }}
                className="aspect-auto h-full"
              >
                <ComposedChart data={chartRows} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateTick}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    minTickGap={28}
                    label={{
                      value: "Date",
                      position: "insideBottom",
                      offset: -2,
                      fill: "var(--dim)",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  <YAxis
                    width={40}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, "auto"]}
                    label={{
                      value: "Value",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--dim)",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  <Tooltip
                    labelFormatter={(label) => formatDateTick(String(label))}
                    contentStyle={chartTooltipStyle}
                    formatter={(value, name) => {
                      if (Array.isArray(value)) {
                        return [
                          `${formatWholeValue(Number(value[0]))} – ${formatWholeValue(Number(value[1]))}`,
                          "Trend projection",
                        ];
                      }
                      if (value == null || Number.isNaN(Number(value))) return ["—", String(name)];
                      return [formatWholeValue(Number(value)), String(name)];
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    wrapperStyle={{ fontSize: 11, color: "var(--dim)" }}
                    payload={[
                      { value: "Value", type: "line", id: "value", color: "var(--chart-1)" },
                      { value: "7D avg", type: "line", id: "ma7", color: MA7_STROKE },
                      { value: "30D avg", type: "line", id: "ma30", color: MA30_STROKE },
                      { value: "Trend projection", type: "square", id: "trend", color: "var(--chart-2)" },
                      ...(comparePlayerId
                        ? [{ value: compareName, type: "line" as const, id: "compare", color: "var(--chart-5)" }]
                        : []),
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="trendBand"
                    name="Trend projection"
                    stroke="var(--chart-2)"
                    fill="var(--chart-2)"
                    fillOpacity={0.18}
                    strokeWidth={0}
                    dot={false}
                    connectNulls={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="trendCenter"
                    name="Trend projection"
                    stroke="var(--chart-2)"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ma7"
                    name="7D avg"
                    stroke={MA7_STROKE}
                    strokeWidth={1}
                    dot={false}
                    connectNulls={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ma30"
                    name="30D avg"
                    stroke={MA30_STROKE}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    dot={false}
                    connectNulls={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="Value"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  {comparePlayerId ? (
                    <Line
                      type="monotone"
                      dataKey="compare"
                      name={compareName}
                      stroke="var(--chart-5)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      legendType="none"
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ChartContainer>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
