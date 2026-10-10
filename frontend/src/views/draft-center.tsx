import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, UserX } from "lucide-react";
import type {
  Dashboard,
  DraftCenterData,
  League,
  MatchupSelection,
  PlayerLink,
  PlayerSearchResult,
} from "../dashboard-types";
import {
  DesignationBadge,
  RefreshIcon,
  comparablePlayerName,
  formatProjectionPoints,
  showUndoToast,
} from "../dashboard-shared";
import type { DraftPosition, DraftRoom } from "../dashboard-url";
import { SegmentedControl } from "../shared";
import { markDraftPlayerTaken, undoDraftPlayerTaken } from "../undo";
import { positionFilterTabAriaLabel, positionFilterTabLabel } from "./position-filter-labels";

type DraftRow = DraftCenterData["adp"][number] & {
  adpSource: "ffc" | "fantasycalc" | "projection";
  marketValue: number | null;
  marketRank: number | null;
  rookie: boolean;
  tier: number;
  gap: number | null;
  injuryStatus: string | null;
  weeklyRank: number | null;
  weeklyProjection: number | null;
  opponent: string | null;
  isAway: boolean | null;
  isBye: boolean;
  projectionSource: PlayerSearchResult["projectionSource"];
  gamePhase?: PlayerSearchResult["gamePhase"];
  defenseComponents?: PlayerSearchResult["defenseComponents"];
  projectionComponents?: PlayerSearchResult["projectionComponents"];
};

type DraftPlayerOpenSource = Pick<DraftRow, "playerId" | "name" | "team" | "position"> & Partial<Omit<DraftRow, "playerId" | "name" | "team" | "position">>;

