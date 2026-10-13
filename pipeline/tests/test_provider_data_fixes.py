"""Unit tests for CodeRabbit data/props audit fixes (no network)."""
from __future__ import annotations

from props_aggregator.providers.parlayapi import ParlayAPIProvider
from props_aggregator.providers.rapidodds import RapidOddsProvider
from props_aggregator.providers.sharpapi import SharpAPIProvider
from props_aggregator.providers.sportsgameodds import SportsGameOddsProvider


class _StubParlay(ParlayAPIProvider):
    def __init__(self):
        super().__init__(api_key="test")


def test_parlayapi_falls_back_to_point_when_line_is_null():
    p = _StubParlay()
    rec = p._parse_flat_prop(
        {
            "period": "FULL",
            "market_key": "player_pass_yds",
            "player": "Patrick Mahomes",
            "line": None,
            "point": 275.5,
            "bookmaker": "draftkings",
            "over_price": -110,
            "under_price": -110,
        },
        week=6,
        season=2026,
    )
    assert rec is not None
    assert rec.line == 275.5
    assert rec.stat == "pass_yards"


def test_parlayapi_skips_non_td_without_valid_line():
    p = _StubParlay()
    assert (
        p._parse_flat_prop(
            {
                "period": "FULL",
                "market_key": "player_receptions",
                "player": "Travis Kelce",
                "line": None,
                "point": None,
                "bookmaker": "fanduel",
            },
            week=6,
            season=2026,
        )
        is None
    )


def test_parlayapi_td_markets_get_implicit_half_line():
    p = _StubParlay()
    rec = p._parse_flat_prop(
        {
            "period": "FULL",
            "market_key": "player_anytime_td",
            "player": "Travis Kelce",
            "line": None,
            "bookmaker": "draftkings",
            "over_price": -140,
        },
        week=6,
        season=2026,
    )
    assert rec is not None
    assert rec.line == 0.5
    assert rec.stat == "anytime_td"


def test_sportsgameodds_keeps_only_half_point_anytime_td():
    provider = SportsGameOddsProvider(api_key="test")

    def _get(*_a, **_k):
        # Same oddID can carry different overUnder per book; 1.5 is 2+ TDs.
        return {
            "data": [
                {
                    "eventID": "ev1",
                    "odds": {
                        "touchdowns-TRAVIS_KELCE_1_NFL-game-ou-over": {
                            "byBookmaker": {
                                "draftkings": {"overUnder": 0.5, "odds": "-140"},
                                "fanduel": {"overUnder": 1.5, "odds": "+350"},
                            }
                        },
                        "touchdowns-TRAVIS_KELCE_1_NFL-game-ou-under": {
                            "byBookmaker": {
                                "draftkings": {"overUnder": 0.5, "odds": "+110"},
                            }
                        },
                    },
                }
            ]
        }

    provider._get = _get  # type: ignore[method-assign]
    recs = provider.fetch_props(week=6, season=2026)
    anytime = [r for r in recs if r.stat == "anytime_td"]
    assert anytime, anytime
    assert all(r.line == 0.5 for r in anytime)
    assert not any(r.line == 1.5 for r in anytime)
    assert {r.book for r in anytime} == {"draftkings"}


def test_sportsgameodds_skips_1_5_only_anytime_td_book():
    provider = SportsGameOddsProvider(api_key="test")

    def _get(*_a, **_k):
        return {
            "data": [
                {
                    "eventID": "ev2",
                    "odds": {
                        "touchdowns-SAQUON_BARKLEY_1_NFL-game-ou-over": {
                            "byBookmaker": {
                                "draftkings": {"overUnder": 1.5, "odds": "+280"},
                            }
                        },
                        "touchdowns-SAQUON_BARKLEY_1_NFL-game-ou-under": {
                            "byBookmaker": {
                                "draftkings": {"overUnder": 1.5, "odds": "-360"},
                            }
                        },
                    },
                }
            ]
        }

    provider._get = _get  # type: ignore[method-assign]
    recs = provider.fetch_props(week=6, season=2026)
    assert [r for r in recs if r.stat == "anytime_td"] == []


