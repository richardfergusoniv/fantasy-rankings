# Dashboard Cache Runbook

Post–Runtime-Cache-overhaul state. Runtime Cache is byte-metered
(1 unit / 8 KB, 200K write units on Hobby); personalized dashboard data
exhausted it, so it no longer lives there.

## Architecture

```
client ──► GET /api/dashboard[ /section]
              │
              ├─ L1 (instance memory, byte-capped LRU, key v1:<user>:<view>)
              │     hit → serve
              │
              ├─ Postgres source_cache  (canonical snapshot rows)
              │     dashboard:user:<sleeperId>[:<section>]   ← per-user, private
              │     dashboard                                ← owner global snapshot
              │     hit+fresh → serve (+L1 fill)
              │     miss/stale → kickUserDashboardBuild (build_leases, fenced)
              │
              └─ build under build_leases (fail-closed, leaseIsHeld fence
                 before writeUserDashboardCache; no unleased builds)
```

- Freshness: `freshUntil = min(builtAt + modeTTL, next live transition)`;
  600 s normal, 150 s while a game is live. Cache fills never extend the deadline.
- Personalized responses are always `Cache-Control: private, no-store`.
- Per-user snapshot rows are slim section rows; freshness checks read the
  meta row's envelope only (`readUserDashboardFreshness`) — no payload reads.

## Shared boards (the only Runtime Cache contents)

- Registry: `SHARED_BOARD_DATASETS` in `api/_lib/shared-board-cache.ts`
  (allowlisted `id`, `ttlSeconds`, `maxEncodedBytes`, schema validator).
  Currently: `sleeper-picks`.
- Publish path: `POST /api/ingest/sleeper-picks` → durable `source_cache`
  upsert → `publishSharedBoard` (CRON_SECRET auth, serialized per key,
  monotonic in `sourceAgeMs`, skipped on `VERCEL_ENV=preview`).
- Read path: L1 → Runtime Cache → one `source_cache` row (counted as
  `shared_board.fallback_read`). Runtime failures are nonfatal everywhere.
- To add a board: register the dataset, publish from its ingest handler
  after the durable write, read via `readSharedBoard`. Never register
  anything derived from per-user dashboard data.

## Env flags

- `DASHBOARD_L1_BYPASS=1` — disable the L1 view cache (all reads hit Postgres).
- `DASHBOARD_L1_MAX_BYTES` — L1 cap (default 8 MiB per isolate).

## Metrics and alerting

`flushCacheMetrics()` emits one `[cache-metrics]` JSON line per flush
(route end + 60 s interval) with `instanceId`, counters, and byte samples
(units = ceil(bytes/8000), internal estimate).

Watch:

- `dashboard.runtime.*` — **must stay zero.** Personalized Runtime Cache was
  removed; any nonzero counter emits
  `[cache-alert] personalized-runtime-traffic` — alert on that line.
- `dashboard.l1.hit/miss/write/evicted/bypassed`, `dashboard.singleflight.joined`
- `dashboard.snapshot.payload_read` / `metadata_read` — Postgres egress proxy
- `dashboard.build.start/done/failed`, `build_lease.*` (incl. `lost_before_publish`)
- `shared_board.cache.*`, `shared_board.fallback_read`,
  `shared_board.publish` / `publish_rejected`

## Legacy Runtime Cache entries

Old personalized entries were all written with finite TTLs (≤600 s), so they
self-expire; consumed write units are not restored by deletion. A deliberate
purge is only warranted for privacy/storage hygiene — never request-time
cleanup. If needed, run it once from a script against the `getCache()`
namespace, not from a route.

## Verification checklist

- `npx vitest run` — 995+ tests incl. lease concurrency, L1, shared-board.
- `npm run typecheck` (frontend + api), `npm run lint`.
- Deploy checks: function count ≤ 12 (10 current); `[cache-metrics]` lines
  in Vercel logs; `dashboard.runtime.*` stays zero across a normal period,
  a cold start, and a live-game window; Supabase `source_cache` read/write
  totals vs `dashboard.snapshot.*` counters.
