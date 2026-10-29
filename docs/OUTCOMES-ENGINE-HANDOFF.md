# Handoff: League Outcomes projection engine (`projection-v1`)

For Devin. Read `HANDOFF.md` ground rules first; they apply here.

Base branch: `claude/chat-league-tools` (unmerged; head `b6871a4` when this was written). Branch from it, name yours `devin/outcomes-engine-projection-v1`, and open the PR against `claude/chat-league-tools`, not `main`, until that branch merges.

## 1. What and why

The League tab has an **Outcomes** view (Playoffs / Last place) that shows each team's simulated odds now vs. the comparison point, and the chat tool `get_playoff_odds` uses the same numbers. Today they come from `pace-v1`: each team is assumed to keep scoring at its points-per-game so far. That ignores current rosters, injuries, byes and the actual schedule.

Build **`projection-v1`**, a schedule-aware engine:

- For every remaining regular-season week, project each team's lineup from its **current roster** using **Sleeper's per-week player projections** (future weeks exist), scored in **this league's scoring rules**.
- Win each remaining game by comparing the two teams' projected scores for that specific week, with position-based variance.
- Persist weekly odds **snapshots** so the "previous" comparison reflects roster moves and changed inputs, not just results.

Owner's reference graphics (The Ladz, Week 7) say: "Weeks 1–7 fixed • Current rosters and projections • Automatic injury timelines • Position-based scoring variance". That is the target behavior. The published percentages are a **sanity benchmark only, not targets**.

## 2. Division of work

| Owner | Scope |
|---|---|
| Claude (already done on the base branch) | Contract (`api/_lib/league-outcomes-contract.ts`), engine registry, `pace-v1`, API handler, Outcomes tab UI, chat tool + prompt wiring |
| **You** | `projection-v1` engine, projection loader/cache, snapshot table + persistence, tests, rollout notes |

**Do not edit** (propose changes in a PR comment instead; Claude will make them): `frontend/**`, `api/_lib/chat-*.ts`, `api/_lib/league-outcomes-contract.ts`, `api/_lib/league-outcomes.ts`. The one allowed edit outside your new files is registering the engine in `api/_lib/outcomes-engines.ts`.

You may extend `api/_lib/playoff-odds.ts` (shared with `pace-v1`) as long as existing tests keep passing and its current call signature keeps working.

## 3. The contract (do not change; satisfy)

`api/_lib/league-outcomes-contract.ts` defines everything. Read it fully. Key points:

- Implement `OutcomesEngine`: `run({ league, season, week, fetchWeek?, now? }) → LeagueOutcomes | { error }`. `league` is a dashboard league (`dashboard-schemas.ts`): `standings`, `playoffs`, `tradeTeams[]` (every roster with players, injury status and projections), `tradeStarterSlots`, `scoringSettings`, `rankingPositions`.
- Output is validated with `leagueOutcomesSchema` by the handler; invalid output returns an error to the user.
- `method.engine` must be `"projection-v1"`. `method.label` goes in the UI footnote (lowercased), so keep it short, e.g. `"Current rosters and projections"`. Put caveats in `method.notes` (the chat model reads them).
- `previousSource`: `"snapshot"` when comparing with a stored snapshot (set `previousAsOf` to its ISO time); `"rewound"` when no snapshot exists and you rebuilt the comparison by undoing the last finished week's results (see `rewindWeek` in `outcomes-engine-pace.ts`); `null` in week 1 / no comparison.
- `weeklyStrength` per team = the average of that team's projected weekly score over the remaining weeks (what the engine assumed).
- `userSchedule` = the user's remaining games with `winProbability` (0–100) and `projectedFor`/`projectedAgainst` for that week.
- Percent precision: `playoffPct`, `topSeedPct`, `winProbability`, `probability` to 0.1; `lastPct` to 0.01.
- Invariants a test must assert: Σ`playoffPct` ≈ 100 × `playoffTeams`; Σ`lastPct` ≈ 100; `teams` sorted by `playoffPct` desc; `userSchedule` weeks all > `throughWeek` and ≤ `regularSeasonEndsWeek`; deterministic for a fixed seed.

