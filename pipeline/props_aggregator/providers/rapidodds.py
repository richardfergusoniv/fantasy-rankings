"""RapidOddsAPI (verified 2026-09-22).

Base: https://api.rapidoddsapi.com
Auth: api_key query parameter (keys start with oa_)
Free tier: 250 credits (per comparison table; confirm on pricing page).
Cost: market_types x ceil(bookmakers / 5) credits per call.
Rate limit: 30 req/sec. WebSocket is Pro+ only.

  GET /sports/{sport_id}/markets?api_key=..&market_type=..&bookmaker=..

Response: {sport, games: [{game: {commence_time, home_team, away_team},
  bookmakers: [{name, last_update,
    markets: [{key, outcomes: [{name, price (DECIMAL), point, player_name}]}]}]}]}

NFL sport_id and player-prop market_type values come from the coverage page;
defaults below are PROVISIONAL. Prices are decimal -> converted to American.
"""
from __future__ import annotations

from ..base import BaseProvider
from ..markets import RAPIDODDS_MARKETS, map_market
from ..odds import decimal_to_american
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.rapidoddsapi.com"
SPORT_ID = "NFL"  # PROVISIONAL: confirm on the coverage page
DEFAULT_BOOKMAKERS = ["DraftKings", "FanDuel"]  # 1 credit per market_type


class RapidOddsProvider(BaseProvider):
    name = "rapidodds"
    env_var = "RAPIDODDS_API_KEY"
    status_note = "250 free credits; sport/market ids provisional"

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        market_types = [m for m in RAPIDODDS_MARKETS]
        params = [("api_key", self.api_key)]
        params += [("market_type", m) for m in market_types]
        params += [("bookmaker", b) for b in DEFAULT_BOOKMAKERS]
        payload = self._get(f"{BASE}/sports/{SPORT_ID}/markets", params=params)
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        legs: dict[tuple, dict] = {}
        for entry in payload.get("games", []) or []:
            game = entry.get("game") or {}
            home = game.get("home_team") or ""
            away = game.get("away_team") or ""
            game_id = f"rapidodds:{home}-{away}:{game.get('commence_time', '')}"
            for book in entry.get("bookmakers", []) or []:
                book_name = book.get("name") or ""
                for market in book.get("markets", []) or []:
                    stat = map_market(RAPIDODDS_MARKETS, market.get("key", ""))
                    if stat is None:
                        continue
                    for o in market.get("outcomes", []) or []:
                        player = (o.get("player_name") or "").strip()
                        if not player:
                            continue
                        try:
                            point = float(o.get("point"))
                        except (TypeError, ValueError):
                            continue
                        price = o.get("price")
                        american = decimal_to_american(price) if price else None
                        side = (o.get("name") or "").strip().lower()
                        key = (game_id, book_name, player, stat, point)
                        slot = legs.setdefault(key, {})
                        if side == "under":
                            slot["under"] = american
                        else:  # "over", or yes/no style (e.g. anytime TD)
                            slot["over"] = american
        for (game_id, book_name, player, stat, point), sides in legs.items():
            records.append(PropRecord(
                provider=self.name, book=book_name, player=player,
                game_id=game_id, week=week, season=season,
                stat=stat, line=point,
                over_odds=sides.get("over"), under_odds=sides.get("under"),
                fetched_at=fetched))
        return records
