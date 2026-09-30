"""Tests: the-odds-api shaped payload parsing."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "fixtures"))

from oddsapi_shape import FIXTURE  # noqa: E402

from props_aggregator.providers._oddsapi_shape import parse_event_odds  # noqa: E402


def test_parse_pairs_over_under():
    recs = parse_event_odds(FIXTURE, provider="propline", week=4, season=2026,
                            game_id="propline:1")
    assert len(recs) == 3  # unknown market skipped
    by_player = {r.player: r for r in recs}
    mahomes = by_player["Patrick Mahomes"]
    assert mahomes.stat == "pass_yards"
    assert mahomes.line == 285.5
    assert mahomes.over_odds == -110
    assert mahomes.under_odds == -110
    assert mahomes.book == "draftkings"
    assert not mahomes.validate(), mahomes.validate()


def test_yes_no_maps_to_over_under():
    recs = parse_event_odds(FIXTURE, provider="propline", week=4, season=2026)
    kelce = next(r for r in recs if r.player == "Travis Kelce")
    assert kelce.stat == "anytime_td"
    assert kelce.line == 0.5
    assert kelce.over_odds == -140
    assert kelce.under_odds == 110
