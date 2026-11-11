import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TradeIdea } from "../../../api/_lib/trade-ideas";
import { api } from "../api";
import { AssistantCard, AssistantFacts, AssistantSheet, AssistantTable } from "../components/assistant-card";
import { tradeIdeaDetails } from "./trade-idea-details";
import { SectionError } from "../section-error";
import { personalQueryKey, useViewerIdentity } from "../viewer-scope";

/** Ideas shown above the calculator. */
const IDEAS_SHOWN = 3;

const names = (assets: ReadonlyArray<{ name: string }>) => assets.map((asset) => asset.name).join(", ");

function TradeIdeaCard({ idea, week, onLoad, onAsk }: { idea: TradeIdea; week: number; onLoad: (idea: TradeIdea) => void; onAsk?: (question: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const details = tradeIdeaDetails(idea);
  const give = names(idea.give);
  const get = names(idea.get);
  return (
    <div className="trade-idea">
      <AssistantCard eyebrow={idea.partner} onOpen={() => setOpen(true)} label={`Trade ${give} to ${idea.partner} for ${get}`}>
        <span className="assistant-card-trade">
          <span><small>You give</small><strong>{give}</strong></span>
          <span><small>You get</small><strong>{get}</strong></span>
        </span>
      </AssistantCard>
      {idea.partnerRosterId !== null ? (
        <button type="button" className="trade-idea-load" onClick={() => { onLoad(idea); setLoaded(true); }}>
          {loaded ? "Loaded in calculator" : "Load in calculator"}
        </button>
      ) : null}
      <AssistantSheet
        open={open}
        onOpenChange={setOpen}
        title={`Trade with ${idea.partner}`}
        description={`Week ${week}. The same trade finder the chat assistant uses.`}
        question={`Is trading ${give} to ${idea.partner} for ${get} a good idea for me?`}
        onAsk={(question) => onAsk?.(question)}
      >
        <AssistantTable title="The trade" columns={["You give", "You get"]} rows={details.compare} />
        <AssistantFacts title="Your team" facts={details.yours} />
        <AssistantFacts title={idea.partner} facts={details.theirs} />
      </AssistantSheet>
    </div>
  );
}

/**
 * Trade ideas from the Assistant, loaded when the Trade tab opens (not at refresh).
 * Shows nothing while loading or if the finder fails: the calculator below still works.
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
  const ideas = query.data?.ideas.slice(0, IDEAS_SHOWN) ?? [];
  if (!enabled) return null;
  // Not loaded yet (or none found): nothing to show. A failure gets a retry, because the calculator below still works without it.
  if (query.isError && !query.data) {
    return <SectionError compact title="Trade ideas didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} />;
  }
  if (ideas.length === 0) return null;
  return (
    <section className="trade-ideas" aria-label="Trade ideas from the Assistant">
      {ideas.map((idea) => (
        <TradeIdeaCard key={`${idea.partner}-${idea.give.map((a) => a.playerId).join()}-${idea.get.map((a) => a.playerId).join()}`} idea={idea} week={week} onLoad={onLoad} onAsk={onAsk} />
      ))}
    </section>
  );
}
