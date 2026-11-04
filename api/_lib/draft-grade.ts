/**
 * Draft grade: how a team's draft compares with the rest of its league, on draft day and today.
 *
 * The FantasyCalc value board stored for the draft's date stands in for ADP: it ranks every
 * player as the market saw them that day. For each pick, the expected value is the draft-day
 * value of the player the market ranked at that pick's place among the players this draft took
 * (so a rookie draft is measured within its rookies, not against the whole dynasty market). A pick's surplus is the
 * player's value minus that expectation, so reaches cost points and steals add them.
 *
 *   Draft day = each player's value on draft day, minus the slot's expectation.
 *   Today     = each player's value today, minus the same expectation, so a pick that looked
 *               good and faded loses points and a reach that has since risen gains them.
 *
 * Each team's surplus is summed and ranked within its league; the rank sets the team's letter.
 *
 * Each of the user's own picks also gets a school grade from the percentage of its slot's value
 * the player was worth (value / expected value): 100% on draft day means he went exactly where
 * the market had him, so Draft day and Today read as report-card scores.
 *
 * The same picks are also replayed on today's values (see draft-strategy.ts): what the user's own
 * strategy would have taken at each pick, and what the best of Zero RB, Hero RB and Robust RB would have.
 *
 * A rookie draft gets no strategy replay: those archetypes describe a startup draft, and a
 * three-to-five-round rookie draft makes nearly every drafter a Zero RB team by construction.
 * Its hindsight is a value replay instead (rookieValueReplay below): at each of the user's picks,
 * the best dynasty value this draft took later, so it was still on the board.
 *
 * Kickers and defenses have no FantasyCalc value and are not scored, and they do not use up a
 * slot: a skill pick's slot is its place among the draft's QB/RB/WR/TE picks. A player with no
 * stored row (outside the stored board) is valued at the board's floor.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import { STRATEGY_LABELS, strategyView, timingLabel, type Plan, type StrategyView } from "./draft-strategy.js";
import { db, schema } from "./db.js";
import { loadNflPlayersMap } from "./nfl-players-cache.js";
import { isRedraftFormatKey, pacificDateKey, resolveFantasyCalcSnapshotFormatKey } from "./player-value-history.js";
import { isNflValueHistoryInSeason } from "./season-week.js";
import { fetchJson, parseNumber, SLEEPER_BASE, type SleeperDraft, type SleeperDraftPick, type SleeperPlayer } from "./sleeper.js";
import { readNflState } from "./user-leagues.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** Best to worst. Evenly spread by rank, so a 10-team league runs A+ through D, one letter per place. */
export const GRADE_LETTERS = ["A+", "A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D"] as const;

/** A board with fewer players than this is treated as missing (a partial or absent snapshot). */
export const MIN_BOARD_PLAYERS = 50;

/** Redraft rows are skipped when unchanged in the offseason, so draft day looks back this far. */
const DRAFT_DAY_WINDOW_DAYS = 120;
/** In season rows are daily, so a player with no row in this long has left the stored board. */
const TODAY_WINDOW_DAYS = 14;

/** Player id → FantasyCalc value, for QB/RB/WR/TE. */
export type ValueBoard = ReadonlyMap<string, number>;

export type GradedPick = { pickNo: number; rosterId: number; playerId: string; position: string; name?: string; team?: string | null };

export type DraftGradeResult = { letter: string; rank: number; of: number };

/** A pick's school grade and the percentage of its slot's value behind it. */
export type PickGrade = { letter: string; percent: number };

export type BetterPick = { playerId: string; name: string; position: string; team: string | null };

/** Who the user's strategy done best, and the best strategy, would have taken at a pick; null when it is the player taken. */
export type BetterPicks = { yours: BetterPick | null; best: BetterPick | null };

export type OwnPickGrade = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  pickNo: number;
  draftDay: PickGrade | null;
  today: PickGrade | null;
  better: BetterPicks;
};

/** A strategy as shown in a column header: "Zero RB" over "Late QB · Late TE". */
export type StrategyLabel = { name: string; timing: string };

/** One strategy's column in the Hindsight comparison. */
export type HindsightPlan = {
  name: string;
  timing: string;
  /** The lineup value it adds over the roster the user drafted, in percent; null when the draft cannot follow it. */
  gap: number | null;
  yours: boolean;
  best: boolean;
  /** The player it would have taken at each of the user's picks (by the actual player's id), only where it differs. */
  swaps: Record<string, BetterPick>;
};

/** The numbers behind the Hindsight tab. */
export type Hindsight = {
  /** Lineup value over the drafted roster, in percent: the best strategy, and the user's own strategy done best. */
  gapToBest: number;
  gapYours: number;
  /** Picks the best strategy would change, out of the user's skill picks. */
  changes: number;
  of: number;
  biggestSwap: { from: string; to: BetterPick; gain: number } | null;
  /** Every strategy, the best first. */
  plans: HindsightPlan[];
};

