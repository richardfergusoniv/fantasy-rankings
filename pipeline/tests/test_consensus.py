"""Tests: consensus math."""
from props_aggregator.consensus import build_consensus
from props_aggregator.schema import PropRecord


def _rec(provider, book, player, stat, line, over=-110, under=-110):
    return PropRecord(provider=provider, book=book, player=player, stat=stat,
                      line=line, over_odds=over, under_odds=under,
                      week=4, season=2026)


def test_median_book_count_spread():
    recs = [
        _rec("a", "dk", "Patrick Mahomes", "pass_yards", 285.5),
        _rec("b", "fd", "Patrick Mahomes", "pass_yards", 280.5),
        _rec("c", "mgm", "Patrick Mahomes", "pass_yards", 290.5),
    ]
    out = build_consensus(recs)
    assert len(out) == 1
    row = out[0]
    assert row["consensus_line"] == 285.5
    assert row["book_count"] == 3
    assert row["line_spread"] == 10.0
    assert row["provider_count"] == 3
    assert row["record_count"] == 3


def test_player_name_normalization_groups():
    recs = [
        _rec("a", "dk", "Patrick Mahomes", "pass_yards", 285.5),
        _rec("b", "fd", "  patrick   mahomes ", "pass_yards", 280.5),
    ]
    out = build_consensus(recs)
    assert len(out) == 1
    assert out[0]["book_count"] == 2


def test_distinct_stats_stay_separate():
    recs = [
        _rec("a", "dk", "Josh Allen", "pass_yards", 260.5),
        _rec("a", "dk", "Josh Allen", "rush_yards", 40.5),
    ]
    out = build_consensus(recs)
    assert len(out) == 2


def test_alt_line_ladder_collapses_to_one_vote():
    # One book posts a ladder, others post a single line each.
    recs = [
        _rec("a", "dk", "Jordan Love", "pass_yards", 227.5),
        _rec("b", "fd", "Jordan Love", "pass_yards", 226.5),
        _rec("c", "mgm", "Jordan Love", "pass_yards", 228.5),
    ]
    for line in (149.5, 199.5, 224.5, 249.5, 299.5, 349.5):
        recs.append(_rec("d", "pick6", "Jordan Love", "pass_yards", line))
    out = build_consensus(recs)
    assert len(out) == 1
    row = out[0]
    # 4 books vote; the ladder book's vote is the rung nearest the anchor
    # (anchor 228.0 -> rung 224.5; votes 224.5/226.5/227.5/228.5).
    assert row["book_count"] == 4
    assert row["record_count"] == 9
    assert row["alt_lines_filtered"] == 5
    assert row["consensus_line"] == 227.0
    assert row["line_spread"] == 4.0
    assert row["contested"] is False


def test_junk_line_from_multi_line_book_is_dropped():
    recs = [
        _rec("a", "dk", "Jordan Love", "pass_yards", 227.5),
        _rec("b", "fd", "Jordan Love", "pass_yards", 226.5),
        _rec("c", "pick6", "Jordan Love", "pass_yards", 0.5),
        _rec("c", "pick6", "Jordan Love", "pass_yards", 227.5),
    ]
    out = build_consensus(recs)
    row = out[0]
    assert row["book_count"] == 3
    assert row["consensus_line"] == 227.5
    assert row["alt_lines_filtered"] == 1


def test_book_name_normalization_merges_case_variants():
    recs = [
        _rec("a", "DraftKings", "Patrick Mahomes", "pass_yards", 285.5),
        _rec("b", "draftkings", "Patrick Mahomes", "pass_yards", 286.5),
        _rec("c", "Hard Rock Bet (FL)", "Patrick Mahomes", "pass_yards", 284.5),
        _rec("d", "hardrock", "Patrick Mahomes", "pass_yards", 287.5),
        _rec("e", "DraftKings Pick6", "Patrick Mahomes", "pass_yards", 285.5),
        _rec("f", "pick6", "Patrick Mahomes", "pass_yards", 283.5),
    ]
    out = build_consensus(recs)
    row = out[0]
    # draftkings x2 -> 1 vote, hardrock x2 -> 1 vote, pick6 x2 -> 1 vote
    assert row["book_count"] == 3
    assert row["alt_lines_filtered"] == 3


def test_player_team_suffix_is_stripped():
    recs = [
        _rec("a", "dk", "Michael Penix Jr. (ATL)", "pass_yards", 220.5),
        _rec("b", "fd", "Michael Penix Jr.", "pass_yards", 222.5),
    ]
    out = build_consensus(recs)
    assert len(out) == 1
    assert out[0]["player"] == "Michael Penix Jr."
    assert out[0]["book_count"] == 2


def test_contested_flag_on_drastic_disagreement():
    recs = [
        _rec("a", "dk", "Jordan Love", "pass_yards", 227.5),
        _rec("b", "fd", "Jordan Love", "pass_yards", 260.5),
    ]
    out = build_consensus(recs)
    assert out[0]["contested"] is True
    # Sanity: normal disagreement is not contested.
    recs2 = [
        _rec("a", "dk", "Jordan Love", "pass_yards", 227.5),
        _rec("b", "fd", "Jordan Love", "pass_yards", 228.5),
    ]
    assert build_consensus(recs2)[0]["contested"] is False


def test_odds_use_voted_records_only():
    recs = [
        _rec("a", "dk", "Jahmyr Gibbs", "anytime_td", 0.5, over=-300),
        _rec("b", "fd", "Jahmyr Gibbs", "anytime_td", 0.5, over=-250),
        _rec("c", "pick6", "Jahmyr Gibbs", "anytime_td", 0.5, over=-1000),
        _rec("c", "pick6", "Jahmyr Gibbs", "anytime_td", 1.5, over=-110),
    ]
    out = build_consensus(recs)
    row = out[0]
    assert row["book_count"] == 3
    # pick6's ladder vote is the 0.5 rung (nearest anchor); median of
    # [-300, -250, -1000] is -300.
    assert row["median_over_odds"] == -300
    assert row["alt_lines_filtered"] == 1


def test_single_book_ladder_votes_mid_ladder():
    # One book, no cross-book anchor: vote the book's own median line
    # instead of tie-breaking to an arbitrary rung.
    recs = [_rec("a", "pm", "Jayden Daniels", "pass_tds", line)
            for line in (0.5, 1.5, 2.5, 3.5)]
    out = build_consensus(recs)
    row = out[0]
    assert row["book_count"] == 1
    assert row["consensus_line"] == 2.0


def test_td_probability_is_median_of_per_book_probs():
    # Books straddling -110/+100: median odds near zero would convert to
    # ~0%, but the median of implied probabilities stays sane.
    recs = [
        _rec("a", "dk", "David Montgomery", "anytime_td", 0.5, over=-110),
        _rec("b", "fd", "David Montgomery", "anytime_td", 0.5, over=-105),
        _rec("c", "mgm", "David Montgomery", "anytime_td", 0.5, over=105),
        _rec("d", "bov", "David Montgomery", "anytime_td", 0.5, over=110),
    ]
    out = build_consensus(recs)
    row = out[0]
    # probs: 52.4%, 51.2%, 48.8%, 47.6% -> median 50.0%
    assert abs(row["td_probability"] - 0.5) < 0.02
    assert row["td_probability"] > 0.4  # not the ~0% the old path produced
