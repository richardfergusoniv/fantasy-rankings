/**
 * Ordered Overview grid fields for a finished game, keyed by the game
 * log's display-key stats (see sleeperGameLogStats). Pure and dependency
 * free so vitest can cover it without mounting the player card.
 */
const actualComponentFields: Record<string, ReadonlyArray<{ key: string; label: string; isYards?: boolean }>> = {
  QB: [
    { key: "passCmp", label: "Pass cmp" }, { key: "passAtt", label: "Pass att" },
    { key: "passYds", label: "Pass yds", isYards: true }, { key: "passTd", label: "Pass TD" },
    { key: "interceptions", label: "INT" }, { key: "rushAtt", label: "Rush att" },
    { key: "rushYds", label: "Rush yds", isYards: true }, { key: "rushTd", label: "Rush TD" },
  ],
  RB: [
    { key: "rushAtt", label: "Rush att" }, { key: "rushYds", label: "Rush yds", isYards: true },
    { key: "rushTd", label: "Rush TD" }, { key: "targets", label: "Targets" },
    { key: "receptions", label: "Rec" }, { key: "recYds", label: "Rec yds", isYards: true },
    { key: "recTd", label: "Rec TD" },
  ],
  WR: [
    { key: "targets", label: "Targets" }, { key: "receptions", label: "Rec" },
    { key: "recYds", label: "Rec yds", isYards: true }, { key: "recTd", label: "Rec TD" },
    { key: "rushAtt", label: "Rush att" }, { key: "rushYds", label: "Rush yds", isYards: true },
    { key: "rushTd", label: "Rush TD" },
  ],
  TE: [
    { key: "targets", label: "Targets" }, { key: "receptions", label: "Rec" },
    { key: "recYds", label: "Rec yds", isYards: true }, { key: "recTd", label: "Rec TD" },
    { key: "rushAtt", label: "Rush att" }, { key: "rushYds", label: "Rush yds", isYards: true },
    { key: "rushTd", label: "Rush TD" },
  ],
};

export function actualComponentsForGame(position: string, stats: Record<string, number>): Array<{ key: string; label: string; value: number; isYards: boolean }> {
  const fields = actualComponentFields[position];
  if (!fields) return [];
  return fields.map((field) => ({ key: field.key, label: field.label, value: stats[field.key] ?? 0, isYards: field.isYards === true }));
}
