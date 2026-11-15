import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TradeIdea } from "../../../api/_lib/trade-ideas";
import { api } from "../api";
import { AssistantCard, AssistantFacts, AssistantSheet, AssistantTable } from "../components/assistant-card";
import { tradeIdeaDetails, tradeIdeaTitle } from "./trade-idea-details";
import { SectionError } from "../section-error";
import { personalQueryKey, useViewerIdentity } from "../viewer-scope";

const names = (assets: ReadonlyArray<{ name: string }>) => assets.map((asset) => asset.name).join(", ");
const positions = (assets: ReadonlyArray<{ position: string }>) => assets.map((asset) => asset.position).join(", ");
const ideaKey = (idea: TradeIdea) => `${idea.partnerRosterId ?? idea.partner}-${idea.give.map((a) => a.playerId).join()}-${idea.get.map((a) => a.playerId).join()}`;

/** The verdict chip: filled for "Accept", outlined for the rest. */
function VerdictChip({ idea }: { idea: TradeIdea }) {
  return <span className={`trade-idea-verdict${idea.verdict === "Accept" ? " is-good" : ""}`}>{idea.verdict}</span>;
}

/** All ideas behind one card: a list, and one idea's details in the same sheet. */
function TradeIdeasSheet({ ideas, open, onOpenChange, week, onLoad, onAsk }: {
  ideas: TradeIdea[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  week: number;
  onLoad: (idea: TradeIdea) => void;
  onAsk?: (question: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = ideas.find((idea) => ideaKey(idea) === selectedKey) ?? null;
  const changeOpen = (next: boolean) => {
    if (!next) setSelectedKey(null);
    onOpenChange(next);
  };
  if (!selected) {
    return (
      <AssistantSheet
        open={open}
        onOpenChange={changeOpen}
        title="Trade ideas"
        description={`Week ${week}. The same trade finder the chat assistant uses.`}
        question="Which of these trade ideas should I make?"
        onAsk={(question) => onAsk?.(question)}
      >
        <ul className="trade-idea-list">
          {ideas.map((idea) => (
            <li key={ideaKey(idea)}>
              <button type="button" onClick={() => setSelectedKey(ideaKey(idea))} aria-label={`Trade ${names(idea.give)} to ${idea.partner} for ${names(idea.get)}: ${idea.verdict}. Show details`}>
                <strong>{tradeIdeaTitle(idea)}</strong>
                <VerdictChip idea={idea} />
                <small>{positions(idea.give)} for {positions(idea.get)} · {idea.partner}</small>
                <span className="trade-idea-chevron" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </AssistantSheet>
    );
  }
  const details = tradeIdeaDetails(selected);
  const give = names(selected.give);
  const get = names(selected.get);
  return (
    <AssistantSheet
      open={open}
      onOpenChange={changeOpen}
      before={<button type="button" className="trade-idea-back" onClick={() => setSelectedKey(null)}>‹ Trade ideas</button>}
      title={tradeIdeaTitle(selected)}
      description={`Trade ${give} to ${selected.partner} for ${get}. Week ${week}.`}
      question={`Is trading ${give} to ${selected.partner} for ${get} a good idea for me?`}
      onAsk={(question) => onAsk?.(question)}
    >
      <p className="trade-idea-partner">with {selected.partner} · <VerdictChip idea={selected} /></p>
      <AssistantTable title="The trade" columns={["You give", "You get"]} rows={details.compare} />
      <AssistantFacts title="Your team" facts={details.yours} />
      <AssistantFacts title={selected.partner} facts={details.theirs} />
      {selected.partnerRosterId !== null ? (
        <button type="button" className="trade-idea-load" onClick={() => { onLoad(selected); changeOpen(false); }}>Load in calculator</button>
      ) : null}
    </AssistantSheet>
  );
}

/**
 * Trade ideas from the Assistant, loaded when the Trade tab opens (not at refresh): one card with
 * the number of ideas, opening a sheet with all of them. Nothing shows while loading or when the
 * finder found none; a failure gets a retry. The calculator below works either way.
 */
export function TradeAssistant({ leagueId, week, enabled, onLoad, onAsk }: {
  leagueId: string;
  week: number;
  enabled: boolean;
  onLoad: (idea: TradeIdea) => void;
  onAsk?: (question: string) => void;
}) {
  // Ideas are worked out for the signed-in viewer's roster, so they live under the viewer's key and are cleared on an account change.
  const viewer = useViewerIdentity();
  const query = useQuery({
    queryKey: personalQueryKey(viewer, "trade-ideas", leagueId),
    queryFn: () => api.getTradeIdeas({ leagueId }),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const ideas = query.data?.ideas ?? [];
  if (!enabled) return null;
  // Not loaded yet (or none found): nothing to show. A failure gets a retry, because the calculator below still works without it.
  if (query.isError && !query.data) {
    return <SectionError compact title="Trade ideas didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  }
  if (ideas.length === 0) return null;
  const count = `${ideas.length} ${ideas.length === 1 ? "recommendation" : "recommendations"}`;
  return (
    <section className="trade-ideas" aria-label="Trade ideas from the Assistant">
      <AssistantCard eyebrow="Trade ideas" more="See all" onOpen={() => setOpen(true)} label={`${count} from the Assistant`}>
        <strong className="trade-ideas-count">{count}</strong>
      </AssistantCard>
      <TradeIdeasSheet ideas={ideas} open={open} onOpenChange={setOpen} week={week} onLoad={onLoad} onAsk={onAsk} />
    </section>
  );
}
