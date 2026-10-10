import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { pfnDateLabel, pfnNumber } from "../dashboard-shared";
import { formatDecimal } from "../lib/format-number";

/** Compact NFL team ranks board (PFN Overall) — optional League home if Tables tab goes away. */
export function TeamRanksBoard() {
  const query = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const table = query.data?.tables["team-overall"] ?? null;
  const rows = (table?.rows ?? [])
    .filter((row) => row.team.trim().toLowerCase() !== "team")
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 12);

  return (
    <section className="team-ranks-board" aria-label="NFL team ranks">
      <div className="section-heading">
        <h2>Team ranks</h2>
        <span>{table?.fetched_at ? `PFN · ${pfnDateLabel(table.fetched_at)}` : "PFN Overall"}</span>
      </div>
      {query.isPending ? (
        <p className="monitor-empty">Loading team ranks…</p>
      ) : query.isError ? (
        <p className="monitor-empty">Team ranks didn’t load.</p>
      ) : rows.length === 0 ? (
        <p className="monitor-empty">No team ranks yet.</p>
      ) : (
        <ol className="team-ranks-list">
          {rows.map((row) => {
            const grade = pfnNumber(row, "grade");
            const record = typeof row.record === "string" ? row.record : null;
            return (
              <li key={row.team} className="team-ranks-row">
                <strong className="team-ranks-rank">#{row.rank}</strong>
                <span className="team-ranks-team">
                  <strong>{row.team}</strong>
                  {record ? <span className="team-ranks-record">{record}</span> : null}
                </span>
                <span className="team-ranks-grade">{grade === null ? "—" : formatDecimal(grade, 1)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > 0 ? <p className="team-ranks-note">Top 12 · full 32-team sortable board lives in Explorer Tables today</p> : null}
    </section>
  );
}
