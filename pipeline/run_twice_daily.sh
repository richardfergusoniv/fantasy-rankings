#!/bin/bash
# Twice-daily props pull + consensus rebuild for the current NFL week.
# Week numbering: 2026 Week 1 Thursday = 2026-09-10; each NFL week is
# treated as Tuesday->Monday so the week flips the day after Monday
# Night Football (i.e. Tuesday morning starts the new game week).
set -euo pipefail
cd ~/workspace/props-aggregator

WEEK=$(python3 -c "
from datetime import date
anchor = date(2026, 9, 10)  # Week 1 Thursday
days = (date.today() - anchor).days
w = 1 + (days + 2) // 7     # +2 shifts the flip day from Thu to Tue
print(max(1, min(18, w)))
")

echo "pulling all providers for 2026 week ${WEEK}..."
.venv/bin/python -m props_aggregator.cli pull --all --week "${WEEK}" --season 2026
echo "building Vegas fantasy projections for week ${WEEK}..."
.venv/bin/python -m props_aggregator.cli --data-dir data project --week "${WEEK}" --season 2026
echo "done."
