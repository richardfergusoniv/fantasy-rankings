# Scoring rules spec: Start/Sit, Waivers, Trades

<!-- Exported from the spec Page "Scoring rules spec: Start/Sit, Waivers, Trades" on 2026-10-23. This file is self-contained; numeric tables are also in scoring-constants.json. -->

> **Build brief for the coding agent.** Repo: `richardfergusoniv/fantasy-rankings`. Build one pure, deterministic module, `api/_lib/move-scoring.ts`, plus the fix-now items in "Fix-now build plan" at the end.
> Constraints:
> - No new Vercel functions: 10 of 12 are used, so extend existing endpoints such as `api/cron/jobs.ts` and `api/ingest/[target].ts`.
> - New logic goes under `api/_lib`.
> - Free data sources only.
> - Keep Supabase egress low, and never run full scans of `player_value_snapshots` (indexed per-player lookups only).
> - Load numbers from `scoring-constants.json`, which becomes the built-in fallback for `SCORING_WEIGHTS` / the active `scoring_weights` row. Don't hardcode them in several places.
> - Anything marked *unverifiable* or *untested* must stay reason-only or a tiebreaker. Do not give it score weight.

Deterministic scores for every move in the app's three windows (Week N, Season Long, Dynasty), built from data the dashboard already loads. The chat model only explains the numbers.

## The approach

1. Start/sit gets a Week N score only. Waivers and trades get one score per window: Week N, Season Long, and Dynasty (Dynasty only when `league.seasonLongFormat.isDynasty`).
2. Week N runs on projected stat components (receptions, yards, TDs, first downs) scored with the league's own settings. Season Long and Dynasty run on FantasyCalc redraft and dynasty values.
3. Every score compares against a replacement: your best bench option for start/sit, your drop candidate for waivers, and your current lineup for trades.
4. Labels come from fixed thresholds. Each score returns a list of reasons, each with its source and its effect.
5. One pure module, `api/_lib/move-scoring.ts`, used by the chat tools now and by in-app badges later. No new Vercel functions; weights come from one small cached Supabase row and are refit weekly.

## Windows

| Window | Internal keys | Basis | Shown |
|---|---|---|---|
| Week N | `week` / scope `week` / `powerRankingsWeek` | League-scored projected points | All leagues |
| Season Long | `ros` / `restOfSeason` + `seasonLong` / `powerRankingsSeasonLong` | FantasyCalc redraft value (`redraft-{qb}qb-{teams}t-{ppr}ppr`); waivers and trades only | All leagues |
| Dynasty | `dynasty` / `powerRankingsDynasty` | FantasyCalc dynasty value + future picks | Dynasty leagues only |

Dynasty leagues use the redraft twin (`redraftTwinFormat`, api/_lib/season-long-format.ts) for Season Long. The dashboard already loads both formats.

## Shared building blocks

### Replacement level

| Move | Week N replacement | Season Long / Dynasty replacement |
|---|---|---|
| Start/Sit | Best eligible player for the same slot (`eligibleForSlot`, `optimizeLineup`) | Not scored (Week N only) |
| Waiver | Your lineup with the drop candidate still rostered | Your drop candidate's value |
| Trade | Your current best lineup (`optimizeTradeRoster`) | Your current starters and bench value |

Slots come from `tradeStarterSlots` (Sleeper `roster_positions` minus BN/IR/TAXI), so SUPER_FLEX, REC_FLEX and WRRB_FLEX are handled by the existing optimizer.

### Positional need

```
need_pos = max(0, (league median − yours) / (league median))
```

Read from `positionValues` (QB/RB/WR/TE) on the matching power-rankings array, across all teams in the league. Need ranges from 0 to 1. A position is a hole when your rank is in the bottom third.

### Injury rules

| Status | Week N | Season Long / Dynasty |
|---|---|---|
| Out, IR, PUP, NFI, Suspended, Inactive (`isUnavailableForCurrentWeek`) | Projection 0; start/sit is always Sit | No extra discount (market value already prices it) |
| Doubtful | Same as Out: projection 0 (1.2% of Doubtful players played, 2018–25) | No change |
| Questionable, before inactives | Mean = p_play × m × P*; σ² = p_play × σ(P*)² + p_play(1 − p_play)(m × P*)² | No change |
| Questionable, active at kickoff | m × P*, normal σ | No change |
| Bye (`isBye`) | 0 | No change |
| Game live or final | `liveForecastPoints`: actual + paced remainder; Out while live = actual only | No change |

| Questionable starter | p_play | m (points vs trailing PPG when played) |
|---|---|---|
| QB | 0.50 | 0.86 |
| RB | 0.71 | 0.90 |
| WR | 0.76 | 0.82 |
| TE | 0.77 | 0.90 |
| All Questionable players | 0.62 | 0.88 |

nflverse 2018–2025, final game-week status, played = at least one offensive snap. Starter = 50%+ average snap share over 2+ prior games. Healthy starters score 0.97–1.04 of trailing PPG, so m is a real discount.

## Start/Sit

### Inputs

| Input | Source (verified) |
|---|---|
| League-scored projection V | `rankings[].leagueProjection`, `mergePlayerProjections` (api/_lib/player-projection-merge.ts), cache `dashboard-live-projections-v25` |
| PPR baseline (scoring conversion) | `rankings[].vegasProjection` |
| Live points | `liveForecastPoints` (api/_lib/lineup-optimizer.ts) |
| Injury, bye, opponent | `rankings[].injuryStatus`, `isBye`, `opponent` |
| Matchup rank r (reasons only, no score effect) | `strengthOfSchedule[].table[team][pos].rank`, cache `strength-of-schedule-v1:{leagueId}` (pipeline/build_matchup_grades.mjs) |
| Usage: expected points by week | `analytics.entities[].weeklyExpected`, cache `player-insights-2026-v1` (ffopportunity) |
| Usage: snap share by week | `analytics.entities[].weeklySnaps`, cache `nflverse-chart-extras-2026-v1` |
| Spread by position | Projection-scaled SD table below, replacing `SCORE_SPREAD_BY_POSITION` (frontend/src/views/win-probability.ts) |
| Your win probability | `teamOutlook` + `winProbability` (same file) |
| Lineup and slots | `league.starters`, `league.bench`, `optimizeLineup`, `eligibleForSlot` |
| Reasons only | Prop lines and moves (`loadPropLineWeek`, table `prop_line_snapshots`), FantasyPros ECR (`playerInsights.experts`), news (`shared_player_news`) |

### Formula

```
P* = w_v · V + (1 − w_v) · U
```

```
Start score = Φ((P*(player) − P*(alternative)) / (√(σ_player² + σ_alt²))), σ = a_pos + b_pos × P*
```

V and U are built as stat components (receptions, rush and receiving yards, TDs, first downs, pass yards and TDs, interceptions), then scored with the league's `scoring_settings`. This handles half-PPR, PPFD and TE premium directly instead of a ratio conversion.

U is usage-based: last-3 and season-to-date expected points, snap share and target share. No separate matchup or defense term: opponent points allowed did not improve held-out error at any position once closing lines were in. With fewer than 2 games of usage data, w_v = 1. With no Vegas line either, P* is the position-median Week N projection for players at the same FantasyCalc redraft value rank.

The score is the chance the player outscores his alternative, from 0 to 100. For a starter, the alternative is the best bench player eligible for his slot. For a bench player, it is the weakest starter he could replace.

### Weights by position

| Position | Vegas w_v | Usage 1 − w_v | SD a | SD b |
|---|---|---|---|---|
| QB | 0.80 | 0.20 | 5.9 | 0.13 |
| RB | 0.50 | 0.50 | 4.3 | 0.25 |
| WR | 0.25 | 0.75 | 3.0 | 0.39 |
| TE | 0.20 | 0.80 | 3.2 | 0.37 |

