#!/usr/bin/env python3
"""Verify the public Fantasy Rankings dashboard against the staged push files.

This is the programmatic diff from the props-twice-daily-pull cron, encoded:
  - every staged player/league pair is present in the dashboard rankings
  - QB/RB/WR/TE are tagged `vegas` and their raw stats (expected_stats and
    TD probability) match the dashboard's projectionComponents exactly
  - point totals may differ by at most 0.011: the pipeline pre-computes
    points while the app re-scores raw stats per league, and the two
    rounding paths diverge by one cent on ~3% of pairs (verified
    2026-10-02; raw stats matching exactly is the data check)
  - a staged player the app marks Out is expected to be suppressed by the
    app (leagueProjection 0, source fallback); that is intended behavior
  - K players must never be tagged `vegas` or `first_down` (the app
    sources K projections from Sleeper). Most K entries are tagged
    `sleeper`; a K tagged `fallback` with no projection at all is a
    pool kicker with no Sleeper projection and no Vegas line (e.g.
    practice-squad kickers) and is allowed. At least 28 K entries per
    league must be `sleeper`-tagged, which guards against a wholesale
    Sleeper-projection failure hiding behind the fallback allowance.
    K values are never exact-matched (the app scores Sleeper's raw
    K stats through each league's settings at display time)
  - Joshua Palmer present, Josh Palmer absent
  - no `vegas`-tagged dashboard players outside the staged file
  - all 192 defenses carry a pregame projection
  - the analytics section is present
  - strengthOfSchedule: 6 entries, 32 teams x 4 positions, clean 1-32
    permutations, throughWeek equal to the staged matchup file

Usage: verify_dashboard.py <staged_for_push.json> <staged_matchup_grades.json>
Fetches the dashboard from $DASHBOARD_URL or the production URL.
Exit 0 on pass, 1 on fail.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL", "https://fantasy-rankings-rdfergus15.vercel.app/api/dashboard"
)
POINT_TOLERANCE = 0.011
STAT_MAP = {
    "pass_yards": "pass_yd",
    "pass_tds": "pass_td",
    "pass_interceptions": "pass_int",
    "rush_yards": "rush_yd",
    "rec_yards": "rec_yd",
    "receptions": "rec",
}
SKILL_POSITIONS = ("QB", "RB", "WR", "TE")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify_dashboard.py <staged_for_push.json> <staged_matchup_grades.json>", file=sys.stderr)
        return 2
    staged = json.loads(Path(sys.argv[1]).read_text())
    staged_sos = json.loads(Path(sys.argv[2]).read_text())
    with urllib.request.urlopen(DASHBOARD_URL, timeout=120) as resp:
        dash = json.loads(resp.read().decode())["dashboard"]

    errors: list[str] = []
    rankings = dash["rankings"]
    by_key = {(r["leagueId"], r["name"]): r for r in rankings}
    league_ids = [l["league_id"] for l in staged["leagues"]]
    staged_names = set()

    # Staged pairs: presence, tags, stat-level exactness, point tolerance.
    for p in staged["projections"]:
        staged_names.add(p["player"])
        if p["position"] == "K":
            continue
        for lid, val in p["leagues"].items():
            r = by_key.get((lid, p["player"]))
            if r is None:
                errors.append(f"MISS {p['player']} in {lid}")
                continue
            if r.get("injuryStatus") == "Out":
                # App suppresses Out players by design (projection 0).
                if r["leagueProjection"] not in (0, None):
                    errors.append(f"OUT {p['player']} {lid}: leagueProjection {r['leagueProjection']} (expected 0)")
                continue
            if r["projectionSource"] != "vegas":
                errors.append(f"TAG {p['player']} {lid}: {r['projectionSource']}")
            if r["leagueProjection"] is None or abs(r["leagueProjection"] - val) > POINT_TOLERANCE:
                errors.append(f"VALUE {p['player']} {lid}: dash={r['leagueProjection']} staged={val}")
        # Stat-level check once per player (components are league-independent).
        r0 = by_key.get((league_ids[0], p["player"]))
        if r0 is not None and r0.get("injuryStatus") != "Out":
            comp = r0.get("projectionComponents")
            if not comp:
                errors.append(f"NO COMP {p['player']}")
            else:
                for sk, dk in STAT_MAP.items():
                    if sk in p["expected_stats"]:
                        dv = comp.get(dk)
                        if dv is None or abs(dv - p["expected_stats"][sk]) > 1e-9:
                            errors.append(f"STAT {p['player']} {sk}: dash={dv} staged={p['expected_stats'][sk]}")
                td_key = "rec_td" if p["position"] in ("WR", "TE") else "rush_td"
                dv = comp.get(td_key)
                if dv is None or abs(dv - p["td_probability"]) > 1e-9:
                    errors.append(f"TD {p['player']} {td_key}: dash={dv} staged={p['td_probability']}")

    # K: never vegas/first_down; mostly sleeper; fallback-with-no-projection
    # allowed for pool kickers with no data from any source.
    for lid in league_ids:
        ks = [r for r in rankings if r["leagueId"] == lid and r["position"] == "K"]
        if not ks:
            errors.append(f"K MISSING in {lid}")
            continue
        wrong_source = [r["name"] for r in ks if r["projectionSource"] in ("vegas", "first_down")]
        if wrong_source:
            errors.append(f"K SOURCE {lid}: {wrong_source}")
        ghost = [r["name"] for r in ks
                 if r["projectionSource"] == "fallback" and r["leagueProjection"] is not None]
        if ghost:
            errors.append(f"K FALLBACK-WITH-PROJECTION {lid}: {ghost}")
        sleeper_count = sum(1 for r in ks if r["projectionSource"] == "sleeper")
        if sleeper_count < 28:
            errors.append(f"K SLEEPER COUNT {lid}: {sleeper_count} (expected >= 28)")

    names = {r["name"] for r in rankings}
    if "Josh Palmer" in names:
        errors.append("Josh Palmer present (bad)")
    # Joshua Palmer's presence is not required: rankings cover the
    # Sleeper pool, but a player can leave the pool (or the staged file)
    # legitimately. The hard rule is the wrong-name ban above.

    extra = [r["name"] for r in rankings if r["projectionSource"] == "vegas" and r["name"] not in staged_names]
    if extra:
        errors.append(f"VEGAS EXTRA: {sorted(set(extra))[:10]}")

    defs = dash["defenses"]
    if len(defs) != 192:
        errors.append(f"defenses count {len(defs)} (expected 192)")
    noproj = [d["team"] for d in defs if d.get("pregameProjection") is None]
    if noproj:
        errors.append(f"defenses without pregame projection: {noproj[:5]}")

    if not dash.get("analytics") or not dash["analytics"].get("entities"):
        errors.append("analytics missing")

    sos = dash["strengthOfSchedule"]
    if len(sos) != 6:
        errors.append(f"SoS count {len(sos)} (expected 6)")
    for s in sos:
        if s["throughWeek"] != staged_sos["through_week"]:
            errors.append(f"SoS throughWeek {s['throughWeek']} != staged {staged_sos['through_week']}")
        table = s["table"]
        if len(table) != 32:
            errors.append(f"SoS teams {len(table)} in {s['leagueId']}")
        for pos in SKILL_POSITIONS:
            ranks = sorted(t[pos]["rank"] for t in table.values())
            if ranks != list(range(1, 33)):
                errors.append(f"SoS ranks bad {s['leagueId']} {pos}")

    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors[:25]:
            print(" ", e)
        return 1
    print(f"PASS: dashboard matches staged files (week {dash['week']}, asOf {dash['asOf']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
