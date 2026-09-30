"""Stat Pick API — keyless prop-research board (verified live 2026-09-22).

Base: https://api.statpick.ai (no key, no signup)
  GET /api/nfl/prop-pages/slate                  -> games + recentlyActive players
  GET /api/nfl/prop-pages/player/{playerSlug}    -> player, nextGame, stats[]

Each stat carries line{line, overOdds, underOdds, bookCount, asOfDate}.
This is a cross-book consensus line, not per-book odds, so `book` records
the aggregation (e.g. "consensus(5)").
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from ..base import BaseProvider
from ..markets import STATPICK_SLUGS, map_market
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.statpick.ai"

# Stat Pick is keyless with no published rate limit. Player pages are
# independent of each other, so fetch them concurrently — the old
# sequential loop was the slowest step in the whole pull.
STATPICK_MAX_WORKERS = 10


class StatPickProvider(BaseProvider):
    name = "statpick"
    env_var = None
    requires_key = False
    status_note = "keyless; live-verified 2026-09-22"

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        slate = self._get(f"{BASE}/api/nfl/prop-pages/slate")
        data = slate.get("data") or {}
        active = data.get("recentlyActive") or []
        slugs = [e.get("playerSlug") for e in active if e.get("playerSlug")]
        if not slugs:
            # recentlyActive is sometimes empty (seen 2026-09-24); fall back
            # to the per-game player lists, which carry the same playerSlug
            # keys used by the per-player pages.
            seen: set[str] = set()
            for game in data.get("games") or []:
                for player in game.get("players") or []:
                    slug = player.get("playerSlug")
                    if slug and slug not in seen:
                        seen.add(slug)
                        slugs.append(slug)
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        with ThreadPoolExecutor(max_workers=STATPICK_MAX_WORKERS) as pool:
            futures = {pool.submit(self._fetch_player, slug): slug
                       for slug in slugs}
            for fut in as_completed(futures):
                try:
                    detail = fut.result()
                except Exception:
                    continue  # one bad player page must not kill the pull
                if detail:
                    records.extend(
                        self._parse_player(detail, week, season, fetched))
        return records

    def _fetch_player(self, slug: str) -> dict | None:
        try:
            return self._get(f"{BASE}/api/nfl/prop-pages/player/{slug}")
        except Exception:
            return None  # one bad player page must not kill the pull

    def _parse_player(self, payload: dict, week: int, season: int,
                      fetched: str) -> list[PropRecord]:
        data = payload.get("data") or {}
        player = data.get("player") or {}
        game = data.get("nextGame") or {}
        name = player.get("playerName") or ""
        team = player.get("teamAbbr") or ""
        opponent = game.get("opponentAbbr") or ""
        game_id = f"statpick:{player.get('playerSlug', '')}:{game.get('date', '')}"
        season_val = data.get("season") or season
        records: list[PropRecord] = []
        for stat in data.get("stats") or []:
            canon = map_market(STATPICK_SLUGS, stat.get("statSlug", ""))
            if canon is None:
                continue
            line = stat.get("line") or {}
            try:
                point = float(line.get("line"))
            except (TypeError, ValueError):
                continue
            book_count = line.get("bookCount")
            records.append(PropRecord(
                provider=self.name,
                book=f"consensus({book_count})" if book_count else "consensus",
                player=name,
                team=team,
                opponent=opponent,
                game_id=game_id,
                week=week,
                season=int(season_val) if isinstance(season_val, int) else season,
                stat=canon,
                line=point,
                over_odds=line.get("overOdds"),
                under_odds=line.get("underOdds"),
                fetched_at=fetched,
            ))
        return records