Fitted on 2018–23, tested on 2024–25. RB error is flat from 0.3 to 0.8 (within 0.02 pts), so 0.50 is the safe middle. The Vegas side here was a team-total share proxy; refit with the app's prop-based V once enough weeks are stored.

| SD at projection | 5 | 10 | 15 | 20 | 25 |
|---|---|---|---|---|---|
| QB | — | 7.2 | 7.8 | 8.5 | 9.2 |
| RB | 5.6 | 6.9 | 8.1 | 9.4 | 10.7 |
| WR | 4.9 | 6.9 | 8.8 | 10.8 | — |
| TE | 5.0 | 6.9 | 8.7 | — | — |

### Labels

| Label | Win-the-slot chance (Week N only) |
|---|---|
| Strong start | ≥ 70 |
| Start | 55–70 |
| Flex | 45–55 |
| Sit | < 45, or unavailable |

Close calls (Flex band): start whichever option gives the higher chance of winning this week's matchup, not the higher projection.

```
P(win) = Φ((your lineup P* − opponent lineup P*) / (√(Var(yours) + Var(opponent) − 2 Cov(yours, opponent))))
```

```
Var(lineup) = Σ σᵢ² + 2 Σᵢ<ⱼ ρᵢⱼ σᵢ σⱼ;  Cov(yours, opponent) = Σᵢⱼ ρᵢⱼ σᵢ σⱼ
```

| Pair (ρ, nflverse 2018–25 weekly points) | ρ |
|---|---|
| QB with own WR1 / WR2 / TE1 / RB1 | 0.35 / 0.33 / 0.27 / 0.06 |
| Own WR1–WR2, WR1–TE1, RB1–RB2 | 0 (−0.005, −0.01, −0.04) |
| Own DST with own RB1 / QB / WR1 | 0.05 / −0.09 / −0.06 |
| QB vs opposing QB / opposing WR1 | 0.21 / 0.09 |
| DST vs the offense it faces: QB / RB / WR | −0.39 / −0.20 / −0.15 |
| DST vs opposing DST | −0.22 |
| All other pairs | 0 |

Closed form over at most about 18 × 18 pairs, so it runs in the pure module or in the browser with no simulation. WR1/WR2 come from target-share rank on the team. As an underdog this picks the higher-variance option; as a favorite it picks the higher floor. If no eligible bench player exists, the label is Strong start with reason "no eligible backup".

### EXAMPLE walkthrough

| EXAMPLE: FLEX, half-PPR | WR A | WR B |
|---|---|---|
| Vegas league projection V | 13.2 | 12.8 |
| Usage projection U (league-scored) | 13.5 | 9.9 |
| P* = 0.25·V + 0.75·U (WR) | 13.43 | 10.63 |
| σ = 3.0 + 0.39 × P* | 8.23 | 7.14 |
| Week N score | 60 | 40 |
| Week N label | Start | Sit |

EXAMPLE reasons for A: "Projects 2.8 more points than B", "Expected points up over the last 3 games".

## Waivers (add/drop)

### Inputs

| Input | Source (verified) |
|---|---|
| Free agents (QB/RB/WR/TE) | `league.tradeWaiverPool` (dashboard-build.ts), sorted by projection |
| Your roster and slots | `league.starters`, `league.bench`, `league.tradeStarterSlots` |
| Week N points | `projection` on each player, `optimizeTradeRoster` |
| Season Long value | `seasonLongRankings[].value`, redraft key |
| Dynasty value | `seasonLongRankings[].value`, `league.seasonLongFormat.key` |
| Positional need | `powerRankingsWeek / SeasonLong / Dynasty[].positionValues` |
| Value trend | `seasonLongRankings[].trend30Day`; per-player history from `player_value_snapshots` (indexed by format + player, one player at a time) |
| Reasons only | Sleeper adds/drops (`playerTrending`), depth chart (`playerInsights.depth` vs `depthPrevious`), news (`shared_player_news`) |

### Formula

```
Week N: Δ = Lineup(roster + add − drop) − Lineup(roster)
```

```
Gain = ΔStarterValue + b × (1 + need_pos) × ΔBenchValue
```

```
Season Long / Dynasty score = (Gain) / (your current StarterValue)
```

StarterValue fills your slots by value with the same optimizer, using value in place of projection. The drop candidate is the same in every window: your lowest-value bench player in the league's main window (Season Long for redraft, Dynasty for dynasty), never an IR or taxi player and never someone in this week's best lineup.

### Weights and labels

| Item | Week N | Season Long | Dynasty |
|---|---|---|---|
| Metric | Lineup points gained | Gain % of starters | Gain % of starters |
| Bench weight b | — | 0.25 | 0.60 |
| Must add | ≥ 4.0 pts | ≥ 5% | ≥ 5% |
| Add | 1.5–4.0 | 2–5% | 2–5% |
| Watch | 0.5–1.5 | 0.5–2% | 0.5–2% |
| Pass | < 0.5 | < 0.5% | < 0.5% |

Pass is the lowest label and is hidden from waiver lists; it shows only when you ask about that player. Trending adds, depth-chart moves and news are listed as reasons but do not change the score.

### Usage alerts

| Trigger (one game) | Hit rate 2024–25 | Hit rate 2018–23 | Base rate 2024–25 |
|---|---|---|---|
| QB: 30+ pass attempts | 30% | 39% | 22% |
| RB: 60%+ snap share | 43% | 49% | 18% |
| RB: 15+ carries | 34% | 50% | 18% |
| WR: 80%+ snap share | 36% | 30% | 15% |
| WR: 20%+ target share | 32% | 35% | 15% |
| TE: 15%+ target share | 36% | 30% | 15% |
| TE: 5+ targets | 35% | 30% | 15% |

Candidate: season PPG below QB 16, RB 10, WR 11, TE 8 when the trigger first fires. Hit: rest-of-season PPG at or above that cutoff over 4+ more games. Base rate: any candidate, no trigger. A trigger roughly doubles the base rate but still misses most of the time, so an alert surfaces the player with the trigger as a reason; the waiver score itself is unchanged.

### EXAMPLE walkthrough

| EXAMPLE: add RB C, drop WR D | Value | Result |
|---|---|---|
| Week N: C at FLEX vs current FLEX | 11.4 vs 9.1 | +2.3 pts, Add |
| Season Long ΔStarterValue | +1,100 |  |
| Season Long ΔBenchValue, need RB 0.20 | +700 × 0.25 × 1.2 = +210 |  |
| Season Long gain / starters 38,000 | 1,310 | 3.4%, Add |
| Dynasty values C vs D | 2,100 vs 2,600 |  |
| Dynasty gain: −500 × 0.60 × 1.2 | −360 / 52,000 | −0.7%, Pass |

EXAMPLE reasons: "Starts at FLEX this week (+2.3 pts)", "Fills your weakest position (RB)", "Dynasty: D is worth 500 more".

## Trades

### Inputs

| Input | Source (verified) |
|---|---|
| Both rosters, picks, records | `league.tradeTeams[]` (`players`, `ownedPicks`, `record`) |
| League-adjusted values | Trade calculator League mode (frontend/src/views/trade-calculator.tsx): `seasonLongRankings` + `waiverAdjustments` (frontend/src/lib/trade-adjustment.ts) |
| Pick values | FantasyCalc PICK rows; tier from `blendedContenderRanks` + `pickTierForRank` (api/_lib/pick-tier.ts) |
| Lineup points before/after | `optimizeTradeRoster` (api/_lib/lineup-optimizer.ts), not wired anywhere yet |
| Power rankings before/after | `powerRankingsAfterTrade` (frontend/src/lib/trade-power.ts) |
| Unpriced settings | `league.tradeValuation.unsupportedSettings` (TE premium, first downs, bonuses, K/DEF) |