/** One of the user's rookie picks against the best dynasty value still on the board when it was made. */
export type RookiePickReplay = {
  pickNo: number;
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  /** Today's value of the player taken; the board's floor when he has no stored row. */
  value: number;
  /** The best value still available at that pick, present only when it beats the player taken. */
  best: (BetterPick & { value: number }) | null;
};

/** Hindsight for a rookie draft: best dynasty value against each pick, no strategy archetypes. */
export type RookieHindsight = {
  /** Percent of the taken picks' total value the best-available redo adds. */
  valueGainPct: number;
  /** Picks where a better value was still on the board. */
  changes: number;
  /** The user's skill picks in the draft. */
  of: number;
  biggestMiss: { from: string; to: BetterPick; gain: number } | null;
  picks: RookiePickReplay[];
};

export type DraftGrade = {
  draftId: string;
  /** Null when the value board for the draft's date is missing. */
  draftDay: DraftGradeResult | null;
  /** Null when today's value board is missing. */
  today: DraftGradeResult | null;
  /** The user's own picks in draft order. */
  picks: OwnPickGrade[];
  /** The user's strategy and the best one, as a name and its QB/TE timing; null without today's board. */
  strategies: { yours: StrategyLabel; best: StrategyLabel } | null;
  hindsight: Hindsight | null;
  /** Set instead of strategies and hindsight when the graded draft is a rookie draft. */
  rookieHindsight: RookieHindsight | null;
};

export function gradeLetter(rank: number, teams: number): string {
  if (teams < 2) return GRADE_LETTERS[0];
  const place = Math.min(Math.max(rank, 1), teams);
  const index = Math.round(((place - 1) / (teams - 1)) * (GRADE_LETTERS.length - 1));
  return GRADE_LETTERS[index] ?? GRADE_LETTERS[GRADE_LETTERS.length - 1]!;
}

/** The usual school scale: the lowest percentage that earns each letter. */
const SCHOOL_SCALE: ReadonlyArray<readonly [number, string]> = [
  [97, "A+"], [93, "A"], [90, "A\u2212"],
  [87, "B+"], [83, "B"], [80, "B\u2212"],
  [77, "C+"], [73, "C"], [70, "C\u2212"],
  [67, "D+"], [65, "D"],
];

