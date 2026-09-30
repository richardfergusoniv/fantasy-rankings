import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

export const Privileged = definePrivilegedContracts({
  readStagedProjections: {
    request: z.object({}),
    response: z.object({ json: z.string() }),
  },
  readStagedMatchupGrades: {
    request: z.object({}),
    response: z.object({ json: z.string() }),
  },
  readStagedPfnTables: {
    request: z.object({}),
    response: z.object({ json: z.string() }),
  },
});

export const PrivilegedHandlers = definePrivilegedHandlers(Privileged, {
  async readStagedProjections() {
    const filePath = join(homedir(), "workspace", "props-aggregator", "data", "staged_for_push.json");
    const json = await readFile(filePath, "utf8");
    return { json };
  },
  async readStagedMatchupGrades() {
    const filePath = join(homedir(), "workspace", "props-aggregator", "data", "staged_matchup_grades.json");
    const json = await readFile(filePath, "utf8");
    return { json };
  },
  async readStagedPfnTables() {
    const filePath = join(homedir(), "workspace", "pfn-pipeline", "data", "staged_pfn_tables.json");
    const json = await readFile(filePath, "utf8");
    return { json };
  },
});