### Formula

```
gap % = (Get − Give) / (max(Get, Give))
```

```
Week N: Δ = Lineup_after − Lineup_before (both teams)
```

Every trade leads with the lineup change for both teams: starter value before and after (Week N: lineup points). Then power rank before and after, fit (position ranks before and after), and the value gap. Dynasty power ranks include `futurePickValue`.

Pick values are FantasyCalc's as-is, with no extra discount; its market prices already reflect pick uncertainty.

### Labels and fairness band

| Label | Week N | Season Long and Dynasty |
|---|---|---|
| Accept | Δ ≥ +1.0 pts | gap ≥ 0, starter value not lower, and power rank not worse |
| Lean accept | 0 to +1.0 pts | z ≥ −1 (Fair), and starter value up or fills a bottom-third position |
| Decline | Δ < 0 | Anything else |

Fair means the value gap is smaller than a normal month of market movement for the players involved.

```
z = (Get − Give) / (√(Σ σ₃₀(vᵢ)² over every player and pick on both sides))
```

| Band | \|z\| | Gap reversed within 30 days, in-season | Offseason |
|---|---|---|---|
| Fair | ≤ 1 | 29.8% | 27.5% |
| Uneven | 1–2 | 8.1% | 6.4% |
| Lopsided | > 2 | 0.5% | 0.2% |

| σ₃₀(v): SD of 30-day value change | Formula | v = 1,000 | 3,000 | 5,000 | 8,000 |
|---|---|---|---|---|---|
| Dynasty, in-season (Aug 1 on) | 231 + 0.073v | 304 | 450 | 596 | 815 |
| Dynasty, offseason (Jan–Jul) | 139 + 0.017v | 156 | 190 | 224 | 275 |
| Season Long (redraft), in-season | 567 + 0.088v | 655 | 831 | 1,007 | 1,271 |
| Season Long, offseason | In-season curve (unverifiable: redraft history starts Jul 26) |  |  |  |  |

Fitted on `player_value_snapshots` 2026 (dynasty-2qb-12t-1ppr from Jan 1, redraft-1qb-12t-1ppr from Jul 26), 30-day changes from weekly start dates, values ≥ 500, by position × value tier; positions differ by less than the tier effect, so one curve per window. FantasyCalc's current `trend30Day` spread by tier agrees (dynasty 602 / 698 / 454 / 366 for 6,000+ / 3,000–6,000 / 1,500–3,000 / 500–1,500). Test: 1-for-1 pairs on the same date (dynasty, top 200 players; 75k in-season, 271k offseason pairs), share whose value order flipped 30 days later; same data as the fit. Picks use the same curve (untested). The band widens in-season and for multi-player packages, and shrinks in the offseason: median gap inside Fair is 12.2% in-season, 6.0% offseason. Refit σ₃₀ monthly from the same indexed query.

### EXAMPLE walkthrough

| EXAMPLE: give WR F, get RB G + 2027 2nd | Season Long | Dynasty |
|---|---|---|
| Give | 5,200 | 6,800 |
| Get | 5,600 (pick 0) | 4,900 + 1,300 (mid 2nd) = 6,200 |
| Gap | +400, +7.1% | −600, −8.8% |
| σ₃₀ per player (in-season) | F 1,025; G 1,060 | F 727; G 589; 2nd 326 |
| z and band | +400 / 1,474 = +0.27, Fair | −600 / 991 = −0.61, Fair |
| Your starter value change | +650 | −1,400 |
| Your power rank | 5th → 4th | 3rd → 3rd |
| Your RB rank | 10th → 6th | 11th → 7th |
| Partner power rank | 8th → 8th | 6th → 5th |
| Partner WR rank | 11th → 7th | 9th → 5th |
| Label | Accept | Lean accept |

EXAMPLE Week N: your lineup 128.4 → 130.1 (+1.7 pts, Accept); partner 125.0 → 124.2. Starter value change in Season Long: G replaces RB2 H (2,300) and bench WR J (2,550) takes F's slot, so (5,600 + 2,550) − (5,200 + 2,300) = +650.

## Calibration

- **Table:** `projection_accuracy` (api/_lib/schema.ts), written by `saveProjectionAccuracy`
- **Rows today:** Weeks 4–7 of 2026: 710 rows, 346 with actuals, 6 leagues
- **Stored:** Vegas league projection and actual, both × 100; Vegas-sourced players on your and your opponent's rosters only
- **Not stored:** First Down projection (0 rows filled), Sleeper projection, usage, matchup rank, label shown

1. **Pull once.** One query per run: week, league, player, position, projection, actual for rows with actuals (about 350 rows).
2. **Use final scores.** Take actuals from cached final box scores (`sleeper-player-weekly-stats-v1`), not `actual_score`: many of the 346 stored actuals were captured mid-game and run 2–3.5 points low.
3. **Rebuild inputs as of each week.** Usage from `weeklyExpected` / `weeklySnaps` cut at week − 1.
4. **Score every same-slot pair.** For each roster-week, score all pairs eligible for the same slot and record whether the favored player outscored the other.
5. **Check each label.** Strong start should win at least 70% of its pairs, Start 55–70%, Flex near 50%. Also report Brier score and projection MAE.
6. **Tune, then hold out.** Grid-search w_v per position (0–1) and refit the SD table (a, b) on earlier weeks; confirm on later weeks. Ship new weights only if the holdout improves.
7. **Freeze the projection at kickoff.** Stop overwriting `vegas_projection` after lock, so later weeks measure the projection that was actually used.
8. **Write actuals only when final.** Set `actual_score` once the game is final, and fill it for PPFD leagues.

Run it as a local script under pipeline/ (like `build_matchup_grades.mjs`), not a deployed function.

## Weekly calibration

1. **Saturday: decision-time snapshot.** For every rostered player and every free agent in the waiver pool, store projection P*, Vegas component V, usage inputs (last-3 and season-to-date expected points, snap and target share), injury status, vacated teammate usage, team pace and PROE, forecast wind, and unverified candidates (ECR, trending adds, news flags, depth), the Week N / Season Long / Dynasty scores and labels shown, and any tiebreaker that changed a pick (`rule_applied`, pick before and after). Players in Thursday games are snapshotted Thursday before kickoff. Rows are written once and never updated, so every input is as of decision time.
2. **Tuesday: final actuals.** After stat corrections, write final box-score points in league scoring next to each snapshot row. This replaces the mid-game `projection_accuracy.actual_score` write: actuals are saved only once every game that week is final.
3. **Tuesday night: refit.** Rerun the study's tests on all 2026 snapshot weeks so far and write a new versioned weights row (candidate status).
4. **Promote or keep.** Apply the guardrails below; promote the candidate only if it passes, otherwise keep the current version.
5. **Scorecard.** Update label hit rates and win-chance calibration; send Richard a drift flag when a label is off target.

### Parameters

