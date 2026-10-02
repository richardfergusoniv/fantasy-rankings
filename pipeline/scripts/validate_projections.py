#!/usr/bin/env python3
"""Validate a rebuilt Vegas projections file before it is staged for push.

Checks (mirrors the props-twice-daily-pull cron rules):
  - file was modified within the last hour (i.e. it is from this run)
  - at least 200 players
  - every projection carries all 6 leagues
  - "Josh Palmer" never appears (canonical name is Joshua Palmer)
  - Joshua Palmer, when the books are offering him (present in the
    sibling consensus file), must survive the builder into projections;
    if no provider is offering him, his absence is legitimate and only
    warns (his lines can be pulled intraday)

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
    if "Josh Palmer" in names:
        print("FAIL: 'Josh Palmer' present (must be Joshua Palmer)")
        return 1
    if "Joshua Palmer" not in names:
        # Legitimate only if no provider offered him this run. The
        # consensus file sits next to the projections file and carries
        # raw provider names (he appears there as "Josh Palmer").
        consensus_path = path.parent / f"consensus_{data.get('season')}_w{data.get('week')}.json"
        offered = False
        if consensus_path.exists():
            rows = json.loads(consensus_path.read_text()).get("consensus", [])
            offered = any("palmer" in (r.get("player") or "").lower() for r in rows)
        if offered:
            print("FAIL: Palmer was offered by providers but is missing from projections (builder dropped him)")
            return 1
        print("WARN: Joshua Palmer not offered by any provider this run; absence accepted")
    print(f"PASS: {len(projections)} players, all {EXPECTED_LEAGUES} leagues, week {data.get('week')}, source {data.get('source')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
