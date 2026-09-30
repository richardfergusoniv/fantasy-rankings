"""Consensus builder: one book, one vote.

Alt-line ladders (one book posting 149.5/174.5/199.5/... for the same
player/stat) are filtered structurally rather than by distance threshold:
each book casts exactly one vote -- the rung nearest the cross-book anchor.
Books that post a single line vote that line. The consensus line is the
median of book votes, so it only gets more robust as more books are added.

A ``contested`` flag marks rows where the surviving book votes still
disagree drastically. It is observability only and never changes the
consensus line.
"""
from __future__ import annotations

import re
from statistics import median

from .schema import PropRecord, normalize_player, utcnow_iso


def _med(values: list[float]) -> float | None:
    vals = [v for v in values if v is not None]
    return float(median(vals)) if vals else None


# Provider spellings of the same book, after generic cleanup below.
BOOK_ALIASES = {
    "hardrockbet": "hardrock",
    "draftkingspick6": "pick6",
    "betonlineag": "betonline",
    "betparx": "parx",
}


def normalize_book(name: str) -> str:
    """Key used to group the same book across providers.

    "DraftKings" and "draftkings" are the same book; so are "Hard Rock Bet",
    "Hard Rock Bet (FL)" and "hardrock".
    """
    n = (name or "").strip().lower()
    n = re.sub(r"\(.*?\)", "", n)  # "Hard Rock Bet (FL)" -> "Hard Rock Bet"
    n = re.sub(r"[^a-z0-9]", "", n)  # "BetOnline.ag" -> "betonlineag"
    return BOOK_ALIASES.get(n, n)


# A surviving vote spread wider than this means the books genuinely
# disagree. Flag only; the median still stands.
DRASTIC_SPREAD = {
    "pass_yards": 20.0,
    "rush_yards": 15.0,
    "rec_yards": 15.0,
    "longest_reception": 10.0,
    "receptions": 2.0,
    "pass_attempts": 5.0,
    "pass_completions": 5.0,
    "rush_attempts": 4.0,
    "pass_tds": 1.5,
    "pass_interceptions": 1.0,
    "kicker_points": 3.0,
    "field_goals_made": 1.5,
    "sacks": 1.5,
    "tackles": 4.0,
}
DRASTIC_TD_PROB_SPREAD = 0.15


def _american_to_prob(odds: int | None) -> float | None:
    if odds is None:
        return None
    o = float(odds)
    if o > 0:
        return 100.0 / (o + 100.0)
    if o < 0:
        return -o / (-o + 100.0)
    return 0.5


def _book_votes(recs: list[PropRecord]) -> tuple[list[tuple[float, PropRecord]], float]:
    """Collapse each book's records to a single vote.

    Returns (votes, anchor); each vote is a (line, record) pair. Two
    passes: every book's provisional vote is the median of its own lines;
    the anchor is the median of those. Each book's final vote is the rung
    nearest the anchor, which drops alt-line ladder rungs and junk lines
    (e.g. a stray 0.5) deterministically.

    With only one book there is no cross-book wisdom to draw on, so the
    book's own median line (mid-ladder) is the vote -- picking the nearest
    rung to it would tie-break arbitrarily.
    """
    by_book: dict[str, list[PropRecord]] = {}
    for r in recs:
        key = normalize_book(r.book) or f"provider:{r.provider}"
        by_book.setdefault(key, []).append(r)
    if len(by_book) == 1:
        only = next(iter(by_book.values()))
        mid = float(median([float(x.line) for x in only]))
        best = min(only, key=lambda x: (abs(float(x.line) - mid), float(x.line)))
        return [(mid, best)], mid
    provisional = {b: float(median([float(x.line) for x in rs]))
                   for b, rs in by_book.items()}
    anchor = float(median(provisional.values()))
    votes = []
    for rs in by_book.values():
        best = min(rs, key=lambda x: (abs(float(x.line) - anchor), float(x.line)))
        votes.append((float(best.line), best))
    return votes, anchor


def _display_book_names(votes: list[PropRecord]) -> list[str]:
    """Most common raw spelling per normalized book, for readable output."""
    from collections import Counter

    raw: dict[str, Counter] = {}
    for v in votes:
        key = normalize_book(v.book) or f"provider:{v.provider}"
        raw.setdefault(key, Counter())[v.book or v.provider] += 1
    return sorted(c.most_common(1)[0][0] for c in raw.values())


def build_consensus(records: list[PropRecord]) -> list[dict]:
    """Group by (player, stat); one book one vote; median wins."""
    groups: dict[tuple[str, str], list[PropRecord]] = {}
    display: dict[tuple[str, str], str] = {}
    for r in records:
        key = (normalize_player(r.player), r.stat)
        groups.setdefault(key, []).append(r)
        # Display name without a trailing team suffix like " (ATL)".
        disp = re.sub(r"\s*\(.*?\)\s*$", "", r.player.strip())
        display.setdefault(key, disp)

    out: list[dict] = []
    for key, recs in groups.items():
        player, stat = display[key], key[1]
        votes, anchor = _book_votes(recs)
        lines = [line for line, _ in votes]
        vote_recs = [rec for _, rec in votes]
        consensus_line = float(median(lines))
        spread = (max(lines) - min(lines)) if len(lines) > 1 else 0.0

        td_probability = None
        if stat == "anytime_td":
            # Median of per-book implied probabilities. Converting the
            # median odds instead corrupts markets whose books straddle
            # -110/+100, where the median odds land near zero and convert
            # to ~0%.
            probs = [p for p in
                     (_american_to_prob(r.over_odds) for r in vote_recs)
                     if p is not None]
            if probs:
                td_probability = float(median(probs))
            contested = (max(probs) - min(probs) > DRASTIC_TD_PROB_SPREAD) \
                if len(probs) > 1 else False
        else:
            contested = spread > DRASTIC_SPREAD.get(stat, float("inf"))

        providers = sorted({r.provider for r in recs})
        teams = sorted({r.team for r in recs if r.team})
        opponents = sorted({r.opponent for r in recs if r.opponent})
        out.append({
            "player": player,
            "team": teams[0] if len(teams) == 1 else "",
            "opponent": opponents[0] if len(opponents) == 1 else "",
            "stat": stat,
            "consensus_line": consensus_line,
            "anchor_line": anchor,
            "line_spread": spread,
            "book_count": len(votes),
            "books": _display_book_names(vote_recs),
            "provider_count": len(providers),
            "providers": providers,
            "record_count": len(recs),
            "alt_lines_filtered": len(recs) - len(votes),
            "contested": contested,
            "td_probability": td_probability,
            "median_over_odds": _med([r.over_odds for r in vote_recs]),
            "median_under_odds": _med([r.under_odds for r in vote_recs]),
            "week": recs[0].week,
            "season": recs[0].season,
            "built_at": utcnow_iso(),
        })
    out.sort(key=lambda d: (d["player"], d["stat"]))
    return out
