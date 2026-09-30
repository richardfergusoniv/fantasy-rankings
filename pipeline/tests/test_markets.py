"""Tests: market mapping never guesses."""
from props_aggregator.markets import (ODDSAPIIO_LABELS, RAPIDODDS_MARKETS,
                                      SGO_STAT_IDS, STATPICK_SLUGS,
                                      THEODDSAPI_MARKETS, map_market)


def test_theoddsapi_core_markets():
    assert map_market(THEODDSAPI_MARKETS, "player_pass_yds") == "pass_yards"
    assert map_market(THEODDSAPI_MARKETS, "player_anytime_td") == "anytime_td"
    assert map_market(THEODDSAPI_MARKETS, "player_1st_td") == "first_td"


def test_unknown_market_returns_none():
    for m in (THEODDSAPI_MARKETS, STATPICK_SLUGS, ODDSAPIIO_LABELS,
              SGO_STAT_IDS, RAPIDODDS_MARKETS):
        assert map_market(m, "definitely_not_a_market") is None


def test_statpick_slugs():
    assert map_market(STATPICK_SLUGS, "passing-yards") == "pass_yards"
    assert map_market(STATPICK_SLUGS, "rush-rec-yards") is None  # combo: skip


def test_ladder_market_skipped():
    assert map_market(THEODDSAPI_MARKETS, "player_2plus_td") is None
