# Provider research dossier (2026-09-22)

Every claim below was verified against official docs, official SDKs, or a
live keyless probe on 2026-09-22. Anything marked PROVISIONAL or
UNVERIFIED is an inference that must be confirmed with a key at runtime —
the code never guesses silently; unmapped markets are skipped.

## Stat Pick API — working, keyless

- Base: `https://api.statpick.ai`
- Auth: none. Descriptive User-Agent requested; honor `Cache-Control`.
- Quota: n/a (no key).
- Endpoints (all live-probed):
  - `GET /api/nfl/prop-pages/slate` → `{games: [...], recentlyActive: [...]}`
  - `GET /api/nfl/prop-pages/player/{playerSlug}` → `{player, nextGame, stats, season}`
  - also `/api/{sport}/prop-pages/player/{slug}/stat/{statSlug}`, `/api/app-config`
- Player payload: `player{playerName, teamAbbr}`, `nextGame{opponentAbbr, date}`,
  `stats[{statSlug, line{line, overOdds, underOdds, bookCount, asOfDate}}]`.
- Verified stat slugs: `passing-yards`, `passing-tds`, `rushing-yards`,
  `receiving-yards`, `receptions`, `anytime-td`, `rush-rec-yards` (combo, skipped).
- Nature: a prop-research board publishing a cross-book consensus line per
  player/stat (bookCount given), not per-book odds. `book` is recorded as
  `consensus(N)`.
- Docs: https://www.statpick.ai/developers

## PropLine — implemented, needs key

- Base: `https://api.prop-line.com/v1`
- Auth: `apiKey` query parameter (SDK: `PropLine("key")`).
- Free: **1,000 requests/day, no credit card** (site + SDK README, 2026-09-22).
- Endpoints: `/sports/football_nfl/events`,
  `/sports/football_nfl/events/{id}/odds?markets=..&regions=us`.
  the-odds-api compatible: sport aliases (`americanfootball_nfl`), `bookmakers`
  param, `oddsFormat=american`, outcome `{description, name, point, price}`.
- Documented NFL markets: `player_pass_yds`, `player_pass_tds`,
  `player_rush_yds`, `player_reception_yds`, `player_receptions`,
  `player_anytime_td`, `player_1st_td`, `player_2plus_td`. The client also
  requests the wider the-odds-api NFL set and retries with the documented
  subset on a 400.
- Books: homepage advertises 22 books + 7 exchanges + DFS; per-sport coverage
  varies (README book table is MLB/NBA/NHL-centric — confirm NFL book list
  at runtime via the `coverage` command).
- Contradiction: older PyPI/SDK pages say 500 req/day; current site and GitHub
  README say 1,000. Code assumes 1,000; note it if you get 429s early.
- Outcome `team` is not provided per player prop — `team`/`opponent` stay
  empty for this provider until a roster join exists.
- Refs: https://prop-line.com, https://github.com/proplineapi/propline-python

## ParlayAPI — implemented, needs key

- Base: `https://parlay-api.com/v1` (documented as a one-line swap for
  `https://api.the-odds-api.com/v4`: same endpoints, params, response format).
- Auth: `apiKey` query param (X-API-Key header also supported).
- Free: 1,000 credits/month, no credit card, REST only.
- Endpoints: `/v1/sports`, `/v1/sports/americanfootball_nfl/events`,
  `/v1/sports/americanfootball_nfl/events/{id}/odds`.
- Machine-readable credit costs: `GET /v1/meta/credit-costs`,
  `GET /v1/meta/limits`. Confirmed live (keyless) 2026-09-22:
  `GET /v1/sports/{sport_key}/props` ("Player props for one sport") costs
  **3 credits** → ~333 NFL board pulls/month on the free 1,000 credits.
  The client uses this board endpoint (not the per-event odds loop).
- Keyless sandbox `/v1/sandbox/*` exists for evaluation (not used by client).
- Refs: https://parlay-api.com/llms.txt, https://parlay-api.com/docs

## SharpAPI — live, account created 2026-09-22 (free, no card)

- Base: `https://api.sharpapi.io/api/v1`
- Auth: `X-API-Key` header (Bearer <redacted> also works).
- Free: 12 req/min, **2 sportsbooks** (DraftKings, FanDuel on the account),
  Odds + Schedule only, no card. 60s data delay.
  (Tiers: Hobby $79/5 books, Pro $229/15 books, Sharp $399/all.)
