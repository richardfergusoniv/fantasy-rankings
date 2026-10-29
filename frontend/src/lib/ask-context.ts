import type { Tab } from "../dashboard-types";

export type AskContext = {
  /** Page the question starts from, shown beside the sheet title. */
  label: string;
  suggestions: readonly string[];
};

const LINEUP: AskContext = {
  label: "Matchup",
  suggestions: [
    "Who should I start at flex this week?",
    "Where am I losing this matchup?",
    "Any injured starters I should swap?",
  ],
};

const PLAYERS: AskContext = {
  label: "Players",
  suggestions: [
    "Who are the best waiver pickups for my roster?",
    "Which of my players should I sell?",
    "Who is a buy-low candidate right now?",
  ],
};

const TRADE: AskContext = {
  label: "Trade",
  suggestions: [
    "Is this trade fair for me?",
    "What would make them say yes?",
    "How does this change my lineup?",
  ],
};

const GENERAL: AskContext = {
  label: "Your leagues",
  suggestions: [
    "Who should I start at flex this week?",
    "Is this trade fair for me?",
    "Which waiver pickups help my roster most?",
    "How does my team stack up against my opponent?",
  ],
};

const BY_TAB: Record<Tab, AskContext> = {
  team: LINEUP,
  rankings: PLAYERS,
  waivers: PLAYERS,
  comparison: PLAYERS,
  trade: TRADE,
  power: { label: "League", suggestions: ["Who is the best team in my league?", "Which teams could I trade with?", "How does my team stack up?"] },
  outcomes: { label: "Projected standings", suggestions: ["What do I need to make the playoffs?", "Who is most likely to finish last?", "How do my remaining games look?"] },
  draft: { label: "Draft", suggestions: ["Who should I take next?", "Which positions are running out?", "Who is the best value left?"] },
  monitor: GENERAL,
  "team-stats": GENERAL,
  analytics: GENERAL,
};

export function askContextForTab(tab: Tab): AskContext {
  return BY_TAB[tab];
}