| Parameter | Refits from | Historical prior (2018–25) | Prior strength k | Max change per week |
|---|---|---|---|---|
| Vegas weight w_v | Min-error blend of V and U vs final points, per position | QB 0.80, RB 0.50, WR 0.25, TE 0.20 | 300 player-games | ±0.05 |
| Spread a, b | Regression of absolute error on P*, per position | QB 5.9 + 0.13P*, RB 4.3 + 0.25P*, WR 3.0 + 0.39P*, TE 3.2 + 0.37P* | 300 player-games | a ±0.3, b ±0.02 |
| Questionable p_play | Questionable starters who played an offensive snap | QB 0.50, RB 0.71, WR 0.76, TE 0.77 | 100 cases | ±0.03 |
| Questionable m | Points vs trailing PPG when they played | QB 0.86, RB 0.90, WR 0.82, TE 0.90 | 100 cases | ±0.03 |
| Trade σ₃₀ curves | Monthly: SD of 30-day value change by value, per window and phase (indexed query) | Dynasty 231 + 0.073v in-season, 139 + 0.017v offseason; redraft 567 + 0.088v | 1,000 player-months | ±20% |
| Vacated usage β | Ridge term on teammates Out or Doubtful, per position | Per +10 pts vacated target share: QB 0.17, RB 0.24, WR 0.40, TE 0.47; RB 0.15 per vacated carry | 300 player-games | ±0.05 |
| QB pace/PROE, TE role trend, RB age/draft | Ridge terms, per position (Candidate inputs) | 2018–23 ridge fit | 300 player-games | ±25% of prior |
| Waiver alert hit rates | Alerted players reaching the hit cutoff over 4+ games | Usage alerts table (2024–25 column) | 50 alerts | Reported, not a weight |

```
θ_new = (n · θ_2026 + k · θ_prior) / (n + k)
```

n is the 2026 sample for that parameter. The shrunk value is then capped at the max change per week from the current version.

### Guardrails

| Rule | Detail |
|---|---|
| Shrink to history | Formula above; with little 2026 data the weights stay near the verified 2018–25 values |
| Cap the step | Per-parameter max change per week (Parameters table) |
| Hold-out test | First retune after 3 snapshot weeks. Fit on all weeks except the latest 2; promote only if, on those 2 weeks (300+ player-games), the candidate cuts projection RMSE by ≥ 0.05 pts and win-chance Brier score is not worse |
| Versioning | Every version is kept; rollback sets an older row active. Each snapshot row records the weights version it used. |
| Labels never move silently | Thresholds (70 / 55 / 45, waiver and trade cutoffs) are not refit; drift is flagged instead |

### Scorecard

| Measure | Target | Drift flag |
|---|---|---|
| Strong start beat its alternative | ≥ 70% | < 65% over the last 4 weeks, 50+ pairs |
| Start beat its alternative | 55–70% | Outside 50–75%, 50+ pairs |
| Flex beat its alternative | 45–55% | Outside 40–60%, 50+ pairs |
| Win-chance calibration | Predicted vs actual within 5 points per 10-point bin | Any bin off by > 8 points, 30+ pairs |
| Waiver alert to starter | Near the Usage alerts hit rates | Below the base rate over 50+ alerts |
| Must add / Add became a starter | Tracked | Reported weekly |
| Trade Accept outcome | Starter value and power rank after 4 weeks, when the trade was made | Reported weekly |
| Tiebreaker changed a pick (per rule) | New pick beats the original pick > 50% | ≤ 50% over 50+ cases: drop the rule |

### Architecture

| Piece | Plan |
|---|---|
| Weights table | `scoring_weights`: version, status (candidate / active / retired), created_at, params JSON, holdout metrics. A few rows a season. |
| Snapshot table | `scoring_snapshots`: season, week, league, player, weights version, inputs, scores, labels, final points. Replaces `projection_accuracy` for calibration. |
| Reads in the app | `move-scoring.ts` loads the one active weights row, cached in memory; the 2018–25 values are the built-in fallback |
| Jobs | Saturday snapshot and Tuesday actuals and refit ride an existing cron endpoint or a weekly routine run outside Vercel. No new Vercel functions (stays at 10 of 12). |
| Egress | Refit reads only `scoring_snapshots` for 2026, aggregated in SQL; snapshots are writes. Never scans `player_value_snapshots`. |

## Candidate inputs

A candidate gets score weight only if adding it to the current weights lowers error on held-out weeks with an interval that excludes zero, in both test seasons. Here: fit 2018–23, test 2024–25, PPR, per position, over the usage + lines baseline (test RMSE QB 8.06, RB 7.40, WR 7.40, TE 6.31). In production the same rule runs on the latest 2 snapshot weeks. Everything else is reason text or dropped.

| Input | Position | Decision type | Verified gain (RMSE change, − is better) | Perplexity's claim | Decision | How the weekly refit tests it |
|---|---|---|---|---|---|---|
| Teammate injuries: vacated target share and carries of teammates Out or Doubtful | All | Week N | RB −0.041, TE −0.023, WR −0.022, QB −0.010; all intervals below 0, both seasons. Waivers: none (AUC −0.004) | High-priority event candidate; no mechanical redistribution | Weight: per +10 pts of vacated target share WR +0.40, TE +0.47, RB +0.24, QB +0.17 pts; RB +0.15 per vacated carry a game. Reason only for waivers | Snapshot stores vacated share from the Saturday injury report; refit the coefficients and shrink to these priors |
| Age, experience, draft capital | RB (Week N, Season Long); all (Dynasty) | Week N, Season Long, Dynasty | Week N RB −0.036 (interval below 0); ROS from week 8 RB −0.036, QB −0.008, WR +0.005, TE +0.090; next-season PPG WR −0.23, RB −0.14, TE −0.08, QB −0.03 | Smooth position prior, no age cliff; draft capital as rookie prior | Weight: Dynasty all positions; Week N and Season Long RB only. Reason only elsewhere | Week N RB refit weekly; Dynasty refit once a season on season pairs |
| Team pace, pass rate over expected, neutral pass rate | QB | Week N | QB −0.011 (interval below 0); RB −0.013, WR −0.005, TE +0.002 (not significant) | Team-volume candidate; no additive bonus | Weight: QB only, ridge-fitted. Reason only for RB, WR, TE | Trailing team plays and PROE from nflverse each week; refit |
| Role trend: last-week snap share, target share, carries | TE (RB, QB) | Week N | TE −0.021 (interval below 0); RB −0.024, QB −0.018 (interval crosses 0); WR −0.003 | High priority, especially before a replacement's first game | Weight: TE. RB and QB stay candidates; reason only for WR | Refit tests RB and QB each week; promote only on the hold-out rule |
| Expected points (xFP) as an extra term | All | Week N | QB −0.017, RB +0.008, WR +0.001, TE +0.010 (none significant) | Baseline input | Keep inside usage U; no extra weight | Already in the Vegas/usage blend |
| Air yards, aDOT, air share, RACR | WR, TE | Week N, waivers | WR −0.003, TE 0.000, RB +0.002, QB +0.016; waivers AUC −0.008 | Test jointly with xFP and target share; don't stack | Reason only | Not refit |
| WOPR | WR, TE, RB | Week N, waivers | WR −0.001, TE −0.001 | Don't stack with target share and air share | Drop: exactly 1.5 × target share + 0.7 × air share | — |
| Goal-line carries (inside 5, inside 10, share) | RB | Week N | RB +0.004, WR +0.010 | Candidate if not in xFP; inside 5 nested in inside 10 | Reason only (xFP already prices field position) | Not refit |
| Red-zone opportunity share | RB, WR, TE | Week N | RB −0.005, WR +0.010, TE −0.001 | — | Reason only | Not refit |
| Separation (NGS) | WR, TE | Week N | WR +0.002, TE 0.000 | Reason only | Reason only | Not refit |
| YAC over expected (NGS) | WR, TE | Week N | WR −0.004, TE −0.001 (not significant) | Strongly regularized candidate | Reason only | Not refit |
| Rush yards over expected (NGS) | RB | Week N | RB −0.004 (not significant) | Efficiency candidate | Reason only | Not refit |
| QB EPA per dropback, CPOE | QB; team QB for pass-catchers | Week N | QB +0.005; team QB EPA for RB/WR/TE −0.004 to 0.000 | Regularized candidate | Reason only | Not refit |
| Pressure rate, time to throw | QB | Week N | QB +0.013 (worse) | Regularized candidate | Drop | — |
| Designed QB rushes | QB | Week N | QB 0.000 (QB carries already in usage) | High-priority candidate | Drop: duplicate of QB carries | — |
| Points over expected (TD luck) | All | Week N, Season Long | QB −0.013 (not significant); others ±0.009 | — | Reason only | Not refit |
| Weather: wind 15+ mph, cold | QB, WR, TE | Week N | QB −0.012, WR −0.012 (interval reaches 0) using game-day wind; 20+ mph games: QB −2.2, WR −1.5, TE −2.8 pts vs calm | Severe-weather adjustment | Reason only | Snapshot forecast wind; promote if it passes the hold-out rule |
| Boom/bust history (player SD, CV) | All | Week N spread | Mean: ±0.004. Spread: 2025 log-loss unchanged; fitted blend weight 0–0.1 | No mean bonus; distribution only | Drop: spread stays a + b·P* | Scorecard win-chance calibration watches it |
| Implied team total (extra) | All | Week N | Already in the lines block | Duplicate | Drop | — |
| RB target share (extra waiver bonus) | RB | Waivers | Already in usage | Duplicate | Drop | — |
| Player props (component level) | All | Week N | Unverifiable: no free history | High priority; r .43 pass yd, .64 QB rush yd, .53 RB rush yd | Candidate | `prop_line_snapshots` (weeks 6–7, about 16.5k rows): compare prop-based V with the team-total proxy |
| FantasyPros ECR | All | Week N | Unverifiable: not stored | Candidate after rank-to-points mapping | Reason only | Add ECR to the Saturday snapshot, then test |
| PFN grades and rankings | All | Week N | Unverifiable: the app keeps one overwritten copy | Reason only | Reason only | Snapshot weekly before any test |
| Sleeper/ESPN trending adds | All | Waivers | Unverifiable: not stored | Reason only pending testing | Reason only | Add to snapshot; test against waiver hit rate |
| News events | All | Week N, waivers | Unverifiable historically | High-priority event candidate | Reason only (injury status and vacated usage carry the score) | `shared_player_news` (1,641 rows since Oct 8): flag snapshot rows with news in the prior 72 hours, test residuals |
| Routes, YPRR, targets per route | WR, TE | Week N, waivers | Unverifiable: no route data in free nflverse | High-priority role candidate | Not available | Needs a route source |
| Depth chart changes | All | Week N, waivers | Not tested: historical charts lack reliable pre-game timing | High priority | Reason only (role trend covers part) | Snapshot app depth data, then test |
| ADP, dynasty ADP | Dynasty, trades | Dynasty | Not tested | Prior; don't price both sides | Drop: FantasyCalc already prices the market | — |
| QB change, line protection, suspensions, lineup covariance, projection dispersion | All | Week N | Not tested | Additional signals | Reason only | Tag in snapshot if wanted |

