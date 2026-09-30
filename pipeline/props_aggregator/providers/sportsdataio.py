"""SportsDataIO — stub (verified 2026-09-22).

Base: https://api.sportsdata.io/v3/nfl/
Auth: Ocp-Apim-Subscription-Key header.
Known endpoints cover scores/players/projections
(e.g. projections/json/PlayerGameProjectionStatsByWeek/{season}/{week}),
but the betting-odds endpoints that carry player props are NOT on the free
tier. Left as an explicit stub: implement fetch_props once a key with odds
entitlement is available and the props endpoint shape is confirmed.
"""
from __future__ import annotations

from ..base import BaseProvider, ProviderError
from ..schema import PropRecord


class SportsDataIOProvider(BaseProvider):
    name = "sportsdataio"
    env_var = "SPORTSDATAIO_API_KEY"
    status_note = "stub: player-props odds endpoints need a paid odds entitlement"

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        raise ProviderError(
            "stub: SportsDataIO player-props odds are not on the free tier; "
            "supply a key with odds entitlement and confirm the props endpoint shape")
