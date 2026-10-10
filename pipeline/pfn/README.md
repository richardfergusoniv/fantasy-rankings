# pfn-pipeline

Scrapes the four free Pro Football Network NFL HQ "Impact" ranking tables
(offensive line, team offense, team defense, team overall) and stages them
for the Fantasy Rankings app (matchup badges, player/team cards).

Stdlib only — no `pip install` needed. Portable to a GitHub Action: set
`PFN_DATA_DIR` to a workspace path and run `python3 scrape.py`.

## How it works

1. `scrape.py` fetches the four ranking pages (2s politeness delay between
   requests, browser User-Agent), parses the server-rendered `<table>`
   markup, and normalizes each to 32 team rows keyed by standard
   abbreviation (Sleeper convention: `LAR`, `LAC`, `NYG`, …).
2. Every run hashes the normalized payload and compares it with
   `data/.last_hash.json`. Snapshots and the staged ingest file are only
   written when the data changed. The final stdout line is
   `status: changed` or `status: unchanged` (exit 0 either way; exit 2 on
   fetch/parse/validation failure — it fails loudly rather than staging
   partial data).
3. On change it writes:
   - `data/snapshots/pfn_tables_<UTC stamp>.json` — immutable history
   - `data/latest.json` — newest payload, pretty-printed
   - `data/staged_pfn_tables.json` — compact JSON the app ingests

## Staged-file contract (read by the app's `ingeststagedpfntables` action)

```json
{
  "source": "pfn-nfl-hq",
  "fetched_at": "2026-09-24T22:30:00+00:00",
  "tables": {
    "offensive-line": {
      "label": "O-Line",
      "columns": ["grade", "pass_block", "run_block", "pen_per_game"],
      "column_labels": {"grade": "Grade", ...},
      "page_headers": ["Grade", "Pass Block", "Run Block", "Pen/G"],
      "rows": [
        {"rank": 1, "team": "LAR", "team_name": "Los Angeles Rams",
         "grade": 82.8, "pass_block": 76.6, "run_block": 88.7, "pen_per_game": 1.5},
        ...
      ]
    },
    "offense": {...}, "defense": {...}, "team-overall": {...}
  }
}
```

The app stores each table under `source_cache` keys `pfn:offensive-line`,
`pfn:offense`, `pfn:defense`, `pfn:team-overall` and serves them through the
`getpfntables` action to the Tables view (Tools → Tables).

## Weekly job

A cron job (`pfn-weekly-pull`, Wednesdays ~07:00 PT) runs `scrape.py`; when
the status line reads `changed` it invokes the `fantasy-rankings` artifact
action `ingeststagedpfntables`, which reads `data/staged_pfn_tables.json`
through the privileged `readStagedPfnTables` contract. Unchanged weeks do
nothing further.

## Env vars

- `PFN_DATA_DIR` — data dir (default: `<repo>/data`)
- `PFN_BASE_URL` — override the rankings base URL (default:
  `https://www.profootballnetwork.com/nfl-hq/rankings`)

## GitHub Action port notes

- Single file, stdlib only: `python -m` nothing, just `python3 scrape.py`.
- Set `PFN_DATA_DIR: ${{ github.workspace }}/pfn-data`.
- Persist change detection across runs with `actions/cache` on
  `pfn-data/.last_hash.json` (and `pfn-data/latest.json` for continuity).
- Upload `pfn-data/snapshots/` as a workflow artifact for history.
- Ingest step after this port: POST the staged payload to the deployed
  app's ingest endpoint (the sandbox privileged-file path won't exist
  there) — or commit `staged_pfn_tables.json` to the repo and have the
  deploy read it at build time.
