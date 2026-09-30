"""OddsPapi (partially verified 2026-09-22).

Current public docs:
  Base: https://api.oddspapi.io/v4
  Auth: apiKey query parameter
  GET /sports | /tournaments | /fixtures | /odds?fixtureId=..
Claims 300+ bookmakers and player props; response is deeply nested under
bookmakerOdds -> bookmaker slug -> markets -> market id -> outcomes ->
outcome id -> players.

CONFLICTS: older third-party integrations use https://v5.oddspapi.io/en;
one example suggests /v1 + Bearer <redacted> (unverified). NFL sport id and
player-prop market/outcome ids require runtime discovery with a key, so this
client implements discovery + a defensive generic parser and skips anything
it cannot map with confidence.
"""
from __future__ import annotations

from ..base import BaseProvider
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.oddspapi.io/v4"  # current docs; v5.oddspapi.io seen in older refs


class OddsPapiProvider(BaseProvider):
    name = "oddspapi"
    env_var = "ODDSPAPI_API_KEY"
    status_note = "v4 docs vs v5 refs conflict; market ids need key to discover"

    def _api(self, path: str, params: dict | None = None) -> dict:
        p = dict(params or {})
        p["apiKey"] = self.api_key
        return self._get(f"{BASE}{path}", params=p)

    def _find_nfl_sport_id(self) -> str:
        sports = self._api("/sports")
        items = sports if isinstance(sports, list) else sports.get("data", [])
        for s in items:
            name = str(s.get("name", "")).lower()
            if "nfl" in name or "american football" in name:
                return str(s.get("id", ""))
        raise RuntimeError("NFL sport id not found in /sports response")

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        sport_id = self._find_nfl_sport_id()
        fixtures = self._api("/fixtures", {"sportId": sport_id})
        items = fixtures if isinstance(fixtures, list) else fixtures.get("data", [])
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        for fx in items:
            fixture_id = fx.get("id")
            if not fixture_id:
                continue
            odds = self._api("/odds", {"fixtureId": fixture_id})
            records.extend(self._parse_odds(
                odds, week, season, fetched,
                game_id=f"oddspapi:{fixture_id}"))
        return records

    def _parse_odds(self, payload: dict, week: int, season: int,
                    fetched: str, game_id: str) -> list[PropRecord]:
        # Defensive generic walk of the nested bookmakerOdds structure.
        # Only rows that clearly look like player props (a player name is
        # present and the market label mentions a known stat) are kept.
        from ..markets import ODDSAPIIO_LABELS  # label heuristics reuse
        records: list[PropRecord] = []
        root = payload.get("bookmakerOdds") or payload.get("data") or {}
        if not isinstance(root, dict):
            return records
        for book, markets in root.items():
            if not isinstance(markets, dict):
                continue
            markets = markets.get("markets", markets)
            for market_id, market in (markets.items() if isinstance(markets, dict) else []):
                outcomes = (market or {}).get("outcomes", {}) if isinstance(market, dict) else {}
                label = str((market or {}).get("name", market_id))
                stat = ODDSAPIIO_LABELS.get(label.strip())
                for outcome_id, outcome in (outcomes.items() if isinstance(outcomes, dict) else []):
                    players = (outcome or {}).get("players", {}) if isinstance(outcome, dict) else {}
                    for player_id, p in (players.items() if isinstance(players, dict) else []):
                        name = str((p or {}).get("name", player_id)).strip()
                        if not name or stat is None:
                            continue
                        try:
                            point = float((p or {}).get("line", (p or {}).get("point")))
                        except (TypeError, ValueError):
                            continue
                        records.append(PropRecord(
                            provider=self.name, book=str(book), player=name,
                            game_id=game_id, week=week, season=season,
                            stat=stat, line=point,
                            over_odds=(p or {}).get("overOdds"),
                            under_odds=(p or {}).get("underOdds"),
                            fetched_at=fetched))
        return records
