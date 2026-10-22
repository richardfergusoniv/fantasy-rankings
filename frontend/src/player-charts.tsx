import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import type { TradeAsset, ValueHistorySeries } from "./dashboard-types";
import { buildAggregateTradeHistoryData } from "./lib/aggregate-trade-history";
import { trimValueHistoryToContinuousStart } from "./value-history-domain";
import { formatWhole } from "./lib/format-number";

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
        {change !== null ? <strong className={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{formatWhole(change, { sign: "exceptZero" })}</strong> : isLoading && !history ? null : <strong className="flat">{points.length} snapshot{points.length === 1 ? "" : "s"}</strong>}
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
              <Tooltip labelFormatter={(label) => formatDateTick(String(label))} formatter={(value) => [formatWhole(Number(value)), "Value"]} contentStyle={chartTooltipStyle} />
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
  anchorDate = null,
  giveColor = "var(--chart-4)",
  getColor = "var(--chart-3)",
  giveStrokeWidth = 2.3,
  getStrokeWidth = 2.3,
}: {
  give: TradeAsset[];
  get: TradeAsset[];
  historyByPlayerId: Map<string, ValueHistorySeries>;
  isLoading: boolean;
  /** YYYY-MM-DD trade day for historical trades; omit for live (latest point). */
  anchorDate?: string | null;
  giveColor?: string;
  getColor?: string;
  giveStrokeWidth?: number;
  getStrokeWidth?: number;
}) {
  // Same per-asset bar values (incl. waiver) with history scaled to the anchor.
  const historyPointsByPlayerId = new Map(
    [...historyByPlayerId.entries()].map(([id, series]) => [id, series.points]),
  );
  const data = buildAggregateTradeHistoryData({
    give,
    get,
    historyByPlayerId: historyPointsByPlayerId,
    anchorDate,
  });
  const hasGive = data.some((point) => point.give !== null);
  const hasGet = data.some((point) => point.get !== null);
  const formatDateTick = (value: string): string => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  };
  const giveIsWinner = giveColor === "var(--winner)";
  const getIsWinner = getColor === "var(--winner)";

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
                <Tooltip labelFormatter={(label) => formatDateTick(String(label))} formatter={(value, name) => [formatWhole(Number(value)), name === "give" ? "You give" : "You get"]} contentStyle={chartTooltipStyle} />
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
