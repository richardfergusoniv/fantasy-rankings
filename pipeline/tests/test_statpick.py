"""Tests: Stat Pick parsing against a real captured payload."""
import json
import os

from props_aggregator.providers.statpick import StatPickProvider

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "fixtures",
                       "statpick_player.json")


def test_parse_player_payload():
    with open(FIXTURE) as f:
        payload = {"data": json.load(f)}
    provider = StatPickProvider()
    records = provider._parse_player(payload, week=4, season=2026,
                                     fetched="2026-09-22T00:00:00+00:00")
    assert len(records) == 2
    by_stat = {r.stat: r for r in records}
    py = by_stat["pass_yards"]
    assert py.player == "Matthew Stafford"
    assert py.team == "LAR"
    assert py.opponent == "DEN"
    assert py.line == 240.5
    assert py.over_odds == -114
    assert py.under_odds == -115
    assert py.book == "consensus(5)"
    assert py.season == 2026
    assert py.week == 4
    assert not py.validate(), py.validate()
    atd = by_stat["anytime_td"]
    assert atd.line == 0.5
    assert atd.over_odds == 2200
