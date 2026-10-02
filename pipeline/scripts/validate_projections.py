#!/usr/bin/env python3
"""Validate a rebuilt Vegas projections file before it is staged for push.

Checks (mirrors the props-twice-daily-pull cron rules):
  - file was modified within the last hour (i.e. it is from this run)
  - at least 200 players
  - every projection carries all 6 leagues
  - Joshua Palmer present, Josh Palmer absent

Usage: validate_projections.py <projections_file>
Exit 0 on pass, 1 on fail (message printed).
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
    if len(sys.argv) != 2:
        print("usage: validate_projections.py <projections_file>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"FAIL: file missing: {path}")
        return 1
    age = time.time() - path.stat().st_mtime
    if age > MAX_AGE_SECS:
        print(f"FAIL: file is {int(age)}s old (max {MAX_AGE_SECS}s); not from this run")
        return 1
    data = json.loads(path.read_text())
    projections = data.get("projections", [])
    if len(projections) < MIN_PLAYERS:
        print(f"FAIL: only {len(projections)} players (min {MIN_PLAYERS})")
        return 1
    for p in projections:
        leagues = p.get("leagues", {})
        if len(leagues) != EXPECTED_LEAGUES:
            print(f"FAIL: {p.get('player')} carries {len(leagues)} leagues (expected {EXPECTED_LEAGUES})")
            return 1
    names = {p.get("player") for p in projections}
    if "Joshua Palmer" not in names:
        print("FAIL: Joshua Palmer missing")
        return 1
    if "Josh Palmer" in names:
        print("FAIL: 'Josh Palmer' present (must be Joshua Palmer)")
        return 1
    print(f"PASS: {len(projections)} players, all {EXPECTED_LEAGUES} leagues, week {data.get('week')}, source {data.get('source')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