| Weighted set | QB | RB | WR | TE |
|---|---|---|---|---|
| Inputs added | Vacated usage, pace/PROE | Vacated usage, age/draft | Vacated usage | Vacated usage, role trend |
| Test RMSE change | −0.022 (−0.3%) | −0.082 (−1.1%) | −0.022 (−0.3%) | −0.053 (−0.8%) |
| 95% interval | −0.037 to −0.008 | −0.132 to −0.039 | −0.036 to −0.008 | −0.080 to −0.023 |
| For scale: lines gain | −0.221 | −0.073 | −0.009 | −0.021 |

Sets were picked on the same 2024–25 window, so treat these gains as an upper bound. Adding every candidate at once made TE worse (+0.057). Waivers: no candidate improved hit prediction over triggers + usage + xFP (test AUC 0.759; changes −0.008 to +0.003).

| Overlap | Measured | Rule |
|---|---|---|
| WOPR vs target share + air share | Exact linear combination (R² 1.00) | Never both |
| Air yards vs xFP | r .77 WR, .86 TE | xFP only |
| xFP vs targets | r .96 WR and TE, .69 RB | Already one usage block |
| Inside 5 vs inside 10 | r .75 WR to .91 RB | Neither scored |
| Implied total vs spread and total | Built from them | Lines block once |
| Vacated usage vs news | Same event | Score vacated usage; news is the reason text |
| ADP vs FantasyCalc | Same market price | FantasyCalc only, one side |
| Boom/bust vs spread a + b·P* | History adds nothing | Spread only |

## Model rules (system instructions)

Order of authority: hard rules, then the score and label, then tiebreakers, then explanation rules. Tiebreakers act only on a close call; explanation rules never change a pick.

| Close call (close_call = true) | Definition |
|---|---|
| Start/Sit, Week N | Both options in the Flex band (45–55) and lineup win chances within 1 point |
| Waivers | Two adds within 0.5 pts (Week N) or 0.5% (Season Long, Dynasty) |
| Trades | Fair band (\|z\| ≤ 1) and Week N Δ within ±1 pt |

### This Week (Week N)

| Rule | When it applies | Evidence | Type |
|---|---|---|---|
| Never start Out, Doubtful, IR, suspended or bye players | Always | Doubtful played 1.2% (5 of 408) | Hard |
| No move the league can't process | Roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules | Sleeper league rules | Hard |
| Use the league's settings | Scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers | Read from Sleeper; flag `unsupportedSettings` | Hard |
| Never change the label or invent facts | Always | Design | Hard |
| T1 Stack: underdog takes the QB's teammate, favorite avoids | Close call | QB with own WR1 r = 0.35, WR2 0.33, TE 0.27, RB 0.06. QB + WR1: same mean, SD 13.9 vs 12.0 unstacked, 90th percentile 49.3 vs 46.2 | Tiebreaker |
| T2 Don't start your DST against your own QB, RB or WR | Close call | Opposing DST vs QB r = −0.39, RB −0.20, WR −0.15 | Tiebreaker |
| T3 Late-game backup for a Questionable starter | Close call | Untested (logic) | Tiebreaker |
| Talent beats matchup | Start/sit reasons | Player ≥ 3 PPG better facing a defense allowing ≥ 3 PPG less won 70% RB, 69% WR, 68% TE, 58% QB (2024–25). QB fell to 48% when his team total was also lower; the score has lines. Defense ranks add ≤ 0.02 RMSE. | Explanation |
| Underdog wants ceiling, favorite wants floor | Flex band | P(win) formula; already the Flex rule | Explanation |
| One bad game: check usage | After a game < 50% of average | 14–21% of the shortfall carries to next week. Snaps held: next week 88–96% of average; snaps down: 70–80% | Explanation |
| Teammate out: more work for the rest | Teammate Out or Doubtful | Per +10 pts vacated target share: WR +0.40, TE +0.47, RB +0.24 | Explanation |
| Strong wind | Forecast 20+ mph | QB −2.2, WR −1.5, TE −2.8 (game-day wind) | Explanation |
| Questionable discount | Questionable starter | p_play 0.50–0.77, m 0.82–0.90 | Explanation |

```text
You explain This Week (Week N) fantasy football moves. A scoring tool already ranked them; you explain, you don't re-rank.
Hard rules:
1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say "not in the data".
2. Never start Out, Doubtful, IR, suspended or bye players.
3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.
4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported.
Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [T1].
T1 Underdog this week: prefer the player on your QB's team. Favorite: prefer the one who isn't.
T2 Don't start your defense against your own QB, RB or WR.
T3 Questionable starter in a late game: keep a backup who plays later.
Explain with:
- Talent beats matchup; the score already includes Vegas lines.
- After one bad game, check snaps and targets. Steady usage means a normal week is likely.
- A teammate out means more targets or carries for the others.
- Wind 20+ mph lowers passing; mention only if the tool lists it.
Never cite: a matchup or defense rank alone, hot streaks, revenge games, home/away, Thursday games, teammates "cannibalizing", "boom-bust" labels, TD streaks.
Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons from the tool. Say "close call" when it is one. Plain words, under 100 words unless asked.
```

