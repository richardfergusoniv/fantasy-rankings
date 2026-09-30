"""Parser for the-odds-api shaped event-odds payloads.

Shared by The Odds API, PropLine and ParlayAPI (which is a drop-in
replacement for the-odds-api):

    {"bookmakers": [{"key": "draftkings", "title": "DraftKings",
                     "markets": [{"key": "player_pass_yds",
                                  "outcomes": [{"description": "Patrick Mahomes",
                                                "name": "Over", "point": 285.5,
                                                "price": -110}, ...]}]}]}
"""
from __future__ import annotations

from ..markets import map_market, THEODDSAPI_MARKETS
from ..schema import PropRecord, utcnow_iso


def parse_event_odds(payload: dict, *, provider: str, week: int, season: int,
                     game_id: str = "", market_map: dict | None = None) -> list[PropRecord]:
    mmap = market_map or THEODDSAPI_MARKETS
    records: list[PropRecord] = []
    fetched = utcnow_iso()
    for book in payload.get("bookmakers", []) or []:
        book_key = book.get("key") or book.get("title") or ""
        for market in book.get("markets", []) or []:
            stat = map_market(mmap, market.get("key", ""))
            if stat is None:
                continue  # unknown or non-canonical market: skip, don't guess
            # Pair Over/Under (or Yes/No) outcomes by (player, line).
            legs: dict[tuple[str, float], dict] = {}
            for o in market.get("outcomes", []) or []:
                player = (o.get("description") or "").strip()
                if not player:
                    continue
                side = (o.get("name") or "").strip().lower()
                if side in ("yes", "no"):
                    # Binary markets (e.g. anytime TD): line is implicit 0.5.
                    try:
                        point = float(o.get("point", 0.5))
                    except (TypeError, ValueError):
                        point = 0.5
                    side = "over" if side == "yes" else "under"
                elif side in ("over", "under"):
                    try:
                        point = float(o.get("point"))
                    except (TypeError, ValueError):
                        continue
                else:
                    continue
                legs.setdefault((player, point), {})[side] = o.get("price")
            for (player, point), sides in legs.items():
                records.append(PropRecord(
                    provider=provider,
                    book=book_key,
                    player=player,
                    game_id=game_id,
                    week=week,
                    season=season,
                    stat=stat,
                    line=point,
                    over_odds=sides.get("over"),
                    under_odds=sides.get("under"),
                    fetched_at=fetched,
                ))
    return records
