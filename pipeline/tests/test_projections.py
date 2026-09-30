"""Tests: Vegas projections converter (league scoring, PPR proxy, names)."""
from props_aggregator.projections import build_projections

CUCKS = "1306489414548979712"   # Dynastical Cucks: 0.5 PPR + 0.5 PPFD
HALF_PPR = "1389344450517430272"  # NY Sack Exchange II: 0.5 PPR, no FD

LEAGUES = [
    {"league_id": CUCKS, "name": "Dynastical Cucks",
     "scoring_settings": {"rec": 0.5, "rec_fd": 0.5, "rush_fd": 0.5,
                          "rec_yd": 0.1, "rush_yd": 0.1, "pass_yd": 0.04,
                          "rec_td": 6.0, "rush_td": 6.0, "pass_td": 4.0}},
    {"league_id": HALF_PPR, "name": "NY Sack Exchange II",
     "scoring_settings": {"rec": 0.5, "rec_yd": 0.1, "rush_yd": 0.1,
                          "pass_yd": 0.04, "rec_td": 6.0, "rush_td": 6.0,
                          "pass_td": 4.0}},
]


def _row(player, stat, line=None, td_prob=None):
    r = {"player": player, "stat": stat, "team": "BUF", "opponent": "MIA",
         "provider_count": 3, "book_count": 5}
    if line is not None:
        r["consensus_line"] = line
    if td_prob is not None:
        r["td_probability"] = td_prob
    return r


def _wr_rows(player="Josh Palmer"):
    return [
        _row(player, "rec_yards", line=41.5),
        _row(player, "receptions", line=3.5),
        _row(player, "anytime_td", td_prob=0.3433),
    ]


POSITIONS = {
    "joshua palmer": {"position": "WR", "team": "BUF", "sleeper_id": "7670",
                      "full_name": "Joshua Palmer"},
}


def _proj(rows, positions):
    out = build_projections(rows, LEAGUES, positions)
    assert len(out) == 1
    return out[0]


def test_ppr_proxy_cucks_receptions_score_full_point():
    """Cucks: each reception earns rec (0.5) + rec_fd proxy (0.5)."""
    p = _proj(_wr_rows(), POSITIONS)
    cucks = p["leagues"][CUCKS]
    # 41.5*0.1 + 3.5*1.0 + 0.3433*6 = 4.15 + 3.5 + 2.06 = 9.71
    assert cucks == 9.71
    comp = p["components"][CUCKS]
    assert comp["receptions"] == 1.75
    assert comp["rec_fd_proxy"] == 1.75
    assert comp["rec_yards"] == 4.15
    assert comp["anytime_td"] == 2.06


def test_no_proxy_in_non_ppfd_league():
    p = _proj(_wr_rows(), POSITIONS)
    half = p["leagues"][HALF_PPR]
    # 4.15 + 3.5*0.5 + 2.06 = 7.96
    assert half == 7.96
    assert "rec_fd_proxy" not in p["components"][HALF_PPR]


def test_rush_fd_omitted_not_fabricated():
    """No rushing-attempts market: rush_fd never appears as a component."""
    rows = [
        _row("James Cook", "rush_yards", line=65.5),
        _row("James Cook", "receptions", line=2.5),
        _row("James Cook", "anytime_td", td_prob=0.45),
    ]
    positions = {"james cook": {"position": "RB", "team": "BUF",
                                "sleeper_id": "9999", "full_name": "James Cook"}}
    p = _proj(rows, positions)
    for lid in (CUCKS, HALF_PPR):
        assert "rush_fd" not in p["components"][lid]
        assert "rush_fd_proxy" not in p["components"][lid]


def test_display_name_uses_sleeper_canonical():
    """'Josh Palmer' is emitted as Sleeper's 'Joshua Palmer'."""
    p = _proj(_wr_rows("Josh Palmer"), POSITIONS)
    assert p["player"] == "Joshua Palmer"


def test_display_name_falls_back_to_raw_when_unknown():
    rows = _wr_rows("Some Obscure Guy")
    positions = {"some obscure guy": {"position": "WR", "team": None,
                                      "sleeper_id": None}}
    p = _proj(rows, positions)
    assert p["player"] == "Some Obscure Guy"