## 4. Data sources (verified 2026-10-29 unless noted)

### 4.1 Sleeper per-week projections
`GET https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&order_by=pts_ppr` (base is `SLEEPER_PROJECTIONS_BASE` in `sleeper.ts`; the dashboard build already calls it for the current week, `dashboard-build.ts` ~line 1532).

Verified: weeks 8, 12 and 14 of 2026 all return data and the numbers differ by week, so they are matchup-aware. Each row:

```
player_id, week, season, team, opponent, date, game_id, company: "rotowire",
stats: { gp, pts_ppr, pts_half_ppr, pts_std, rec, rec_yd, rec_td, rush_att, rush_yd, rush_td,
         pass_yd, pass_td, pass_int, fum_lost, bonus_rec_rb, ... },
player: { position, team, injury_status, injury_notes, ... }
```

Facts and risks:
- Raw response is about **5.8 MB per week** (about 9,400 rows, about 1,150 with non-zero `pts_ppr`). Never ship that to the client and never store it raw. Store a **compact per-week map** (player id → opponent, date, `gp`, and only the stat keys needed to score the league) in `source_cache` (see `encodeSourceCachePayload` / `decodeSourceCachePayload`), keyed e.g. `sleeper-projections-week-v1:{season}:{week}`, TTL about 12 h, deduplicate concurrent fetches, serve stale on fetch failure (as `loadSleeperPlayerWeeklySeason` does).
- **Unverified: how bye weeks appear** (`gp` 0? row missing? `pts_ppr` 0?). Spike this first (§6, Task 0). Also verify whether K and DEF are present; the lineup optimizer supports `QB/RB/WR/TE/K/DEF`.
- Sleeper-side fetches do not count against Supabase egress, but cache writes and reads do. Keep the stored maps small (tens of KB per week).
- No paid APIs (`HANDOFF.md`).

### 4.2 Scoring a projected stat line in this league's rules
`scoreProjectedPlayerStats(position, stats, scoringSettings)` in `api/_lib/sleeper.ts` is what the dashboard uses for this week's `leagueProjection`. Reuse it; do not reimplement scoring. `league.scoringSettings` may be undefined on old cached dashboards: fall back to `pts_ppr` / `pts_half_ppr` / `pts_std` by `league.rankingField` and add a `method.notes` line saying so.

### 4.3 Rosters, slots, injuries
- All rosters: `league.tradeTeams[]` (`players[]` with `injuryStatus`, `position`, `team`, `projection`), user flagged `isUser`. Starter slots: `league.tradeStarterSlots` (e.g. `QB, RB, RB, WR, WR, TE, FLEX, SUPER_FLEX`).
- Best lineup from a roster: `optimizeTradeRoster(players, slots, now)` in `lineup-optimizer.ts`. **It pins players whose games are locked/live at `now`** and counts their actual points; for future weeks, pass `now` so nothing is locked (for example `0`), or call the lower-level assignment directly. Check this before trusting the numbers.
- Availability today: `isUnavailableForCurrentWeek(status)` in `sleeper.ts`. This is current-week only. There is no injury timeline data in the app; see §5.3 for the rule to use.

### 4.4 Schedule and results
- Head-to-head pairings and points per week: `loadScheduleGames` + `rewindWeek` in `outcomes-engine-pace.ts` (Sleeper `/league/{id}/matchups/{week}`). Reuse; do not duplicate.
- Standings, record, points for: `league.standings`; playoff teams and start week: `league.playoffs` (`positionKnown === false` means divisions; division winners are not modeled, so say so in notes, as `pace-v1` does).
- Regular season ends at `playoffs.weekStart − 1` (14 if unknown; `DEFAULT_LAST_REGULAR_WEEK`).

## 5. Spec

