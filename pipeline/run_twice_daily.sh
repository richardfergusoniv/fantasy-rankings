#!/bin/bash
# Twice-daily props pull + consensus rebuild for the current NFL week.
# Season and week come from Sleeper's NFL state endpoint so scheduled jobs
# do not hardcode a year or Week-1 anchor date.
#
# Location-independent: runs from its own directory (works in the local
# workspace and in a GitHub Actions checkout). Uses .venv/bin/python
# when a venv exists (local), otherwise python3 from PATH (CI).
set -euo pipefail
cd "$(dirname "$0")"

if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY=python3
fi

SEASON=""
WEEK=""
for attempt in 1 2 3; do
  if out=$($PY -c "
import json
import urllib.request
with urllib.request.urlopen('https://api.sleeper.app/v1/state/nfl', timeout=30) as resp:
    state = json.load(resp)
print(int(state['season']), max(1, min(18, int(state['week']))))
") && read -r SEASON WEEK <<< "$out" && [[ "$SEASON" =~ ^[0-9]+$ && "$WEEK" =~ ^[0-9]+$ ]]; then
    break
  fi
  SEASON=""
  WEEK=""
  if [ "$attempt" -eq 3 ]; then
    echo "Unable to read a valid Sleeper NFL state after 3 attempts." >&2
    exit 1
  fi
  sleep 5
done

echo "pulling all providers for ${SEASON} week ${WEEK}..."
$PY -m props_aggregator.cli pull --all --week "${WEEK}" --season "${SEASON}"
echo "building Vegas fantasy projections for week ${WEEK}..."
$PY -m props_aggregator.cli --data-dir data project --week "${WEEK}" --season "${SEASON}"
echo "done."
