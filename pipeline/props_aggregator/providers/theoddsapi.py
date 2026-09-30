"""The Odds API (verified 2026-09-22).

Base: https://api.the-odds-api.com/v4
Auth: apiKey query parameter
Free: 500 requests/month. NOTE: Richard's free key returned 403 for NFL —
free scope is MLB/NBA only, so NFL player props need a paid tier.
The client is implemented for when a paid key is available.
"""
from __future__ import annotations

from ..base import BaseProvider
from ..markets import THEODDSAPI_MARKETS
from ..schema import PropRecord
from ._oddsapi_shape import parse_event_odds

BASE = "https://api.the-odds-api.com/v4"
SPORT = "americanfootball_nfl"
NFL_MARKETS = [m for m in THEODDSAPI_MARKETS if THEODDSAPI_MARKETS[m]]


class TheOddsAPIProvider(BaseProvider):
    name = "theoddsapi"
    env_var = "THEODDSAPI_API_KEY"
    status_note = "NFL requires paid tier (free key 403s on NFL)"

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        events = self._get(f"{BASE}/sports/{SPORT}/events",
                           params={"apiKey": self.api_key}) or []
        records: list[PropRecord] = []
        for ev in events:
            event_id = str(ev.get("id", ""))
            if not event_id:
                continue
            payload = self._get(
                f"{BASE}/sports/{SPORT}/events/{event_id}/odds",
                params={"apiKey": self.api_key, "markets": ",".join(NFL_MARKETS),
                        "regions": "us", "oddsFormat": "american"},
            )
            records.extend(parse_event_odds(
                payload, provider=self.name, week=week, season=season,
                game_id=f"theoddsapi:{event_id}"))
        return records
