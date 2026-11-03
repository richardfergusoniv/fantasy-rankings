import { useEffect, useState } from "react";
import type { BetterPick, RookiePickReplay } from "../../../api/_lib/draft-grade";
import { SegmentedControl } from "../shared";
import { useDraftGrade } from "./draft-grade-card";
import { HindsightCard, HindsightSheet, RookieHindsightCard, timingText } from "./hindsight-card";

export type BetterPicksPlayer = { playerId: string; name: string; secondary: string | null };

function BetterCell({ label, better, secondaryOf, onOpenPlayer }: {
  label: string;
  better: BetterPick | null;
  secondaryOf: (position: string, team: string | null) => string | null;
  onOpenPlayer: (playerId: string) => void;
}) {
  if (!better) return <div className="draft-better-cell"><span className="sr-only">{label}: no better pick</span><span aria-hidden="true">—</span></div>;
  const secondary = secondaryOf(better.position, better.team);
  return (
    <div className="draft-better-cell">
      <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(better.playerId)} aria-label={`${label}: view ${better.name} details and news`}>
        <strong>{better.name}</strong>
        {secondary ? <small>{secondary}</small> : null}
      </button>
    </div>
  );
}

function RookieBestCell({ row, secondaryOf, onOpenPlayer }: {
  row: RookiePickReplay;
  secondaryOf: (position: string, team: string | null) => string | null;
  onOpenPlayer: (playerId: string) => void;
}) {
  const best = row.best;
  if (!best) return <div className="draft-better-cell"><span className="sr-only">Best available: no better value was still on the board</span><span aria-hidden="true">—</span></div>;
  const secondary = secondaryOf(best.position, best.team);
  return (
    <div className="draft-better-cell">
      <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(best.playerId)} aria-label={`Best available: view ${best.name} details and news`}>
        <strong>{best.name}</strong>
        <small>{[secondary, `+${(best.value - row.value).toLocaleString()}`].filter(Boolean).join(" · ")}</small>
      </button>
    </div>
  );
}

