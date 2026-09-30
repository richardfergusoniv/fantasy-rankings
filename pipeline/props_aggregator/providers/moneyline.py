"""MoneyLine API (verified 2026-09-22).

Base URL: https://mlapi.bet (confirmed from the official docs;
"All requests go through a single base URL").
Auth: x-api-key header.
Documented endpoints:
  GET /v1/player-props              (browse by event/league)
  GET /v1/events/:eventId/player-props (per-event)
  GET /v1/player-props/markets      (supported markets by league)
Docs: https://www.moneylineapp.com/docs

Response shape (verified live 2026-09-22):
  {"success": true, "data": [events]}
  event: eventId, leagueId, sport, homeTeamName, awayTeamName,
         startTime, players[]
  player: playerName, playerId, teamAbbr, teamName, markets[]
  market: marketType, marketName, format (over_under|over_only|yes_no),
          isAlternate, lines[]
  line: point (nullable for yes_no), offers[]
  offer: bookmakerId, bookmakerName, selection (Over|Under|Yes|No),
         price (American odds int), impliedProbability, lastUpdate, isBest

Only main (isAlternate=false) full-game lines map into canonical markets;
alternates, period splits (e.g. _q1), combo markets, and noncanonical
types are skipped, not guessed.

Free plan: 1,000 credits/month (1 credit per request). Auto-upgrade is OFF
on this account, so API access will be suspended if the credit limit is
exceeded. Pulls run 2x/day via run_twice_daily.sh (scheduled 2026-09-22);
keep each pull to one request per endpoint.
"""
from __future__ import annotations

import os

from ..base import BaseProvider, ProviderError
from ..schema import PropRecord, utcnow_iso

DEFAULT_BASE = "https://mlapi.bet"  # verified from official docs 2026-09-22

# Native MoneyLine marketType -> canonical stat, verified live 2026-09-22.
# Keys not listed here are skipped, not guessed: alternates (handled via
# isAlternate), period splits (_q1), combo markets (player_pass_rush_yds,
# player_rush_reception_yds/tds), player_tds_over ladders, player_last_td,
# player_pats, player_rush_longest, player_pass_longest_completion,
# player_solo_tackles/player_tackles_assists, and cross-sport spillover
# (e.g. player_assists under leagueId=nfl).
MONEYLINE_MARKETS: dict[str, str] = {
    "player_pass_yds": "pass_yards",
    "player_pass_tds": "pass_tds",
    "player_pass_completions": "pass_completions",
    "player_pass_attempts": "pass_attempts",
    "player_pass_interceptions": "pass_interceptions",
    "player_rush_yds": "rush_yards",
    "player_rush_attempts": "rush_attempts",
    "player_reception_yds": "rec_yards",
    "player_receptions": "receptions",
    "player_reception_longest": "longest_reception",
    "player_anytime_td": "anytime_td",
    "player_1st_td": "first_td",
    "player_sacks": "sacks",
    "player_kicking_points": "kicker_points",
    "player_field_goals": "field_goals_made",
}

# Binary scorer markets carry an implicit 0.5 line.
BINARY_STATS = {"anytime_td", "first_td"}


class MoneyLineProvider(BaseProvider):
    name = "moneyline"
    env_var = "MONEYLINE_API_KEY"
    status_note = "verified 2026-09-22: free 1,000 credits/mo (1 credit/req), auto-upgrade OFF, 2x/day automated pulls since 2026-09-22"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.base = os.environ.get("MONEYLINE_BASE_URL", DEFAULT_BASE).rstrip("/")

    def check_config(self) -> list[str]:
        problems = super().check_config()
        if self.base != DEFAULT_BASE:
            problems.append(f"{self.name}: MONEYLINE_BASE_URL override {self.base!r} "
                            "differs from the verified base https://mlapi.bet")
        return problems

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        payload = self._get(f"{self.base}/v1/player-props",
                            headers={"x-api-key": self.api_key},
                            params={"league": "nfl"})
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, list):
            raise ProviderError("unexpected /v1/player-props response shape")
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        for ev in data:
            if not isinstance(ev, dict):
                continue
            if ev.get("leagueId") != "nfl":
                continue  # league=nfl param returns everything; keep NFL only
            event_id = str(ev.get("eventId") or "")
            home = str(ev.get("homeTeamName") or "")
            away = str(ev.get("awayTeamName") or "")
            for player in ev.get("players") or []:
                records.extend(self._parse_player(
                    player, event_id, home, away, week, season, fetched))
        if not records:
            raise ProviderError("no canonical NFL prop records parsed from "
                                "/v1/player-props; shape may have changed")
        return records

    def _parse_player(self, player: dict, event_id: str, home: str,
                      away: str, week: int, season: int,
                      fetched: str) -> list[PropRecord]:
        if not isinstance(player, dict):
            return []
        name = str(player.get("playerName") or "").strip()
        if not name:
            return []
        team = str(player.get("teamAbbr") or player.get("teamName") or "")
        opponent = ""
        if home and away:
            pname = str(player.get("teamName") or "")
            if pname == home:
                opponent = away
            elif pname == away:
                opponent = home
        records: list[PropRecord] = []
        for market in player.get("markets") or []:
            if not isinstance(market, dict):
                continue
            if market.get("isAlternate"):
                continue  # main lines only
            stat = MONEYLINE_MARKETS.get(str(market.get("marketType") or ""))
            if stat is None:
                continue  # noncanonical/combo/period market: skip, don't guess
            for line in market.get("lines") or []:
                if not isinstance(line, dict):
                    continue
                records.extend(self._parse_line(
                    line, stat, name, team, opponent, event_id,
                    week, season, fetched))
        return records

    def _parse_line(self, line: dict, stat: str, name: str, team: str,
                    opponent: str, event_id: str, week: int, season: int,
                    fetched: str) -> list[PropRecord]:
        """One record per book per line; consensus groups by (player, stat)."""
        offers = line.get("offers") or []
        if not isinstance(offers, list) or not offers:
            return []
        point = line.get("point")
        if point is None:
            if stat not in BINARY_STATS:
                return []
            point = 0.5  # binary scorer markets carry an implicit 0.5 line
        try:
            line_val = float(point)
        except (TypeError, ValueError):
            return []
        # Group offers by book.
        books: dict[str, dict[str, int]] = {}
        order: list[str] = []
        for offer in offers:
            if not isinstance(offer, dict):
                continue
            book = str(offer.get("bookmakerName") or "").strip()
            if not book:
                continue
            sel = str(offer.get("selection") or "").lower()
            try:
                price = int(offer.get("price"))
            except (TypeError, ValueError):
                continue
            slot = books.setdefault(book, {})
            if book not in order:
                order.append(book)
            if sel in ("over", "yes"):
                slot.setdefault("over_odds", price)
            elif sel in ("under", "no"):
                slot.setdefault("under_odds", price)
        return [
            PropRecord(
                provider=self.name,
                book=book,
                player=name,
                team=team,
                opponent=opponent,
                game_id=f"moneyline:{event_id}",
                week=week,
                season=season,
                stat=stat,
                line=line_val,
                over_odds=books[book].get("over_odds"),
                under_odds=books[book].get("under_odds"),
                fetched_at=fetched,
            )
            for book in order
        ]
