"""SharpAPI — real-time odds aggregation (verified 2026-09-22).

Base: https://api.sharpapi.io/api/v1
Auth: X-API-Key header
Free: 12 req/min, 2 sportsbooks, no credit card. REST only on free.

  GET /events?sport=football&league=nfl
  GET /odds?sport=football&league=nfl[&market=..]  (offset paged;
      offset is capped at 500, so each market is pulled with a server-side
      market filter to stay well under the cap; valid ids from /markets)
  GET /health  (freshness probe)

Live row shape (one row per over/under selection; TD-scorer markets are
binary — one row per player with selection_type "other" and no line):
  market_type (matches the queried market id), player_name, sportsbook,
  line, selection_type ("over"/"under"/"other"), odds_american, is_main_line,
  event_id, home_team, away_team, event_start_time.

Rows are grouped by (event_id, market_id, sportsbook, line) into one
record with over/under odds. Binary TD-scorer rows become implicit 0.5
lines with the Yes price as over_odds. Only main lines are kept so the
median consensus isn't skewed by alternate lines. Unmapped market ids
are skipped and reported on stderr — never guessed.
"""
from __future__ import annotations

import sys

from ..base import BaseProvider, ProviderError
from ..markets import SHARPAPI_MARKETS
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.sharpapi.io/api/v1"


class SharpAPIProvider(BaseProvider):
    name = "sharpapi"
    env_var = "SHARPAPI_API_KEY"
    status_note = "free: 12 req/min, 2 books"

    def _headers(self) -> dict:
        return {"X-API-Key": self.api_key}

    def _rows(self, params: dict) -> list[dict]:
        """Fetch all pages for one filtered /odds query via offset pagination."""
        rows: list[dict] = []
        offset = 0
        while True:
            p = dict(params)
            p["offset"] = offset
            payload = self._get(f"{BASE}/odds", params=p, headers=self._headers())
            if isinstance(payload, dict):
                batch = payload.get("data") or payload.get("rows") or []
                pg = payload.get("pagination") or {}
                has_more = pg.get("has_more")
                nxt = pg.get("next_offset")
            else:
                batch = payload if isinstance(payload, list) else []
                has_more = False
                nxt = None
            rows.extend(batch)
            if not (has_more and batch):
                break
            offset = nxt if isinstance(nxt, int) else offset + len(batch)
            if offset > 500:  # server cap; market filter keeps us under it
                break
        return rows

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        fetched = utcnow_iso()
        # Group over/under rows: one record per (event, market, book, line).
        groups: dict[tuple, dict] = {}
        skipped: dict[str, int] = {}
        for market in SHARPAPI_MARKETS:
            rows = self._rows({
                "sport": "football", "league": "nfl", "market": market,
            })
            stat = SHARPAPI_MARKETS[market]
            for r in rows:
                # No is_player_prop check: the server-side market filter already
                # constrains to the queried player market (TD-scorer markets are
                # flagged is_player_prop=false but carry stat_category).
                if not r.get("is_main_line"):
                    continue
                if stat is None:
                    skipped[market] = skipped.get(market, 0) + 1
                    continue
                player = str(r.get("player_name") or "").strip()
                if not player:
                    continue
                st = str(r.get("selection_type") or "").lower()
                try:
                    odds = int(r.get("odds_american"))
                except (TypeError, ValueError):
                    odds = None
                if st == "other":
                    # Binary market (TD scorer): implicit 0.5 line, Yes price only.
                    line = 0.5
                    over, under = odds, None
                else:
                    try:
                        line = float(r.get("line"))
                    except (TypeError, ValueError):
                        continue
                    over = odds if st == "over" else None
                    under = odds if st == "under" else None
                key = (
                    str(r.get("event_id") or ""),
                    str(r.get("market_id") or ""),
                    str(r.get("sportsbook") or ""),
                    line,
                )
                g = groups.setdefault(key, {
                    "stat": stat, "player": player,
                    "event_id": str(r.get("event_id") or ""),
                    "book": str(r.get("sportsbook") or ""),
                    "line": line, "over": None, "under": None,
                })
                if over is not None:
                    g["over"] = over
                if under is not None:
                    g["under"] = under
        for mt, n in sorted(skipped.items()):
            print(f"  [sharpapi] skipped {n} rows: market {mt} has no canonical stat",
                  file=sys.stderr)

        records = []
        for g in groups.values():
            records.append(PropRecord(
                provider=self.name,
                book=g["book"],
                player=g["player"],
                team="",
                opponent="",
                game_id=g["event_id"],
                week=week,
                season=season,
                stat=g["stat"],
                line=g["line"],
                over_odds=g["over"],
                under_odds=g["under"],
                fetched_at=fetched,
            ))
        return records
