"""SportsGameOdds API v2 (verified 2026-09-22).

Base: https://api.sportsgameodds.com/v2
Auth: x-api-key header (apiKey query param also works)
Free: Amateur plan, $0/mo, 2,500 objects/month (an object = one event
returned, NOT one odds entry — a full NFL /events pull is ~10-16 objects),
10 requests/min, 9 bookmakers, 8 leagues. Card required on file via Stripe
at signup despite $0. Exceeding limits returns 429, not charges.

  GET /events?leagueID=NFL&oddsAvailable=true[&oddID=..]

Events carry odds under Event.odds.<oddID>, where
  oddID = statID-statEntityID-periodID-betTypeID-sideID
e.g. points-home-game-ml-home. For player props the statEntityID is the
player (e.g. AUSTIN_HOOPER_1_NFL), periodID is "game", betTypeID is "ou"
(over/under with an overUnder line) or "yn" (yes/no binary, used by
firstTouchdown), sideID is "over"/"under"/"yes". Per-book data lives at
Event.odds.<oddID>.byBookmaker.<bookmakerID> with American odds under "odds".

statID values for NFL player props were discovered live 2026-09-22; the
table lives in markets.SGO_STAT_IDS and misses are skipped, never guessed.
"""
from __future__ import annotations

import re

from ..base import BaseProvider
from ..markets import SGO_STAT_IDS
from ..schema import PropRecord, utcnow_iso

BASE = "https://api.sportsgameodds.com/v2"

TEAM_ENTITIES = {"home", "away", "all"}


def _parse_odd_id(odd_id: str):
    parts = odd_id.split("-")
    if len(parts) != 5:
        return None
    stat_id, entity_id, period_id, bet_type_id, side_id = parts
    return stat_id, entity_id, period_id, bet_type_id, side_id


def _first(d: dict, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d.get(k)
    return None


def _clean_entity(entity_id: str) -> str:
    # AUSTIN_HOOPER_1_NFL -> Austin Hooper
    name = re.sub(r"_\d+_[A-Z]+$", "", entity_id)
    return name.replace("_", " ").title()


def _american(v) -> int | None:
    # "+5500" / "-110" -> 5500 / -110; anything else -> None
    try:
        s = str(v).strip()
    except Exception:
        return None
    if not s or s[0] not in "+-":
        return None
    try:
        return int(s)
    except ValueError:
        return None


class SportsGameOddsProvider(BaseProvider):
    name = "sportsgameodds"
    env_var = "SPORTSGAMEODDS_API_KEY"
    status_note = "free $0/mo, 2500 objects/mo; statIDs discovered live 2026-09-22"

    def _headers(self) -> dict:
        return {"x-api-key": self.api_key}

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        payload = self._get(f"{BASE}/events", headers=self._headers(),
                            params={"leagueID": "NFL", "oddsAvailable": "true"})
        events = (payload.get("data") if isinstance(payload, dict) else payload) or []
        records: list[PropRecord] = []
        fetched = utcnow_iso()
        # legs keyed by (event, player, stat, line) -> {"over": {...}, "under": {...}}
        legs: dict[tuple, dict] = {}
        for ev in events:
            event_id = str(ev.get("eventID") or ev.get("id") or "")
            odds = ev.get("odds") or {}
            for odd_id, node in odds.items():
                parsed = _parse_odd_id(odd_id)
                if not parsed:
                    continue
                stat_id, entity_id, period_id, bet_type_id, side_id = parsed
                if period_id != "game":
                    continue
                if entity_id.lower() in TEAM_ENTITIES:
                    continue
                stat = SGO_STAT_IDS.get(stat_id)
                if stat is None:
                    continue  # unknown or noncanonical statID: skip, don't guess
                side = side_id.lower()
                binary_yes = False
                if bet_type_id == "ou":
                    if side not in ("over", "under"):
                        continue
                elif bet_type_id == "yn" and side == "yes" and stat == "first_td":
                    binary_yes = True  # first-TD yes -> implicit 0.5 line
                else:
                    continue
                player = _clean_entity(entity_id)
                books = (node or {}).get("byBookmaker") or {}
                for book_id, b in books.items():
                    if binary_yes:
                        point = 0.5
                    else:
                        try:
                            point = float(_first(b, "overUnder", "point",
                                                "line", "handicap"))
                        except (TypeError, ValueError):
                            continue
                    price = _american(_first(b, "price", "odds", "american", "us"))
                    legs.setdefault(
                        (event_id, player, stat, point, str(book_id)),
                        {})["over" if binary_yes else side] = price
        for (event_id, player, stat, point, book), sides in legs.items():
            records.append(PropRecord(
                provider=self.name,
                book=book,
                player=player,
                game_id=f"sportsgameodds:{event_id}",
                week=week,
                season=season,
                stat=stat,
                line=point,
                over_odds=sides.get("over"),
                under_odds=sides.get("under"),
                fetched_at=fetched,
            ))
        return records
