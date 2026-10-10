import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Tab } from "../dashboard-types";
import type { TradeMode } from "../dashboard-url";
import {
  COMMAND_PAGES,
  filterCommandItems,
  type CommandItem,
  type CommandLeagueItem,
  type CommandPageItem,
  type CommandPlayerItem,
} from "./command-palette";

export function CommandBar({
  open,
  onOpenChange,
  leagues,
  players,
  onSelectPage,
  onSelectPlayer,
  onSelectLeague,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leagues: CommandLeagueItem[];
  players: CommandPlayerItem[];
  onSelectPage: (tab: Tab, options?: { tradeMode?: TradeMode }) => void;
  onSelectPlayer: (playerId: string) => void;
  onSelectLeague: (leagueId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(
    () => filterCommandItems(query, { pages: COMMAND_PAGES, leagues, players }),
    [leagues, players, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);

  function selectItem(item: CommandItem) {
    onOpenChange(false);
    switch (item.kind) {
      case "page":
        onSelectPage(item.tab, item.tradeMode ? { tradeMode: item.tradeMode } : undefined);
        break;
      case "player":
        onSelectPlayer(item.id);
        break;
      case "league":
        onSelectLeague(item.id);
        break;
      default: {
        const unreachable: never = item;
        return unreachable;
      }
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) selectItem(item);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="command-bar-dialog" aria-describedby="command-bar-description">
        <DialogCloseButton label="Close command bar" />
        <DialogHeader className="command-bar-header pr-8">
          <DialogTitle>Jump to</DialogTitle>
          <DialogDescription id="command-bar-description" className="sr-only">
            Search pages, leagues, and players. Use arrow keys and Enter to select.
          </DialogDescription>
        </DialogHeader>
        <input
          className="command-bar-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search pages, leagues, players…"
          aria-label="Command search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <ul className="command-bar-results" role="listbox" aria-label="Command results">
          {results.map((item, index) => {
            const secondary = item.kind === "page" ? "Page" : item.kind === "league" ? "League" : item.position;
            return (
              <li key={`${item.kind}-${item.id}`} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={index === activeIndex ? "is-active" : undefined}
                  onClick={() => selectItem(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="command-bar-result-label">{item.label}</span>
                  <span className="command-bar-result-meta">{secondary}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {results.length === 0 ? <p className="command-bar-empty">No matches.</p> : null}
      </DialogContent>
    </Dialog>
  );
}