- Account: rdfergus15@gmail.com, email-verified; key in gitignored `.env`
  as `SHARPAPI_API_KEY`. Free plan allows exactly 1 API key.
- Endpoints: `GET /events`, `GET /odds` (filters: sport, league, market,
  sportsbook, event, player_name; offset pagination capped at 500 —
  cursor pagination expires quickly), `GET /health` (freshness probe).
- Market catalog: `GET /markets?sport=football&league=nfl` enumerates ids.
  Client pulls per market id (`SHARPAPI_MARKETS` in markets.py, 16 mapped
  to canonical stats incl. binary TD-scorer markets as implicit 0.5 lines).
  Combos and non-canonical markets map to None and are skipped/logged.
- Live pull 2026-09-22: 237 records, 52 players, 14 canonical markets,
  DraftKings + FanDuel, main lines only.
- Refs: https://docs.sharpapi.io, https://api.sharpapi.io/llms.txt,
  https://github.com/sharp-api/sharpapi-python

## SportsGameOdds — live, account created 2026-09-22 (free $0/mo, card on file)

- Account: rdfergus15@gmail.com, Amateur tier, active. Key in `.env`
  (`SPORTSGAMEODDS_API_KEY`); never reproduce it.
- Base: `https://api.sportsgameodds.com/v2`
- Auth: `x-api-key` header (`apiKey` query param also works).
- Free: **$0/mo, 2,500 objects/month** — an object is one *event* returned,
  not one odds entry (a full NFL `/events` pull is ~10-16 objects, so each
  production pull costs ~16 objects). 10 requests/min. Monthly requests
  unlimited. Card required on file via Stripe at signup despite $0.
