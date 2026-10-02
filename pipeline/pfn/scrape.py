#!/usr/bin/env python3
"""
PFN NFL HQ rankings scraper.

Fetches the four free Pro Football Network "Impact" ranking tables
(offensive line, team offense, team defense, team overall), normalizes
them to team-level rows, and snapshots the result.

Change detection: every run hashes the normalized payload and compares it
with data/.last_hash.json. Snapshots and the staged ingest file are only
written when the data actually changed.

Portability: stdlib only (urllib + html.parser + json + hashlib). No
hardcoded machine paths -- the data dir comes from PFN_DATA_DIR or
defaults to <this-script>/data. Safe to run in a GitHub Action with
PFN_DATA_DIR pointed at a workspace path.

Usage:
    python3 scrape.py            # fetch, compare, stage on change
    python3 scrape.py --force     # fetch and stage even if unchanged
    python3 scrape.py --check     # fetch and compare only; never writes staged file

Output: human-readable log lines plus a final "status: changed" or
"status: unchanged" line. Exit 0 on success (changed or unchanged),
exit 2 on fetch/parse/validation failure.
"""

import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

BASE_URL = os.environ.get(
    "PFN_BASE_URL", "https://www.profootballnetwork.com/nfl-hq/rankings"
)
TABLES = {
    "offensive-line": f"{BASE_URL}/offensive-line",
    "offense": f"{BASE_URL}/offense",
    "defense": f"{BASE_URL}/defense",
    "team-overall": f"{BASE_URL}/team-overall",
}

# Expected data columns per table, in order, after the Team column.
# (The "#" rank column and the trailing "Details" button column are dropped.)
COLUMNS = {
    "offensive-line": ["grade", "pass_block", "run_block", "pen_per_game"],
    "offense": [
        "grade", "ppg", "pass", "run", "epa_per_play",
        "yds_per_play", "success_pct", "expl_pct", "sos",
    ],
    "defense": [
        "grade", "pts_allowed_per_game", "pass", "run", "epa_per_play",
        "yds_per_play", "success_pct", "expl_pct", "sos",
    ],
    "team-overall": ["grade", "record", "offense", "defense", "special_teams", "sos"],
}

COLUMN_LABELS = {
    "grade": "Grade",
    "pass_block": "Pass Block",
    "run_block": "Run Block",
    "pen_per_game": "Pen/G",
    "ppg": "PPG",
    "pass": "Pass",
    "run": "Run",
    "epa_per_play": "EPA/Play",
    "yds_per_play": "Yds/Play",
    "success_pct": "Success%",
    "expl_pct": "Expl%",
    "sos": "SOS",
    "pts_allowed_per_game": "Pts Allowed/G",
    "record": "Record",
    "offense": "Offense",
    "defense": "Defense",
    "special_teams": "Special Teams",
}

TABLE_LABELS = {
    "offensive-line": "O-Line",
    "offense": "Offense",
    "defense": "Defense",
    "team-overall": "Overall",
}

TEAM_ABBR = {
    "Arizona Cardinals": "ARI",
    "Atlanta Falcons": "ATL",
    "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF",
    "Carolina Panthers": "CAR",
    "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN",
    "Cleveland Browns": "CLE",
    "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN",
    "Detroit Lions": "DET",
    "Green Bay Packers": "GB",
    "Houston Texans": "HOU",
    "Indianapolis Colts": "IND",
    "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC",
    "Las Vegas Raiders": "LV",
    "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LAR",
    "Miami Dolphins": "MIA",
    "Minnesota Vikings": "MIN",
    "New England Patriots": "NE",
    "New Orleans Saints": "NO",
    "New York Giants": "NYG",
    "New York Jets": "NYJ",
    "Philadelphia Eagles": "PHI",
    "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF",
    "Seattle Seahawks": "SEA",
    "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN",
    "Washington Commanders": "WAS",
}

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
POLITENESS_DELAY_SECS = 2


