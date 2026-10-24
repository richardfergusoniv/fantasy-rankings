#!/usr/bin/env bash
# verify_rls.sh — prove that the checked-in migrations leave browser-facing
# Supabase roles (anon, authenticated) unable to touch server-only tables and
# unable to cross user boundaries on user-owned tables.
#
# Usage:
#   ./drizzle-pg/verify_rls.sh                 # spins up a disposable postgres container
#   DATABASE_URL=postgres://... ./drizzle-pg/verify_rls.sh   # existing disposable DB
#
# Requires node with `npm ci` done (migrations are applied with the standard
# `drizzle-kit migrate`, so a file missing from drizzle-pg/meta/_journal.json
# fails here exactly as it would in a real deploy), plus docker (for the
# disposable DB and/or a psql client) or a local psql when DATABASE_URL is set. Point it ONLY at a throwaway database:
# the script creates an `auth` schema and `anon`/`authenticated` roles to
# mimic Supabase, and wipes nothing — but it is not meant for production.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${POSTGRES_IMAGE:-postgres:16}"
DB_CONTAINER=""

psql_run() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  else
    docker run --rm -i --network host "$IMAGE" \
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  DB_CONTAINER="rls-verify-$$"
  PORT="${RLS_VERIFY_PORT:-55432}"
  echo "== starting disposable Postgres ($IMAGE) on 127.0.0.1:$PORT"
  docker run -d --name "$DB_CONTAINER" \
    -e POSTGRES_PASSWORD=postgres \
    -p "127.0.0.1:$PORT:5432" \
    "$IMAGE" >/dev/null
  trap 'docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true' EXIT
  DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$PORT/postgres"
  for _ in $(seq 1 30); do
    if docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

export DATABASE_URL

echo "== setting up Supabase-equivalent scaffolding (auth schema, API roles, default grants)"
psql_run <<'SQL'
-- Mimic the pieces of a Supabase project that the migrations rely on:
-- auth.users, auth.uid(), and the anon/authenticated API roles.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

-- Supabase's auth.uid() reads the sub claim from request.jwt.claims.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Supabase grants full table privileges to API roles by default; mimic that
-- so the migrations' REVOKEs are what actually restricts access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
SQL

echo "== applying migrations (npx drizzle-kit migrate)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
(cd "$REPO_DIR" && npx drizzle-kit migrate --config=drizzle.config.ts)

# Every checked-in migration must be journaled and applied; otherwise the
# assertions below would be checking a schema no deploy produces.
sql_files=$(find "$SCRIPT_DIR" -maxdepth 1 -name '0*.sql' | wc -l | tr -d ' ')
applied=$(psql_run -Atc 'SELECT count(*) FROM drizzle.__drizzle_migrations')
if [[ "$sql_files" != "$applied" ]]; then
  echo "RLS CHECK FAILED: $sql_files migration files but $applied applied (missing journal entry?)" >&2
  exit 1
fi
echo "ok: all $applied migrations applied by drizzle-kit migrate"

echo "== running RLS/grant assertions"
psql_run <<'SQL'
-- Every public table must have RLS enabled.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: tables without RLS: %', missing;
  END IF;
  RAISE NOTICE 'ok: RLS enabled on every public table';
END $$;

-- Two users for cross-tenant checks.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com');

-- Server-only tables: authenticated can neither read nor write.
SET ROLE authenticated;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'source_cache', 'historical_trades', 'vegas_projection_snapshots',
    'vegas_projection_upload_chunks', 'player_value_snapshots',
    'projection_accuracy', 'player_news_runs', 'player_news_items',
    'shared_player_news', 'prop_line_snapshots',
    'scoring_weights', 'scoring_snapshots',
    'build_leases', 'rate_limit_buckets'
  ] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I', t);
      RAISE EXCEPTION 'RLS CHECK FAILED: authenticated can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'ok: authenticated cannot read %', t;
    END;
    BEGIN
      EXECUTE format('TRUNCATE public.%I', t);
      RAISE EXCEPTION 'RLS CHECK FAILED: authenticated can write %', t;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'ok: authenticated cannot write %', t;
    END;
  END LOOP;