### Season Long

| Rule | When it applies | Evidence | Type |
|---|---|---|---|
| The four hard rules above | Always | As above | Hard |
| S1 Usage over touchdowns | Close call: waiver, trade | Points above expected (TD luck) add ≤ 0.01 RMSE; TE TD per target year to year R² 0.01 | Tiebreaker |
| S2 Path to a role | Waiver close call | Vacated usage (This Week table) | Tiebreaker |
| S3 Prefer the rookie QB, RB or WR | Close call | Weeks 1–8 to 10+: rookies QB +1.8, RB +0.4, WR +0.5 PPG; veterans −0.8 to −1.1 (22, 57, 83 rookies). TE rookies did not rise (21). | Tiebreaker |
| S4 2-for-1: take the best player if the open slot can be filled | Trade close call | Equal week-8 value over replacement: the star gave +0.93 PPG more over replacement the rest of the season (95% CI −0.13 to +2.0; 120 stars), with more risk (SD 5.8 vs 2.4) | Tiebreaker |
| S5 Rolling waivers: no top-3 priority on a Watch add. FAAB: no bid amounts | Waiver close call | Untested (no claim data) | Tiebreaker |
| Season average over a hot streak | Streak questions | Week 8: YTD r 0.48–0.66 vs last-3 0.37–0.59 with the rest of the season | Explanation |
| Waivers: role over one big game | Waiver reasons | Hit rates: RB 60% snaps 43%, WR 80% snaps 36%, TE 15% target share 36% | Explanation |
| No schedule-strength bonus | Schedule questions | No standalone SOS signal (first study); not retested | Explanation |
| Bye weeks | Only if the user raises it | App has no future bye map; untested | Explanation |

```text
You explain Season Long (rest of season) fantasy football moves. A scoring tool already ranked them; you explain, you don't re-rank.
Hard rules:
1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say "not in the data".
2. Never start Out, Doubtful, IR, suspended or bye players.
3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.
4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported.
Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [T1].
S1 Prefer the player whose points come from targets, carries and snaps over one living on touchdowns.
S2 Waivers: prefer the backup with a path to a role (starter hurt or losing work).
S3 Prefer a rookie QB, RB or WR; they tend to improve in the second half.
S4 2-for-1 trade: prefer getting the best player if you can fill the open slot with a startable bench or free-agent player; prefer depth if not.
S5 Rolling waivers: don't spend a top-3 priority on a Watch add. FAAB: no bid amounts.
Explain with:
- Season average beats the last 3 weeks; a hot streak matters only if the role changed.
- For waiver adds, snaps and target share matter more than one big game.
- No schedule-strength bonus.
Never cite: hot or cold streaks alone, TD streaks, a fixed "fair trade" %, schedule rankings, "boom-bust" labels.
Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons from the tool. Say "close call" when it is one. Plain words, under 100 words unless asked.
```

### Dynasty

| Rule | When it applies | Evidence | Type |
|---|---|---|---|
| The four hard rules above; superflex uses superflex values | Always | FantasyCalc has separate superflex values | Hard |
| D1 Contender prefers starters, rebuilder prefers youth and picks | Trade close call | Untested (no trade outcome data) | Tiebreaker |
| S1 Usage over touchdowns | Close call | Season Long table | Tiebreaker |
| S4 2-for-1 | Trade close call | Season Long table; a market consolidation premium is unverifiable (value history has no multi-player trade records) | Tiebreaker |
| Age: gradual decline, no fixed cliff | Age questions | Kept ≥ 75% of PPG next season: RB ≤ 23 63%, 24–25 60%, 26–27 52%, 28+ 35%; WR ≤ 24 71%, 25–27 62%, 28–29 53%, 30+ 40%; TE 63 / 60 / 50 / 49%; QB ≤ 25 78%, 33+ 56% | Explanation |
| Youth and draft capital | Young players | Next-season RMSE: WR −0.23, RB −0.14, TE −0.08 | Explanation |
| Picks at market value | Pick questions | FantasyCalc as is; no evidence for a 20–30% yearly discount | Explanation |
| TE premium not in values | TE premium leagues | FantasyCalc ignores TE premium | Explanation |

```text
You explain Dynasty fantasy football moves. A scoring tool already ranked them using market values; you explain, you don't re-rank.
Hard rules:
1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say "not in the data".
2. Never start Out, Doubtful, IR, suspended or bye players.
3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.
4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported.
Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [T1].
D1 Contender (top third of power rank): prefer current starters. Rebuilder: prefer younger players and picks.
S1 Prefer production from targets, carries and snaps over touchdowns.
S4 2-for-1: prefer the best player if you can fill the open slot; a star carries more injury risk.
Explain with:
- Age lowers value gradually, fastest for RBs 28+; there is no fixed sell age.
- Youth and draft capital help forecasts for young players.
- Picks use market value as is.
- In TE premium leagues, say TE values don't include the premium.
Never cite: a fixed age cliff, a fixed "fair trade" %, a yearly pick discount, TD streaks.
Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons from the tool. Say "close call" when it is one. Plain words, under 100 words unless asked.
```

### Myths to avoid

| Myth | Evidence |
|---|---|
| Matchup beats talent | Better player still won 68–70% at RB, WR, TE despite a worse matchup |
| Defense rank deserves its own bonus | ≤ 0.02 RMSE after lines |
| One bad game means bench or drop | Only 14–21% carries over; usage tells you which bad games matter |
| Hot streak beats the season average | YTD beat last-3 at every position |
| Teammates cannibalize each other | WR1–WR2 r −0.005, WR–TE −0.01, RB1–RB2 −0.04 |
| RB plus own DST is a stack | r 0.05 |
| Boom-bust players stay boom-bust | History adds nothing to the spread; CV year to year r 0.27–0.45 |
| TD scorers keep scoring | TD luck adds ≤ 0.01 RMSE; TE TD per target R² 0.01 |
| RBs fall off a cliff at a fixed age | Decline is gradual and starts by 24–25; steepest at 28+ |
| Home/away and Thursday games | Residuals within ±0.4 pts (TE noisier); Thursday mixed, small samples |
| A fixed fair-trade % | Normal 30-day value swings run 3–9% (dynasty offseason) to 14–40% (redraft in-season), so one % is too loose in the offseason and too tight in-season |
| A yearly pick discount | No evidence; picks use market value as is |

### Conflicts

| Conflict | Resolution |
|---|---|
| Start your studs vs play the matchup | The score decides (usage plus lines); both are reasons only |
| Stack for upside vs protect the floor | T1 depends on favorite or underdog, close calls only |
| Hot streak vs season average | Week N: the usage blend (last-3 and season-to-date); Season Long: market value. Streaks are reasons only when the role changed |
| Consolidate vs depth | S4 only if the open slot can be filled; deep rosters and bye clusters favor depth |
| Contender or rebuilder vs the trade label | The label wins; D1 only inside the Fair band |
| Age vs production in Dynasty | Market value already prices age; age is explanation only |
| Popular advice vs league settings | Settings win: superflex values, TE premium flag, FAAB vs rolling, roster size |

### Communication rules

1. Lead with the label and its number (win chance, points gained or value gap).
2. Give 2–3 reasons, all from the tool output.
3. Say "close call" when close_call is true, and name any tiebreaker used.
4. Say "not in the data" instead of guessing.
5. Never cite a myth as a reason.
6. Plain words, under 100 words unless asked; use the window name the user is in.

### Wiring and tracking