- Overage behavior: 429s, NOT charges. Usage checked live 2026-09-22 via
  `/account/usage` (free, doesn't count against limits): 80/2,500 monthly
  objects used. Pulls stay manual-only; ~16 objects per production pull.
- Main endpoint: `GET /events?leagueID=NFL&oddsAvailable=true[&oddID=..]`.
  Response: `{success, data: [Event], nextCursor}`.
- oddID format: `statID-statEntityID-periodID-betTypeID-sideID`
  (e.g. `points-home-game-ml-home`). Player entity IDs look like
  `AUSTIN_HOOPER_1_NFL` (suffix stripped in the client).
- Player-prop statIDs **discovered live 2026-09-22** (table in
  `markets.SGO_STAT_IDS`; misses are skipped, never guessed):
  `touchdowns`->anytime_td (ou; alt lines only observed, e.g. 1.5),
  `firstTouchdown`->first_td (yn-yes binary -> implicit 0.5),
  `passing_yards`/`passing_touchdowns`/`passing_completions`/
  `passing_attempts`/`passing_interceptions`,
  `rushing_yards`/`rushing_attempts`, `receiving_yards`/
  `receiving_receptions`/`receiving_longestReception`,
  `defense_sacks`->sacks, `defense_combinedTackles`->tackles,
  `fieldGoals_made`, `kicking_totalPoints`->kicker_points.
  Skipped as noncanonical/combo: lastTouchdown, rushing+receiving_yards,
  passing+rushing_yards, fantasyScore, longest rush/completion, targets,
  extra points made, rushing TDs, solo/assisted tackles.
- Line key is `overUnder`, odds are signed American strings (`"+5500"`).
- Verified pull 2026-09-22: **1,113 records, 391 consensus rows,
  160 players, 6 books** (betmgm, bovada, caesars, draftkings, espnbet,
  fanduel — espnbet is new vs other providers), 14 canonical markets.
  Defense markets returned empty byBookmaker nodes (no books offering).
- Refs: https://sportsgameodds.com/docs (FAQ documents objects/requests)

## MoneyLine API — verified live 2026-09-22

- Auth: `x-api-key` header. Key in gitignored `.env` (never reproduce in chat).
- Base: `https://mlapi.bet` — verified from official docs
  ("All requests go through a single base URL").
- Endpoints: `GET /v1/player-props` (use `league=nfl`), 
  `GET /v1/events/:eventId/player-props`, `GET /v1/player-props/markets`.
  Player entries include team abbreviation/name. Covers NFL sportsbook, DFS,
  exchange props. Response shape: `{success, data: [events with players[]]}`
  where each player has `markets[]` with `lines[]`/`offers[]` per book.
- Free: 1,000 credits/month, **auto-upgrade OFF** (confirmed in dashboard —
  access suspends if the limit is exceeded, never charges). Keep pulls
  manual-only and small.
- Verified pull 2026-09-22: **4,401 records, 1,194 consensus rows,
  454 players, 19 books, 15 canonical markets.** Main lines only
  (isAlternate=false); alternates, period splits, and combo markets skipped.
- Refs: https://www.moneylineapp.com/docs

## RapidOddsAPI — implemented, ids provisional

- Base: `https://api.rapidoddsapi.com`
- Auth: `api_key` query parameter (keys start with `oa_`).
- Free: 250 credits (per comparison table). Cost per call:
  `market_types × ceil(bookmakers / 5)`; unproductive calls are not charged.
- Endpoint: `GET /sports/{sport_id}/markets?api_key=..&market_type=..&bookmaker=..`
- Response: `{sport, games: [{game: {commence_time, home_team, away_team},
  bookmakers: [{name, last_update,
  markets: [{key, outcomes: [{name, price (DECIMAL), point, player_name}]}]}]}]}`.
  Prices are decimal → converted to American in the client.
- `sport_id` for NFL (default `NFL`) and player-prop `market_type` values
  come from the coverage page — defaults are PROVISIONAL, confirm with a key.
  Default books: DraftKings, FanDuel (1 credit per market_type).
- Refs: https://rapidoddsapi.com/docs

## OddsPapi — implemented, market ids need key to discover

- Current docs base: `https://api.oddspapi.io/v4`, auth `apiKey` query param.
- Endpoints: `/sports`, `/tournaments`, `/fixtures`, `/odds?fixtureId=..`.
- Claims player props + 300+ bookmakers; deeply nested
  `bookmakerOdds → book → markets → market id → outcomes → outcome id → players`.
- Free: 250 requests/month (per comparison table; free player-prop
  entitlements conflict across product pages — verify).
- **Conflicts:** older integrations use `https://v5.oddspapi.io/en`; one
  third-party example suggests `/v1` + Bearer <redacted> (unverified). NFL sport id
  and prop market/outcome ids need runtime discovery — the client discovers
  the sport id from `/sports` and parses defensively, skipping unmappable rows.
- Refs: https://oddspapi.io (docs)

## The Odds API — implemented, NFL is paid-only

- Base: `https://api.the-odds-api.com/v4`, auth `apiKey` query param.
- Free: 500 requests/month.
- **Richard's free key returned 403 for NFL (verified earlier 2026-09-22);
  free scope is MLB/NBA only.** Client is implemented for a paid key.
- Standard endpoints: `/sports/americanfootball_nfl/events`,
  `/events/{id}/odds?markets=..&regions=us&oddsFormat=american`.

## Odds-API.io — implemented, league slug provisional

- Base: `https://api.odds-api.io/v3` (NOT `/v1` — the comparison table was wrong).
- Auth: `apiKey` query parameter (NOT Bearer — the table was wrong).
- Free: **100 requests/hour**, no credit card (NOT 100/month).
- `GET /v3/events?sport=football&league=usa-nfl` (slug by analogy with
  `usa-nba` — PROVISIONAL); `GET /v3/odds?eventId=..&bookmakers=DraftKings,FanDuel`.
- Props arrive as a generic `"Player Props"` market; each odd:
  `{label: "Player - Stat", hdp: <line>, over/under: <decimal strings>}`.
  Decimals converted to American. Stat half of the label mapped in
  `ODDSAPIIO_LABELS` (provisional for NFL labels).
- Verified via official blog/docs plus two independent GitHub integrations.

## PropzAPI — INACTIVE

- Old references describe a sports-props API at `api.propzapi.com` (X-API-Key).
- The live `https://api.propzapi.com/openapi.json` (fetched 2026-09-22)
  describes an unrelated image-generation/screenshot/QR/template API.
- Verdict: sports product unavailable, renamed, or domain repurposed. Stub
  stays inactive until a valid current sports endpoint is supplied.

## SportsDataIO — stub

- Base: `https://api.sportsdata.io/v3/nfl/`,
  auth `Ocp-Apim-Subscription-Key` header.
- Scores/players/projections endpoints are known, but player-props odds are
  not on the free tier. Stub raises a clear error until a key with odds
  entitlement is available.

## API-Sports — stub

- Base (pattern-based, UNVERIFIED): `https://v1.american-football.api-sports.io`,
  auth `x-apisports-key` header. Free: 100 req/day (per table).
- `/odds` endpoints exist but NFL player-props coverage is thin/unconfirmed.
  Stub until probed with a key.
