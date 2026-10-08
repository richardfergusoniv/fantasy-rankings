"""Vegas-based fantasy projections.

Converts consensus prop lines into expected fantasy points for each of
Richard's six Sleeper leagues, using each league's actual scoring_settings.

Design (per Richard's direction 2026-09-22):
- The market line IS the expectation: a pass_yards line of 240.5 means the
  market expects ~240.5 passing yards. No in-house model on top.
- TD expectation comes from no-vig-ish anytime-TD probability derived from
  the consensus over odds. first_td markets are NOT double-counted.
- Kicker projection uses the kicker_points market line directly (it is
  already an expected-fantasy-points number).
- Players with no prop coverage get no Vegas projection (never fabricated);
  downstream consumers should fall back to their existing source.

Known v1 limitations (documented, not silently fudged):
- Dynastical Cucks scores 0.5 per receiving/rushing first down (PPFD). Prop
  markets don't price first downs, so per Richard's approved PPR proxy each
  reception also earns the rec_fd value (effective 1.0/rec in Cucks), shown
  as a separate rec_fd_proxy component. rush_fd is omitted: no
  rushing-attempts market exists, and estimating attempts from a yards line
  would be fabrication.
- C2C yardage bonuses (200+ rush/rec, 400+ pass) are omitted; the expected
  bonus value off a median line is small and estimating tail probability
  from a line alone would be fabrication.
- Anytime-TD probability uses the raw over-odds implied probability; with
  only one side of the market quoted we cannot remove the vig.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SLEEPER_BASE = "https://api.sleeper.app/v1"

# stat -> (scoring key, kind) ; kind "line" multiplies consensus_line,
# "prob" uses TD probability, "direct" takes consensus_line as-is.
STAT_MAP = {
    "pass_yards": ("pass_yd", "line"),
    "pass_tds": ("pass_td", "line"),
    "pass_interceptions": ("pass_int", "line"),
    "rush_yards": ("rush_yd", "line"),
    "receptions": ("rec", "line"),
    "rec_yards": ("rec_yd", "line"),
    "anytime_td": (None, "prob"),
    "kicker_points": (None, "direct"),
}


def american_to_prob(odds: float | None) -> float | None:
    if odds is None:
        return None
    o = float(odds)
    if o > 0:
        return 100.0 / (o + 100.0)
    if o < 0:
        return -o / (-o + 100.0)
    return 0.5


def has_sufficient_coverage(position: str | None, stats: set[str]) -> bool:
    """Completeness gate: only produce a Vegas projection when the market
    covers enough components for a defensible full fantasy total.

    Players failing this gate are excluded from the output so downstream
    consumers fall back to Sleeper (existing pregame source). This prevents
    misleadingly low totals like TD-only lines (e.g. Brock Bowers 1.88).
    """
    if position == "QB":
        return "pass_yards" in stats and "pass_tds" in stats
    if position == "RB":
        return ("rush_yards" in stats and "anytime_td" in stats
                and ("receptions" in stats or "rec_yards" in stats))
    if position in ("WR", "TE"):
        return ("rec_yards" in stats and "receptions" in stats
                and "anytime_td" in stats)
    if position == "K":
        return "kicker_points" in stats
    # UNK / other positions: not enough signal to judge completeness;
    # default to Sleeper rather than guess.
    return False


# provider nickname -> Sleeper full-name spelling
NAME_ALIASES = {
    "hollywood brown": "marquise brown",
    "josh palmer": "joshua palmer",
    "christopher brooks": "chris brooks",
    "matthew hibner": "matt hibner",
}

# full team name -> abbreviation, for the opponent field
TEAM_ABBR = {
    "arizona cardinals": "ARI", "atlanta falcons": "ATL", "baltimore ravens": "BAL",
    "buffalo bills": "BUF", "carolina panthers": "CAR", "chicago bears": "CHI",
    "cincinnati bengals": "CIN", "cleveland browns": "CLE", "dallas cowboys": "DAL",
    "denver broncos": "DEN", "detroit lions": "DET", "green bay packers": "GB",
    "houston texans": "HOU", "indianapolis colts": "IND", "jacksonville jaguars": "JAX",
    "kansas city chiefs": "KC", "las vegas raiders": "LV", "los angeles chargers": "LAC",
    "los angeles rams": "LAR", "miami dolphins": "MIA", "minnesota vikings": "MIN",
    "new england patriots": "NE", "new orleans saints": "NO", "new york giants": "NYG",
    "new york jets": "NYJ", "philadelphia eagles": "PHI", "pittsburgh steelers": "PIT",
    "san francisco 49ers": "SF", "seattle seahawks": "SEA", "tampa bay buccaneers": "TB",
    "tennessee titans": "TEN", "washington commanders": "WAS",
}


def abbr_team(name: str | None) -> str | None:
    if not name:
        return None
    n = name.strip()
    if len(n) <= 3 and n.isupper():
        return n
    return TEAM_ABBR.get(n.lower(), n[:12])


def normalize_name(name: str) -> str:
    n = name.lower().strip()
    n = re.sub(r"\s*\([^)]*\)\s*", " ", n)  # "Bijan Robinson (ATL)"
    n = n.strip()
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?$", "", n).strip()
    n = n.replace(".", "").replace("'", "").replace("-", " ")
    n = re.sub(r"\s+", " ", n)
    return NAME_ALIASES.get(n, n)


def lookup_position(name: str, positions: dict[str, dict]) -> dict:
    """Position lookup tolerant of hyphen/space differences ('Amon-Ra' vs 'Amonra')."""
    key = normalize_name(name)
    hit = positions.get(key)
    if hit:
        return hit
    return positions.get(key.replace(" ", ""), {})


def load_leagues(data_dir: Path = DATA_DIR, refresh: bool = False) -> list[dict]:
    cache = data_dir / "leagues_2026.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())
    owner_id = os.environ.get("OWNER_SLEEPER_USER_ID", "").strip()
    if not owner_id:
        raise RuntimeError("OWNER_SLEEPER_USER_ID is not set")
    resp = requests.get(f"{SLEEPER_BASE}/user/{owner_id}/leagues/nfl/2026",
                        timeout=30)
    resp.raise_for_status()
    leagues = [
        {
            "league_id": l["league_id"],
            "name": l["name"],
            "scoring_settings": l["scoring_settings"],
        }
        for l in resp.json()
    ]
    cache.write_text(json.dumps(leagues, indent=1))
    return leagues


def load_player_positions(data_dir: Path = DATA_DIR, refresh: bool = False) -> dict[str, dict]:
    """Sleeper player map: normalized name -> {position, team}."""
    cache = data_dir / "sleeper_players_2026.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())
    resp = requests.get(f"{SLEEPER_BASE}/players/nfl", timeout=60)
    resp.raise_for_status()
    mapping: dict[str, dict] = {}
    for pid, p in resp.json().items():
        full = p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip()
        if not full:
            continue
        entry = {
            "position": p.get("position"),
            "team": p.get("team"),
            "sleeper_id": pid,
            # Sleeper-canonical spelling, used as the emitted display name so
            # the artifact matches its own player index exactly.
            "full_name": full,
        }
        for key in {normalize_name(full), normalize_name(full).replace(" ", "")}:
            # on collision prefer the entry attached to an NFL team
            # (avoids stale duplicates like practice-squad namesakes)
            if key not in mapping or (not mapping[key].get("team") and entry.get("team")):
                mapping[key] = entry
    cache.write_text(json.dumps(mapping))
    return mapping


def build_projections(consensus_rows: list[dict], leagues: list[dict],
                      positions: dict[str, dict]) -> list[dict]:
    by_player: dict[str, dict[str, dict]] = {}
    meta: dict[str, dict] = {}
    for row in consensus_rows:
        stat = row.get("stat")
        if stat not in STAT_MAP:
            continue
        player = row.get("player") or ""
        by_player.setdefault(player, {})[stat] = row
        m = meta.setdefault(player, {"team": row.get("team") or "",
                                     "opponent": row.get("opponent") or "",
                                     "provider_count": 0,
                                     "book_count": 0,
                                     "stats": []})
        m["provider_count"] = max(m["provider_count"], row.get("provider_count") or 0)
        m["book_count"] = max(m["book_count"], row.get("book_count") or 0)
        if stat not in m["stats"]:
            m["stats"].append(stat)

    projections = []
    # merge provider spelling variants of the same player (same Sleeper id)
    merged: dict[str, dict[str, dict]] = {}
    merged_meta: dict[str, dict] = {}
    order: dict[str, str] = {}  # merge key -> display name
    for player, stats in sorted(by_player.items()):
        pos_info = lookup_position(player, positions)
        position = pos_info.get("position")
        # DST rows sometimes leak into player-prop feeds; not projectable here
        if position == "DEF" or "defense" in player.lower() or "def/st" in player.lower():
            continue
        key = pos_info.get("sleeper_id") or f"name:{normalize_name(player)}"
        if key not in merged:
            merged[key] = {}
            merged_meta[key] = {"team": "", "opponent": "", "provider_count": 0,
                                "book_count": 0, "stats": []}
            # Sleeper-canonical display name so the artifact matches its own
            # player index exactly (fixes e.g. "Josh Palmer" vs "Joshua Palmer").
            order[key] = pos_info.get("full_name") or player
        dest, mm = merged[key], merged_meta[key]
        for stat, row in stats.items():
            # on conflict keep the row with broader book coverage
            if stat not in dest or (row.get("book_count") or 0) > (dest[stat].get("book_count") or 0):
                dest[stat] = row
        mm["team"] = mm["team"] or meta[player]["team"] or ""
        mm["opponent"] = mm["opponent"] or meta[player]["opponent"] or ""
        mm["provider_count"] = max(mm["provider_count"], meta[player]["provider_count"])
        mm["book_count"] = max(mm["book_count"], meta[player]["book_count"])
        for s in meta[player]["stats"]:
            if s not in mm["stats"]:
                mm["stats"].append(s)

    for key in sorted(merged, key=lambda k: order[k].lower()):
        player = order[key]
        stats = merged[key]
        pos_info = lookup_position(player, positions)
        position = pos_info.get("position")
        # Completeness gate (per Richard 2026-09-23): players without enough
        # market coverage get no Vegas projection; downstream falls back to
        # Sleeper instead of showing a misleading partial total.
        if not has_sufficient_coverage(position, set(merged_meta[key]["stats"])):
            continue
        team = merged_meta[key]["team"] or pos_info.get("team") or ""

        expected: dict[str, float] = {}
        td_prob: float | None = None
        for stat, row in stats.items():
            _, kind = STAT_MAP[stat]
            if kind == "line":
                expected[stat] = float(row["consensus_line"])
            elif kind == "prob":
                # Prefer the consensus's median of per-book implied
                # probabilities; converting the median odds instead
                # corrupts markets whose books straddle -110/+100.
                td_prob = row.get("td_probability")
                if td_prob is None:
                    td_prob = american_to_prob(row.get("median_over_odds"))
            elif kind == "direct":
                expected[stat] = float(row["consensus_line"])

        per_league: dict[str, float] = {}
        components: dict[str, dict[str, float]] = {}
        for league in leagues:
            s = league["scoring_settings"]
            lid = league["league_id"]
            rec_mult = float(s.get("rec", 0) or 0)
            rec_fd_mult = float(s.get("rec_fd", 0) or 0)
            total = 0.0
            comp: dict[str, float] = {}
            for stat, val in expected.items():
                score_key, kind = STAT_MAP[stat]
                if kind == "direct":  # kicker_points: already fantasy points
                    pts = val
                    if pts:
                        comp[stat] = round(pts, 2)
                elif stat == "receptions" and rec_fd_mult:
                    # PPR proxy for point-per-first-down leagues (approved by
                    # Richard 2026-09-23): prop markets don't price first
                    # downs, so each reception proxies one receiving first
                    # down and earns rec_fd on top of rec. rush_fd stays
                    # omitted: no rushing-attempts market exists.
                    rec_pts = val * rec_mult
                    fd_pts = val * rec_fd_mult
                    if rec_pts:
                        comp[stat] = round(rec_pts, 2)
                    if fd_pts:
                        comp["rec_fd_proxy"] = round(fd_pts, 2)
                    pts = rec_pts + fd_pts
                else:
                    pts = val * float(s.get(score_key, 0) or 0)
                    if pts:
                        comp[stat] = round(pts, 2)
                total += pts
            if td_prob is not None:
                td_key = "rush_td" if position == "QB" else "rec_td"
                td_pts = td_prob * float(s.get(td_key, 0) or 0)
                comp["anytime_td"] = round(td_pts, 2)
                total += td_pts
            per_league[lid] = round(total, 2)
            components[lid] = comp

        projections.append({
            "player": player,
            "team": abbr_team(team) or "",
            # "UNK" when Sleeper has no listing; never fabricate a position
            "position": position or "UNK",
            "opponent": abbr_team(merged_meta[key]["opponent"]),
            "expected_stats": {k: round(v, 2) for k, v in expected.items()},
            "td_probability": round(td_prob, 4) if td_prob is not None else None,
            "coverage": {
                "stats": sorted(merged_meta[key]["stats"]),
                "provider_count": merged_meta[key]["provider_count"],
                "book_count": merged_meta[key]["book_count"],
            },
            "leagues": per_league,
            "components": components,
        })
    return projections


def project_week(week: int, season: int = 2026,
                 data_dir: Path = DATA_DIR) -> Path:
    consensus_path = data_dir / f"consensus_{season}_w{week}.json"
    payload = json.loads(consensus_path.read_text())
    leagues = load_leagues(data_dir)
    positions = load_player_positions(data_dir)
    projections = build_projections(payload["consensus"], leagues, positions)
    out = {
        "season": season,
        "week": week,
        "built_at": (payload.get("built_at") or "").replace("+00:00", "Z"),
        "source": "vegas-consensus",
        "method": ("consensus prop lines as expected stats; anytime-TD over-odds "
                   "as TD probability; scored through each league's Sleeper "
                   "scoring_settings. Players lacking sufficient market coverage "
                   "for their position are excluded (Sleeper fallback): "
                   "QB needs pass_yards+pass_tds; RB needs rush_yards+anytime_td "
                   "plus receptions or rec_yards; WR/TE need rec_yards+receptions+"
                   "anytime_td; K needs kicker_points. Point-per-first-down "
                   "leagues use the approved PPR proxy (each reception also "
                   "earns rec_fd, shown as rec_fd_proxy); rush_fd omitted (no "
                   "attempts market). C2C yardage bonuses omitted."),
        "leagues": [{"league_id": l["league_id"], "name": l["name"]}
                    for l in leagues],
        "projections": projections,
    }
    out_path = data_dir / f"projections_{season}_w{week}.json"
    out_path.write_text(json.dumps(out))
    return out_path