/** Once the draft is final: at each of the team's picks, who the user's strategy and the best strategy would have taken, on today's values. */
export function DraftBetterPicks({ leagueId, players, secondaryOf, onOpenPlayer, dynasty = false }: {
  leagueId: string;
  players: readonly BetterPicksPlayer[];
  secondaryOf: (position: string, team: string | null) => string | null;
  onOpenPlayer: (playerId: string) => void;
  /** Dynasty leagues split Hindsight into the rookie drafts and the startup draft. */
  dynasty?: boolean;
}) {
  const [kind, setKind] = useState<"rookie" | "startup">("rookie");
  const [season, setSeason] = useState<string | undefined>(undefined);
  const selection = dynasty ? { kind, season: kind === "rookie" ? season : undefined } : undefined;
  const query = useDraftGrade(leagueId, selection);
  const [sheetOpen, setSheetOpen] = useState(false);
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const available = query.data?.availableDrafts ?? [];
  const rookieDrafts = available.filter((draft) => draft.kind === "rookie");
  const hasStartup = available.some((draft) => draft.kind === "startup");
  // A first-year dynasty has no rookie draft yet, and an established one may be
  // viewed before this year's: land on whichever kind the league actually has.
  useEffect(() => {
    if (!dynasty || query.isPending || available.length === 0) return;
    if (kind === "rookie" && rookieDrafts.length === 0 && hasStartup) setKind("startup");
    else if (kind === "startup" && !hasStartup && rookieDrafts.length > 0) setKind("rookie");
    else if (season !== undefined && !rookieDrafts.some((draft) => draft.season === season)) setSeason(undefined);
  }, [dynasty, query.isPending, available, kind, rookieDrafts, hasStartup, season]);
  const strategies = query.data?.grade?.strategies ?? null;
  // Kickers and defenses have no value to compare, so they carry no grade and are left out.
  // Older drafts are not in the local pick list, so their rows resolve names from the grade itself.
  const entries = strategies ? (query.data?.grade?.picks ?? []).filter((entry) => (byId.has(entry.playerId) || entry.name !== "") && (entry.draftDay !== null || entry.today !== null)) : [];
  const gradePickById = new Map((query.data?.grade?.picks ?? []).map((entry) => [entry.playerId, entry]));
  const nameOf = (playerId: string) => {
    const local = byId.get(playerId);
    if (local) return local;
    const graded = gradePickById.get(playerId);
    return graded && graded.name !== "" ? { playerId, name: graded.name, secondary: secondaryOf(graded.position, graded.team) } : undefined;
  };
  // When the user's strategy is already the best one, a single column says so.
  const sameStrategy = strategies?.yours.name === strategies?.best.name && strategies?.yours.timing === strategies?.best.timing;

  const hindsight = query.data?.grade?.hindsight ?? null;
  const rookie = query.data?.grade?.rookieHindsight ?? null;

  return (
    <section className="draft-my-team">
      {dynasty && ((rookieDrafts.length > 0 && hasStartup) || rookieDrafts.length > 1) ? (
        <div className="draft-hindsight-tabs">
          {rookieDrafts.length > 0 && hasStartup ? (
            <SegmentedControl
              value={kind}
              onChange={(next) => setKind(next)}
              label="Draft kind"
              options={[
                { value: "rookie" as const, label: "Rookie" },
                { value: "startup" as const, label: "Startup" },
              ]}
            />
          ) : null}
          {kind === "rookie" && rookieDrafts.length > 1 ? (
            <SegmentedControl
              value={season ?? rookieDrafts[0]!.season}
              onChange={(next) => setSeason(next)}
              label="Rookie draft season"
              options={rookieDrafts.map((draft) => ({ value: draft.season, label: draft.season }))}
            />
          ) : null}
        </div>
      ) : null}
      {rookie ? (
        <RookieHindsightCard rookie={rookie} />
      ) : hindsight && entries.length > 0 ? (
        <>
          <HindsightCard hindsight={hindsight} onOpen={() => setSheetOpen(true)} />
          <HindsightSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            hindsight={hindsight}
            entries={entries}
            nameOf={nameOf}
            secondaryOf={secondaryOf}
          />
        </>
      ) : null}
      {rookie ? (
        <div className="draft-board data-table-frame" role="list" aria-label="Hindsight by best available value">
          <div className="draft-row draft-table-head draft-better-row is-two-col" aria-hidden="true">
            <span>Your pick</span>
            <span><b>Best available</b></span>
          </div>
          {rookie.picks.map((row) => (
            <div className="draft-row draft-better-row is-two-col" role="listitem" key={row.playerId}>
              <div className="draft-better-cell">
                <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(row.playerId)} aria-label={`Pick ${row.pickNo}: view ${row.name} details and news`}>
                  <strong>{row.name}</strong>
                  <small>{[`Pick ${row.pickNo}`, secondaryOf(row.position, row.team)].filter(Boolean).join(" · ")}</small>
                </button>
              </div>
              <RookieBestCell row={row} secondaryOf={secondaryOf} onOpenPlayer={onOpenPlayer} />
            </div>
          ))}
        </div>
      ) : entries.length > 0 ? (
        <div className="draft-board data-table-frame" role="list" aria-label="Hindsight by strategy">
          <div className="draft-row draft-table-head draft-better-row" aria-hidden="true">
            <span>Your pick</span>
            <span><b>{strategies?.yours.name}</b>{timingText(strategies?.yours.timing ?? "")}</span>
            {sameStrategy ? null : <span><b>{strategies?.best.name}</b>{timingText(strategies?.best.timing ?? "")}</span>}
          </div>
          {entries.map((entry) => {
            const player = byId.get(entry.playerId);
            const displayName = player?.name ?? entry.name;
            const displaySecondary = player?.secondary ?? secondaryOf(entry.position, entry.team);
            return (
              <div className="draft-row draft-better-row" role="listitem" key={entry.playerId}>
                <div className="draft-better-cell">
                  <button type="button" className="draft-better-open" onClick={() => onOpenPlayer(entry.playerId)} aria-label={`Pick ${entry.pickNo}: view ${displayName || "player"} details and news`}>
                    <strong>{displayName}</strong>
                    <small>{[`Pick ${entry.pickNo}`, displaySecondary].filter(Boolean).join(" · ")}</small>
                  </button>
                </div>
                <BetterCell label={strategies?.yours.name ?? "Your strategy"} better={entry.better.yours} secondaryOf={secondaryOf} onOpenPlayer={onOpenPlayer} />
                {sameStrategy ? null : <BetterCell label={strategies?.best.name ?? "Best strategy"} better={entry.better.best} secondaryOf={secondaryOf} onOpenPlayer={onOpenPlayer} />}
              </div>
            );
          })}
        </div>
      ) : <div className="empty-inline compact">{query.isPending ? "Loading…" : "Hindsight isn’t available for this draft."}</div>}
    </section>
  );
}