### 5.1 Pipeline
1. `throughWeek` = max games played across `standings`. Remaining weeks = `throughWeek+1 … regularSeasonEndsWeek`. If none remain, return deterministic odds (no simulation needed) with notes.
2. Load schedule games (`loadScheduleGames`) and projections for each remaining week (compact cache). Failed weeks go in `missingWeeks`; for those weeks degrade to the team's `pace` strength (so `pace-v1` logic as fallback) and say so in `method.notes`. Do not fail the whole request for one bad week.
3. For each team and remaining week: score each rostered player's projection in league rules, apply availability multipliers (5.3), drop bye-week players, then compute the best lineup for `tradeStarterSlots`. Empty or unprojected slots use a per-position replacement level (document it) or zero.
4. Team-week distribution: mean = lineup total; SD = √(Σ per-slot variance) using the position SDs in 5.4.
5. Game win probability = Φ((μa − μb) / √(σa² + σb²)). Ties are rare; ignore beyond a 0.5/0.5 split.
6. Simulate N trials (default `OUTCOME_TRIALS` = 20,000, seeded for determinism). Same seeding rule as `pace-v1`: wins, then points for (use points so far + expected remaining points as the proxy). Track playoff made, #1 seed, last place, user win-total scenarios. Extend `simulatePlayoffOdds` to accept per-game probabilities (for example optional `pA` on each `OddsGame` plus per-team-week expected points) rather than writing a second simulator; keep the existing call working.
7. Comparison point: look up a stored snapshot (5.5). If none, build the `rewound` comparison (undo last finished week, re-simulate with today's projections). If neither is possible, `previousSource: null`.
8. Return a `LeagueOutcomes` and let the handler validate it.

### 5.2 Calibration (decide with evidence)
Sleeper projections run systematically high or low for some teams (e.g. a team that always starts the same QB). Spike whether Sleeper serves projections for **past** weeks (1 to `throughWeek`). If yes, backcast each team's projected total for played weeks and compare with actual points: compute a league-wide bias factor and, if justified, a shrunk per-team factor. If past-week projections are not available, blend each team's projected mean with its actual pace using a weight that grows with games played, and document the weights. Whichever you choose, record the evidence in the PR description and the choice in `method.notes`.

### 5.3 Injuries (starting defaults, keep in one exported constants object so they can be tuned)
The app has current status only. Starting rule:
- Out / IR / PUP / suspended (`isUnavailableForCurrentWeek`): 0 for the current and next 2 weeks, then 50% of projection (return uncertainty).
- Doubtful: 25% of projection in the current week; 100% thereafter.
- Questionable: 90% in the current week; 100% thereafter.
- Bye: 0 for that week (once verified, see 4.1).
These are placeholders; adjust if the data shows something better and say what you changed.

### 5.4 Variance (placeholders, calibrate if you can)
Starting per-slot weekly SDs: QB 7.5, RB 6.5, WR 7.0, TE 5.0, K 3.5, DEF 4.5. These are guesses, not measured values. The repo has weekly stat history (`loadSleeperPlayerWeeklySeason`, nflverse stats in `dashboard-build.ts`, the Boom/Bust code) to estimate SD by position in this league's scoring; if you calibrate, state the method and the numbers in the PR. `pace-v1` uses a flat team SD of 22 (`WEEKLY_SCORE_SD`); your team-level SDs should land in a similar range as a sanity check.

### 5.5 Snapshots
New table `league_outcome_snapshots`:

| column | type |
|---|---|
| `league_id` | text, PK part |
| `through_week` | int, PK part (completed weeks when computed) |
| `engine` | text, PK part |
| `computed_at` | timestamptz default now() |
| `payload` | jsonb: `{ teams: [{ rosterId, playoffPct, lastPct }] }` |

Follow the repo's conventions: add the next free migration number (`0016_league_outcome_snapshots.sql` when this was written; `0015` is taken on `main`, so check again before you push), the `_journal.json` entry, and the table in `api/_lib/schema.ts` (see `buildLeases` and `0011` for style). **Enable RLS with no policies** (service-role only), matching `0011`/`0013`; run `drizzle-pg/verify_rls.sh`. Production migrations are applied by hand (`MIGRATION-STATUS.md`), so list the exact SQL in the PR for the owner to apply; the code must **degrade gracefully (treat as "no snapshot") if the table does not exist yet**.

Semantics:
- A snapshot is written the first time `projection-v1` runs for a (league, `throughWeek`) pair, upsert-if-absent (never overwrite), so it captures "odds as of the first look after week N finished".
- "Previous" = the snapshot with the largest `through_week` < the current `throughWeek`. `previousWeek` = that snapshot's `through_week`; `previousAsOf` = its `computed_at`.
- Lazy write on request is required. A cron job is optional: if you add one, register a new job name in `api/cron/jobs.ts` (no new files under `api/`) and a workflow in `.github/workflows/` modeled on `fantasycalc-refresh.yml`; leagues come from `sleeper_connections` plus `readUserLeagues`.
- Writes must never fail the request (try/catch; log and continue).

## 6. Tasks (in order)

0. **Spike (30 min, write findings in the PR):** bye-week encoding in projections; K/DEF coverage; past-week projections availability; `optimizeTradeRoster` behavior with a future `now`; payload size after compaction.
1. Projection loader + compact cache (+ stale-on-error, in-flight dedupe).
2. League-scoring conversion + availability multipliers + replacement level.
3. Team-week projection (lineup optimization) for all rosters and remaining weeks.
4. Win probabilities, variance, and the generalized simulator; keep `pace-v1` tests green.
5. Calibration (5.2) with evidence.
6. Snapshot table, migration, journal, `schema.ts`, read/write helpers, graceful degradation.
7. `projection-v1` engine implementing the contract; register in `outcomes-engines.ts` (do **not** change `DEFAULT_OUTCOMES_ENGINE`).
8. Tests (below), PR description with spike findings, calibration evidence, sample output on at least one real league, and the migration SQL.

## 7. Tests (no network; inject fetchers)

- Loader: compaction, cache hit/miss/stale-on-error, bye handling, failed week → `missingWeeks`.
- Scoring: league rules (PPR, half, TE premium) change a player's score; missing `scoringSettings` fallback.
- Lineup: flex/superflex slots, injured player excluded, bye excluded, empty slot replacement.
- Engine: contract validation (`leagueOutcomesSchema`), all invariants in §3, determinism, a tiny hand-checkable league (4 teams, 2 weeks) with known probabilities, a team with a star injured now vs. later changes odds in the expected direction, no remaining games, week-1 (no comparison), divisions note.
- Snapshots: written once per (league, week), never overwritten, previous lookup picks the right row, table-missing degrades to `rewound`.
- Regression: existing `playoff-odds`, `league-outcomes`, chat-tool tests still pass unmodified.

Run before pushing: `npm run typecheck`, `npx eslint api frontend/src`, `npx vitest run`. CI, CodeQL and CodeRabbit must pass; mark the PR ready for review (CodeRabbit skips drafts).

## 8. Constraints checklist

- No new files under `api/` outside `api/_lib` (Vercel functions are at 12/12). The engine runs inside the existing `api/data/[kind].ts` function, which has `maxDuration: 60`; target under 10 s end to end on a cold cache and under 3 s warm.
- Keep Supabase egress low (free tier). Compact caches only; no per-request large reads.
- No paid data sources.
- No UI text or styling changes (Claude owns the front end).
- Behavior and data changes need the owner's approval before merge. Do not flip the default engine; the rollout is:
  1. Merge with `projection-v1` registered but not default.
  2. In a Vercel preview set `OUTCOMES_ENGINE=projection-v1` and compare with `pace-v1` on the owner's league(s).
  3. Owner approves, then Claude changes `DEFAULT_OUTCOMES_ENGINE`.

## 9. Open questions to report back (do not guess silently)

- Bye-week encoding and K/DEF coverage in Sleeper projections.
- Whether past-week projections exist (decides calibration approach).
- Whether `optimizeTradeRoster` can be used for future weeks as is.
- Final injury and variance constants, and the evidence for them.
- Whether the cron is worth adding or lazy snapshots are enough.
