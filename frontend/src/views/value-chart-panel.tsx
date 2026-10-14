import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
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
import { ChartDialog } from "../chart-dialog";
import type { Dashboard, League } from "../dashboard-types";
import {
  activeValueHistoryStartDate,
  isSubstantialValueHistorySeries,
  sliceValueHistoryForSharedDomain,
  trimValueHistoryToContinuousStart,
} from "../value-history-domain";
import { valueChartYDomain, valueChartZoomStartIndex } from "../value-chart-zoom";

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
  const includePicks = formatKey.startsWith("dynasty");
  return dashboard.seasonLongRankings
    .filter((row) => (
      row.formatKey === formatKey
      && row.playerId
      && (includePicks || row.position !== "PICK")
    ))
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoomed, setZoomed] = useState(false);
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

  useEffect(() => {
    if (!isExpanded) setZoomed(false);
  }, [isExpanded]);

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
    // Drop leading ≤0 values and isolated early outliers (e.g. sparse Jan
    // redraft rows) so the x-axis starts at the continuous series.
    const primaryTrimmed = trimValueHistoryToContinuousStart(primarySeries.points);
    if (!primaryTrimmed.length) return [];
    const compareTrimmed = compareSeries?.points.length
      ? trimValueHistoryToContinuousStart(compareSeries.points)
      : null;
    const startDate = activeValueHistoryStartDate([
      primaryTrimmed,
      ...(compareTrimmed?.length ? [compareTrimmed] : []),
    ]);
    let primary = sliceValueHistoryForSharedDomain(primaryTrimmed, startDate);
    // Keep a substantial non-overlapping primary; do not resurrect an isolated
    // early outlier that the shared cutoff correctly dropped.
    if (!primary.length && isSubstantialValueHistorySeries(primaryTrimmed)) {
      primary = primaryTrimmed;
    }
    if (!primary.length) return [];
    const compare = compareTrimmed?.length
      ? sliceValueHistoryForSharedDomain(compareTrimmed, startDate)
      : null;
    return buildChartRows(primary, compare?.length ? compare : null);
  }, [compareSeries?.points, primarySeries?.points]);

  // Empty after trim (all ≤0) counts as unavailable — same empty copy as no history.
  const unavailable = historyQuery.isError
    || (!historyQuery.isPending && requestIds.length > 0 && (
      !primarySeries?.points.length || chartRows.length === 0
    ));
  const showChart = chartRows.length > 0 && !unavailable;

  function renderChart(options: { interactiveZoom: boolean }) {
    const effectiveZoomed = options.interactiveZoom && zoomed;
    const zoomStart = valueChartZoomStartIndex(chartRows.length, effectiveZoomed);
    const visibleRows = effectiveZoomed ? chartRows.slice(zoomStart) : chartRows;
    const yDomain = valueChartYDomain(
      visibleRows.flatMap((row) => [
        row.value,
        row.ma7,
        row.ma30,
        row.compare,
        row.trendCenter,
        ...(row.trendBand ?? []),
      ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
      effectiveZoomed,
    );
    const toggleZoom = () => setZoomed((value) => !value);
    const compact = !options.interactiveZoom;
    return (
      <div
        className={`monitor-value-chart${options.interactiveZoom ? " is-expanded-pricing" : " is-compact"}`}
        role="img"
        aria-label={`${primarySeries?.name ?? "Player"} FantasyCalc value chart`}
      >
        {options.interactiveZoom ? (
          <div className="scatter-zoom-controls">
            <button
              type="button"
              className="scatter-zoom-toggle"
              aria-pressed={effectiveZoomed}
              onClick={toggleZoom}
            >
              {effectiveZoomed ? "Reset" : "Zoom in"}
            </button>
            <span className="sr-only">
              Double-tap the chart to {effectiveZoomed ? "reset" : "zoom into recent values"}.
            </span>
          </div>
        ) : null}
        <div className={compact ? undefined : "scatter-axis-rail"}>
          {compact ? null : <span className="scatter-axis-y" aria-hidden="true">Value</span>}
          <div
            className="scatter-plot-body"
            onDoubleClick={options.interactiveZoom ? (event) => {
              event.preventDefault();
              toggleZoom();
            } : undefined}
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
              <ComposedChart
                data={visibleRows}
                margin={compact
                  ? { top: 6, right: 6, bottom: 2, left: 0 }
                  : { top: 8, right: 8, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke="var(--hairline)" strokeDasharray="1 6" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateTick}
                  tick={{ fill: "var(--dim)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--hairline)" }}
                  minTickGap={28}
                />
                <YAxis
                  width={compact ? 32 : 36}
                  tick={{ fill: "var(--dim)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={yDomain}
                  allowDataOverflow={effectiveZoomed}
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
          {compact ? null : <span className="scatter-axis-x" aria-hidden="true">Date</span>}
        </div>
        <ul className="monitor-pricing-key" aria-hidden="true">
          <li><i className="is-value" />Value</li>
          <li><i className="is-ma7" />7D avg</li>
          <li><i className="is-ma30" />30D avg</li>
          <li><i className="is-trend" />Trend projection</li>
          {comparePlayerId ? <li><i className="is-compare" />{compareName}</li> : null}
        </ul>
      </div>
    );
  }

  return (
    <article className="monitor-panel monitor-value-chart-panel">
      <header className="monitor-panel-header">
        <h2>Pricing</h2>
      </header>
      {pickerPlayers.length === 0 ? (
        <p className="monitor-empty">Values unavailable</p>
      ) : (
        <>
          <div className="monitor-value-chart-controls">
            <label className="monitor-value-chart-field">
              <span>Player</span>
              <select
                aria-label="Pricing player"
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
                aria-label="Pricing compare player"
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
            <>
              <div
                className="monitor-chart-expand-target"
                role="button"
                tabIndex={0}
                aria-label="Open Pricing"
                onClick={() => setIsExpanded(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIsExpanded(true);
                  }
                }}
              >
                {renderChart({ interactiveZoom: false })}
              </div>
              <ChartDialog
                isOpen={isExpanded}
                onClose={() => setIsExpanded(false)}
                title="Pricing"
                showCount={false}
                closeLabel="Close"
                className="monitor-chart-expand-card"
              >
                <div className="monitor-expanded-chart">
                  {renderChart({ interactiveZoom: true })}
                </div>
              </ChartDialog>
            </>
          ) : null}
        </>
      )}
    </article>
  );
}
