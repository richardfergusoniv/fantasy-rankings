#!/usr/bin/env python3
"""Validate the staged matchup-grades (strength of schedule) file.

Coverage: the staged leagues must be exactly the leagues of the users the
dashboard rebuild refreshes — OWNER_SLEEPER_USER_ID plus the
REBUILD_EXTRA_SLEEPER_USER_IDS allowlist — resolved from Sleeper at run
time. These are the same inputs build_matchup_grades.mjs builds from, so
coverage stays in lockstep when the allowlist changes instead of pinning
a hardcoded count. Structure: each league's table has 32 teams x 4
positions (QB/RB/WR/TE); each position's ranks form a clean 1-32
permutation.

Usage: validate_matchup_grades.py <staged_matchup_grades.json>
Exit 0 on pass, 1 on fail, 2 on usage error.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

POSITIONS = ("QB", "RB", "WR", "TE")
SEASON = 2026


def refreshed_user_ids(env) -> list[str]:
    ids: list[str] = []
    owner = (env.get("OWNER_SLEEPER_USER_ID") or "").strip()
    if owner:
        ids.append(owner)
    for raw in (env.get("REBUILD_EXTRA_SLEEPER_USER_IDS") or "").split(","):
        raw = raw.strip()
        if raw:
            ids.append(raw)
    return ids


def fetch_user_league_ids(user_id: str, fetch) -> list[str]:
    rows = fetch(f"https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/{SEASON}")
    return [row["league_id"] for row in rows or [] if row.get("league_id")]


def expected_league_ids(user_ids: list[str], fetch) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for user_id in user_ids:
        for league_id in fetch_user_league_ids(user_id, fetch):
            if league_id not in seen:
                seen.add(league_id)
                ordered.append(league_id)
    return ordered


def urlopen_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "fantasy-rankings-pipeline"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def validate(data: dict, expected_ids: list[str]) -> list[str]:
    errors: list[str] = []
    leagues = data.get("leagues", [])
    staged_ids = [lg.get("league_id") for lg in leagues]
    expected_set = set(expected_ids)
    staged_set = set(staged_ids)
    missing = expected_set - staged_set
    extra = staged_set - expected_set
    if missing:
        errors.append(f"missing leagues for refreshed users: {sorted(missing)}")
    if extra:
        errors.append(f"staged leagues outside refreshed-user coverage: {sorted(extra)}")
    if len(staged_ids) != len(staged_set):
        errors.append("duplicate league_id entries in staged file")
    for lg in leagues:
        table = lg.get("table", {})
        if len(table) != 32:
            errors.append(f"{lg.get('league_name')} has {len(table)} teams (expected 32)")
            continue
        for pos in POSITIONS:
            ranks = sorted(t[pos]["rank"] for t in table.values())
            if ranks != list(range(1, 33)):
                errors.append(
                    f"{lg.get('league_name')} {pos} ranks are not a clean 1-32 permutation"
                )
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_matchup_grades.py <file>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"FAIL: file missing: {path}")
        return 1
    user_ids = refreshed_user_ids(os.environ)
    if not user_ids:
        print(
            "FAIL: no refreshed users configured; set OWNER_SLEEPER_USER_ID "
            "and/or REBUILD_EXTRA_SLEEPER_USER_IDS"
        )
        return 1
    expected_ids = expected_league_ids(user_ids, urlopen_json)
    data = json.loads(path.read_text())
    errors = validate(data, expected_ids)
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print(
        f"PASS: {len(data.get('leagues', []))} leagues matching refreshed-user "
        f"coverage, 32 teams x 4 positions, clean permutations, "
        f"through_week {data.get('through_week')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