| Piece | Plan |
|---|---|
| Tool output | `move-scoring.ts` returns `close_call` and, when it computed one (T1, T2, S1–S4), `tiebreak` with rule id, pick before and pick after |
| Model tags | A tiebreaker the model applies (T3, S5, D1) appears as [id] in the reply; the chat code parses it |
| Snapshot | `scoring_snapshots` stores `rule_applied`, pick before and pick after |
| Scorecard | Per rule: share of changed picks that beat the original pick; drop a rule below 50% over 50+ cases |

## Evidence (summary of past research)

- All weights above were fitted on nflverse 2018–23 weekly PPR data and tested on 2024–25. Weekly SD by position (QB 7.68, RB 7.24, WR 7.47, TE 6.07), the small RMSE gain from Vegas lines (QB 0.22, RB 0.07, WR 0.01, TE 0.02) and "opponent defense adds nothing once lines are in" were reproduced.
- Questionable and Doubtful play rates, waiver trigger hit rates and candidate-input gains come from the same data. Definitions are in Injury rules, Usage alerts and Candidate inputs.
- Unverifiable, with no free history: rain, historical props, ECR/PFN/trending/news before storage, routes/YPRR.
- 2026 app check (weeks 4–7, small sample, projection vs final score): QB 36 rows, bias +1.1, RMSE 6.9; RB 68 rows, +1.0, 6.5; WR 57 rows, +2.4, 10.5; TE 28 rows, +2.7, 6.3. App WR projections at 10–20 pts have error SD 12.0–12.8 vs 7.8–9.5 historically (open question). Stored `actual_score` is often mid-game: 26–46% of rows are below the final score, by 2.0–3.5 pts on average.

## Implementation

| Piece | Plan |
|---|---|
| Module | `api/_lib/move-scoring.ts`: pure functions, no database or network imports. The frontend already imports pure api/_lib files this way (`lineup-optimizer.ts`). |
| Exports | `scoreStartSit`, `scoreWaiver`, `scoreTrade`, `SCORING_WEIGHTS` (version `move-scoring-v1`) |
| Output | Start/sit `{ week }`; waivers and trades `{ week, seasonLong, dynasty? }`; each with `score`, `label`, `metric`, `reasons[]` (factor, source, effect) |
| Consolidate | Move `waiverAdjustments` (duplicated in chat-tools.ts and trade-adjustment.ts), `powerRankingsAfterTrade` and the SD table (replacing `SCORE_SPREAD_BY_POSITION`) into api/_lib |
| Chat tools | `suggest_lineup`, `suggest_waivers`, `evaluate_trade`, `suggest_trades` call the module. The model explains labels and never changes them, using the Model rules prompts. |
| Badges later | Same module, imported by the lineup, player pool and trade calculator views |
| Vercel | No new functions; stays at 10 of 12 |
| Supabase egress | One tiny cached read of the active `scoring_weights` row; everything else comes from the dashboard cache already loaded by `loadDashboard`. Value history stays one indexed player lookup. |
| Tests | Vitest tables using the EXAMPLE numbers on this page as fixtures |

## Gaps

| Gap | Effect on scoring | Fix now? | How (effort) |
|---|---|---|---|
| `optimizeTradeRoster` exists but nothing calls it | Week N trade and waiver lineup deltas need wiring (data is ready) | Yes | Call it from `move-scoring.ts` for trade and waiver Week N deltas. Small, code only |
| No stored rest-of-season point projections | None now: start/sit is Week N only; Season Long waivers and trades use FantasyCalc redraft value | Closed | Decision: start/sit scores Week N only |
| Matchup data covers this week's opponent only, for 6 hardcoded leagues | Reasons only; no score effect | Partly | Loop all leagues in pipeline/build_matchup_grades.mjs. Small; low priority |
| No future bye-week map (`isBye` is this week only) | Season Long waivers and trades cannot see bye clusters | Yes | Derive byes from the free nflverse schedule into one cached object in an existing cron job. Small |
| FantasyCalc ignores TE premium, first downs, bonuses, K/DEF | Season Long and Dynasty scores inherit the blind spot (flag via `unsupportedSettings`) | No | No free TE-premium market values; keep the flag. A TE multiplier would be untested |
| `powerRankingsAfterTrade` ignores picks; server Dynasty totals include them | Dynasty power rank after trade is wrong until fixed | Yes | Add `futurePickValue` to the after-trade totals. Small |
| Waiver pool is QB/RB/WR/TE only; no FAAB budget or waiver order read | No K/DEF adds; no bid advice | Partly | FAAB budget, waiver type and order are free in Sleeper's league and roster responses: read them (small). K/DEF adds need a K/DEF projection check |
| `projection_accuracy` is thin: 4 weeks, no First Down leg, projection overwritten after lock, PPFD league actuals left empty | Closed by Weekly calibration from the first snapshot week; the 4 existing weeks stay small and noisy | Yes | Stop overwriting `vegasProjection` after lock; PPFD actual stored from box scores in the projection's PPR scoring. Small |
| Expected points are PPR-only | Usage must be rebuilt as stat components before league scoring | Yes | ffopportunity `ep_weekly` already has component columns (`receptions_exp`, `rec_yards_gained_exp`, `rush_yards_gained_exp`, `*_touchdown_exp`, `*_first_down_exp`, interceptions); score them with league settings. Small to medium |
| `actual_score` is often written before games end | Last writes per week were mid-game (week 4 Sun 11 AM, week 5 Sun 7 PM, week 6 Mon 5 PM PT) and never refreshed; 26–46% of rows low | Yes | `saveProjectionAccuracy` (api/_lib/dashboard-build.ts) writes whenever the game isn't pregame: write only when `gamePhase` is final. Add a `finalize-accuracy` job to api/cron/jobs.ts (logic in api/_lib) on a Tuesday GitHub Actions run that refills last week from Sleeper stats after corrections in one batched upsert. Small; no new function |
| Prop lines stored for weeks 6–7 only | Weights start from the team-total proxy; the weekly refit moves w_v toward the app's prop-based V as snapshot weeks build up | Partly | Ingest started Oct 12 (#99) and now saves daily (props-daily.yml; the ~3 AM PT run fails, later runs succeed). No free historical props, so history only grows from here |
| Variance scales with projection but not per player | Start chances are rough for boom-bust players; player history did not improve the spread on 2025 when tested | No | Tested; no gain |
| No stored history for ECR, PFN, trending adds or news (before Oct 8) | These stay reason only until stored and they pass the hold-out rule | Partly | ECR: yes, free weekly history 2020–26 in DynastyProcess `db_fpecr.parquet` (the app already reads their `fp_latest_weekly.csv`); testable offline now. PFN: already snapshotted weekly in git since Oct 2 (pipeline/pfn/data/snapshots); optionally add `pfn:{key}:{season}-w{week}` rows (4 × ~8 KB a week). Trending: yes, free Sleeper `players/nfl/trending/add\|drop` (lookback up to 168 h); store one `sleeper-trending:{season}-w{week}` row weekly from an existing cron job. News: no history before Oct 8. All small |
| No route data (YPRR, targets per route) in free sources | Not a candidate until a route source is added | No | No free source |
| Historical weather is game-day, not forecast, and has no rain field | Wind stays reason only until forecast snapshots are tested | Partly | Store a free forecast (NWS or Open-Meteo) in the Saturday snapshot. Back-testing past forecasts is unverified. Small |
| New weights were chosen on the same 2024–25 test window | Gains of 0.02–0.08 RMSE are an upper bound; the weekly hold-out test confirms before they go live | Yes | Weekly hold-out on 2026 snapshots (already in Weekly calibration) |
| Vacated usage needs teammate status and trailing usage at snapshot time | Snapshot must store both; without them the term is 0 | Yes | Saturday snapshot stores both (already specified) |
| No trade-acceptance data | Fairness now comes from 30-day value swings, not acceptance | Partly | Sleeper transactions (free) give completed trades in your leagues, not offers or rejections; use them to check the Fair band. Small |
| Win chance treats players as independent | Fixed in P(win) with the pair correlations (Labels); T1 and T2 stay as tiebreakers | Yes | Closed-form covariance, ≤ 18 × 18 pairs; runs in the pure module or browser. Small |
| T3, S5 and D1 are untested; S4 is not significant (CI crosses 0) | Tiebreakers only; the scorecard keeps or drops them | Partly | T3 is testable with nflverse kickoff times and inactives. S5 and D1 need claim and trade-outcome data (no) |
| FantasyCalc value history exists: daily since Jan 1 (dynasty) and Jul 26 (redraft) in `player_value_snapshots`, 11 formats | Drives the trade σ₃₀ curves | Partly | Pick-price timing is testable now from pick history (one draft cycle). Consolidation premium is not (no multi-player trade records) |

