/**
 * League Outcomes contract: the response shape for the Outcomes tab
 * (`GET /api/data/league-outcomes`) and the chat `get_playoff_odds` tool, plus
 * the interface an odds engine implements.
 *
 * Engines are swappable. `pace-v1` (outcomes-engine-pace.ts) ships today;
 * `projection-v1` is specified in docs/OUTCOMES-ENGINE-HANDOFF.md. UI, API
 * handler and chat tools depend only on this file, never on an engine.
 */
import { z } from "zod";
import type { Dashboard } from "./dashboard-schemas.js";

export const OUTCOME_ENGINE_IDS = ["pace-v1", "projection-v1"] as const;
export const outcomeEngineIdSchema = z.enum(OUTCOME_ENGINE_IDS);
export type OutcomeEngineId = z.infer<typeof outcomeEngineIdSchema>;

/** Percentages are on a 0-100 scale, rounded as noted per field. */
export const winScenarioSchema = z.object({
  finalWins: z.number(),
  /** Chance the user finishes with exactly this many wins (0.1 precision). */
  probability: z.number(),
  /** Chance of making the playoffs given that win total. */
  playoffPct: z.number(),
});

export const outcomeTeamSchema = z.object({
  rosterId: z.number().int(),
  teamName: z.string(),
  isUser: z.boolean(),
  record: z.string(),
  projectedWins: z.number(),
  /** 0.1 precision. */
  playoffPct: z.number(),
  topSeedPct: z.number(),
  /** 0.01 precision: last-place odds for strong teams are tiny but not zero. */
  lastPct: z.number(),
  /** Same measures for the comparison point; null when there is none. */
  previousPlayoffPct: z.number().nullable(),
  previousLastPct: z.number().nullable(),
  /** Expected points per week the engine assumed for this team; null if not applicable. */
  weeklyStrength: z.number().nullable(),
});

export const outcomeGameSchema = z.object({
  week: z.number().int(),
  opponentRosterId: z.number().int(),
  opponentName: z.string(),
  opponentRecord: z.string().nullable(),
  /** Chance the user wins this game, 0-100 (0.1 precision). */
  winProbability: z.number(),
  /** Engine's expected points for the user / opponent that week; null if not applicable. */
  projectedFor: z.number().nullable(),
  projectedAgainst: z.number().nullable(),
});

export const leagueOutcomesSchema = z.object({
  leagueId: z.string(),
  /** Completed regular-season weeks counted in the standings. */
  throughWeek: z.number().int(),
  /** Week the comparison is "after"; null when there is no comparison. */
  previousWeek: z.number().int().nullable(),
  /**
   * "snapshot": odds stored by an earlier run (reflects roster moves and
   * refreshed inputs). "rewound": rebuilt by undoing the last finished week
   * (reflects results only). null: no comparison.
   */
  previousSource: z.enum(["snapshot", "rewound"]).nullable(),
  /** When the comparison snapshot was computed; null unless previousSource is "snapshot". */
  previousAsOf: z.string().nullable(),
  playoffTeams: z.number().int(),
  regularSeasonEndsWeek: z.number().int(),
  trials: z.number().int(),
  divisionsIgnored: z.boolean(),
  /** Weeks whose schedule or projections failed to load; their games are left out or degraded. */
  missingWeeks: z.array(z.number().int()),
  method: z.object({
    engine: outcomeEngineIdSchema,
    /** Short name shown in the UI footnote, e.g. "Scoring pace to date". */
    label: z.string(),
    /** ISO time of the freshest input (projections), or null. */
    inputsAsOf: z.string().nullable(),
    /** Plain-language caveats for the UI footnote and the chat model. */
    notes: z.array(z.string()),
  }),
  /** Sorted by playoffPct, descending. */
  teams: z.array(outcomeTeamSchema),
  /** What the user's final win total means for the playoffs. Empty if the user has no team. */
  userScenarios: z.array(winScenarioSchema),
  /** The user's remaining games, in week order. Empty if the user has no team. */
  userSchedule: z.array(outcomeGameSchema),
});

export type WinScenario = z.infer<typeof winScenarioSchema>;
export type OutcomeTeam = z.infer<typeof outcomeTeamSchema>;
export type OutcomeGame = z.infer<typeof outcomeGameSchema>;
export type LeagueOutcomes = z.infer<typeof leagueOutcomesSchema>;

export type SleeperMatchupRow = { roster_id: number; matchup_id?: number | null; points?: number };
export type FetchWeek = (leagueId: string, week: number) => Promise<SleeperMatchupRow[]>;

export type OutcomesEngineInput = {
  league: Dashboard["leagues"][number];
  /** NFL season and the dashboard's current week. */
  season: number;
  week: number;
  /** Injectable for tests; defaults to Sleeper's matchups endpoint. */
  fetchWeek?: FetchWeek;
  now?: Date;
};

export type OutcomesEngine = {
  id: OutcomeEngineId;
  /** Never throws for expected conditions (missing standings, schedule down); returns `{ error }`. */
  run(input: OutcomesEngineInput): Promise<LeagueOutcomes | { error: string }>;
};