export function dedupePlayerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export function readDraftPlayerIds(storageKey: string): string[] {
  try { return dedupePlayerIds(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
  catch { return []; }
}

export function draftSecondaryLine(position: string, team: string | null | undefined): string | null {
  const positionLabel = position === "DEF" ? "DST" : position.trim();
  const parts = [positionLabel, team?.trim() ?? ""].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function DraftCenter({
  dashboard,
  league,
  data,
  loading,
  onRefresh,
  refreshing,
  draftPosition,
  draftQuery,
  draftRoom,
  onDraftFiltersChange,
  linkedPlayerId,
  onOpenLinkedPlayer,
}: {
  dashboard: Dashboard;
  league: League;
  data: DraftCenterData | undefined;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  draftPosition: DraftPosition | null;
  draftQuery: string | null;
  draftRoom: DraftRoom | null;
  onDraftFiltersChange: (filters: { draftPosition: DraftPosition | null; draftQuery: string | null; draftRoom: DraftRoom | null }) => void;
} & PlayerLink) {
  const leagueDrafts = useMemo(() => data?.drafts.filter((draft) => draft.leagueId === league.id) ?? [], [data?.drafts, league.id]);
  const liveDraft = leagueDrafts.find((draft) => draft.status === "drafting") ?? null;
  const completedDraft = leagueDrafts.find((draft) => draft.status === "complete") ?? null;
  const syncedDraft = liveDraft ?? completedDraft;
  const syncedBoardMode = data?.boardModes.find((item) => item.leagueId === league.id)?.mode;
  // Only a positively identified new dynasty gets the startup pool. If Sleeper
  // history is temporarily unavailable, defaulting a dynasty to rookies avoids
  // presenting veterans as eligible in an established league.
  const draftBoardMode = league.seasonLongFormat.isDynasty ? (syncedBoardMode === "startup" ? "startup" : "rookie") : "redraft";
  const isRookieBoard = draftBoardMode === "rookie";
  const [mode, setMode] = useState<"board" | "myTeam">(draftRoom ?? "board");
  const [position, setPosition] = useState<"ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "ROOKIES">(draftPosition ?? "ALL");
  const [query, setQuery] = useState(draftQuery ?? "");
  const [visibleDraftCount, setVisibleDraftCount] = useState(160);
  const [myTeamIds, setMyTeamIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-my-team:${league.id}`));
  const [manualDraftedIds, setManualDraftedIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-taken:${league.id}`));
  const [hiddenLiveTeamIds, setHiddenLiveTeamIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-hidden-live:${league.id}`));
  const addToMyTeamLocked = useRef(false);
  const draftPositionOptions: Array<typeof position> = [
    "ALL",
    "QB",
    "RB",
    "WR",
    "TE",
    ...(league.rankingPositions.includes("K") ? ["K" as const] : []),
    ...(league.rankingPositions.includes("DEF") ? ["DEF" as const] : []),
    ...(league.seasonLongFormat.isDynasty ? ["ROOKIES" as const] : []),
  ];
  const effectiveDraftPosition = draftPositionOptions.includes(position) ? position : "ALL";

  useEffect(() => { setMode(draftRoom ?? "board"); }, [draftRoom]);
  useEffect(() => { setPosition(draftPosition ?? "ALL"); }, [draftPosition]);
  useEffect(() => { setQuery(draftQuery ?? ""); }, [draftQuery]);

  function publishDraftFilters(next: { position?: typeof position; query?: string; room?: "board" | "myTeam" }) {
    const nextPosition = next.position ?? effectiveDraftPosition;
    const nextQuery = next.query ?? query;
    const nextRoom = next.room ?? mode;
    if (next.position !== undefined) setPosition(next.position);
    if (next.query !== undefined) setQuery(next.query);
    if (next.room !== undefined) setMode(next.room);
    onDraftFiltersChange({
      draftPosition: nextPosition === "ALL" ? null : nextPosition,
      draftQuery: nextQuery.trim() ? nextQuery : null,
      draftRoom: nextRoom === "board" ? null : nextRoom,
    });
  }

  useEffect(() => {
    if (position === effectiveDraftPosition) return;
    setPosition(effectiveDraftPosition);
    onDraftFiltersChange({
      draftPosition: effectiveDraftPosition === "ALL" ? null : effectiveDraftPosition,
      draftQuery: query.trim() ? query : null,
      draftRoom: mode === "board" ? null : mode,
    });
  }, [effectiveDraftPosition, mode, onDraftFiltersChange, position, query]);

  useEffect(() => {
    setVisibleDraftCount(160);
  }, [effectiveDraftPosition, league.id, query]);

  useEffect(() => {
    setMyTeamIds(readDraftPlayerIds(`fantasy-draft-my-team:${league.id}`));
    setManualDraftedIds(readDraftPlayerIds(`fantasy-draft-taken:${league.id}`));
    setHiddenLiveTeamIds(readDraftPlayerIds(`fantasy-draft-hidden-live:${league.id}`));
  }, [league.id]);

  useEffect(() => { localStorage.setItem(`fantasy-draft-my-team:${league.id}`, JSON.stringify(myTeamIds)); }, [league.id, myTeamIds]);
  useEffect(() => { localStorage.setItem(`fantasy-draft-taken:${league.id}`, JSON.stringify(manualDraftedIds)); }, [league.id, manualDraftedIds]);
  useEffect(() => { localStorage.setItem(`fantasy-draft-hidden-live:${league.id}`, JSON.stringify(hiddenLiveTeamIds)); }, [league.id, hiddenLiveTeamIds]);

  const seasonRows = useMemo(
    () => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key && row.position !== "PICK"),
    [dashboard.seasonLongRankings, league.seasonLongFormat.key],
  );
  const boardSeasonRows = useMemo(
    () => isRookieBoard ? seasonRows.filter((row) => row.isRookie) : seasonRows,
    [isRookieBoard, seasonRows],
  );
  const seasonByPlayer = useMemo(() => new Map(seasonRows.map((row) => [row.playerId, row])), [seasonRows]);
  const injuryByPlayer = useMemo(() => new Map(dashboard.rankings.map((row) => [row.playerId, row.injuryStatus])), [dashboard.rankings]);
  const injuryByName = useMemo(() => new Map(dashboard.rankings.map((row) => [comparablePlayerName(row.name), row.injuryStatus])), [dashboard.rankings]);
  const sortedByValue = useMemo(() => [...boardSeasonRows].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), [boardSeasonRows]);
  const valueRank = useMemo(() => new Map(sortedByValue.map((row, index) => [row.playerId, index + 1])), [sortedByValue]);
  const rows = useMemo<DraftRow[]>(() => {
    const seenAdpPlayerIds = new Set<string>();
    const seenUnmatchedAdpNames = new Set<string>();
  const uniqueAdpRows = (data?.adp ?? []).filter((row) => {
    if (row.format !== league.seasonLongFormat.key || row.pool !== (isRookieBoard ? "rookie" : "all") || !["QB", "RB", "WR", "TE"].includes(row.position)) return false;
    const season = row.playerId ? seasonByPlayer.get(row.playerId) : undefined;
    if (isRookieBoard && !season?.isRookie) return false;
    if (!row.playerId) {
      if (isRookieBoard) return false;
      const normalizedName = comparablePlayerName(row.name);
      if (seenUnmatchedAdpNames.has(normalizedName)) return false;
      seenUnmatchedAdpNames.add(normalizedName);
      return true;
    }
    if (seenAdpPlayerIds.has(row.playerId)) return false;
    seenAdpPlayerIds.add(row.playerId);
    return true;
  }).sort((a, b) => a.adp - b.adp);
  const positionCounts = new Map<string, number>();
  const adpRows: DraftRow[] = uniqueAdpRows.map((row) => {
    const season = row.playerId ? seasonByPlayer.get(row.playerId) : undefined;
    const count = (positionCounts.get(row.position) ?? 0) + 1;
    positionCounts.set(row.position, count);
    const marketRank = row.playerId ? valueRank.get(row.playerId) ?? null : null;
    const injuryStatus = (row.playerId ? injuryByPlayer.get(row.playerId) : undefined) ?? injuryByName.get(comparablePlayerName(row.name)) ?? null;
    return {
      ...row,
      adpSource: "ffc",
      marketValue: season?.value ?? null,
      marketRank,
      rookie: season?.isRookie ?? false,
      tier: Math.ceil(count / 10),
      gap: marketRank === null ? null : row.adp - marketRank,
      injuryStatus,
      weeklyRank: null,
      weeklyProjection: null,
      opponent: null,
      isAway: null,
      isBye: false,
      projectionSource: null,
      projectionComponents: null,
    };
  });
  // Rookie ADP drives established dynasty boards. If FFC omits a rookie,
  // append that player by descending FantasyCalc rookie value rather than
  // dropping them from the same rookie set used by the ROOKIES filter.
  const fantasyCalcFallbackRows: DraftRow[] = isRookieBoard
    ? sortedByValue.filter((row) => !seenAdpPlayerIds.has(row.playerId)).map((row) => {
      const count = (positionCounts.get(row.position) ?? 0) + 1;
      positionCounts.set(row.position, count);
      const marketRank = valueRank.get(row.playerId) ?? null;
      return {
        format: league.seasonLongFormat.key,
        pool: "rookie",
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        adp: marketRank ?? Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "fantasycalc",
        marketValue: row.value,
        marketRank,
        rookie: true,
        tier: Math.ceil(count / 10),
        gap: null,
        injuryStatus: injuryByPlayer.get(row.playerId) ?? injuryByName.get(comparablePlayerName(row.name)) ?? null,
        weeklyRank: null,
        weeklyProjection: null,
        opponent: null,
        isAway: null,
        isBye: false,
        projectionSource: null,
        projectionComponents: null,
      };
    })
    : [];
  const kickerRows: DraftRow[] = !isRookieBoard && league.rankingPositions.includes("K")
    ? dashboard.rankings
      .filter((row) => row.leagueId === league.id && row.position === "K")
      .sort((a, b) => a.leagueRank - b.leagueRank)
      .map((row) => ({
        format: league.seasonLongFormat.key,
        pool: "all" as const,
        playerId: row.playerId,
        name: row.name,
        team: row.team || null,
        position: "K",
        adp: Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "projection" as const,
        marketValue: null,
        marketRank: null,
        rookie: false,
        tier: Math.ceil(row.leagueRank / 10),
        gap: null,
        injuryStatus: row.injuryStatus,
        weeklyRank: row.leagueRank,
        weeklyProjection: row.leagueProjection,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        projectionSource: row.projectionSource,
        projectionComponents: row.projectionComponents,
      }))
    : [];
  const defenseRows: DraftRow[] = !isRookieBoard && league.rankingPositions.includes("DEF")
    ? dashboard.defenses
      .filter((row) => row.leagueId === league.id)
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.team.localeCompare(b.team))
      .map((row) => ({
        format: league.seasonLongFormat.key,
        pool: "all" as const,
        playerId: row.team,
        name: `${row.team} Defense`,
        team: row.team,
        position: "DEF",
        adp: Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "projection" as const,
        marketValue: null,
        marketRank: null,
        rookie: false,
        tier: Math.ceil((row.rank ?? 1) / 10),
        gap: null,
        injuryStatus: null,
        weeklyRank: row.rank,
        weeklyProjection: row.displayProjection,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: false,
        projectionSource: row.projectionSource,
        gamePhase: row.gamePhase,
        defenseComponents: row.components ?? undefined,
        projectionComponents: null,
      }))
    : [];
    return [...adpRows, ...fantasyCalcFallbackRows, ...kickerRows, ...defenseRows];
  }, [boardSeasonRows, dashboard.defenses, dashboard.rankings, data?.adp, injuryByName, injuryByPlayer, isRookieBoard, league.id, league.rankingPositions, league.seasonLongFormat.key, sortedByValue, valueRank]);
  const syncedLeagueDrafts = useMemo(
    () => leagueDrafts.filter((draft) => draft.status === "drafting" || draft.status === "complete"),
    [leagueDrafts],
  );
  const sleeperDraftedIds = useMemo(
    () => new Set(syncedLeagueDrafts.flatMap((draft) => draft.picks.map((pick) => pick.playerId))),
    [syncedLeagueDrafts],
  );
  // Manual board decisions remain additive to Sleeper's read-only draft history.
  // A Restore only removes the manual mark; it can never restore a Sleeper pick.
  const draftedIds = useMemo(() => new Set([...sleeperDraftedIds, ...manualDraftedIds]), [manualDraftedIds, sleeperDraftedIds]);
  const myTeamIdSet = useMemo(() => new Set(myTeamIds), [myTeamIds]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return rows
      .filter((row) => !draftedIds.has(row.playerId ?? "") && !myTeamIdSet.has(row.playerId ?? ""))
      .filter((row) => (effectiveDraftPosition === "ALL" || (effectiveDraftPosition === "ROOKIES" ? row.rookie : row.position === effectiveDraftPosition)) && row.name.toLowerCase().includes(normalizedQuery));
  }, [draftedIds, effectiveDraftPosition, myTeamIdSet, query, rows]);
  const draftPositionIsEligible = (value: string) => value !== "K" && value !== "DEF" || league.rankingPositions.includes(value as "K" | "DEF");
  const seenOwnPickIds = new Set<string>();
  const ownPicks = syncedLeagueDrafts.flatMap((draft) => draft.ownRosterId === null ? [] : draft.picks.filter((pick) => pick.rosterId === draft.ownRosterId)).filter((pick) => {
    if (!draftPositionIsEligible(pick.position) || seenOwnPickIds.has(pick.playerId)) return false;
    seenOwnPickIds.add(pick.playerId);
    return true;
  });
  const localMyTeamRows = rows.filter((row) => row.playerId && myTeamIdSet.has(row.playerId) && !sleeperDraftedIds.has(row.playerId));
  const myTeamPlayers = [
    ...ownPicks.filter((pick) => !hiddenLiveTeamIds.includes(pick.playerId)).map((pick) => ({ playerId: pick.playerId, name: pick.playerName, position: pick.position, team: pick.team, livePick: true })),
    ...localMyTeamRows.map((row) => ({ playerId: row.playerId ?? row.name, name: row.name, position: row.position, team: row.team, livePick: false })),
  ];
  const myTeamPlayerIds = new Set(myTeamPlayers.map((player) => player.playerId));
  const manualDraftedRows = rows.filter((row) => row.playerId && manualDraftedIds.includes(row.playerId) && !sleeperDraftedIds.has(row.playerId) && !myTeamPlayerIds.has(row.playerId));

  function addToMyTeam(playerId: string) {
    if (addToMyTeamLocked.current) return;
    addToMyTeamLocked.current = true;
    window.setTimeout(() => { addToMyTeamLocked.current = false; }, 350);
    setMyTeamIds((current) => dedupePlayerIds([...current, playerId]));
    setManualDraftedIds((current) => current.filter((id) => id !== playerId));
  }

  function markTaken(playerId: string) {
    const { next, previous } = markDraftPlayerTaken({ manualDraftedIds, myTeamIds }, playerId);
    setManualDraftedIds(next.manualDraftedIds);
    setMyTeamIds(next.myTeamIds);
    const name = rows.find((row) => row.playerId === playerId)?.name ?? "Player";
    showUndoToast(`Marked ${name} taken`, () => {
      const restored = undoDraftPlayerTaken(previous);
      setManualDraftedIds(restored.manualDraftedIds);
      setMyTeamIds(restored.myTeamIds);
    });
  }

  function removeFromMyTeam(playerId: string, livePick: boolean) {
    if (livePick) setHiddenLiveTeamIds((current) => dedupePlayerIds([...current, playerId]));
    else setMyTeamIds((current) => current.filter((id) => id !== playerId));
  }

  const myTeamSection = (
    <section className="draft-my-team">
      <div className="section-heading"><h2>My Team</h2><span>{myTeamPlayers.length} players</span></div>
      {myTeamPlayers.length > 0 ? (
        <div className="draft-board data-table-frame" role="list" aria-label="My team players">
          <div className="draft-row draft-table-head draft-my-team-row">
            <span aria-hidden="true">Player</span>
            <span className="sr-only">Actions</span>
          </div>
          {myTeamPlayers.map((player) => {
            const secondary = draftSecondaryLine(player.position, player.team);
            const isSelected = Boolean(linkedPlayerId && player.playerId === linkedPlayerId);
            return (
              <div className={`draft-row draft-my-team-row${isSelected ? " is-player-selected" : ""}`} role="listitem" key={player.playerId}>
                <button type="button" className={`draft-player-open${secondary ? "" : " is-single-line"}`} onClick={() => openDraftPlayer(player)} aria-label={`View ${player.name} details and news${isSelected ? ", selected" : ""}`}>
                  <span className="draft-player-name-line">
                    <strong>{player.name}</strong>
                    {isSelected ? <span className="player-selected-chip">Selected</span> : null}
                  </span>
                  {secondary ? <small className="draft-player-meta">{secondary}</small> : null}
                </button>
                <span className="draft-row-actions">
                  <button type="button" className="draft-remove-link" onClick={() => removeFromMyTeam(player.playerId, player.livePick)} aria-label={`Remove ${player.name} from My Team`}>Remove</button>
                </span>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-inline compact">{syncedDraft ? "Your Sleeper picks will appear here automatically." : "Add players from the Draft Board."}</div>}
      {manualDraftedRows.length > 0 ? <details className="drafted-elsewhere"><summary>Drafted elsewhere · {manualDraftedRows.length}</summary><div>{manualDraftedRows.map((player) => <button type="button" key={player.playerId ?? player.name} onClick={() => player.playerId && setManualDraftedIds((current) => current.filter((id) => id !== player.playerId))}><span><strong>{player.name}</strong><small>{player.position}{player.team ? ` · ${player.team}` : ""}</small></span><b>Restore</b></button>)}</div></details> : null}
    </section>
  );

  const draftFilters = (
    <div className="draft-controls">
      <label><span className="sr-only">Search draft players</span><input type="search" name="draft-search" autoComplete="off" spellCheck={false} value={query} onChange={(event) => publishDraftFilters({ query: event.target.value })} placeholder="Search players…" aria-label="Search draft players" /></label>
      <SegmentedControl
        className="position-tabs"
        value={effectiveDraftPosition}
        onChange={(value) => publishDraftFilters({ position: value })}
        label="Draft position filter"
        options={draftPositionOptions.map((item) => ({
          value: item,
          label: positionFilterTabLabel(item),
          ariaLabel: positionFilterTabAriaLabel(item),
        }))}
      />
      <button className="draft-refresh-button" type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh draft data"><RefreshIcon spinning={refreshing} /></button>
    </div>
  );

  const draftBoard = loading ? <div className="empty-inline">Loading draft values…</div> : filteredRows.length > 0 ? (
    <div className="draft-board data-table-frame" role="list" aria-label="Draft player board">
      <div className="draft-row draft-table-head">
        <span aria-hidden="true">Player</span>
        <span aria-hidden="true">Pos</span>
        <span aria-hidden="true">Val</span>
        <span className="sr-only">Actions</span>
      </div>
      {filteredRows.slice(0, visibleDraftCount).map((row) => {
        const isSpecialist = row.position === "K" || row.position === "DEF";
        const secondary = row.team?.trim() || null;
        const isSelected = Boolean(linkedPlayerId && row.playerId === linkedPlayerId);
        return (
          <div className={`draft-row${isSelected ? " is-player-selected" : ""}`} role="listitem" key={`${row.format}-${row.playerId ?? row.name}`}>
            <button type="button" className={`draft-player-open${secondary ? "" : " is-single-line"}`} onClick={() => openDraftPlayer(row)} disabled={!row.playerId} aria-label={`View ${row.name} details and news${isSelected ? ", selected" : ""}`}>
              <span className="draft-player-name-line">
                <strong>{row.name}</strong>
                {isSelected ? <span className="player-selected-chip">Selected</span> : null}
                {row.rookie ? <DesignationBadge code="R" label="Rookie" title="Rookie" /> : null}
              </span>
              {secondary ? <small className="draft-player-meta">{secondary}</small> : null}
            </button>
            <span>{row.position === "DEF" ? "DST" : row.position}</span>
            <span><strong>{isSpecialist ? <><span className="sr-only">Weekly projection </span>{formatProjectionPoints(row.weeklyProjection, row.projectionSource)}</> : row.marketValue === null ? <><span className="sr-only">Market value not listed</span><span aria-hidden="true">—</span></> : <><span className="sr-only">Market value </span>{row.marketValue.toLocaleString()}</>}</strong></span>
            <span className="draft-row-actions">
              <button type="button" className="draft-icon-button" disabled={!row.playerId} onClick={() => row.playerId && addToMyTeam(row.playerId)} aria-label={`Add ${row.name} to my team`} title="Add to my team"><Plus aria-hidden="true" /></button>
              {liveDraft ? null : <button type="button" className="draft-icon-button draft-taken-button" disabled={!row.playerId} onClick={() => row.playerId && markTaken(row.playerId)} aria-label={`Drafted by another team, ${row.name}`} title="Drafted by another team"><UserX aria-hidden="true" /></button>}
            </span>
          </div>
        );
      })}
      <div className="list-pagination-row draft-list-pagination">
        <span aria-live="polite">showing {Math.min(visibleDraftCount, filteredRows.length)} of {filteredRows.length}</span>
        {visibleDraftCount < filteredRows.length ? <button type="button" onClick={() => setVisibleDraftCount((count) => count + 160)}>Show more</button> : null}
      </div>
    </div>
  ) : <div className="empty-inline">No available players match these filters.</div>;

  function openDraftPlayer(player: DraftPlayerOpenSource) {
    if (!player.playerId) return;
    onOpenLinkedPlayer(player.playerId);
  }

  return (
    <section className="draft-center">
      <h2 className="sr-only">Draft Room</h2>
      <SegmentedControl
        value={mode}
        onChange={(value) => publishDraftFilters({ room: value })}
        label="Draft room view"
        options={[
          { value: "board", label: liveDraft ? "Draft Board · Live" : "Draft Board" },
          { value: "myTeam", label: "My Team" },
        ]}
      />
      {mode === "board" ? (
        <div className="draft-board-view">
          {draftFilters}
          {draftBoard}
        </div>
      ) : myTeamSection}
    </section>
  );
}
