import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { canonicalTeam, fetchText } from "./sleeper.js";

export const TEAM_SITUATIONAL_STATS_URL =
  "https://hindi3.sportskeeda.com/nfl/team-stat/third-down-percentage-leaders?season=2026&type=regular";

export const TEAM_SITUATIONAL_CACHE_KEY = "team-situational-stats-2026";

export const TEAM_SITUATIONAL_MIN_TEAMS = 30;

const NFL_TEAM_NAME_TO_CODE: Record<string, string> = {
  ARIZONACARDINALS: "ARI", CARDINALS: "ARI",
  ATLANTAFALCONS: "ATL", FALCONS: "ATL",
  BALTIMORERAVENS: "BAL", RAVENS: "BAL",
  BUFFALOBILLS: "BUF", BILLS: "BUF",
  CAROLINAPANTHERS: "CAR", PANTHERS: "CAR",
  CHICAGOBEARS: "CHI", BEARS: "CHI",
  CINCINNATIBENGALS: "CIN", BENGALS: "CIN",
  CLEVELANDBROWNS: "CLE", BROWNS: "CLE",
  DALLASCOWBOYS: "DAL", COWBOYS: "DAL",
  DENVERBRONCOS: "DEN", BRONCOS: "DEN",
  DETROITLIONS: "DET", LIONS: "DET",
  GREENBAYPACKERS: "GB", PACKERS: "GB",
  HOUSTONTEXANS: "HOU", TEXANS: "HOU",
  INDIANAPOLISCOLTS: "IND", COLTS: "IND",
  JACKSONVILLEJAGUARS: "JAX", JAGUARS: "JAX",
  KANSASCITYCHIEFS: "KC", CHIEFS: "KC",
  LASVEGASRAIDERS: "LV", RAIDERS: "LV",
  LOSANGELESCHARGERS: "LAC", CHARGERS: "LAC",
  LOSANGELESRAMS: "LAR", RAMS: "LAR",
  MIAMIDOLPHINS: "MIA", DOLPHINS: "MIA",
  MINNESOTAVIKINGS: "MIN", VIKINGS: "MIN",
  NEWENGLANDPATRIOTS: "NE", PATRIOTS: "NE",
  NEWORLEANSSAINTS: "NO", SAINTS: "NO",
  NEWYORKGIANTS: "NYG", GIANTS: "NYG",
  NEWYORKJETS: "NYJ", JETS: "NYJ",
  PHILADELPHIAEAGLES: "PHI", EAGLES: "PHI",
  PITTSBURGHSTEELERS: "PIT", STEELERS: "PIT",
  SANFRANCISCO49ERS: "SF", "49ERS": "SF",
  SEATTLESEAHAWKS: "SEA", SEAHAWKS: "SEA",
  TAMPABAYBUCCANEERS: "TB", BUCCANEERS: "TB",
  TENNESSEETITANS: "TEN", TITANS: "TEN",
  WASHINGTONCOMMANDERS: "WAS", COMMANDERS: "WAS",
};

export const teamSituationalStatSchema = z.object({
  team: z.string(),
  games: z.number().int(),
  thirdDownPct: z.number(),
  redZoneTdPct: z.number(),
});

export const teamSituationalSnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.literal(TEAM_SITUATIONAL_STATS_URL),
  rows: z.array(teamSituationalStatSchema),
});

export type TeamSituationalSnapshot = z.infer<typeof teamSituationalSnapshotSchema>;
export type TeamSituationalStat = z.infer<typeof teamSituationalStatSchema>;

export function sportsTeamCodes(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2,3}$/.test(normalized)) return [canonicalTeam(normalized)];
  const exact = NFL_TEAM_NAME_TO_CODE[normalized];
  if (exact) return [exact];
  return [...new Set(Object.entries(NFL_TEAM_NAME_TO_CODE)
    .filter(([name]) => normalized.includes(name))
    .map(([, code]) => code))];
}

export function htmlCellText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSituationalPercentage(value: string): number | null {
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

/** Parse Sportskeeda third-down leaders HTML. cells[8]=3rd-down %, cells[14]=RZ TD %. */
export function parseTeamSituationalStats(html: string): TeamSituationalStat[] {
  const output = new Map<string, TeamSituationalStat>();
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    if (!rowHtml) continue;
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => htmlCellText(cell[1] ?? ""));
    if (cells.length < 15) continue;
    const [teamName = "", gamesText = ""] = cells;
    const team = sportsTeamCodes(teamName)[0];
    const games = Number(gamesText);
    const thirdDownPct = parseSituationalPercentage(cells[8] ?? "");
    const redZoneTdPct = parseSituationalPercentage(cells[14] ?? "");
    if (!team || !Number.isInteger(games) || games < 0 || thirdDownPct === null || redZoneTdPct === null) continue;
    output.set(team, { team, games, thirdDownPct, redZoneTdPct });
  }
  return [...output.values()].sort((a, b) => a.team.localeCompare(b.team));
}

export async function readTeamSituationalSnapshot(): Promise<TeamSituationalSnapshot | null> {
  const [cached] = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, TEAM_SITUATIONAL_CACHE_KEY))
    .limit(1);
  if (!cached) return null;
  try {
    const parsed = teamSituationalSnapshotSchema.safeParse(JSON.parse(cached.payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type TeamSituationalRefreshResult = {
  ok: true;
  status: "committed" | "kept-previous" | "empty";
  teams: number;
  fetchedAt: string | null;
};

/**
 * Fetch Sportskeeda situational stats and replace the cache when ≥30 teams parse.
 * On failure or a thin table, keep the last valid snapshot.
 */
export async function refreshTeamSituationalSnapshot(): Promise<TeamSituationalRefreshResult> {
  const previous = await readTeamSituationalSnapshot();
  try {
    const rows = parseTeamSituationalStats(await fetchText(TEAM_SITUATIONAL_STATS_URL));
    if (rows.length < TEAM_SITUATIONAL_MIN_TEAMS) {
      return {
        ok: true,
        status: previous ? "kept-previous" : "empty",
        teams: previous?.rows.length ?? 0,
        fetchedAt: previous?.fetchedAt ?? null,
      };
    }
    const snapshot: TeamSituationalSnapshot = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: TEAM_SITUATIONAL_STATS_URL,
      rows,
    };
    await db.insert(schema.sourceCache).values({
      cacheKey: TEAM_SITUATIONAL_CACHE_KEY,
      payload: JSON.stringify(snapshot),
      fetchedAt: new Date(snapshot.fetchedAt),
    }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: JSON.stringify(snapshot), fetchedAt: new Date(snapshot.fetchedAt) },
    });
    return {
      ok: true,
      status: "committed",
      teams: rows.length,
      fetchedAt: snapshot.fetchedAt,
    };
  } catch {
    return {
      ok: true,
      status: previous ? "kept-previous" : "empty",
      teams: previous?.rows.length ?? 0,
      fetchedAt: previous?.fetchedAt ?? null,
    };
  }
}