class RankingTableParser(HTMLParser):
    """Extracts top-level <table> structures: headers + body rows.

    Each cell is captured as {"text": str, "full_team": str|None} where
    full_team is set from the `hidden lg:inline` span PFN uses for the
    full team name.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._depth = 0
        self._table = None
        self._section = None  # "head" | "body" | None
        self._row = None
        self._cell_text = None
        self._cell_full_team = None
        self._capture_full_team = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._table = {"headers": [], "rows": []}
        if self._depth != 1 or self._table is None:
            return
        if tag == "thead":
            self._section = "head"
        elif tag == "tbody":
            self._section = "body"
        elif tag == "tr" and self._section in ("head", "body"):
            self._row = []
        elif tag in ("th", "td") and self._row is not None:
            self._cell_text = ""
            self._cell_full_team = None
        elif tag == "span" and self._cell_text is not None:
            classes = attrs.get("class", "")
            if "lg:inline" in classes:
                self._capture_full_team = True

    def handle_endtag(self, tag):
        if tag == "table":
            if self._depth == 1 and self._table is not None:
                self.tables.append(self._table)
                self._table = None
            self._depth = max(0, self._depth - 1)
            return
        if self._depth != 1 or self._table is None:
            return
        if tag in ("thead", "tbody"):
            self._section = None
        elif tag == "tr" and self._row is not None:
            if self._section == "head":
                self._table["headers"] = self._row
            elif self._section == "body":
                self._table["rows"].append(self._row)
            self._row = None
        elif tag in ("th", "td") and self._row is not None and self._cell_text is not None:
            self._row.append(
                {"text": self._cell_text.strip(), "full_team": self._cell_full_team}
            )
            self._cell_text = None
            self._cell_full_team = None
        elif tag == "span":
            self._capture_full_team = False

    def handle_data(self, data):
        if self._cell_text is not None:
            if self._capture_full_team:
                self._cell_full_team = (self._cell_full_team or "") + data
            self._cell_text += data


def clean_header(text):
    return text.replace("\u2195", "").replace("\u25bc", "").replace("\u25b2", "").strip()


def parse_number(text):
    text = text.strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return text


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} for {url}")
        return resp.read().decode("utf-8", errors="replace")


def parse_table(slug, html):
    parser = RankingTableParser()
    parser.feed(html)
    candidates = [t for t in parser.tables if "Grade" in [clean_header(c["text"]) for c in t["headers"]]]
    if not candidates:
        raise RuntimeError(f"{slug}: no ranking table found in page HTML")
    table = candidates[0]
    headers = [clean_header(c["text"]) for c in table["headers"]]
    # Drop the trailing "Details" header/cell; keep "#" and "Team".
    if headers and headers[-1] == "Details":
        headers = headers[:-1]
    expected_data_cols = COLUMNS[slug]
    data_headers = [h for h in headers if h not in ("#", "Team")]
    if len(data_headers) != len(expected_data_cols):
        raise RuntimeError(
            f"{slug}: column drift (page has {len(data_headers)} data columns "
            f"{data_headers}, expected {len(expected_data_cols)}); refusing to map positionally"
        )
    if data_headers != [COLUMN_LABELS[k] for k in expected_data_cols]:
        print(
            f"warning: {slug} header labels changed {data_headers}; "
            f"mapping positionally to expected keys",
            file=sys.stderr,
        )

    rows = []
    seen_teams = set()
    for raw in table["rows"]:
        cells = raw[:-1] if raw and raw[-1]["text"] == "" else raw  # drop Details cell
        if len(cells) < 2 + len(expected_data_cols):
            continue
        rank = int(cells[0]["text"])
        team_cell = cells[1]
        full_name = (team_cell["full_team"] or "").strip() or team_cell["text"].strip()
        abbr = TEAM_ABBR.get(full_name)
        if abbr is None:
            raise RuntimeError(f"{slug}: unrecognized team name {full_name!r}")
        if abbr in seen_teams:
            raise RuntimeError(f"{slug}: duplicate team {abbr}")
        seen_teams.add(abbr)
        row = {"rank": rank, "team": abbr, "team_name": full_name}
        for key, cell in zip(expected_data_cols, cells[2:]):
            row[key] = parse_number(cell["text"])
        rows.append(row)

    if len(rows) != 32:
        raise RuntimeError(f"{slug}: expected 32 team rows, parsed {len(rows)}")
    ranks = sorted(r["rank"] for r in rows)
    if ranks != list(range(1, 33)):
        raise RuntimeError(f"{slug}: ranks are not 1..32: {ranks}")
    rows.sort(key=lambda r: r["rank"])
    return {
        "label": TABLE_LABELS[slug],
        "columns": expected_data_cols,
        "column_labels": {k: COLUMN_LABELS[k] for k in expected_data_cols},
        "page_headers": data_headers,
        "rows": rows,
    }


def main():
    check_only = "--check" in sys.argv
    force = "--force" in sys.argv
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.environ.get("PFN_DATA_DIR", os.path.join(script_dir, "data"))
    os.makedirs(os.path.join(data_dir, "snapshots"), exist_ok=True)

    fetched_at = datetime.now(timezone.utc).isoformat()
    tables = {}
    for i, (slug, url) in enumerate(TABLES.items()):
        if i > 0:
            time.sleep(POLITENESS_DELAY_SECS)
        print(f"fetching {slug} ...")
        html = fetch(url)
        tables[slug] = parse_table(slug, html)
        print(f"  {slug}: {len(tables[slug]['rows'])} rows ok")

    canonical = json.dumps(tables, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    hash_path = os.path.join(data_dir, ".last_hash.json")
    last = {}
    if os.path.exists(hash_path):
        with open(hash_path) as f:
            last = json.load(f)

    if digest == last.get("hash") and not force:
        print("status: unchanged")
        return 0

    payload = {"source": "pfn-nfl-hq", "fetched_at": fetched_at, "tables": tables}
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    snapshot_path = os.path.join(data_dir, "snapshots", f"pfn_tables_{stamp}.json")
    with open(snapshot_path, "w") as f:
        json.dump(payload, f, indent=1)
    with open(os.path.join(data_dir, "latest.json"), "w") as f:
        json.dump(payload, f, indent=1)
    if not check_only:
        with open(os.path.join(data_dir, "staged_pfn_tables.json"), "w") as f:
            json.dump(payload, f, separators=(",", ":"))
    with open(hash_path, "w") as f:
        json.dump({"hash": digest, "fetched_at": fetched_at}, f, indent=1)
    print(f"snapshot: {snapshot_path}")
    print("status: changed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # fail loudly; never ingest partial garbage
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)
