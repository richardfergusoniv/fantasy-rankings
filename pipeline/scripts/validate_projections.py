#!/usr/bin/env python3
"""Validate a rebuilt Vegas projections file before it is staged for push.

Checks (mirrors the props-twice-daily-pull cron rules):
  - file was modified within the last hour (i.e. it is from this run)
  - at least 200 players
  - every projection carries all 6 leagues
  - "Josh Palmer" never appears (canonical name is Joshua Palmer).
    Joshua Palmer's presence is NOT required: he legitimately drops
    out whenever books thin his lines below the builder's coverage
    gate (rec_yards + receptions + anytime_td for a WR). The alias
    regression this used to guard against is still caught by the
    "Josh Palmer" ban here and in verify_dashboard.py.

Usage: validate_projections.py [--min-players N] <projections_file>
Exit 0 on pass, 1 on fail (message printed), 3 when the failure is the
player-count minimum (the props workflow treats exit 3 as the trigger
for the First Down Studio fallback; other failures stay hard fails).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

EXPECTED_LEAGUES = 6
MIN_PLAYERS = 200
MAX_AGE_SECS = 3600


def main() -> int:
    argv = sys.argv[1:]
    min_players = MIN_PLAYERS
    if argv[:1] == ["--min-players"]:
        if len(argv) < 3:
            print("usage: validate_projections.py [--min-players N] <projections_file>", file=sys.stderr)
            return 2
        min_players = int(argv[1])
        argv = argv[2:]
    if len(argv) != 1:
        print("usage: validate_projections.py [--min-players N] <projections_file>", file=sys.stderr)
        return 2
    path = Path(argv[0])
    if not path.exists():
        print(f"FAIL: file missing: {path}")
        return 1
    age = time.time() - path.stat().st_mtime
    if age > MAX_AGE_SECS:
        print(f"FAIL: file is {int(age)}s old (max {MAX_AGE_SECS}s); not from this run")
        return 1
    data = json.loads(path.read_text())
    projections = data.get("projections", [])
    if len(projections) < min_players:
        print(f"FAIL: only {len(projections)} players (min {min_players})")
        return 3
    for p in projections:
        leagues = p.get("leagues", {})
        if len(leagues) != EXPECTED_LEAGUES:
            print(f"FAIL: {p.get('player')} carries {len(leagues)} leagues (expected {EXPECTED_LEAGUES})")
            return 1
    names = {p.get("player") for p in projections}
    if "Josh Palmer" in names:
        print("FAIL: 'Josh Palmer' present (must be Joshua Palmer)")
        return 1
    if "Joshua Palmer" not in names:
        print("WARN: Joshua Palmer not in projections this run (books thinned his lines or he is not offered); not a failure")
    print(f"PASS: {len(projections)} players, all {EXPECTED_LEAGUES} leagues, week {data.get('week')}, source {data.get('source')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
