#!/usr/bin/env python3
"""Push staged fantasy data files to the Fantasy Rankings Vercel ingest API.

Replaces the retired artifact actions (`ingeststagedprojections`,
`ingeststagedmatchupgrades`, `ingeststagedpfntables`), which read staged
files via a privileged file handler. The Vercel endpoints take the same
JSON directly in the POST body, authenticated with the shared CRON_SECRET.

Usage:
  push_ingest.py projections     # data/staged_for_push.json
  push_ingest.py matchup-grades  # data/staged_matchup_grades.json
  push_ingest.py pfn-tables      # ~/workspace/pfn-pipeline/data/staged_pfn_tables.json

Reads CRON_SECRET from the environment. The host is INGEST_BASE_URL if set,
otherwise APP_BASE_URL, otherwise the production domain. The props-aggregator
.env is loaded if present. Prints the endpoint's JSON response. Exits
non-zero on any failure so cron callers stop loudly.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = (
    os.environ.get("INGEST_BASE_URL")
    or os.environ.get("APP_BASE_URL")
    or "https://fantasy-rankings-ten.vercel.app"
).rstrip("/")

# Data dirs: default to the local workspace layout; CI overrides via env.
PROPS_DATA_DIR = Path(
    os.environ.get(
        "PROPS_DATA_DIR", Path.home() / "workspace/props-aggregator/data"
    )
)
PFN_DATA_DIR = Path(
    os.environ.get("PFN_DATA_DIR", Path.home() / "workspace/pfn-pipeline/data")
)

TARGETS = {
    "projections": PROPS_DATA_DIR / "staged_for_push.json",
    "matchup-grades": PROPS_DATA_DIR / "staged_matchup_grades.json",
    "pfn-tables": PFN_DATA_DIR / "staged_pfn_tables.json",
}


def load_dotenv() -> None:
    env_path = PROPS_DATA_DIR.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        print(f"usage: push_ingest.py {'|'.join(TARGETS)}", file=sys.stderr)
        return 2

    load_dotenv()
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        print("CRON_SECRET is not set (checked environment and props-aggregator/.env)", file=sys.stderr)
        return 2

    target = sys.argv[1]
    path = TARGETS[target]
    if not path.exists():
        print(f"staged file missing: {path}", file=sys.stderr)
        return 1

    body = path.read_bytes()
    # Sanity: must be valid JSON before we send it.
    try:
        json.loads(body)
    except json.JSONDecodeError as err:
        print(f"staged file is not valid JSON: {path}: {err}", file=sys.stderr)
        return 1

    url = f"{BASE_URL}/api/ingest/{target}"
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:500]
        print(f"push failed: HTTP {err.code} from {url}: {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print(f"push failed: {err} ({url})", file=sys.stderr)
        return 1

    print(json.dumps(result))
    if not result.get("ok"):
        print(f"push not ok: {result}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
