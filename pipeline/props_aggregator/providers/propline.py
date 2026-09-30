"""PropLine — player props API, the-odds-api compatible (verified 2026-09-22).

Base: https://api.prop-line.com/v1
Auth: apiKey query parameter
Free: 1,000 requests/day, no credit card (current site; older SDK pages say 500)
Sport key: football_nfl (americanfootball_nfl also works as alias)

  GET /sports/football_nfl/events
  GET /sports/football_nfl/events/{event_id}/odds?apiKey=..&markets=..&regions=us

Documented NFL markets: player_pass_yds, player_pass_tds, player_rush_yds,
player_reception_yds, player_receptions, player_anytime_td, player_1st_td,
player_2plus_td. Other the-odds-api NFL keys are requested too; if the API
rejects them the client retries with the documented subset.
"""
from __future__ import annotations

from ..base import BaseProvider, ProviderError
from ..markets import THEODDSAPI_MARKETS
from ..schema import PropRecord
from ._oddsapi_shape import parse_event_odds

BASE = "https://api.prop-line.com/v1"
SPORT = "football_nfl"

DOCUMENTED_NFL_MARKETS = [
    "player_pass_yds", "player_pass_tds", "player_rush_yds",
    "player_reception_yds", "player_receptions", "player_anytime_td",
    "player_1st_td", "player_2plus_td",
]
FULL_NFL_MARKETS = [m for m in THEODDSAPI_MARKETS if THEODDSAPI_MARKETS[m]]


class PropLineProvider(BaseProvider):
    name = "propline"
    env_var = "PROPLINE_API_KEY"
    status_note = "1,000 req/day free, no card; the-odds-api compatible"

    def _odds(self, event_id: str, markets: list[str]) -> dict:
        return self._get(
            f"{BASE}/sports/{SPORT}/events/{event_id}/odds",
            params={"apiKey": self.api_key, "markets": ",".join(markets),
                    "regions": "us", "oddsFormat": "american"},
        )

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        events = self._get(f"{BASE}/sports/{SPORT}/events",
                           params={"apiKey": self.api_key}) or []
        records: list[PropRecord] = []
        for ev in events:
            event_id = str(ev.get("id", ""))
            if not event_id:
                continue
            try:
                payload = self._odds(event_id, FULL_NFL_MARKETS)
            except ProviderError as exc:
                if "400" in str(exc) or "market" in str(exc).lower():
                    payload = self._odds(event_id, DOCUMENTED_NFL_MARKETS)
                else:
                    raise
            records.extend(parse_event_odds(
                payload, provider=self.name, week=week, season=season,
                game_id=f"propline:{event_id}"))
        return records
