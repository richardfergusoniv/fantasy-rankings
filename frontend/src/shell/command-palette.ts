import type { Tab } from "../dashboard-types";

export type CommandPageItem = {
  kind: "page";
  id: string;
  label: string;
  tab: Tab;
};

export type CommandLeagueItem = {
  kind: "league";
  id: string;
  label: string;
};

export type CommandPlayerItem = {
  kind: "player";
  id: string;
  label: string;
  position: string;
};

export type CommandItem = CommandPageItem | CommandLeagueItem | CommandPlayerItem;

export const COMMAND_RESULT_LIMIT = 8;

/** Six primary nav pages and the tab each opens by default. */
export const PRIMARY_COMMAND_PAGES: CommandPageItem[] = [
  { kind: "page", id: "monitor", label: "Monitor", tab: "monitor" },
  { kind: "page", id: "team", label: "Matchup", tab: "team" },
  { kind: "page", id: "players", label: "Players", tab: "rankings" },
  { kind: "page", id: "league", label: "League", tab: "power" },
  { kind: "page", id: "draft", label: "Draft", tab: "draft" },
  { kind: "page", id: "tools", label: "Tools", tab: "trade" },
];

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

function labelMatches(needle: string, label: string): boolean {
  if (!needle) return true;
  return label.toLowerCase().includes(needle);
}

/**
 * Filter palette sources by query. Pages, then leagues, then players.
 * Caps at {@link COMMAND_RESULT_LIMIT}. Empty query returns the primary pages.
 */
export function filterCommandItems(
  query: string,
  sources: {
    pages: CommandPageItem[];
    leagues: CommandLeagueItem[];
    players: CommandPlayerItem[];
  },
): CommandItem[] {
  const needle = query.trim().toLowerCase();
  const results: CommandItem[] = [];

  for (const page of sources.pages) {
    if (!labelMatches(needle, page.label)) continue;
    results.push(page);
    if (results.length >= COMMAND_RESULT_LIMIT) return results;
  }

  if (!needle) return results;

  for (const league of sources.leagues) {
    if (!labelMatches(needle, league.label)) continue;
    results.push(league);
    if (results.length >= COMMAND_RESULT_LIMIT) return results;
  }

  for (const player of sources.players) {
    if (!labelMatches(needle, player.label) && !labelMatches(needle, player.position)) continue;
    results.push(player);
    if (results.length >= COMMAND_RESULT_LIMIT) return results;
  }

  return results;
}
