import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { eligibleForSlot, optimizeTradeRoster as optimizeLockedTradeRoster } from "../../../api/_lib/lineup-optimizer";
import { api } from "../api";
import type {
  Dashboard,
  HistoricalTrade,
  HistoricalTradeTeam,
  League,
  OptimizedRoster,
  RosterPlayer,
  TradeAsset,
  TradeTeam,
} from "../dashboard-types";
import type { TradeMode } from "../dashboard-url";
import {
  DesignationBadge,
  comparablePlayerName,
  showUndoToast,
  signOutForPersonalData,
  sleeperInjuryTag,
  tradeTotal,
} from "../dashboard-shared";
import { buildLeagueRosterRows, compactAssetName, formatLineupImpact, formatTeamRecord, rosterPositionLabel, type LeagueRosterRow, type TeamRecord } from "../league-trade";
import { formatDecimal } from "../lib/format-number";
import { AggregateTradeHistory } from "../player-charts";
import { SegmentedControl } from "../shared";
import { clearTradeSide, removeTradePlayer, restoreTradePlayer } from "../undo";
import { useUnsavedLeaveWarning } from "../unsaved-input";

export function TradeAssetRow({ asset, onRemove, onOpenPlayer }: { asset: TradeAsset; onRemove: () => void; onOpenPlayer: (playerId: string) => void }) {
  return (
    <div className="trade-asset-block">
      <div className="trade-asset-row">
        <div className="trade-asset-main">
          <div className="trade-asset-name">
            {asset.position === "PICK" ? <strong>{asset.name}</strong> : <button type="button" className="trade-asset-open" onClick={() => onOpenPlayer(asset.playerId)} aria-label={`View ${asset.name} details and news`}><strong>{asset.name}</strong></button>}
            <span className={`asset-position${asset.position === "PICK" ? " pick" : ""}`}>{asset.position === "PICK" ? "PICK" : asset.position}</span>
          </div>
          <span>{asset.position === "PICK" ? "Dynasty draft pick" : asset.team ?? "Free agent"}</span>
        </div>
        <div className="trade-asset-value"><strong>{asset.value.toLocaleString()}</strong></div>
        <button className="remove-asset" onClick={onRemove} aria-label={`Remove ${asset.name}`} title={`Remove ${asset.name}`}>×</button>
      </div>
    </div>
  );
}

export function projectionPoints(player: RosterPlayer): number {
  return player.gamePhase === "final" ? (player.actual ?? player.projection ?? 0) : (player.projection ?? 0);
}

export function optimizeTradeRoster(players: RosterPlayer[], slots: string[]): OptimizedRoster {
  return optimizeLockedTradeRoster(players, slots);
}

export function tradeDepthScore(optimized: OptimizedRoster, slots: string[]): number {
  if (slots.length === 0) return 0;
  const nextUp = slots.map((slot) => optimized.bench
    .filter((player) => eligibleForSlot(player.position, slot))
    .reduce((best, player) => Math.max(best, projectionPoints(player)), 0));
  return Number((nextUp.reduce((sum, value) => sum + value, 0) / slots.length).toFixed(2));
}

type SideGrade = {
  lineupDelta: number;
  lineupBefore: number;
  lineupAfter: number;
  depthDelta: number;
  cuts: string[];
  adds: string[];
  explanation: string;
  missingProjections: number;
};

export function gradeTradeSide(
  team: TradeTeam,
  outgoing: TradeAsset[],
  incoming: TradeAsset[],
  incomingTeam: TradeTeam,
  waiverPool: RosterPlayer[],
  slots: string[],
): SideGrade {
  const outgoingIds = new Set(outgoing.filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId));
  const incomingIds = new Set(incoming.filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId));
  const incomingPlayers = incomingTeam.players.filter((player) => incomingIds.has(player.playerId));
  const pre = optimizeTradeRoster(team.players, slots);
  let roster = [...team.players.filter((player) => !outgoingIds.has(player.playerId)), ...incomingPlayers.map((player) => ({ ...player, isStarter: false, lineupSlot: null }))];
  const cuts: string[] = [];
  while (roster.length > team.players.length) {
    const currentScore = optimizeTradeRoster(roster, slots).score;
    const cutCandidate = roster
      .map((player) => ({ player, cost: currentScore - optimizeTradeRoster(roster.filter((row) => row.playerId !== player.playerId), slots).score }))
      .sort((a, b) => a.cost - b.cost || projectionPoints(a.player) - projectionPoints(b.player) || a.player.name.localeCompare(b.player.name))[0];
    if (!cutCandidate) break;
    cuts.push(cutCandidate.player.name);
    roster = roster.filter((player) => player.playerId !== cutCandidate.player.playerId);
  }
  const adds: string[] = [];
  const unavailableIds = new Set([...team.players, ...incomingTeam.players].map((player) => player.playerId));
  while (roster.length < team.players.length) {
    const rosterIds = new Set(roster.map((player) => player.playerId));
    const add = waiverPool.find((player) => !rosterIds.has(player.playerId) && !unavailableIds.has(player.playerId) && !outgoingIds.has(player.playerId));
    if (!add) break;
    adds.push(add.name);
    roster.push({ ...add, isStarter: false, lineupSlot: null });
  }
  const post = optimizeTradeRoster(roster, slots);
  const lineupDelta = Number((post.score - pre.score).toFixed(2));
  const depthDelta = Number((tradeDepthScore(post, slots) - tradeDepthScore(pre, slots)).toFixed(2));

  const needRows = (["QB", "RB", "WR", "TE"] as const).flatMap((position) => {
    const pool = waiverPool.filter((player) => player.position === position && player.projection !== null).sort((a, b) => projectionPoints(a) - projectionPoints(b));
    const reference = pool[Math.floor(pool.length / 2)];
    if (!reference) return [];
    const gain = optimizeTradeRoster([...team.players, { ...reference, isStarter: false, lineupSlot: null }], slots).score - pre.score;
    return [{ position, gain }];
  }).sort((a, b) => b.gain - a.gain);
  const topNeed = needRows[0];

  const bestWaiver = waiverPool.find((player) => !team.players.some((row) => row.playerId === player.playerId));
  const surplusRows = outgoingIds.size === 0 ? [] : team.players
    .filter((player) => outgoingIds.has(player.playerId))
    .map((player) => {
      const without = team.players.filter((row) => row.playerId !== player.playerId);
      const refilled = bestWaiver ? [...without, { ...bestWaiver, isStarter: false, lineupSlot: null }] : without;
      return { player, cost: pre.score - optimizeTradeRoster(refilled, slots).score };
    })
    .sort((a, b) => a.cost - b.cost);
  const easiestOut = surplusRows[0];
  const needCopy = topNeed && topNeed.gain > 0.01 ? `${topNeed.position} is the clearest need (+${formatDecimal(topNeed.gain, 1)} with a median available add).` : "No median waiver add changes the optimal lineup.";
  const surplusCopy = easiestOut ? `${easiestOut.player.name} has a ${formatDecimal(Math.max(0, easiestOut.cost), 1)}-point removal cost after a waiver refill.` : "No outgoing player to test for surplus.";
  return {
    lineupDelta,
    lineupBefore: pre.score,
    lineupAfter: post.score,
    depthDelta,
    cuts,
    adds,
    explanation: `${needCopy} ${surplusCopy}`,
    missingProjections: roster.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position) && player.projection === null).length,
  };
}