def test_rapidodds_yes_no_do_not_overwrite():
    provider = RapidOddsProvider(api_key="test")

    def _get(*_a, **_k):
        return {
            "games": [
                {
                    "game": {
                        "home_team": "Chiefs",
                        "away_team": "Bills",
                        "commence_time": "2026-10-12T17:00:00Z",
                    },
                    "bookmakers": [
                        {
                            "name": "DraftKings",
                            "markets": [
                                {
                                    "key": "player_anytime_td",
                                    "outcomes": [
                                        {
                                            "name": "Yes",
                                            "price": 1.71,
                                            "point": 0.5,
                                            "player_name": "Travis Kelce",
                                        },
                                        {
                                            "name": "No",
                                            "price": 2.1,
                                            "point": 0.5,
                                            "player_name": "Travis Kelce",
                                        },
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }

    provider._get = _get  # type: ignore[method-assign]
    recs = provider.fetch_props(week=6, season=2026)
    assert len(recs) == 1
    assert recs[0].stat == "anytime_td"
    assert recs[0].over_odds is not None
    assert recs[0].under_odds is not None
    # Yes @ 1.71 decimal ≈ -141 American; No @ 2.1 ≈ +110
    assert recs[0].over_odds < 0
    assert recs[0].under_odds > 0


def test_rapidodds_skips_unrecognized_side():
    provider = RapidOddsProvider(api_key="test")

    def _get(*_a, **_k):
        return {
            "games": [
                {
                    "game": {
                        "home_team": "Chiefs",
                        "away_team": "Bills",
                        "commence_time": "2026-10-12T17:00:00Z",
                    },
                    "bookmakers": [
                        {
                            "name": "DraftKings",
                            "markets": [
                                {
                                    "key": "player_pass_yards",
                                    "outcomes": [
                                        {
                                            "name": "push",
                                            "price": 1.9,
                                            "point": 275.5,
                                            "player_name": "Patrick Mahomes",
                                        },
                                        {
                                            "name": "Over",
                                            "price": 1.91,
                                            "point": 275.5,
                                            "player_name": "Patrick Mahomes",
                                        },
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }

    provider._get = _get  # type: ignore[method-assign]
    recs = provider.fetch_props(week=6, season=2026)
    assert len(recs) == 1
    assert recs[0].over_odds is not None
    assert recs[0].under_odds is None


def test_sharpapi_grouping_keeps_distinct_players():
    provider = SharpAPIProvider(api_key="test")

    def _get(url, params=None, headers=None):  # noqa: ARG001
        market = (params or {}).get("market")
        if market != "anytime_touchdown_scorer":
            return {"data": [], "pagination": {"has_more": False}}
        return {
            "data": [
                {
                    "is_main_line": True,
                    "player_name": "Travis Kelce",
                    "selection_type": "other",
                    "odds_american": -140,
                    "event_id": "ev1",
                    "sportsbook": "DraftKings",
                },
                {
                    "is_main_line": True,
                    "player_name": "Rashee Rice",
                    "selection_type": "other",
                    "odds_american": 120,
                    "event_id": "ev1",
                    "sportsbook": "DraftKings",
                },
            ],
            "pagination": {"has_more": False},
        }

    provider._get = _get  # type: ignore[method-assign]
    recs = provider.fetch_props(week=6, season=2026)
    anytime = [r for r in recs if r.stat == "anytime_td"]
    players = {r.player for r in anytime}
    assert players == {"Travis Kelce", "Rashee Rice"}
    by_player = {r.player: r for r in anytime}
    assert by_player["Travis Kelce"].over_odds == -140
    assert by_player["Rashee Rice"].over_odds == 120
