"""Odds-API.io (verified via official docs + independent integrations 2026-09-22).

Base: https://api.odds-api.io/v3
Auth: apiKey query parameter
Free: 100 requests/hour, no credit card.
  GET /v3/events?sport=football&league=usa-nfl   (league slug provisional)
  GET /v3/odds?apiKey=..&eventId=..&bookmakers=DraftKings,FanDuel

Player props arrive as a generic "Player Props" market; each odd has
label "Player - Stat", hdp = line, over/under = DECIMAL strings.
"""
from __future__ import annotations

from ..base import BaseProvider
from ..markets import ODDSAPIIO_LABELS
from ..odds import decimal_to_american
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.odds-api.io/v3"
LEAGUE = "usa-nfl"  # PROVISIONAL: by analogy with usa-nba
DEFAULT_BOOKMAKERS = "DraftKings,FanDuel"


class OddsAPIIOProvider(BaseProvider):
    name = "oddsapiio"
    env_var = "ODDSAPIIO_API_KEY"
    status_note = "100 req/hr free; league slug provisional"

    def _api(self, path: str, params: dict) -> dict:
        p = dict(params)
        p["apiKey"] = self.api_key
        return self._get(f"{BASE}{path}", params=p)

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        events = self._api("/events", {"sport": "football", "league": LEAGUE})
        items = events if isinstance(events, list) else events.get("events", [])
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        for ev in items:
            event_id = ev.get("id")
            if not event_id:
                continue
            odds = self._api("/odds", {"eventId": event_id,
                                      "bookmakers": DEFAULT_BOOKMAKERS})
            records.extend(self._parse_event(
                odds, week, season, fetched, game_id=f"oddsapiio:{event_id}"))
        return records

    def _parse_event(self, payload: dict, week: int, season: int,
                     fetched: str, game_id: str) -> list[PropRecord]:
        records: list[PropRecord] = []
        books = payload.get("bookmakers") or {}
        for book, markets in books.items():
            for market in markets or []:
                if "player prop" not in str(market.get("name", "")).lower():
                    continue
                for odd in market.get("odds", []) or []:
                    label = str(odd.get("label", ""))
                    if " - " not in label:
                        continue
                    player, stat_label = label.rsplit(" - ", 1)
                    stat = ODDSAPIIO_LABELS.get(stat_label.strip())
                    if stat is None or not player.strip():
                        continue
                    try:
                        point = float(odd.get("hdp"))
                    except (TypeError, ValueError):
                        continue
                    records.append(PropRecord(
                        provider=self.name, book=str(book),
                        player=player.strip(), game_id=game_id,
                        week=week, season=season, stat=stat, line=point,
                        over_odds=decimal_to_american(odd.get("over")),
                        under_odds=decimal_to_american(odd.get("under")),
                        fetched_at=fetched))
        return records
