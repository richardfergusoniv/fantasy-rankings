"""ParlayAPI — drop-in replacement for the-odds-api (verified 2026-09-22).

Base: https://parlay-api.com/v1   (swap for https://api.the-odds-api.com/v4)
Auth: apiKey query parameter (X-API-Key header also supported)
Free: 1,000 credits/month, no credit card. REST only.

  GET /v1/sports/{sport_key}/props?apiKey=..      -> whole-sport props board, 3 credits
  GET /v1/sports/americanfootball_nfl/events?apiKey=..
  GET /v1/sports/americanfootball_nfl/events/{id}/odds?apiKey=..&markets=..

The 3-credit cost of a full NFL props-board pull was confirmed live via
GET /v1/meta/credit-costs (keyless): ~333 board pulls/month on the free tier.
Machine-readable costs: GET /v1/meta/credit-costs, GET /v1/meta/limits.
Keyless sandbox: /v1/sandbox/* (evaluation only; this client uses keyed endpoints).
"""
from __future__ import annotations

from ..base import BaseProvider, ProviderError
from ..schema import PropRecord
from ._oddsapi_shape import parse_event_odds

BASE = "https://parlay-api.com/v1"
SPORT = "americanfootball_nfl"
PAGE_LIMIT = 5000

# Native ParlayAPI market keys -> canonical stat, verified against the live
# /props board 2026-09-22. Keys not listed here (milestones, 1H/Q1 periods,
# combo markets, fantasy points, team markets, book-specific specials) are
# skipped, not guessed. `player_interceptions` was verified live to be QBs
# (Love, Penix, Allen) with 0.5 lines -> interceptions thrown.
PARLAYAPI_MARKETS: dict[str, str] = {
    "player_pass_yds": "pass_yards",
    "player_passing_yards": "pass_yards",
    "player_pass_tds": "pass_tds",
    "player_passing_tds": "pass_tds",
    "player_passing_touchdowns": "pass_tds",
    "player_pass_completions": "pass_completions",
    "player_passing_completions": "pass_completions",
    "player_completions": "pass_completions",
    "player_pass_attempts": "pass_attempts",
    "player_passing_attempts": "pass_attempts",
    "player_interceptions": "pass_interceptions",
    "player_ints_thrown": "pass_interceptions",
    "player_rush_yds": "rush_yards",
    "player_rushing_yards": "rush_yards",
    "player_rush_yards": "rush_yards",
    "player_rush_attempts": "rush_attempts",
    "player_rushing_attempts": "rush_attempts",
    "player_receiving_yds": "rec_yards",
    "player_receiving_yards": "rec_yards",
    "player_rec_yds": "rec_yards",
    "player_receptions": "receptions",
    "player_longest_rec": "longest_reception",
    "player_longest_reception": "longest_reception",
    "player_reception_longest": "longest_reception",
    "player_anytime_td": "anytime_td",
    "player_anytime_tds": "anytime_td",
    "player_anytime_touchdowns": "anytime_td",
    "player_first_td": "first_td",
    "player_first_touchdown": "first_td",
    "player_first_touchdown_scorer": "first_td",
    "first_touchdown_scorer": "first_td",
    "player_sacks": "sacks",
    "player_kicking_points": "kicker_points",
    "player_field_goals_made": "field_goals_made",
    "player_field_goal_made": "field_goals_made",
    "player_fg_made": "field_goals_made",
}

# Some books scope scorer markets to a team, e.g.
# "player_first_touchdown_scorer_-_atlanta_falcons". Strip that suffix
# before the canonical lookup.
_TEAM_SUFFIX_RE = None


def _strip_team_suffix(key: str) -> str:
    global _TEAM_SUFFIX_RE
    if _TEAM_SUFFIX_RE is None:
        import re
        _TEAM_SUFFIX_RE = re.compile(r"(_-_.*|___.*)$")
    return _TEAM_SUFFIX_RE.sub("", key)