export function schoolGrade(percent: number): string {
  for (const [minimum, letter] of SCHOOL_SCALE) if (percent >= minimum) return letter;
  return "F";
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 1-based place of a team's total among all totals (higher is better); ties share the better place. */
export function placeOf(totals: ReadonlyMap<number, number>, rosterId: number): number | null {
  const own = totals.get(rosterId);
  if (own === undefined) return null;
  let better = 0;
  for (const total of totals.values()) if (round2(total) > round2(own)) better += 1;
  return better + 1;
}

/** The value of whoever the market ranked at an overall pick, from a board sorted best first. */
export function expectedValue(sortedBoard: readonly number[], pickNo: number): number {
  if (sortedBoard.length === 0) return 0;
  const index = Math.min(Math.max(pickNo, 1), sortedBoard.length) - 1;
  return sortedBoard[index] ?? 0;
}

const sortedValues = (board: ValueBoard) => [...board.values()].sort((a, b) => b - a);
const floorValue = (board: ValueBoard) => (board.size === 0 ? 0 : Math.min(...board.values()));
const isSkill = (position: string) => (SKILL_POSITIONS as readonly string[]).includes(position);

/** Each QB/RB/WR/TE pick's place among the draft's skill picks, which is the market rank it is measured against. */
function slotByPick(picks: readonly GradedPick[]): Map<GradedPick, number> {
  const skill = picks.filter((pick) => isSkill(pick.position)).sort((a, b) => a.pickNo - b.pickNo);
  return new Map(skill.map((pick, index) => [pick, index + 1]));
}

/** Each drafting team's total surplus: `values` for the players, measured against `slotBoard`'s slots. */
export function draftSurplusByTeam(args: {
  picks: readonly GradedPick[];
  slotBoard: ValueBoard;
  values: ValueBoard;
}): Map<number, number> {
  const slots = sortedValues(args.slotBoard);
  const floor = floorValue(args.values);
  const totals = new Map<number, number>();
  for (const pick of args.picks) if (!totals.has(pick.rosterId)) totals.set(pick.rosterId, 0);
  for (const [pick, slot] of slotByPick(args.picks)) {
    const value = args.values.get(pick.playerId) ?? floor;
    totals.set(pick.rosterId, (totals.get(pick.rosterId) ?? 0) + value - expectedValue(slots, slot));
  }
  return totals;
}

/** One team's picks in draft order, each as a school grade from the percentage of its slot's value. */
export function pickGrades(args: {
  picks: readonly GradedPick[];
  rosterId: number;
  slotBoard: ValueBoard;
  values: ValueBoard;
}): Map<string, PickGrade | null> {
  const slots = sortedValues(args.slotBoard);
  const floor = floorValue(args.values);
  const slotOf = slotByPick(args.picks);
  const out = new Map<string, PickGrade | null>();
  for (const pick of [...args.picks].sort((a, b) => a.pickNo - b.pickNo)) {
    if (pick.rosterId !== args.rosterId) continue;
    const slot = slotOf.get(pick);
    const expected = slot === undefined ? 0 : expectedValue(slots, slot);
    if (expected <= 0) { out.set(pick.playerId, null); continue; }
    const percent = ((args.values.get(pick.playerId) ?? floor) / expected) * 100;
    out.set(pick.playerId, { letter: schoolGrade(percent), percent: Math.round(percent) });
  }
  return out;
}

const strategyLabel = (plan: Plan): StrategyLabel => ({ name: STRATEGY_LABELS[plan.rb], timing: timingLabel(plan) });

const roundTo1 = (value: number) => Math.round(value * 10) / 10;

/** The Hindsight comparison from a strategy replay; gaps are percentages of the drafted roster's lineup value. */
function hindsightFrom(view: StrategyView, named: (pick: GradedPick | null | undefined) => BetterPick | null): Hindsight {
  const gap = (value: number) => (view.actualValue > 0 ? roundTo1(((value - view.actualValue) / view.actualValue) * 100) : 0);
  const swapsOf = (picks: ReadonlyMap<string, GradedPick | null>) => Object.fromEntries(
    [...picks].flatMap(([playerId, pick]) => { const swap = named(pick); return swap ? [[playerId, swap] as const] : []; }),
  );
  return {
    gapToBest: gap(view.bestValue),
    gapYours: gap(view.yoursValue),
    changes: [...view.bestPicks.values()].filter((pick) => pick !== null).length,
    of: view.skillPicks,
    biggestSwap: view.biggestSwap && named(view.biggestSwap.to)
      ? { from: view.biggestSwap.from.name ?? "", to: named(view.biggestSwap.to)!, gain: Math.round(view.biggestSwap.gain) }
      : null,
    plans: view.plans.map((outcome) => {
      const label = strategyLabel(outcome.plan);
      return {
        name: label.name,
        timing: label.timing,
        gap: outcome.possible ? gap(outcome.value) : null,
        yours: outcome.plan.rb === view.yours.rb && outcome.plan.qb === view.yours.qb && outcome.plan.te === view.yours.te,
        best: outcome.plan.rb === view.best.rb && outcome.plan.qb === view.best.qb && outcome.plan.te === view.best.te,
        swaps: outcome.possible ? swapsOf(outcome.picks) : {},
      };
    }),
  };
}

/**
 * The rookie-draft redo: walk the user's skill picks in order and, at each one, name the most
 * valuable player this draft took later (so he was still on the board), skipping anyone already
 * named for an earlier pick so the redo never spends the same player twice. No lineup is built
 * and no strategy is followed: the pick is judged on dynasty value alone.
 */
export function rookieValueReplay(args: {
  picks: readonly GradedPick[];
  rosterId: number;
  values: ValueBoard;
}): { hindsight: RookieHindsight; bestByPlayerId: Map<string, GradedPick | null> } {
  const floor = floorValue(args.values);
  const valueOf = (pick: GradedPick) => args.values.get(pick.playerId) ?? floor;
  const drafted = args.picks.filter((pick) => isSkill(pick.position)).sort((a, b) => a.pickNo - b.pickNo);
  const own = drafted.filter((pick) => pick.rosterId === args.rosterId);
  const spent = new Set<string>();
  const bestByPlayerId = new Map<string, GradedPick | null>();
  let takenTotal = 0;
  let redoTotal = 0;
  const rows: RookiePickReplay[] = own.map((pick) => {
    const taken = valueOf(pick);
    takenTotal += taken;
    let best: GradedPick | null = null;
    for (const candidate of drafted) {
      if (candidate.pickNo <= pick.pickNo || spent.has(candidate.playerId)) continue;
      if (best === null || valueOf(candidate) > valueOf(best)) best = candidate;
    }
    const alternative = best !== null && valueOf(best) > taken ? best : null;
    if (alternative) spent.add(alternative.playerId);
    redoTotal += alternative ? valueOf(alternative) : taken;
    bestByPlayerId.set(pick.playerId, alternative);
    return {
      pickNo: pick.pickNo,
      playerId: pick.playerId,
      name: pick.name ?? "",
      position: pick.position,
      team: pick.team ?? null,
      value: taken,
      best: alternative
        ? { playerId: alternative.playerId, name: alternative.name ?? "", position: alternative.position, team: alternative.team ?? null, value: valueOf(alternative) }
        : null,
    };
  });
  let biggestMiss: RookieHindsight["biggestMiss"] = null;
  for (const row of rows) {
    if (!row.best) continue;
    const gain = row.best.value - row.value;
    if (!biggestMiss || gain > biggestMiss.gain) {
      biggestMiss = { from: row.name, to: { playerId: row.best.playerId, name: row.best.name, position: row.best.position, team: row.best.team }, gain: Math.round(gain) };
    }
  }
  return {
    bestByPlayerId,
    hindsight: {
      valueGainPct: takenTotal > 0 ? roundTo1(((redoTotal - takenTotal) / takenTotal) * 100) : 0,
      changes: rows.filter((row) => row.best !== null).length,
      of: rows.length,
      biggestMiss,
      picks: rows,
    },
  };
}

function resultFor(totals: ReadonlyMap<number, number>, ownRosterId: number): DraftGradeResult | null {
  const rank = placeOf(totals, ownRosterId);
  if (rank === null || totals.size < 2) return null;
  return { letter: gradeLetter(rank, totals.size), rank, of: totals.size };
}

export function gradeDraft(args: {
  picks: readonly GradedPick[];
  ownRosterId: number;
  draftDayBoard: ValueBoard;
  todayBoard: ValueBoard;
  /** Teams in the draft, from its settings; a round is this many picks. */
  teams?: number | null;
  /** The league's starting lineup slots, for weighing which strategy builds the best roster. */
  slots?: readonly string[];
  minBoardPlayers?: number;
  /** A rookie draft: hindsight is the value replay, never the strategy replay. */
  rookieDraft?: boolean;
}): { draftDay: DraftGradeResult | null; today: DraftGradeResult | null; picks: OwnPickGrade[]; strategies: DraftGrade["strategies"]; hindsight: DraftGrade["hindsight"]; rookieHindsight: DraftGrade["rookieHindsight"] } {
  const min = args.minBoardPlayers ?? MIN_BOARD_PLAYERS;
  // Today is measured against draft-day slots, so without the draft-day board neither grade exists.
  if (args.draftDayBoard.size < min) return { draftDay: null, today: null, picks: [], strategies: null, hindsight: null, rookieHindsight: null };
  // Slots are measured against the players this draft could have taken, which are the ones it did take.
  // A drafted player with no stored row counts at the board's floor, the same value he is scored at.
  const skillPicks = args.picks.filter((pick) => isSkill(pick.position));
  // With none of them on the board there is nothing to measure slots against.
  if (!skillPicks.some((pick) => args.draftDayBoard.has(pick.playerId))) return { draftDay: null, today: null, picks: [], strategies: null, hindsight: null, rookieHindsight: null };
  const floor = floorValue(args.draftDayBoard);
  const slotBoard: ValueBoard = new Map(skillPicks.map((pick) => [pick.playerId, args.draftDayBoard.get(pick.playerId) ?? floor] as [string, number]));
  const hasToday = args.todayBoard.size >= min;
  const draftDay = resultFor(draftSurplusByTeam({ picks: args.picks, slotBoard, values: args.draftDayBoard }), args.ownRosterId);
  const today = hasToday
    ? resultFor(draftSurplusByTeam({ picks: args.picks, slotBoard, values: args.todayBoard }), args.ownRosterId)
    : null;
  const onDraftDay = pickGrades({ picks: args.picks, rosterId: args.ownRosterId, slotBoard, values: args.draftDayBoard });
  const sinceThen = hasToday ? pickGrades({ picks: args.picks, rosterId: args.ownRosterId, slotBoard, values: args.todayBoard }) : null;
  const pickNoOf = new Map(args.picks.filter((pick) => pick.rosterId === args.ownRosterId).map((pick) => [pick.playerId, pick.pickNo]));
  // The window is one round: the draft's team count, which can exceed the teams still holding picks after trades.
  const teams = args.teams && args.teams > 0 ? args.teams : new Set(args.picks.map((pick) => pick.rosterId)).size;
  const view = hasToday && !args.rookieDraft ? strategyView({ picks: args.picks, rosterId: args.ownRosterId, values: args.todayBoard, teams, slots: args.slots }) : null;
  const rookie = hasToday && args.rookieDraft ? rookieValueReplay({ picks: args.picks, rosterId: args.ownRosterId, values: args.todayBoard }) : null;
  const named = (pick: GradedPick | null | undefined): BetterPick | null => (
    pick ? { playerId: pick.playerId, name: pick.name ?? "", position: pick.position, team: pick.team ?? null } : null
  );
  const takenById = new Map(args.picks.map((pick) => [pick.playerId, pick]));
  const picks = [...onDraftDay].map(([playerId, grade]) => {
    const taken = takenById.get(playerId);
    return {
      playerId,
      name: taken?.name ?? "",
      position: taken?.position ?? "",
      team: taken?.team ?? null,
      pickNo: pickNoOf.get(playerId) ?? 0,
      draftDay: grade,
      today: sinceThen?.get(playerId) ?? null,
      better: { yours: named(view?.yoursPicks.get(playerId)), best: named(view?.bestPicks.get(playerId)) ?? named(rookie?.bestByPlayerId.get(playerId)) },
    };
  });
  return { draftDay, today, picks, strategies: view ? { yours: strategyLabel(view.yours), best: strategyLabel(view.best) } : null, hindsight: view ? hindsightFrom(view, named) : null, rookieHindsight: rookie?.hindsight ?? null };
}

/** `YYYY-MM-DD` moved by whole days (noon UTC keeps it clear of day boundaries). */
export function shiftDateKey(dateKey: string, days: number): string {
  const moved = new Date(`${dateKey}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Each QB/RB/WR/TE's latest stored value on or before `asOfDateKey`, looking back `windowDays`. */
export async function loadValueBoard(formatKey: string, asOfDateKey: string, windowDays: number): Promise<ValueBoard> {
  const table = schema.playerValueSnapshots;
  const rows = await db
    .selectDistinctOn([table.playerId], { playerId: table.playerId, value: table.value })
    .from(table)
    .where(and(
      eq(table.formatKey, formatKey),
      gte(table.snapshotDate, shiftDateKey(asOfDateKey, -windowDays)),
      lte(table.snapshotDate, asOfDateKey),
      inArray(table.position, [...SKILL_POSITIONS]),
    ))
    .orderBy(table.playerId, desc(table.snapshotDate));
  return new Map(rows.map((row) => [row.playerId, row.value]));
}

export type LoadDraftGradeDeps = {
  fetchJson?: <T>(url: string) => Promise<T>;
  loadBoard?: (formatKey: string, asOfDateKey: string, windowDays: number) => Promise<ValueBoard>;
  /** Sleeper `/players/nfl` map; fills pick position/name when draft metadata omits them. */
  loadPlayers?: () => Promise<Record<string, SleeperPlayer>>;
  /** When cache standings omit isUser, resolve the roster from the draft order (Draft Center's rule). */
  sleeperUserId?: string;
  now?: () => Date;
  /** The NFL season phase ("off", "pre", "regular", ...). */
  seasonType?: () => Promise<string>;
  minBoardPlayers?: number;
  /** Grade a specific draft of a dynasty league instead of the current season's. */
  selection?: DraftSelection;
};

/** A draft of the league the Hindsight view can grade, from the chain walk. */
export type AvailableDraft = { kind: "rookie" | "startup"; season: string; draftId: string };

export type DraftSelection = { kind: "rookie" | "startup"; season?: string };

export type LoadDraftGradeResult = { grade: DraftGrade | null; availableDrafts: AvailableDraft[] };

type ChainLeague = {
  leagueId: string;
  season: string | null;
  previousLeagueId: string | null;
  rosterPositions?: string[];
};

/** The league's season chain, newest first, following previous_league_id to the founding season. */
const CHAIN_WALK_BUDGET_MS = 20_000;

async function loadLeagueChain(
  get: <T>(url: string) => Promise<T>,
  startLeagueId: string,
  now: () => Date = () => new Date(),
): Promise<ChainLeague[]> {
  const chain: ChainLeague[] = [];
  const seen = new Set<string>();
  const deadlineMs = now().getTime() + CHAIN_WALK_BUDGET_MS;
  let leagueId: string | null = startLeagueId;
  while (leagueId && !seen.has(leagueId) && chain.length < 12) {
    // The walk is serial and each fetch can take up to the 15s source timeout,
    // so a long chain on a slow day could outrun the function budget. Stop at
    // the deadline and continue with the partial chain instead.
    if (chain.length > 0 && now().getTime() > deadlineMs) break;
    seen.add(leagueId);
    const league: { season?: string; previous_league_id?: string | null; roster_positions?: string[] } | null = await get<{ season?: string; previous_league_id?: string | null; roster_positions?: string[] }>(
      `${SLEEPER_BASE}/league/${leagueId}`,
    ).catch(() => null);
    if (!league || typeof league !== "object") break;
    const previous: string | null = typeof league.previous_league_id === "string" && league.previous_league_id.length > 0 && league.previous_league_id !== "0"
      ? league.previous_league_id
      : null;
    chain.push({ leagueId, season: league.season ?? null, previousLeagueId: previous, rosterPositions: league.roster_positions });
    leagueId = previous;
  }
  return chain;
}

/** One season's completed non-auction drafts with their picks loaded. */
async function loadSeasonDrafts(
  get: <T>(url: string) => Promise<T>,
  leagueId: string,
  players: Record<string, SleeperPlayer> = {},
): Promise<{ loaded: Array<{ draft: SleeperDraft; picks: GradedPick[] }>; hasCompletedAuction: boolean; picksFailed: boolean }> {
  const drafts = await get<SleeperDraft[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`).catch(() => [] as SleeperDraft[]);
  const all = Array.isArray(drafts) ? drafts : [];
  // An auction's presence matters to classification even though it is never
  // graded: auction picks are not made in value order, so a slot has no
  // meaning there.
  const hasCompletedAuction = all.some((draft) => draft.status === "complete" && draft.type === "auction");
  const complete = all.filter((draft) => draft.draft_id && draft.status === "complete" && draft.type !== "auction");
  let picksFailed = false;
  const loaded = await Promise.all(complete.map(async (draft) => {
    // A failed picks load empties only its own draft; the season's other
    // drafts still grade. Callers that classify drafts need picksFailed:
    // an emptied draft cannot be told apart from a small one by pick count.
    const raw = await get<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draft.draft_id}/picks`).catch(() => {
      picksFailed = true;
      return [] as SleeperDraftPick[];
    });
    return { draft, picks: gradedPicks(raw, players) };
  }));
  return { loaded, hasCompletedAuction, picksFailed };
}

/** Position from the Sleeper players dump when draft pick metadata omits it (common on older drafts). */
function pickPosition(player: SleeperPlayer | undefined, metadataPosition: string | undefined): string {
  const raw = player?.position ?? metadataPosition ?? "";
  if (!raw) return "";
  return raw === "DST" ? "DEF" : raw;
}

/** Convert Sleeper draft picks into graded picks; fill gaps from the players map like Draft Center does. */
export function gradedPicks(picks: readonly SleeperDraftPick[], players: Record<string, SleeperPlayer> = {}): GradedPick[] {
  return picks.flatMap((pick) => {
    const rosterId = pick.roster_id;
    const playerId = pick.player_id ?? pick.metadata?.player_id;
    if (typeof pick.pick_no !== "number" || typeof rosterId !== "number" || !playerId) return [];
    const player = players[playerId];
    const name = player?.full_name ?? [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ");
    return [{
      pickNo: pick.pick_no,
      rosterId,
      playerId,
      position: pickPosition(player, pick.metadata?.position),
      name: name || undefined,
      team: player?.team ?? pick.metadata?.team ?? null,
    }];
  });
}

/** Boards, grading, and assembly for one loaded draft. */
async function gradeLoadedDraft(args: {
  loadBoard: (formatKey: string, asOfDateKey: string, windowDays: number) => Promise<ValueBoard>;
  league: { id: string; seasonLongFormat: { key: string; isDynasty?: boolean } };
  ownRosterId: number;
  deps: LoadDraftGradeDeps;
  loaded: { draft: SleeperDraft; picks: GradedPick[] };
  slots: readonly string[] | undefined;
  rookieDraft: boolean;
  /** Grade on today's board when no stored board exists near the draft's date. */
  currentFallback: boolean;
}): Promise<DraftGrade | null> {
  const startedAt = args.loaded.draft.start_time ?? args.loaded.draft.last_picked;
  if (typeof startedAt !== "number") return null;
  const formatKey = resolveFantasyCalcSnapshotFormatKey(args.league.seasonLongFormat.key);
  // In the offseason redraft values that have not changed are not stored again, so today's board looks back as far as draft day's.
  const seasonType = await (args.deps.seasonType ?? (async () => (await readNflState()).seasonType))();
  const todayWindowDays = !isNflValueHistoryInSeason(seasonType) && isRedraftFormatKey(formatKey) ? DRAFT_DAY_WINDOW_DAYS : TODAY_WINDOW_DAYS;
  const [storedDraftDayBoard, todayBoard] = await Promise.all([
    args.loadBoard(formatKey, pacificDateKey(new Date(startedAt)), DRAFT_DAY_WINDOW_DAYS),
    args.loadBoard(formatKey, pacificDateKey(args.deps.now?.() ?? new Date()), todayWindowDays),
  ]);
  // Drafts that predate stored values have no draft-day board. Grade them on
  // today's board: the grade then measures what the picks are worth now. This
  // applies to the default path too, so a draft whose stored history was never
  // backfilled still grades instead of returning null.
  const min = args.deps.minBoardPlayers ?? MIN_BOARD_PLAYERS;
  const boardUsable = (board: ValueBoard) =>
    board.size >= min && args.loaded.picks.some((pick) => isSkill(pick.position) && board.has(pick.playerId));
  const draftDayBoard = args.currentFallback && !boardUsable(storedDraftDayBoard) && todayBoard.size >= min
    ? todayBoard
    : storedDraftDayBoard;
  const grades = gradeDraft({
    picks: args.loaded.picks,
    ownRosterId: args.ownRosterId,
    draftDayBoard,
    todayBoard,
    teams: args.loaded.draft.settings?.teams,
    slots: args.slots,
    minBoardPlayers: args.deps.minBoardPlayers,
    rookieDraft: args.rookieDraft,
  });
  if (!grades.draftDay && !grades.today) return null;
  return { draftId: args.loaded.draft.draft_id ?? "", ...grades };
}

/** The selection path: walk the season chain, classify each season's draft, grade the chosen one. */
async function loadSelectedDraftGrade(
  get: <T>(url: string) => Promise<T>,
  loadBoard: (formatKey: string, asOfDateKey: string, windowDays: number) => Promise<ValueBoard>,
  league: { id: string; seasonLongFormat: { key: string; isDynasty?: boolean } },
  deps: LoadDraftGradeDeps,
  players: Record<string, SleeperPlayer>,
  rosterFor: (draft: SleeperDraft) => number | null,
): Promise<LoadDraftGradeResult | null> {
  const selection = deps.selection;
  if (!selection) return null;
  const chain = await loadLeagueChain(get, league.id, deps.now);
  if (chain.length === 0) return null;
  // The founding season's biggest draft is the startup; every other season's
  // biggest is a rookie draft. A chain that stops early (a league fetch failed,
  // a cycle, the cap) never proved its last season is the founding one, so it
  // offers no startup.
  const reachedRoot = chain[chain.length - 1]?.previousLeagueId === null;
  const available = (await Promise.all(chain.map(async (entry, index) => {
    const seasonDrafts = await loadSeasonDrafts(get, entry.leagueId, players).catch(() => ({ loaded: [] as Array<{ draft: SleeperDraft; picks: GradedPick[] }>, hasCompletedAuction: false, picksFailed: false }));
    const ranked = seasonDrafts.loaded.filter((row) => row.picks.length > 0).sort((a, b) => b.picks.length - a.picks.length);
    const primary = ranked[0];
    if (!primary) return [];
    const isFoundingSeason = reachedRoot && index === chain.length - 1;
    // When a founding draft's picks failed to load, which of the season's
    // drafts is the startup cannot be told safely; offer none of them rather
    // than hand the label to the wrong draft.
    if (isFoundingSeason && seasonDrafts.picksFailed) return [];
    // A completed auction in the founding season was the startup: it is never
    // graded, and the season's snake drafts are its rookie drafts.
    const isStartupSeason = isFoundingSeason && !seasonDrafts.hasCompletedAuction;
    const season = entry.season ?? primary.draft.season ?? "";
    const rows: Array<{ entry: ChainLeague; kind: "rookie" | "startup"; loaded: { draft: SleeperDraft; picks: GradedPick[] }; season: string }> = [
      { entry, kind: isStartupSeason ? "startup" : "rookie", loaded: primary, season },
    ];
    // A founding season can hold a separate rookie draft next to its startup.
    if (isStartupSeason && ranked[1]) rows.push({ entry, kind: "rookie", loaded: ranked[1], season });
    return rows;
  }))).flat();
  // The picker sends a season back as a 4-digit year; a draft whose season
  // cannot be named that way stays gradeable by kind but is not listed.
  const availableDrafts: AvailableDraft[] = available
    .filter((row) => /^\d{4}$/.test(row.season))
    .map((row) => ({
      kind: row.kind,
      season: row.season,
      draftId: row.loaded.draft.draft_id ?? "",
    }));
  const chosen = selection.kind === "startup"
    ? available.find((row) => row.kind === "startup")
    : (selection.season
      ? available.find((row) => row.kind === "rookie" && row.season === selection.season)
      : undefined) ?? available.find((row) => row.kind === "rookie");
  if (!chosen) return { grade: null, availableDrafts };
  const ownRosterId = rosterFor(chosen.loaded.draft);
  if (ownRosterId === null) return { grade: null, availableDrafts };
  const grade = await gradeLoadedDraft({
    loadBoard,
    league,
    ownRosterId,
    deps,
    loaded: chosen.loaded,
    slots: chosen.entry.rosterPositions,
    rookieDraft: chosen.kind === "rookie",
    currentFallback: true,
  });
  return { grade, availableDrafts };
}

/**
 * The signed-in team's roster id from cached league rows. Prefer standings; fall back to
 * power / trade teams so a missing league-section standings row does not blank grades while
 * My Team (draft-center) still lists picks.
 */
export function ownRosterIdFromLeague(league: {
  standings?: ReadonlyArray<{ isUser: boolean; rosterId: number }> | null;
  powerRankingsWeek?: ReadonlyArray<{ isUser: boolean; rosterId: number }>;
  powerRankingsSeasonLong?: ReadonlyArray<{ isUser: boolean; rosterId: number }>;
  powerRankingsDynasty?: ReadonlyArray<{ isUser: boolean; rosterId: number }>;
  tradeTeams?: ReadonlyArray<{ isUser: boolean; rosterId: number }>;
}): number | null {
  const from = (rows: ReadonlyArray<{ isUser: boolean; rosterId: number }> | null | undefined) =>
    rows?.find((row) => row.isUser)?.rosterId ?? null;
  return from(league.standings)
    ?? from(league.powerRankingsWeek)
    ?? from(league.powerRankingsSeasonLong)
    ?? from(league.powerRankingsDynasty)
    ?? from(league.tradeTeams);
}

/** Same mapping Draft Center uses: Sleeper user → draft slot → roster id. */
export function ownRosterIdFromDraft(draft: SleeperDraft, sleeperUserId: string): number | null {
  const slot = parseNumber(draft.draft_order?.[sleeperUserId]);
  if (slot === null) return null;
  return parseNumber(draft.slot_to_roster_id?.[String(slot)]);
}

/** Grades the league's completed draft for one team; null when there is nothing to grade. */
export async function loadDraftGrade(
  league: { id: string; seasonLongFormat: { key: string; isDynasty?: boolean } },
  ownRosterId: number | null,
  deps: LoadDraftGradeDeps = {},
): Promise<LoadDraftGradeResult> {
  const get = deps.fetchJson ?? fetchJson;
  const loadBoard = deps.loadBoard ?? loadValueBoard;
  // Draft pick metadata often omits position; the players dump fills it the same way Draft Center does.
  const players = await (deps.loadPlayers ?? (() => loadNflPlayersMap(false)))().catch(() => ({} as Record<string, SleeperPlayer>));
  const rosterFor = (draft: SleeperDraft) =>
    ownRosterId ?? (deps.sleeperUserId ? ownRosterIdFromDraft(draft, deps.sleeperUserId) : null);
  if (deps.selection && league.seasonLongFormat.isDynasty === true) {
    const selected = await loadSelectedDraftGrade(get, loadBoard, league, deps, players, rosterFor);
    // A selection whose chain cannot load grades nothing; falling back to the
    // current season's draft would show it under the wrong tab.
    return selected ?? { grade: null, availableDrafts: [] };
  }
  const { loaded } = await loadSeasonDrafts(get, league.id, players);
  // A dynasty league can hold a startup and a rookie draft in one season: grade the bigger one.
  const best = [...loaded].sort((a, b) => b.picks.length - a.picks.length)[0];
  if (!best || best.picks.length === 0) return { grade: null, availableDrafts: [] };
  const resolvedRosterId = rosterFor(best.draft);
  if (resolvedRosterId === null) return { grade: null, availableDrafts: [] };
  const sleeperLeague = await get<{ roster_positions?: string[]; previous_league_id?: string | null }>(`${SLEEPER_BASE}/league/${league.id}`).catch(() => null);
  // The Draft Center's test for what kind of draft a dynasty league held: an established
  // dynasty (a previous league exists) drafts rookies; a first-year dynasty drafts a startup.
  const rookieDraft = league.seasonLongFormat.isDynasty === true
    && typeof sleeperLeague?.previous_league_id === "string"
    && sleeperLeague.previous_league_id.length > 0
    && sleeperLeague.previous_league_id !== "0";
  const grade = await gradeLoadedDraft({
    loadBoard,
    league,
    ownRosterId: resolvedRosterId,
    deps,
    loaded: best,
    slots: sleeperLeague?.roster_positions,
    rookieDraft,
    currentFallback: true,
  });
  return { grade, availableDrafts: [] };
}

const querySchema = z.object({
  leagueId: z.string().min(1),
  kind: z.enum(["rookie", "startup"]).optional(),
  season: z.string().regex(/^\d{4}$/).optional(),
});

/** GET /api/data/draft-grade?leagueId= */
export async function handleDraftGrade(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({
      leagueId: url.searchParams.get("leagueId") ?? "",
      kind: url.searchParams.get("kind") ?? undefined,
      season: url.searchParams.get("season") ?? undefined,
    });
    if (!parsed.success) return badRequest("Invalid query params.", parsed.error.issues);

    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");
    if (!(await viewerBelongsToLeague(sleeperUserId, parsed.data.leagueId))) {
      return forbidden("League is not in your Sleeper account.");
    }
    const cached = await readUserDashboardCache(sleeperUserId);
    const league = cached?.dashboard.leagues.find((item) => item.id === parsed.data.leagueId);
    if (!cached || !league) return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);

    // Prefer cached isUser rows; if standings are empty, loadDraftGrade still
    // resolves the roster from the Sleeper draft order (same as Draft Center).
    const ownRosterId = ownRosterIdFromLeague(league);
    const result = await loadDraftGrade(league, ownRosterId, {
      selection: parsed.data.kind ? { kind: parsed.data.kind, season: parsed.data.season } : undefined,
      sleeperUserId,
    });
    return json({ grade: result.grade, availableDrafts: result.availableDrafts });
  } catch (err) {
    return internalError(err);
  }
}

export type DraftGradeResponse = { grade: DraftGrade | null; availableDrafts: AvailableDraft[] };
