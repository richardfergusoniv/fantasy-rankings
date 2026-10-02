#!/usr/bin/env python3
"""Fetch First Down Studio rankings and emit builder-ready rows (fallback path).

The rankings page (https://www.firstdown.studio/rankings) server-renders a
React payload containing one JSON record per player with position, team,
opponent, per-stat projections, and points under three scoring formats
(ppr / halfppr / standard). This scraper extracts those records for the
requested week and writes the rows JSON that
scripts/build_firstdown_projections.py consumes:
  {position, rank, player, team, matchup, projected_points, components}

projected_points uses the halfppr total (the middle format; the fallback
replicates one number across all leagues by design). components maps the
record's stat lines into the Vegas expected_stats vocabulary.

Usage: fetch_firstdown_rows.py --week N --season YYYY --out rows.json
Exit 0 on success (>=150 skill-position rows), 1 on failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

URL = "https://www.firstdown.studio/rankings"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
POSITIONS = ("QB", "RB", "WR", "TE")
MIN_ROWS = 150
STAT_MAP = {
    "passing_yards": "pass_yards",
    "passing_touchdowns": "pass_tds",
    "interceptions": "pass_interceptions",
    "rushing_yards": "rush_yards",
    "receiving_yards": "rec_yards",
    "receptions": "receptions",
}


def fetch_html() -> str:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as err:  # retry once on any network hiccup
            last_err = err
            time.sleep(3)
    raise RuntimeError(f"fetch failed: {last_err}")


def extract_objects(text: str, marker: str) -> list[dict]:
    """Brace-match every JSON object containing `marker` (RSC payload text)."""
    objs: list[dict] = []
    i = 0
    while True:
        j = text.find(marker, i)
        if j < 0:
            return objs
        start = text.rfind("{", 0, j)
        depth, k, in_str, esc = 0, start, False, False
        while k < len(text):
            c = text[k]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        break
            k += 1
        try:
            objs.append(json.loads(text[start:k + 1]))
        except Exception:
            pass
        i = j + len(marker)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    html = fetch_html()
    unescaped = html.replace('\\"', '"').replace("\\\\", "\\")

    best: dict[tuple[str, str, str], dict] = {}
    for pos in POSITIONS:
        for rec in extract_objects(unescaped, f'"position":"{pos}"'):
            if rec.get("week") != args.week or rec.get("season") != args.season:
                continue
            if rec.get("position") != pos or not rec.get("name"):
                continue
            key = (rec["name"], rec.get("team") or "", pos)
            pts = rec.get("halfppr")
            if not isinstance(pts, (int, float)):
                continue
            if key not in best or pts > best[key]["halfppr"]:
                best[key] = rec

    rows = []
    by_pos: dict[str, list[dict]] = {p: [] for p in POSITIONS}
    for rec in best.values():
        by_pos[rec["position"]].append(rec)
    for pos in POSITIONS:
        ranked = sorted(by_pos[pos], key=lambda r: -r["halfppr"])
        for idx, rec in enumerate(ranked, start=1):
            components = {
                dst: rec[src]
                for src, dst in STAT_MAP.items()
                if isinstance(rec.get(src), (int, float))
            }
            rows.append({
                "position": pos,
                "rank": idx,
                "player": rec["name"],
                "team": rec.get("team"),
                "matchup": rec.get("opponent") or "",
                "projected_points": round(float(rec["halfppr"]), 2),
                "components": components,
            })

    if len(rows) < MIN_ROWS:
        print(f"FAIL: only {len(rows)} First Down rows for week {args.week} (min {MIN_ROWS})",
              file=sys.stderr)
        return 1
    with open(args.out, "w") as f:
        json.dump(rows, f)
    counts = {p: len(by_pos[p]) for p in POSITIONS}
    print(f"wrote {args.out}: {len(rows)} rows {counts} (week {args.week}, halfppr)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
