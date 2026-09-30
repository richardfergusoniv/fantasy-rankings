#!/usr/bin/env python3
"""Build projections JSON from First Down Studio weekly rankings (fallback path).

Input:  JSON list of rows: {"position","rank","player","team","matchup","projected_points","components":{...}}
        via --rows. Also copies K rows verbatim from the latest Vegas projections file.
Output: data/projections_firstdown_2026_w{n}.json in the same format as the Vegas file,
        with all 6 leagues, source tagged "first_down". Requires >=150 players or exits 1.

Name normalization: canonical names come from the Sleeper players cache; explicit
aliases (e.g. "Josh Palmer" -> "Joshua Palmer") are applied first.
"""
import argparse, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"

# Explicit aliases: First Down Studio name -> canonical Sleeper full_name
ALIASES = {
    "josh palmer": "Joshua Palmer",
}

def norm(s):
    s = s.lower().strip()
    s = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", s)
    s = re.sub(r"[.\'\u2019-]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s

def load_sleeper_names():
    cache = json.load(open(DATA / "sleeper_players_cache.json"))
    names = {}   # norm name -> full_name
    by_team_pos = {}  # (team, position, last) -> full_name
    for v in cache.values():
        fn = v.get("full_name")
        if not fn:
            continue
        names.setdefault(norm(fn), fn)
        team = v.get("team")
        pos = v.get("position")
        last = norm(fn.split()[-1])
        if team and pos and last:
            by_team_pos.setdefault((team, pos, last), fn)
    return names, by_team_pos

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True, help="JSON file of FDS rows")
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--min-players", type=int, default=150)
    args = ap.parse_args()

    rows = json.load(open(args.rows))
    vegas_file = max(DATA.glob(f"projections_{args.season}_w{args.week}.json"),
                     key=lambda p: p.stat().st_mtime)
    vegas = json.load(open(vegas_file))
    leagues = vegas["leagues"]
    lids = [l["league_id"] for l in leagues]
    assert len(lids) == 6, f"expected 6 leagues, got {len(lids)}"

    names, by_team_pos = load_sleeper_names()
    unmatched = []
    projections = []
    for r in rows:
        pos = r["position"].upper()
        assert pos in ("QB", "RB", "WR", "TE"), f"unexpected position {pos}"
        raw = r["player"].strip()
        canon = ALIASES.get(norm(raw))
        if not canon:
            canon = names.get(norm(raw))
        if not canon:
            last = norm(raw.split()[-1])
            team = r.get("team")
            canon = by_team_pos.get((team, pos, last))
        if not canon:
            unmatched.append(f"{pos} {raw} ({r.get('team')})")
            continue
        pts = round(float(r["projected_points"]), 2)
        opp = r.get("matchup", "").replace("vs ", "").replace("@ ", "").strip()
        exp = dict(r.get("components") or {})
        exp["projected_points"] = pts
        projections.append({
            "player": canon,
            "team": r.get("team"),
            "position": pos,
            "opponent": opp,
            "expected_stats": exp,
            "td_probability": 0.0,
            "coverage": {"stats": ["projected_points"], "provider_count": 1, "book_count": 1},
            "leagues": {lid: pts for lid in lids},
            "components": {lid: {"projected_points": pts} for lid in lids},
        })

    # Copy K rows verbatim from the Vegas build (artifact sources K from Sleeper anyway)
    for p in vegas["projections"]:
        if p.get("position") == "K":
            projections.append(p)

    total = len(projections)
    if total < args.min_players:
        print(f"FAIL: only {total} players (min {args.min_players})", file=sys.stderr)
        return 1

    # Validation: every projection carries all 6 leagues
    for p in projections:
        assert set(p["leagues"]) == set(lids), f"league gap on {p['player']}"

    out = {
        "season": args.season,
        "week": args.week,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "source": "first_down",
        "method": ("First Down Studio current-week Vegas fantasy rankings; projected "
                   "fantasy points replicated identically across all 6 leagues (single "
                   "source projection, no per-league rescoring). K rows copied from the "
                   "Vegas build; artifact sources K from Sleeper."),
        "leagues": leagues,
        "projections": projections,
    }
    out_path = DATA / f"projections_firstdown_{args.season}_w{args.week}.json"
    json.dump(out, out_path)
    pos_counts = {}
    for p in projections:
        pos_counts[p["position"]] = pos_counts.get(p["position"], 0) + 1
    print(f"wrote {out_path} ({total} players: {pos_counts})")
    if unmatched:
        print(f"UNMATCHED ({len(unmatched)}):", file=sys.stderr)
        for u in unmatched:
            print(f"  {u}", file=sys.stderr)
    jp = any(p["player"] == "Joshua Palmer" for p in projections)
    print(f"Joshua Palmer present: {jp}")
    return 0

sys.exit(main())
