import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import type { TradeAsset, ValueHistorySeries } from "./dashboard-types";
import {
  activeValueHistoryStartDate,
  sliceValueHistoryForSharedDomain,
  trimValueHistoryToContinuousStart,
} from "./value-history-domain";

export function PlayerValueTrend({ name, history, isLoading }: { name: string; history: ValueHistorySeries | undefined; isLoading: boolean }) {
  const points = trimValueHistoryToContinuousStart(history?.points ?? []);
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last && points.length > 1 ? last.value - first.value : null;
  const formatDateTick = (value: string): string => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  };

  return (
    <section className="player-value-trend" aria-label={`${name} FantasyCalc value history`}>
      <div className="trade-stock-heading">
        <span>Value history</span>
        {change !== null ? <strong className={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{change > 0 ? "+" : ""}{change.toLocaleString()}</strong> : isLoading && !history ? null : <strong className="flat">{points.length} snapshot{points.length === 1 ? "" : "s"}</strong>}
      </div>
      {isLoading && !history ? (
        <div className="loading-shimmer player-value-trend-loading" aria-hidden="true" />
      ) : points.length ? (
        <div className="player-value-trend-chart" role="img" aria-label={`${name} FantasyCalc value from ${first?.date ?? "first snapshot"} to ${last?.date ?? "latest snapshot"}`}>
          <ChartContainer config={{ value: { label: "Value", color: "var(--chart-1)" } }} className="aspect-auto h-full">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 18, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={18} />
              <YAxis domain={["dataMin", "dataMax"]} width={42} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(label) => formatDateTick(String(label))} contentStyle={chartTooltipStyle} />
              <Line type="monotone" dataKey="value" name="Value" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: points.length === 1 ? 3 : 2, fill: "var(--chart-1)" }} activeDot={{ r: 4 }} connectNulls={false} />
            </LineChart>
          </ChartContainer>
        </div>
      ) : <div className="player-value-trend-empty">{isLoading ? "Loading daily snapshots…" : "History begins with the next successful daily snapshot."}</div>}
    </section>
  );
}

export function AggregateTradeHistory({
  give,
  get,
  historyByPlayerId,
  isLoading,
  giveColor = "var(--chart-4)",
  getColor = "var(--chart-3)",
  giveStrokeWidth = 2.3,
  getStrokeWidth = 2.3,
}: {
  give: TradeAsset[];
  get: TradeAsset[];
  historyByPlayerId: Map<string, ValueHistorySeries>;
  isLoading: boolean;
  giveColor?: string;
  getColor?: string;
  giveStrokeWidth?: number;
  getStrokeWidth?: number;
}) {
  // Per-asset continuous trim, then a shared start across plotted assets so
  // one isolated early point cannot pad empty months on the x-axis.
  const trimmedPointsByPlayerId = new Map(
    [...historyByPlayerId.entries()].map(([id, series]) => [
      id,
      trimValueHistoryToContinuousStart(series.points),
    ]),
  );
  const plottedTrimmedSeries = [...give, ...get].flatMap((asset) => {
    const points = trimmedPointsByPlayerId.get(asset.playerId);
    return points?.length ? [points] : [];
  });
  const startDate = activeValueHistoryStartDate(plottedTrimmedSeries);
  const chartPointsByPlayerId = new Map(
    [...trimmedPointsByPlayerId.entries()].map(([id, points]) => [
      id,
      sliceValueHistoryForSharedDomain(points, startDate),
    ]),
  );
  // Assets with no stored history must not null out a mixed side's aggregate.
  const chartGive = give.filter((asset) => (chartPointsByPlayerId.get(asset.playerId)?.length ?? 0) > 0);
  const chartGet = get.filter((asset) => (chartPointsByPlayerId.get(asset.playerId)?.length ?? 0) > 0);
  const dates = [...new Set(
    [...chartGive, ...chartGet].flatMap((asset) => (
      chartPointsByPlayerId.get(asset.playerId)?.map((point) => point.date) ?? []
    )),
  )].sort();
  const pointMap = new Map(
    [...chartPointsByPlayerId.entries()].map(([id, points]) => [
      id,
      new Map(points.map((point) => [point.date, point.value])),
    ]),
  );
  const totalOn = (assets: TradeAsset[], date: string): number | null => {
    if (assets.length === 0) return null;
    const values = assets.map((asset) => pointMap.get(asset.playerId)?.get(date));
    return values.every((value): value is number => typeof value === "number") ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const data = dates.map((date) => ({ date, give: totalOn(chartGive, date), get: totalOn(chartGet, date) }));
  const hasGive = data.some((point) => point.give !== null);
  const hasGet = data.some((point) => point.get !== null);
  const formatDateTick = (value: string): string => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  };
  const giveIsWinner = giveColor === "var(--warning)";
  const getIsWinner = getColor === "var(--warning)";

  return (
    <section className="trade-aggregate" aria-labelledby="trade-aggregate-heading">
      <div className="section-heading"><h2 id="trade-aggregate-heading">30-day trade value</h2><span>selected assets</span></div>
      {data.length > 0 && (hasGive || hasGet) ? (
        <>
          <div className="trade-aggregate-chart" role="img" aria-label="Thirty-day FantasyCalc total value for each side of the trade">
            <ChartContainer config={{ give: { label: "You give", color: giveColor }, get: { label: "You get", color: getColor } }} className="aspect-auto h-full">
              <LineChart data={data} margin={{ top: 14, right: 12, bottom: 18, left: 2 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
                <YAxis width={48} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(label) => formatDateTick(String(label))} formatter={(value, name) => [Number(value).toLocaleString(), name === "give" ? "You give" : "You get"]} contentStyle={chartTooltipStyle} />
                {hasGive ? <Line type="monotone" dataKey="give" name="give" stroke={giveColor} strokeWidth={giveStrokeWidth} dot={false} connectNulls={false} /> : null}
                {hasGet ? <Line type="monotone" dataKey="get" name="get" stroke={getColor} strokeWidth={getStrokeWidth} dot={false} connectNulls={false} /> : null}
              </LineChart>
            </ChartContainer>
          </div>
          <div className="trade-aggregate-key">
            <span><i className={`give${giveIsWinner ? " is-winner" : ""}`} style={{ background: giveColor }} />You give</span>
            <span><i className={`get${getIsWinner ? " is-winner" : ""}`} style={{ background: getColor }} />You get</span>
          </div>
        </>
      ) : <div className="trade-stock-empty">{isLoading ? "Loading FantasyCalc history…" : "Add a player or draft pick to either side to chart its sourced daily value."}</div>}
    </section>
  );
}
