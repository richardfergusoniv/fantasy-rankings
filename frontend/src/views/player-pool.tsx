import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Dashboard,
  League,
  MatchupSelection,
  NflTeamRecord,
  PlayerLink,
  PlayerSearchResult,
  PfnTable,
  PositionFilter,
  TeamCardSelection,
  TeamSituational,
  TeamSituationalRow,
  TeamUsage,
} from "../dashboard-types";
import {
  DesignationBadge,
  SectionError,
  accessibleMatchupLabel,
  basePositionOrder,
  canonicalNflTeam,
  comparablePlayerName,
  formatProjectionPoints,
  isBoomBustPosition,
  matchupLabel,
  movementPercent,
  pfnDateLabel,
  pfnNumber,
  pfnRankForRow,
  positionsForFilter,
  sleeperInjuryTag,
} from "../dashboard-shared";
import type { RankingHorizon, RankingPosition } from "../dashboard-url";
import { formatDecimal, formatPercent } from "../lib/format-number";
import {
  SOS_POSITIONS,
  fantasySosRanksForTeam,
  MatchupTag,
  ModalPortal,
  SegmentedControl,
  rankToneClassName,
  useDialogFocusTrap,
  type StrengthOfScheduleEntryLike,
} from "../shared";
import { WindowVirtualList } from "../virtual-list";
import { positionFilterTabAriaLabel, positionFilterTabLabel } from "./position-filter-labels";

/** Compact rankings/waivers row height (matches former density=compact). */
export const RANKINGS_ROW_HEIGHT = 56;

export function offensiveLineTone(rank: number | null): "" | " oline-strong" | " oline-weak" {
  if (rank === null || !Number.isInteger(rank) || rank < 1 || rank > 32) return "";
  if (rank <= 10) return " oline-strong";
  if (rank >= 23) return " oline-weak";
  return "";
}

export function offensiveLineRanksByTeam(table: PfnTable | null): Map<string, number> {
  const rows = table?.rows.flatMap((row) => {
    const team = canonicalNflTeam(row.team);
    return team ? [{ team, row }] : [];
  }) ?? [];
  const suppliedRanks = rows.map(({ row }) => row.rank);
  const hasCompleteRankOrder = rows.length === 32
    && suppliedRanks.every((rank) => Number.isInteger(rank) && rank >= 1 && rank <= 32)
    && new Set(suppliedRanks).size === 32;

  if (hasCompleteRankOrder) {
    return new Map(rows.map(({ team, row }) => [team, row.rank]));
  }

  // Some older PFN payloads put a grade-like value in `rank`. Recover the
  // published ordering from grade only when all 32 teams are present; a
  // partial or unmatched table stays neutral rather than implying a bad tier.
  const gradedRows = rows.flatMap(({ team, row }) => {
    const grade = pfnNumber(row, "grade");
    return grade === null ? [] : [{ team, grade }];
  });
  if (gradedRows.length !== 32 || new Set(gradedRows.map(({ team }) => team)).size !== 32) return new Map();

  gradedRows.sort((a, b) => b.grade - a.grade || a.team.localeCompare(b.team));
  return new Map(gradedRows.map(({ team }, index) => [team, index + 1]));
}

