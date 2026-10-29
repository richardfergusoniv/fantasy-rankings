/** Display helpers for the Projected standings table. */
export function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}