export function TradeSide({ title, assets, availableAssets, onAdd, onRemove, onClear, onOpenPlayer }: { title: string; assets: TradeAsset[]; availableAssets: TradeAsset[]; onAdd: (id: string) => void; onRemove: (id: string) => void; onClear: () => void; onOpenPlayer: (playerId: string) => void }) {
  const [query, setQuery] = useState("");
  const needle = comparablePlayerName(query.trim());
  const matches = availableAssets
    .filter((asset) => needle && comparablePlayerName(asset.name).includes(needle))
    .sort((a, b) => {
      const aName = comparablePlayerName(a.name);
      const bName = comparablePlayerName(b.name);
      const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
      const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
      return aPriority - bPriority || a.name.localeCompare(b.name);
    })
    .slice(0, 10);
  const searchId = `trade-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const chooseAsset = (asset: TradeAsset) => {
    onAdd(asset.playerId);
    setQuery("");
  };

  return (
    <section className="trade-side" aria-label={title}>
      <div className="trade-side-heading">
        <div><h2>{title}</h2></div>
        {assets.length ? <button onClick={onClear}>Clear</button> : null}
      </div>
      <div className="trade-side-list">
        <div className="trade-side-search-wrap">
          <label className="sr-only" htmlFor={searchId}>Search assets to add to {title.toLowerCase()}</label>
          <div className="search-field trade-side-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              id={searchId}
              type="search"
              aria-label={`Search players or draft picks to add to ${title.toLowerCase()}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const firstMatch = matches[0];
                  if (firstMatch) { event.preventDefault(); chooseAsset(firstMatch); }
                } else if (event.key === "Escape") {
                  setQuery("");
                }
              }}
              name="trade-asset-search"
              placeholder={`Add to ${title.toLowerCase()}…`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={`Clear ${title.toLowerCase()} asset search`}>×</button> : null}
          </div>
          {needle ? (
            <div className="trade-side-search-results inline-search-results" role="region" aria-label={`Assets available for ${title.toLowerCase()}`} aria-live="polite">
              <span className="sr-only">{matches.length} {matches.length === 1 ? "result" : "results"} found.</span>
              {matches.map((asset) => (
                <button type="button" key={asset.playerId} onClick={() => chooseAsset(asset)}>
                  <span><strong>{asset.name}</strong><small>{asset.position} · {asset.team ?? "Draft pick"}</small></span>
                  <b>{asset.value.toLocaleString()}</b>
                </button>
              ))}
              {matches.length === 0 ? <div className="trade-search-empty">No eligible assets match “{query.trim()}”.</div> : null}
            </div>
          ) : null}
        </div>
        {assets.map((asset) => <TradeAssetRow key={asset.playerId} asset={asset} onRemove={() => onRemove(asset.playerId)} onOpenPlayer={onOpenPlayer} />)}
      </div>
    </section>
  );
}

export function leagueRosterAccessibleName(row: LeagueRosterRow): string {
  const position = row.position === "PICK" ? "draft pick" : rosterPositionLabel(row.position);
  const team = row.position === "PICK" ? null : row.team;
  const details = [
    row.name,
    position,
    team,
    row.value === null ? "no league value" : `value ${row.value.toLocaleString()}`,
    row.isRookie ? "rookie" : null,
    row.injuryStatus ? `injury status ${row.injuryStatus}` : null,
  ].filter((part): part is string => Boolean(part));
  return details.join(", ");
}

