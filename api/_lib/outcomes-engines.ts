/**
 * Engine registry for League Outcomes. To ship a new engine, implement
 * `OutcomesEngine` (league-outcomes-contract.ts), register it here, and flip
 * DEFAULT_OUTCOMES_ENGINE (or set OUTCOMES_ENGINE in the environment to
 * trial it without a deploy of code changes).
 */
import type { OutcomeEngineId, OutcomesEngine } from "./league-outcomes-contract.js";
import { paceEngine } from "./outcomes-engine-pace.js";

export const DEFAULT_OUTCOMES_ENGINE: OutcomeEngineId = "pace-v1";

const ENGINES: Partial<Record<OutcomeEngineId, OutcomesEngine>> = {
  "pace-v1": paceEngine,
};

export function resolveOutcomesEngine(requested: string | undefined = process.env.OUTCOMES_ENGINE): OutcomesEngine {
  const wanted = (requested?.trim() || DEFAULT_OUTCOMES_ENGINE) as OutcomeEngineId;
  return ENGINES[wanted] ?? ENGINES[DEFAULT_OUTCOMES_ENGINE]!;
}