def _canonical_stat(native: str) -> str | None:
    if native in PARLAYAPI_MARKETS:
        return PARLAYAPI_MARKETS[native]
    return PARLAYAPI_MARKETS.get(_strip_team_suffix(native))


class ParlayAPIProvider(BaseProvider):
    name = "parlayapi"
    env_var = "PARLAYAPI_API_KEY"
    status_note = "1,000 credits/mo free; 3 credits per NFL props-board pull"

    def _params(self, **extra):
        return {"apiKey": self.api_key, **extra}

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        try:
            board = self._fetch_board()
        except ProviderError as exc:
            if "404" not in str(exc):
                raise
            return self._fetch_via_events(week, season)  # endpoint moved; fallback
        return self._parse_board(board, week, season)

    def _fetch_board(self) -> list:
        """Paginate the full-sport props board (default page is 5000 rows)."""
        rows: list = []
        offset = 0
        while True:
            page = self._get(
                f"{BASE}/sports/{SPORT}/props",
                params=self._params(limit=PAGE_LIMIT, offset=offset),
            ) or []
            rows.extend(page)
            if len(page) < PAGE_LIMIT:
                break
            offset += PAGE_LIMIT
        return rows

    def _parse_board(self, board, week: int, season: int) -> list[PropRecord]:
        """Handle the board as event-shaped or flat prop list, whichever it is."""
        records: list[PropRecord] = []
        if isinstance(board, dict) and "bookmakers" in board:
            return parse_event_odds(board, provider=self.name, week=week,
                                    season=season)
        events = board if isinstance(board, list) else board.get("events", [])
        for item in events:
            if isinstance(item, dict) and "bookmakers" in item:
                records.extend(parse_event_odds(
                    item, provider=self.name, week=week, season=season,
                    game_id=f"parlayapi:{item.get('id', '')}"))
            elif isinstance(item, dict):
                rec = self._parse_flat_prop(item, week, season)
                if rec:
                    records.append(rec)
        return records

    def _parse_flat_prop(self, item: dict, week: int, season: int) -> PropRecord | None:
        # Full-game markets only; period variants (1H/Q1) are separate rows.
        if (item.get("period") or "FULL") != "FULL":
            return None
        native = str(item.get("market_key") or item.get("market") or "")
        stat = _canonical_stat(native)
        if stat is None:
            return None  # combo/milestone/noncanonical market: skip, don't guess
        player = str(item.get("player") or item.get("description") or "").strip()
        if not player:
            return None
        try:
            line = float(item.get("line", item.get("point")))
        except (TypeError, ValueError):
            line = 0.0
        if line == 0.0 and stat in ("anytime_td", "first_td"):
            line = 0.5  # binary scorer markets carry an implicit 0.5 line
        injury = item.get("injury") or {}
        return PropRecord(
            provider=self.name,
            book=str(item.get("bookmaker") or item.get("bookmaker_title") or ""),
            player=player,
            team=str(injury.get("team_abbr") or ""),
            game_id="parlayapi:{}".format(
                item.get("canonical_event_id") or item.get("event_id") or ""),
            week=week, season=season, stat=stat, line=line,
            over_odds=item.get("over_price", item.get("over_odds")),
            under_odds=item.get("under_price", item.get("under_odds")))

    def _fetch_via_events(self, week: int, season: int) -> list[PropRecord]:
        """Fallback: per-event odds loop (costs more credits; kept for safety)."""
        events = self._get(f"{BASE}/sports/{SPORT}/events",
                           params=self._params()) or []
        records: list[PropRecord] = []
        for ev in events:
            event_id = str(ev.get("id", ""))
            if not event_id:
                continue
            payload = self._get(
                f"{BASE}/sports/{SPORT}/events/{event_id}/odds",
                params=self._params(markets=",".join(sorted(PARLAYAPI_MARKETS)),
                                    regions="us", oddsFormat="american"),
            )
            records.extend(parse_event_odds(
                payload, provider=self.name, week=week, season=season,
                game_id=f"parlayapi:{event_id}"))
        return records
