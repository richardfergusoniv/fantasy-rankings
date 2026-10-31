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
 * Kickers and defenses have no FantasyCalc value and are not scored, and they do not use up a
 * slot: a skill pick's slot is its place among the draft's QB/RB/WR/TE picks. A player with no
 * stored row (outside the stored board) is valued at the board's floor.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import { STRATEGY_LABELS, strategyView } from "./draft-strategy.js";
import { db, schema } from "./db.js";
import { isRedraftFormatKey, pacificDateKey, resolveFantasyCalcSnapshotFormatKey } from "./player-value-history.js";
import { isNflValueHistoryInSeason } from "./season-week.js";
import { fetchJson, SLEEPER_BASE, type SleeperDraft, type SleeperDraftPick } from "./sleeper.js";
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
  pickNo: number;
  draftDay: PickGrade | null;
  today: PickGrade | null;
  better: BetterPicks;
};

export type DraftGrade = {
  draftId: string;
  /** Null when the value board for the draft's date is missing. */
  draftDay: DraftGradeResult | null;
  /** Null when today's value board is missing. */
  today: DraftGradeResult | null;
  /** The user's own picks in draft order. */
  picks: OwnPickGrade[];
  /** Labels of the user's strategy and the best one; null without today's board. */
  strategies: { yours: string; best: string } | null;
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
}): { draftDay: DraftGradeResult | null; today: DraftGradeResult | null; picks: OwnPickGrade[]; strategies: DraftGrade["strategies"] } {
  const min = args.minBoardPlayers ?? MIN_BOARD_PLAYERS;
  // Today is measured against draft-day slots, so without the draft-day board neither grade exists.
  if (args.draftDayBoard.size < min) return { draftDay: null, today: null, picks: [], strategies: null };
  // Slots are measured against the players this draft could have taken, which are the ones it did take.
  // A drafted player with no stored row counts at the board's floor, the same value he is scored at.
  const skillPicks = args.picks.filter((pick) => isSkill(pick.position));
  // With none of them on the board there is nothing to measure slots against.
  if (!skillPicks.some((pick) => args.draftDayBoard.has(pick.playerId))) return { draftDay: null, today: null, picks: [], strategies: null };
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
  const view = hasToday ? strategyView({ picks: args.picks, rosterId: args.ownRosterId, values: args.todayBoard, teams, slots: args.slots }) : null;
  const named = (pick: GradedPick | null | undefined): BetterPick | null => (
    pick ? { playerId: pick.playerId, name: pick.name ?? "", position: pick.position, team: pick.team ?? null } : null
  );
  const picks = [...onDraftDay].map(([playerId, grade]) => ({
    playerId,
    pickNo: pickNoOf.get(playerId) ?? 0,
    draftDay: grade,
    today: sinceThen?.get(playerId) ?? null,
    better: { yours: named(view?.yoursPicks.get(playerId)), best: named(view?.bestPicks.get(playerId)) },
  }));
  return { draftDay, today, picks, strategies: view ? { yours: STRATEGY_LABELS[view.yours], best: STRATEGY_LABELS[view.best] } : null };
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
  now?: () => Date;
  /** The NFL season phase ("off", "pre", "regular", ...). */
  seasonType?: () => Promise<string>;
  minBoardPlayers?: number;
};

function gradedPicks(picks: readonly SleeperDraftPick[]): GradedPick[] {
  return picks.flatMap((pick) => {
    const rosterId = pick.roster_id;
    const playerId = pick.player_id ?? pick.metadata?.player_id;
    if (typeof pick.pick_no !== "number" || typeof rosterId !== "number" || !playerId) return [];
    const name = [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ");
    return [{ pickNo: pick.pick_no, rosterId, playerId, position: pick.metadata?.position ?? "", name: name || undefined, team: pick.metadata?.team ?? null }];
  });
}

/** Grades the league's completed draft for one team; null when there is nothing to grade. */
export async function loadDraftGrade(
  league: { id: string; seasonLongFormat: { key: string } },
  ownRosterId: number,
  deps: LoadDraftGradeDeps = {},
): Promise<DraftGrade | null> {
  const get = deps.fetchJson ?? fetchJson;
  const loadBoard = deps.loadBoard ?? loadValueBoard;
  const drafts = await get<SleeperDraft[]>(`${SLEEPER_BASE}/league/${league.id}/drafts`);
  // Auction picks are not made in value order, so a slot has no meaning there.
  const complete = (Array.isArray(drafts) ? drafts : []).filter((draft) => draft.draft_id && draft.status === "complete" && draft.type !== "auction");
  if (complete.length === 0) return null;

  const loaded = await Promise.all(complete.map(async (draft) => ({
    draft,
    picks: gradedPicks(await get<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draft.draft_id}/picks`)),
  })));
  // A dynasty league can hold a startup and a rookie draft in one season: grade the bigger one.
  const best = loaded.sort((a, b) => b.picks.length - a.picks.length)[0];
  if (!best || best.picks.length === 0) return null;

  const startedAt = best.draft.start_time ?? best.draft.last_picked;
  if (typeof startedAt !== "number") return null;
  const formatKey = resolveFantasyCalcSnapshotFormatKey(league.seasonLongFormat.key);
  // In the offseason redraft values that have not changed are not stored again, so today's board looks back as far as draft day's.
  const seasonType = await (deps.seasonType ?? (async () => (await readNflState()).seasonType))();
  const todayWindowDays = !isNflValueHistoryInSeason(seasonType) && isRedraftFormatKey(formatKey) ? DRAFT_DAY_WINDOW_DAYS : TODAY_WINDOW_DAYS;
  const [draftDayBoard, todayBoard] = await Promise.all([
    loadBoard(formatKey, pacificDateKey(new Date(startedAt)), DRAFT_DAY_WINDOW_DAYS),
    loadBoard(formatKey, pacificDateKey(deps.now?.() ?? new Date()), todayWindowDays),
  ]);
  const slots = (await get<{ roster_positions?: string[] }>(`${SLEEPER_BASE}/league/${league.id}`).catch(() => null))?.roster_positions;
  const grades = gradeDraft({ picks: best.picks, ownRosterId, draftDayBoard, todayBoard, teams: best.draft.settings?.teams, slots, minBoardPlayers: deps.minBoardPlayers });
  if (!grades.draftDay && !grades.today) return null;
  return { draftId: best.draft.draft_id ?? "", ...grades };
}

const querySchema = z.object({ leagueId: z.string().min(1) });

/** GET /api/data/draft-grade?leagueId= */
export async function handleDraftGrade(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({ leagueId: url.searchParams.get("leagueId") ?? "" });
    if (!parsed.success) return badRequest("Invalid query params.", parsed.error.issues);

    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");
    if (!(await viewerBelongsToLeague(sleeperUserId, parsed.data.leagueId))) {
      return forbidden("League is not in your Sleeper account.");
    }
    const cached = await readUserDashboardCache(sleeperUserId);
    const league = cached?.dashboard.leagues.find((item) => item.id === parsed.data.leagueId);
    if (!cached || !league) return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);

    const ownRosterId = (league.standings ?? []).find((row) => row.isUser)?.rosterId ?? null;
    if (ownRosterId === null) return json({ grade: null });
    return json({ grade: await loadDraftGrade(league, ownRosterId) });
  } catch (err) {
    return internalError(err);
  }
}

export type DraftGradeResponse = { grade: DraftGrade | null };