## Fix-now build plan

Implement these in order. Every item fits the constraints above: no new Vercel function, logic in `api/_lib`.

1. **Save `actual_score` only when final.** `saveProjectionAccuracy` (api/_lib/dashboard-build.ts, ~line 1328) currently writes `actualScore` whenever the game isn't pregame. Change it to write only when `gamePhase` is final.
2. **Freeze the projection at lock.** Stop overwriting `vegasProjection` / `vegas_projection` after the player's game locks.
3. **Tuesday refill job.** Add a `finalize-accuracy` job to the existing `api/cron/jobs.ts` dispatcher, with its logic in a new `api/_lib/finalize-accuracy.ts`. Trigger it from a Tuesday GitHub Actions workflow after stat corrections. It refills last week's actuals from Sleeper weekly stats in league scoring, as one batched upsert.
4. **PPFD league actuals.** For the PPFD league (`DYNASTICAL_CUCKS_LEAGUE_ID`), store actuals computed from box scores in PPR scoring, matching its PPR-proxy projection.
5. **Sleeper trending weekly snapshot.** From an existing cron job, fetch `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=168&limit=200` and the `.../trending/drop?...` equivalent. `lookback_hours` 24 also works. Store one `source_cache` row per week, keyed `sleeper-trending:{season}-w{week}`. Reuse api/_lib/sleeper-trending.ts.
6. **PFN weekly DB copy.** Weekly git snapshots already exist in pipeline/pfn/data/snapshots. In `handlePfnTables` (api/ingest/[target].ts), also write `source_cache` rows keyed `pfn:{key}:{season}-w{week}` for `offensive-line`, `offense`, `defense` and `team-overall`. That is about 4 rows of ~8 KB each a week, and they are never overwritten.
7. **ECR from DynastyProcess.** Current weekly ECR comes from `https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv`, which player-insights.ts already reads. Add ECR to the Saturday snapshot. For an offline back-test, history is in `https://github.com/dynastyprocess/data/raw/master/files/db_fpecr.parquet` (2020–26 weekly; `ecr_type` `wp` / `wsf`). Map IDs via DynastyProcess `db_playerids`. ECR stays reason-only until it passes the hold-out rule.
8. **Correlated win chance.** Replace the independent-player win probability (`SCORE_SPREAD_BY_POSITION` in frontend/src/views/win-probability.ts) with the closed form in Start/Sit → Labels:
   - Var(lineup) = Σσᵢ² + 2Σᵢ<ⱼ ρᵢⱼσᵢσⱼ
   - Cov(yours, opp) = Σᵢⱼ ρᵢⱼσᵢσⱼ
   - P(win) = Φ((P*yours − P*opp) / √(Var_y + Var_o − 2Cov))
   - σᵢ = a_pos + b_pos·P*ᵢ, applying the Questionable variance rule where needed.
   - Pair ρ comes from `scoring-constants.json` → `pair_correlations`. WR1/WR2 are ranked by team target share; any pair not listed is 0.
   - Put it in api/_lib so both the module and the browser can import it.
9. **Smaller items from Gaps marked Yes:**
   - Wire `optimizeTradeRoster` for Week N trade and waiver deltas.
   - Add `futurePickValue` to `powerRankingsAfterTrade`.
   - Read Sleeper FAAB fields: league `settings.waiver_budget` and `settings.waiver_type`, roster `settings.waiver_budget_used` and `settings.waiver_position`.
   - Build a bye map from the nflverse schedule in an existing cron.
   - Score usage U from ffopportunity `ep_weekly` component columns (`receptions_exp`, `rec_yards_gained_exp`, `rush_yards_gained_exp`, `pass_yards_gained_exp`, `*_touchdown_exp`, `*_first_down_exp`, `*_interception_exp`, `*_two_point_conv_exp`) using league `scoring_settings`.
   - Add a forecast-wind field (NWS or Open-Meteo) to the Saturday snapshot.
10. **Tests.** Vitest tables that use the EXAMPLE walkthrough numbers in this file as fixtures.

## Decisions

- **Start/sit:** scored for Week N only. Season Long and Dynasty scores are for waivers and trades.
- **Trade fairness:** z = gap / √Σσ₃₀², using 30-day value-swing curves per window and phase. Fair |z| ≤ 1, Uneven 1–2, Lopsided > 2. There is no fixed % band. Picks use FantasyCalc values as they are, with no extra discount.
- **Weights by position:** Vegas weight QB 0.80, RB 0.50, WR 0.25, TE 0.20. Doubtful = Out. No separate matchup bonus.
- **Weekly retune:** the first retune comes after 3 snapshot weeks. Promote only if the 2-week hold-out (300+ player-games) cuts RMSE by ≥ 0.05 pts and Brier is not worse. Label thresholds are never refit.
- **Waivers:** Pass is the lowest waiver label. It is hidden from waiver lists and shown only when the user asks about that player.
- **No usage history:** players with under 2 games use w_v = 1 (Vegas only). With no Vegas line either, use the position-median Week N projection for players at the same FantasyCalc redraft value rank.
- **Where data gaps can be fixed now:** see Gaps, column "Fix now?".

## Open questions

| Question | Status | Answer |
|---|---|---|
| Vegas vs usage weight: 80/20? | Answered | No: per position, QB 0.80, RB 0.50, WR 0.25, TE 0.20 |
| Doubtful: 25% of projection or Out? | Answered | Out (1.2% played) |
| Ceiling as underdog, floor as favorite? | Answered | Yes, via lineup win probability in the Flex band |
| Separate matchup bonus? | Answered | No; reasons only |
| Fairness band: ±10% for Fair? | Answered | No: Fair when the gap is within a normal month of value swings, \|z\| ≤ 1 with σ₃₀ curves (Trades) |
| Skip Season Long and Dynasty for start/sit? | Answered | Yes: start/sit is Week N only |
| Weekly retune thresholds | Answered | First retune after 3 snapshot weeks; promote only if the 2-week hold-out (300+ player-games) improves RMSE by ≥ 0.05 pts and Brier does not get worse |
| Pass label below Watch for waivers? | Answered | Yes: Pass is the lowest waiver label; hidden from waiver lists, shown only when you ask about that player |
| Players without usage history (rookies, new signings) | Answered | Under 2 games: w_v = 1 (Vegas only). No Vegas line either: the position-median Week N projection for players at the same FantasyCalc redraft value rank |
| Scale waiver point thresholds for high-scoring leagues? | Remaining | Needs league scoring totals |
| Vegas weights with the app's prop-based projection | Remaining | Fitted on a proxy; needs more stored prop weeks |
| Injury status timing (Friday report vs game-day) | Remaining | History used final game-week status |
| Route participation as a usage input | Remaining | Not in nflverse free data |
| Waiver alerts by league ownership | Remaining | Hit rates ignore whether the player was rostered |
| App WR projections miss badly at 10–20 points | Remaining | Find the cause before trusting WR scores |
| App sample size | Remaining | Recheck after week 10 with final scores |