END $$;

-- sleeper_connections is read-only for clients: writes go through the API (0012).
DO $$
DECLARE
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    $q$INSERT INTO public.sleeper_connections (user_id, sleeper_user_id, sleeper_username) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', 'x')$q$,
    $q$UPDATE public.sleeper_connections SET sleeper_user_id = 'x'$q$,
    $q$DELETE FROM public.sleeper_connections$q$
  ] LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'RLS CHECK FAILED: authenticated can run: %', stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'ok: authenticated cannot % sleeper_connections', split_part(stmt, ' ', 1);
    END;
  END LOOP;
END $$;
RESET ROLE;

-- anon gets nothing at all, including on user-owned tables.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.saved_chart_views';
    RAISE EXCEPTION 'RLS CHECK FAILED: anon can read saved_chart_views';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon cannot read saved_chart_views';
  END;
  BEGIN
    EXECUTE 'SELECT 1 FROM public.sleeper_connections';
    RAISE EXCEPTION 'RLS CHECK FAILED: anon can read sleeper_connections';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon cannot read sleeper_connections';
  END;
END $$;
RESET ROLE;

-- Seed one chart view per user as the table owner.
INSERT INTO public.saved_chart_views
  (id, user_id, name, dataset, position, x_metric, y_metric, "window", plot_limit, created_at, updated_at)
VALUES
  ('view-a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A view', 'advanced', 'QB', 'x', 'y', 'season', '24', now(), now()),
  ('view-b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B view', 'advanced', 'QB', 'x', 'y', 'season', '24', now(), now());

-- As authenticated user A: sees only own rows; cannot read, write, update,
-- or delete user B's rows.
SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

DO $$
DECLARE
  n int;
BEGIN
  EXECUTE 'SELECT count(*) FROM public.saved_chart_views' INTO n;
  IF n <> 1 THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: user A sees % saved_chart_views rows (expected 1)', n;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.saved_chart_views WHERE user_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''' INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: user A can read user B chart views';
  END IF;
  RAISE NOTICE 'ok: user A sees only own saved chart views';

  EXECUTE 'UPDATE public.saved_chart_views SET name = ''hijacked'' WHERE user_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: user A updated user B chart view';
  END IF;
  RAISE NOTICE 'ok: user A cannot update user B chart views';

  EXECUTE 'DELETE FROM public.saved_chart_views WHERE user_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: user A deleted user B chart view';
  END IF;
  RAISE NOTICE 'ok: user A cannot delete user B chart views';
END $$;

DO $$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.saved_chart_views
      (id, user_id, name, dataset, position, x_metric, y_metric, "window", plot_limit, created_at, updated_at)
      VALUES (''view-b-forged'', ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'', ''forged'', ''advanced'', ''QB'', ''x'', ''y'', ''season'', ''24'', now(), now())';
    RAISE EXCEPTION 'RLS CHECK FAILED: user A inserted a chart view owned by user B';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: user A cannot insert a chart view owned by user B';
  END;
END $$;

RESET request.jwt.claims;
RESET ROLE;

-- Server role (table owner) still bypasses RLS: sanity-check own access.
DO $$
DECLARE
  n int;
BEGIN
  EXECUTE 'SELECT count(*) FROM public.saved_chart_views' INTO n;
  IF n < 2 THEN
    RAISE EXCEPTION 'RLS CHECK FAILED: server role sees % saved_chart_views rows (expected >= 2)', n;
  END IF;
  EXECUTE 'SELECT 1 FROM public.source_cache LIMIT 0';
  RAISE NOTICE 'ok: server role retains full access (% chart views visible)', n;
END $$;

SELECT 'ALL RLS CHECKS PASSED' AS result;
SQL

echo "== done"
