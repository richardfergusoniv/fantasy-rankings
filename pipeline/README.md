# props-aggregator

Pull NFL player props from many providers, normalize them into one record
shape, and build a cross-provider consensus (median line, book count, line
spread) for projection modeling.

Only dependency: `requests` (plus `pytest` for tests). No accounts are
created and no credentials are entered by this tool — API keys come from
environment variables only, and are never written to source, logs, or fixtures.

## Setup

```bash
cd props-aggregator
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # requests
.venv/bin/pip install pytest                # tests only
cp .env.example .env   # then fill in the keys you have (never commit .env)
```

## Usage

```bash
# Validate setup without making any keyed calls
.venv/bin/python -m props_aggregator.cli --check-config

# Pull one provider (Stat Pick is keyless and works with no setup)
.venv/bin/python -m props_aggregator.cli pull --provider statpick --week 3

# Pull everything you have keys for
.venv/bin/python -m props_aggregator.cli pull --all --week 3 --season 2026

# Report markets / players / books per provider from pulled data
.venv/bin/python -m props_aggregator.cli coverage --week 3 --season 2026
```

`pull` writes:

- `data/props_<season>_w<week>.json` — every normalized record, grouped by provider
- `data/consensus_<season>_w<week>.json` — one row per player/stat: consensus
  line across providers and books, book count, line spread, median over/under
  odds, per-book TD probability for anytime_td

## Consensus method (one book, one vote)

Raw prop feeds contain alt-line ladders (one book posting 0.5/1.5/2.5/3.5 on
the same market) and duplicate provider copies of the same book. To keep one
book from voting many times, consensus collapses each book to a single vote:

1. Records are grouped by normalized player/stat/book. Book names are
   normalized (`DraftKings`/`draftkings`, `DraftKings Pick6`/`pick6`,
   `Hard Rock Bet (FL)`/`hardrock`, `BetOnline.ag`/`betonline`,
   `betPARX`/`parx`, …); provider-added team suffixes like
   `Michael Penix Jr. (ATL)` are stripped.
2. Each book's provisional vote is the median of its own posted lines.
3. The cross-book anchor is the median of those provisional votes.
4. Each book's final vote is the posted rung nearest the anchor — this drops
   alt-line ladder rungs and junk lines deterministically, with no
   distance-threshold trimming.
5. With only one book there is no cross-book anchor, so the book's own
   median line (mid-ladder) is the vote rather than an arbitrary rung.
6. The consensus line is the median of the book votes.

`anytime_td` is special: the line is nearly always 0.5, so the market signal
is the price. The consensus stores `td_probability`, the median of the
per-book implied probabilities — converting the median odds instead would
corrupt markets whose books straddle -110/+100 (the median odds land near
zero and convert to ~0%).

Each row also carries `anchor_line`, `alt_lines_filtered` (records collapsed
away), and `contested` (max line spread beyond per-stat drastic cutoffs —
observability only, never affects the projection).

## Normalized record

```json
{
  "provider": "statpick",
  "book": "consensus(5)",
  "player": "Matthew Stafford",
  "team": "LAR",
  "opponent": "DEN",
  "game_id": "statpick:matthew-stafford:2026-09-27",
  "week": 3,
  "season": 2026,
  "stat": "pass_yards",
  "line": 240.5,
  "over_odds": -114,
  "under_odds": -115,
  "fetched_at": "2026-09-22T22:40:00+00:00"
}
```

Canonical stats: `pass_yards, pass_tds, pass_completions, pass_attempts,
pass_interceptions, rush_yards, rush_attempts, rec_yards, receptions,
longest_reception, anytime_td, first_td, sacks, tackles, kicker_points,
field_goals_made`. Provider-native market names map to these in
`props_aggregator/markets.py`; anything unmapped is skipped (never guessed).

## Provider status (2026-09-22)

| Provider | Auth | Free tier | State |
|---|---|---|---|
| statpick | none | keyless | **working, live-verified** |
| propline | `apiKey` query | 1,000 req/day, no card | implemented, needs key |
| parlayapi | `apiKey` query | 1,000 credits/mo, no card | implemented, needs key |
| sharpapi | `X-API-Key` header | 12 req/min, 2 books | live 2026-09-22: 237 records, 14 markets |
| sportsgameodds | `x-api-key` header | 100 req/day trial, **requires card on file** | implemented, market ids need runtime discovery |
| moneyline | `x-api-key` header | 1,000 credits/mo | implemented, **base URL unverified** |
| rapidodds | `api_key` query | 250 credits | implemented, sport/market ids provisional |
| oddspapi | `apiKey` query | 250 req/mo | implemented, market ids need key to discover |
| theoddsapi | `apiKey` query | 500 req/mo (MLB/NBA only) | implemented, **NFL needs paid tier** |
| oddsapiio | `apiKey` query | 100 req/hour, no card | implemented, league slug provisional |
| propzapi | — | — | **inactive**: domain now serves an unrelated API |
| sportsdataio | `Ocp-Apim-Subscription-Key` | no odds on free | stub: needs paid odds entitlement |
| apisports | `x-apisports-key` | 100 req/day | stub: NFL props coverage unconfirmed |

Full research notes, contradictions, and unresolved assumptions: [`PROVIDERS.md`](PROVIDERS.md).

## Adding a provider

1. Create `props_aggregator/providers/<name>.py` with a `BaseProvider` subclass
   (`name`, `env_var`, `fetch_props(week, season) -> list[PropRecord]`).
2. Add native→canonical market mappings in `markets.py`.
3. Register it in `props_aggregator/providers/__init__.py`.
4. Add a fixture-based test under `tests/`.

## Tests

```bash
.venv/bin/python -m pytest tests/ -q
```
