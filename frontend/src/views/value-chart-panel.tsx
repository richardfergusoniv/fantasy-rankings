import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
import { PlayerNameLink } from "../tool-links";
import type { PlayerLinkResolver } from "../tool-player-link";
import {
  VALUE_CHART_RANGES,
  valueChartRangeStartIndex,
  valueChartYDomain,
  valueChartZoomStartIndex,
  type ValueChartRange,
} from "../value-chart-zoom";

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

/** Date with the year, for the scrubber (axis ticks omit it). */
function formatFullDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

/** Whole-number FantasyCalc values with thousands separators for tooltips. */
function formatWholeValue(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Light gray (7D solid) vs darker gray (30D dotted) — both neutral. */
const MA7_STROKE = "var(--chart-ma7)";
const MA30_STROKE = "var(--chart-ma30)";

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

export type PricingSelection = {
  pricingPlayerId?: string | null;
  pricingCompareId?: string | null;
};

export function ValueChartPanel({
  league,
  dashboard,
  initial,
  onSelectionChange,
  playerLink,
}: {
  league: League;
  dashboard: Dashboard;
  /** Selection from the URL (a link into this tool); unknown ids are ignored. */
  initial?: { playerId: string | null; compareId: string | null };
  /** Called when the user changes a picker, so the URL can follow. */
  onSelectionChange?: (patch: PricingSelection) => void;
  /** Resolves the chosen player to their card; without it the link is omitted. */
  playerLink?: PlayerLinkResolver;
}) {
  // Server maps this league key onto the nearest FantasyCalc snapshot preset.
  const formatKey = league.seasonLongFormat.key;
  const roster = useMemo(() => rosterPlayers(league), [league]);
  const pickerPlayers = useMemo(
    () => mergePickerPlayers(roster, rankingPlayers(dashboard, formatKey)),
    [dashboard, formatKey, roster],
  );
  const defaultPlayerId = roster[0]?.playerId ?? pickerPlayers[0]?.playerId ?? "";
  const knownIds = useMemo(() => new Set(pickerPlayers.map((player) => player.playerId)), [pickerPlayers]);
  const initialPlayerId = initial?.playerId && knownIds.has(initial.playerId) ? initial.playerId : null;
  const initialCompareId = initial?.compareId
    && knownIds.has(initial.compareId)
    && initial.compareId !== (initialPlayerId ?? defaultPlayerId)
    ? initial.compareId
    : null;
  const [playerId, setPlayerId] = useState(initialPlayerId ?? defaultPlayerId);
  const [comparePlayerId, setComparePlayerId] = useState(initialCompareId ?? "");
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [range, setRange] = useState<ValueChartRange>("all");
  // Index into the visible rows the scrubber reads; null follows the latest point.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
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

  // The URL is the source of truth while this tool is open: a link that drops
  // a parameter clears that picker instead of keeping the previous link's value.
  useEffect(() => { if (initialPlayerId) setPlayerId(initialPlayerId); }, [initialPlayerId]);
  useEffect(() => { setComparePlayerId(initialCompareId ?? ""); }, [initialCompareId]);

  useEffect(() => {
    if (!isExpanded) {
      setZoomed(false);
      setScrubIndex(null);
    }
  }, [isExpanded]);
  useEffect(() => { setScrubIndex(null); }, [range, zoomed, playerId, comparePlayerId]);

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
  const selectedPlayerName = pickerPlayers.find((player) => player.playerId === playerId)?.name ?? "";
  const selectedPlayerLink = selectedPlayerName
    ? playerLink?.({ playerId, name: selectedPlayerName, team: null, position: null }) ?? null
    : null;
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

  // Headline: the latest value and its change over the last 30 days.
  const summary = useMemo(() => {
    const latestIndex = chartRows.reduce((last, row, index) => (row.value !== null ? index : last), -1);
    const latest = latestIndex >= 0 ? chartRows[latestIndex] : undefined;
    if (!latest || latest.value === null) return null;
    const monthAgo = new Date(`${latest.date}T00:00:00Z`);
    monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
    const cutoff = monthAgo.toISOString().slice(0, 10);
    const earlier = chartRows.slice(0, latestIndex).reverse().find((row) => row.value !== null && row.date <= cutoff);
    return {
      value: latest.value,
      change: earlier?.value != null ? latest.value - earlier.value : null,
      compare: latest.compare,
    };
  }, [chartRows]);

  // A refetch can shift the visible window under a stored scrub index, so drop it when the rows change.
  useEffect(() => { setScrubIndex(null); }, [chartRows]);

  // Empty after trim (all ≤0) counts as unavailable — same empty copy as no history.
  const unavailable = historyQuery.isError
    || (!historyQuery.isPending && requestIds.length > 0 && (
      !primarySeries?.points.length || chartRows.length === 0
    ));
  const showChart = chartRows.length > 0 && !unavailable;

  function renderChart(options: { interactiveZoom: boolean }) {
    const effectiveZoomed = options.interactiveZoom && zoomed;
    // Projection rows follow the last historical date; ranges and the scrubber start from the history.
    const lastHistoricalDate = [...chartRows].reverse().find((row) => row.value !== null)?.date;
    const rangedRows = chartRows.slice(valueChartRangeStartIndex(chartRows.map((row) => row.date), range, lastHistoricalDate));
    // Zoom never starts past the last historical row, so a short history keeps its only point.
    const lastRangedHistoricalIndex = rangedRows.reduce((last, row, index) => (row.value !== null ? index : last), 0);
    const zoomStart = Math.min(valueChartZoomStartIndex(rangedRows.length, effectiveZoomed), lastRangedHistoricalIndex);
    const visibleRows = effectiveZoomed ? rangedRows.slice(zoomStart) : rangedRows;
    const defaultScrubIndex = visibleRows.reduce((last, row, index) => (row.value !== null ? index : last), 0);
    // Tapping or hovering the plot moves the scrubber, so the tooltip and the readout never disagree.
    const syncScrubToPointer = (state: { activeTooltipIndex?: number | string | null }) => {
      const index = Number(state?.activeTooltipIndex);
      if (Number.isInteger(index) && index >= 0 && index < visibleRows.length) setScrubIndex(index);
    };
    const scrubPosition = Math.min(scrubIndex ?? defaultScrubIndex, visibleRows.length - 1);
    const scrubbed = visibleRows.length > 0 ? visibleRows[scrubPosition] : undefined;
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
            <div className="value-chart-ranges" role="group" aria-label="Date range">
              {VALUE_CHART_RANGES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="scatter-zoom-toggle"
                  aria-pressed={range === option.id}
                  onClick={() => setRange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          className={compact ? undefined : "scatter-axis-rail"}
          role="img"
          aria-label={`${primarySeries?.name ?? "Player"} FantasyCalc value chart`}
        >
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
                onClick={options.interactiveZoom ? syncScrubToPointer : undefined}
                onMouseEnter={options.interactiveZoom ? syncScrubToPointer : undefined}
                onMouseMove={options.interactiveZoom ? syncScrubToPointer : undefined}
                margin={compact
                  ? { top: 6, right: 6, bottom: 2, left: 0 }
                  : { top: 8, right: 8, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke="var(--hairline)" strokeDasharray="1 6" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateTick}
                  tick={{ fill: "var(--dim)", fontSize: compact ? 10 : 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--hairline)" }}
                  minTickGap={28}
                />
                <YAxis
                  width={40}
                  tick={{ fill: "var(--dim)", fontSize: compact ? 10 : 12 }}
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
              {scrubbed && options.interactiveZoom ? (
                <ReferenceLine x={scrubbed.date} stroke="var(--foreground)" strokeWidth={1} ifOverflow="extendDomain" />
              ) : null}
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
        {options.interactiveZoom && scrubbed && visibleRows.length > 1 ? (
          <div className="value-chart-scrubber">
            <input
              type="range"
              aria-label="Scrub chart date"
              aria-valuetext={formatFullDate(scrubbed.date)}
              min={0}
              max={visibleRows.length - 1}
              step={1}
              value={scrubPosition}
              onChange={(event) => setScrubIndex(Number(event.target.value))}
            />
            <dl className="value-chart-readout" aria-live="polite">
              <div><dt>Date</dt><dd>{formatFullDate(scrubbed.date)}</dd></div>
              <div><dt>Value</dt><dd>{scrubbed.value === null ? "—" : formatWholeValue(scrubbed.value)}</dd></div>
              <div><dt>7D avg</dt><dd>{scrubbed.ma7 === null ? "—" : formatWholeValue(scrubbed.ma7)}</dd></div>
              <div><dt>30D avg</dt><dd>{scrubbed.ma30 === null ? "—" : formatWholeValue(scrubbed.ma30)}</dd></div>
              {comparePlayerId ? <div><dt>{compareName}</dt><dd>{scrubbed.compare === null ? "—" : formatWholeValue(scrubbed.compare)}</dd></div> : null}
            </dl>
          </div>
        ) : null}
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
    <section className="monitor-section monitor-value-chart-panel">
      <header className="sr-only">
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
                  onSelectionChange?.({
                    pricingPlayerId: next,
                    ...(next && next === comparePlayerId ? { pricingCompareId: null } : {}),
                  });
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
                onChange={(event) => {
                  setComparePlayerId(event.target.value);
                  onSelectionChange?.({ pricingCompareId: event.target.value || null });
                }}
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
              <div className="pricing-summary">
                {summary ? (
                  <div className="pricing-figures">
                    <p className="pricing-figure">
                      <span className="pricing-value">{formatWholeValue(summary.value)}</span>
                      {summary.change !== null ? (
                        <span className={`pricing-change${summary.change > 0 ? " is-up" : summary.change < 0 ? " is-down" : ""}`}>
                          {summary.change !== 0 ? <span aria-hidden="true">{summary.change > 0 ? "▲" : "▼"}</span> : null}
                          {summary.change !== 0 ? <span className="sr-only">{summary.change > 0 ? "Up" : "Down"}</span> : null}
                          {formatWholeValue(Math.abs(summary.change))}
                          <span className="pricing-change-span">30D</span>
                        </span>
                      ) : null}
                    </p>
                    {comparePlayerId && summary.compare !== null ? (
                      <p className="pricing-figure is-compare">
                        <i aria-hidden="true" />
                        <span>{compareName}</span>
                        <span className="pricing-compare-value">{formatWholeValue(summary.compare)}</span>
                      </p>
                    ) : null}
                    {selectedPlayerLink ? (
                      <p className="tool-player-link-row">
                        <PlayerNameLink link={selectedPlayerLink}>View {selectedPlayerName}’s card</PlayerNameLink>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="value-chart-ranges" role="group" aria-label="Date range">
                  {VALUE_CHART_RANGES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="scatter-zoom-toggle"
                      aria-pressed={range === option.id}
                      onClick={() => setRange(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="scatter-zoom-toggle pricing-expand"
                    aria-label="Open Pricing. The expanded view has a zoom and a date scrubber."
                    onClick={() => setIsExpanded(true)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
              <div
                className="monitor-chart-expand-target"
                role="button"
                tabIndex={0}
                aria-label="Open Pricing. The expanded view has a zoom and a date scrubber."
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
    </section>
  );
}
