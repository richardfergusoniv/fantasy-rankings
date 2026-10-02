#!/usr/bin/env python3
"""Validate the staged matchup-grades (strength of schedule) file.

Checks: exactly 6 leagues; each league's table has 32 teams x 4 positions
(QB/RB/WR/TE); each position's ranks form a clean 1-32 permutation.

Usage: validate_matchup_grades.py <staged_matchup_grades.json>
Exit 0 on pass, 1 on fail.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

POSITIONS = ("QB", "RB", "WR", "TE")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_matchup_grades.py <file>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"FAIL: file missing: {path}")
        return 1
    data = json.loads(path.read_text())
    leagues = data.get("leagues", [])
    if len(leagues) != 6:
        print(f"FAIL: {len(leagues)} leagues (expected 6)")
        return 1
    for lg in leagues:
        table = lg.get("table", {})
        if len(table) != 32:
            print(f"FAIL: {lg.get('league_name')} has {len(table)} teams (expected 32)")
            return 1
        for pos in POSITIONS:
            ranks = sorted(t[pos]["rank"] for t in table.values())
            if ranks != list(range(1, 33)):
                print(f"FAIL: {lg.get('league_name')} {pos} ranks are not a clean 1-32 permutation")
                return 1
    print(f"PASS: 6 leagues, 32 teams x 4 positions, clean permutations, through_week {data.get('through_week')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