export function LeagueRosterList({
  rows,
  selectedIds,
  onToggle,
  listLabel,
}: {
  rows: LeagueRosterRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  listLabel: string;
}) {
  if (rows.length === 0) return <p className="league-roster-empty">No players on this roster.</p>;
  return (
    <ul className="league-roster-list" aria-label={listLabel}>
      {rows.map((row) => {
        const selected = selectedIds.has(row.id);
        return (
          <li key={row.id} className={selected ? "is-selected" : undefined}>
            <label className="league-roster-row">
              <input
                type="checkbox"
                checked={selected}
                disabled={!row.selectable}
                onChange={() => onToggle(row.id)}
                aria-label={leagueRosterAccessibleName(row)}
              />
              <span className="league-roster-main">
                <span className={`asset-position${row.position === "PICK" ? " pick" : ""}`}>{rosterPositionLabel(row.position)}</span>
                <span className="league-roster-name">
                  <strong>{row.shortName}</strong>
                  {row.isRookie ? <DesignationBadge code="R" label="Rookie" title="Rookie" /> : null}
                  {row.injuryStatus ? <DesignationBadge code={sleeperInjuryTag(row.injuryStatus)} label={`Injury status: ${row.injuryStatus}`} title={row.injuryStatus} /> : null}
                </span>
              </span>
              <span className="league-roster-meta">
                <span>{row.position === "PICK" ? "Pick" : row.team ?? "FA"}</span>
                <b>{row.value === null ? "—" : row.value.toLocaleString()}</b>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function tradeSideOutcome(leftTotal: number, rightTotal: number): "left" | "right" | "tie" {
  if (leftTotal === rightTotal) return "tie";
  return leftTotal > rightTotal ? "left" : "right";
}

/** Winner → warning; loser → dim; tie keeps the original chart colors. */
export function tradeTrendColors(outcome: "left" | "right" | "tie"): {
  giveColor: string;
  getColor: string;
  giveStrokeWidth: number;
  getStrokeWidth: number;
} {
  if (outcome === "tie") {
    return {
      giveColor: "var(--chart-4)",
      getColor: "var(--chart-3)",
      giveStrokeWidth: 2.3,
      getStrokeWidth: 2.3,
    };
  }
  return {
    giveColor: outcome === "left" ? "var(--warning)" : "var(--dim)",
    getColor: outcome === "right" ? "var(--warning)" : "var(--dim)",
    giveStrokeWidth: outcome === "left" ? 2.3 : 1,
    getStrokeWidth: outcome === "right" ? 2.3 : 1,
  };
}

export function LeagueTradeValueColumn({
  side,
  assets,
  height,
  outcome = "tie",
}: {
  side: "mine" | "theirs";
  assets: TradeAsset[];
  height: number;
  outcome?: "winner" | "loser" | "tie";
}) {
  const ordered = [...assets].sort((left, right) => left.value - right.value || left.name.localeCompare(right.name));
  return (
    <div className={`league-trade-column ${side}${outcome === "winner" ? " is-winner" : outcome === "tie" ? " is-tie" : ""}`} style={{ height, minHeight: height }}>
      {side === "mine" ? (
        <div className="league-trade-names">
          {ordered.map((asset) => (
            <div className="league-trade-name" key={asset.playerId} style={{ flexGrow: Math.max(asset.value, 1) }}>
              <strong>{compactAssetName(asset.name, asset.position)}</strong>
              <small>{asset.position === "PICK" ? "Pick" : `${rosterPositionLabel(asset.position)}${asset.team ? ` ${asset.team}` : ""}`}</small>
            </div>
          ))}
        </div>
      ) : null}
      <div className={`league-trade-bar${ordered.length === 0 ? " is-empty" : ""}`}>
        {ordered.length === 0 ? <span>0</span> : ordered.map((asset) => (
          <div className="league-trade-segment" key={asset.playerId} style={{ flexGrow: Math.max(asset.value, 1) }}>
            <span>{asset.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {side === "theirs" ? (
        <div className="league-trade-names">
          {ordered.map((asset) => (
            <div className="league-trade-name" key={asset.playerId} style={{ flexGrow: Math.max(asset.value, 1) }}>
              <strong>{compactAssetName(asset.name, asset.position)}</strong>
              <small>{asset.position === "PICK" ? "Pick" : `${rosterPositionLabel(asset.position)}${asset.team ? ` ${asset.team}` : ""}`}</small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TradeValueDialog({
  give,
  get,
  formatKey,
  onClose,
  giveLabel = "You give",
  getLabel = "You get",
  title = "Trade value",
  subtitle,
  lineupContext,
}: {
  give: TradeAsset[];
  get: TradeAsset[];
  formatKey: string;
  onClose: () => void;
  giveLabel?: string;
  getLabel?: string;
  title?: string;
  subtitle?: ReactNode;
  lineupContext?: {
    mine: TradeTeam;
    theirs: TradeTeam;
    starterSlots: string[];
    waiverPool: RosterPlayer[];
  };
}) {
  const giveTotal = tradeTotal(give);
  const getTotal = tradeTotal(get);
  const outcome = tradeSideOutcome(giveTotal, getTotal);
  const grade = lineupContext && lineupContext.starterSlots.length > 0
    ? gradeTradeSide(lineupContext.mine, give, get, lineupContext.theirs, lineupContext.waiverPool, lineupContext.starterSlots)
    : null;
  const lineup = grade ? formatLineupImpact(grade.lineupBefore, grade.lineupAfter, grade.lineupDelta) : null;
  const maxTotal = Math.max(giveTotal, getTotal, 1);
  const columnHeight = (total: number, count: number): number => {
    if (count === 0) return 48;
    const floor = count * 48 + (count - 1) * 2;
    return Math.max(floor, Math.round((total / maxTotal) * 360));
  };
  const historyPlayerIds = useMemo(
    () => [...give, ...get].filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId).sort(),
    [get, give],
  );
  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", formatKey, historyPlayerIds],
    queryFn: () => api.getValueHistory({ formatKey, playerIds: historyPlayerIds }),
    enabled: historyPlayerIds.length > 0,
  });
  const historyByPlayerId = useMemo(
    () => new Map((historyQuery.data?.series ?? []).map((series) => [series.playerId, series])),
    [historyQuery.data],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    node.scrollTop = 0;
  }, []);
  const chartLabel = [
    `${giveLabel} sends ${give.length ? give.map((asset) => `${asset.name} ${asset.value.toLocaleString()}`).join(", ") : "nothing"}, total ${giveTotal.toLocaleString()}`,
    `${getLabel} sends ${get.length ? get.map((asset) => `${asset.name} ${asset.value.toLocaleString()}`).join(", ") : "nothing"}, total ${getTotal.toLocaleString()}`,
    lineup,
  ].filter((part): part is string => Boolean(part)).join(" ");
  const { giveColor, getColor, giveStrokeWidth, getStrokeWidth } = tradeTrendColors(outcome);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="league-trade-dialog">
        <DialogCloseButton label="Close trade value" />
        <DialogHeader className="league-trade-dialog-heading">
          <DialogTitle>{title}</DialogTitle>
          {subtitle ? <span className="league-trade-dialog-subtitle">{subtitle}</span> : null}
        </DialogHeader>
        <div className="league-trade-dialog-body" ref={bodyRef}>
          {lineup ? <p className="league-trade-lineup">{lineup}</p> : null}
          <div className="league-trade-chart" role="img" aria-label={chartLabel}>
            <div className="league-trade-side">
              <LeagueTradeValueColumn
                side="mine"
                assets={give}
                height={columnHeight(giveTotal, give.length)}
                outcome={outcome === "left" ? "winner" : outcome === "tie" ? "tie" : "loser"}
              />
              <div className="league-trade-total"><span>Total trade value</span><strong>{giveTotal.toLocaleString()}</strong></div>
            </div>
            <div className="league-trade-side">
              <LeagueTradeValueColumn
                side="theirs"
                assets={get}
                height={columnHeight(getTotal, get.length)}
                outcome={outcome === "right" ? "winner" : outcome === "tie" ? "tie" : "loser"}
              />
              <div className="league-trade-total"><span>Total trade value</span><strong>{getTotal.toLocaleString()}</strong></div>
            </div>
          </div>
          <AggregateTradeHistory
            give={give}
            get={get}
            historyByPlayerId={historyByPlayerId}
            isLoading={historyPlayerIds.length > 0 && historyQuery.isPending}
            giveColor={giveColor}
            getColor={getColor}
            giveStrokeWidth={giveStrokeWidth}
            getStrokeWidth={getStrokeWidth}
            showPickNote={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LeagueRosterCard({
  label,
  title,
  action,
  children,
}: {
  label: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="league-roster-card" aria-label={label}>
      <header className="league-roster-heading">
        <h3>{title}</h3>
        {action}
      </header>
      <div className="league-roster-scroll">{children}</div>
    </section>
  );
}

export function LeagueAdjustedTrade({
  mine,
  partners,
  assetById,
  theirRosterId,
  giveIds,
  getIds,
  starterSlots,
  waiverPool,
  recordByRosterId,
  formatKey,
  onPartnerChange,
  onToggle,
}: {
  mine: TradeTeam;
  partners: TradeTeam[];
  assetById: Map<string, TradeAsset>;
  theirRosterId: number | null;
  giveIds: string[];
  getIds: string[];
  starterSlots: string[];
  waiverPool: RosterPlayer[];
  recordByRosterId: ReadonlyMap<number, TeamRecord>;
  formatKey: string;
  onPartnerChange: (rosterId: number | null) => void;
  onToggle: (side: "give" | "get", id: string) => void;
}) {
  const hintId = useId();
  const [isResultOpen, setIsResultOpen] = useState(false);
  const theirs = partners.find((team) => team.rosterId === theirRosterId) ?? null;
  const give = giveIds.flatMap((id) => assetById.get(id) ?? []);
  const get = getIds.flatMap((id) => assetById.get(id) ?? []);
  const canAnalyze = theirs !== null && (give.length > 0 || get.length > 0);
  const myRows = useMemo(() => buildLeagueRosterRows(mine.players, mine.ownedPicks, assetById), [assetById, mine]);
  const theirRows = useMemo(
    () => theirs ? buildLeagueRosterRows(theirs.players, theirs.ownedPicks, assetById) : [],
    [assetById, theirs],
  );
  const selectedGive = useMemo(() => new Set(giveIds), [giveIds]);
  const selectedGet = useMemo(() => new Set(getIds), [getIds]);

  return (
    <>
      <div className="trade-columns league-adjusted">
        <LeagueRosterCard label={`${mine.teamName} roster`} title={mine.teamName}>
          <LeagueRosterList rows={myRows} selectedIds={selectedGive} onToggle={(id) => onToggle("give", id)} listLabel={`${mine.teamName} assets`} />
        </LeagueRosterCard>
        {theirs ? (
          <LeagueRosterCard
            label={`${theirs.teamName} roster`}
            title={theirs.teamName}
            action={<button type="button" className="league-partner-change" aria-label="Change trade partner" onClick={() => onPartnerChange(null)}>Change</button>}
          >
            <LeagueRosterList rows={theirRows} selectedIds={selectedGet} onToggle={(id) => onToggle("get", id)} listLabel={`${theirs.teamName} assets`} />
          </LeagueRosterCard>
        ) : (
          <LeagueRosterCard label="Trade partners" title="Trade partner">
            {partners.length === 0 ? <p className="league-roster-empty">No other teams in this league.</p> : (
              <ul className="league-roster-list" aria-label="League teams">
                {partners.map((team) => {
                  const record = team.record ?? recordByRosterId.get(team.rosterId);
                  const recordLabel = record ? formatTeamRecord(record) : "—";
                  return (
                    <li key={team.rosterId}>
                      <label className="league-roster-row league-team-row">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => onPartnerChange(team.rosterId)}
                          aria-label={record ? `Trade with ${team.teamName}, ${recordLabel}` : `Trade with ${team.teamName}`}
                        />
                        <span className="league-roster-main">
                          <span className="league-roster-name"><strong>{team.teamName}</strong></span>
                        </span>
                        <span className="league-roster-meta"><span>{recordLabel}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </LeagueRosterCard>
        )}
      </div>
      <div className="trade-calculate-wrap">
        <button type="button" className="trade-calculate-button" disabled={!canAnalyze} aria-describedby={canAnalyze ? undefined : hintId} onClick={() => setIsResultOpen(true)}>Analyze trade</button>
        {canAnalyze ? null : <span id={hintId} className="sr-only">Choose a trade partner and at least one asset.</span>}
      </div>
      {isResultOpen && canAnalyze && theirs ? (
        <TradeValueDialog
          give={give}
          get={get}
          giveLabel={mine.teamName}
          getLabel={theirs.teamName}
          lineupContext={{ mine, theirs, starterSlots, waiverPool }}
          formatKey={formatKey}
          onClose={() => setIsResultOpen(false)}
        />
      ) : null}
    </>
  );
}

type HistoricalTradeDisplayAsset = {
  key: string;
  name: string;
  meta: string;
  value: number;
  note: string | null;
  playerId?: string;
};

export function historicalCurrentOccupant(team: HistoricalTradeTeam, league: League): TradeTeam | undefined {
  if (team.ownerId !== null && league.tradeTeams.some((current) => current.ownerId === team.ownerId)) return undefined;
  return league.tradeTeams.find((current) => current.rosterId === team.rosterId);
}

export function HistoricalTeamName({ team, league }: { team: HistoricalTradeTeam; league: League }) {
  const currentOccupant = historicalCurrentOccupant(team, league);
  return <>{team.teamName}{currentOccupant ? <small className="historical-team-current">({currentOccupant.teamName})</small> : null}</>;
}

export function HistoricalTeamMatchup({ trade, league }: { trade: HistoricalTrade; league: League }) {
  if (trade.teams.length !== 2) return <>{trade.teams.length}-team trade</>;
  const first = trade.teams[0];
  const second = trade.teams[1];
  if (!first || !second) return <>Trade</>;
  return <><HistoricalTeamName team={first} league={league} /><i className="historical-team-separator" aria-hidden="true">↔</i><HistoricalTeamName team={second} league={league} /></>;
}

export function historicalPickValue(assets: TradeAsset[], season: number, round: number): TradeAsset | undefined {
  const ordinal = round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
  return assets
    .filter((asset) => asset.position === "PICK" && asset.name.includes(String(season)) && asset.name.toLowerCase().includes(ordinal))
    .sort((a, b) => Number(/\bmid\b/i.test(b.name)) - Number(/\bmid\b/i.test(a.name)) || b.value - a.value)[0];
}

export function historicalReceivedAssets(team: HistoricalTradeTeam, assets: TradeAsset[], tradeId: string, currentSeason: number): { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] } {
  const byPlayerId = new Map(assets.filter((asset) => asset.position !== "PICK").map((asset) => [asset.playerId, asset]));
  const display: HistoricalTradeDisplayAsset[] = [];
  const valued: TradeAsset[] = [];
  for (const player of team.assets.players) {
    const current = byPlayerId.get(player.playerId);
    display.push({
      key: `${tradeId}:${team.rosterId}:player:${player.playerId}`,
      name: player.name,
      meta: player.position,
      value: current?.value ?? 0,
      note: current ? null : "no current value",
      playerId: player.playerId,
    });
    valued.push(current ?? {
      formatKey: assets[0]?.formatKey ?? "historical",
      playerId: player.playerId,
      name: player.name,
      team: null,
      position: "PICK",
      overallRank: 9999,
      positionRank: 9999,
      value: 0,
      trend30Day: null,
      isRookie: false,
    });
  }
  for (const pick of team.assets.picks) {
    const draftedPlayer = pick.draftedPlayerId ? byPlayerId.get(pick.draftedPlayerId) : undefined;
    if (pick.draftedPlayerId) {
      const draftedPlayerName = draftedPlayer?.name ?? pick.draftedPlayerName ?? pick.description;
      display.push({
        key: `${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}:${pick.fromRosterId ?? "unknown"}`,
        name: draftedPlayerName,
        meta: `via ${pick.description}`,
        value: draftedPlayer?.value ?? 0,
        note: draftedPlayer ? null : "no current value",
        playerId: pick.draftedPlayerId,
      });
      valued.push(draftedPlayer ? {
        ...draftedPlayer,
        playerId: `historical:${tradeId}:${team.rosterId}:${draftedPlayer.playerId}`,
      } : {
        formatKey: assets[0]?.formatKey ?? "historical",
        playerId: `historical:${tradeId}:${team.rosterId}:${pick.draftedPlayerId}`,
        name: draftedPlayerName,
        team: null,
        position: "PICK",
        overallRank: 9999,
        positionRank: 9999,
        value: 0,
        trend30Day: null,
        isRookie: false,
      });
      continue;
    }
    const current = pick.season > currentSeason ? historicalPickValue(assets, pick.season, pick.round) : undefined;
    const note = pick.season <= currentSeason ? "pick already used" : current ? null : "no current pick value";
    const value = current?.value ?? 0;
    display.push({
      key: `${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}:${pick.fromRosterId ?? "unknown"}`,
      name: pick.description,
      meta: "Draft pick",
      value,
      note,
    });
    valued.push(current ? { ...current, playerId: `historical:${tradeId}:${team.rosterId}:${current.playerId}` } : {
      formatKey: assets[0]?.formatKey ?? "historical",
      playerId: `historical:${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}`,
      name: pick.description,
      team: null,
      position: "PICK",
      overallRank: 9999,
      positionRank: 9999,
      value: 0,
      trend30Day: null,
      isRookie: false,
    });
  }
  if (team.assets.faabReceived > 0) {
    display.push({
      key: `${tradeId}:${team.rosterId}:faab`,
      name: `$${team.assets.faabReceived} FAAB`,
      meta: "Waiver budget",
      value: 0,
      note: "not valued",
    });
  }
  return { display, valued };
}

export function historicalPerspectiveAssets(trade: HistoricalTrade, selected: HistoricalTradeTeam, assets: TradeAsset[], currentSeason: number): {
  give: { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] };
  get: { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] };
} {
  const received = historicalReceivedAssets(selected, assets, trade.id, currentSeason);
  const otherTeams = trade.teams.filter((team) => team.rosterId !== selected.rosterId);
  const outgoingPlayers = otherTeams.flatMap((team) => team.assets.players.filter((player) => player.fromRosterId === selected.rosterId || (trade.teams.length === 2 && player.fromRosterId === null)));
  const outgoingPicks = otherTeams.flatMap((team) => team.assets.picks.filter((pick) => pick.fromRosterId === selected.rosterId || (trade.teams.length === 2 && pick.fromRosterId === null)));
  const outgoingFaab = trade.teams.length === 2 ? (otherTeams[0]?.assets.faabReceived ?? 0) : 0;
  const gaveTeam: HistoricalTradeTeam = {
    rosterId: selected.rosterId,
    ownerId: selected.ownerId,
    teamName: selected.teamName,
    isUserTeam: selected.isUserTeam,
    assets: { players: outgoingPlayers, picks: outgoingPicks, faabReceived: outgoingFaab },
  };
  return { give: historicalReceivedAssets(gaveTeam, assets, `${trade.id}:gave`, currentSeason), get: received };
}

export function compactHistoricalAssets(team: HistoricalTradeTeam): string {
  const labels = [
    ...team.assets.players.map((player) => player.name),
    ...team.assets.picks.map((pick) => pick.description),
    ...(team.assets.faabReceived > 0 ? [`$${team.assets.faabReceived} FAAB`] : []),
  ];
  if (labels.length === 0) return "No assets listed";
  const shown = labels.slice(0, 3).join(" · ");
  return labels.length > 3 ? `${shown} · +${labels.length - 3} more` : shown;
}

export function TradeHistoryView({ dashboard, league }: { dashboard: Dashboard; league: League }) {
  const queryClient = useQueryClient();
  const refreshRequested = useRef<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | "all">(dashboard.season);
  const formatAssets = useMemo(
    () => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key),
    [dashboard.seasonLongRankings, league.seasonLongFormat.key],
  );
  const queryKey = ["historical-trades", league.id, selectedSeason] as const;
  const tradesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await api.getHistoricalTrades(selectedSeason === "all"
          ? { leagueId: league.id, refresh: false }
          : { leagueId: league.id, refresh: false, season: selectedSeason });
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    const refreshKey = `${league.id}:${selectedSeason}`;
    if (!tradesQuery.data?.isStale || refreshRequested.current === refreshKey) return;
    refreshRequested.current = refreshKey;
    void api.getHistoricalTrades(selectedSeason === "all"
      ? { leagueId: league.id, refresh: true }
      : { leagueId: league.id, refresh: true, season: selectedSeason })
      .then((fresh) => queryClient.setQueryData(queryKey, fresh))
      .catch((error: unknown) => {
        signOutForPersonalData(error);
      });
  }, [league.id, queryClient, queryKey, selectedSeason, tradesQuery.data?.isStale]);

  useEffect(() => {
    setSelectedSeason(dashboard.season);
    setSelectedTradeId(null);
    refreshRequested.current = null;
  }, [dashboard.season, league.id]);

  useEffect(() => {
    if (selectedSeason === "all" || !tradesQuery.data?.seasons.length || tradesQuery.data.seasons.includes(selectedSeason)) return;
    setSelectedSeason(tradesQuery.data.seasons[0] ?? dashboard.season);
  }, [dashboard.season, selectedSeason, tradesQuery.data?.seasons]);

  const selectedTrade = tradesQuery.data?.trades.find((trade) => trade.id === selectedTradeId) ?? null;
  const selectedTeam = selectedTrade?.teams.find((team) => team.isUserTeam) ?? selectedTrade?.teams[0] ?? null;
  const perspective = selectedTrade && selectedTeam ? historicalPerspectiveAssets(selectedTrade, selectedTeam, formatAssets, dashboard.season) : null;
  const counterpart = selectedTrade && selectedTeam
    ? selectedTrade.teams.find((team) => team.rosterId !== selectedTeam.rosterId) ?? null
    : null;
  // Map participants to current rosters for the same lineup-impact line Market/League use.
  const mine = selectedTeam
    ? (selectedTeam.isUserTeam
      ? league.tradeTeams.find((team) => selectedTeam.ownerId !== null && team.ownerId === selectedTeam.ownerId)
        ?? league.tradeTeams.find((team) => team.rosterId === selectedTeam.rosterId && team.isUser)
      : league.tradeTeams.find((team) => team.rosterId === selectedTeam.rosterId))
    : undefined;
  const historicalTheirs = selectedTrade && selectedTeam && selectedTrade.teams.length === 2
    ? (() => {
        const otherTeam = selectedTrade.teams.find((team) => team.rosterId !== selectedTeam.rosterId);
        return otherTeam ? league.tradeTeams.find((team) => team.rosterId === otherTeam.rosterId) : undefined;
      })()
    : undefined;
  const incomingTeam = mine ? {
    rosterId: -1,
    ownerId: null,
    teamName: "Trade counterparties",
    isUser: false,
    players: league.tradeTeams.flatMap((team) => team.players),
    ownedPicks: league.tradeTeams.flatMap((team) => team.ownedPicks),
  } satisfies TradeTeam : undefined;
  const gradeMine = mine;
  const gradeTheirs = historicalTheirs ?? incomingTeam;
  const grouped = useMemo(() => {
    const groups = new Map<number, HistoricalTrade[]>();
    for (const trade of tradesQuery.data?.trades ?? []) groups.set(trade.season, [...(groups.get(trade.season) ?? []), trade]);
    return [...groups.entries()].sort(([a], [b]) => b - a);
  }, [tradesQuery.data?.trades]);
  const renderTradeRows = (trades: HistoricalTrade[]) => trades.map((trade) => {
    const teamValues = trade.teams.map((team) => ({ team, value: tradeTotal(historicalReceivedAssets(team, formatAssets, trade.id, dashboard.season).valued) }));
    const rankedTeams = [...teamValues].sort((a, b) => b.value - a.value);
    const leadingTeam = rankedTeams[0];
    const maxValue = leadingTeam?.value ?? 0;
    const winners = teamValues.filter((row) => row.value === maxValue);
    const runnerUp = rankedTeams[1]?.value ?? maxValue;
    return (
      <button
        type="button"
        className="trade-history-row"
        key={trade.id}
        onClick={() => setSelectedTradeId(trade.id)}
      >
        <span className="trade-history-row-heading"><span>Week {trade.week} · {trade.season}</span><strong><HistoricalTeamMatchup trade={trade} league={league} /></strong></span>
        <span className="trade-history-assets">{trade.teams.map((team) => <span key={team.rosterId}><b><HistoricalTeamName team={team} league={league} /></b>{compactHistoricalAssets(team)}</span>)}</span>
        <span className="trade-history-winner">{winners.length !== 1 || !leadingTeam ? "Even" : <><HistoricalTeamName team={leadingTeam.team} league={league} /> won · +{Math.max(0, maxValue - runnerUp).toLocaleString()}</>}</span>
      </button>
    );
  });

  if (tradesQuery.isPending) return <div className="trade-history-loading" aria-live="polite"><span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" /></div>;
  if (tradesQuery.isError) return <div className="section-error compact"><strong>Trade history is unavailable.</strong><button type="button" onClick={() => void tradesQuery.refetch()}>Try again</button></div>;
  return (
    <div className="trade-history-view">
      <label className="trade-history-filter">
        <span>Season</span>
        <span className="select-control-field">
          <select
            aria-label="Trade history season"
            value={selectedSeason}
            onChange={(event) => {
              const nextSeason = event.target.value === "all" ? "all" : Number(event.target.value);
              setSelectedSeason(nextSeason);
              setSelectedTradeId(null);
              refreshRequested.current = null;
            }}
          >
            {tradesQuery.data.seasons.map((season) => <option key={season} value={season}>{season}</option>)}
            <option value="all">All seasons</option>
          </select>
        </span>
      </label>
      {tradesQuery.data.sourceErrors.length ? <p className="trade-history-source-note">{tradesQuery.data.sourceErrors.join(" ")}</p> : null}
      {!tradesQuery.data.trades.length ? (
        <div className="empty-inline empty-stack">
          <strong>{league.seasonLongFormat.isDynasty ? "No trades in league history" : "No trades yet this season"}</strong>
          <span>
            {league.seasonLongFormat.isDynasty
              ? "Past trades will appear here once they are made, with a winner call based on today's values."
              : "When a trade goes through, it will show up here with a winner call based on today's values."}
          </span>
        </div>
      ) : selectedSeason === "all" ? grouped.map(([season, trades]) => (
        <section className="trade-history-season" key={season} aria-labelledby={`trade-history-${league.id}-${season}`}>
          <h2 id={`trade-history-${league.id}-${season}`}>{season}</h2>
          <div className="trade-history-list">{renderTradeRows(trades)}</div>
        </section>
      )) : <div className="trade-history-list">{renderTradeRows(tradesQuery.data.trades)}</div>}
      {selectedTrade && selectedTeam && perspective ? (
        <TradeValueDialog
          give={perspective.give.valued}
          get={perspective.get.valued}
          giveLabel={selectedTeam.teamName}
          getLabel={counterpart && selectedTrade.teams.length === 2 ? counterpart.teamName : "You get"}
          subtitle={<>Week {selectedTrade.week}, {selectedTrade.season} · <HistoricalTeamMatchup trade={selectedTrade} league={league} /></>}
          lineupContext={gradeMine && gradeTheirs
            ? { mine: gradeMine, theirs: gradeTheirs, starterSlots: league.tradeStarterSlots, waiverPool: league.tradeWaiverPool }
            : undefined}
          formatKey={league.seasonLongFormat.key}
          onClose={() => setSelectedTradeId(null)}
        />
      ) : null}
    </div>
  );
}

export function TradeCalculator({
  dashboard,
  league,
  tradeMode,
  onTradeModeChange,
  onOpenPlayer,
}: {
  dashboard: Dashboard;
  league: League;
  tradeMode: TradeMode;
  onTradeModeChange: (mode: TradeMode) => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [getIds, setGetIds] = useState<string[]>([]);
  useUnsavedLeaveWarning(giveIds.length + getIds.length > 0);
  const [isResultOpen, setIsResultOpen] = useState(false);
  const userTeam = league.tradeTeams.find((team) => team.isUser) ?? league.tradeTeams[0];
  const [theirRosterId, setTheirRosterId] = useState<number | null>(null);
  const assets = useMemo(() => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key).sort((a, b) => a.overallRank - b.overallRank), [dashboard.seasonLongRankings, league.seasonLongFormat.key]);
  const teamPickAssets = useMemo(() => league.tradeTeams.flatMap((team) => team.ownedPicks), [league.tradeTeams]);
  const assetById = useMemo(() => new Map([...assets, ...teamPickAssets].map((asset) => [asset.playerId, asset])), [assets, teamPickAssets]);
  const give = giveIds.flatMap((id) => assetById.get(id) ?? []);
  const get = getIds.flatMap((id) => assetById.get(id) ?? []);
  const selectedIds = new Set([...giveIds, ...getIds]);
  const mine = userTeam;
  const recordByRosterId = useMemo(() => {
    const records = new Map<number, TeamRecord>();
    for (const ranking of [league.powerRankingsWeek, league.powerRankingsSeasonLong, league.powerRankingsDynasty]) {
      for (const team of ranking) {
        if (!records.has(team.rosterId)) records.set(team.rosterId, team.record);
      }
    }
    for (const team of league.tradeTeams) {
      if (team.record) records.set(team.rosterId, team.record);
    }
    return records;
  }, [league.powerRankingsDynasty, league.powerRankingsSeasonLong, league.powerRankingsWeek, league.tradeTeams]);
  const partner = league.tradeTeams.find((team) => team.rosterId === theirRosterId && team.rosterId !== mine?.rosterId) ?? null;
  const unrestrictedAssets = assets.filter((asset) => !selectedIds.has(asset.playerId));

  useEffect(() => {
    setTheirRosterId(null);
    setGiveIds([]);
    setGetIds([]);
    setIsResultOpen(false);
  }, [league.id, league.tradeTeams]);

  useEffect(() => {
    setGiveIds((ids) => ids.filter((id) => assetById.has(id)));
    setGetIds((ids) => ids.filter((id) => assetById.has(id)));
  }, [assetById]);

  const addAsset = (id: string, side: "give" | "get") => {
    if (selectedIds.has(id)) return;
    if (side === "give") setGiveIds((ids) => [...ids, id]);
    else setGetIds((ids) => [...ids, id]);
  };
  const clearSide = (side: "give" | "get") => {
    const { next, removedIds } = clearTradeSide({ giveIds, getIds }, side);
    if (removedIds.length === 0) return;
    setGiveIds(next.giveIds);
    setGetIds(next.getIds);
    showUndoToast(side === "give" ? "Cleared the players you’d give" : "Cleared the players you’d get", () => {
      if (side === "give") setGiveIds([...removedIds]);
      else setGetIds([...removedIds]);
    });
  };
  const removeSidePlayer = (side: "give" | "get", id: string) => {
    const { next, removed } = removeTradePlayer(side === "give" ? giveIds : getIds, id);
    if (!removed) return;
    if (side === "give") setGiveIds(next);
    else setGetIds(next);
    const name = assetById.get(id)?.name ?? "Player";
    showUndoToast(`Removed ${name}`, () => {
      const restore = (current: string[]) => restoreTradePlayer(current, removed);
      if (side === "give") setGiveIds(restore);
      else setGetIds(restore);
    });
  };
  const toggleLeagueAsset = (side: "give" | "get", id: string) => {
    const otherIds = side === "give" ? getIds : giveIds;
    if (otherIds.includes(id)) return;
    const setter = side === "give" ? setGiveIds : setGetIds;
    setter((ids) => ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id]);
  };
  return (
    <section className="trade-view">
      <h2 className="sr-only">Trade</h2>
      <div className="trade-valuation-controls">
        <SegmentedControl
          value={tradeMode}
          options={[
            { value: "league", label: "League-adjusted" },
            { value: "market", label: "Market" },
            { value: "history", label: "History" },
          ]}
          onChange={onTradeModeChange}
          label="Trade mode"
          className="trade-valuation-toggle"
        />
      </div>

      {tradeMode === "history" ? (
        <TradeHistoryView dashboard={dashboard} league={league} />
      ) : tradeMode === "league" ? (
        mine ? (
          <LeagueAdjustedTrade
            mine={mine}
            partners={league.tradeTeams.filter((team) => team.rosterId !== mine.rosterId)}
            assetById={assetById}
            theirRosterId={partner?.rosterId ?? null}
            giveIds={giveIds}
            getIds={getIds}
            starterSlots={league.tradeStarterSlots}
            waiverPool={league.tradeWaiverPool}
            recordByRosterId={recordByRosterId}
            formatKey={league.seasonLongFormat.key}
            onPartnerChange={(rosterId) => { setTheirRosterId(rosterId); setGetIds([]); }}
            onToggle={toggleLeagueAsset}
          />
        ) : <div className="empty-inline empty-stack"><strong>No roster available for this league.</strong></div>
      ) : (
        <>
          <div className="trade-columns">
            <TradeSide title="You give" assets={give} availableAssets={unrestrictedAssets} onAdd={(id) => addAsset(id, "give")} onRemove={(id) => removeSidePlayer("give", id)} onClear={() => clearSide("give")} onOpenPlayer={onOpenPlayer} />
            <TradeSide title="You get" assets={get} availableAssets={unrestrictedAssets} onAdd={(id) => addAsset(id, "get")} onRemove={(id) => removeSidePlayer("get", id)} onClear={() => clearSide("get")} onOpenPlayer={onOpenPlayer} />
          </div>
          {assets.length === 0 ? <div className="empty-inline empty-stack"><strong>No trade values for this format.</strong><span>Choose another league to compare assets.</span></div> : null}
          <div className="trade-calculate-wrap">
            <button type="button" className="trade-calculate-button" disabled={give.length === 0 || get.length === 0} onClick={() => setIsResultOpen(true)}>Calculate trade</button>
          </div>
          {isResultOpen && give.length > 0 && get.length > 0 ? (
            <TradeValueDialog
              give={give}
              get={get}
              formatKey={league.seasonLongFormat.key}
              onClose={() => setIsResultOpen(false)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
