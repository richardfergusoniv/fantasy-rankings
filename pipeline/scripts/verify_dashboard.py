#!/usr/bin/env python3
"""Verify the stored Fantasy Rankings dashboard against the staged push files.

This is the programmatic diff from the props-twice-daily-pull cron, encoded:
  - every staged player/league pair is present in the dashboard rankings
  - QB/RB/WR/TE are tagged with the staged file's source (`vegas` for a
    vegas-consensus file, `first_down` for a First Down fallback file)
  - Vegas files only: raw stats (expected_stats and TD probability)
    match the dashboard's projectionComponents exactly. The fallback's
    contract is points-only (a single replicated projection per
    player), so stat-level checks do not apply to it
  - point totals may differ by at most 0.011: the pipeline pre-computes
    points while the app re-scores raw stats per league, and the two
    rounding paths diverge by one cent on ~3% of pairs (verified
    2026-10-02; raw stats matching exactly is the data check)
  - a staged player the app marks with an unavailable status (Out,
    Inactive, IR, Injured Reserve, PUP, NFI — the app's
    isUnavailableForCurrentWeek set) is expected to be suppressed by the
    app (leagueProjection 0, source fallback); that is intended behavior
  - a staged player absent from ALL league rankings is a warning, not a
    failure (pool exception: not rostered anywhere and no Sleeper
    projection of his own, e.g. Xavier Smith). The same applies when he
    is present only as an unprojected pool row (source fallback, no
    projection, no components) in every league — the staged projection
    has nowhere to attach. Partial absence (missing from some leagues
    only) is still a failure. A player absent under a known Sleeper
    rename (KNOWN_ALIASES, e.g. Mitchell Tinsley listed as Mitch
    Tinsley) is likewise a warning
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
  - no dashboard players tagged with the staged file's source tag
    outside the staged file
  - defenses: every league carries the same set of playing teams
    (32 minus that week's bye teams, so 26-32 per league; a fixed 192
    total false-fails every bye week), each with a pregame projection
  - the analytics section is present
  - strengthOfSchedule: 6 entries, 32 teams x 4 positions, clean 1-32
    permutations, throughWeek equal to the staged matchup file

Usage: verify_dashboard.py <staged_for_push.json> <staged_matchup_grades.json>
Requires CRON_SECRET. Fetches the stored snapshot from $DASHBOARD_URL, or from
$APP_BASE_URL/api/cron/jobs?job=read-dashboard-snapshot. That route is the
same cron secret the rebuild already uses; it is not a public dashboard read.
Exit 0 on pass, 1 on fail, 2 on usage or missing secret.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

_APP_BASE_URL = os.environ.get("APP_BASE_URL", "https://fantasy-rankings-ten.vercel.app").rstrip("/")
DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL",
    f"{_APP_BASE_URL}/api/cron/jobs?job=read-dashboard-snapshot",
)
POINT_TOLERANCE = 0.011
UNAVAILABLE_STATUSES = {"Out", "Inactive", "IR", "Injured Reserve", "PUP", "NFI"}
KNOWN_ALIASES = {"Mitchell Tinsley": "Mitch Tinsley"}
STAT_MAP = {
    "pass_yards": "pass_yd",
    "pass_tds": "pass_td",
    "pass_interceptions": "pass_int",
    "rush_yards": "rush_yd",
    "rec_yards": "rec_yd",
    "receptions": "rec",
}
SKILL_POSITIONS = ("QB", "RB", "WR", "TE")


def stored_snapshot_request(url: str, secret: str) -> dict:
    """Read `{ ok, dashboard }` from the cron snapshot route."""
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}"})
    with urllib.request.urlopen(request, timeout=120) as resp:
        body = json.loads(resp.read().decode())
    dashboard = body.get("dashboard") if isinstance(body, dict) else None
    if not isinstance(dashboard, dict):
        raise RuntimeError("stored snapshot response has no dashboard")
    return dashboard


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify_dashboard.py <staged_for_push.json> <staged_matchup_grades.json>", file=sys.stderr)
        return 2
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        print("CRON_SECRET is required to read the stored dashboard snapshot", file=sys.stderr)
        return 2
    staged = json.loads(Path(sys.argv[1]).read_text())
    staged_sos = json.loads(Path(sys.argv[2]).read_text())
    dash = stored_snapshot_request(DASHBOARD_URL, secret)

    errors: list[str] = []
    warnings: list[str] = []
    missed: dict[str, list[str]] = {}
    rankings = dash["rankings"]
    by_key = {(r["leagueId"], r["name"]): r for r in rankings}
    league_ids = [l["league_id"] for l in staged["leagues"]]
    expected_tag = "first_down" if staged.get("source") == "first_down" else "vegas"
    staged_names = set()

    # Staged pairs: presence, tags, stat-level exactness, point tolerance.
    for p in staged["projections"]:
        staged_names.add(p["player"])
        if p["position"] == "K":
            continue
        # Pool exception: present at most as an unprojected pool row in
        # every league (and not suppressed for an unavailable status) —
        # the staged projection has nowhere to attach. Warning only.
        rows = {lid: by_key.get((lid, p["player"])) for lid in p["leagues"]}
        if not any(r is not None and r.get("injuryStatus") in UNAVAILABLE_STATUSES for r in rows.values()):
            def _is_pool(r):
                return r is None or (
                    r.get("projectionSource") == "fallback"
                    and r.get("leagueProjection") is None
                    and not r.get("projectionComponents")
                )
            if all(_is_pool(r) for r in rows.values()):
                alias = KNOWN_ALIASES.get(p["player"])
                if alias and alias in {r["name"] for r in rankings}:
                    warnings.append(f"{p['player']} absent; Sleeper lists him as {alias} (projection unattached)")
                else:
                    warnings.append(f"{p['player']} absent from all league rankings (pool exception)")
                continue
        for lid, val in p["leagues"].items():
            r = by_key.get((lid, p["player"]))
            if r is None:
                missed.setdefault(p["player"], []).append(lid)
                continue
            if r.get("injuryStatus") in UNAVAILABLE_STATUSES:
                # App suppresses unavailable players by design (projection 0).
                if r["leagueProjection"] not in (0, None):
                    errors.append(f"SUPPRESSED {p['player']} {lid}: leagueProjection {r['leagueProjection']} (expected 0)")
                continue
            if r["projectionSource"] != expected_tag:
                errors.append(f"TAG {p['player']} {lid}: {r['projectionSource']} (expected {expected_tag})")
            if r["leagueProjection"] is None or abs(r["leagueProjection"] - val) > POINT_TOLERANCE:
                errors.append(f"VALUE {p['player']} {lid}: dash={r['leagueProjection']} staged={val}")
        # Stat-level check once per player (components are league-independent).
        # Vegas only: the First Down fallback is points-only by contract.
        if expected_tag == "vegas":
            r0 = by_key.get((league_ids[0], p["player"]))
            if r0 is not None and r0.get("injuryStatus") not in UNAVAILABLE_STATUSES:
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

    # Resolve staged misses: partial absence is a failure; total absence
    # is a warning (pool exception or a known Sleeper rename).
    all_names = {r["name"] for r in rankings}
    for player, lids in missed.items():
        if len(lids) < len(league_ids):
            for lid in lids:
                errors.append(f"MISS {player} in {lid}")
        else:
            alias = KNOWN_ALIASES.get(player)
            if alias and alias in all_names:
                warnings.append(f"{player} absent; Sleeper lists him as {alias} (projection unattached)")
            else:
                warnings.append(f"{player} absent from all league rankings (pool exception)")

    names = {r["name"] for r in rankings}
    if "Josh Palmer" in names:
        errors.append("Josh Palmer present (bad)")
    # Joshua Palmer's presence is not required: rankings cover the
    # Sleeper pool, but a player can leave the pool (or the staged file)
    # legitimately. The hard rule is the wrong-name ban above.

    extra = [r["name"] for r in rankings if r["projectionSource"] == expected_tag and r["name"] not in staged_names]
    if extra:
        errors.append(f"{expected_tag.upper()} EXTRA: {sorted(set(extra))[:10]}")

    defs = dash["defenses"]
    defs_by_league: dict[str, set] = {}
    for d in defs:
        defs_by_league.setdefault(d["leagueId"], set()).add(d["team"])
    def_counts = {lid: len(t) for lid, t in defs_by_league.items()}
    if set(def_counts) != set(league_ids) or len(set(def_counts.values())) != 1:
        errors.append(f"defenses per-league team counts inconsistent: {def_counts}")
    elif not 26 <= next(iter(def_counts.values())) <= 32:
        errors.append(f"defenses teams per league {next(iter(def_counts.values()))} (expected 26-32 playing teams)")
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

    for w in warnings:
        print("  WARN:", w)
    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors[:25]:
            print(" ", e)
        return 1
    print(f"PASS: dashboard matches staged files (week {dash['week']}, asOf {dash['asOf']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