export function SeasonTeamPill({ team, lineRank, onOpen }: { team: string | null; lineRank: number | null; onOpen?: () => void }) {
  const teamLabel = team ?? "FA";
  const className = `matchup-reference-tag season-team-pill${offensiveLineTone(lineRank)}`;
  if (!team || !onOpen) return <span className={className}>{teamLabel}</span>;
  return (
    <button
      type="button"
      className={`${className} matchup-reference-button`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={`View ${teamLabel} team data${lineRank === null ? "" : `, offensive line rank ${lineRank}`}`}
      aria-haspopup="dialog"
      title={lineRank === null ? `${teamLabel} team data` : `${teamLabel} offensive line rank #${lineRank}`}
    >
      <span className="matchup-reference-button-label">{teamLabel}</span>
      <span className="matchup-reference-arrow" aria-hidden="true">›</span>
    </button>
  );
}

export function TeamDataModal({
  selection,
  offensiveLine,
  defense,
  offense,
  teamOverall,
  usage,
  record,
  situational,
  situationalSource,
  sosEntry,
  loading,
  loadError,
  onRetry,
  onClose,
}: {
  selection: TeamCardSelection;
  offensiveLine: PfnTable | null;
  defense: PfnTable | null;
  offense: PfnTable | null;
  teamOverall: PfnTable | null;
  usage: TeamUsage | null;
  record: NflTeamRecord | null;
  situational: TeamSituationalRow | null;
  situationalSource: Pick<TeamSituational, "fetchedAt" | "sourceUrl"> | null;
  sosEntry?: StrengthOfScheduleEntryLike;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const teamCode = canonicalNflTeam(selection.team);
  const lineRow = offensiveLine?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const defenseRow = defense?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const offenseRow = offense?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const overallRow = teamOverall?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const lineGrade = pfnNumber(lineRow, "grade");
  const defenseGrade = pfnNumber(defenseRow, "grade");
  const offenseGrade = pfnNumber(offenseRow, "grade");
  const lineRank = lineRow?.rank ?? null;
  const defenseRank = defenseRow?.rank ?? null;
  const offenseRank = offenseRow?.rank ?? null;
  const passBlock = pfnNumber(lineRow, "pass_block");
  const runBlock = pfnNumber(lineRow, "run_block");
  const penPerGame = pfnNumber(lineRow, "pen_per_game");
  const passBlockRank = pfnRankForRow(offensiveLine, lineRow, "pass_block");
  const runBlockRank = pfnRankForRow(offensiveLine, lineRow, "run_block");
  const overallGrade = pfnNumber(overallRow, "grade");
  const overallRank = overallRow?.rank ?? null;
  const specialTeams = pfnNumber(overallRow, "special_teams");
  const specialTeamsRank = pfnRankForRow(teamOverall, overallRow, "special_teams");
  const epaPerPlay = pfnNumber(offenseRow, "epa_per_play");
  const successPct = pfnNumber(offenseRow, "success_pct");
  const yardsPerPlay = pfnNumber(offenseRow, "yds_per_play");
  const explosivePct = pfnNumber(offenseRow, "expl_pct");
  const teamName = lineRow?.team_name ?? defenseRow?.team_name ?? offenseRow?.team_name ?? overallRow?.team_name ?? selection.team;
  const usageWeek = usage ? `Through ${usage.games} game${usage.games === 1 ? "" : "s"}` : null;
  const pfnRecord = overallRow?.record;
  const recordLabel = typeof pfnRecord === "string" && /^\d+-\d+(?:-\d+)?$/.test(pfnRecord)
    ? pfnRecord
    : record ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}` : "—";
  const sosRanks = fantasySosRanksForTeam(sosEntry, teamCode ?? selection.team);
  const rankLabel = (rank: number | null, loadingValue: boolean) => (
    loadingValue ? <strong>…</strong> : <strong className={rankToneClassName(rank)}>{rank === null ? "—" : `#${rank}`}</strong>
  );
  const gradeCaption = (value: number | null, fallback: string) => (
    <small className={value === null ? undefined : "metric-grade"}>{value === null ? fallback : `${formatDecimal(value, 1)} grade`}</small>
  );

  return (
    <ModalPortal>
      <div className="matchup-card-backdrop" onClick={onClose}>
        <article ref={dialogRef} className="matchup-data-card team-data-card" role="dialog" aria-modal="true" aria-labelledby="team-card-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <header className="matchup-data-header">
            <div>
              <h2 id="team-card-title">{selection.team} team card</h2>
              <span>{teamName}{offensiveLine?.fetched_at || defense?.fetched_at || offense?.fetched_at || teamOverall?.fetched_at ? ` · PFN ${pfnDateLabel(offensiveLine?.fetched_at ?? defense?.fetched_at ?? offense?.fetched_at ?? teamOverall?.fetched_at ?? "")}` : ""}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close team data">×</button>
          </header>

          <section className="team-card-stat-section" aria-labelledby="team-basic-stats-title">
            <div className="team-card-section-heading">
              <h3 id="team-basic-stats-title">Basic</h3>
              <span>{usageWeek ?? "Season production"}</span>
            </div>
            <div className="team-card-metrics">
              <div>
                <span>Points scored</span>
                <strong>{usage ? usage.pointsScored.toLocaleString() : "—"}</strong>
                <small>{usageWeek ?? "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Total yards</span>
                <strong>{usage ? usage.totalYards.toLocaleString() : "—"}</strong>
                <small>{usageWeek ?? "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Passing yards</span>
                <strong>{usage ? usage.passingYards.toLocaleString() : "—"}</strong>
                <small>Season total</small>
              </div>
              <div>
                <span>Rushing yards</span>
                <strong>{usage ? usage.rushingYards.toLocaleString() : "—"}</strong>
                <small>Season total</small>
              </div>
              <div>
                <span>Win–loss record</span>
                <strong>{recordLabel}</strong>
                <small>Season</small>
              </div>
              <div>
                <span>Offensive touchdowns</span>
                <strong>{usage ? usage.offensiveTouchdowns.toLocaleString() : "—"}</strong>
                <small>Pass catches + rushes</small>
              </div>
              <div>
                <span>Turnovers</span>
                <strong>{usage ? usage.turnovers.toLocaleString() : "—"}</strong>
                <small>Interceptions + fumbles lost</small>
              </div>
              <div>
                <span>Pace of play</span>
                <strong>{usage ? formatDecimal(usage.playsPerGame, 1) : "—"}</strong>
                <small>{usageWeek ? `plays / game · ${usageWeek}` : "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Run / pass split</span>
                <strong>{usage ? `${Math.round(usage.runPct)} / ${Math.round(usage.passPct)}` : "—"}</strong>
                <small>{usage ? "run% / pass%" : "nflverse unavailable"}</small>
              </div>
            </div>
          </section>

          <section className="team-card-stat-section" aria-labelledby="team-pfn-grades-title">
            <div className="team-card-section-heading">
              <h3 id="team-pfn-grades-title">PFN</h3>
              <span>Grades · ranks</span>
            </div>
            <div className="team-card-metrics">
              <div>
                <span>Overall</span>
                {rankLabel(overallRank, loading)}
                {gradeCaption(overallGrade, "PFN overall")}
              </div>
              <div>
                <span>Special teams</span>
                {rankLabel(specialTeamsRank, loading)}
                {gradeCaption(specialTeams, "PFN overall")}
              </div>
              <div>
                <span>O-line</span>
                {rankLabel(lineRank, loading)}
                {gradeCaption(lineGrade, "PFN rank")}
              </div>
              <div>
                <span>Pass block</span>
                {rankLabel(passBlockRank, loading)}
                {gradeCaption(passBlock, "PFN O-line")}
              </div>
              <div>
                <span>Run block</span>
                {rankLabel(runBlockRank, loading)}
                {gradeCaption(runBlock, "PFN O-line")}
              </div>
              <div>
                <span>Pen/G</span>
                <strong>{loading ? "…" : penPerGame === null ? "—" : formatDecimal(penPerGame, 1)}</strong>
                <small>PFN O-line</small>
              </div>
              <div>
                <span>Defense</span>
                {rankLabel(defenseRank, loading)}
                {gradeCaption(defenseGrade, "PFN rank")}
              </div>
              <div>
                <span>Offense</span>
                {rankLabel(offenseRank, loading)}
                {gradeCaption(offenseGrade, "PFN rank")}
              </div>
              {SOS_POSITIONS.map((position) => {
                const rank = sosRanks[position];
                if (rank === null) return null;
                return (
                  <div key={`${position}-sos`}>
                    <span>{position} SOS</span>
                    <strong className={rankToneClassName(rank)}>#{rank}</strong>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="team-card-stat-section" aria-labelledby="team-advanced-stats-title">
            <div className="team-card-section-heading">
              <h3 id="team-advanced-stats-title">Advanced</h3>
              <span>Offensive efficiency</span>
            </div>
            <div className="team-card-metrics team-card-advanced-metrics">
              <div>
                <span>Red-zone TD rate</span>
                <strong>{situational ? formatPercent(situational.redZoneTdPct, 0) : "—"}</strong>
                <small>{situational ? `${situational.games} game${situational.games === 1 ? "" : "s"}` : "Source unavailable"}</small>
              </div>
              <div>
                <span>Third-down conversion</span>
                <strong>{situational ? formatPercent(situational.thirdDownPct, 0) : "—"}</strong>
                <small>{situational ? `${situational.games} game${situational.games === 1 ? "" : "s"}` : "Source unavailable"}</small>
              </div>
              <div>
                <span>EPA / play</span>
                <strong>{epaPerPlay === null ? "—" : formatDecimal(epaPerPlay, 2, { sign: "exceptZero" })}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Success rate</span>
                <strong>{successPct === null ? "—" : formatPercent(successPct, 1)}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Yards / play</span>
                <strong>{yardsPerPlay === null ? "—" : formatDecimal(yardsPerPlay, 1)}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Explosive play rate</span>
                <strong>{explosivePct === null ? "—" : formatPercent(explosivePct, 1)}</strong>
                <small>PFN offense</small>
              </div>
            </div>
            {situationalSource ? (
              <p className="team-card-source">
                Situational rates · <a href={situationalSource.sourceUrl} target="_blank" rel="noreferrer"><span translate="no">Sportskeeda</span><span className="sr-only"> (opens in a new tab)</span></a> · fetched {pfnDateLabel(situationalSource.fetchedAt)}
              </p>
            ) : null}
          </section>
          {loadError ? <SectionError title="Team data didn’t load." onRetry={onRetry} compact /> : null}
        </article>
      </div>
    </ModalPortal>
  );
}

export function ConnectedTeamCard({
  team,
  dashboard,
  leagueId,
  onClose,
}: {
  team: string;
  dashboard: Dashboard;
  leagueId: string;
  onClose: () => void;
}) {
  const pfnTablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const tables = pfnTablesQuery.data?.tables;
  const teamSituational = pfnTablesQuery.data?.teamSituational ?? null;
  const teamCode = canonicalNflTeam(team) ?? team;
  const situational = teamSituational?.rows.find((row) => (canonicalNflTeam(row.team) ?? row.team) === teamCode) ?? null;
  return (
    <TeamDataModal
      selection={{ team }}
      offensiveLine={tables?.["offensive-line"] ?? null}
      defense={tables?.defense ?? null}
      offense={tables?.offense ?? null}
      teamOverall={tables?.["team-overall"] ?? null}
      usage={dashboard.analytics.teamUsage.find((row) => (canonicalNflTeam(row.team) ?? row.team) === teamCode) ?? null}
      record={(dashboard.analytics.teamRecords ?? []).find((row) => (canonicalNflTeam(row.team) ?? row.team) === teamCode) ?? null}
      situational={situational}
      situationalSource={teamSituational ? { fetchedAt: teamSituational.fetchedAt, sourceUrl: teamSituational.sourceUrl } : null}
      sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === leagueId)}
      loading={pfnTablesQuery.isPending}
      loadError={pfnTablesQuery.isError}
      onRetry={() => { void pfnTablesQuery.refetch(); }}
      onClose={onClose}
    />
  );
}

export function PlayerPool({ dashboard, league, availableOnly, onOpenMatchup, rankingPosition, rankingHorizon, rankingQuery, onRankingFiltersChange, linkedPlayerId, onOpenLinkedPlayer }: { dashboard: Dashboard; league: League; availableOnly: boolean; onOpenMatchup?: (matchup: MatchupSelection) => void; rankingPosition: RankingPosition | null; rankingHorizon: RankingHorizon | null; rankingQuery: string | null; onRankingFiltersChange: (filters: { position: RankingPosition | null; horizon: RankingHorizon | null; query: string | null }) => void } & PlayerLink) {
  const [position, setPosition] = useState<PositionFilter>(rankingPosition ?? "QB");
  const [query, setQuery] = useState(rankingQuery ?? "");
  const [rankingMode, setRankingMode] = useState<"week" | "ros" | "dynasty">(rankingHorizon ?? "week");
  const horizonOptions = league.seasonLongFormat.isDynasty ? ["week", "ros", "dynasty"] as const : ["week", "ros"] as const;
  const effectiveHorizon = (horizonOptions as readonly string[]).includes(rankingMode) ? rankingMode : "week";
  const [visibleRowCount, setVisibleRowCount] = useState(120);
  const [selectedTeam, setSelectedTeam] = useState<TeamCardSelection | null>(null);
  const queryClient = useQueryClient();
  const isSeasonLong = effectiveHorizon !== "week";
  const pfnTablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    enabled: isSeasonLong,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const offensiveLine = pfnTablesQuery.data?.tables["offensive-line"] ?? null;
  const defense = pfnTablesQuery.data?.tables.defense ?? null;
  const offense = pfnTablesQuery.data?.tables.offense ?? null;
  const teamOverall = pfnTablesQuery.data?.tables["team-overall"] ?? null;
  const teamSituational = pfnTablesQuery.data?.teamSituational ?? null;
  const offensiveLineRankByTeam = useMemo(() => offensiveLineRanksByTeam(offensiveLine), [offensiveLine]);
  const teamSituationalByTeam = useMemo(() => new Map(
    (teamSituational?.rows ?? []).map((row) => [canonicalNflTeam(row.team) ?? row.team, row]),
  ), [teamSituational]);
  const teamUsageByTeam = useMemo(() => new Map(
    dashboard.analytics.teamUsage.map((usage) => [canonicalNflTeam(usage.team) ?? usage.team, usage]),
  ), [dashboard.analytics.teamUsage]);
  const teamRecordByTeam = useMemo(() => new Map(
    (dashboard.analytics.teamRecords ?? []).map((record) => [canonicalNflTeam(record.team) ?? record.team, record]),
  ), [dashboard.analytics.teamRecords]);
  const redraftFormatKey = `redraft-${league.seasonLongFormat.numQbs}qb-${league.seasonLongFormat.numTeams}t-${league.seasonLongFormat.ppr}ppr`;
  const seasonFormatKey = effectiveHorizon === "dynasty" ? league.seasonLongFormat.key : redraftFormatKey;
  const basePositions = basePositionOrder.filter((item) => league.rankingPositions.includes(item) && (!isSeasonLong || ["QB", "RB", "WR", "TE"].includes(item)));
  /** Single-row filter: base positions then ALL/FLEX/SUPER/Rook modifiers. */
  const visiblePositions: PositionFilter[] = [
    ...basePositions,
    ...(isSeasonLong ? ["ALL" as const] : []),
    "FLEX",
    ...(league.showSuperFilter ? ["SUPER" as const] : []),
    ...(effectiveHorizon === "dynasty" ? ["ROOKIES" as const] : []),
  ];
  const effectivePosition = visiblePositions.includes(position) ? position : (visiblePositions[0] ?? "QB");
  const includedPositions = positionsForFilter(effectivePosition);
  const myRoster = new Set([...league.starters, ...league.bench].map((player) => player.playerId));
  const rosterTeamByPlayer = useMemo(
    () => new Map((league.rosterAssignments ?? []).map((assignment) => [assignment.playerId, assignment])),
    [league.rosterAssignments],
  );
  const leagueRankings = useMemo(() => dashboard.rankings.filter((row) => row.leagueId === league.id), [dashboard.rankings, league.id]);
  const leagueDefenses = useMemo(() => dashboard.defenses.filter((row) => row.leagueId === league.id), [dashboard.defenses, league.id]);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);

  useEffect(() => { setPosition(rankingPosition ?? "QB"); }, [rankingPosition]);
  useEffect(() => { setRankingMode(rankingHorizon ?? "week"); }, [rankingHorizon]);
  useEffect(() => { setQuery(rankingQuery ?? ""); }, [rankingQuery]);

  function publishRankingFilters(next: { position?: PositionFilter; horizon?: "week" | "ros" | "dynasty"; query?: string }) {
    const nextPosition = next.position ?? effectivePosition;
    const nextHorizon = next.horizon ?? effectiveHorizon;
    const nextQuery = next.query ?? query;
    if (next.position !== undefined) setPosition(next.position);
    if (next.horizon !== undefined) setRankingMode(next.horizon);
    if (next.query !== undefined) setQuery(next.query);
    onRankingFiltersChange({
      position: nextPosition === "QB" ? null : nextPosition,
      horizon: nextHorizon === "week" ? null : nextHorizon,
      query: nextQuery.trim() ? nextQuery : null,
    });
  }

  useEffect(() => {
    if (position === effectivePosition && rankingMode === effectiveHorizon) return;
    setPosition(effectivePosition);
    setRankingMode(effectiveHorizon);
    onRankingFiltersChange({
      position: effectivePosition === "QB" ? null : effectivePosition,
      horizon: effectiveHorizon === "week" ? null : effectiveHorizon,
      query: query.trim() ? query : null,
    });
  }, [effectiveHorizon, effectivePosition, onRankingFiltersChange, position, query, rankingMode]);

  useEffect(() => {
    setVisibleRowCount(120);
  }, [availableOnly, effectivePosition, league.id, effectiveHorizon]);

  const allPlayerDetails = useMemo<PlayerSearchResult[]>(() => {
    const rostered = new Set(league.rosteredPlayerIds);
    const seasonRows = dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key && row.position !== "PICK");
    const seasonById = new Map(seasonRows.map((row) => [row.playerId, row]));
    const seasonByName = new Map(seasonRows.map((row) => [comparablePlayerName(row.name), row]));
    const matchedSeasonIds = new Set<string>();
    const results: PlayerSearchResult[] = leagueRankings.map((row) => {
      const nameRow = seasonByName.get(comparablePlayerName(row.name));
      const seasonRow = seasonById.get(row.playerId) ?? (nameRow && nameRow.position === row.position && (nameRow.team ?? null) === (row.team ?? null) ? nameRow : undefined);
      if (seasonRow) matchedSeasonIds.add(seasonRow.playerId);
      return {
        key: `player-${row.playerId}`,
        playerId: row.playerId,
        name: row.name,
        team: row.team || seasonRow?.team || null,
        position: row.position,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        injuryStatus: row.injuryStatus,
        weeklyRank: row.leagueProjection === null ? null : league.rankingField === "ppr" ? row.pprRank : row.halfPprRank,
        weeklyProjection: league.rankingField === "ppr" ? row.ppr : row.halfPpr,
        projectionSource: row.projectionSource,
        projectionComponents: row.projectionComponents,
        seasonRank: seasonRow?.positionRank ?? null,
        seasonValue: seasonRow?.value ?? null,
        movement30Day: seasonRow ? movementPercent(seasonRow.value, seasonRow.trend30Day) : null,
        isRostered: rostered.has(row.playerId),
      };
    });

    seasonRows.forEach((row) => {
      if (matchedSeasonIds.has(row.playerId)) return;
      results.push({
        key: `season-${row.playerId}`,
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        opponent: null,
        isAway: null,
        isBye: false,
        injuryStatus: null,
        weeklyRank: null,
        weeklyProjection: null,
        projectionComponents: null,
        seasonRank: row.positionRank,
        seasonValue: row.value,
        movement30Day: movementPercent(row.value, row.trend30Day),
        isRostered: rostered.has(row.playerId),
      });
    });

    leagueDefenses.forEach((row) => {
      results.push({
        key: `defense-${row.team}`,
        playerId: row.team,
        name: `${row.team} Defense`,
        team: row.team,
        position: "DEF",
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: false,
        injuryStatus: null,
        weeklyRank: row.rank,
        weeklyProjection: row.displayProjection,
        projectionSource: row.projectionSource,
        seasonRank: null,
        seasonValue: null,
        movement30Day: null,
        isRostered: rostered.has(row.team),
        gamePhase: row.gamePhase,
        defenseComponents: row.components,
        projectionComponents: null,
      });
    });
    return results;
  }, [dashboard.seasonLongRankings, league.rankingField, league.rosteredPlayerIds, league.seasonLongFormat.key, leagueDefenses, leagueRankings]);

  const allPlayerDetailsById = useMemo(
    () => new Map(allPlayerDetails.map((player) => [player.playerId, player])),
    [allPlayerDetails],
  );
  const searchMatches = useMemo<PlayerSearchResult[]>(() => {
    const needle = comparablePlayerName(query.trim());
    if (!needle) return [];
    return allPlayerDetails
      .filter((row) => comparablePlayerName(row.name).includes(needle))
      .sort((a, b) => {
        const aName = comparablePlayerName(a.name);
        const bName = comparablePlayerName(b.name);
        const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
        const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
        return aPriority - bPriority
          || (a.weeklyRank ?? a.seasonRank ?? Number.MAX_SAFE_INTEGER) - (b.weeklyRank ?? b.seasonRank ?? Number.MAX_SAFE_INTEGER)
          || a.name.localeCompare(b.name);
      });
  }, [allPlayerDetails, query]);
  const searchRows = useMemo(() => searchMatches.slice(0, 80), [searchMatches]);
  const weeklyContextByPlayerId = useMemo(
    () => new Map(leagueRankings.map((row) => [row.playerId, row])),
    [leagueRankings],
  );
  const rookiePlayerIds = useMemo(
    () => new Set(dashboard.seasonLongRankings.filter((row) => row.isRookie).map((row) => row.playerId)),
    [dashboard.seasonLongRankings],
  );
  const rows = useMemo(() => {
    const rostered = new Set(league.rosteredPlayerIds);
    if (isSeasonLong) {
      return dashboard.seasonLongRankings
        .filter((row) => row.formatKey === seasonFormatKey && row.position !== "PICK" && includedPositions.includes(row.position))
        .filter((row) => effectivePosition !== "ROOKIES" || row.isRookie)
        .filter((row) => !availableOnly || !rostered.has(row.playerId))
        .map((row) => {
          const rosterAssignment = rosterTeamByPlayer.get(row.playerId);
          const weeklyContext = weeklyContextByPlayerId.get(row.playerId);
          const team = row.team ?? weeklyContext?.team ?? null;
          return {
            key: row.playerId,
            rank: row.positionRank,
            sortRank: row.overallRank,
            name: row.name,
            meta: row.isRookie ? "Rookie" : "",
            teamContext: {
              team,
              opponent: weeklyContext?.opponent ?? null,
              isAway: weeklyContext?.isAway ?? null,
              isBye: weeklyContext?.isBye ?? false,
            },
            rosterTeamName: rosterAssignment?.teamName ?? null,
            rosterIsUser: rosterAssignment?.isUser ?? false,
            projection: row.value,
            projectionLabel: "VALUE",
            projectionSource: null,
            position: row.position,
            isRookie: row.isRookie,
            injuryStatus: weeklyContext?.injuryStatus ?? null,
            movement30Day: movementPercent(row.value, row.trend30Day),
          };
        })
        .sort((a, b) => effectivePosition === "ALL"
          ? (b.projection ?? -1) - (a.projection ?? -1) || a.sortRank - b.sortRank
          : effectivePosition === "QB" || effectivePosition === "RB" || effectivePosition === "WR" || effectivePosition === "TE"
            ? a.rank - b.rank
            : a.sortRank - b.sortRank);
    }
    if (effectivePosition === "DEF") {
      return leagueDefenses
        .filter((row) => !availableOnly || !rostered.has(row.team))
        .map((row) => {
          const rosterAssignment = rosterTeamByPlayer.get(row.team);
          return {
            key: row.team,
            rank: row.rank,
            name: `${row.team} Defense`,
            meta: matchupLabel(row.opponent, row.isAway),
            teamContext: null,
            rosterTeamName: rosterAssignment?.teamName ?? null,
            rosterIsUser: rosterAssignment?.isUser ?? false,
            projection: row.displayProjection,
            projectionLabel: row.gamePhase === "final" ? "PTS" : "PROJ",
            projectionSource: row.projectionSource,
            position: "DEF",
            isRookie: false,
            injuryStatus: null,
            movement30Day: null,
          };
        });
    }
    return leagueRankings
      .filter((row) => includedPositions.includes(row.position))
      .filter((row) => !availableOnly || !rostered.has(row.playerId))
      .map((row) => {
        const rosterAssignment = rosterTeamByPlayer.get(row.playerId);
        return {
          key: row.playerId,
          rank: league.rankingField === "ppr" ? row.pprRank : row.halfPprRank,
          name: row.name,
          meta: `${row.position} · ${row.team}${row.opponent ? ` · ${matchupLabel(row.opponent, row.isAway)}` : ""}`,
          teamContext: null,
          rosterTeamName: rosterAssignment?.teamName ?? null,
          rosterIsUser: rosterAssignment?.isUser ?? false,
          projection: league.rankingField === "ppr" ? row.ppr : row.halfPpr,
          projectionLabel: "PROJ",
          projectionSource: row.projectionSource,
          position: row.position,
          isRookie: rookiePlayerIds.has(row.playerId),
          injuryStatus: row.injuryStatus,
          movement30Day: null,
        };
      })
      .sort((a, b) => effectivePosition === "FLEX" || effectivePosition === "SUPER"
        ? (b.projection ?? -1) - (a.projection ?? -1) || a.rank - b.rank
        : a.rank - b.rank);
  }, [availableOnly, dashboard.seasonLongRankings, effectivePosition, includedPositions, isSeasonLong, league.rankingField, league.rosteredPlayerIds, leagueDefenses, leagueRankings, rookiePlayerIds, rosterTeamByPlayer, seasonFormatKey, weeklyContextByPlayerId]);
  const visibleRows = rows.slice(0, visibleRowCount);
  const hasSearch = query.trim().length > 0;
  const prefetchPlayerPanels = (player: PlayerSearchResult) => {
    const position = isBoomBustPosition(player.position) ? player.position : null;
    if (position !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["boom-bust-history", league.id, player.playerId, "season"],
        queryFn: () => api.getBoomBustHistory({ leagueId: league.id, playerId: player.playerId, position, view: "season" }),
        staleTime: 30 * 60 * 1000,
      });
    }
    if (player.position !== "PICK" && player.seasonValue !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, [player.playerId]],
        queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: [player.playerId] }),
        staleTime: 30 * 60 * 1000,
      });
    }
  };
  const selectSearchResult = (player: PlayerSearchResult) => {
    onOpenLinkedPlayer(player.playerId);
  };

  return (
    <section className="rankings-view">
      <div className="rankings-toolbar">
        <label className="search-field">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            type="search"
            aria-label="Search all players by name"
            value={query}
            onChange={(event) => publishRankingFilters({ query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") publishRankingFilters({ query: "" });
            }}
            name="player-search"
            placeholder="Search all players…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {hasSearch ? <button className="search-clear" type="button" onClick={() => publishRankingFilters({ query: "" })} aria-label="Clear player search">×</button> : null}
        </label>
        {!hasSearch ? (
          <div className="position-filter-row" role="group" aria-label="Position filter">
            <SegmentedControl
              className={`position-tabs${!visiblePositions.includes(effectivePosition) ? " no-active" : ""}`}
              value={effectivePosition}
              onChange={(value) => publishRankingFilters({ position: value })}
              label="Positions"
              options={visiblePositions.map((item) => ({
                value: item,
                label: positionFilterTabLabel(item),
                ariaLabel: positionFilterTabAriaLabel(item),
              }))}
            />
          </div>
        ) : null}
      </div>

      {hasSearch ? (
        <>
          <div className="player-search-head" aria-hidden="true"><span>Player</span><span>Week</span><span>Value</span></div>
          <div className="player-search-list" aria-label="Matching players">
            <WindowVirtualList count={searchRows.length} estimateSize={RANKINGS_ROW_HEIGHT} getKey={(index) => searchRows[index]?.key ?? index}>
            {(index) => {
              const row = searchRows[index];
              if (!row) return null;
              const isMine = myRoster.has(row.playerId);
              const isSelected = linkedPlayerId === row.playerId;
              return (
              <button
                className={`player-search-result${isMine ? " is-my-roster" : ""}${isSelected ? " is-player-selected" : ""}`}
                key={row.key}
                type="button"
                onPointerDown={() => prefetchPlayerPanels(row)}
                onFocus={() => prefetchPlayerPanels(row)}
                onClick={() => selectSearchResult(row)}
                aria-label={`View ${row.name}, ${row.position === "DEF" ? "DST" : row.position}, ${accessibleMatchupLabel(row.team, row.opponent, row.isAway, row.isBye)}, ${row.weeklyProjection === null ? "no projection" : `${formatProjectionPoints(row.weeklyProjection, row.projectionSource)} projected points`}, ${row.seasonValue === null ? "no season value" : `${row.seasonValue.toLocaleString()} season value`}${row.injuryStatus ? `, injury status ${row.injuryStatus}` : ""}${isMine ? ", on your team" : ""}${isSelected ? ", selected" : ""}`}
              >
                <span className="player-search-main">
                  <span className="player-search-name">
                    <strong>{row.name}</strong>
                    {isSelected ? <span className="player-selected-chip">Selected</span> : null}
                    {row.injuryStatus ? <DesignationBadge code={sleeperInjuryTag(row.injuryStatus)} label={`Injury status: ${row.injuryStatus}`} title={row.injuryStatus} /> : null}
                  </span>
                  <span className="player-search-meta"><span>{row.position}</span><MatchupTag team={row.team} opponent={row.opponent} isAway={row.isAway} isBye={row.isBye} position={row.position} entry={sosEntry} onClick={row.team && row.opponent && onOpenMatchup ? (event) => { event.stopPropagation(); onOpenMatchup({ team: row.team ?? "", opponent: row.opponent ?? "", isAway: row.isAway, gamePhase: row.gamePhase ?? null }); } : undefined} /></span>
                </span>
                <span className="player-search-value"><strong>{formatProjectionPoints(row.weeklyProjection, row.projectionSource)}</strong><small>{row.weeklyProjection === null ? "No projection" : row.weeklyRank === null ? "—" : `#${row.weeklyRank}`}</small></span>
                <span className="player-search-value"><strong>{row.seasonValue === null ? "—" : row.seasonValue.toLocaleString()}</strong><small>{row.seasonRank === null ? "—" : `#${row.seasonRank}`}</small></span>
              </button>
              );
            }}
            </WindowVirtualList>
          </div>
          {searchRows.length === 0 ? <div className="empty-inline">No player names match “{query.trim()}”.</div> : null}
        </>
      ) : (
        <>
          <SegmentedControl
            className="lineup-mode-toggle rankings-mode-toggle"
            value={effectiveHorizon}
            onChange={(value) => publishRankingFilters({ horizon: value })}
            label={availableOnly ? "Waiver ranking horizon" : "Ranking horizon"}
            options={league.seasonLongFormat.isDynasty
              ? [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }, { value: "dynasty", label: "Dynasty" }]
              : [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }]}
          />
          <div className="rankings-note">
            {!isSeasonLong && effectivePosition === "DEF"
              ? <span>Actual shown after final</span>
              : !isSeasonLong && effectivePosition === "K"
                ? <span>Rank follows opposing DST, worst first</span>
                : <span>{rows.length} players</span>}
          </div>
          <div className="ranking-list">
            <WindowVirtualList count={visibleRows.length} estimateSize={RANKINGS_ROW_HEIGHT} getKey={(index) => visibleRows[index]?.key ?? index}>
            {(index) => {
              const row = visibleRows[index];
              if (!row) return null;
              const isMine = !availableOnly && myRoster.has(row.key);
              const detail = allPlayerDetailsById.get(row.key) ?? null;
              const isSelected = linkedPlayerId === row.key;
              const accessibleMatchup = isSeasonLong
                ? [
                    row.teamContext?.team ?? "Free agent",
                    row.teamContext?.opponent ? `${row.teamContext.isAway ? "at" : "versus"} ${row.teamContext.opponent}` : row.teamContext?.isBye ? "bye week" : null,
                    row.meta || null,
                  ].filter((value): value is string => Boolean(value)).join(", ")
                : detail
                  ? accessibleMatchupLabel(detail.team, detail.opponent, detail.isAway, detail.isBye)
                  : "no projection";
              const accessibleValue = isSeasonLong
                ? `${Math.round(row.projection ?? 0).toLocaleString()} ${row.projectionLabel}`
                : `${formatProjectionPoints(row.projection, row.projectionSource)} projected points`;
              const rowAccessibleLabel = `View ${row.name}, ${accessibleMatchup}, ${accessibleValue}${row.isRookie && !accessibleMatchup.includes("Rookie") ? ", Rookie" : ""}${row.injuryStatus ? `, injury status ${row.injuryStatus}` : ""}${row.rosterTeamName ? `, rostered by ${row.rosterTeamName}` : ""}${isSelected ? ", selected" : ""}`;
              const content = (
                <>
                  <span className="ranking-player">
                    <span className="ranking-name-line">
                      <strong>{row.name}</strong>
                      {isSelected ? <span className="player-selected-chip">Selected</span> : null}
                      {row.isRookie ? <DesignationBadge code="R" label="Rookie" title="Rookie" tone="positive" /> : null}
                      {row.injuryStatus ? <DesignationBadge code={sleeperInjuryTag(row.injuryStatus)} label={`Injury status: ${row.injuryStatus}`} title={row.injuryStatus} /> : null}
                    </span>
                    <span className="ranking-meta-line">
                      {isSeasonLong ? (
                        <SeasonTeamPill
                          team={row.teamContext?.team ?? null}
                          lineRank={row.teamContext?.team ? offensiveLineRankByTeam.get(canonicalNflTeam(row.teamContext.team) ?? row.teamContext.team) ?? null : null}
                          onOpen={row.teamContext?.team ? () => setSelectedTeam({
                            team: row.teamContext?.team ?? "",
                          }) : undefined}
                        />
                      ) : (
                        <span className="ranking-football-meta matchup-meta-group">
                          <MatchupTag team={detail?.team ?? null} opponent={detail?.opponent ?? null} isAway={detail?.isAway} isBye={detail?.isBye} position={row.position} entry={sosEntry} onClick={detail?.team && detail.opponent && onOpenMatchup ? (event) => { event.stopPropagation(); onOpenMatchup({ team: detail.team ?? "", opponent: detail.opponent ?? "", isAway: detail.isAway, gamePhase: detail.gamePhase ?? null }); } : undefined} />
                        </span>
                      )}
                      {row.rosterTeamName ? (
                        <span className={`roster-owner-tag${row.rosterIsUser ? " is-user" : ""}`} title={row.rosterIsUser ? "Your roster" : `Rostered by ${row.rosterTeamName}`}>
                          {row.rosterTeamName}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="ranking-proj"><strong>{isSeasonLong ? Math.round(row.projection ?? 0).toLocaleString() : formatProjectionPoints(row.projection, row.projectionSource)}</strong>{!isSeasonLong && row.projection === null ? <span>No projection</span> : <span>{row.projectionLabel}</span>}</span>
                </>
              );
              const openPlayer = () => {
                if (!detail) return;
                onOpenLinkedPlayer(detail.playerId);
              };
              return (
                <div
                  className={`ranking-row ranking-row-button${isMine ? " is-my-roster" : ""}${isSelected ? " is-player-selected" : ""}`}
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  onPointerDown={() => detail && prefetchPlayerPanels(detail)}
                  onFocus={() => detail && prefetchPlayerPanels(detail)}
                  onClick={openPlayer}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    openPlayer();
                  }}
                  aria-label={rowAccessibleLabel}
                >
                  {content}
                </div>
              );
            }}
            </WindowVirtualList>
            {rows.length > 0 ? (
              <div className="list-pagination-row">
                <span aria-live="polite">showing {Math.min(visibleRowCount, rows.length)} of {rows.length}</span>
                {visibleRowCount < rows.length ? <button type="button" onClick={() => setVisibleRowCount((count) => count + 120)}>Show more</button> : null}
              </div>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <div className="empty-inline empty-stack">
              {!isSeasonLong && leagueRankings.length === 0 ? (
                <>
                  <strong>{`Week ${dashboard.week} rankings are not in yet`}</strong>
                  <button
                    type="button"
                    className="empty-action-button"
                    onClick={() => publishRankingFilters({ horizon: "ros" })}
                  >
                    Show season ranks
                  </button>
                </>
              ) : (
                <>
                  <strong>{isSeasonLong && !availableOnly ? "No rankings for this format." : availableOnly ? "No available players match this filter." : "No rankings match this filter."}</strong>
                  <span>{isSeasonLong && !availableOnly ? "Choose another league or try Current week." : "Choose another position or league."}</span>
                </>
              )}
            </div>
          ) : null}
        </>
      )}

      {selectedTeam ? (
        <TeamDataModal
          selection={selectedTeam}
          offensiveLine={offensiveLine}
          defense={defense}
          offense={offense}
          teamOverall={teamOverall}
          usage={teamUsageByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          record={teamRecordByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          situational={teamSituationalByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          situationalSource={teamSituational ? { fetchedAt: teamSituational.fetchedAt, sourceUrl: teamSituational.sourceUrl } : null}
          sosEntry={sosEntry}
          loading={pfnTablesQuery.isPending}
          loadError={pfnTablesQuery.isError}
          onRetry={() => { void pfnTablesQuery.refetch(); }}
          onClose={() => setSelectedTeam(null)}
        />
      ) : null}
    </section>
  );
}
