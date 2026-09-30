"""API-Sports (American Football) — stub (verified 2026-09-22).

Base (pattern-based, UNVERIFIED): https://v1.american-football.api-sports.io
Auth: x-apisports-key header.
Free plan: 100 requests/day (per comparison table; confirm on RapidAPI listing).
Odds endpoints (/odds, /odds/bookmakers) exist but player-props coverage is
thin. Left as an explicit stub until a key is available to probe the actual
NFL props shape.
"""
from __future__ import annotations

from ..base import BaseProvider, ProviderError
from ..schema import PropRecord


class APISportsProvider(BaseProvider):
    name = "apisports"
    env_var = "APISPORTS_API_KEY"
    status_note = "stub: NFL player-props coverage/shape unconfirmed"

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        raise ProviderError(
            "stub: API-Sports NFL player-props coverage is thin/unconfirmed; "
            "probe /odds with a key before implementing")
